// The only place a prospect's stage is allowed to change.

export const TRANSITIONS = {
  'Enquiry': ['Qualification review', 'Closed'],
  'Qualification review': ['Qualified', 'Closed'],
  'Qualified': ['Application', 'Closed'],
  'Application': ['Offer', 'Closed'],
  'Offer': ['Enrolled', 'Closed'],
  'Enrolled': [],
  'Closed': ['Enquiry'], // reopened by a new enquiry
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function audit(client, { prospectId, actorType, actorId = null, action, detail = null }) {
  await client.query(
    `INSERT INTO audit_log (prospect_id, actor_type, actor_id, action, detail) VALUES ($1, $2, $3, $4, $5)`,
    [prospectId, actorType, actorId, action, detail],
  );
}

/**
 * Move a prospect to a new stage. Must be called inside a transaction:
 * the stage update, the history row and the audit row commit together.
 */
export async function changeStage(client, prospectId, toStage, { byType, byId = null, closedReason = null }) {
  const { rows } = await client.query('SELECT stage FROM prospect WHERE id = $1 FOR UPDATE', [prospectId]);
  if (!rows.length) throw new HttpError(404, 'Prospect not found.');
  const fromStage = rows[0].stage;

  if (!TRANSITIONS[fromStage]?.includes(toStage)) {
    throw new HttpError(409, `A record in "${fromStage}" cannot move to "${toStage}".`);
  }
  if (toStage === 'Closed' && !closedReason) {
    throw new HttpError(422, 'A reason is required to close a record.');
  }
  const reason = toStage === 'Closed' ? closedReason : null;

  await client.query('UPDATE prospect SET stage = $2, closed_reason = $3 WHERE id = $1', [prospectId, toStage, reason]);
  await client.query(
    `INSERT INTO stage_history (prospect_id, from_stage, to_stage, closed_reason, changed_by_type, changed_by_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [prospectId, fromStage, toStage, reason, byType, byId],
  );
  await audit(client, {
    prospectId,
    actorType: byType,
    actorId: byId,
    action: 'Stage changed',
    detail: { from: fromStage, to: toStage, closed_reason: reason },
  });
  return { fromStage, toStage };
}

/** Add working days (Mon to Fri) to now. */
export function dueInWorkingDays(days, from = new Date()) {
  const due = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    const day = due.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return due;
}

export async function createTask(client, { prospectId, staffId, type, workingDays }) {
  await client.query(
    `INSERT INTO task (prospect_id, assigned_staff_id, type, due_at) VALUES ($1, $2, $3, $4)`,
    [prospectId, staffId, type, dueInWorkingDays(workingDays)],
  );
}

/** Mark a prospect's open tasks as done (all of them, or only the given types). */
export async function completeTasks(client, prospectId, types = null) {
  await client.query(
    `UPDATE task SET status = 'Done', completed_at = now()
     WHERE prospect_id = $1 AND status = 'Open' AND ($2::text[] IS NULL OR type = ANY($2))`,
    [prospectId, types],
  );
}

/**
 * Close a record: stage to Closed with a reason, any live application is
 * marked Withdrawn (a Rejected one keeps its status), and open tasks are cleared.
 */
export async function closeProspect(client, prospectId, closedReason, by) {
  await changeStage(client, prospectId, 'Closed', { ...by, closedReason });
  await client.query(
    `UPDATE application SET status = 'Withdrawn' WHERE prospect_id = $1 AND status NOT IN ('Rejected', 'Withdrawn')`,
    [prospectId],
  );
  await completeTasks(client, prospectId);
}

/** Create a task unless an open one of the same type already exists. */
export async function ensureTask(client, { prospectId, staffId, type, workingDays }) {
  const { rows } = await client.query(
    `SELECT 1 FROM task WHERE prospect_id = $1 AND type = $2 AND status = 'Open'`, [prospectId, type]);
  if (!rows.length) await createTask(client, { prospectId, staffId, type, workingDays });
}
