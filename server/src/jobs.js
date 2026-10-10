// Daily checks: reminders, automatic closures and overdue-task escalation.
// Safe to run any number of times: every rule checks what has already been done.
// `now` is a parameter so the rules can be tested without waiting days.
import crypto from 'node:crypto';
import { query, withTransaction } from './db.js';
import { closeProspect, dueInWorkingDays } from './pipeline.js';
import { formatLongDate } from './offerLetter.js';
import { sendEmail, templates } from './mailer.js';

export const RULES = {
  detailsReminderDays: 3, detailsCloseDays: 14,
  applicationReminderDays: 7, applicationCloseDays: 30,
  documentReminderDays: 5, documentCloseDays: 21,
  offerReminderDaysBefore: 7,
  escalateAfterWorkingDays: 2,
};

const daysBetween = (from, to) => (to.getTime() - new Date(from).getTime()) / 864e5;

/** Prospects in a stage, with when they entered it and their latest program. */
async function prospectsIn(stage) {
  const { rows } = await query(
    `SELECT p.id, p.full_name, p.email, p.user_id,
            (SELECT max(h.changed_at) FROM stage_history h WHERE h.prospect_id = p.id AND h.to_stage = p.stage) AS entered_at,
            (SELECT g.name FROM enquiry e JOIN program g ON g.id = e.program_id
              WHERE e.prospect_id = p.id ORDER BY e.enquiry_date DESC LIMIT 1) AS program
     FROM prospect p WHERE p.stage = $1`,
    [stage],
  );
  return rows;
}

const alreadySent = async (prospectId, template, since) =>
  (await query('SELECT 1 FROM email_log WHERE prospect_id = $1 AND template = $2 AND sent_at >= $3 LIMIT 1', [prospectId, template, since])).rows.length > 0;

/** Close a record if it is still in the stage we found it in. Returns true if closed. */
async function closeIfStill(prospect, stage, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT stage FROM prospect WHERE id = $1 FOR UPDATE', [prospect.id]);
    if (rows[0]?.stage !== stage) return false;
    await closeProspect(client, prospect.id, reason, { byType: 'system' });
    return true;
  });
}

