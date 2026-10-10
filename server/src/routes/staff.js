// Staff area: pipeline summary, prospect list and detail, tasks, and the
// qualification decision for cases the criteria check did not pass (step 4).
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, audit, changeStage } from '../pipeline.js';
import { isUuid } from '../validate.js';
import { sendEmail, smtpConfigured, templates } from '../mailer.js';
import { allRequiredVerified, currentApplication, documentChecklist } from '../application.js';

const router = Router();
router.use(requireAuth('staff'));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

const STAGES = ['Enquiry', 'Qualification review', 'Qualified', 'Application', 'Offer', 'Enrolled', 'Closed'];

router.get('/summary', wrap(async (_req, res) => {
  const counts = (await query('SELECT stage, count(*)::int AS count FROM prospect GROUP BY stage')).rows;
  const closed = (await query(
    `SELECT closed_reason AS reason, count(*)::int AS count FROM prospect WHERE stage = 'Closed' GROUP BY closed_reason ORDER BY count DESC`,
  )).rows;
  res.json({
    stages: STAGES.map((stage) => ({ stage, count: counts.find((c) => c.stage === stage)?.count ?? 0 })),
    closed_reasons: closed,
  });
}));

router.get('/prospects', wrap(async (req, res) => {
  const stage = STAGES.includes(req.query.stage) ? req.query.stage : null;
  const search = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase()}%` : null;
  const { rows } = await query(
    `SELECT p.id, p.full_name, p.email, p.stage, p.closed_reason, p.created_at,
            p.possible_duplicate_of IS NOT NULL AS possible_duplicate,
            s.full_name AS assigned_staff,
            (SELECT g.name FROM enquiry e JOIN program g ON g.id = e.program_id
              WHERE e.prospect_id = p.id ORDER BY e.enquiry_date DESC LIMIT 1) AS program
     FROM prospect p LEFT JOIN staff_user s ON s.id = p.assigned_staff_id
     WHERE ($1::text IS NULL OR p.stage = $1)
       AND ($2::text IS NULL OR lower(p.full_name) LIKE $2 OR lower(p.email) LIKE $2)
     ORDER BY p.created_at DESC LIMIT 200`,
    [stage, search],
  );
  res.json(rows);
}));

router.get('/prospects/:id', wrap(async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) throw new HttpError(404, 'Prospect not found.');
  const prospect = (await query(
    `SELECT p.id, p.full_name, p.email, p.phone, p.address, p.stage, p.closed_reason, p.created_at,
            p.possible_duplicate_of, p.user_id IS NOT NULL AS has_account, s.full_name AS assigned_staff
     FROM prospect p LEFT JOIN staff_user s ON s.id = p.assigned_staff_id WHERE p.id = $1`,
    [id],
  )).rows[0];
  if (!prospect) throw new HttpError(404, 'Prospect not found.');

  const [enquiries, qualification, history, tasks] = await Promise.all([
    query(
      `SELECT e.id, e.enquiry_date, e.source, e.message, g.name AS program
       FROM enquiry e JOIN program g ON g.id = e.program_id WHERE e.prospect_id = $1 ORDER BY e.enquiry_date DESC`, [id]),
    query(
      `SELECT q.*, g.name AS program, g.min_qualification_level, g.language_requirements,
              i.name AS intake, r.full_name AS reviewed_by_name
       FROM qualification q JOIN program g ON g.id = q.program_id
       LEFT JOIN intake i ON i.id = q.intake_id LEFT JOIN staff_user r ON r.id = q.reviewed_by
       WHERE q.prospect_id = $1`, [id]),
    query(
      `SELECT h.id, h.from_stage, h.to_stage, h.closed_reason, h.changed_by_type, h.changed_at, s.full_name AS staff_name
       FROM stage_history h LEFT JOIN staff_user s ON h.changed_by_type = 'staff' AND s.id = h.changed_by_id
       WHERE h.prospect_id = $1 ORDER BY h.changed_at`, [id]),
    query(`SELECT id, type, due_at, status, due_at < now() AND status = 'Open' AS overdue FROM task WHERE prospect_id = $1 ORDER BY created_at DESC`, [id]),
  ]);

  // Application, documents, offer letter and enrolment (steps 5 to 7).
  let application = null;
  const current = await currentApplication({ query }, id);
  if (current) {
    const [extra, checklist, letter, enrolment] = await Promise.all([
      query(
        `SELECT g.name AS program, i.name AS intake, s.full_name AS decision_by_name
         FROM program g LEFT JOIN intake i ON i.id = $2 LEFT JOIN staff_user s ON s.id = $3 WHERE g.id = $1`,
        [current.program_id, current.intake_id, current.decision_by]),
      documentChecklist({ query }, current),
      query('SELECT id, file_name FROM document WHERE application_id = $1 AND issued ORDER BY uploaded_at DESC LIMIT 1', [current.id]),
      query('SELECT enrolment_date FROM enrolment WHERE application_id = $1', [current.id]),
    ]);
    application = {
      ...current, ...extra.rows[0], checklist,
      ready_for_decision: allRequiredVerified(checklist),
      offer_letter: letter.rows[0] ?? null,
      enrolment: enrolment.rows[0] ?? null,
    };
  }

  res.json({
    prospect,
    application,
    enquiries: enquiries.rows,
    qualification: qualification.rows[0] ?? null,
    history: history.rows,
    tasks: tasks.rows,
  });
}));

// Recruiters see their own open tasks; managers see everyone's.
router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.type, t.due_at, t.due_at < now() AS overdue, t.prospect_id, p.full_name AS prospect, s.full_name AS assigned_staff
     FROM task t JOIN prospect p ON p.id = t.prospect_id LEFT JOIN staff_user s ON s.id = t.assigned_staff_id
     WHERE t.status = 'Open' AND ($1::uuid IS NULL OR t.assigned_staff_id = $1)
     ORDER BY t.due_at`,
    [req.user.role === 'manager' ? null : req.user.sub],
  );
  res.json(rows);
}));

