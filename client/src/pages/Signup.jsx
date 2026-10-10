// Step 3a: create an account from the emailed link.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, session } from '../api.js';
import { Field, Notice, PublicShell } from '../ui.jsx';

export default function Signup() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [expired, setExpired] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resent, setResent] = useState('');

  useEffect(() => {
    api(`/signup/${token}`).then(setInvite).catch((err) => setExpired(err.message));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirm) return setErrors({ confirm: 'The two passwords do not match.' });
    setBusy(true);
    try {
      const res = await api('/signup', { method: 'POST', body: { token, password } });
      session.set('student', res);
      navigate('/portal');
    } catch (err) {
      if (err.status === 410) setExpired(err.message);
      else setErrors(Object.keys(err.errors).length ? err.errors : { password: err.message });
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const resend = async (event) => {
    event.preventDefault();
    const res = await api('/signup/resend', { method: 'POST', body: { email: resendEmail } }).catch((err) => err);
    setResent(res.message);
  };

  if (expired) {
    return (
      <PublicShell narrow>
        <div className="card">
          <h1>Link expired</h1>
          <p>{expired}</p>
          {resent ? <Notice>{resent}</Notice> : (
            <form onSubmit={resend}>
              <Field label="Your email" name="resend">
                <input id="resend" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} required />
              </Field>
              <button type="submit">Email me a new link</button>
            </form>
          )}
        </div>
      </PublicShell>
    );
  }
  if (!invite) return <PublicShell narrow><p className="muted">Checking your link…</p></PublicShell>;

  return (
    <PublicShell narrow>
      <h1>Create your account</h1>
      <p className="lead">Hi {invite.full_name}. Set a password to continue your enquiry.</p>
      <form className="card" onSubmit={submit} noValidate>
        <Field label="Email" name="email">
          <input id="email" value={invite.email} readOnly />
        </Field>
        <Field label="Password" name="password" required error={errors.password} hint="At least 10 characters">
          <input id="password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}); }} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" name="confirm" required error={errors.confirm}>
          <input id="confirm" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors({}); }} autoComplete="new-password" />
        </Field>
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </PublicShell>
  );
}
