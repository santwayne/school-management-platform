import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, explain } from '../services/substitutionService.js';
import pool from '../config/db.js';

after(async () => pool.end());

const t = (id, { subjects = [], classes = [], week = 0, today = 0, periods = 0 } = {}) => ({
  id, name: `T${id}`, subjectIds: new Set(subjects), classIds: new Set(classes), subsThisWeek: week, subsToday: today, periodsToday: periods,
});

test('same subject beats knowing the class', () => {
  const r = rankCandidates({ subject_id: 1, class_id: 10 }, [t(1, { classes: [10] }), t(2, { subjects: [1] })]);
  assert.equal(r[0].id, 2);
});

test('knowing the class beats a stranger', () => {
  const r = rankCandidates({ subject_id: 1, class_id: 10 }, [t(1), t(2, { classes: [10] })]);
  assert.equal(r[0].id, 2);
});

test('load is spread: fewer substitutions this week wins among equals', () => {
  const r = rankCandidates({ subject_id: 1, class_id: 10 }, [t(1, { subjects: [1], week: 3 }), t(2, { subjects: [1], week: 0 })]);
  assert.equal(r[0].id, 2);
});

test('daily cap excludes teachers', () => {
  const r = rankCandidates({ subject_id: 1, class_id: 10 }, [t(1, { subjects: [1], today: 2 }), t(2)], { maxPerDay: 2 });
  assert.deepEqual(r.map((c) => c.id), [2]);
  assert.equal(rankCandidates({ subject_id: 1, class_id: 10 }, [t(1, { today: 1 })], { maxPerDay: 1 }).length, 0);
});

test('stable tie-break by id and readable reason', () => {
  const r = rankCandidates({ subject_id: 1, class_id: 10 }, [t(5), t(3)]);
  assert.deepEqual(r.map((c) => c.id), [3, 5]);
  assert.match(explain(rankCandidates({ subject_id: 1, class_id: 10 }, [t(1, { subjects: [1], classes: [10] })])[0]), /teaches this subject, already teaches this class/);
});
