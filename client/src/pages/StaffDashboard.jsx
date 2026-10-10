// Staff dashboard: pipeline counts, open tasks, and the prospect list.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Notice, StaffShell, StageBadge } from '../ui.jsx';

export default function StaffDashboard() {
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [prospects, setProspects] = useState(null);
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    Promise.all([api('/staff/summary', { kind: 'staff' }), api('/staff/tasks', { kind: 'staff' })])
      .then(([s, t]) => { setSummary(s); setTasks(t); })
      .catch((err) => setFailure(err.message));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (stage) params.set('stage', stage);
      if (search.trim()) params.set('q', search.trim());
      api(`/staff/prospects?${params}`, { kind: 'staff' }).then(setProspects).catch((err) => setFailure(err.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [stage, search]);

  return (
    <StaffShell>
      <h1>Dashboard</h1>
      {failure && <Notice kind="error">{failure}</Notice>}

      <section className="tiles" aria-label="Prospects by stage">
        {summary?.stages.map((s) => (
          <button type="button" key={s.stage} className={`tile${stage === s.stage ? ' active' : ''}`}
            onClick={() => setStage(stage === s.stage ? '' : s.stage)} aria-pressed={stage === s.stage}>
            <span className="count">{s.count}</span>
            <span className="name">{s.stage}</span>
          </button>
        ))}
      </section>

      <section className="card">
        <h2>Open tasks <span className="muted">({tasks.length})</span></h2>
        {tasks.length === 0 ? <p className="muted">Nothing waiting for you.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Task</th><th>Prospect</th><th>Assigned to</th><th>Due</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.type}</td>
                    <td><Link to={`/staff/prospects/${t.prospect_id}`}>{t.prospect}</Link></td>
                    <td>{t.assigned_staff || 'Unassigned'}</td>
                    <td>{formatDate(t.due_at)} {t.overdue && <span className="badge red">Overdue</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row between wrap">
          <h2>Prospects {stage && <StageBadge stage={stage} />}</h2>
          <input className="search" type="search" placeholder="Search name or email" aria-label="Search prospects"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {prospects === null ? <p className="muted">Loading…</p> : prospects.length === 0 ? <p className="muted">No prospects match.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Program</th><th>Stage</th><th>Assigned to</th><th>Created</th></tr></thead>
              <tbody>
                {prospects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/staff/prospects/${p.id}`}>{p.full_name}</Link>
                      {p.possible_duplicate && <span className="badge amber">Possible duplicate</span>}
                      <div className="muted small">{p.email}</div>
                    </td>
                    <td>{p.program}</td>
                    <td><StageBadge stage={p.stage} />{p.closed_reason && <div className="muted small">{p.closed_reason}</div>}</td>
                    <td>{p.assigned_staff || 'Unassigned'}</td>
                    <td>{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StaffShell>
  );
}
