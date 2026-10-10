// Shared building blocks: form field with inline error, stage badge, page shells.
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { session } from './api.js';

export function Field({ label, name, error, required, hint, children }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={name}>
        {label} {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

const STAGE_CLASS = {
  'Enquiry': 'blue', 'Qualification review': 'amber', 'Qualified': 'green',
  'Application': 'purple', 'Offer': 'purple', 'Enrolled': 'green', 'Closed': 'grey',
};
export const StageBadge = ({ stage }) => <span className={`badge ${STAGE_CLASS[stage] || 'grey'}`}>{stage}</span>;

export function Notice({ kind = 'info', children }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function PublicShell({ children, narrow }) {
  const student = session.get('student');
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">RIC <span>Nexus</span></Link>
        <nav>
          {student ? <Link to="/portal">My portal</Link> : <Link to="/login">Student login</Link>}
          <Link to="/staff">Staff</Link>
        </nav>
      </header>
      <main className={narrow ? 'page narrow' : 'page'}>{children}</main>
    </>
  );
}

export function StaffShell({ children }) {
  const staff = session.get('staff');
  const navigate = useNavigate();
  const logout = () => { session.clear('staff'); navigate('/staff/login'); };
  return (
    <>
      <header className="topbar staff">
        <Link to="/staff" className="brand">RIC <span>Nexus CRM</span></Link>
        <nav>
          <NavLink to="/staff" end>Dashboard</NavLink>
          <NavLink to="/staff/emails">Email log</NavLink>
          <span className="who">{staff?.full_name} ({staff?.role})</span>
          <button type="button" className="link" onClick={logout}>Log out</button>
        </nav>
      </header>
      <main className="page wide">{children}</main>
    </>
  );
}
