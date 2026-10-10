// Student portal: status, qualification form (step 3) and the criteria check (step 4).
// Every query is scoped to the logged-in student's own prospect record.
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, audit, changeStage, createTask } from '../pipeline.js';
import { validateQualification } from '../validate.js';
import { evaluateCriteria, QUALIFICATION_LEVELS, LANGUAGE_TESTS, LANGUAGE_TEST_TYPES } from '../criteria.js';
import { sendEmail, templates } from '../mailer.js';

const router = Router();
router.use(requireAuth('student'));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

const QUALIFICATION_FIELDS = [
  'highest_qualification', 'institution', 'year_completed', 'result',
  'language_test_type', 'language_score', 'test_date', 'intake_id',
];

async function loadProspect(client, userId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, full_name, email, phone, stage, closed_reason, assigned_staff_id
     FROM prospect WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [userId],
  );
  if (!rows.length) throw new HttpError(404, 'No enquiry is linked to this account.');
  return rows[0];
}

/** The program the student is being assessed for: their most recent enquiry. */
async function latestProgram(client, prospectId) {
  const { rows } = await client.query(
    `SELECT g.id, g.name, g.discipline, g.min_qualification_level, g.language_requirements
     FROM enquiry e JOIN program g ON g.id = e.program_id
     WHERE e.prospect_id = $1 ORDER BY e.enquiry_date DESC LIMIT 1`,
    [prospectId],
  );
  return rows[0];
}

async function saveQualification(client, prospectId, programId, value) {
  await client.query(
    `INSERT INTO qualification (prospect_id, program_id, ${QUALIFICATION_FIELDS.join(', ')})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (prospect_id) DO UPDATE SET program_id = EXCLUDED.program_id,
       ${QUALIFICATION_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}`,
    [prospectId, programId, ...QUALIFICATION_FIELDS.map((f) => value[f])],
  );
}

router.get('/me', wrap(async (req, res) => {
  const prospect = await loadProspect({ query }, req.user.sub);
  const qualification = (await query(
    `SELECT program_id, ${QUALIFICATION_FIELDS.join(', ')}, submitted_at FROM qualification WHERE prospect_id = $1`,
    [prospect.id],
  )).rows[0] ?? null;
  // Once submitted, the form stays tied to the program it was assessed against.
  const program = qualification?.submitted_at
    ? (await query('SELECT id, name, discipline FROM program WHERE id = $1', [qualification.program_id])).rows[0]
    : await latestProgram({ query }, prospect.id);
  const intakes = (await query(
    'SELECT id, name, start_date FROM intake WHERE program_id = $1 AND is_open ORDER BY start_date', [program.id],
  )).rows;

  if (qualification?.language_score != null) qualification.language_score = Number(qualification.language_score);

  res.json({
    prospect: { full_name: prospect.full_name, email: prospect.email, phone: prospect.phone, stage: prospect.stage, closed_reason: prospect.closed_reason },
    program: { id: program.id, name: program.name, discipline: program.discipline },
    qualification,
    intakes,
    options: {
      qualifications: Object.keys(QUALIFICATION_LEVELS),
      language_tests: LANGUAGE_TEST_TYPES,
      language_ranges: LANGUAGE_TESTS,
    },
  });
}));

// Save a draft. Only allowed before the form has been submitted.
router.put('/qualification', wrap(async (req, res) => {
  const { errors, value } = validateQualification(req.body, { requireAll: false });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { errors });

  await withTransaction(async (client) => {
    const prospect = await loadProspect(client, req.user.sub, { lock: true });
    if (prospect.stage !== 'Enquiry') throw new HttpError(409, 'Your details have already been submitted.');
    const program = await latestProgram(client, prospect.id);
    await saveQualification(client, prospect.id, program.id, value);
  });
  res.json({ message: 'Draft saved.' });
}));

// Submit the form, then run the criteria check straight away.
router.post('/qualification/submit', wrap(async (req, res) => {
  const { errors, value } = validateQualification(req.body, { requireAll: true });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { errors });

  const outcome = await withTransaction(async (client) => {
    const prospect = await loadProspect(client, req.user.sub, { lock: true });
    if (prospect.stage !== 'Enquiry') throw new HttpError(409, 'Your details have already been submitted.');
    const program = await latestProgram(client, prospect.id);

    const intake = (await client.query(
      'SELECT id FROM intake WHERE id = $1 AND program_id = $2 AND is_open', [value.intake_id, program.id],
    )).rows[0];
    if (!intake) throw new HttpError(422, 'Please correct the highlighted fields.', { errors: { intake_id: 'Select an open intake for this program.' } });

    await saveQualification(client, prospect.id, program.id, value);
    const by = { byType: 'student', byId: req.user.sub };
    await changeStage(client, prospect.id, 'Qualification review', by);

    const { result, reasons } = evaluateCriteria(program, value);
    await client.query(
      'UPDATE qualification SET submitted_at = now(), auto_result = $2, auto_reasons = $3 WHERE prospect_id = $1',
      [prospect.id, result, JSON.stringify(reasons)],
    );
    await audit(client, { prospectId: prospect.id, actorType: 'system', action: 'Criteria check run', detail: { result, reasons } });

    if (result === 'Pass') {
      await changeStage(client, prospect.id, 'Qualified', { byType: 'system' });
      await client.query(
        `INSERT INTO application (prospect_id, program_id, intake_id) VALUES ($1, $2, $3)`,
        [prospect.id, program.id, value.intake_id],
      );
    } else {
      // The system never rejects on its own: a person confirms or overrides.
      await createTask(client, {
        prospectId: prospect.id,
        staffId: prospect.assigned_staff_id,
        type: result === 'Fail' ? 'Confirm not eligible' : 'Review qualification',
        workingDays: 2,
      });
    }
    return { prospect, program, result };
  });

  const { prospect, program, result } = outcome;
  const data = { name: prospect.full_name, program: program.name };
  await sendEmail({
    prospectId: prospect.id,
    to: prospect.email,
    ...(result === 'Pass' ? templates.qualified(data) : templates.underReview(data)),
  });

  res.json({ stage: result === 'Pass' ? 'Qualified' : 'Qualification review' });
}));

export default router;
