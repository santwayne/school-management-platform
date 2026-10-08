import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  daysLabel,
  overdueListText,
  libraryDigestParams,
  DEFAULT_LIBRARY_DIGEST_TEMPLATE,
  LEGACY_LIBRARY_DIGEST_TEMPLATE,
} from '../utils/messageFormat.js';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('a count of days carries its own unit', () => {
  assert.equal(daysLabel('3.0'), '3 days'); // was "3.0 day(s)"
  assert.equal(daysLabel(1), '1 day');
  assert.equal(daysLabel('0.5'), '0.5 day');
  assert.equal(daysLabel('2.5'), '2.5 days');
  assert.equal(daysLabel(null), '0 day');
});

test('the overdue list names book, borrower, class and how late', () => {
  const items = [
    { title: 'Maths Book 6', borrower: 'Aarav Mehta', className: 'Class 6A', daysLate: 3 },
    { title: 'Staff Handbook', borrower: 'Amanpreet Singh', className: null, daysLate: 1 },
  ];
  assert.equal(
    overdueListText(items),
    'Maths Book 6 - Aarav Mehta (Class 6A), 3 days late; Staff Handbook - Amanpreet Singh, 1 day late'
  );
  assert.equal(overdueListText([]), '');
});

test('the overdue list shows five books and counts the rest', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ title: `Book ${i + 1}`, borrower: 'A', className: 'C', daysLate: 2 }));
  const text = overdueListText(items);
  assert.ok(text.includes('Book 5 - A (C), 2 days late'));
  assert.ok(!text.includes('Book 6'));
  assert.ok(text.endsWith(' and 3 more'));
});

test('the overdue list is safe as one WhatsApp variable', () => {
  const text = overdueListText([{ title: 'A\n  Tale\tof     Two', borrower: '  Aarav \n Mehta ', className: ' 6A ', daysLate: '4' }]);
  assert.equal(text, 'A Tale of Two - Aarav Mehta (6A), 4 days late');
  assert.ok(!/[\n\t]| {5,}/.test(text));
});

test('library digest variables follow the template being sent', () => {
  const digest = { dueSoon: 2, overdueItems: [{ title: 'B', borrower: 'S', className: 'C', daysLate: 1 }] };
  assert.deepEqual(libraryDigestParams(DEFAULT_LIBRARY_DIGEST_TEMPLATE, digest), ['1', 'B - S (C), 1 day late', '2']);
  // the earlier counts-only template: {{1}} due soon, {{2}} overdue
  assert.deepEqual(libraryDigestParams(LEGACY_LIBRARY_DIGEST_TEMPLATE, digest), ['2', '1']);
});

// What each worker sends must cover every variable its template row asks for;
// a missing one goes out as an empty value, which Meta rejects.
const TEMPLATES = [
  { event: 'recurring_doubt_signal', name: 'recurring_doubt_class_update', order: ['chapter_tag', 'class_name', 'student_count'], worker: '../workers/recurringDoubtWorker.js' },
  { event: 'staff_leave_pending_reminder', name: 'staff_leave_pending_review_alert', order: ['teacher_name', 'leave_type', 'days_label', 'start_date', 'end_date'], worker: '../workers/staffLeaveReminderWorker.js' },
  { event: 'petty_cash_pending_reminder', name: 'petty_cash_pending_review_alert', order: ['requested_by', 'amount', 'pending_label'], worker: '../workers/pettyCashReminderWorker.js' },
  { event: 'low_attendance_alert', name: 'low_attendance_threshold_alert', order: ['student_name', 'attendance_percent', 'window_days', 'threshold_percent'], worker: '../workers/lowAttendanceAlertWorker.js' },
];

test('schema seeds and moves each reworded template with its variable order', () => {
  const schema = read('../models/schema.sql');
  for (const t of TEMPLATES) {
    const seeded = `'${t.name}', '${JSON.stringify(t.order)}'::jsonb`;
    assert.ok(schema.includes(seeded), `seed for ${t.event}`);
    const move = new RegExp(`UPDATE notification_templates\\s+SET whatsapp_template_name = '${t.name}'[^;]*trigger_event = '${t.event}'[^;]*;`);
    const statement = move.exec(schema);
    assert.ok(statement, `move for ${t.event}`);
    // recurring doubt keeps its three variables, so only its name moves
    if (t.event !== 'recurring_doubt_signal') assert.ok(statement[0].includes(JSON.stringify(t.order)), `order for ${t.event}`);
  }
});

test('each worker sends every variable its template asks for', () => {
  for (const t of TEMPLATES) {
    const source = read(t.worker);
    for (const key of t.order) {
      if (key === 'student_name') continue; // filled in per recipient by NotificationService
      assert.ok(new RegExp(`\\b${key}:`).test(source), `${t.worker} sends ${key}`);
    }
  }
});
