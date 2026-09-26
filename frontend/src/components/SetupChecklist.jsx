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

const DISMISS_KEY = 'setupChecklistDismissed';

export default function SetupChecklist() {
  const [counts, setCounts] = useState(null);
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
  }, [dismissed]);

  if (dismissed || !counts) return null;

  const done = {
    classes: counts.classes > 0,
    subjects: counts.subjects > 0,
    staff: counts.staff > 0,
    students: counts.students > 0,
    parents: counts.parents > 0,
  };
  if (Object.values(done).every(Boolean)) return null;

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
    </div>
  );
}
