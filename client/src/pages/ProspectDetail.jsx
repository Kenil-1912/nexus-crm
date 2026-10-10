// One prospect: details, enquiries, qualification with the criteria result,
// the approve/reject decision (step 4), tasks and stage history.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDate, formatDateTime, session } from '../api.js';
import { Field, Notice, StaffShell, StageBadge } from '../ui.jsx';

const LEVELS = ['', 'Year 12 or equivalent', 'Certificate', 'Diploma', "Bachelor's degree", "Master's degree or higher"];
const RESULT_CLASS = { Pass: 'green', Review: 'amber', Fail: 'red' };

export default function ProspectDetail() {
  const { id } = useParams();
  const canDecide = session.get('staff')?.role === 'recruiter';
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState('');
  const [noteError, setNoteError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/staff/prospects/${id}`, { kind: 'staff' }).then(setData).catch((err) => setFailure(err.message));
  useEffect(() => { load(); }, [id]);

  const decide = async (decision) => {
    setBusy(true);
    setFailure('');
    setNoteError('');
    try {
      await api(`/staff/prospects/${id}/qualification-decision`, { method: 'POST', body: { decision, note }, kind: 'staff' });
      setNote('');
    } catch (err) {
      if (err.errors.note) setNoteError(err.errors.note);
      else setFailure(err.message);
    } finally {
      await load();
      setBusy(false);
    }
  };

  if (!data) return <StaffShell>{failure ? <Notice kind="error">{failure}</Notice> : <p className="muted">Loading…</p>}</StaffShell>;
  const { prospect, enquiries, qualification: q, history, tasks } = data;
  const awaiting = prospect.stage === 'Qualification review';

  return (
    <StaffShell>
      <p><Link to="/staff">← Dashboard</Link></p>
      <div className="row between wrap">
        <h1>{prospect.full_name}</h1>
        <div><StageBadge stage={prospect.stage} /> {prospect.closed_reason && <span className="muted">{prospect.closed_reason}</span>}</div>
      </div>
      {failure && <Notice kind="error">{failure}</Notice>}
      {prospect.possible_duplicate_of && (
        <Notice kind="warn">Same phone number as <Link to={`/staff/prospects/${prospect.possible_duplicate_of}`}>another prospect</Link>. Check whether this is the same person.</Notice>
      )}

      <div className="columns">
        <section className="card">
          <h2>Contact</h2>
          <dl>
            <dt>Email</dt><dd>{prospect.email}</dd>
            <dt>Phone</dt><dd>{prospect.phone}</dd>
            <dt>Address</dt><dd>{prospect.address || 'Not given'}</dd>
            <dt>Assigned to</dt><dd>{prospect.assigned_staff || 'Unassigned'}</dd>
            <dt>Portal account</dt><dd>{prospect.has_account ? 'Created' : 'Not yet created'}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Enquiries</h2>
          {enquiries.map((e) => (
            <div key={e.id} className="item">
              <strong>{e.program}</strong>
              <div className="muted small">{formatDateTime(e.enquiry_date)} · {e.source}</div>
              {e.message && <p>{e.message}</p>}
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <h2>Qualification</h2>
        {!q?.submitted_at ? <p className="muted">The student has not submitted their academic and language details yet.</p> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Criterion</th><th>Student</th><th>{q.program} requires</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Highest qualification</td>
                    <td>{q.highest_qualification}<div className="muted small">{q.institution}, {q.year_completed}{q.result ? `, ${q.result}` : ''}</div></td>
                    <td>{LEVELS[q.min_qualification_level] || 'Not configured'}</td>
                  </tr>
                  <tr>
                    <td>English language</td>
                    <td>{q.language_test_type}{q.language_score != null && ` ${Number(q.language_score)}`}{q.test_date && <div className="muted small">Tested {formatDate(q.test_date)}</div>}</td>
                    <td>{q.language_requirements ? Object.entries(q.language_requirements).map(([t, s]) => `${t} ${s}`).join(', ') : 'Not configured'}</td>
                  </tr>
                  <tr><td>Preferred intake</td><td>{q.intake}</td><td /></tr>
                </tbody>
              </table>
            </div>
            <p>
              Automatic check: <span className={`badge ${RESULT_CLASS[q.auto_result]}`}>{q.auto_result}</span>
            </p>
            <ul className="reasons">{(q.auto_reasons || []).map((r) => <li key={r}>{r}</li>)}</ul>
            {q.decision && (
              <p>
                <strong>{q.decision}</strong> by {q.reviewed_by_name} on {formatDateTime(q.decided_at)}
                {q.review_note && <>: “{q.review_note}”</>}
              </p>
            )}
            {awaiting && canDecide && (
              <div className="decision">
                <Field label="Note" name="note" error={noteError} hint="Required when rejecting">
                  <textarea id="note" rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="row">
                  <button type="button" disabled={busy} onClick={() => decide('approve')}>Approve as qualified</button>
                  <button type="button" className="danger" disabled={busy} onClick={() => decide('reject')}>Reject as not eligible</button>
                </div>
              </div>
            )}
            {awaiting && !canDecide && <p className="muted">Waiting for a recruiter's decision. Your role is read-only.</p>}
          </>
        )}
      </section>

      <div className="columns">
        <section className="card">
          <h2>Tasks</h2>
          {tasks.length === 0 ? <p className="muted">No tasks.</p> : tasks.map((t) => (
            <div key={t.id} className="item">
              <strong>{t.type}</strong> <span className={`badge ${t.status === 'Done' ? 'green' : t.overdue ? 'red' : 'blue'}`}>{t.status === 'Done' ? 'Done' : t.overdue ? 'Overdue' : 'Open'}</span>
              <div className="muted small">Due {formatDate(t.due_at)}</div>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Stage history</h2>
          {history.map((h) => (
            <div key={h.changed_at + h.to_stage} className="item">
              <strong>{h.from_stage ? `${h.from_stage} → ${h.to_stage}` : `Created in ${h.to_stage}`}</strong>
              {h.closed_reason && <span className="muted"> ({h.closed_reason})</span>}
              <div className="muted small">{formatDateTime(h.changed_at)} · {h.staff_name || h.changed_by_type}</div>
            </div>
          ))}
        </section>
      </div>
    </StaffShell>
  );
}
