import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserX } from 'lucide-react';
import { apiRequest } from '../../api';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const REASON_LABELS = { leave: 'On approved leave', no_punch: 'No biometric punch', manual: 'Marked by operator' };
const STATUS_TONE = { assigned: 'bg-joy-leaf/15 text-ink', unfilled: 'bg-destructive/10 text-destructive', cancelled: 'bg-cream-deep/50 text-ink-soft' };

function MarkAbsentModal({ teachers, onClose, onDone }) {
  const [teacherId, setTeacherId] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!teacherId) return;
    setBusy(true);
    setError('');
    try {
      const r = await apiRequest('/api/substitutions/mark-absent', { method: 'POST', body: { teacher_id: Number(teacherId), date } });
      onDone(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl border border-cream-deep/70 p-6 w-full max-w-sm space-y-4">
        <h2 className="font-display text-xl text-ink">Mark teacher absent</h2>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}
        <label className="block text-sm">
          <span className="text-ink-soft">Teacher</span>
          <select required value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="">Select…</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-ink-soft hover:text-ink">Cancel</button>
          <button disabled={busy || !teacherId} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {busy ? 'Planning…' : 'Plan coverage'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReassignSelect({ row, onAssigned }) {
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest(`/api/substitutions/${row.id}/candidates`).then(setCandidates).catch(() => setCandidates([]));
  }, [row.id]);

  const assign = async (e) => {
    const teacherId = e.target.value;
    if (!teacherId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/substitutions/${row.id}`, { method: 'PATCH', body: { substitute_teacher_id: Number(teacherId) } });
      onAssigned();
    } finally {
      setBusy(false);
    }
  };

  if (!candidates) return <span className="text-xs text-ink-soft">Loading…</span>;
  if (candidates.length === 0) return <span className="text-xs text-destructive">No free teacher this period</span>;

  return (
    <select disabled={busy} onChange={assign} defaultValue="" className="px-2 py-1 rounded-lg border border-cream-deep text-xs">
      <option value="">Assign…</option>
      {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

export default function SubstitutionBoard() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAbsent, setShowAbsent] = useState(false);
  const [replanning, setReplanning] = useState(false);

  const load = useCallback(() => {
    apiRequest(`/api/substitutions?date=${date}`).then(setData).catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiRequest('/api/academics/teachers').then(setTeachers).catch(() => {}); }, []);

  const replan = async () => {
    setReplanning(true);
    setError('');
    try {
      const r = await apiRequest('/api/substitutions/plan', { method: 'POST', body: { date } });
      setNotice(`${r.assigned} assigned, ${r.unfilled} unfilled.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setReplanning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-ink">Substitution board</h1>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">Every period an absent teacher would have taught, and who's covering it.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep text-sm" />
          <button onClick={() => setShowAbsent(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink">
            <UserX className="w-4 h-4" /> Mark absent
          </button>
          <button disabled={replanning} onClick={replan} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${replanning ? 'animate-spin' : ''}`} /> Re-plan {date === today() ? 'today' : 'this day'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{notice}</div>}

      {!data && !error && <div className="text-sm text-ink-soft">Loading…</div>}

      {data && (
        data.items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-cream-deep/70 px-6 py-12 text-center">
            <p className="font-display text-xl text-ink">No absences on this day.</p>
            <p className="text-sm text-ink-soft mt-1">Nothing needs covering — or nobody's been marked absent yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
            {data.unfilled > 0 && (
              <div className="px-5 py-2.5 bg-destructive/5 border-b border-destructive/20 text-sm text-destructive font-medium">
                {data.unfilled} period{data.unfilled === 1 ? '' : 's'} still unfilled
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-soft">
                <tr className="border-b border-cream-deep/60">
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 font-medium">Class</th>
                  <th className="px-5 py-3 font-medium">Subject</th>
                  <th className="px-5 py-3 font-medium">Absent teacher</th>
                  <th className="px-5 py-3 font-medium">Covering</th>
                  <th className="px-5 py-3 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-cream-deep/40 last:border-0">
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">P{r.period_number} · {r.start_time?.slice(0, 5)}</td>
                    <td className="px-5 py-3 text-ink">{r.class_label}</td>
                    <td className="px-5 py-3 text-ink-soft">{r.subject_name}</td>
                    <td className="px-5 py-3 text-ink">{r.absent_teacher}</td>
                    <td className="px-5 py-3">
                      {r.status === 'assigned' ? (
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_TONE.assigned}`}>{r.substitute_teacher}</span>
                      ) : r.status === 'cancelled' ? (
                        <span className={`px-2 py-0.5 rounded-md text-xs ${STATUS_TONE.cancelled}`}>Cancelled — teacher arrived</span>
                      ) : (
                        <ReassignSelect row={r} onAssigned={load} />
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-soft">{REASON_LABELS[r.reason] || r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showAbsent && (
        <MarkAbsentModal
          teachers={teachers}
          onClose={() => setShowAbsent(false)}
          onDone={(r) => { setShowAbsent(false); setNotice(`${r.assigned} assigned, ${r.unfilled} unfilled.`); load(); }}
        />
      )}
    </div>
  );
}
