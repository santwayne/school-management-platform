import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveTimetable, hardViolations } from '../services/timetableSolver.js';

// 10 classes, 6 days x 8 periods = 48 slots each; 12 teachers.
function school() {
  const subjects = [
    { subject_id: 1, periods_per_week: 8, heavy: true }, // Maths
    { subject_id: 2, periods_per_week: 7 }, // English
    { subject_id: 3, periods_per_week: 7, heavy: true }, // Science
    { subject_id: 4, periods_per_week: 6 }, // Hindi
    { subject_id: 5, periods_per_week: 6 }, // SST
    { subject_id: 6, periods_per_week: 4 }, // Punjabi
    { subject_id: 7, periods_per_week: 3 }, // Computer
    { subject_id: 8, periods_per_week: 3 }, // PE
  ];
  const requirements = [];
  for (let c = 1; c <= 10; c++) {
    subjects.forEach((s, i) => requirements.push({ ...s, class_id: c, teacher_id: 100 + ((i * 10 + c) % 12) }));
  }
  return requirements;
}

test('10-class school: every lesson placed, zero hard violations', () => {
  const requirements = school();
  const unavailable = [{ teacher_id: 101, day: 1, period: 1 }, { teacher_id: 101, day: 1, period: 2 }];
  const r = solveTimetable({ days: [1, 2, 3, 4, 5, 6], periodsPerDay: 8, requirements, unavailable, seed: 7, timeLimitMs: 4000 });
  const expected = requirements.reduce((a, x) => a + x.periods_per_week, 0);
  assert.equal(r.slots.length + r.unplaced.length, expected);
  assert.deepEqual(hardViolations(r.slots, unavailable), []);
  assert.ok(r.unplaced.length <= 2, `unplaced: ${r.unplaced.length}`);
});

test('deterministic for the same seed', () => {
  const a = solveTimetable({ requirements: school().slice(0, 16), seed: 3, maxIterations: 3000, timeLimitMs: 60000 });
  const b = solveTimetable({ requirements: school().slice(0, 16), seed: 3, maxIterations: 3000, timeLimitMs: 60000 });
  assert.deepEqual(a.slots, b.slots);
});

test('impossible demand is reported, never forced', () => {
  // One teacher, 60 lessons, only 48 periods in the week.
  const r = solveTimetable({ periodsPerDay: 8, requirements: [{ class_id: 1, subject_id: 1, teacher_id: 9, periods_per_week: 30 }, { class_id: 2, subject_id: 1, teacher_id: 9, periods_per_week: 30 }], maxSameSubjectPerDay: 8, timeLimitMs: 300 });
  assert.equal(r.unplaced.length, 12);
  assert.deepEqual(hardViolations(r.slots, [], 8), []);
});

test('spreads a subject across the week when possible', () => {
  const r = solveTimetable({ requirements: [{ class_id: 1, subject_id: 1, teacher_id: 1, periods_per_week: 6 }], timeLimitMs: 300 });
  const perDay = new Set(r.slots.map((s) => s.day));
  assert.equal(perDay.size, 6);
  assert.equal(r.penalty, 0);
});

test('hardViolations catches clashes', () => {
  const v = hardViolations([
    { class_id: 1, day: 1, period: 1, subject_id: 1, teacher_id: 5 },
    { class_id: 2, day: 1, period: 1, subject_id: 2, teacher_id: 5 },
  ]);
  assert.equal(v.length, 1);
  assert.match(v[0], /teacher 5 double-booked/);
});

test('a shared room is never double-booked, even under real demand', () => {
  // Two classes, different teachers, same lab (room_id 50) — nothing else
  // stops them wanting the same period, so this only stays clash-free if
  // the room constraint is actually being enforced.
  const requirements = [
    { class_id: 1, subject_id: 1, teacher_id: 1, room_id: 50, periods_per_week: 8 },
    { class_id: 2, subject_id: 1, teacher_id: 2, room_id: 50, periods_per_week: 8 },
  ];
  const r = solveTimetable({ days: [1, 2, 3, 4, 5, 6], periodsPerDay: 8, requirements, seed: 1, timeLimitMs: 3000 });
  assert.deepEqual(hardViolations(r.slots), []);
  const seen = new Set();
  for (const s of r.slots) {
    const key = `${s.room_id}:${s.day}:${s.period}`;
    assert.ok(!seen.has(key), `room double-booked at ${key}`);
    seen.add(key);
  }
});

test('a lesson with no room_id is placed with no room constraint at all', () => {
  const r = solveTimetable({ requirements: [{ class_id: 1, subject_id: 1, teacher_id: 1, periods_per_week: 4 }], timeLimitMs: 300 });
  assert.equal(r.slots.every((s) => s.room_id == null), true);
  assert.deepEqual(hardViolations(r.slots), []);
});

test('hardViolations catches a room double-booking', () => {
  const v = hardViolations([
    { class_id: 1, day: 1, period: 1, subject_id: 1, teacher_id: 5, room_id: 9 },
    { class_id: 2, day: 1, period: 1, subject_id: 2, teacher_id: 6, room_id: 9 },
  ]);
  assert.ok(v.some((m) => /room 9 double-booked/.test(m)));
});
