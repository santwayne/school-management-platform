import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { decide, formatSerial } from '../services/certificateService.js';
import pool from '../config/db.js';

after(async () => pool.end());
const student = { class_id: 3 };

test('bonafide and character are issued automatically', () => {
  assert.equal(decide({ type: 'bonafide', student, duesAmount: 5000 }).action, 'issue');
  assert.equal(decide({ type: 'character_certificate', student, duesAmount: 0 }).action, 'issue');
});

test('fee certificate waits for dues', () => {
  assert.equal(decide({ type: 'fee_certificate', student, duesAmount: 0 }).action, 'issue');
  const d = decide({ type: 'fee_certificate', student, duesAmount: 16500 });
  assert.equal(d.action, 'blocked');
  assert.match(d.reason, /16,500/);
});

test('TC always needs the principal, and is blocked with dues', () => {
  assert.deepEqual(decide({ type: 'leaving_certificate', student, duesAmount: 0 }).action, 'approval');
  assert.equal(decide({ type: 'leaving_certificate', student, duesAmount: 0 }).blocked, undefined);
  assert.equal(decide({ type: 'leaving_certificate', student, duesAmount: 100 }).blocked, true);
});

test('unknown types and students without a class go to staff', () => {
  assert.equal(decide({ type: 'id_card', student, duesAmount: 0 }).action, 'manual');
  assert.equal(decide({ type: 'bonafide', student: { class_id: null }, duesAmount: 0 }).action, 'manual');
});

test('serial format', () => {
  assert.equal(formatSerial('leaving_certificate', 2026, 7), 'TC/2026/0007');
  assert.equal(formatSerial('bonafide', 2026, 123), 'BC/2026/0123');
});
