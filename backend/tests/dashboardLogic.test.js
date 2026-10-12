import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('dashboard WhatsApp reach counts people messaged, not only broadcasts', () => {
  const reports = read('../routes/reports.js');
  assert.match(reports, /whatsapp_reach_7d:/);
  for (const table of ['dashboard_notifications', 'notification_log', 'broadcast_recipients']) {
    assert.match(reports, new RegExp(`whatsappReach[\\s\\S]*${table}`), `reach should include ${table}`);
  }
  assert.match(read('../../frontend/src/components/AdminHome.jsx'), /overview\.whatsapp_reach_7d/);
});

test('an empty payroll run does not ask the principal to approve 0 staff', () => {
  const src = read('../services/payrollService.js');
  const empty = src.indexOf('if (count === 0)');
  const approve = src.indexOf('title: `Approve payroll for');
  assert.ok(empty > 0 && empty < approve, 'empty-run branch must come before the approval item');
  assert.match(src.slice(empty, approve), /autoResolve\(`payroll:\$\{period\}`/);
  assert.match(src.slice(empty, approve), /dedupeKey: `payroll-empty:\$\{period\}`/);
});

test('a plan activated by the Waynur team shows as the current plan', () => {
  const billing = read('../../frontend/src/components/AdminBilling.jsx');
  assert.match(billing, /isCurrent = key === data\.plan && \(!data\.subscription \|\|/);
  assert.match(billing, /Activated by the Waynur team/);
});
