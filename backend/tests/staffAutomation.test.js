import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, substitutionNotice, canNotifyNow } from '../services/substitutionService.js';
import { reminderRecipient } from '../services/teachingReminderService.js';
import { isGuidanceDay } from '../services/dailyGuidanceService.js';
import { readinessChecklist } from '../services/automationReadiness.js';
import pool from '../config/db.js';

after(async () => pool.end());

const slot = { period_number: 2, start_time: '09:40:00', class_label: 'Class 6 A', subject_name: 'Mathematics' };

test('dayLabel', () => {
  assert.equal(dayLabel('2026-10-09'), 'Fri 9 Oct');
  assert.equal(dayLabel('2026-01-01'), 'Thu 1 Jan');
  assert.equal(dayLabel('not a date'), 'not a date');
});

test('a substitution for today says "today"', () => {
  const n = substitutionNotice({ slot, absentName: 'Amanpreet Singh', date: '2026-10-06', today: '2026-10-06' });
  assert.equal(n.isToday, true);
  assert.equal(n.title, 'Substitution today');
  assert.equal(n.body, 'Period 2 (09:40), Class 6 A, Mathematics for Amanpreet Singh.');
});

test('a substitution planned ahead names the day instead of "today"', () => {
  const n = substitutionNotice({ slot, absentName: 'Amanpreet Singh', lessonPlanTitle: 'Fractions', date: '2026-10-09', today: '2026-10-06' });
  assert.equal(n.isToday, false);
  assert.equal(n.title, 'Substitution on Fri 9 Oct');
  assert.equal(n.body, 'Period 2 (09:40), Class 6 A, Mathematics for Amanpreet Singh. Lesson plan: Fractions.');
});

test('notice copes with a slot that has no time or subject, and never contains a line break', () => {
  const n = substitutionNotice({ slot: { period_number: 1, class_label: 'Class 8A' }, absentName: 'A', lessonPlanTitle: 'Line one\nline two', date: 'x', today: 'x' });
  assert.equal(n.body, 'Period 1, Class 8A, class for A. Lesson plan: Line one line two.');
});

test('WhatsApp is not sent before the morning', () => {
  assert.equal(canNotifyNow('00:05:12', '06:30'), false);
  assert.equal(canNotifyNow('06:29:59', '06:30'), false);
  assert.equal(canNotifyNow('06:30:00', '06:30'), true);
  assert.equal(canNotifyNow('14:00:00.123+05:30', '06:30'), true);
});

test('class reminder goes to whoever is actually taking the period', () => {
  const regular = { regular_teacher_id: 3, sub_status: null, substitute_teacher_id: null, regular_absent: false };
  assert.deepEqual(reminderRecipient(regular), { teacherId: 3, covering: false });
  assert.deepEqual(reminderRecipient({ ...regular, sub_status: 'assigned', substitute_teacher_id: 9, regular_absent: true }), { teacherId: 9, covering: true });
  assert.equal(reminderRecipient({ ...regular, sub_status: 'unfilled', regular_absent: true }), null);
  assert.equal(reminderRecipient({ ...regular, regular_absent: true }), null);
  assert.equal(reminderRecipient({ ...regular, regular_teacher_id: null }), null);
});

test('daily guidance is for Monday to Saturday', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(isGuidanceDay), [true, true, true, true, true, true, false]);
});

test('setup checklist: an empty school needs everything', () => {
  const items = readinessChecklist({ whatsappConnected: false, staffTotal: 11, staffWithWhatsapp: 1, teachersTotal: 7, timetableSlots: 0, teachersWithPeriods: 0, chapters: 0, chaptersTagged: 0 });
  assert.deepEqual(items.map((i) => [i.key, i.done]), [['whatsapp', false], ['staff_whatsapp', false], ['timetable', false], ['syllabus', false]]);
  assert.equal(items[1].detail, '1 of 11 staff have a WhatsApp number');
  assert.equal(items[2].detail, 'No periods yet');
});

test('setup checklist: a fully set up school is all done', () => {
  const items = readinessChecklist({ whatsappConnected: true, staffTotal: 11, staffWithWhatsapp: 11, teachersTotal: 7, timetableSlots: 210, teachersWithPeriods: 7, chapters: 40, chaptersTagged: 40 });
  assert.ok(items.every((i) => i.done));
});

test('setup checklist: partly done is reported as not done, with the count', () => {
  const items = readinessChecklist({ whatsappConnected: true, staffTotal: 11, staffWithWhatsapp: 11, teachersTotal: 7, timetableSlots: 30, teachersWithPeriods: 5, chapters: 40, chaptersTagged: 12 });
  assert.equal(items[2].done, false);
  assert.equal(items[2].detail, '5 of 7 teachers have periods');
  assert.equal(items[3].detail, '12 of 40 chapters are linked to a subject');
});
