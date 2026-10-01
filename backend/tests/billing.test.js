import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withGst, splitGst, financialYear, formatInvoiceNumber, prorationPaise, classifyChange, downgradeBlockers, isReadOnly,
} from '../services/billingMath.js';

test('GST: District ₹29,999 + 18% = ₹35,398.82', () => {
  assert.equal(withGst(2999900), 3539882);
});

test('GST split: Punjab buyer → CGST+SGST, other state → IGST, always reconciles', () => {
  const intra = splitGst(3539882, '03', '03');
  assert.equal(intra.igst, 0);
  assert.equal(intra.taxable + intra.cgst + intra.sgst, 3539882);
  assert.equal(intra.taxable, 2999900);
  const inter = splitGst(3539882, '03', '07');
  assert.equal(inter.cgst + inter.sgst, 0);
  assert.equal(inter.taxable + inter.igst, 3539882);
  assert.equal(splitGst(100, '03', null).igst > 0, true, 'unknown state → IGST');
});

test('financial year flips on 1 April IST', () => {
  assert.equal(financialYear(new Date('2026-03-31T18:30:00Z')), '2026-27'); // 1 Apr 00:00 IST
  assert.equal(financialYear(new Date('2026-03-31T18:00:00Z')), '2025-26'); // 31 Mar 23:30 IST
  assert.equal(formatInvoiceNumber('WN', '2026-27', 42), 'WN/2026-27/00042');
});

test('proration: upgrade halfway through the month pays half the difference', () => {
  const p = prorationPaise({
    oldPricePaise: 1299900, newPricePaise: 2999900,
    periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-31T00:00:00Z', now: new Date('2026-10-16T00:00:00Z'),
  });
  assert.equal(p, 850000);
  assert.equal(prorationPaise({ oldPricePaise: 2999900, newPricePaise: 499900, periodStart: '2026-10-01', periodEnd: '2026-10-31', now: new Date('2026-10-10') }), 0);
  assert.equal(prorationPaise({ oldPricePaise: 1, newPricePaise: 2, periodStart: '2026-10-01', periodEnd: '2026-10-31', now: new Date('2026-11-05') }), 0);
});

test('change classification + downgrade blockers', () => {
  const starter = { code: 'starter', name: 'Starter', rank: 1, student_limit: 100, accountant_seats: 0 };
  const growth = { code: 'growth', name: 'Growth', rank: 2, student_limit: 500, accountant_seats: 2 };
  assert.equal(classifyChange(starter, growth), 'upgrade');
  assert.equal(classifyChange(growth, starter), 'downgrade');
  assert.equal(classifyChange(null, growth), 'new');
  assert.equal(downgradeBlockers({ students: 140, accountants: 1 }, starter).length, 2);
  assert.equal(downgradeBlockers({ students: 90, accountants: 0 }, starter).length, 0);
});

test('read-only only after grace / paid period ends', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  assert.equal(isReadOnly({ billing_status: 'halted', billing_grace_until: '2026-10-12' }, now), false);
  assert.equal(isReadOnly({ billing_status: 'halted', billing_grace_until: '2026-10-09' }, now), true);
  assert.equal(isReadOnly({ billing_status: 'cancelled', current_period_end: '2026-10-31' }, now), false);
  assert.equal(isReadOnly({ billing_status: 'cancelled', current_period_end: '2026-10-01' }, now), true);
  assert.equal(isReadOnly({ billing_status: 'payment_pending' }, now), false);
  assert.equal(isReadOnly({ billing_status: 'active' }, now), false);
});
