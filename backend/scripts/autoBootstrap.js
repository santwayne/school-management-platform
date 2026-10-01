import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs on every server boot. Safe to run repeatedly:
// - schema.sql itself is idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
// - everything below only INSERTs when the specific row is missing, never duplicates
// This exists so migrations + demo credentials apply automatically wherever
// DATABASE_URL actually lives, without needing a human to run scripts by hand.
// Demo data (Demo Public School, principal/teacher with changeme123, student
// STU001/1234) used to be created on EVERY boot, including production — so
// deleting or changing them didn't stick, and anyone who knew the defaults
// could log in. Now opt-in only: SEED_DEMO_DATA=true (local/staging).
const DEMO_ENABLED = process.env.SEED_DEMO_DATA === 'true';
const DEMO_LOGINS = ['principal@demoschool.test', 'teacher@demoschool.test'];

export async function runBootstrap() {
  const sql = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[bootstrap] schema.sql applied.');

  // ---- Super Admin: only from env in production, never a hardcoded password ----
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@wayneesolutions.com';
  const superAdminRes = await pool.query(`SELECT id FROM super_admins LIMIT 1`);
  if (superAdminRes.rowCount === 0) {
    const pw = process.env.SUPER_ADMIN_PASSWORD || (DEMO_ENABLED ? 'changeme123' : null);
    if (pw) {
      await pool.query(
        `INSERT INTO super_admins (name, email, password_hash) VALUES ('Wayne E Solutions Admin', $1, $2)`,
        [superAdminEmail, await bcrypt.hash(pw, 10)]
      );
      console.log(`[bootstrap] created super admin ${superAdminEmail}${process.env.SUPER_ADMIN_PASSWORD ? ' (password from SUPER_ADMIN_PASSWORD)' : ' / changeme123 (demo mode)'}`);
    } else {
      console.warn('[bootstrap] no super admin exists — set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD and restart to create one.');
    }
  }

  await warnOnDefaultPasswords();
  if (!DEMO_ENABLED) {
    console.log('[bootstrap] demo data skipped (set SEED_DEMO_DATA=true to create demo logins).');
    return;
  }

  // ---- Ensure one demo school + class exists ----
  let schoolRes = await pool.query(`SELECT id FROM schools ORDER BY id LIMIT 1`);
  let schoolId;
  if (schoolRes.rowCount === 0) {
    const created = await pool.query(`INSERT INTO schools (name) VALUES ('Demo Public School') RETURNING id`);
    schoolId = created.rows[0].id;
    console.log(`[bootstrap] created demo school id=${schoolId}`);
  } else {
    schoolId = schoolRes.rows[0].id;
  }

  let classRes = await pool.query(`SELECT id FROM classes WHERE school_id = $1 ORDER BY id LIMIT 1`, [schoolId]);
  let classId;
  if (classRes.rowCount === 0) {
    const created = await pool.query(
      `INSERT INTO classes (school_id, name) VALUES ($1, 'Class 8A') RETURNING id`,
      [schoolId]
    );
    classId = created.rows[0].id;
  } else {
    classId = classRes.rows[0].id;
  }

  // ---- Ensure a principal + teacher login exist (for demoing every panel) ----
  const demoPasswordHash = await bcrypt.hash('changeme123', 10);

  const principalRes = await pool.query(
    `SELECT id FROM teachers WHERE email = 'principal@demoschool.test'`
  );
  if (principalRes.rowCount === 0) {
    await pool.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Demo Principal', 'principal@demoschool.test', '+911234500000', $2, 'principal')`,
      [schoolId, demoPasswordHash]
    );
    console.log('[bootstrap] created demo principal login: principal@demoschool.test / changeme123');
  }

  const teacherRes = await pool.query(`SELECT id FROM teachers WHERE email = 'teacher@demoschool.test'`);
  if (teacherRes.rowCount === 0) {
    await pool.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Demo Teacher', 'teacher@demoschool.test', '+911234500001', $2, 'teacher')`,
      [schoolId, demoPasswordHash]
    );
    console.log('[bootstrap] created demo teacher login: teacher@demoschool.test / changeme123');
  }

  // ---- Ensure a demo parent exists (linked to the demo student below) ----
  let parentRes = await pool.query(`SELECT id FROM parents WHERE phone = '+911234500002'`);
  let parentId;
  if (parentRes.rowCount === 0) {
    const created = await pool.query(
      `INSERT INTO parents (school_id, name, phone, preferred_language, opt_in_status)
       VALUES ($1, 'Demo Parent', '+911234500002', 'hi', 'OPTED_IN') RETURNING id`,
      [schoolId]
    );
    parentId = created.rows[0].id;
  } else {
    parentId = parentRes.rows[0].id;
  }

  // ---- Ensure the demo student login (STU001 / 1234) exists for the AI Tutor ----
  const studentRes = await pool.query(`SELECT id FROM students WHERE login_id = 'STU001'`);
  if (studentRes.rowCount === 0) {
    const studentPinHash = await bcrypt.hash('1234', 10);
    await pool.query(
      `INSERT INTO students (school_id, class_id, parent_id, name, login_id, pin_hash, grade)
       VALUES ($1, $2, $3, 'Demo Student', 'STU001', $4, 'Class 8')`,
      [schoolId, classId, parentId, studentPinHash]
    );
    console.log('[bootstrap] created demo student login: STU001 / 1234');
  }

  console.log('[bootstrap] complete — demo logins ready: principal@demoschool.test/changeme123, teacher@demoschool.test/changeme123, student STU001/1234');
}

// Loud log line on every boot while any account still uses a default
// password — the fix is scripts/secureDemoAccounts.js.
async function warnOnDefaultPasswords() {
  try {
    const found = [];
    const sa = await pool.query(`SELECT email, password_hash FROM super_admins`);
    for (const r of sa.rows) if (await bcrypt.compare('changeme123', r.password_hash)) found.push(`super admin ${r.email}`);
    const t = await pool.query(`SELECT email, password_hash FROM teachers WHERE email = ANY($1)`, [DEMO_LOGINS]);
    for (const r of t.rows) if (await bcrypt.compare('changeme123', r.password_hash)) found.push(r.email);
    const st = await pool.query(`SELECT login_id, pin_hash FROM students WHERE login_id = 'STU001'`);
    for (const r of st.rows) if (r.pin_hash && await bcrypt.compare('1234', r.pin_hash)) found.push('student STU001');
    if (found.length && !DEMO_ENABLED) {
      console.error(`[SECURITY] default passwords still active: ${found.join(', ')} — run: node scripts/secureDemoAccounts.js`);
    }
  } catch (err) {
    console.error('[bootstrap] default-password check failed:', err.message);
  }
}
