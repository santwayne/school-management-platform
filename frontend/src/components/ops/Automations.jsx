import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { Light, timeAgo, formatDateTime, ErrorBanner, PageTitle } from './opsUi';

function describeInterval(min) {
  if (!min) return 'Runs when triggered';
  if (min < 60) return `Every ${min} min`;
  if (min < 1440) return `Every ${Math.round(min / 60)} h`;
  if (min === 1440) return 'Daily';
  if (min === 10080) return 'Weekly';
  return `Every ${Math.round(min / 1440)} days`;
}

export function AutomationsList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest('/api/ops/overview').then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <PageTitle title="Automations" subtitle="Everything that runs by itself. Open one to see its recent runs." />
      <ErrorBanner message={error} />
      {data && (
        <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr className="border-b border-cream-deep/60">
                <th className="px-5 py-3 font-medium">Automation</th>
                <th className="px-5 py-3 font-medium">Schedule</th>
                <th className="px-5 py-3 font-medium">Last run</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.automations.map((a) => (
                <tr key={a.automation_key} className="border-b border-cream-deep/40 last:border-0 hover:bg-cream/50">
                  <td className="px-5 py-3">
                    <Link to={`/ops/automations/${a.automation_key}`} className="text-ink hover:text-terracotta-deep font-medium">
                      {a.display_name}
                    </Link>
                    {a.critical && <span className="ml-2 text-[11px] text-terracotta-deep">important</span>}
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{describeInterval(a.expected_interval_minutes)}</td>
                  <td className="px-5 py-3 text-ink-soft">{timeAgo(a.last_run_at)}</td>
                  <td className="px-5 py-3">
                    <Light light={a.light} showLabel />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT = { success: 'Worked', partial: 'Partly failed', failed: 'Failed', skipped: 'Skipped' };
const STATUS_TONE = { success: 'text-ink-soft', partial: 'text-terracotta-deep', failed: 'text-destructive', skipped: 'text-ink-soft' };

export function AutomationDetail() {
  const { key } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);

  const load = () =>
    apiRequest(`/api/ops/automations/${key}/runs?limit=100`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, [key]);

  const runNow = async () => {
    setRunning(true);
    setNotice('');
    try {
      const r = await apiRequest(`/api/ops/automations/${key}/run-now`, { method: 'POST' });
      setNotice(r.queued ? 'Started. Results appear here in a minute.' : 'Done.');
      setTimeout(load, 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  if (!data) return error ? <ErrorBanner message={error} /> : <div className="text-sm text-ink-soft">Loading…</div>;
  const a = data.automation;
  const rate = data.stats_7d.runs ? Math.round((data.stats_7d.ok / data.stats_7d.runs) * 100) : null;

  return (
    <div className="space-y-5">
      <Link to="/ops/automations" className="text-sm text-ink-soft hover:text-ink">All automations</Link>
      <PageTitle
        title={a.display_name}
        subtitle={`${describeInterval(a.expected_interval_minutes)}. Last ran ${timeAgo(a.last_run_at)}${rate !== null ? `, worked ${rate}% of the time in the last 7 days` : ''}.`}
        right={
          a.can_run_now && (
            <button onClick={runNow} disabled={running} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
              {running ? 'Starting…' : 'Run now'}
            </button>
          )
        }
      />
      {!a.can_run_now && (
        <p className="text-xs text-ink-soft">This one can't be run by hand, because running it twice would send the same messages again.</p>
      )}
      <ErrorBanner message={error} />
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm">{notice}</div>}
      {a.last_error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">Last error: {a.last_error}</div>
      )}

      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
        {data.runs.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">No runs recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr className="border-b border-cream-deep/60">
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Result</th>
                <th className="px-5 py-3 font-medium">Items</th>
                <th className="px-5 py-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id} className="border-b border-cream-deep/40 last:border-0">
                  <td className="px-5 py-2.5 text-ink-soft whitespace-nowrap">{formatDateTime(r.started_at)}</td>
                  <td className={`px-5 py-2.5 font-medium ${STATUS_TONE[r.status]}`}>{STATUS_TEXT[r.status] || r.status}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{r.items_total ? `${r.items_succeeded} of ${r.items_total}${r.items_failed ? `, ${r.items_failed} failed` : ''}` : '—'}</td>
                  <td className="px-5 py-2.5 text-destructive text-xs max-w-md">{r.error_summary || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
