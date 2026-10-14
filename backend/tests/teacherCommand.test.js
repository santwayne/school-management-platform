import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTeacherCommand, matchClassSubject } from '../utils/teacherCommand.js';

test('parses a homework draft with details and a due date', () => {
  const c = parseTeacherCommand('HOMEWORK 7A Maths: Chapter 4 exercises\nSolve Q1-10\nPage 45\ndue 20/10/2026');
  assert.deepEqual(c, { type: 'draft', kind: 'homework', header: '7A Maths', title: 'Chapter 4 exercises', details: 'Solve Q1-10\nPage 45', dueDate: '2026-10-20' });
});

test('parses a lesson plan and the short forms', () => {
  assert.equal(parseTeacherCommand('lesson plan 7A Maths: Fractions').kind, 'lesson_plan');
  assert.equal(parseTeacherCommand('hw 7A: Read ch 2').kind, 'homework');
  assert.equal(parseTeacherCommand('LP 7A: Intro').kind, 'lesson_plan');
});

test('reports a missing title or unreadable due date instead of guessing', () => {
  assert.equal(parseTeacherCommand('homework 7A Maths').error, 'missing_title');
  assert.equal(parseTeacherCommand('homework 7A Maths: x\ndue next week').error, 'bad_due');
});

test('share commands', () => {
  assert.deepEqual(parseTeacherCommand('SHARE HW 12'), { type: 'share', kind: 'homework', id: 12 });
  assert.deepEqual(parseTeacherCommand('share lesson plan #5'), { type: 'share', kind: 'lesson_plan', id: 5 });
  assert.equal(parseTeacherCommand('hello there'), null);
});

test('class/subject match must be unambiguous', () => {
  const opts = [
    { class_id: 1, class_name: '7A', subject_id: 10, subject_name: 'Maths' },
    { class_id: 1, class_name: '7A', subject_id: 11, subject_name: 'Science' },
    { class_id: 2, class_name: '8B', subject_id: 10, subject_name: 'Maths' },
  ];
  assert.equal(matchClassSubject('7A Maths', opts).subject_id, 10);
  assert.equal(matchClassSubject('8b', opts).class_id, 2);
  assert.equal(matchClassSubject('7A', opts), null); // two subjects in 7A
  assert.equal(matchClassSubject('9C Maths', opts), null);
});
