import React, { useEffect, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';

const LEAVE_LABELS = { casual: 'Casual', sick: 'Sick', earned: 'Earned' };

function StatusBadge({ status }) {
  const cls = {
    PENDING: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-rose-100 text-rose-800',
  }[status] || 'bg-cream-deep text-ink-soft';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function TeacherLeave() {
  const [balances, setBalances] = useState(null);
  const [requests, setRequests] = useState(null);
  const [form, setForm] = useState({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [b, r] = await Promise.all([
        apiRequest('/api/staff-leave/balances'),
        apiRequest('/api/staff-leave/requests'),
      ]);
      setBalances(b);
      setRequests(r);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.start_date || !form.end_date) {
      setError('Pick both start and end dates.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/api/staff-leave/requests', { method: 'POST', body: form });
      setForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <header className="sticky top-0 z-10 bg-cream/85 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/teacher" className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </Link>
          <h1 className="font-display text-lg text-ink">Leave</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {balances && (
          <div className="grid grid-cols-3 gap-3">
            {balances.map((b) => (
              <div key={b.leave_type} className="rounded-xl bg-white border border-cream-deep/70 p-3 text-center">
                <div className="text-xs text-ink-soft">{LEAVE_LABELS[b.leave_type]}</div>
                <div className="font-display text-xl text-ink mt-0.5">
                  {Number(b.total_days) - Number(b.used_days)}
                  <span className="text-sm text-ink-soft"> / {Number(b.total_days)}</span>
                </div>
                <div className="text-[11px] text-ink-soft">days left</div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
          <div className="font-display text-base text-ink">Apply for leave</div>
          {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-ink-soft space-y-1 col-span-2">
              Type
              <select
                value={form.leave_type}
                onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              >
                {Object.entries(LEAVE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-ink-soft space-y-1">
              Start date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>
            <label className="text-sm text-ink-soft space-y-1">
              End date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>
          </div>
          <label className="text-sm text-ink-soft space-y-1 block">
            Reason (optional)
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>
          <button
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>

        <div className="space-y-2">
          <div className="font-display text-base text-ink">Your requests</div>
          {requests === null ? (
            <div className="text-sm text-ink-soft">Loading…</div>
          ) : requests.length === 0 ? (
            <div className="text-sm text-ink-soft">No leave requests yet.</div>
          ) : (
            <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
              {requests.map((r) => (
                <div key={r.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-ink">
                    {LEAVE_LABELS[r.leave_type]} · {new Date(r.start_date).toLocaleDateString('en-IN')} –{' '}
                    {new Date(r.end_date).toLocaleDateString('en-IN')}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
