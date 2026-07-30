import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── School ──────────────────────────────────────────────
    const schoolRes = await client.query(
      `INSERT INTO schools (name, plan, status)
       VALUES ('Sunrise Modern School', 'growth', 'active') RETURNING id`
    );
    const schoolId = schoolRes.rows[0].id;
    console.log(`School created: id=${schoolId}`);

    // ── Principal ───────────────────────────────────────────
    const principalHash = await bcrypt.hash('12345678', 10);
    const principalRes = await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Pankaj Sharma', 'ptpankajsmailbox99@gmail.com', '+919876500001', $2, 'principal') RETURNING id`,
      [schoolId, principalHash]
    );
    const principalId = principalRes.rows[0].id;
    console.log(`Principal created: id=${principalId}`);

    // ── Classes ─────────────────────────────────────────────
    const classNames = ['Class 6A', 'Class 7A', 'Class 8A', 'Class 9A', 'Class 10A'];
    const classIds = [];
    for (const name of classNames) {
      const r = await client.query(
        `INSERT INTO classes (school_id, name) VALUES ($1, $2) RETURNING id`,
        [schoolId, name]
      );
      classIds.push(r.rows[0].id);
    }
    console.log(`Classes created: ${classIds}`);

    // ── Subjects ────────────────────────────────────────────
    const subjectNames = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science', 'Computer Science'];
    const subjectIds = [];
    for (const name of subjectNames) {
      const r = await client.query(
        `INSERT INTO subjects (school_id, name) VALUES ($1, $2) RETURNING id`,
        [schoolId, name]
      );
      subjectIds.push(r.rows[0].id);
    }
    console.log(`Subjects created: ${subjectIds}`);

    // ── Teachers ────────────────────────────────────────────
    const teacherHash = await bcrypt.hash('teacher123', 10);
    const teachersData = [
      { name: 'Rajesh Kumar',   email: 'rajesh.kumar@sunrise.edu',   phone: '+919876500002' },
      { name: 'Priya Verma',    email: 'priya.verma@sunrise.edu',    phone: '+919876500003' },
      { name: 'Amit Singh',     email: 'amit.singh@sunrise.edu',     phone: '+919876500004' },
      { name: 'Sunita Yadav',   email: 'sunita.yadav@sunrise.edu',   phone: '+919876500005' },
      { name: 'Deepak Gupta',   email: 'deepak.gupta@sunrise.edu',   phone: '+919876500006' },
      { name: 'Meena Patel',    email: 'meena.patel@sunrise.edu',    phone: '+919876500007' },
    ];
    const teacherIds = [];
    for (const t of teachersData) {
      const r = await client.query(
        `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'teacher') RETURNING id`,
        [schoolId, t.name, t.email, t.phone, teacherHash]
      );
      teacherIds.push(r.rows[0].id);
    }
    console.log(`Teachers created: ${teacherIds}`);

    // ── Accountant ──────────────────────────────────────────
    const accountantHash = await bcrypt.hash('accountant123', 10);
    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Kavita Joshi', 'kavita.joshi@sunrise.edu', '+919876500010', $2, 'accountant') RETURNING id`,
      [schoolId, accountantHash]
    );
    console.log('Accountant created');

    // ── Students + Parents ──────────────────────────────────
    const studentsData = [
      { name: 'Aarav Sharma',    login_id: 'SMS001', pin: '1111', grade: 'Class 6', classIdx: 0, parentName: 'Vikram Sharma',    parentPhone: '+919800000001' },
      { name: 'Diya Patel',      login_id: 'SMS002', pin: '2222', grade: 'Class 6', classIdx: 0, parentName: 'Ravi Patel',       parentPhone: '+919800000002' },
      { name: 'Rohan Mehta',     login_id: 'SMS003', pin: '3333', grade: 'Class 7', classIdx: 1, parentName: 'Suresh Mehta',     parentPhone: '+919800000003' },
      { name: 'Ananya Singh',    login_id: 'SMS004', pin: '4444', grade: 'Class 7', classIdx: 1, parentName: 'Ramesh Singh',     parentPhone: '+919800000004' },
      { name: 'Kabir Verma',     login_id: 'SMS005', pin: '5555', grade: 'Class 8', classIdx: 2, parentName: 'Anil Verma',       parentPhone: '+919800000005' },
      { name: 'Ishaan Gupta',    login_id: 'SMS006', pin: '6666', grade: 'Class 8', classIdx: 2, parentName: 'Manoj Gupta',      parentPhone: '+919800000006' },
      { name: 'Priya Yadav',     login_id: 'SMS007', pin: '7777', grade: 'Class 9', classIdx: 3, parentName: 'Dinesh Yadav',     parentPhone: '+919800000007' },
      { name: 'Arjun Kumar',     login_id: 'SMS008', pin: '8888', grade: 'Class 9', classIdx: 3, parentName: 'Naresh Kumar',     parentPhone: '+919800000008' },
      { name: 'Sneha Joshi',     login_id: 'SMS009', pin: '9999', grade: 'Class 10', classIdx: 4, parentName: 'Prakash Joshi',   parentPhone: '+919800000009' },
      { name: 'Vivaan Mishra',   login_id: 'SMS010', pin: '0000', grade: 'Class 10', classIdx: 4, parentName: 'Santosh Mishra',  parentPhone: '+919800000010' },
    ];

    for (const s of studentsData) {
      const parentRes = await client.query(
        `INSERT INTO parents (school_id, name, phone, preferred_language, opt_in_status)
         VALUES ($1, $2, $3, 'hi', 'OPTED_IN') RETURNING id`,
        [schoolId, s.parentName, s.parentPhone]
      );
      const parentId = parentRes.rows[0].id;
      const pinHash = await bcrypt.hash(s.pin, 10);
      await client.query(
        `INSERT INTO students (school_id, class_id, parent_id, name, login_id, pin_hash, grade)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [schoolId, classIds[s.classIdx], parentId, s.name, s.login_id, pinHash, s.grade]
      );
    }
    console.log('Students + Parents created');

    await client.query('COMMIT');
    console.log('\n✅ Seed complete!\n');
    console.log('─────────────────────────────────────────');
    console.log('PRINCIPAL LOGIN');
    console.log('  Email   : ptpankajsmailbox99@gmail.com');
    console.log('  Password: 12345678');
    console.log('─────────────────────────────────────────');
    console.log('ACCOUNTANT LOGIN');
    console.log('  Email   : kavita.joshi@sunrise.edu');
    console.log('  Password: accountant123');
    console.log('─────────────────────────────────────────');
    console.log('TEACHER LOGINS (all password: teacher123)');
    for (const t of teachersData) console.log(`  ${t.email}`);
    console.log('─────────────────────────────────────────');
    console.log('STUDENT LOGINS');
    for (const s of studentsData) console.log(`  ${s.login_id} / ${s.pin}  (${s.name})`);
    console.log('─────────────────────────────────────────');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
