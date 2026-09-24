import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api';
import { timeAgo, Light, SeverityChip, integrationLight, INTEGRATION_NAMES, ErrorBanner } from './opsUi';

const CATEGORY_NAMES = {
  attendance: 'Attendance',
  fees: 'Fees',
  communication: 'Communication',
  academics: 'Academics',
  transport: 'Transport',
  admin: 'Admin',
  ai: 'AI',
  ops: 'Control Center',
};

function headline(total, critical) {
  if (total === 0) return { text: 'Nothing needs you right now.', tone: 'text-ink' };
  if (critical > 0) return { text: `${total} ${total === 1 ? 'thing needs' : 'things need'} you, ${critical} urgent.`, tone: 'text-destructive' };
  return { text: `${total} ${total === 1 ? 'thing needs' : 'things need'} you today.`, tone: 'text-ink' };
}

export default function OpsOverview() {
  const [data, setData] = useState(null);
  const [top, setTop] = useState([]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [overview, inbox] = await Promise.all([apiRequest('/api/ops/overview'), apiRequest('/api/ops/exceptions?limit=5')]);
      setData(overview);
      setTop(inbox.items);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await apiRequest('/api/ops/automations/ops_health_check/run-now', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  if (!data) return error ? <ErrorBanner message={error} /> : <div className="text-sm text-ink-soft">Loading the Control Center…</div>;

  const { exceptions, automations, integrations, today } = data;
  const h = headline(exceptions.total, exceptions.critical);
  const healthRun = automations.find((a) => a.automation_key === 'ops_health_check');
  const live = integrations.filter((i) => i.status !== 'not_configured');
  const notSetUp = integrations.filter((i) => i.status === 'not_configured');
  const byCategory = automations.reduce((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <ErrorBanner message={error} />

      <section>
        <h1 className={`font-display text-3xl sm:text-5xl leading-tight ${h.tone}`}>{h.text}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-soft">
          <span>Systems last checked {timeAgo(healthRun?.last_run_at)}</span>
          <button onClick={checkNow} disabled={checking} className="inline-flex items-center gap-1.5 text-terracotta-deep hover:underline disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </section>

      {top.length > 0 && (
        <section className="bg-white rounded-2xl border border-cream-deep/70">
          <ul>
            {top.map((e) => (
              <li key={e.id} className="border-b border-cream-deep/50 last:border-0">
                <Link to={`/ops/inbox?focus=${e.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-cream/60">
                  <SeverityChip severity={e.severity} />
                  <span className="flex-1 text-sm text-ink">{e.title}</span>
                  {e.occurrences > 1 && <span className="text-xs text-ink-soft">×{e.occurrences}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/ops/inbox" className="block px-5 py-3 text-sm text-terracotta-deep font-medium border-t border-cream-deep/50 hover:bg-cream/60 rounded-b-2xl">
            Open inbox ({exceptions.total})
          </Link>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="font-display text-lg text-ink">Today</h2>
          <dl className="bg-white rounded-2xl border border-cream-deep/70 divide-y divide-cream-deep/50 text-sm">
            {[
              ['Students absent', today.absent_today],
              ['Absence alerts sent', today.alerts_sent_today],
              ['Absence alerts failed', today.alerts_failed_today, today.alerts_failed_today > 0],
              ['Fees received', `₹${Number(today.fees_today).toLocaleString('en-IN')}`],
              ['Issues resolved', today.resolved_today],
            ].map(([label, value, bad]) => (
              <div key={label} className="flex justify-between px-5 py-3">
                <dt className="text-ink-soft">{label}</dt>
                <dd className={`font-medium ${bad ? 'text-destructive' : 'text-ink'}`}>{value}</dd>
              </div>
            ))}
          </dl>

          <h2 className="font-display text-lg text-ink pt-3">Connections</h2>
          <ul className="bg-white rounded-2xl border border-cream-deep/70 divide-y divide-cream-deep/50 text-sm">
            {live.map((i) => (
              <li key={i.integration} className="flex items-start gap-3 px-5 py-3">
                <span className="pt-1"><Light light={integrationLight(i.status)} /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-ink">{INTEGRATION_NAMES[i.integration] || i.integration}</div>
                  {i.status !== 'ok' && i.detail && <div className="text-xs text-ink-soft mt-0.5 whitespace-pre-line">{i.detail}</div>}
                </div>
                <span className="text-xs text-ink-soft capitalize">{i.status === 'ok' ? 'Working' : i.status}</span>
              </li>
            ))}
          </ul>
          {notSetUp.length > 0 && (
            <p className="text-xs text-ink-soft px-1">
              Not set up yet: {notSetUp.map((i) => INTEGRATION_NAMES[i.integration] || i.integration).join(', ')}.
            </p>
          )}
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg text-ink">Automations</h2>
            <span className="text-xs text-ink-soft">
              {[
                `${data.automation_summary.green} working`,
                data.automation_summary.idle ? `${data.automation_summary.idle} waiting` : null,
                data.automation_summary.amber ? `${data.automation_summary.amber} to check` : null,
                data.automation_summary.red ? `${data.automation_summary.red} failing` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
          <div className="bg-white rounded-2xl border border-cream-deep/70 divide-y divide-cream-deep/50">
            {Object.entries(byCategory).map(([cat, list]) => (
              <div key={cat} className="px-5 py-3">
                <div className="text-xs font-medium text-ink-soft mb-1.5">{CATEGORY_NAMES[cat] || cat}</div>
                <ul className="space-y-1">
                  {list.map((a) => (
                    <li key={a.automation_key}>
                      <Link to={`/ops/automations/${a.automation_key}`} className="flex items-center gap-3 py-1 text-sm hover:text-terracotta-deep">
                        <Light light={a.light} />
                        <span className="flex-1 text-ink">{a.display_name}</span>
                        <span className={`text-xs ${a.light === 'red' ? 'text-destructive' : 'text-ink-soft'}`}>
                          {a.stale ? 'Not running on schedule' : a.last_run_at ? `ran ${timeAgo(a.last_run_at)}` : a.expected_interval_minutes ? 'waiting for first run' : 'runs when triggered'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
