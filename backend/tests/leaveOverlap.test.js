import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { overlapMessage } from '../utils/leaveOverlap.js';

test('the teacher is told which leave the new dates clash with', () => {
  assert.equal(
    overlapMessage({ leave_type: 'earned', status: 'PENDING', start_date: '2026-10-08', end_date: '2026-10-10' }),
    'You already have earned leave from 8 Oct 2026 to 10 Oct 2026 (waiting for approval). Choose dates that do not overlap it.'
  );
  assert.equal(
    overlapMessage({ leave_type: 'sick', status: 'APPROVED', start_date: new Date(2026, 9, 12), end_date: new Date(2026, 9, 12) }),
    'You already have sick leave on 12 Oct 2026 (approved). Choose dates that do not overlap it.'
  );
});

test('applying checks for a clash before inserting, and ignores rejected or cancelled requests', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../routes/staffLeave.js', import.meta.url)), 'utf8');
  const post = source.slice(source.indexOf("router.post('/requests'"), source.indexOf("router.get('/requests'"));
  assert.ok(post.indexOf('LEAVE_OVERLAP') > 0 && post.indexOf('LEAVE_OVERLAP') < post.indexOf('INSERT INTO staff_leave_requests'));
  assert.match(post, /status IN \('PENDING', 'APPROVED'\)/);
  assert.match(post, /start_date <= \$4::date AND end_date >= \$3::date/);
  assert.match(post, /pg_advisory_xact_lock/);
});

// The day-count helper was dropped by mistake once, and applying for leave
// then hung for everyone (a ReferenceError inside an async route).
test('everything the apply route calls is defined in the file', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../routes/staffLeave.js', import.meta.url)), 'utf8');
  assert.match(source, /function countDays\(start, end\)/);
  assert.match(source, /const days = countDays\(start_date, end_date\)/);
  assert.match(source, /const LEAVE_LOCK_NAMESPACE = \d+/);
  assert.match(source, /import \{ overlapMessage \} from '..\/utils\/leaveOverlap.js'/);
});
