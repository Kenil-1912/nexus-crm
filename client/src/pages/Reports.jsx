// Pipeline report: how many prospects reach each stage, and where they are lost.
import { useEffect, useState } from 'react';
import { api, session } from '../api.js';
import { Notice, StaffShell } from '../ui.jsx';

export default function Reports() {
  const isManager = session.get('staff')?.role === 'manager';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState('');
  const [jobs, setJobs] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api(`/staff/reports?${params}`, { kind: 'staff' }).then(setData).catch((err) => setFailure(err.message));
  };
  useEffect(() => { load(); }, [from, to]);

  const runJobs = async () => {
    setBusy(true);
    setJobs('');
    try {
      const done = await api('/staff/jobs/run', { method: 'POST', kind: 'staff' });
      setJobs(`Done: ${done.reminders} reminder(s) sent, ${done.closed} record(s) closed, ${done.escalated} task(s) escalated.`);
      await load();
    } catch (err) {
      setFailure(err.message);
    } finally {
      setBusy(false);
    }
  };

  const top = data ? Math.max(1, ...data.funnel.map((f) => f.entered)) : 1;
  const rate = data?.total ? Math.round((data.enrolled / data.total) * 1000) / 10 : null;

  return (
    <StaffShell>
      <div className="row between wrap">
        <h1>Pipeline report</h1>
        <div className="row wrap filters">
          <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {(from || to) && <button type="button" className="link" onClick={() => { setFrom(''); setTo(''); }}>Clear</button>}
        </div>
      </div>
      <p className="lead">Prospects who first enquired {from || to ? 'in the chosen period' : 'at any time'}.</p>
      {failure && <Notice kind="error">{failure}</Notice>}
      {!data ? <p className="muted">Loading…</p> : data.total === 0 ? <Notice>No prospects in this period.</Notice> : (
        <>
          <section className="tiles static">
            <div className="tile"><span className="count">{data.total}</span><span className="name">Enquiries</span></div>
            <div className="tile"><span className="count">{data.enrolled}</span><span className="name">Enrolled</span></div>
            <div className="tile"><span className="count">{rate}%</span><span className="name">Enquiry to enrolment</span></div>
            <div className="tile"><span className="count">{data.funnel.reduce((sum, f) => sum + f.closed, 0)}</span><span className="name">Lost</span></div>
          </section>

          {data.biggest_leak && (
            <Notice kind="warn">
              <strong>Biggest leak: {data.biggest_leak}.</strong>{' '}
              Prospects lost from this stage: {data.funnel.find((f) => f.stage === data.biggest_leak).closed}, more than from any other.
            </Notice>
          )}

          <section className="card">
            <h2>Stage by stage</h2>
            <div className="table-wrap">
              <table className="funnel">
                <thead>
                  <tr><th>Stage</th><th className="bar-col">Reached</th><th className="num">Moved on</th><th className="num">Lost</th><th className="num">Still here</th><th className="num">Lost %</th><th className="num">Avg days</th></tr>
                </thead>
                <tbody>
                  {data.funnel.map((f) => (
                    <tr key={f.stage} className={f.stage === data.biggest_leak ? 'leak' : ''}>
                      <td>{f.stage}</td>
                      <td className="bar-col">
                        <div className="bar-row"><div className="bar" style={{ width: `${(f.entered / top) * 100}%` }} /><span>{f.entered}</span></div>
                      </td>
                      <td className="num">{f.stage === 'Enrolled' ? '' : f.moved_on}</td>
                      <td className="num">{f.stage === 'Enrolled' ? '' : f.closed}</td>
                      <td className="num">{f.still_here}</td>
                      <td className="num">{f.drop_off_rate == null || f.stage === 'Enrolled' ? '' : `${f.drop_off_rate}%`}</td>
                      <td className="num">{f.avg_days ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Reached counts each prospect once per stage. Avg days is the time spent in a stage before leaving it.</p>
          </section>

          <section className="card">
            <h2>Why prospects were lost</h2>
            {data.closed_reasons.length === 0 ? <p className="muted">Nobody has been lost in this period.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Lost from</th><th>Reason</th><th className="num">Prospects</th></tr></thead>
                  <tbody>
                    {data.closed_reasons.map((r) => <tr key={r.stage + r.reason}><td>{r.stage}</td><td>{r.reason}</td><td className="num">{r.count}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {isManager && (
        <section className="card">
          <h2>Reminders and automatic closing</h2>
          <p className="muted">These checks run by themselves every 6 hours. Run them now to send due reminders, lapse expired offers and close records with no response.</p>
          {jobs && <Notice>{jobs}</Notice>}
          <button type="button" className="secondary" disabled={busy} onClick={runJobs}>{busy ? 'Running…' : 'Run checks now'}</button>
        </section>
      )}
    </StaffShell>
  );
}