// Step 4, human decision. Managers are read-only, so recruiters only.
router.post('/prospects/:id/qualification-decision', requireRole('recruiter'), wrap(async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) throw new HttpError(404, 'Prospect not found.');
  const decision = req.body?.decision;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(422, 'Choose approve or reject.');
  if (decision === 'reject' && !note) throw new HttpError(422, 'A note is required when rejecting.', { errors: { note: 'Explain why the student is not eligible.' } });
  if (note.length > 1000) throw new HttpError(422, 'Note must be 1,000 characters or fewer.');

  const result = await withTransaction(async (client) => {
    const prospect = (await client.query('SELECT id, full_name, email, stage FROM prospect WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!prospect) throw new HttpError(404, 'Prospect not found.');
    if (prospect.stage !== 'Qualification review') {
      throw new HttpError(409, `This record is in "${prospect.stage}" and is not waiting for a qualification decision.`);
    }
    const qualification = (await client.query(
      `SELECT q.program_id, q.intake_id, g.name AS program FROM qualification q JOIN program g ON g.id = q.program_id WHERE q.prospect_id = $1`, [id],
    )).rows[0];
    const by = { byType: 'staff', byId: req.user.sub };

    if (decision === 'approve') {
      await changeStage(client, id, 'Qualified', by);
      await client.query('INSERT INTO application (prospect_id, program_id, intake_id) VALUES ($1, $2, $3)', [id, qualification.program_id, qualification.intake_id]);
    } else {
      await changeStage(client, id, 'Closed', { ...by, closedReason: 'Not eligible' });
    }
    await client.query(
      `UPDATE qualification SET decision = $2, reviewed_by = $3, review_note = $4, decided_at = now() WHERE prospect_id = $1`,
      [id, decision === 'approve' ? 'Approved' : 'Rejected', req.user.sub, note || null],
    );
    await client.query(
      `UPDATE task SET status = 'Done', completed_at = now()
       WHERE prospect_id = $1 AND status = 'Open'`,
      [id],
    );
    await audit(client, { prospectId: id, actorType: 'staff', actorId: req.user.sub, action: `Qualification ${decision === 'approve' ? 'approved' : 'rejected'}`, detail: { note: note || null } });
    return { prospect, program: qualification.program };
  });

  const data = { name: result.prospect.full_name, program: result.program };
  await sendEmail({
    prospectId: id,
    to: result.prospect.email,
    ...(decision === 'approve' ? templates.qualified(data) : templates.notEligible(data)),
  });
  res.json({ stage: decision === 'approve' ? 'Qualified' : 'Closed' });
}));

// Email log. Message bodies (which contain sign-up links) are only shown in
// development, when no real mail server is configured.
router.get('/emails', wrap(async (_req, res) => {
  const showBody = !smtpConfigured();
  const { rows } = await query(
    `SELECT id, template, to_email, subject, status, sent_at${showBody ? ', body' : ''} FROM email_log ORDER BY sent_at DESC LIMIT 100`,
  );
  res.json({ dev_mode: showBody, emails: rows });
}));

export default router;
