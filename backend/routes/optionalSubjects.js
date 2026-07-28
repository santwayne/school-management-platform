import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

function requireTeacherOrPrincipal(req, res, next) {
  if (!req.user || !['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  next();
}

// A teacher may only act on classes they actually teach (any row for that
// class in class_subject_teachers proves it — they don't need to teach the
// optional subject itself, just the class). Principals bypass this check.
async function canActOnClass(req, classId) {
  if (req.user.role === 'principal') return true;
  if (!classId) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM class_subject_teachers WHERE teacher_id = $1 AND school_id = $2 AND class_id = $3 LIMIT 1`,
    [req.user.teacher_id, req.user.school_id, classId]
  );
  return rowCount > 0;
}

// ============================================================
// Optional subjects catalog
// ============================================================

// GET /api/optional-subjects/subjects — list the catalog for this school
router.get('/subjects', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM optional_subjects WHERE school_id = $1 ORDER BY name ASC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/optional-subjects/subjects — principal manages the catalog
router.post('/subjects', requireAuth, requirePrincipal, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO optional_subjects (school_id, name) VALUES ($1, $2)
       ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [req.user.school_id, name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/optional-subjects/subjects/:id
router.delete('/subjects/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM optional_subjects WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Class / roster lookups, scoped to what the caller may act on
// ============================================================

// GET /api/optional-subjects/classes — principal sees every class+section;
// a teacher only sees classes they are assigned to teach.
router.get('/classes', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'principal') {
      ({ rows } = await pool.query(
        'SELECT id, name, section FROM classes WHERE school_id = $1 ORDER BY name, section',
        [req.user.school_id]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT DISTINCT c.id, c.name, c.section FROM classes c
         JOIN class_subject_teachers cst ON cst.class_id = c.id
         WHERE cst.teacher_id = $1 AND cst.school_id = $2
         ORDER BY c.name, c.section`,
        [req.user.teacher_id, req.user.school_id]
      ));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/optional-subjects/students?class_id= — roster for the individual-picker
router.get('/students', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  const classId = req.query.class_id;
  if (!classId) return res.status(400).json({ error: 'class_id is required' });
  try {
    if (!(await canActOnClass(req, classId))) {
      return res.status(403).json({ error: 'You do not teach this class' });
    }
    const { rows } = await pool.query(
      'SELECT id, name, admission_number FROM students WHERE class_id = $1 AND school_id = $2 ORDER BY name',
      [classId, req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Assignments
// ============================================================

// GET /api/optional-subjects/assignments?class_id=&subject_id=
router.get('/assignments', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  const { class_id, subject_id } = req.query;
  const params = [req.user.school_id];
  let where = 'a.school_id = $1';

  if (class_id) {
    if (!(await canActOnClass(req, class_id))) {
      return res.status(403).json({ error: 'You do not teach this class' });
    }
    params.push(class_id);
    where += ` AND a.class_id = $${params.length}`;
  } else if (req.user.role === 'teacher') {
    // No class filter given — restrict a teacher's view to classes they teach.
    params.push(req.user.teacher_id);
    where += ` AND a.class_id IN (SELECT class_id FROM class_subject_teachers WHERE teacher_id = $${params.length} AND school_id = $1)`;
  }

  if (subject_id) {
    params.push(subject_id);
    where += ` AND a.subject_id = $${params.length}`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT a.*, s.name AS student_name, s.admission_number, c.name AS class_name, os.name AS subject_name
       FROM student_optional_subject_assignments a
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = a.class_id
       JOIN optional_subjects os ON os.id = a.subject_id
       WHERE ${where}
       ORDER BY a.assigned_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/optional-subjects/assign — bulk-assign to a whole class+section,
// or to a specific list of student_ids.
router.post('/assign', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  const { subject_id, class_id, assign_all, student_ids } = req.body;
  if (!subject_id || !class_id) {
    return res.status(400).json({ error: 'subject_id and class_id are required' });
  }
  if (!assign_all && (!Array.isArray(student_ids) || student_ids.length === 0)) {
    return res.status(400).json({ error: 'Provide student_ids, or set assign_all to true' });
  }
  if (!(await canActOnClass(req, class_id))) {
    return res.status(403).json({ error: 'You do not teach this class' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const classRes = await client.query('SELECT id, section FROM classes WHERE id = $1 AND school_id = $2', [class_id, req.user.school_id]);
    if (classRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class not found for this school' });
    }
    const section = classRes.rows[0].section;

    const subjectRes = await client.query('SELECT id FROM optional_subjects WHERE id = $1 AND school_id = $2', [subject_id, req.user.school_id]);
    if (subjectRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Optional subject not found for this school' });
    }

    let targetStudentIds;
    if (assign_all) {
      const allStudents = await client.query('SELECT id FROM students WHERE class_id = $1 AND school_id = $2', [class_id, req.user.school_id]);
      targetStudentIds = allStudents.rows.map((r) => r.id);
    } else {
      // Only accept ids that actually belong to this class + school — a
      // spoofed student_id from a different class/school must not slip in.
      const validStudents = await client.query(
        'SELECT id FROM students WHERE class_id = $1 AND school_id = $2 AND id = ANY($3::int[])',
        [class_id, req.user.school_id, student_ids]
      );
      targetStudentIds = validStudents.rows.map((r) => r.id);
    }

    let insertedCount = 0;
    for (const studentId of targetStudentIds) {
      const result = await client.query(
        `INSERT INTO student_optional_subject_assignments (school_id, student_id, subject_id, class_id, section, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, subject_id) DO NOTHING
         RETURNING id`,
        [req.user.school_id, studentId, subject_id, class_id, section, req.user.teacher_id]
      );
      if (result.rowCount > 0) insertedCount += 1;
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, assigned_count: insertedCount, target_count: targetStudentIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/optional-subjects/assignments/:id — unassign one student
router.delete('/assignments/:id', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT class_id FROM student_optional_subject_assignments WHERE id = $1 AND school_id = $2',
      [req.params.id, req.user.school_id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
    if (!(await canActOnClass(req, existing.rows[0].class_id))) {
      return res.status(403).json({ error: 'You do not teach this class' });
    }
    await pool.query('DELETE FROM student_optional_subject_assignments WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
