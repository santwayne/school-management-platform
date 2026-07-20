import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CalendarCheck2, ClipboardList, LogOut, ChevronRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const STATUS_ORDER = ['present', 'late', 'absent'];

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export default function TeacherPortal() {
  const { user, logout } = useAuth();
  const [classes, setClasses] = useState([]);
  const [markedToday, setMarkedToday] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const myClasses = await apiRequest('/api/academics/my-classes');
        if (cancelled) return;
        setClasses(myClasses);
        const marks = await Promise.all(
          myClasses.map((c) =>
            apiRequest(`/api/attendance/today/${c.class_id}`).then((r) => ({
              class_id: c.class_id,
              allMarked: r.data.length > 0 && r.data.every((s) => s.status),
            }))
          )
        );
        if (cancelled) return;
        setMarkedToday(Object.fromEntries(marks.map((m) => [m.class_id, m.allMarked])));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const active = classes.find((c) => `${c.class_id}-${c.subject_id}` === activeId) ?? null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const markedCount = Object.values(markedToday).filter(Boolean).length;
  const totalCount = classes.length;

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-cream/90 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {active ? (
            <button
              onClick={() => setActiveId(null)}
              className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-ink-soft" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-terracotta flex items-center justify-center text-primary-foreground font-display font-semibold text-sm shrink-0">
              {initials(user?.name)}
            </div>
          )}
          <div className="flex-1 min-w-0 leading-tight">
            <div className="font-display text-base text-ink truncate">{user?.name}</div>
            <div className="text-xs text-ink-soft">Teacher Portal</div>
          </div>
          <Link
            to="/teacher/leave"
            className="p-2 rounded-lg text-ink-soft hover:bg-cream-deep/60 hover:text-terracotta-deep transition"
            aria-label="Leave requests"
          >
            <ClipboardList className="w-5 h-5" />
          </Link>
          <button
            onClick={logout}
            className="p-2 rounded-lg text-ink-soft hover:bg-cream-deep/60 hover:text-terracotta-deep transition"
            aria-label="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {flash && (
          <div className="mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            {flash}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="space-y-3 mt-2">
            <div className="h-28 rounded-2xl bg-white/70 border border-cream-deep animate-pulse" />
            <div className="h-16 rounded-2xl bg-white/70 border border-cream-deep animate-pulse" />
            <div className="h-16 rounded-2xl bg-white/70 border border-cream-deep animate-pulse" />
          </div>
        ) : !active ? (
          <ClassPicker
            today={today}
            classes={classes}
            markedToday={markedToday}
            markedCount={markedCount}
            totalCount={totalCount}
            onOpen={(id) => setActiveId(id)}
          />
        ) : (
          <RollCall
            classPeriod={active}
            onSubmit={() => {
              setMarkedToday((m) => ({ ...m, [active.class_id]: true }));
              setFlash(`Attendance submitted for ${active.class_name} · ${active.subject_name} ✓`);
              setActiveId(null);
              setTimeout(() => setFlash(null), 4000);
            }}
          />
        )}
      </main>
    </div>
  );
}

