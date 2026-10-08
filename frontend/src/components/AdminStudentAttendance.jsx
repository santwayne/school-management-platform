import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, ArrowLeft, Loader2 } from 'lucide-react';
import { apiRequest } from '../api';

// Student attendance for the principal.
//
// Until now a principal could only see staff attendance; student attendance
// lived in the teacher's login. This page shows today's picture for every
// class and lets the principal mark or correct a class, through the same
// /api/attendance routes the teachers use (so absence alerts go out the same way).

const STATUSES = [
  { key: 'present', label: 'Present', on: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'absent', label: 'Absent', on: 'bg-destructive text-white border-destructive' },
  { key: 'late', label: 'Late', on: 'bg-amber-500 text-white border-amber-500' },
];

function Count({ n, label, tone = 'text-ink' }) {
  return (
    <div className="text-center">
      <div className={`font-display text-lg ${tone}`}>{n}</div>
      <div className="text-[11px] text-ink-soft">{label}</div>
    </div>
  );
}

function ClassRoster({ cls, onBack, onSaved }) {
  const [students, setStudents] = useState(null);
  const [marked, setMarked] = useState({}); // what is saved for today
  const [chosen, setChosen] = useState({}); // what the principal has picked
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError('');
    try {
      const res = await apiRequest(`/api/attendance/today/${cls.class_id}`);
      const rows = res.data || [];
      const saved = Object.fromEntries(rows.filter((r) => r.status).map((r) => [r.student_id, r.status]));
      setStudents(rows);
      setMarked(saved);
      setChosen(saved);
    } catch (err) {
      setError(err.message);
      setStudents([]);
    }
  };

  useEffect(() => {
    load();
  }, [cls.class_id]);

  // Only what changed is sent, so a student already marked absent is not
  // marked again (which would send the parent a second alert).
  const changes = useMemo(
    () => Object.entries(chosen).filter(([id, status]) => marked[id] !== status).map(([id, status]) => ({ student_id: Number(id), status })),
    [chosen, marked]
  );
  const newlyAbsent = changes.filter((c) => c.status === 'absent').length;
  const unmarked = (students || []).filter((s) => !chosen[s.student_id]).length;

  const save = async () => {
    if (changes.length === 0) return;
    if (newlyAbsent > 0 && !confirm(`${newlyAbsent} student${newlyAbsent === 1 ? '' : 's'} will be marked absent. Their parents get a WhatsApp absence alert. Continue?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await apiRequest('/api/attendance/mark', { method: 'POST', body: { records: changes } });
      const failed = (res.notifications || []).filter((n) => n.whatsapp_status !== 'SENT').length;
      setNotice(
        failed > 0
          ? `Saved. ${failed} absence alert${failed === 1 ? '' : 's'} could not be sent — see the Control Center inbox.`
          : `Saved ${changes.length} change${changes.length === 1 ? '' : 's'}.`
      );
      await load();
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="w-4 h-4" /> All classes
      </button>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-2xl text-ink">{cls.class_name}</h2>
          <p className="text-sm text-ink-soft mt-0.5">
            Today · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            {students && students.length > 0 && unmarked > 0 ? ` · ${unmarked} not marked yet` : ''}
          </p>
        </div>
        {students && students.length > 0 && (
          <button
            onClick={() => setChosen(Object.fromEntries(students.map((s) => [s.student_id, chosen[s.student_id] || 'present'])))}
            className="text-sm text-terracotta-deep hover:underline"
          >
            Mark the rest present
          </button>
        )}
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {students === null ? (
        <div className="text-sm text-ink-soft py-8 text-center">Loading…</div>
      ) : students.length === 0 ? (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-8 text-center text-sm text-ink-soft">No students in this class yet.</div>
      ) : (
        <>
          <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
            {students.map((s) => (
              <div key={s.student_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm text-ink min-w-0 truncate">{s.name}</span>
                <div className="flex gap-1.5 shrink-0">
                  {STATUSES.map((st) => (
                    <button
                      key={st.key}
                      onClick={() => setChosen((prev) => ({ ...prev, [s.student_id]: st.key }))}
                      aria-pressed={chosen[s.student_id] === st.key}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                        chosen[s.student_id] === st.key ? st.on : 'bg-white text-ink-soft border-cream-deep hover:border-ink-soft'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || changes.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-terracotta text-white text-sm font-medium disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {changes.length === 0 ? 'No changes' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
            </button>
            {newlyAbsent > 0 && <span className="text-xs text-ink-soft">{newlyAbsent} absence alert{newlyAbsent === 1 ? '' : 's'} will go to parents</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminStudentAttendance() {
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = async () => {
    setError('');
    try {
      const res = await apiRequest('/api/attendance/summary/today');
      setClasses(res.data || []);
    } catch (err) {
      setError(err.message);
      setClasses([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const t = { students: 0, present: 0, absent: 0, late: 0, unmarked: 0 };
    for (const c of classes || []) for (const k of Object.keys(t)) t[k] += Number(c[k]) || 0;
    return t;
  }, [classes]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <CalendarCheck2 className="w-7 h-7 text-terracotta" /> Student Attendance
        </h1>
        <p className="text-sm text-ink-soft mt-1">Today's attendance for every class. Open a class to mark or correct it.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {open ? (
        <ClassRoster cls={open} onBack={() => setOpen(null)} onSaved={load} />
      ) : classes === null ? (
        <div className="text-sm text-ink-soft py-8 text-center">Loading…</div>
      ) : classes.length === 0 ? (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-8 text-center text-sm text-ink-soft">No classes yet. Add classes first.</div>
      ) : (
        <>
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-4 grid grid-cols-5 gap-2">
            <Count n={totals.students} label="Students" />
            <Count n={totals.present} label="Present" tone="text-emerald-700" />
            <Count n={totals.absent} label="Absent" tone="text-destructive" />
            <Count n={totals.late} label="Late" tone="text-amber-600" />
            <Count n={totals.unmarked} label="Not marked" tone="text-ink-soft" />
          </div>
          <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
            {classes.map((c) => (
              <button key={c.class_id} onClick={() => setOpen(c)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-cream-deep/30 transition">
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate">{c.class_name}</div>
                  <div className="text-xs text-ink-soft mt-0.5">
                    {c.students === 0
                      ? 'No students'
                      : c.unmarked === c.students
                        ? 'Not marked today'
                        : c.unmarked > 0
                          ? `${c.unmarked} of ${c.students} not marked`
                          : `All ${c.students} marked`}
                  </div>
                </div>
                <div className="flex gap-4 shrink-0">
                  <Count n={c.present} label="Present" tone="text-emerald-700" />
                  <Count n={c.absent} label="Absent" tone="text-destructive" />
                  <Count n={c.late} label="Late" tone="text-amber-600" />
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
