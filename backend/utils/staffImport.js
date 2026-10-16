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

// Real school files carry designations, not app roles ("TGT English",
// "Maths Teacher", "Cashier", "Office Assistant"). These patterns are matched
// on the cleaned-up text after the exact aliases above. Order matters: the
// first match wins. Principal / vice principal are deliberately not mapped.
const ROLE_PATTERNS = [
  [/\b(teach\w*|tgt|pgt|prt|ntt|lecturer|instructor|tutor|coach|educator|mentor|class\s*incharge|hod)\b/, 'teacher'],
  [/\b(account\w*|cashier|fee\s*clerk|fees?|finance|bursar)\b/, 'accountant'],
  [/\b(librar\w*)\b/, 'librarian'],
  [/\b(operator|operations?|office|admin|administrator|reception\w*|front\s*desk|data\s*entry|computer\s*operator|coordinator)\b/, 'operator'],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Excel saves long numbers like 919876543210 as "9.19877E+11" in CSV — the
// real digits are gone, so this must be rejected with a clear fix, never guessed.
const SCIENTIFIC_RE = /^\s*\+?\d+(\.\d+)?e\+?\d+\s*$/i;

// Accepts what people actually type: "98765 43210", "+91-98765-43210",
// "9876543210.0" (number exported from a sheet), two numbers in one cell
// ("98765 43210 / 98765 00000" — the first valid one is used).
export function parseStaffPhone(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Phone is required.' };
  if (SCIENTIFIC_RE.test(text)) {
    return { error: `Phone "${text}" was changed by Excel into scientific notation. Format the phone column as Text, retype the numbers and save again.` };
  }
  const parts = text.split(/[/,;|]|\s+or\s+/i).map((p) => p.trim().replace(/\.0+$/, '')).filter(Boolean);
  for (const part of parts) {
    const phone = normalizePhone(part);
    if (phone) return { phone };
  }
  return { error: `Phone "${text}" is not a valid Indian mobile number (10 digits, optionally with +91).` };
}

export function cleanStaffEmail(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .replace(/[\s​]+/g, '')
    .replace(/[.,;]+$/, '')
    .toLowerCase();
}

// 10 chars, no look-alikes (0/O, 1/l/I) so it can be read out over the phone.
export function generateTempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function normalizeRole(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return 'teacher';
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  const cleaned = key.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (ROLE_ALIASES[cleaned]) return ROLE_ALIASES[cleaned];
  if (/\bprincipal\b/.test(cleaned)) return null;
  for (const [re, role] of ROLE_PATTERNS) if (re.test(cleaned)) return role;
  return null;
}

// rows: [{ row_number, name, email, phone, role, password }]
// existingEmails: Set of lowercase emails already in the database.
// Returns [{ row_number, ok: true, data } | { row_number, ok: false, error }].
export function validateStaffRows(rows, existingEmails = new Set()) {
  const seen = new Map(); // email -> first row_number
  return rows.map((raw, i) => {
    const row_number = raw.row_number ?? i + 2;
    const name = String(raw.name ?? '').trim().replace(/\s+/g, ' ');
    const email = cleanStaffEmail(raw.email);
    const fail = (error) => ({ row_number, ok: false, error, input: { name, email } });

    if (!name) return fail('Name is required.');
    if (name.length > 255) return fail('Name is too long.');
    if (!email) return fail('Email is required.');
    if (!EMAIL_RE.test(email) || email.length > 255) return fail(`"${email}" is not a valid email.`);

    const role = normalizeRole(raw.role);
    if (!role) {
      const given = String(raw.role).trim().toLowerCase();
      return fail(/\bprincipal\b/.test(given)
        ? 'A principal / vice principal account cannot be created by import. Add them from Staff, or put "teacher" or "operator" as the role.'
        : `Unknown role "${raw.role}". Use one of: ${IMPORTABLE_ROLES.join(', ')} (or leave it blank for teacher).`);
    }

    const { phone, error: phoneError } = parseStaffPhone(raw.phone);
    if (!phone) return fail(phoneError);

    const password = String(raw.password ?? '').trim();
    if (password && password.length < 8) return fail('A password, if given, must be at least 8 characters (leave it blank to generate one).');

    if (existingEmails.has(email)) return fail('This email already has a Waynur login (maybe imported earlier). Remove the row or use a different email.');
    if (seen.has(email)) return fail(`Same email as row ${seen.get(email)} in this file.`);
    seen.set(email, row_number);

    return { row_number, ok: true, data: { name, email, phone, role, password: password || null } };
  });
}
