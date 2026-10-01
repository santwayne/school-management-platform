import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyMode, validatePlanPatch, razorpayPlanProblems } from '../services/planAdmin.js';

const growth = { code: 'growth', name: 'Growth', price_paise: '1299900', yearly_price_paise: '12999000', student_limit: 500, accountant_seats: 2 };

test('keyMode tells test and live keys apart', () => {
  assert.equal(keyMode('rzp_test_abc'), 'test');
  assert.equal(keyMode('rzp_live_abc'), 'live');
  assert.equal(keyMode(''), 'none');
  assert.equal(keyMode('something'), 'unknown');
});

test('plan patch: only real changes are returned, rupees become paise', () => {
  const { changes, errors } = validatePlanPatch(
    { name: 'Growth', price: '12999', yearly_price: 139990, student_limit: '600', accountant_seats: 2 }, growth);
  assert.deepEqual(errors, []);
  assert.deepEqual(changes, { yearly_price_paise: 13999000, student_limit: 600 });
});

test('plan patch: accountant seats are no longer a plan setting (ignored)', () => {
  const { changes, errors } = validatePlanPatch({ accountant_seats: 7 }, growth);
  assert.deepEqual(errors, []);
  assert.deepEqual(changes, {});
});

test('plan patch: monthly price change is detected (needs a new Razorpay plan)', () => {
  const { changes } = validatePlanPatch({ price: 13499.5 }, growth);
  assert.equal(changes.price_paise, 1349950);
});

test('plan patch: unlimited students and clearing yearly price', () => {
  const { changes, errors } = validatePlanPatch({ student_limit: 0, unlimited_students: true, yearly_price: '' }, growth);
  assert.deepEqual(errors, []);
  assert.equal(changes.student_limit, 999999);
  assert.equal(changes.yearly_price_paise, null);
});

test('plan patch: bad input is rejected', () => {
  const { errors } = validatePlanPatch({ name: 'x', price: 0, student_limit: -5, yearly_price: 'abc' }, growth);
  assert.equal(errors.length, 4);
});

test('razorpay plan check: correct GST-inclusive monthly plan passes', () => {
  const ok = { id: 'plan_1', period: 'monthly', interval: 1, item: { amount: 1533882, currency: 'INR' } };
  assert.deepEqual(razorpayPlanProblems(ok, 1299900), []);
});

test('razorpay plan check: pre-GST amount or wrong cycle is flagged', () => {
  const preGst = { id: 'plan_2', period: 'monthly', interval: 1, item: { amount: 1299900, currency: 'INR' } };
  assert.match(razorpayPlanProblems(preGst, 1299900)[0], /should be ₹15338\.82/);
  const yearly = { id: 'plan_3', period: 'yearly', interval: 1, item: { amount: 1533882, currency: 'INR' } };
  assert.match(razorpayPlanProblems(yearly, 1299900)[0], /every 1 monthly/);
  assert.deepEqual(razorpayPlanProblems(null, 1), ['Plan not found in Razorpay']);
});
