import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CalendarCheck2, ClipboardList } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const STATUS_ORDER = ['present', 'late', 'absent'];

export default function TeacherPortal() {
  const { user } = useAuth();
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
    return () => {
      cancelled = true;
    };
  }, []);

  const active = classes.find((c) => `${c.class_id}-${c.subject_id}` === activeId) ?? null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <header className="sticky top-0 z-10 bg-cream/85 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {active ? (
            <button onClick={() => setActiveId(null)} className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition" aria-label="Back">
              <ArrowLeft className="w-5 h-5 text-ink-soft" />
            </button>
          ) : (
            <div className="h-9 w-9 rounded-lg bg-terracotta flex items-center justify-center text-primary-foreground font-display font-semibold">W</div>
          )}
          <div className="flex-1 min-w-0 leading-tight">
            <div className="font-display text-lg text-ink truncate">{user?.name}</div>
            <div className="text-xs text-ink-soft truncate">Teacher Portal</div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {flash && (
          <div className="mb-4 rounded-xl bg-joy-leaf/25 border border-joy-leaf/40 px-4 py-3 text-sm text-ink flex items-center gap-2">
            <Check className="w-4 h-4" /> {flash}
          </div>
        )}
        {error && <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading your classes…</p>
        ) : !active ? (
          <ClassPicker today={today} classes={classes} markedToday={markedToday} onOpen={(id) => setActiveId(id)} />
        ) : (
          <RollCall
            classPeriod={active}
            onSubmit={() => {
              setMarkedToday((m) => ({ ...m, [active.class_id]: true }));
              setFlash(`Attendance submitted for ${active.class_name}, ${active.subject_name} ✓`);
              setActiveId(null);
              setTimeout(() => setFlash(null), 4000);
            }}
          />
        )}
      </main>
    </div>
  );
}

function ClassPicker({ today, classes, markedToday, onOpen }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-soft">{today}</div>
        <h1 className="font-display text-2xl sm:text-3xl text-ink mt-1">Your classes</h1>
        <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-xl">
          Quick manual attendance for classes without biometric check-in. Tap a class to mark the roll.
        </p>
      </div>

      {classes.length === 0 ? (
        <p className="text-sm text-ink-soft">You aren't assigned to any class/subject yet — ask your principal to assign you one.</p>
      ) : (
        <ul className="space-y-3">
          {classes.map((c) => {
            const id = `${c.class_id}-${c.subject_id}`;
            const done = markedToday[c.class_id];
            return (
              <li key={id}>
                <button
                  onClick={() => onOpen(id)}
                  className="w-full text-left bg-white border border-cream-deep rounded-2xl px-4 sm:px-5 py-4 flex items-center gap-4 hover:border-terracotta/50 hover:shadow-sm transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-lg text-ink">{c.class_name}</span>
                      <span className="text-ink-soft/60">·</span>
                      <span className="text-sm text-ink-soft">{c.subject_name}</span>
                    </div>
                  </div>
                  {done ? (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-joy-leaf/25 text-ink px-2.5 py-1 text-xs font-medium">
                      <Check className="w-3.5 h-3.5" /> Marked
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center rounded-full bg-terracotta/12 text-terracotta-deep px-2.5 py-1 text-xs font-medium">Pending</span>
                  )}
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
        const [roster, todayMarks] = await Promise.all([
          apiRequest(`/api/academics/class/${classPeriod.class_id}/roster`),
          apiRequest(`/api/attendance/today/${classPeriod.class_id}`),
        ]);
        if (cancelled) return;
        setRoster(roster.students);
        const existing = Object.fromEntries(todayMarks.data.map((s) => [s.student_id, s.status]));
        setStatuses(Object.fromEntries(roster.students.map((s) => [s.id, existing[s.id] || 'present'])));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
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

  if (loading) return <p className="text-sm text-ink-soft">Loading roster…</p>;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <CalendarCheck2 className="w-4 h-4 text-terracotta" />
          {dateStr}
        </div>
        <h1 className="font-display text-2xl sm:text-3xl text-ink mt-1">
          {classPeriod.class_name} <span className="text-ink-soft font-sans text-base">· {classPeriod.subject_name}</span>
        </h1>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="sticky top-[60px] z-10 -mx-4 sm:mx-0 px-4 sm:px-0">
        <div className="bg-white border border-cream-deep rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-sm">
            <CountPill tone="present" n={counts.present} label="present" />
            <CountPill tone="absent" n={counts.absent} label="absent" />
            <CountPill tone="late" n={counts.late} label="late" />
          </div>
          <button
            onClick={() => setAll('present')}
            className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg border border-cream-deep hover:border-terracotta/50 hover:text-terracotta-deep transition"
          >
            Mark all present
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {roster.map((s, i) => {
          const st = statuses[s.id];
          return (
            <li key={s.id}>
              <div className="flex items-center gap-3 bg-white border border-cream-deep rounded-xl px-3 py-2.5">
                <div className="w-9 h-9 rounded-lg bg-cream-deep/60 text-ink-soft text-sm font-medium flex items-center justify-center shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0 truncate text-sm text-ink">{s.name}</div>
                <div className="flex gap-1 shrink-0">
                  <StatusBtn active={st === 'present'} tone="present" onClick={() => cycle(s.id)}>P</StatusBtn>
                  <StatusBtn active={st === 'late'} tone="late" onClick={() => setStatuses((p) => ({ ...p, [s.id]: 'late' }))}>L</StatusBtn>
                  <StatusBtn active={st === 'absent'} tone="absent" onClick={() => setStatuses((p) => ({ ...p, [s.id]: 'absent' }))}>A</StatusBtn>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-4 pt-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-2xl bg-terracotta text-primary-foreground font-medium py-3.5 shadow-lg shadow-terracotta/20 hover:bg-terracotta-deep transition disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit attendance'}
        </button>
      </div>
    </div>
  );
}

function CountPill({ tone, n, label }) {
  const styles = {
    present: 'bg-joy-leaf/25 text-ink',
    absent: 'bg-terracotta/15 text-terracotta-deep',
    late: 'bg-amber-warm/20 text-ink',
  };
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>
      <span className="text-sm font-semibold">{n}</span> {label}
    </span>
  );
}

function StatusBtn({ active, tone, onClick, children }) {
  const activeStyles = {
    present: 'bg-joy-leaf text-ink border-joy-leaf',
    absent: 'bg-terracotta text-primary-foreground border-terracotta',
    late: 'bg-amber-warm text-ink border-amber-warm',
  };
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 rounded-lg text-sm font-semibold border transition ${
        active ? activeStyles[tone] : 'bg-white text-ink-soft border-cream-deep hover:border-ink-soft/40'
      }`}
    >
      {children}
    </button>
  );
}