async function newSignupToken(prospectId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO signup_token (prospect_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '14 days')`,
    [prospectId, crypto.createHash('sha256').update(token).digest('hex')],
  );
  return token;
}

export async function runDailyJobs(now = new Date()) {
  const done = { reminders: 0, closed: 0, escalated: 0 };
  const remind = async (p, email) => { await sendEmail({ prospectId: p.id, to: p.email, ...email }); done.reminders += 1; };
  const close = async (p, stage, reason, email) => {
    if (await closeIfStill(p, stage, reason)) {
      await sendEmail({ prospectId: p.id, to: p.email, ...email });
      done.closed += 1;
    }
  };

  // 1. Enquiry: academic and language details never submitted.
  for (const p of await prospectsIn('Enquiry')) {
    const age = daysBetween(p.entered_at, now);
    const data = { name: p.full_name, program: p.program };
    if (age >= RULES.detailsCloseDays) {
      await close(p, 'Enquiry', 'No response', templates.closedNoResponse(data));
    } else if (age >= RULES.detailsReminderDays && !(await alreadySent(p.id, 'Details reminder', p.entered_at))) {
      await remind(p, templates.detailsReminder({ ...data, token: p.user_id ? null : await newSignupToken(p.id) }));
    }
  }

  // 2. Qualified: application never submitted.
  for (const p of await prospectsIn('Qualified')) {
    const age = daysBetween(p.entered_at, now);
    const data = { name: p.full_name, program: p.program };
    if (age >= RULES.applicationCloseDays) {
      await close(p, 'Qualified', 'No response', templates.closedNoResponse(data));
    } else if (age >= RULES.applicationReminderDays && !(await alreadySent(p.id, 'Application reminder', p.entered_at))) {
      await remind(p, templates.applicationReminder(data));
    }
  }

  // 3. Application: a rejected document has not been replaced.
  const rejected = (await query(
    `SELECT DISTINCT ON (p.id) p.id, p.full_name, p.email, d.document_type, d.verified_at AS rejected_at,
            (SELECT g.name FROM program g WHERE g.id = a.program_id) AS program
     FROM document d JOIN application a ON a.id = d.application_id JOIN prospect p ON p.id = a.prospect_id
     WHERE d.status = 'Rejected' AND NOT d.issued AND p.stage = 'Application'
     ORDER BY p.id, d.verified_at`,
  )).rows;
  for (const p of rejected) {
    const age = daysBetween(p.rejected_at, now);
    if (age >= RULES.documentCloseDays) {
      await close(p, 'Application', 'No response', templates.closedNoResponse({ name: p.full_name, program: p.program }));
    } else if (age >= RULES.documentReminderDays && !(await alreadySent(p.id, 'Document reminder', p.rejected_at))) {
      await remind(p, templates.documentReminder({ name: p.full_name, documentType: p.document_type }));
    }
  }

  // 4. Offer: reminder before the deadline, lapse after it.
  const offers = (await query(
    `SELECT p.id, p.full_name, p.email, a.offer_expires_at, a.decided_at, g.name AS program
     FROM prospect p
     JOIN LATERAL (SELECT * FROM application x WHERE x.prospect_id = p.id ORDER BY x.created_at DESC LIMIT 1) a ON TRUE
     JOIN program g ON g.id = a.program_id
     WHERE p.stage = 'Offer' AND a.offer_expires_at IS NOT NULL`,
  )).rows;
  for (const p of offers) {
    const daysLeft = daysBetween(now, p.offer_expires_at);
    const data = { name: p.full_name, program: p.program, expires: formatLongDate(p.offer_expires_at) };
    if (daysLeft <= 0) {
      await close(p, 'Offer', 'Offer lapsed', templates.offerLapsed(data));
    } else if (daysLeft <= RULES.offerReminderDaysBefore && !(await alreadySent(p.id, 'Offer reminder', p.decided_at))) {
      await remind(p, templates.offerReminder(data));
    }
  }

  // 5. Staff tasks overdue by 2 working days: tell the managers, once per task.
  const overdue = (await query(
    `SELECT t.id, t.type, t.due_at, t.prospect_id, p.full_name AS prospect_name, s.full_name AS staff_name
     FROM task t JOIN prospect p ON p.id = t.prospect_id LEFT JOIN staff_user s ON s.id = t.assigned_staff_id
     WHERE t.status = 'Open' AND t.escalated_at IS NULL AND t.due_at < $1`,
    [now],
  )).rows.filter((t) => dueInWorkingDays(RULES.escalateAfterWorkingDays, new Date(t.due_at)) <= now);
  if (overdue.length) {
    const managers = (await query(`SELECT email FROM staff_user WHERE role = 'manager' AND is_active`)).rows;
    for (const t of overdue) {
      const claimed = await query('UPDATE task SET escalated_at = now() WHERE id = $1 AND escalated_at IS NULL RETURNING id', [t.id]);
      if (!claimed.rows.length) continue;
      const email = templates.taskEscalation({
        staffName: t.staff_name, taskType: t.type, prospectName: t.prospect_name, dueDate: formatLongDate(t.due_at), prospectId: t.prospect_id,
      });
      for (const m of managers) await sendEmail({ prospectId: t.prospect_id, to: m.email, ...email });
      done.escalated += 1;
    }
  }

  return done;
}

/** Run shortly after start-up, then every 6 hours. */
export function scheduleDailyJobs() {
  const run = () => runDailyJobs()
    .then((done) => { if (done.reminders || done.closed || done.escalated) console.log('Daily checks:', done); })
    .catch((err) => console.error('Daily checks failed:', err));
  setTimeout(run, 30_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
