// Every automatic email. In development (no mail server) the full message is
// shown so you can copy the sign-up link and demonstrate the flow.
import { useEffect, useState } from 'react';
import { api, formatDateTime } from '../api.js';
import { Notice, StaffShell } from '../ui.jsx';

export default function EmailLog() {
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState('');
  useEffect(() => { api('/staff/emails', { kind: 'staff' }).then(setData).catch((err) => setFailure(err.message)); }, []);

  return (
    <StaffShell>
      <h1>Email log</h1>
      {failure && <Notice kind="error">{failure}</Notice>}
      {data?.dev_mode && <Notice kind="warn">Development mode: no mail server is configured, so emails are recorded here and not sent.</Notice>}
      {data && data.emails.length === 0 && <p className="muted">No emails yet.</p>}
      {data?.emails.map((e) => (
        <details key={e.id} className="card email">
          <summary>
            <span><strong>{e.template}</strong> to {e.to_email}</span>
            <span className="muted small">{formatDateTime(e.sent_at)} · {e.status}</span>
          </summary>
          <p><strong>{e.subject}</strong></p>
          {e.body && <pre>{e.body}</pre>}
        </details>
      ))}
    </StaffShell>
  );
}
