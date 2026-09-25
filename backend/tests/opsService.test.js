import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseCounts, deriveStatus, isStale, maxSeverity } from '../services/opsService.js';
import digestWorker, { sanitizeTemplateParam, fallbackDigestLine } from '../workers/dailyDigestWorker.js';
import pool from '../config/db.js';
import { connection } from '../config/queue.js';

// These modules open a DB pool, a Redis connection and a BullMQ worker on
// import; close them so the test process exits.
after(async () => {
  await digestWorker.close();
  await pool.end();
  connection.disconnect();
});
import { istParts, isSchoolHours } from '../workers/healthCheck.js';

test('parseCounts handles every worker return shape', () => {
  assert.deepEqual(parseCounts(undefined), { total: 0, succeeded: 0, failed: 0 });
  assert.deepEqual(parseCounts(5), { total: 5, succeeded: 5, failed: 0 });
  assert.deepEqual(parseCounts({ sent: 8, failed: 2 }), { total: 10, succeeded: 8, failed: 2 });
  assert.deepEqual(parseCounts({ sent: 3, failed: 1, skipped: 2 }), { total: 6, succeeded: 3, failed: 1 });
  assert.deepEqual(parseCounts({ processed: 4 }), { total: 4, succeeded: 4, failed: 0 });
  assert.deepEqual(parseCounts({ total: 10, succeeded: 9, failed: 1 }), { total: 10, succeeded: 9, failed: 1 });
  assert.deepEqual(parseCounts('weird'), { total: 0, succeeded: 0, failed: 0 });
});

test('deriveStatus', () => {
  assert.equal(deriveStatus({ succeeded: 5, failed: 0 }), 'success');
  assert.equal(deriveStatus({ succeeded: 0, failed: 0 }), 'success');
  assert.equal(deriveStatus({ succeeded: 3, failed: 1 }), 'partial');
  assert.equal(deriveStatus({ succeeded: 0, failed: 4 }), 'failed');
});

test('isStale uses 1.5x interval and ignores event-driven automations', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const longAgo = new Date('2026-01-01T00:00:00Z');
  assert.equal(isStale({ expected_interval_minutes: null, last_run_at: longAgo }, now), false);
  assert.equal(isStale({ expected_interval_minutes: 60, last_run_at: new Date(now - 80 * 60000) }, now), false);
  assert.equal(isStale({ expected_interval_minutes: 60, last_run_at: new Date(now - 100 * 60000) }, now), true);
  // never ran: stale only once the process has been up past the grace window
  assert.equal(isStale({ expected_interval_minutes: 60, last_run_at: null }, now, new Date(now - 30 * 60000)), false);
  assert.equal(isStale({ expected_interval_minutes: 60, last_run_at: null }, now, new Date(now - 200 * 60000)), true);
});

test('maxSeverity', () => {
  assert.equal(maxSeverity('low', 'critical'), 'critical');
  assert.equal(maxSeverity('high', 'medium'), 'high');
});

test('sanitizeTemplateParam removes what Meta rejects', () => {
  const out = sanitizeTemplateParam('line one\nline two\t\tthree     four\n\n');
  assert.ok(!/[\n\t]/.test(out));
  assert.ok(!/ {4,}/.test(out));
  assert.equal(out, 'line one | line two | three   four');
  assert.equal(sanitizeTemplateParam('x'.repeat(2000)).length, 900);
  assert.equal(sanitizeTemplateParam(null), '');
});

test('fallbackDigestLine is a single line and reports problems', () => {
  const facts = {
    alerts_sent: 12, alerts_failed: 1, fees_collected: 123456.4, payments_count: 7,
    exceptions_opened: 3, exceptions_resolved: 2, automations_failed: 1, integrations_down: ['whatsapp'],
  };
  const hi = fallbackDigestLine(facts, 'hinglish');
  const en = fallbackDigestLine(facts, 'en');
  assert.ok(!hi.includes('\n') && !en.includes('\n'));
  assert.match(hi, /₹1,23,456/);
  assert.match(en, /Needs attention: whatsapp/);
  assert.match(hi, /1 fail hue/);
  assert.match(fallbackDigestLine({ ...facts, integrations_down: [] }, 'en'), /All systems working/);
});

test('IST helpers', () => {
  // 03:30 UTC = 09:00 IST on a Thursday
  const p = istParts(new Date('2026-09-24T03:30:00Z'));
  assert.equal(p.hour, 9);
  assert.equal(p.weekday, 'Thu');
  assert.equal(isSchoolHours(new Date('2026-09-24T03:30:00Z')), true);
  assert.equal(isSchoolHours(new Date('2026-09-27T03:30:00Z')), false); // Sunday
  assert.equal(isSchoolHours(new Date('2026-09-24T14:30:00Z')), false); // 8 PM IST
});
