// Routes that need no login: programs, enquiry (step 1 + 2), sign-up (step 3), logins.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { signToken } from '../auth.js';
import { HttpError, audit, changeStage, createTask } from '../pipeline.js';
import { validateEnquiry, validatePassword } from '../validate.js';
import { sendEmail, templates } from '../mailer.js';

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const TOKEN_DAYS = 14;
// Compared against when the account does not exist, so both cases take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function createSignupToken(client, prospectId) {
  const token = crypto.randomBytes(32).toString('hex');
  await client.query(
    `INSERT INTO signup_token (prospect_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [prospectId, hashToken(token), TOKEN_DAYS],
  );
  return token;
}

router.get('/programs', wrap(async (_req, res) => {
  const { rows } = await query('SELECT id, name, discipline FROM program WHERE is_active ORDER BY name');
  res.json(rows);
}));

// Step 1: enquiry. Step 2: brochure email with a sign-up link.
async function saveEnquiry(value) {
  return withTransaction(async (client) => {
    const program = (await client.query(
      'SELECT id, name, brochure_url FROM program WHERE id = $1 AND is_active', [value.program_id],
    )).rows[0];
    if (!program) throw new HttpError(422, 'Please correct the highlighted fields.', { errors: { program_id: 'Select a program.' } });

    let prospect = (await client.query(
      'SELECT * FROM prospect WHERE lower(email) = $1 FOR UPDATE', [value.email],
    )).rows[0];

    if (!prospect) {
      // Same phone under a different email: keep both, flag for staff.
      const samePhone = (await client.query(
        'SELECT id FROM prospect WHERE phone = $1 ORDER BY created_at LIMIT 1', [value.phone],
      )).rows[0];
      const staff = (await client.query(
        `SELECT s.id FROM staff_user s
         LEFT JOIN prospect p ON p.assigned_staff_id = s.id AND p.stage NOT IN ('Closed', 'Enrolled')
         WHERE s.role = 'recruiter' AND s.is_active
         GROUP BY s.id, s.full_name ORDER BY count(p.id), s.full_name LIMIT 1`,
      )).rows[0];

      prospect = (await client.query(
        `INSERT INTO prospect (assigned_staff_id, full_name, email, phone, address, possible_duplicate_of, consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
        [staff?.id ?? null, value.full_name, value.email, value.phone, value.address, samePhone?.id ?? null],
      )).rows[0];
      await client.query(
        `INSERT INTO stage_history (prospect_id, from_stage, to_stage, changed_by_type) VALUES ($1, NULL, 'Enquiry', 'system')`,
        [prospect.id],
      );
      await audit(client, { prospectId: prospect.id, actorType: 'system', action: 'Prospect created' });
    } else if (prospect.stage === 'Closed') {
      // A closed prospect enquiring again restarts the flow.
      await changeStage(client, prospect.id, 'Enquiry', { byType: 'system' });
      await client.query(
        `UPDATE qualification SET submitted_at = NULL, auto_result = NULL, auto_reasons = NULL, decision = NULL,
           reviewed_by = NULL, review_note = NULL, decided_at = NULL WHERE prospect_id = $1`,
        [prospect.id],
      );
    }

    await client.query(
      `INSERT INTO enquiry (prospect_id, program_id, message) VALUES ($1, $2, $3)`,
      [prospect.id, program.id, value.message],
    );
    await audit(client, { prospectId: prospect.id, actorType: 'system', action: 'Enquiry received', detail: { program: program.name } });

    const token = prospect.user_id ? null : await createSignupToken(client, prospect.id);
    return { prospect, program, token };
  });
}

router.post('/enquiries', wrap(async (req, res) => {
  const { errors, value } = validateEnquiry(req.body);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { errors });

  let saved;
  try {
    saved = await saveEnquiry(value);
  } catch (err) {
    // Two enquiries with the same new email at the same moment: the second one
    // hits the unique index. Retry once; it will now find the prospect.
    if (err.code !== '23505') throw err;
    saved = await saveEnquiry(value);
  }

  const { prospect, program, token } = saved;
  const data = { name: prospect.full_name, program: program.name, brochureUrl: program.brochure_url, token };
  const status = await sendEmail({
    prospectId: prospect.id,
    to: prospect.email,
    ...(token ? templates.brochureSignup(data) : templates.brochureLogin(data)),
  });
  if (status === 'Failed') {
    await withTransaction((client) =>
      createTask(client, { prospectId: prospect.id, staffId: prospect.assigned_staff_id, type: 'Brochure email failed', workingDays: 1 }));
  }

  // Same reply whether or not the email was already known.
  res.status(201).json({ message: 'Thank you for your enquiry. We have emailed you the course brochure and next steps.' });
}));

