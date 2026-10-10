// End-to-end API tests for steps 1 to 4. Needs a database: these tests RESET it.
// Run with: npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { evaluateCriteria } from '../src/criteria.js';

let server;
let base;
let programs;

const api = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const enquiry = (overrides = {}) => ({
  full_name: 'Alex Chen', email: 'alex@example.com', phone: '0412 345 678', address: '1 Main St',
  program_id: programs.find((p) => p.name.startsWith('Diploma of Data Science')).id,
  message: 'When does it start?', consent: true, ...overrides,
});

const lastSignupToken = async (email) => {
  const { rows } = await query(
    `SELECT body FROM email_log WHERE to_email = $1 AND body LIKE '%/signup/%' ORDER BY sent_at DESC LIMIT 1`, [email]);
  return rows[0].body.match(/\/signup\/([0-9a-f]{64})/)[1];
};

const stageOf = async (email) => (await query('SELECT stage, closed_reason FROM prospect WHERE email = $1', [email])).rows[0];

const recentDate = () => new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
const qualification = (intakeId, overrides = {}) => ({
  highest_qualification: 'Diploma', institution: 'Sydney TAFE', year_completed: 2022, result: 'Credit',
  language_test_type: 'IELTS', language_score: 7, test_date: recentDate(), intake_id: intakeId, ...overrides,
});

/** Enquire, sign up, and return a logged-in student token plus an intake id. */
async function signedUpStudent(email, overrides = {}) {
  await api('POST', '/api/enquiries', enquiry({ email, phone: `04${Math.floor(1e7 + Math.random() * 9e7)}`, ...overrides }));
  const signup = await api('POST', '/api/signup', { token: await lastSignupToken(email), password: 'correct-horse-battery' });
  assert.equal(signup.status, 201);
  const me = await api('GET', '/api/student/me', null, signup.body.token);
  return { token: signup.body.token, intakeId: me.body.intakes[0].id, me: me.body };
}

const staffLogin = async (email) => (await api('POST', '/api/auth/staff/login', { email, password: 'Password123!' })).body.token;

before(async () => {
  execFileSync('node', [fileURLToPath(new URL('../db/reset.js', import.meta.url))]);
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  programs = (await api('GET', '/api/programs')).body;
});

after(async () => {
  server.close();
  await pool.end();
});

test('enquiry: invalid input is rejected and nothing is saved', async () => {
  const res = await api('POST', '/api/enquiries', enquiry({ email: 'jane@', phone: '12', consent: false, full_name: '' }));
  assert.equal(res.status, 422);
  assert.deepEqual(Object.keys(res.body.errors).sort(), ['consent', 'email', 'full_name', 'phone']);
  assert.equal((await query('SELECT count(*)::int AS n FROM prospect')).rows[0].n, 0);
});

test('enquiry: creates prospect, enquiry, history, assignment and brochure email', async () => {
  const res = await api('POST', '/api/enquiries', enquiry());
  assert.equal(res.status, 201);
  const p = (await query(`SELECT * FROM prospect WHERE email = 'alex@example.com'`)).rows[0];
  assert.equal(p.stage, 'Enquiry');
  assert.equal(p.phone, '0412345678');
  assert.ok(p.assigned_staff_id);
  assert.equal((await query('SELECT count(*)::int AS n FROM enquiry WHERE prospect_id = $1', [p.id])).rows[0].n, 1);
  const history = (await query('SELECT from_stage, to_stage FROM stage_history WHERE prospect_id = $1', [p.id])).rows;
  assert.deepEqual(history, [{ from_stage: null, to_stage: 'Enquiry' }]);
  assert.ok(await lastSignupToken('alex@example.com'));
});

test('enquiry: same email (any case) attaches to the existing prospect', async () => {
  const res = await api('POST', '/api/enquiries', enquiry({ email: 'ALEX@Example.com', program_id: programs[0].id }));
  assert.equal(res.status, 201);
  assert.equal((await query(`SELECT count(*)::int AS n FROM prospect WHERE lower(email) = 'alex@example.com'`)).rows[0].n, 1);
  assert.equal((await query('SELECT count(*)::int AS n FROM enquiry')).rows[0].n, 2);
});

test('enquiry: same phone with a different email is flagged as a possible duplicate', async () => {
  await api('POST', '/api/enquiries', enquiry({ email: 'alex.other@example.com' }));
  const p = (await query(`SELECT possible_duplicate_of FROM prospect WHERE email = 'alex.other@example.com'`)).rows[0];
  assert.ok(p.possible_duplicate_of);
});

test('enquiry: new prospects are shared between recruiters', async () => {
  const { rows } = await query('SELECT count(DISTINCT assigned_staff_id)::int AS n FROM prospect');
  assert.equal(rows[0].n, 2);
});

