import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function seed() {
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

    const studentPinHash = await bcrypt.hash('1234', 10);
    await client.query(
      `INSERT INTO students (school_id, class_id, parent_id, name, login_id, pin_hash, grade)
       VALUES ($1, $2, $3, 'Demo Student', 'STU001', $4, 'Class 8')`,
      [schoolId, classId, parentRes.rows[0].id, studentPinHash]
    );

    await client.query('COMMIT');

    console.log('Seed complete.');
    console.log('Login as principal: principal@demoschool.test / changeme123');
    console.log('Login as teacher:   teacher@demoschool.test / changeme123');
    console.log('Login as student:   STU001 / 1234 (Ask AI Tutor demo)');
    console.log(`school_id=${schoolId}, class_id=${classId}, teacher_id=${teacherRes.rows[0].id}, principal_id=${principalRes.rows[0].id}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
