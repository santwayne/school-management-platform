import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeDues } from '../utils/feeDues.js';
import pool from '../config/db.js';

after(async () => { await pool.end(); });

test('dues = class fee − tuition paid this year + unpaid transport', () => {
  assert.deepEqual(computeDues({ fee_amount: '24000.00', paid_this_year: '6000', transport_due: '1500' }),
    { tuition: 18000, transport: 1500, total: 19500, configured: true });
});

test('regression: no student_payment row no longer means ₹0 dues', () => {
  // Old code returned 0 here because amount_due was never written.
  assert.equal(computeDues({ fee_amount: '12000', paid_this_year: 0, transport_due: 0 }).total, 12000);
});

test('overpayment clamps at zero, never negative', () => {
  assert.equal(computeDues({ fee_amount: '5000', paid_this_year: '9000', transport_due: 0 }).tuition, 0);
});

test('class with no fee structure is flagged unconfigured, not "no dues"', () => {
  const d = computeDues({ fee_amount: null, paid_this_year: 0, transport_due: '800' });
  assert.equal(d.configured, false);
  assert.equal(d.total, 800);
});
