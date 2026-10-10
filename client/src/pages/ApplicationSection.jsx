// Student portal, steps 5 to 7: application form and documents, offer, enrolment.
import { useEffect, useState } from 'react';
import { api, downloadDocument, formatDate, formatSize, uploadDocument } from '../api.js';
import { Field, Notice } from '../ui.jsx';

const FIELDS = ['date_of_birth', 'nationality', 'emergency_contact_name', 'emergency_contact_phone', 'study_mode', 'intake_id'];
const DOC_BADGE = { Pending: ['amber', 'Being checked'], Verified: ['green', 'Verified'], Rejected: ['red', 'Needs replacing'] };

function DocumentRow({ item, canUpload, drafting, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const doc = item.document;
  const inputId = `file-${item.document_type.replace(/\W+/g, '-')}`;

  const choose = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setFailure('');
    try {
      await uploadDocument(item.document_type, file);
      await onUploaded();
    } catch (err) {
      setFailure(err.message);
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
            <button type="button" className="link" onClick={() => downloadDocument(doc.id, 'student', doc.file_name).catch((err) => setFailure(err.message))}>{doc.file_name}</button>
            {' '}· {formatSize(doc.size_bytes)}
          </div>
        ) : <div className="muted small">Not uploaded yet</div>}
        {doc?.status === 'Rejected' && <p className="error">{doc.rejection_reason}</p>}
        {failure && <p className="error" role="alert">{failure}</p>}
      </div>
      <div className="doc-side">
        {doc && !drafting && <span className={`badge ${DOC_BADGE[doc.status][0]}`}>{DOC_BADGE[doc.status][1]}</span>}
        {doc && drafting && <span className="badge green">Uploaded</span>}
        {canUpload && (
          <>
            <label htmlFor={inputId} className={`button secondary${busy ? ' disabled' : ''}`}>{busy ? 'Uploading…' : doc ? 'Replace' : 'Upload'}</label>
            <input id={inputId} className="visually-hidden" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={choose} disabled={busy}
              aria-label={`${doc ? 'Replace' : 'Upload'} ${item.document_type}`} />
          </>
        )}
      </div>
    </div>
  );
}

export default function ApplicationSection({ stage, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async ({ keepForm = false } = {}) => {
    const res = await api('/student/application', { kind: 'student' });
    setData(res);
    if (!keepForm && res.application) setForm(Object.fromEntries(FIELDS.map((f) => [f, res.application[f] ?? ''])));
  };
  useEffect(() => { load().catch((err) => setNotice({ kind: 'error', text: err.message })); }, [stage]);

  const set = (name) => (event) => {
    setForm((f) => ({ ...f, [name]: event.target.value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const act = async (path, { body, method = 'POST', after } = {}) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api(path, { method, body, kind: 'student' });
      if (after) setNotice({ kind: 'info', text: res.message });
      else await onChanged();
    } catch (err) {
      setErrors(err.errors);
      setNotice({ kind: 'error', text: err.errors.documents || err.message });
      if (err.status === 409) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!data?.application) return notice ? <Notice kind="error">{notice.text}</Notice> : <p className="muted">Loading…</p>;
  const { application, checklist, intakes, study_modes: studyModes, offer_letter: letter, enrolment } = data;
  const drafting = stage === 'Qualified' && application.status === 'Draft';
  const documents = (
    <div className="docs">
      {checklist.map((item) => (
        <DocumentRow key={item.document_type} item={item} drafting={drafting}
          canUpload={drafting || (stage === 'Application' && item.document?.status === 'Rejected')}
          onUploaded={() => load({ keepForm: true })} />
      ))}
    </div>
  );
  const letterButton = letter && (
    <button type="button" className="secondary" onClick={() => downloadDocument(letter.id, 'student', letter.file_name).catch((err) => setNotice({ kind: 'error', text: err.message }))}>
      Download offer letter (PDF)
    </button>
  );

  if (stage === 'Enrolled') {
    return (
      <div className="card center">
        <h2>You are enrolled</h2>
        <p className="muted">{application.intake_name} intake{enrolment && `, confirmed ${formatDate(enrolment.enrolment_date)}`}. Welcome to RIC.</p>
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {letterButton}
      </div>
    );
  }

  if (stage === 'Offer') {
    return (
      <div className="card center">
        <h2>You have an offer</h2>
        <p className="muted">
          {application.intake_name} intake, {application.study_mode?.toLowerCase()}.{' '}
          {application.offer_expired ? 'This offer has expired. Please contact us.' : `Accept by ${formatDate(application.offer_expires_at)}.`}
        </p>
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        <div className="row centered wrap">
          {letterButton}
          {!application.offer_expired && <button type="button" disabled={busy} onClick={() => act('/student/offer/accept')}>Accept offer</button>}
          <button type="button" className="danger" disabled={busy}
            onClick={() => window.confirm('Decline this offer? This closes your application.') && act('/student/offer/decline')}>Decline</button>
        </div>
      </div>
    );
  }

  if (stage === 'Application') {
    const needsAction = checklist.some((c) => c.document?.status === 'Rejected');
    return (
      <div className="card">
        <h2>{needsAction ? 'We need a document from you again' : 'We are checking your documents'}</h2>
        <p className="muted">
          {needsAction ? 'Upload a new copy of the document marked below and we will continue.' : `Submitted ${formatDate(application.submitted_date)}. This usually takes up to 3 working days.`}
        </p>
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {documents}
      </div>
    );
  }

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); act('/student/application/submit', { body: form }); }} noValidate>
      <h2>Your application</h2>
      <p className="muted">You meet the entry requirements. Complete your details and upload your documents to apply.</p>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <h3>Enrolment details</h3>
      <div className="grid2">
        <Field label="Date of birth" name="date_of_birth" required error={errors.date_of_birth}>
          <input id="date_of_birth" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} autoComplete="bday" />
        </Field>
        <Field label="Nationality" name="nationality" required error={errors.nationality}>
          <input id="nationality" value={form.nationality} onChange={set('nationality')} />
        </Field>
        <Field label="Emergency contact name" name="emergency_contact_name" required error={errors.emergency_contact_name}>
          <input id="emergency_contact_name" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
        </Field>
        <Field label="Emergency contact phone" name="emergency_contact_phone" required error={errors.emergency_contact_phone}>
          <input id="emergency_contact_phone" type="tel" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
        </Field>
        <Field label="Intake" name="intake_id" required error={errors.intake_id}>
          <select id="intake_id" value={form.intake_id} onChange={set('intake_id')}>
            <option value="">Select</option>
            {intakes.map((i) => <option key={i.id} value={i.id}>{i.name} (starts {formatDate(i.start_date)})</option>)}
          </select>
        </Field>
        <Field label="Study mode" name="study_mode" required error={errors.study_mode}>
          <select id="study_mode" value={form.study_mode} onChange={set('study_mode')}>
            <option value="">Select</option>
            {studyModes.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <h3>Documents</h3>
      <p className="muted small">PDF, JPG or PNG, up to 10 MB each.</p>
      {documents}

      <div className="row">
        <button type="submit" disabled={busy}>Submit application</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => act('/student/application', { method: 'PUT', body: form, after: true })}>Save draft</button>
      </div>
    </form>
  );
}
