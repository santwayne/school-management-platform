// Splits an exam's syllabus into a dated pattern of lesson plans, homework,
// chapter tests and revision between a start date and the exam date.
// Pure (no database) so it is unit-tested directly.
//
// Pattern per chapter, by how many working days the chapter is allotted:
//   1 day   lesson plan (+ homework the same day)
//   2 days  lesson plan, homework
//   3 days  lesson plan, homework, chapter test
//   4+ days lesson plan part 1..n-2, homework, chapter test
// The last REVISION_SHARE of the window is revision (rotating through the
// subjects), and the final working day before the exam is a full mock test.
// Sundays are skipped.

const DAY_MS = 24 * 60 * 60 * 1000;
const REVISION_SHARE = 0.15;

export class StudyPlanError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const toTime = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

export function isIsoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Working days from startDate up to (not including) examDate, Sundays skipped.
export function workingDays(startDate, examDate) {
  const days = [];
  for (let t = toTime(startDate); t < toTime(examDate); t += DAY_MS) {
    if (new Date(t).getUTCDay() !== 0) days.push(toIso(t));
  }
  return days;
}

// Spreads `total` days across weights (largest-remainder), at least 1 each.
function allocate(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let used = out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; used < total && k < order.length * 2; k++, used++) out[order[k % order.length].i] += 1;
  // Over-allocated by the min-1 rule: take back from the biggest chapters.
  while (used > total) {
    const big = out.indexOf(Math.max(...out));
    if (out[big] <= 1) break;
    out[big] -= 1;
    used -= 1;
  }
  return out;
}

// items: [{ subject_id, subject_name, chapter_name, topics?, weight? }] in
// teaching order. Returns [{ activity_type, title, subject_id, chapter_name,
// planned_date, sort_order }] sorted by date.
export function buildStudyPlan({ items, startDate, examDate }) {
  if (!isIsoDate(startDate) || !isIsoDate(examDate)) throw new StudyPlanError('Enter a valid start date and exam date.');
  if (examDate <= startDate) throw new StudyPlanError('The exam date must be after the start date.');
  if (!items?.length) throw new StudyPlanError('Add the exam syllabus (chapters) first.');

  const days = workingDays(startDate, examDate);
  const mockDay = days.length > 1 ? days.pop() : null;
  const revisionDays = days.length >= items.length + 2 ? Math.max(1, Math.round(days.length * REVISION_SHARE)) : 0;
  const teachingDays = days.slice(0, days.length - revisionDays);
  const revisionSlots = days.slice(days.length - revisionDays);
  if (teachingDays.length < items.length) {
    throw new StudyPlanError(`There are only ${teachingDays.length} teaching days for ${items.length} chapters — move the start date earlier or the exam date later.`);
  }

  // Interleave subjects (round-robin) so every subject keeps moving.
  const bySubject = new Map();
  for (const it of items) {
    if (!bySubject.has(it.subject_id)) bySubject.set(it.subject_id, []);
    bySubject.get(it.subject_id).push(it);
  }
  const queues = [...bySubject.values()];
  const ordered = [];
  for (let i = 0; ordered.length < items.length; i++) {
    for (const q of queues) if (q[i]) ordered.push(q[i]);
  }

  const allotted = allocate(ordered.map((c) => Number(c.weight) > 0 ? Number(c.weight) : 1), teachingDays.length);
  const plan = [];
  let cursor = 0;
  const add = (type, c, date, title) => plan.push({ activity_type: type, title, subject_id: c.subject_id, chapter_name: c.chapter_name, planned_date: date });

  ordered.forEach((c, idx) => {
    const n = allotted[idx];
    const span = teachingDays.slice(cursor, cursor + n);
    cursor += n;
    const label = `${c.subject_name ? `${c.subject_name}: ` : ''}${c.chapter_name}`;
    if (n === 1) {
      add('lesson_plan', c, span[0], `Teach — ${label}`);
      add('homework', c, span[0], `Homework — ${label}`);
    } else {
      const lessonDays = n >= 3 ? n - 2 : 1;
      for (let d = 0; d < lessonDays; d++) add('lesson_plan', c, span[d], lessonDays > 1 ? `Teach (part ${d + 1}/${lessonDays}) — ${label}` : `Teach — ${label}`);
      add('homework', c, span[lessonDays], `Homework — ${label}`);
      if (n >= 3) add('test', c, span[n - 1], `Chapter test — ${label}`);
    }
  });

  const subjects = queues.map((q) => q[0]);
  revisionSlots.forEach((date, i) => {
    const s = subjects[i % subjects.length];
    add('revision', s, date, `Revision — ${s.subject_name || 'all chapters'}`);
  });
  if (mockDay) add('test', { subject_id: subjects[0].subject_id, chapter_name: 'Full syllabus' }, mockDay, 'Mock test — full syllabus');

  const rank = { lesson_plan: 0, homework: 1, revision: 2, test: 3 };
  return plan
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || rank[a.activity_type] - rank[b.activity_type])
    .map((p, i) => ({ ...p, sort_order: i }));
}
