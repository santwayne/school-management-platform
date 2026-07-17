import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

const AUDIENCES = [
  { value: 'all_parents', label: 'All parents' },
  { value: 'all_staff', label: 'All staff' },
];

export default function AdminCommunications() {
  const [tab, setTab] = useState('history');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const [audience, setAudience] = useState('all_parents');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await apiRequest('/api/communications'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    setSendResult(null);
    try {
      const label = AUDIENCES.find((a) => a.value === audience)?.label || audience;
      const result = await apiRequest('/api/communications/send', {
        method: 'POST',
        body: { audience, audience_label: label, message: message.trim() },
      });
      setSendResult(result);
      setMessage('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink">Communications</h1>
        <p className="text-sm text-ink-soft mt-1">WhatsApp broadcasts to parents and staff.</p>
      </div>

      <div className="border-b border-cream-deep/70 flex gap-1">
        {[{ key: 'history', label: 'History' }, { key: 'compose', label: 'Compose' }].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {tab === 'history' && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-ink-soft">No broadcasts sent yet.</p>
          ) : (
            history.map((b) => (
              <div key={b.id} className="rounded-xl bg-white border border-cream-deep/70 p-4 cursor-pointer" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{b.audience_label}</span>
                  <span className="text-xs text-ink-soft">{new Date(b.sent_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className={`text-sm text-ink-soft mt-1 ${expanded === b.id ? '' : 'truncate'}`}>{b.message}</p>
                <p className="text-xs text-ink-soft mt-1.5">{b.delivered_count} delivered{b.failed_count > 0 ? `, ${b.failed_count} failed` : ''} of {b.recipient_count}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'compose' && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">Audience</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm">
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm"
              placeholder="Type the WhatsApp message to send…"
            />
          </label>
          {message && (
            <div className="rounded-2xl bg-[#e7ffdb] border border-cream-deep/70 p-3 max-w-sm ml-auto text-sm text-ink whitespace-pre-wrap">
              {message}
            </div>
          )}
          {sendResult && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">
              Sent to {sendResult.recipient_count} recipients — {sendResult.delivered_count} delivered{sendResult.failed_count > 0 ? `, ${sendResult.failed_count} failed` : ''}.
            </div>
          )}
          <button
            onClick={send}
            disabled={sending || !message.trim()}
            className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      )}
    </div>
  );
}
