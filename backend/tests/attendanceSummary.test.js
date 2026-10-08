import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test("the principal's attendance summary is scoped to the school and counts unmarked students", () => {
  const routes = read('../routes/attendance.js');
  const summary = routes.slice(routes.indexOf("router.get('/summary/today'"), routes.indexOf("router.get('/today/:classId'"));
  assert.ok(summary.length > 0, 'summary route is declared before /today/:classId');
  assert.match(summary, /requireAuth/);
  assert.match(summary, /WHERE c\.school_id = \$1/);
  assert.match(summary, /a\.date = CURRENT_DATE/);
  assert.match(summary, /FILTER \(WHERE a\.id IS NULL\)::int AS unmarked/);
  assert.match(summary, /\[req\.user\.school_id\]/);
});

test('marking rejects a status that is not present, absent or late', () => {
  const routes = read('../routes/attendance.js');
  assert.match(routes, /const ATTENDANCE_STATUSES = \['present', 'absent', 'late'\]/);
  assert.match(routes, /!ATTENDANCE_STATUSES\.includes\(r\.status\)/);
});
