import React, { useEffect, useState } from 'react';
import { CalendarCheck2 } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

// Parents don't have their own login in this system — the student portal is
// the closest analog to a "parent view" of attendance, so this page is
// student-facing but shows the same history+percentage a parent would want.

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusPill({ status }) {
  const cls =
    status === 'present'
      ? 'bg-emerald-500/10 text-emerald-700'
      : status === 'late'
        ? 'bg-amber-400/20 text-amber-700'
        : 'bg-terracotta/15 text-terracotta-deep';
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>{status}</span>;
}

export default function StudentAttendance() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = from && to ? `?from=${from}&to=${to}` : '';
      const res = await apiRequest(`/api/student/attendance${qs}`);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary;

  return (
    <StudentShell>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-3xl text-ink">My Attendance</h1>
          <p className="text-sm text-ink-soft mt-1">Your attendance history and overall percentage.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : (
          <>
            <section className="rounded-3xl p-6 bg-gradient-to-br from-terracotta to-terracotta-deep text-white flex flex-wrap items-center gap-6">
              <div>
                <div className="text-sm opacity-90">Attendance percentage</div>
                <div className="font-display text-4xl">{summary?.percentage !== null && summary?.percentage !== undefined ? `${summary.percentage}%` : '—'}</div>
                <div className="text-sm opacity-90 mt-1">{summary?.total || 0} days marked in this range</div>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs opacity-80">Present</div>
                  <div className="font-display text-2xl">{summary?.present ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs opacity-80">Late</div>
                  <div className="font-display text-2xl">{summary?.late ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs opacity-80">Absent</div>
                  <div className="font-display text-2xl">{summary?.absent ?? '—'}</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white border border-cream-deep/60 p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="block text-xs font-medium text-ink-soft mb-1">From</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
                </label>
                <label className="text-sm">
                  <span className="block text-xs font-medium text-ink-soft mb-1">To</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
                </label>
                <button onClick={load} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                  Apply
                </button>
                <span className="text-xs text-ink-soft">Defaults to the last 365 days if left blank.</span>
              </div>

              <div className="rounded-xl border border-cream-deep/70 overflow-hidden">
                {data?.records?.length ? (
                  <div className="divide-y divide-cream-deep/60 max-h-[420px] overflow-y-auto">
                    {data.records.map((r) => (
                      <div key={r.date} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="inline-flex items-center gap-2 text-ink-soft">
                          <CalendarCheck2 className="w-3.5 h-3.5 text-terracotta/70" />
                          {fmtDate(r.date)}
                        </span>
                        <StatusPill status={r.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-sm text-ink-soft text-center">No attendance records in this range.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </StudentShell>
  );
}
