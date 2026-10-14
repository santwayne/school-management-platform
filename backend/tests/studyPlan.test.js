import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyPlan, workingDays, StudyPlanError } from '../utils/studyPlan.js';

const items = [
  { subject_id: 1, subject_name: 'Maths', chapter_name: 'Fractions', weight: 2 },
  { subject_id: 1, subject_name: 'Maths', chapter_name: 'Decimals', weight: 1 },
  { subject_id: 2, subject_name: 'Science', chapter_name: 'Light', weight: 1 },
];

test('workingDays skips Sundays and excludes the exam day', () => {
  // 2026-10-05 is a Monday; exam on Monday the 12th -> Mon..Sat = 6 days.
  assert.deepEqual(workingDays('2026-10-05', '2026-10-12'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
});

test('every chapter gets a lesson plan and homework, all dates inside the window', () => {
  const plan = buildStudyPlan({ items, startDate: '2026-10-05', examDate: '2026-11-02' });
  for (const c of items) {
    assert.ok(plan.some((p) => p.chapter_name === c.chapter_name && p.activity_type === 'lesson_plan'), c.chapter_name);
    assert.ok(plan.some((p) => p.chapter_name === c.chapter_name && p.activity_type === 'homework'), c.chapter_name);
  }
  assert.ok(plan.every((p) => p.planned_date >= '2026-10-05' && p.planned_date < '2026-11-02'));
  assert.ok(plan.every((p) => new Date(`${p.planned_date}T00:00:00Z`).getUTCDay() !== 0), 'no Sundays');
});

test('ends with revision and a full-syllabus mock test the day before the exam', () => {
  const plan = buildStudyPlan({ items, startDate: '2026-10-05', examDate: '2026-11-02' });
  const last = plan[plan.length - 1];
  assert.equal(last.title, 'Mock test — full syllabus');
  assert.equal(last.planned_date, '2026-10-31'); // 1 Nov is a Sunday, so the mock test is Saturday
  assert.ok(plan.some((p) => p.activity_type === 'revision'));
});

test('heavier chapters get more days', () => {
  const plan = buildStudyPlan({ items, startDate: '2026-10-05', examDate: '2026-11-02' });
  const days = (name) => new Set(plan.filter((p) => p.chapter_name === name && p.activity_type !== 'revision').map((p) => p.planned_date)).size;
  assert.ok(days('Fractions') >= days('Decimals'));
});

test('refuses impossible or invalid input with a plain message', () => {
  assert.throws(() => buildStudyPlan({ items, startDate: '2026-10-05', examDate: '2026-10-06' }), StudyPlanError);
  assert.throws(() => buildStudyPlan({ items, startDate: '2026-10-05', examDate: '2026-10-05' }), /after the start/);
  assert.throws(() => buildStudyPlan({ items: [], startDate: '2026-10-05', examDate: '2026-11-02' }), /syllabus/);
  assert.throws(() => buildStudyPlan({ items, startDate: 'x', examDate: '2026-11-02' }), /valid/);
});
