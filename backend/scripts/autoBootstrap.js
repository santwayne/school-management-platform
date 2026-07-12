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
export async function runBootstrap() {
  const sql = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[bootstrap] schema.sql applied.');

  // ---- Ensure a default Super Admin login exists ----
  const superAdminRes = await pool.query(`SELECT id FROM super_admins WHERE email = 'superadmin@wayneesolutions.com'`);
  if (superAdminRes.rowCount === 0) {
    const superAdminPasswordHash = await bcrypt.hash('changeme123', 10);
    await pool.query(
      `INSERT INTO super_admins (name, email, password_hash) VALUES ('Wayne E Solutions Admin', 'superadmin@wayneesolutions.com', $1)`,
      [superAdminPasswordHash]
    );
    console.log('[bootstrap] created default super admin login: superadmin@wayneesolutions.com / changeme123 — CHANGE THIS PASSWORD after first login');
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
