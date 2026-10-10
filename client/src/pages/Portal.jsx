// Student portal: progress, and the qualification form (step 3b).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatDate, session } from '../api.js';
import { Field, Notice, PublicShell } from '../ui.jsx';
import ApplicationSection from './ApplicationSection.jsx';

const STEPS = ['Enquiry', 'Qualification review', 'Qualified', 'Application', 'Offer', 'Enrolled'];
const STEP_LABELS = { 'Qualification review': 'Review' };
const FIELDS = ['highest_qualification', 'institution', 'year_completed', 'result', 'language_test_type', 'language_score', 'test_date', 'intake_id'];

const STATUS_TEXT = {
  'Qualification review': ['We are reviewing your details', 'A member of our team will be in touch within 2 working days.'],
  'Closed': ['Your enquiry is closed', 'If your circumstances change, you are welcome to send a new enquiry.'],
};
const CLOSED_TEXT = {
  'Not eligible': 'You do not meet the entry requirements for this program at the moment.',
  'Application rejected': 'We were unable to offer you a place this time.',
  'Offer declined': 'You declined your offer.',
  'Offer lapsed': 'Your offer was not accepted before its deadline.',
  'Withdrawn': 'You withdrew your enquiry.',
  'No response': 'We closed it because we had not heard from you.',
};
const APPLICATION_STAGES = ['Qualified', 'Application', 'Offer', 'Enrolled'];

export default function Portal() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api('/student/me', { kind: 'student' }).then((res) => {
    setData(res);
    setForm(Object.fromEntries(FIELDS.map((f) => [f, res.qualification?.[f] ?? ''])));
  }).catch((err) => setNotice({ kind: 'error', text: err.message }));
  useEffect(() => { load(); }, []);

  const set = (name) => (event) => {
    setForm((f) => ({ ...f, [name]: event.target.value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const logout = () => { session.clear('student'); navigate('/'); };
  const withdraw = async () => {
    if (!window.confirm('Withdraw your enquiry? This closes it and cannot be undone.')) return;
    try {
      await api('/student/withdraw', { method: 'POST', kind: 'student' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    await load();
  };

  const send = async (submit) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api(submit ? '/student/qualification/submit' : '/student/qualification', {
        method: submit ? 'POST' : 'PUT', body: form, kind: 'student',
      });
      if (submit) await load();
      else setNotice({ kind: 'info', text: res.message });
    } catch (err) {
      setErrors(err.errors);
      setNotice({ kind: 'error', text: err.message });
      if (err.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <PublicShell narrow>{notice ? <Notice kind="error">{notice.text}</Notice> : <p className="muted">Loading…</p>}</PublicShell>;

  const { prospect, program, intakes, options } = data;
  const closed = prospect.stage === 'Closed';
  const current = STEPS.indexOf(prospect.stage);
  const noTest = form.language_test_type === 'None taken';
  const range = options.language_ranges[form.language_test_type];
  const status = STATUS_TEXT[prospect.stage];

  return (
    <PublicShell narrow>
      <div className="row between">
        <h1>Hi {prospect.full_name.split(' ')[0]}</h1>
        <button type="button" className="link" onClick={logout}>Log out</button>
      </div>
      <p className="lead">{program.name}</p>

      {!closed && (
        <ol className="steps" aria-label="Your progress">
          {STEPS.map((step, i) => (
            <li key={step} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
              <span className="dot">{i < current ? '✓' : i + 1}</span>
              <span className="label">{STEP_LABELS[step] || step}</span>
            </li>
          ))}
        </ol>
      )}

      {status && (
        <div className="card center">
          <h2>{status[0]}</h2>
          <p className="muted">{closed && CLOSED_TEXT[prospect.closed_reason] ? `${CLOSED_TEXT[prospect.closed_reason]} ` : ''}{status[1]}</p>
        </div>
      )}

      {APPLICATION_STAGES.includes(prospect.stage) && <ApplicationSection stage={prospect.stage} onChanged={load} />}

      {prospect.stage === 'Enquiry' && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); send(true); }} noValidate>
          <h2>Your academic and language details</h2>
          <p className="muted">We use these to check the entry requirements for your program. You can save and come back later.</p>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

          <h3>Academic</h3>
          <Field label="Highest qualification" name="highest_qualification" required error={errors.highest_qualification}>
            <select id="highest_qualification" value={form.highest_qualification} onChange={set('highest_qualification')}>
              <option value="">Select</option>
              {options.qualifications.map((q) => <option key={q}>{q}</option>)}
            </select>
          </Field>
          <Field label="Institution" name="institution" required error={errors.institution}>
            <input id="institution" value={form.institution} onChange={set('institution')} />
          </Field>
          <div className="grid2">
            <Field label="Year completed" name="year_completed" required error={errors.year_completed}>
              <input id="year_completed" type="number" inputMode="numeric" value={form.year_completed} onChange={set('year_completed')} />
            </Field>
            <Field label="Result or grade" name="result" error={errors.result} hint="Optional">
              <input id="result" value={form.result} onChange={set('result')} />
            </Field>
          </div>

          <h3>English language</h3>
          <Field label="Language test" name="language_test_type" required error={errors.language_test_type}>
            <select id="language_test_type" value={form.language_test_type} onChange={set('language_test_type')}>
              <option value="">Select</option>
              {options.language_tests.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          {!noTest && (
            <div className="grid2">
              <Field label="Overall score" name="language_score" required error={errors.language_score} hint={range ? `${range.min} to ${range.max}` : undefined}>
                <input id="language_score" type="number" step="0.5" inputMode="decimal" value={form.language_score} onChange={set('language_score')} />
              </Field>
              <Field label="Test date" name="test_date" required error={errors.test_date}>
                <input id="test_date" type="date" value={form.test_date} onChange={set('test_date')} />
              </Field>
            </div>
          )}

          <h3>Study plans</h3>
          <Field label="Preferred intake" name="intake_id" required error={errors.intake_id}>
            <select id="intake_id" value={form.intake_id} onChange={set('intake_id')}>
              <option value="">Select</option>
              {intakes.map((i) => <option key={i.id} value={i.id}>{i.name} (starts {formatDate(i.start_date)})</option>)}
            </select>
          </Field>

          <div className="row">
            <button type="submit" disabled={busy}>Submit details</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => send(false)}>Save draft</button>
          </div>
        </form>
      )}

      {!closed && prospect.stage !== 'Enrolled' && (
        <p className="muted small center-text">
          Changed your mind? <button type="button" className="link" onClick={withdraw}>Withdraw my enquiry</button>
        </p>
      )}
    </PublicShell>
  );
}
