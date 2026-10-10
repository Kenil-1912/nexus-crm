// Staff view of an application: details, document review, decision, offer and enrolment.
import { useState } from 'react';
import { api, downloadDocument, formatDate, formatDateTime, formatSize } from '../api.js';
import { Field, Notice } from '../ui.jsx';

const STATUS_BADGE = { Draft: 'grey', Submitted: 'blue', 'Under review': 'amber', Accepted: 'green', Rejected: 'red', Withdrawn: 'grey' };
const DOC_BADGE = { Pending: 'amber', Verified: 'green', Rejected: 'red' };

function DocumentReview({ item, canReview, onDone, onError }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const doc = item.document;
  const reasonId = `reason-${doc?.id}`;

  const review = async (status) => {
    setBusy(true);
    setReasonError('');
    try {
      await api(`/staff/documents/${doc.id}/review`, { method: 'POST', body: { status, reason }, kind: 'staff' });
      setRejecting(false);
      setReason('');
      await onDone();
    } catch (err) {
      if (err.errors.reason) setReasonError(err.errors.reason);
      else { onError(err.message); await onDone(); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc">
      <div className="doc-main">
        <strong>{item.document_type}</strong> {!item.required && <span className="muted small">(optional)</span>}
        {doc ? (
          <div className="muted small">
            <button type="button" className="link" onClick={() => downloadDocument(doc.id, 'staff', doc.file_name).catch((err) => onError(err.message))}>{doc.file_name}</button>
            {' '}· {formatSize(doc.size_bytes)} · uploaded {formatDateTime(doc.uploaded_at)}
          </div>
        ) : <div className="muted small">Not uploaded</div>}
        {doc?.status !== 'Pending' && doc?.verified_by_name && (
          <div className="muted small">{doc.status} by {doc.verified_by_name}, {formatDateTime(doc.verified_at)}{doc.rejection_reason && `: “${doc.rejection_reason}”`}</div>
        )}
        {rejecting && (
          <div className="reject-box">
            <Field label="Reason shown to the student" name={reasonId} error={reasonError}>
              <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: page 2 is cut off" />
            </Field>
            <div className="row">
              <button type="button" className="danger" disabled={busy} onClick={() => review('rejected')}>Confirm rejection</button>
              <button type="button" className="link" onClick={() => { setRejecting(false); setReasonError(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="doc-side">
        {doc && <span className={`badge ${DOC_BADGE[doc.status]}`}>{doc.status}</span>}
        {canReview && doc?.status === 'Pending' && !rejecting && (
          <>
            <button type="button" disabled={busy} onClick={() => review('verified')} aria-label={`Verify ${item.document_type}`}>Verify</button>
            <button type="button" className="danger" disabled={busy} onClick={() => setRejecting(true)} aria-label={`Reject ${item.document_type}`}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StaffApplication({ prospect, application: a, canDecide, onChanged }) {
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const inReview = prospect.stage === 'Application';

  const decide = async (decision) => {
    if (decision === 'reject' && !window.confirm('Reject this application? This closes the record and emails the student.')) return;
    setBusy(true);
    setFailure('');
    setNoteError('');
    try {
      await api(`/staff/prospects/${prospect.id}/application-decision`, { method: 'POST', body: { decision, note }, kind: 'staff' });
      setNote('');
    } catch (err) {
      if (err.errors.note) setNoteError(err.errors.note);
      else setFailure(err.message);
    } finally {
      await onChanged();
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="row between wrap">
        <h2>Application</h2>
        <span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
      </div>
      {failure && <Notice kind="error">{failure}</Notice>}

      {a.status === 'Draft' ? <p className="muted">The student has not submitted the application yet.</p> : (
        <dl className="wide">
          <dt>Program</dt><dd>{a.program}</dd>
          <dt>Intake</dt><dd>{a.intake || 'Not chosen'} · {a.study_mode}</dd>
          <dt>Date of birth</dt><dd>{formatDate(`${a.date_of_birth}T00:00:00`)}</dd>
          <dt>Nationality</dt><dd>{a.nationality}</dd>
          <dt>Emergency contact</dt><dd>{a.emergency_contact_name}, {a.emergency_contact_phone}</dd>
          <dt>Submitted</dt><dd>{formatDateTime(a.submitted_date)}</dd>
        </dl>
      )}

      <h3>Documents</h3>
      <div className="docs">
        {a.checklist.map((item) => (
          <DocumentReview key={item.document_type} item={item} canReview={inReview && canDecide} onDone={onChanged} onError={setFailure} />
        ))}
      </div>

      {a.decided_at && (
        <p>
          <strong>{a.status === 'Rejected' ? 'Rejected' : 'Accepted'}</strong> by {a.decision_by_name} on {formatDateTime(a.decided_at)}
          {a.decision_note && <>: “{a.decision_note}”</>}
        </p>
      )}
      {a.offer_letter && (
        <p>
          <button type="button" className="link" onClick={() => downloadDocument(a.offer_letter.id, 'staff', a.offer_letter.file_name).catch((err) => setFailure(err.message))}>Offer letter (PDF)</button>
          {a.enrolment ? ` · enrolled ${formatDateTime(a.enrolment.enrolment_date)}` : prospect.stage === 'Offer' ? ` · offer expires ${formatDate(a.offer_expires_at)}` : ''}
        </p>
      )}

      {inReview && canDecide && (
        <div className="decision">
          {!a.ready_for_decision && <p className="muted">An offer can be made once every required document is verified.</p>}
          <Field label="Note" name="app-note" error={noteError} hint="Required when rejecting">
            <textarea id="app-note" rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row wrap">
            <button type="button" disabled={busy || !a.ready_for_decision} onClick={() => decide('accept')}>Accept and issue offer</button>
            <button type="button" className="danger" disabled={busy} onClick={() => decide('reject')}>Reject application</button>
          </div>
        </div>
      )}
      {inReview && !canDecide && <p className="muted">Waiting for a recruiter. Your role is read-only.</p>}
    </section>
  );
}