// Step 3a: check a sign-up link before showing the form.
async function findToken(client, token, { lock = false } = {}) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const { rows } = await client.query(
    `SELECT t.id, t.used_at, t.expires_at < now() AS expired, p.id AS prospect_id, p.email, p.full_name, p.user_id
     FROM signup_token t JOIN prospect p ON p.id = t.prospect_id
     WHERE t.token_hash = $1 ${lock ? 'FOR UPDATE OF t, p' : ''}`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row && !row.used_at && !row.expired && !row.user_id ? row : null;
}

router.get('/signup/:token', wrap(async (req, res) => {
  const row = await findToken({ query }, req.params.token);
  if (!row) throw new HttpError(410, 'This sign-up link has expired or has already been used.');
  res.json({ email: row.email, full_name: row.full_name });
}));

// Step 3b: create the student account. The link proves the email is theirs.
router.post('/signup', wrap(async (req, res) => {
  const passwordError = validatePassword(req.body?.password);
  if (passwordError) throw new HttpError(422, 'Please correct the highlighted fields.', { errors: { password: passwordError } });
  const passwordHash = await bcrypt.hash(req.body.password, 10);

  const user = await withTransaction(async (client) => {
    const row = await findToken(client, req.body?.token, { lock: true });
    if (!row) throw new HttpError(410, 'This sign-up link has expired or has already been used.');
    const created = (await client.query(
      'INSERT INTO student_user (email, password_hash, last_login_at) VALUES ($1, $2, now()) RETURNING id, email',
      [row.email.toLowerCase(), passwordHash],
    )).rows[0];
    await client.query('UPDATE prospect SET user_id = $2 WHERE id = $1', [row.prospect_id, created.id]);
    await client.query('UPDATE signup_token SET used_at = now() WHERE prospect_id = $1 AND used_at IS NULL', [row.prospect_id]);
    await audit(client, { prospectId: row.prospect_id, actorType: 'student', actorId: created.id, action: 'Account created' });
    return created;
  });

  res.status(201).json({ token: signToken({ sub: user.id, type: 'student' }), email: user.email });
}));

// Ask for a fresh sign-up link. Always answers the same way.
router.post('/signup/resend', wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const result = await withTransaction(async (client) => {
    const prospect = (await client.query(
      `SELECT p.id, p.full_name, p.email, p.user_id, p.stage,
              (SELECT row_to_json(x) FROM (SELECT g.name, g.brochure_url FROM enquiry e JOIN program g ON g.id = e.program_id
                 WHERE e.prospect_id = p.id ORDER BY e.enquiry_date DESC LIMIT 1) x) AS program
       FROM prospect p WHERE lower(p.email) = $1`,
      [email],
    )).rows[0];
    if (!prospect || prospect.user_id || prospect.stage === 'Closed') return null;
    return { prospect, token: await createSignupToken(client, prospect.id) };
  });
  if (result) {
    const { prospect, token } = result;
    await sendEmail({
      prospectId: prospect.id,
      to: prospect.email,
      ...templates.brochureSignup({ name: prospect.full_name, program: prospect.program.name, brochureUrl: prospect.program.brochure_url, token }),
    });
  }
  res.json({ message: 'If we have an enquiry for that email, a new link is on its way.' });
}));

// Logins. The error never says whether the account exists.
const loginFailed = () => new HttpError(401, 'Email or password is incorrect.');

router.post('/auth/student/login', wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = (await query('SELECT id, email, password_hash FROM student_user WHERE email = $1', [email])).rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw loginFailed();
  await query('UPDATE student_user SET last_login_at = now() WHERE id = $1', [user.id]);
  res.json({ token: signToken({ sub: user.id, type: 'student' }), email: user.email });
}));

router.post('/auth/staff/login', wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = (await query(
    'SELECT id, full_name, role, password_hash, is_active FROM staff_user WHERE lower(email) = $1', [email],
  )).rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.is_active) throw loginFailed();
  res.json({ token: signToken({ sub: user.id, type: 'staff', role: user.role }), full_name: user.full_name, role: user.role });
}));

export default router;
