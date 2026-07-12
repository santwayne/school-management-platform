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
      `SELECT id, name, role, whatsapp_number, whatsapp_opt_in_status FROM teachers WHERE school_id = $1 ORDER BY name ASC`,
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
      const defaultPin = '1234';
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

export default router;
