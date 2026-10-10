// Login for students and staff (same form, different endpoint and destination).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session } from '../api.js';
import { Field, Notice, PublicShell } from '../ui.jsx';

export default function Login({ kind }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const isStaff = kind === 'staff';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const res = await api(`/auth/${kind}/login`, { method: 'POST', body: { email, password } });
      session.set(kind, res);
      navigate(isStaff ? '/staff' : '/portal');
    } catch (err) {
      setFailure(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell narrow>
      <h1>{isStaff ? 'Staff login' : 'Student login'}</h1>
      <form className="card" onSubmit={submit}>
        {failure && <Notice kind="error">{failure}</Notice>}
        <Field label="Email" name="email">
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password" name="password">
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        {!isStaff && <p className="muted small">No account yet? <Link to="/">Send an enquiry</Link> to create one.</p>}
      </form>
    </PublicShell>
  );
}
