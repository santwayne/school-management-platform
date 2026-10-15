import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  yearlyPricePaise, prorateUpgradePaise, effectiveState, isPlanReadOnly, hasAi, defaultPeriodEnd, gstPaise,
} from '../services/planMath.js';

const core = { per_student_yearly_paise: 40000, min_yearly_paise: 2500000 };
const ai = { per_student_yearly_paise: 65000, min_yearly_paise: 3500000 };
const now = new Date('2026-10-15T12:00:00+05:30');
const day = (n) => new Date(now.getTime() + n * 86400000);

test('yearly price = students × rate, never below the minimum', () => {
  assert.equal(yearlyPricePaise(core, 100), 4000000);   // ₹40,000
  assert.equal(yearlyPricePaise(ai, 100), 6500000);     // ₹65,000
  assert.equal(yearlyPricePaise(core, 20), 2500000);    // minimum ₹25,000
  assert.equal(yearlyPricePaise(ai, 0), 3500000);
  assert.equal(gstPaise(4000000), 720000);
});

test('mid-year Core → AI upgrade charges only the difference for days left', () => {
  // 100 students, half a year left: (65,000 − 40,000) × 182.5/365 ≈ ₹12,500
  const p = prorateUpgradePaise({ fromPlan: core, toPlan: ai, students: 100, paidUntil: new Date(now.getTime() + 182.5 * 86400000), now });
  assert.ok(Math.abs(p - 1250000) < 7000, String(p));
  assert.equal(prorateUpgradePaise({ fromPlan: ai, toPlan: core, students: 100, paidUntil: day(100), now }), 0);
});

test('demo: active, then ended → read-only, AI off', () => {
  const s = { plan: 'ai', plan_state: 'demo', demo_ends_at: day(3) };
  assert.equal(effectiveState(s, now), 'demo');
  assert.equal(hasAi(s, now), true);
  assert.equal(isPlanReadOnly(s, now), false);
  const ended = { ...s, demo_ends_at: day(-1) };
  assert.equal(effectiveState(ended, now), 'demo_expired');
  assert.equal(isPlanReadOnly(ended, now), true);
  assert.equal(hasAi(ended, now), false);
});

test('paid: valid through the last day (IST), then grace, then expired', () => {
  process.env.PLAN_GRACE_DAYS = '7';
  const s = { plan: 'core', plan_state: 'paid', paid_until: '2026-10-15' };
  assert.equal(effectiveState(s, now), 'paid');
  assert.equal(effectiveState(s, new Date('2026-10-15T23:30:00+05:30')), 'paid');
  assert.equal(effectiveState(s, new Date('2026-10-17T10:00:00+05:30')), 'grace');
  assert.equal(isPlanReadOnly(s, new Date('2026-10-17T10:00:00+05:30')), false);
  assert.equal(effectiveState(s, new Date('2026-10-23T10:00:00+05:30')), 'expired');
  assert.equal(isPlanReadOnly(s, new Date('2026-10-23T10:00:00+05:30')), true);
});

test('AI access follows the plan', () => {
  assert.equal(hasAi({ plan: 'core', plan_state: 'paid', paid_until: '2027-01-01' }, now), false);
  assert.equal(hasAi({ plan: 'ai', plan_state: 'paid', paid_until: '2027-01-01' }, now), true);
  assert.equal(hasAi({ plan: 'core', plan_state: 'none' }, now), false);
  assert.equal(hasAi({ plan: 'growth', plan_state: 'legacy' }, now), true, 'retired plans keep AI until moved');
  assert.equal(hasAi({ plan: 'ai', plan_state: 'expired' }, now), false);
  assert.equal(isPlanReadOnly({ plan: 'growth', plan_state: 'legacy' }, now), false);
  assert.equal(isPlanReadOnly({ plan: 'core', plan_state: 'none' }, now), false);
});

test('default period is one year minus a day', () => {
  assert.equal(defaultPeriodEnd('2026-10-15'), '2027-10-14');
  assert.equal(defaultPeriodEnd('2028-03-01'), '2029-02-28');
});
