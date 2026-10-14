import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffRows, normalizeRole, generateTempPassword } from '../utils/staffImport.js';

const good = { name: 'Asha Rao', email: 'Asha@School.edu', phone: '98765 43210', role: 'Teacher' };

test('a good row is normalised (email lower-cased, phone E.164, role mapped)', () => {
  const [r] = validateStaffRows([good]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { name: 'Asha Rao', email: 'asha@school.edu', phone: '+919876543210', role: 'teacher', password: null });
});

test('blank role defaults to teacher; aliases map; principal and unknown are rejected', () => {
  assert.equal(normalizeRole(''), 'teacher');
  assert.equal(normalizeRole('Library'), 'librarian');
  assert.equal(normalizeRole('Accounts'), 'accountant');
  assert.equal(normalizeRole('wizard'), null);
  const [p] = validateStaffRows([{ ...good, role: 'principal' }]);
  assert.match(p.error, /principal/);
  const [u] = validateStaffRows([{ ...good, role: 'wizard' }]);
  assert.match(u.error, /Unknown role/);
});

test('each bad row is reported on its own and does not block the others', () => {
  const out = validateStaffRows([
    good,
    { ...good, email: 'nope' },
    { ...good, email: 'b@s.edu', phone: '123' },
    { ...good, email: 'c@s.edu', name: '' },
    { ...good, email: 'd@s.edu', password: 'short' },
  ]);
  assert.deepEqual(out.map((r) => r.ok), [true, false, false, false, false]);
  assert.match(out[1].error, /valid email/);
  assert.match(out[2].error, /phone/i);
  assert.match(out[3].error, /Name/);
  assert.match(out[4].error, /8 characters/);
});

test('duplicate emails: against the database and within the file', () => {
  const out = validateStaffRows([good, { ...good, name: 'Other' }, { ...good, email: 'x@s.edu' }], new Set(['x@s.edu']));
  assert.equal(out[0].ok, true);
  assert.match(out[1].error, /row 2/);
  assert.match(out[2].error, /already exists/);
});

test('generated passwords are 10 characters and different each time', () => {
  const a = generateTempPassword();
  assert.equal(a.length, 10);
  assert.notEqual(a, generateTempPassword());
});