function ClassPicker({ today, classes, markedToday, markedCount, totalCount, onOpen }) {
  const allDone = totalCount > 0 && markedCount === totalCount;

  return (
    <div className="space-y-5">
      {/* Greeting card */}
      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
        <div className="text-xs font-medium text-ink-soft uppercase tracking-widest mb-1">{today}</div>
        <h1 className="font-display text-2xl text-ink">Your classes</h1>
        <p className="text-sm text-ink-soft mt-1 leading-relaxed">
          Tap a class below to mark the roll for today.
        </p>
        {totalCount > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-cream-deep overflow-hidden">
              <div
                className="h-full rounded-full bg-terracotta transition-all"
                style={{ width: `${(markedCount / totalCount) * 100}%` }}
              />
            </div>
            <span className={`text-xs font-medium shrink-0 ${allDone ? 'text-emerald-600' : 'text-ink-soft'}`}>
              {allDone ? '✓ All done' : `${markedCount} / ${totalCount} marked`}
            </span>
          </div>
        )}
      </div>

      {/* Class list */}
      {classes.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-cream-deep/80 flex items-center justify-center mb-3">
            <BookOpen className="w-6 h-6 text-ink-soft/50" />
          </div>
          <p className="text-sm font-medium text-ink">No classes assigned</p>
          <p className="text-xs text-ink-soft mt-1 max-w-xs">Ask your principal to assign you to a class and subject.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {classes.map((c) => {
            const id = `${c.class_id}-${c.subject_id}`;
            const done = markedToday[c.class_id];
            return (
              <li key={id}>
                <button
                  onClick={() => onOpen(id)}
                  className={`w-full text-left rounded-2xl border px-4 py-4 flex items-center gap-4 transition group ${
                    done
                      ? 'bg-white border-cream-deep/70 opacity-80'
                      : 'bg-white border-cream-deep/70 hover:border-terracotta/40 hover:shadow-sm'
                  }`}
                >
                  {/* Subject initial badge */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold ${
                    done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-terracotta/10 text-terracotta-deep'
                  }`}>
                    {done ? <Check className="w-4 h-4" /> : c.subject_name?.[0] ?? '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-base text-ink">{c.class_name}</span>
                      <span className="text-ink-soft/50 text-xs">·</span>
                      <span className="text-sm text-ink-soft">{c.subject_name}</span>
                    </div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {done ? 'Attendance marked for today' : 'Tap to mark attendance'}
                    </div>
                  </div>

                  {done ? (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium">
                      <Check className="w-3 h-3" /> Marked
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-terracotta/10 text-terracotta-deep border border-terracotta/20 px-2.5 py-1 text-xs font-medium">
                      Pending
                    </span>
                  )}

                  <ChevronRight className="w-4 h-4 text-ink-soft/40 shrink-0 group-hover:text-terracotta/60 transition" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RollCall({ classPeriod, onSubmit }) {
  const [roster, setRoster] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [rosterData, todayMarks] = await Promise.all([
          apiRequest(`/api/academics/class/${classPeriod.class_id}/roster`),
          apiRequest(`/api/attendance/today/${classPeriod.class_id}`),
        ]);
        if (cancelled) return;
        setRoster(rosterData.students);
        const existing = Object.fromEntries(todayMarks.data.map((s) => [s.student_id, s.status]));
        setStatuses(Object.fromEntries(rosterData.students.map((s) => [s.id, existing[s.id] || 'present'])));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [classPeriod.class_id]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    for (const s of Object.values(statuses)) c[s]++;
    return c;
  }, [statuses]);

  const cycle = (id) =>
    setStatuses((prev) => {
      const cur = prev[id];
      const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
      return { ...prev, [id]: next };
    });

  const setAll = (s) => setStatuses(Object.fromEntries(roster.map((r) => [r.id, s])));

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const records = Object.entries(statuses).map(([student_id, status]) => ({ student_id: Number(student_id), status }));
      await apiRequest('/api/attendance/mark', { method: 'POST', body: { records } });
      onSubmit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading) return (
    <div className="space-y-3 mt-2">
      {[1,2,3,4].map(i => (
        <div key={i} className="h-14 rounded-xl bg-white/70 border border-cream-deep animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="rounded-2xl bg-white border border-cream-deep/70 p-4">
        <div className="flex items-center gap-2 text-xs text-ink-soft mb-1">
          <CalendarCheck2 className="w-3.5 h-3.5 text-terracotta" />
          {dateStr}
        </div>
        <h1 className="font-display text-xl text-ink">
          {classPeriod.class_name}
          <span className="text-ink-soft font-sans text-sm font-normal ml-2">· {classPeriod.subject_name}</span>
        </h1>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Sticky summary bar */}
      <div className="sticky top-[60px] z-10">
        <div className="bg-white border border-cream-deep/70 rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            <CountPill tone="present" n={counts.present} label="present" />
            <CountPill tone="late" n={counts.late} label="late" />
            <CountPill tone="absent" n={counts.absent} label="absent" />
          </div>
          <button
            onClick={() => setAll('present')}
            className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg border border-cream-deep bg-cream/60 hover:border-terracotta/40 hover:text-terracotta-deep transition"
          >
            Mark all present
          </button>
        </div>
      </div>

      {/* Roster */}
      <ul className="space-y-2">
        {roster.map((s, i) => {
          const st = statuses[s.id];
          return (
            <li key={s.id}>
              <div className="flex items-center gap-3 bg-white border border-cream-deep/70 rounded-xl px-3 py-2.5 hover:border-cream-deep transition">
                <div className="w-8 h-8 rounded-lg bg-cream-deep/70 text-ink-soft text-xs font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 text-sm text-ink truncate">{s.name}</div>
                <div className="flex gap-1.5 shrink-0">
                  <StatusBtn active={st === 'present'} tone="present" onClick={() => cycle(s.id)}>P</StatusBtn>
                  <StatusBtn active={st === 'late'} tone="late" onClick={() => setStatuses((p) => ({ ...p, [s.id]: 'late' }))}>L</StatusBtn>
                  <StatusBtn active={st === 'absent'} tone="absent" onClick={() => setStatuses((p) => ({ ...p, [s.id]: 'absent' }))}>A</StatusBtn>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Submit */}
      <div className="sticky bottom-4 pt-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-2xl bg-terracotta text-primary-foreground font-medium py-3.5 shadow-lg shadow-terracotta/20 hover:bg-terracotta-deep transition disabled:opacity-50 text-sm"
        >
          {submitting ? 'Submitting…' : `Submit attendance · ${roster.length} students`}
        </button>
      </div>
    </div>
  );
}

function CountPill({ tone, n, label }) {
  const styles = {
    present: 'bg-emerald-500/10 text-emerald-700',
    absent: 'bg-terracotta/12 text-terracotta-deep',
    late: 'bg-amber-400/15 text-amber-700',
  };
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>
      <span className="text-sm font-bold">{n}</span> {label}
    </span>
  );
}

function StatusBtn({ active, tone, onClick, children }) {
  const activeStyles = {
    present: 'bg-emerald-500 text-white border-emerald-500',
    absent: 'bg-terracotta text-primary-foreground border-terracotta',
    late: 'bg-amber-400 text-ink border-amber-400',
  };
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded-lg text-xs font-bold border transition ${
        active ? activeStyles[tone] : 'bg-white text-ink-soft border-cream-deep hover:border-ink-soft/30'
      }`}
    >
      {children}
    </button>
  );
}
