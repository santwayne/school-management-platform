import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// POST /api/academics/classes — create a class for this school
router.post('/classes', requireAuth, requirePrincipal, async (req, res) => {
  const { name } = req.body;
  const schoolId = req.user.school_id;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Class name is required.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO classes (school_id, name) VALUES ($1, $2) RETURNING *`,
      [schoolId, name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/academics/classes — list classes for this school
router.get('/classes', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const { rows } = await pool.query('SELECT * FROM classes WHERE school_id = $1 ORDER BY name ASC', [schoolId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/academics/teachers — list teachers for this school (for assignment dropdowns)
router.get('/teachers', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, role, whatsapp_number, whatsapp_opt_in_status FROM teachers WHERE school_id = $1 ORDER BY name ASC`,
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/academics/subjects — create a subject for this school
router.post('/subjects', requireAuth, requirePrincipal, async (req, res) => {
  const { name } = req.body;
  const schoolId = req.user.school_id;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Subject name is required.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO subjects (school_id, name)
       VALUES ($1, $2)
       ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [schoolId, name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/academics/subjects — list subjects for this school
router.get('/subjects', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const { rows } = await pool.query('SELECT * FROM subjects WHERE school_id = $1 ORDER BY name ASC', [schoolId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/academics/assign-teacher — upsert a class+subject -> teacher assignment
router.post('/assign-teacher', requireAuth, requirePrincipal, async (req, res) => {
  const { class_id, subject_id, teacher_id } = req.body;
  const schoolId = req.user.school_id;

  if (!class_id || !subject_id || !teacher_id) {
    return res.status(400).json({ error: 'class_id, subject_id and teacher_id are required' });
  }

  try {
    // None of these three ids were previously checked against the caller's
    // own school. Since class_subject_teachers' conflict target is
    // (class_id, subject_id) with no school_id in it, an unscoped call could
    // silently overwrite a DIFFERENT school's existing assignment — not just
    // read across schools, but corrupt another school's data outright.
    const ownership = await pool.query(
      `SELECT
         (SELECT id FROM classes WHERE id = $1 AND school_id = $4) AS class_ok,
         (SELECT id FROM subjects WHERE id = $2 AND school_id = $4) AS subject_ok,
         (SELECT id FROM teachers WHERE id = $3 AND school_id = $4) AS teacher_ok`,
      [class_id, subject_id, teacher_id, schoolId]
    );
    const { class_ok, subject_ok, teacher_ok } = ownership.rows[0];
    if (!class_ok || !subject_ok || !teacher_ok) {
      return res.status(404).json({ error: 'Class, subject, or teacher not found for this school' });
    }

    const { rows } = await pool.query(
      `INSERT INTO class_subject_teachers (school_id, class_id, subject_id, teacher_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_id, subject_id)
       DO UPDATE SET teacher_id = EXCLUDED.teacher_id
       RETURNING *`,
      [schoolId, class_id, subject_id, teacher_id]
    );
    res.json({ success: true, assignment: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/academics/class/:classId/roster — students + subject-teacher grid in one call
router.get('/class/:classId/roster', requireAuth, async (req, res) => {
  const { classId } = req.params;
  const schoolId = req.user.school_id;

  try {
    const studentsRes = await pool.query(
      'SELECT id, name, login_id FROM students WHERE class_id = $1 AND school_id = $2 ORDER BY name ASC',
      [classId, schoolId]
    );

    const gridRes = await pool.query(
      `SELECT cst.subject_id, s.name as subject_name, cst.teacher_id, t.name as teacher_name
       FROM class_subject_teachers cst
       JOIN subjects s ON cst.subject_id = s.id
       JOIN teachers t ON cst.teacher_id = t.id
       WHERE cst.class_id = $1 AND cst.school_id = $2`,
      [classId, schoolId]
    );

    res.json({ students: studentsRes.rows, assignments: gridRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/academics/students/bulk — bulk-insert students into a class
router.post('/students/bulk', requireAuth, requirePrincipal, async (req, res) => {
  const { class_id, students } = req.body; // Array of { name, parent_phone }
  const schoolId = req.user.school_id;

  if (!class_id || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'class_id and a non-empty students array are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // class_id was never checked against the caller's own school — without
    // this, a principal could bulk-insert students into a class belonging
    // to a different school by passing that class's id.
    const classCheck = await client.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [class_id, schoolId]);
    if (classCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class not found for this school' });
    }

    const provisioned = [];

    for (const student of students) {
      if (!student.name || student.name.trim() === '') continue;

      let parentId = null;
      if (student.parent_phone) {
        const phone = student.parent_phone.trim();
        // parents has no unique constraint on (school_id, phone) and name is
        // NOT NULL, so look up first rather than relying on ON CONFLICT.
        const existingParent = await client.query(
          'SELECT id FROM parents WHERE school_id = $1 AND phone = $2',
          [schoolId, phone]
        );
        if (existingParent.rowCount > 0) {
          parentId = existingParent.rows[0].id;
        } else {
          const newParent = await client.query(
            `INSERT INTO parents (school_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
            [schoolId, `Parent of ${student.name.trim()}`, phone]
          );
          parentId = newParent.rows[0].id;
        }
      }

      const randHex = Math.random().toString(36).substring(2, 6).toUpperCase();
      const loginId = `STD-${schoolId}-${randHex}`;
      // Every student previously got the identical PIN 1234 — trivially
      // guessable against any known login_id. Randomized per student instead;
      // still returned below so the teacher can hand it to the family.
      const defaultPin = String(Math.floor(1000 + Math.random() * 9000));
      const pinHash = await bcrypt.hash(defaultPin, 10);

      const studentRes = await client.query(
        `INSERT INTO students (school_id, class_id, name, login_id, pin_hash, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, login_id`,
        [schoolId, class_id, student.name.trim(), loginId, pinHash, parentId]
      );

      provisioned.push({ ...studentRes.rows[0], defaultPin });
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, inserted_count: provisioned.length, records: provisioned });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/academics/my-classes — a teacher's own assigned class/subject list
router.get('/my-classes', requireAuth, async (req, res) => {
  const teacherId = req.user.teacher_id;
  const schoolId = req.user.school_id;

  if (!teacherId) {
    return res.status(403).json({ error: 'Teacher login required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT cst.class_id, c.name as class_name, cst.subject_id, s.name as subject_name
       FROM class_subject_teachers cst
       JOIN classes c ON cst.class_id = c.id
       JOIN subjects s ON cst.subject_id = s.id
       WHERE cst.teacher_id = $1 AND cst.school_id = $2`,
      [teacherId, schoolId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Manage School CRUD — classes edit/delete, and full teacher/student/
// parent management. These didn't exist before; only create-class and
// bulk-student-import did. Added to support the Manage School page.
// ============================================================

router.patch('/classes/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE classes SET name = $1 WHERE id = $2 AND school_id = $3 RETURNING *',
      [name, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Class not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/classes/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM classes WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teachers/Accountants — create with a real login (email + password), edit,
// delete. role defaults to 'teacher'; 'accountant' is also allowed since
// this is the only place staff accounts get created. Deliberately does NOT
// allow creating role='principal' through this endpoint — that's a higher-
// trust action than adding regular staff.
router.post('/teachers', requireAuth, requirePrincipal, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'name, email, phone and password are all required' });
  }
  const finalRole = role === 'accountant' ? 'accountant' : 'teacher';
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, phone, role, created_at`,
      [req.user.school_id, name, email, phone, password_hash, finalRole]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A staff member with this email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/teachers/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { name, phone } = req.body;
  try {
    const result = await pool.query(
      `UPDATE teachers SET name = COALESCE($1, name), phone = COALESCE($2, phone)
       WHERE id = $3 AND school_id = $4 AND role = 'teacher' RETURNING id, name, email, phone, role`,
      [name, phone, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Teacher not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/teachers/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    // role='teacher' guard so this can never be used to delete the Principal's own account
    const result = await pool.query(
      `DELETE FROM teachers WHERE id = $1 AND school_id = $2 AND role = 'teacher' RETURNING id`,
      [req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Students — flat searchable list (the existing endpoint only returns a
// per-class roster), plus edit/delete. Creation stays on the bulk-import
// endpoint above — a single-student add is just a bulk call with one row.
router.get('/students', requireAuth, requirePrincipal, async (req, res) => {
  const { search } = req.query;
  try {
    const params = [req.user.school_id];
    let searchFilter = '';
    if (search) {
      params.push(`%${search}%`);
      searchFilter = `AND s.name ILIKE $${params.length}`;
    }
    const result = await pool.query(
      `SELECT s.id, s.name, s.login_id, s.grade, c.id AS class_id, c.name AS class_name,
              p.id AS parent_id, p.name AS parent_name, p.phone AS parent_phone
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN parents p ON p.id = s.parent_id
       WHERE s.school_id = $1 ${searchFilter}
       ORDER BY s.name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/students/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { name, class_id, parent_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE students SET
         name = COALESCE($1, name), class_id = COALESCE($2, class_id), parent_id = COALESCE($3, parent_id)
       WHERE id = $4 AND school_id = $5 RETURNING id, name, class_id, parent_id`,
      [name, class_id, parent_id, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/students/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parents — full CRUD. opt_in_status stays server-controlled at
// 'OPTED_OUT' by default (the actual opt-in only happens through the real
// WhatsApp consent flow, never just by being added here).
router.get('/parents', requireAuth, requirePrincipal, async (req, res) => {
  const { search } = req.query;
  try {
    const params = [req.user.school_id];
    let searchFilter = '';
    if (search) {
      params.push(`%${search}%`);
      searchFilter = `AND (p.name ILIKE $${params.length} OR p.phone ILIKE $${params.length})`;
    }
    const result = await pool.query(
      `SELECT p.*, COUNT(s.id) AS child_count
       FROM parents p LEFT JOIN students s ON s.parent_id = p.id
       WHERE p.school_id = $1 ${searchFilter}
       GROUP BY p.id ORDER BY p.name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/parents', requireAuth, requirePrincipal, async (req, res) => {
  const { name, phone, preferred_language } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  try {
    const result = await pool.query(
      `INSERT INTO parents (school_id, name, phone, preferred_language) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.school_id, name, phone, preferred_language || 'hi']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/parents/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { name, phone, preferred_language } = req.body;
  try {
    const result = await pool.query(
      `UPDATE parents SET
         name = COALESCE($1, name), phone = COALESCE($2, phone), preferred_language = COALESCE($3, preferred_language)
       WHERE id = $4 AND school_id = $5 RETURNING *`,
      [name, phone, preferred_language, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Parent not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/parents/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM parents WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
