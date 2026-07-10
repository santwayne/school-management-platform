import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

function checkSecret(req, res) {
  const secret = req.headers['x-migration-secret'];
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// One-off endpoint to apply schema.sql to the connected Postgres database.
// Protected by MIGRATION_SECRET env var. Remove this route once the
// database has been migrated in production.
router.post('/migrate', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
    await pool.query(sql);
    res.json({ status: 'migration complete' });
  } catch (err) {
    console.error('Migration failed:', err);
    res.status(500).json({ error: 'migration failed', detail: err.message });
  }
});

// One-off endpoint to seed a demo school/principal/teacher/parent/student.
router.post('/seed', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schoolRes = await client.query(
      `INSERT INTO schools (name) VALUES ('Demo Public School') RETURNING id`
    );
    const schoolId = schoolRes.rows[0].id;

    const classRes = await client.query(
      `INSERT INTO classes (school_id, name) VALUES ($1, 'Class 8A') RETURNING id`,
      [schoolId]
    );
    const classId = classRes.rows[0].id;

    const passwordHash = await bcrypt.hash('changeme123', 10);
    const principalRes = await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Demo Principal', 'principal@demoschool.test', '+911234500000', $2, 'principal') RETURNING id`,
      [schoolId, passwordHash]
    );
    const teacherRes = await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Demo Teacher', 'teacher@demoschool.test', '+911234500001', $2, 'teacher') RETURNING id`,
      [schoolId, passwordHash]
    );
    const parentRes = await client.query(
      `INSERT INTO parents (school_id, name, phone, preferred_language, opt_in_status)
       VALUES ($1, 'Demo Parent', '+911234500002', 'hi', 'OPTED_IN') RETURNING id`,
      [schoolId]
    );
    await client.query(
      `INSERT INTO students (school_id, class_id, parent_id, name) VALUES ($1, $2, $3, 'Demo Student')`,
      [schoolId, classId, parentRes.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({
      status: 'seed complete',
      logins: {
        principal: 'principal@demoschool.test / changeme123',
        teacher: 'teacher@demoschool.test / changeme123',
      },
      ids: { schoolId, classId, teacherId: teacherRes.rows[0].id, principalId: principalRes.rows[0].id },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    res.status(500).json({ error: 'seed failed', detail: err.message });
  } finally {
    client.release();
  }
});

// Quick DB connectivity + table check
router.get('/db-check', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    res.json({ status: 'ok', tables: result.rows.map((r) => r.table_name) });
  } catch (err) {
    res.status(500).json({ error: 'db check failed', detail: err.message });
  }
});

export default router;
