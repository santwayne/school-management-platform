import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffRows, normalizeRole, generateTempPassword, parseStaffPhone, cleanStaffEmail } from '../utils/staffImport.js';

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
  assert.match(out[2].error, /already has a Waynur login/);
});

test('generated passwords are 10 characters and different each time', () => {
  const a = generateTempPassword();
  assert.equal(a.length, 10);
  assert.notEqual(a, generateTempPassword());
});

test('real-world designations map to app roles; principal-ish titles still refused', () => {
  for (const [given, want] of [
    ['TGT English', 'teacher'], ['Maths Teacher', 'teacher'], ['PGT (Physics)', 'teacher'], ['PRT', 'teacher'],
    ['Head Teacher', 'teacher'], ['Lecturer', 'teacher'], ['Sports Coach', 'teacher'],
    ['Cashier', 'accountant'], ['Fee Clerk', 'accountant'], ['Accounts Officer', 'accountant'],
    ['Asst. Librarian', 'librarian'], ['Office Assistant', 'operator'], ['Computer Operator', 'operator'],
    ['Receptionist', 'operator'], [' teacher ', 'teacher'],
  ]) assert.equal(normalizeRole(given), want, given);
  assert.equal(normalizeRole('Vice Principal'), null);
  assert.equal(normalizeRole('Driver'), null);
  const [vp] = validateStaffRows([{ ...good, role: 'Vice Principal' }]);
  assert.match(vp.error, /principal/i);
});

test('phones as found in real files', () => {
  for (const p of ['+91-98765-43210', '09876543210', '919876543210', '9876543210.0', '98765 43210 / 98765 00000', 'abc, 9876543210'])
    assert.equal(parseStaffPhone(p).phone, '+919876543210', p);
  assert.match(parseStaffPhone('9.19877E+11').error, /scientific notation/);
  assert.match(parseStaffPhone('').error, /required/);
  assert.match(parseStaffPhone('12345').error, /not a valid/);
});

test('emails are cleaned before checking (spaces, mailto:, trailing dot, case)', () => {
  const [r] = validateStaffRows([{ ...good, email: ' mailto:Asha.Rao @School.edu. ' }]);
  assert.equal(r.ok, true);
  assert.equal(r.data.email, 'asha.rao@school.edu');
  assert.equal(cleanStaffEmail('<X@Y.in>'), 'x@y.in');
});

test('a typical 8-row school file imports without rejections', () => {
  const rows = [
    ['Asha Rao', 'asha@s.in', '98765 43210', 'TGT English'],
    ['Vikram', 'vikram@s.in', '+91 98765 00000', 'Accounts'],
    ['Meena', 'meena@s.in', '919876511111', 'Librarian'],
    ['Ravi', 'ravi@s.in', '09876522222', 'PRT'],
    ['Simran', 'simran@s.in', '9876533333', ''],
    ['Harpreet', 'harpreet@s.in', '9876544444.0', 'Computer Operator'],
    ['Gurpreet', 'Gurpreet@S.in', '98765-55555', 'Maths Teacher'],
    ['Neha', 'neha@s.in', '9876566666', 'Cashier'],
  ].map(([name, email, phone, role]) => ({ name, email, phone, role }));
  const out = validateStaffRows(rows);
  assert.deepEqual(out.filter((r) => !r.ok), []);
});