test('sign-up: bad token, short password, then success, and the link works only once', async () => {
  assert.equal((await api('GET', `/api/signup/${'0'.repeat(64)}`)).status, 410);
  const token = await lastSignupToken('alex@example.com');
  const check = await api('GET', `/api/signup/${token}`);
  assert.equal(check.body.email, 'alex@example.com');

  assert.equal((await api('POST', '/api/signup', { token, password: 'short' })).status, 422);
  const ok = await api('POST', '/api/signup', { token, password: 'correct-horse-battery' });
  assert.equal(ok.status, 201);
  assert.equal((await api('POST', '/api/signup', { token, password: 'correct-horse-battery' })).status, 410);

  const login = await api('POST', '/api/auth/student/login', { email: 'alex@example.com', password: 'correct-horse-battery' });
  assert.equal(login.status, 200);
  const wrong = await api('POST', '/api/auth/student/login', { email: 'alex@example.com', password: 'wrong-password-1' });
  const unknown = await api('POST', '/api/auth/student/login', { email: 'nobody@example.com', password: 'wrong-password-1' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('enquiry with a password: creates the account and logs the student in', async () => {
  const body = enquiry({ email: 'direct@example.com', phone: '0499000111', password: 'correct-horse-battery' });
  assert.equal((await api('POST', '/api/enquiries', { ...body, password: 'short' })).status, 422);
  assert.equal((await query(`SELECT count(*)::int AS n FROM prospect WHERE email = 'direct@example.com'`)).rows[0].n, 0);

  const res = await api('POST', '/api/enquiries', body);
  assert.equal(res.status, 201);
  const me = await api('GET', '/api/student/me', null, res.body.token);
  assert.equal(me.body.prospect.stage, 'Enquiry');
  assert.equal(me.body.prospect.email, 'direct@example.com');
  const login = await api('POST', '/api/auth/student/login', { email: 'direct@example.com', password: 'correct-horse-battery' });
  assert.equal(login.status, 200);

  // The same email again cannot set a new password on the existing account.
  const again = await api('POST', '/api/enquiries', { ...body, password: 'another-password-1' });
  assert.equal(again.status, 409);
  assert.equal(again.body.token, undefined);
  assert.equal((await api('POST', '/api/auth/student/login', { email: 'direct@example.com', password: 'another-password-1' })).status, 401);
});

test('enquiry with a password: an email with an earlier enquiry but no account is not claimed', async () => {
  await api('POST', '/api/enquiries', enquiry({ email: 'earlier@example.com', phone: '0499000222' }));
  const res = await api('POST', '/api/enquiries', enquiry({ email: 'earlier@example.com', phone: '0499000222', password: 'correct-horse-battery' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.token, undefined);
  assert.equal((await query(`SELECT user_id FROM prospect WHERE email = 'earlier@example.com'`)).rows[0].user_id, null);
  assert.ok(await lastSignupToken('earlier@example.com'));
});

test('access: student and staff areas need the right kind of login', async () => {
  assert.equal((await api('GET', '/api/student/me')).status, 401);
  assert.equal((await api('GET', '/api/staff/prospects')).status, 401);
  const { token } = await signedUpStudent('access@example.com');
  assert.equal((await api('GET', '/api/staff/prospects', null, token)).status, 403);
  assert.equal((await api('GET', '/api/student/me', null, await staffLogin('sarah@ric.test'))).status, 403);
});

test('qualification: draft saves partial data, submit requires everything', async () => {
  const { token, intakeId } = await signedUpStudent('draft@example.com');
  assert.equal((await api('PUT', '/api/student/qualification', { institution: 'UNSW' }, token)).status, 200);
  const me = await api('GET', '/api/student/me', null, token);
  assert.equal(me.body.qualification.institution, 'UNSW');
  const res = await api('POST', '/api/student/qualification/submit', { institution: 'UNSW', intake_id: intakeId }, token);
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.highest_qualification && res.body.errors.language_test_type);
  assert.equal((await stageOf('draft@example.com')).stage, 'Enquiry');
});

test('criteria: meets all criteria -> Qualified automatically, draft application created', async () => {
  const { token, intakeId } = await signedUpStudent('pass@example.com');
  const res = await api('POST', '/api/student/qualification/submit', qualification(intakeId), token);
  assert.deepEqual(res.body, { stage: 'Qualified' });
  const history = (await query(
    `SELECT to_stage, changed_by_type FROM stage_history h JOIN prospect p ON p.id = h.prospect_id
     WHERE p.email = 'pass@example.com' ORDER BY changed_at, to_stage DESC`)).rows;
  assert.deepEqual(history.map((h) => h.to_stage).sort(), ['Enquiry', 'Qualification review', 'Qualified']);
  const apps = (await query(`SELECT a.status FROM application a JOIN prospect p ON p.id = a.prospect_id WHERE p.email = 'pass@example.com'`)).rows;
  assert.deepEqual(apps, [{ status: 'Draft' }]);
  // A second submit is refused.
  assert.equal((await api('POST', '/api/student/qualification/submit', qualification(intakeId), token)).status, 409);
  assert.equal((await api('PUT', '/api/student/qualification', { institution: 'X' }, token)).status, 409);
});

test('criteria: borderline score -> staff review -> approve -> Qualified', async () => {
  const { token, intakeId } = await signedUpStudent('review@example.com');
  const res = await api('POST', '/api/student/qualification/submit', qualification(intakeId, { language_score: 5.5 }), token);
  assert.deepEqual(res.body, { stage: 'Qualification review' });

  const manager = await staffLogin('manager@ric.test');
  const list = await api('GET', '/api/staff/prospects?stage=Qualification%20review&q=review@', null, manager);
  assert.equal(list.body.length, 1);
  const id = list.body[0].id;
  const detail = await api('GET', `/api/staff/prospects/${id}`, null, manager);
  assert.equal(detail.body.qualification.auto_result, 'Review');
  assert.equal(detail.body.tasks[0].type, 'Review qualification');

  // Managers are read-only.
  assert.equal((await api('POST', `/api/staff/prospects/${id}/qualification-decision`, { decision: 'approve' }, manager)).status, 403);

  const recruiter = await staffLogin('sarah@ric.test');
  const ok = await api('POST', `/api/staff/prospects/${id}/qualification-decision`, { decision: 'approve' }, recruiter);
  assert.deepEqual(ok.body, { stage: 'Qualified' });
  assert.equal((await api('POST', `/api/staff/prospects/${id}/qualification-decision`, { decision: 'approve' }, recruiter)).status, 409);
  const after = await api('GET', `/api/staff/prospects/${id}`, null, recruiter);
  assert.equal(after.body.tasks[0].status, 'Done');
  assert.equal(after.body.history.at(-1).staff_name, 'Sarah Wilson');
});

test('criteria: clear fail -> staff confirm with a note -> Closed as Not eligible, then a new enquiry reopens', async () => {
  const ai = programs.find((p) => p.name.includes('Artificial Intelligence')).id;
  const { token, intakeId } = await signedUpStudent('fail@example.com', { program_id: ai });
  await api('POST', '/api/student/qualification/submit', qualification(intakeId), token); // Diploma < Bachelor
  assert.equal((await stageOf('fail@example.com')).stage, 'Qualification review');

  const recruiter = await staffLogin('michael@ric.test');
  const id = (await api('GET', '/api/staff/prospects?q=fail@', null, recruiter)).body[0].id;
  const detail = await api('GET', `/api/staff/prospects/${id}`, null, recruiter);
  assert.equal(detail.body.qualification.auto_result, 'Fail');
  assert.equal(detail.body.tasks[0].type, 'Confirm not eligible');

  assert.equal((await api('POST', `/api/staff/prospects/${id}/qualification-decision`, { decision: 'reject' }, recruiter)).status, 422);
  const res = await api('POST', `/api/staff/prospects/${id}/qualification-decision`, { decision: 'reject', note: 'No bachelor degree.' }, recruiter);
  assert.deepEqual(res.body, { stage: 'Closed' });
  assert.deepEqual(await stageOf('fail@example.com'), { stage: 'Closed', closed_reason: 'Not eligible' });

  await api('POST', '/api/enquiries', enquiry({ email: 'fail@example.com' }));
  assert.deepEqual(await stageOf('fail@example.com'), { stage: 'Enquiry', closed_reason: null });
  const me = await api('GET', '/api/student/me', null, token);
  assert.equal(me.body.qualification.submitted_at, null);
  assert.ok(me.body.program.name.includes('Data Science'));
});

test('criteria rules', () => {
  const program = { min_qualification_level: 3, language_requirements: { IELTS: 6, PTE: 50 } };
  const q = (o) => ({ highest_qualification: 'Diploma', language_test_type: 'IELTS', language_score: 6, ...o });
  assert.equal(evaluateCriteria(program, q()).result, 'Pass');
  assert.equal(evaluateCriteria(program, q({ language_score: 5.5 })).result, 'Review');
  assert.equal(evaluateCriteria(program, q({ language_score: 5 })).result, 'Fail');
  assert.equal(evaluateCriteria(program, q({ highest_qualification: 'Certificate' })).result, 'Fail');
  assert.equal(evaluateCriteria(program, q({ language_test_type: 'None taken', language_score: null })).result, 'Review');
  assert.equal(evaluateCriteria(program, q({ language_test_type: 'TOEFL', language_score: 100 })).result, 'Review');
  assert.equal(evaluateCriteria({ min_qualification_level: null, language_requirements: null }, q()).result, 'Review');
});

test('staff summary counts match the pipeline', async () => {
  const res = await api('GET', '/api/staff/summary', null, await staffLogin('manager@ric.test'));
  const total = res.body.stages.reduce((sum, s) => sum + s.count, 0);
  assert.equal(total, (await query('SELECT count(*)::int AS n FROM prospect')).rows[0].n);
  assert.equal(res.body.stages.find((s) => s.stage === 'Qualified').count, 2);
  assert.ok(res.body.stages.find((s) => s.stage === 'Enquiry').count >= 1);
});
