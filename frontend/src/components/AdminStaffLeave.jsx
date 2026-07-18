import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock, Users } from 'lucide-react';
import { apiRequest } from '../api';

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

const LEAVE_LABELS = { casual: 'Casual', sick: 'Sick', earned: 'Earned' };

function StatusBadge({ status }) {
  const cls = {
    PENDING: 'bg-amber-500/15 text-amber-700',
    APPROVED: 'bg-emerald-500/10 text-emerald-700',
    REJECTED: 'bg-terracotta/15 text-terracotta-deep',
  }[status] || 'bg-cream-deep text-ink-soft';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function AdminStaffLeave() {
  const [tab, setTab] = useState('PENDING');
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async (status) => {
    setError('');
    try {
      const data = await apiRequest(`/api/staff-leave/requests?status=${status}`);
      setRequests(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setRequests(null);
    load(tab);
  }, [tab]);

  const review = async (id, status) => {
    setBusyId(id);
    setError('');
    try {
      await apiRequest(`/api/staff-leave/requests/${id}`, { method: 'PUT', body: { status } });
      await load(tab);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <Users className="w-7 h-7 text-terracotta" /> Staff Leave
        </h1>
        <p className="text-sm text-ink-soft mt-1">Review leave requests from teaching and admin staff.</p>
      </div>

      <div className="border-b border-cream-deep/70 flex gap-1">
        {TABS.map((t) => (
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

      {requests === null ? (
        <div className="text-sm text-ink-soft py-8 text-center">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-8 text-center text-sm text-ink-soft">
          Nothing here right now.
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
          {requests.map((r) => (
            <div key={r.id} className="p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">{r.teacher_name}</span>
                  <span className="text-xs text-ink-soft capitalize">({r.teacher_role})</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-sm text-ink-soft mt-1">
                  {LEAVE_LABELS[r.leave_type] || r.leave_type} leave · {new Date(r.start_date).toLocaleDateString('en-IN')} –{' '}
                  {new Date(r.end_date).toLocaleDateString('en-IN')} · {Number(r.days_count)} day{r.days_count == 1 ? '' : 's'}
                </div>
                {r.reason && <div className="text-sm text-ink mt-2 bg-cream-deep/30 rounded-lg px-3 py-2">{r.reason}</div>}
                {r.review_note && <div className="text-xs text-ink-soft mt-2">Note: {r.review_note}</div>}
              </div>
              {r.status === 'PENDING' && (
                <div className="flex gap-2 shrink-0">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => review(r.id, 'APPROVED')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => review(r.id, 'REJECTED')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              )}
              {r.status !== 'PENDING' && (
                <div className="flex items-center gap-1 text-xs text-ink-soft shrink-0">
                  <Clock className="w-3.5 h-3.5" /> {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN') : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
