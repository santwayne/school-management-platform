import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNotifyDate } from '../utils/notifyDate.js';

test('formats a pg DATE (JS Date at local midnight) as the same calendar day', () => {
  assert.equal(formatNotifyDate(new Date(2026, 9, 8)), '8 Oct 2026');
  assert.equal(formatNotifyDate(new Date(2026, 0, 31)), '31 Jan 2026');
});

test('formats YYYY-MM-DD strings (as typed in the leave form) the same way', () => {
  assert.equal(formatNotifyDate('2026-10-08'), '8 Oct 2026');
  assert.equal(formatNotifyDate('2026-10-10T00:00:00.000Z'), '10 Oct 2026');
});

test('never throws: empty, invalid and free-text values', () => {
  assert.equal(formatNotifyDate(null), '');
  assert.equal(formatNotifyDate(''), '');
  assert.equal(formatNotifyDate(new Date('nope')), '');
  assert.equal(formatNotifyDate('no due date'), 'no due date');
});
