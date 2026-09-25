import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { formatDateTime, ErrorBanner, PageTitle } from './opsUi';

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'whatsapp.', label: 'Messages sent' },
  { key: 'exception.', label: 'Inbox actions' },
  { key: 'automation.', label: 'Manual runs' },
  { key: 'ops.', label: 'Reports & settings' },
];

const ACTION_TEXT = {
  'whatsapp.absence_alert_sent': 'Absence alert sent to parent',
  'whatsapp.absence_alert_failed': 'Absence alert failed',
  'exception.resolved': 'Inbox item resolved',
  'exception.dismissed': 'Inbox item dismissed',
  'exception.snoozed': 'Inbox item snoozed',
  'automation.run_now': 'Automation run by hand',
  'ops.digest_sent': 'Daily report sent',
  'ops.settings_updated': 'Daily report settings changed',
};

function describe(row) {
  if (ACTION_TEXT[row.action]) return ACTION_TEXT[row.action];
  if (row.action.startsWith('exception.action.')) return `Inbox one-click action: ${row.action.replace('exception.action.', '')}`;
  return row.action;
}

function detailText(row) {
  const d = row.detail || {};
  if (d.title) return d.title;
  if (d.note) return d.note;
  if (d.automation_key) return d.automation_key;
  if (d.error) return d.error;
  if (d.line) return d.line;
  return '';
}

export default function AuditLog() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (append = false, from = null) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: '100' });
      if (filter) q.set('action', filter);
      if (from) q.set('cursor', from);
      const d = await apiRequest(`/api/ops/audit?${q}`);
      setItems((prev) => (append ? [...prev, ...d.items] : d.items));
      setCursor(d.next_cursor);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
  }, [filter]);

  return (
    <div className="space-y-5">
      <PageTitle title="Activity log" subtitle="What the system and your team did, and when. Use it when a parent says a message never came." />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${filter === f.key ? 'bg-ink text-cream' : 'bg-white border border-cream-deep text-ink-soft hover:text-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ErrorBanner message={error} />
      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
        {items.length === 0 && !loading ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">No activity yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-cream-deep/40 last:border-0 align-top">
                  <td className="px-5 py-2.5 text-ink-soft whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="px-5 py-2.5 text-ink">{describe(r)}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{r.actor_type === 'user' ? r.actor_name || 'Staff' : r.actor_type === 'ai' ? 'AI' : 'System'}</td>
                  <td className="px-5 py-2.5 text-ink-soft text-xs max-w-md">{detailText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {cursor && (
        <button onClick={() => load(true, cursor)} disabled={loading} className="px-4 py-2 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink">
          {loading ? 'Loading…' : 'Load older'}
        </button>
      )}
    </div>
  );
}
