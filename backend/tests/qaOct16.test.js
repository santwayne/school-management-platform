import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale } from '../services/opsService.js';

test('daily plan (Mon–Sat) is not stale on Monday morning before the 7:30 run', async () => {
  const row = { expected_interval_minutes: 2160, last_run_at: new Date('2026-10-17T02:00:00Z') }; // Sat 7:30 IST
  assert.equal(isStale(row, new Date('2026-10-19T01:30:00Z')), false); // Mon 7:00 IST
  assert.equal(isStale(row, new Date('2026-10-21T02:00:00Z')), true); // Wed — really missed
});

import { componentsFor, effectiveMonthly, computePay } from '../services/payrollService.js';

test('role salary: personal salary wins, otherwise the role amount, otherwise not paid', () => {
  assert.equal(effectiveMonthly(30000, 20000), 30000);
  assert.equal(effectiveMonthly(null, 20000), 20000);
  assert.equal(effectiveMonthly(null, null), null);
  assert.equal(effectiveMonthly(0, 20000), 0);
});

test('role-scoped components only apply to that role', () => {
  const comps = [
    { teacher_id: null, role: null, name: 'DA', kind: 'earning', calc: 'fixed', value: 1000 },
    { teacher_id: null, role: 'teacher', name: 'Teaching allowance', kind: 'earning', calc: 'fixed', value: 500 },
    { teacher_id: 9, role: null, name: 'Advance', kind: 'deduction', calc: 'fixed', value: 200 },
  ];
  assert.deepEqual(componentsFor({ id: 1, role: 'teacher' }, comps).map((c) => c.name), ['DA', 'Teaching allowance']);
  assert.deepEqual(componentsFor({ id: 2, role: 'accountant' }, comps).map((c) => c.name), ['DA']);
  assert.deepEqual(componentsFor({ id: 9, role: 'librarian' }, comps).map((c) => c.name), ['DA', 'Advance']);
  const pay = computePay({ base: effectiveMonthly(null, 20000), workingDays: 26, components: componentsFor({ id: 1, role: 'teacher' }, comps) });
  assert.ok(pay.gross >= 21500, `gross ${pay.gross}`);
});
