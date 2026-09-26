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

test('PF/ESI are off by default, even at wages that would qualify', () => {
  const p = computePay({ base: 10000, workingDays: 25 });
  assert.equal(p.deductions.length, 0);
  assert.equal(p.net, 10000);
});

test('PF is 12% of basic, capped at the 15,000 wage ceiling', () => {
  const below = computePay({ base: 10000, workingDays: 25, pfEnabled: true });
  assert.equal(below.deductions.find((d) => d.name.includes('Provident Fund')).amount, 1200);

  const above = computePay({ base: 30000, workingDays: 25, pfEnabled: true });
  assert.equal(above.deductions.find((d) => d.name.includes('Provident Fund')).amount, 1800, '12% of the 15,000 ceiling, not of the full 30,000 basic');
});

test('ESI applies only when gross is at or below 21,000/month', () => {
  const eligible = computePay({ base: 20000, workingDays: 25, esiEnabled: true });
  assert.equal(eligible.deductions.find((d) => d.name === 'ESI').amount, 150);

  const overThreshold = computePay({ base: 25000, workingDays: 25, esiEnabled: true });
  assert.equal(overThreshold.deductions.find((d) => d.name === 'ESI'), undefined, 'above 21,000 gross is outside the scheme entirely, not capped');
});

test('PF and ESI stack correctly with each other and with loss-of-pay', () => {
  const p = computePay({ base: 10000, workingDays: 25, lopDays: 1, pfEnabled: true, esiEnabled: true });
  const pf = p.deductions.find((d) => d.name.includes('Provident Fund')).amount;
  const esi = p.deductions.find((d) => d.name === 'ESI').amount;
  assert.equal(pf, 1200);
  assert.equal(esi, 75); // 0.75% of the 10,000 gross (LOP reduces net pay, not the ESI wage base)
  assert.equal(p.deductions_total, pf + esi + 400); // 400 = one day's LOP on a 25-working-day month
});
