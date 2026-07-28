import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

function StatusBadge({ status }) {
  const cls = {
    PENDING: 'bg-amber-500/15 text-amber-700',
    APPROVED: 'bg-emerald-500/10 text-emerald-700',
    DECLINED: 'bg-terracotta/15 text-terracotta-deep',
  }[status] || 'bg-cream-deep text-ink-soft';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function StudentLeave() {
  const [requests, setRequests] = useState(null);
  const [form, setForm] = useState({ reason: '', from_date: '', to_date: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const data = await apiRequest('/api/student-leave/requests');
      setRequests(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.from_date || !form.to_date) {
      setError('Pick both from and to dates.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/api/student-leave/requests', { method: 'POST', body: form });
      setForm({ reason: '', from_date: '', to_date: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StudentShell>
      <div>
        <h1 className="font-display text-3xl text-ink">Leave</h1>
        <p className="text-sm text-ink-soft mt-1">Apply for leave — your class teacher or principal will review it.</p>
      </div>

      <form onSubmit={submit} className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3 mt-4">
        <div className="font-display text-base text-ink">Apply for leave</div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            From date
            <input
              type="date"
              value={form.from_date}
              onChange={(e) => setForm({ ...form, from_date: e.target.value })}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>
          <label className="text-sm text-ink-soft space-y-1">
            To date
            <input
              type="date"
              value={form.to_date}
              onChange={(e) => setForm({ ...form, to_date: e.target.value })}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>
        </div>
        <label className="text-sm text-ink-soft space-y-1 block">
          Reason
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

      <div className="space-y-2 mt-6">
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
                  {new Date(r.from_date).toLocaleDateString('en-IN')} – {new Date(r.to_date).toLocaleDateString('en-IN')}
                  {r.review_note && <div className="text-xs text-ink-soft mt-0.5">Remark: {r.review_note}</div>}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </StudentShell>
  );
}
