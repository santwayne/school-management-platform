import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, CheckCircle2, Circle, X } from 'lucide-react';
import { apiRequest } from '../api';

// The public signup wizard (Onboarding.jsx) only ever creates the school,
// the principal's own account, and a bare list of class names — subjects,
// the rest of the staff, students and their parents all have to be added
// afterwards from Manage School, which already exists and already works.
// This is the nudge that closes that loop: on first login it points the
// principal at exactly what's left, using the same screens rather than
// duplicating any of that add/edit logic here.
const STEPS = [
  { key: 'classes', label: 'Classes', tab: 'classes' },
  { key: 'subjects', label: 'Subjects', tab: 'classes' },
  { key: 'staff', label: 'Staff (teachers, accountant, operator...)', tab: 'teachers' },
  { key: 'students', label: 'Students', tab: 'students' },
  { key: 'parents', label: 'Parents', tab: 'parents' },
];

// Substitution cover, class reminders, daily guidance and every staff
// WhatsApp stay silent (no error anywhere) while the thing they read from is
// empty. These rows show the principal which of those is still missing.
// `detail` comes from GET /api/automation-readiness.
const AUTOMATION_STEPS = [
  { key: 'whatsapp', label: 'School WhatsApp number', to: null },
  { key: 'staff_whatsapp', label: 'Staff WhatsApp numbers', to: '/admin/manage?tab=classes', needs: 'Needed for every message to staff.' },
  { key: 'timetable', label: 'Timetable', to: '/admin/timetable', needs: 'Needed for substitution cover and class reminders.' },
  { key: 'syllabus', label: 'Syllabus calendar', to: '/syllabus', needs: 'Needed for the daily teaching guidance.' },
];

// v2: the checklist gained the automation rows above, so someone who closed
// the earlier version sees it once more.
const DISMISS_KEY = 'setupChecklistDismissed:v2';

export default function SetupChecklist() {
  const [counts, setCounts] = useState(null);
  const [automation, setAutomation] = useState(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    if (dismissed) return;
    Promise.all([
      apiRequest('/api/academics/classes'),
      apiRequest('/api/academics/subjects'),
      apiRequest('/api/academics/teachers'),
      apiRequest('/api/academics/students'),
      apiRequest('/api/academics/parents'),
    ])
      .then(([classes, subjects, teachers, students, parents]) => {
        setCounts({
          classes: classes.length,
          subjects: subjects.length,
          // The principal's own account is a teachers-table row too — it
          // doesn't count as "staff added" for checklist purposes.
          staff: teachers.filter((t) => t.role !== 'principal').length,
          students: students.length,
          parents: parents.length,
        });
      })
      // Best-effort nudge only — a failed fetch here should never block or
      // error the dashboard itself.
      .catch(() => {});
    apiRequest('/api/automation-readiness')
      .then((r) => setAutomation(Array.isArray(r?.items) ? r.items : []))
      .catch(() => setAutomation([]));
  }, [dismissed]);

  if (dismissed || !counts || automation === null) return null;

  const done = {
    classes: counts.classes > 0,
    subjects: counts.subjects > 0,
    staff: counts.staff > 0,
    students: counts.students > 0,
    parents: counts.parents > 0,
  };
  const basicsDone = Object.values(done).every(Boolean);
  const automationRows = AUTOMATION_STEPS
    .map((step) => ({ ...step, ...(automation.find((i) => i.key === step.key) || {}) }))
    .filter((row) => typeof row.done === 'boolean');
  const automationDone = automationRows.every((row) => row.done);
  if (basicsDone && automationDone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="rounded-2xl bg-terracotta/5 border border-terracotta/20 p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-terracotta-deep" />
          <h3 className="font-display text-lg text-ink">Finish setting up your school</h3>
        </div>
        <button onClick={dismiss} className="text-ink-soft hover:text-ink shrink-0" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!basicsDone && (
      <>
      <p className="text-sm text-ink-soft mt-1 mb-4">
        Signup only set up your classes — a few things still need adding before the school is fully live.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        {STEPS.map((s) => (
          <Link
            key={s.key}
            to={`/admin/manage?tab=${s.tab}`}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-cream-deep/70 hover:border-terracotta/40 bg-white transition"
          >
            {done[s.key] ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-ink-soft shrink-0" />
            )}
            <span className={done[s.key] ? 'text-ink-soft line-through' : 'text-ink'}>{s.label}</span>
          </Link>
        ))}
      </div>
      </>
      )}

      {!automationDone && (
        <div className={basicsDone ? 'mt-1' : 'mt-5'}>
          <p className="text-sm text-ink-soft mb-3">
            Automatic messages to staff only start once these are in place. Until then they stay silent.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {automationRows.map((row) => {
              const body = (
                <>
                  {row.done ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-ink-soft shrink-0 mt-0.5" />
                  )}
                  <span className="min-w-0">
                    <span className={`block ${row.done ? 'text-ink-soft line-through' : 'text-ink'}`}>{row.label}</span>
                    {!row.done && (
                      <span className="block text-xs text-ink-soft mt-0.5">
                        {row.detail}{row.needs ? `. ${row.needs}` : ''}
                      </span>
                    )}
                  </span>
                </>
              );
              const cls = 'flex items-start gap-2 text-sm px-3 py-2 rounded-lg border border-cream-deep/70 bg-white';
              return row.to && !row.done ? (
                <Link key={row.key} to={row.to} className={`${cls} hover:border-terracotta/40 transition`}>{body}</Link>
              ) : (
                <div key={row.key} className={cls}>{body}</div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
