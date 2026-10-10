// Step 1: public enquiry form.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Notice, PublicShell } from '../ui.jsx';

const EMPTY = { full_name: '', email: '', phone: '', address: '', program_id: '', message: '', consent: false };

export default function Enquiry() {
  const [programs, setPrograms] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    api('/programs').then(setPrograms).catch((err) => setFailure(err.message));
  }, []);

  const set = (name) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const res = await api('/enquiries', { method: 'POST', body: form });
      setDone(res.message);
    } catch (err) {
      setErrors(err.errors);
      setFailure(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicShell narrow>
        <div className="card center">
          <h1>Thank you</h1>
          <p>{done}</p>
          <p className="muted">Check your inbox for the brochure and a link to create your account.</p>
          <button type="button" className="secondary" onClick={() => { setForm(EMPTY); setDone(''); }}>Send another enquiry</button>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell narrow>
      <h1>Enquire about a program</h1>
      <p className="lead">Tell us what you are interested in and we will email you the course brochure and next steps.</p>
      <form className="card" onSubmit={submit} noValidate>
        {failure && <Notice kind="error">{failure}</Notice>}
        <Field label="Full name" name="full_name" required error={errors.full_name}>
          <input id="full_name" value={form.full_name} onChange={set('full_name')} autoComplete="name" />
        </Field>
        <div className="grid2">
          <Field label="Email" name="email" required error={errors.email}>
            <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field label="Phone" name="phone" required error={errors.phone}>
            <input id="phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
          </Field>
        </div>
        <Field label="Address" name="address" error={errors.address}>
          <input id="address" value={form.address} onChange={set('address')} autoComplete="street-address" />
        </Field>
        <Field label="Program" name="program_id" required error={errors.program_id}>
          <select id="program_id" value={form.program_id} onChange={set('program_id')}>
            <option value="">Select a program</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Message" name="message" error={errors.message} hint="Optional">
          <textarea id="message" rows="4" value={form.message} onChange={set('message')} />
        </Field>
        <div className={`field check${errors.consent ? ' has-error' : ''}`}>
          <label>
            <input type="checkbox" checked={form.consent} onChange={set('consent')} />
            <span>I agree to RIC contacting me about my enquiry and storing my details for that purpose.</span>
          </label>
          {errors.consent && <p className="error" role="alert">{errors.consent}</p>}
        </div>
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
      </form>
    </PublicShell>
  );
}
