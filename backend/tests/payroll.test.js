import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { computePay, countWorkingDays, periodLabel } from '../services/payrollService.js';
import pool from '../config/db.js';

after(async () => pool.end());

test('working days: Mon–Sat minus holidays', () => {
  assert.equal(countWorkingDays('2026-09'), 26);
  assert.equal(countWorkingDays('2026-09', ['2026-09-29']), 25);
  assert.equal(countWorkingDays('2026-09', ['2026-09-27']), 26, 'a Sunday holiday changes nothing');
  assert.equal(countWorkingDays('2026-02'), 24);
});

test('base + percentage and fixed components', () => {
  const p = computePay({ base: 30000, workingDays: 25, components: [
    { name: 'HRA', kind: 'earning', calc: 'percent_of_base', value: 10 },
    { name: 'Transport', kind: 'earning', calc: 'fixed', value: 1500 },
    { name: 'PF', kind: 'deduction', calc: 'percent_of_base', value: 12 },
  ] });
  assert.equal(p.gross, 34500);
  assert.equal(p.deductions_total, 3600);
  assert.equal(p.net, 30900);
});

test('loss of pay is per working day, capped at the month', () => {
  assert.equal(computePay({ base: 30000, workingDays: 25, lopDays: 2 }).net, 27600);
  assert.equal(computePay({ base: 30000, workingDays: 25, lopDays: 0.5 }).net, 29400);
  assert.equal(computePay({ base: 30000, workingDays: 25, lopDays: 40 }).net, 0);
});

test('negative net is floored and flagged', () => {
  const p = computePay({ base: 10000, workingDays: 25, components: [{ name: 'Advance recovery', kind: 'deduction', calc: 'fixed', value: 15000 }] });
  assert.equal(p.net, 0);
  assert.equal(p.negative, true);
});

test('periodLabel', () => assert.equal(periodLabel('2026-09'), 'September 2026'));
