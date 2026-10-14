import crypto from 'crypto';
import { normalizePhone } from './phone.js';

// Validation for the bulk staff import (POST /api/academics/teachers/bulk).
// Pure — no database — so it is unit-tested directly. Each row is checked on
// its own, so one bad row never blocks the rest of the file.

export const MAX_STAFF_IMPORT_ROWS = 300;
export const IMPORTABLE_ROLES = ['teacher', 'accountant', 'librarian', 'operator'];

const ROLE_ALIASES = {
  teacher: 'teacher', teachers: 'teacher', faculty: 'teacher', staff: 'teacher',
  accountant: 'accountant', accounts: 'accountant', accounting: 'accountant',
  librarian: 'librarian', library: 'librarian',
  operator: 'operator', operations: 'operator', ops: 'operator',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 10 chars, no look-alikes (0/O, 1/l/I) so it can be read out over the phone.
export function generateTempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function normalizeRole(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return 'teacher';
  return ROLE_ALIASES[key] || null;
}

// rows: [{ row_number, name, email, phone, role, password }]
// existingEmails: Set of lowercase emails already in the database.
// Returns [{ row_number, ok: true, data } | { row_number, ok: false, error }].
export function validateStaffRows(rows, existingEmails = new Set()) {
  const seen = new Map(); // email -> first row_number
  return rows.map((raw, i) => {
    const row_number = raw.row_number ?? i + 2;
    const name = String(raw.name ?? '').trim();
    const email = String(raw.email ?? '').trim().toLowerCase();
    const fail = (error) => ({ row_number, ok: false, error, input: { name, email } });

    if (!name) return fail('Name is required.');
    if (name.length > 255) return fail('Name is too long.');
    if (!email) return fail('Email is required.');
    if (!EMAIL_RE.test(email) || email.length > 255) return fail(`"${email}" is not a valid email.`);

    const role = normalizeRole(raw.role);
    if (!role) {
      const given = String(raw.role).trim().toLowerCase();
      return fail(given === 'principal'
        ? 'The principal account cannot be created by import.'
        : `Unknown role "${raw.role}". Use one of: ${IMPORTABLE_ROLES.join(', ')}.`);
    }

    const phone = normalizePhone(raw.phone);
    if (!phone) return fail('Phone must be a valid Indian mobile number (10 digits, optionally with +91).');

    const password = String(raw.password ?? '').trim();
    if (password && password.length < 8) return fail('A password, if given, must be at least 8 characters (leave it blank to generate one).');

    if (existingEmails.has(email)) return fail('A staff member with this email already exists.');
    if (seen.has(email)) return fail(`Same email as row ${seen.get(email)} in this file.`);
    seen.set(email, row_number);

    return { row_number, ok: true, data: { name, email, phone, role, password: password || null } };
  });
}
