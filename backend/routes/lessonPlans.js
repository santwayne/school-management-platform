import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Both teacher and principal can use this module — there's no dedicated
// teacherOrPrincipal middleware in auth.js (only requirePrincipal etc.), so
// this mirrors classNotes.js's inline role check instead.
function teacherOrPrincipalOnly(req, res, next) {
  if (!req.user || (req.user.role !== 'teacher' && req.user.role !== 'principal')) {
    return res.status(403).json({ error: 'Teacher or principal role required' });
  }
  next();
}

// POST /api/lesson-plans — a teacher creates a lesson plan for a class/subject
// they're assigned to; a principal can create one for any class in the school.
router.post('/lesson-plans', requireAuth, teacherOrPrincipalOnly, async (req, res) => {
  const { class_id, subject_id, title, content, attachment_url, timetable_slot_id, plan_date } = req.body;
  const schoolId = req.user.school_id;
  const teacherId = req.user.teacher_id;

  if (!class_id || !title) {
    return res.status(400).json({ error: 'class_id and title are required' });
  }
  if (!teacherId) {
    return res.status(403).json({ error: 'Teacher or principal login required' });
  }

  try {
    const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [class_id, schoolId]);
    if (classCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Class not found for this school' });
    }

    if (subject_id) {
      const subjectCheck = await pool.query('SELECT id FROM subjects WHERE id = $1 AND school_id = $2', [subject_id, schoolId]);
      if (subjectCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Subject not found for this school' });
      }
    }

    // Teachers can only post for a class+subject they're actually assigned to
    // (principals aren't tracked in class_subject_teachers, so they skip this).
    if (req.user.role !== 'principal' && subject_id) {
      const assigned = await pool.query(
        'SELECT 1 FROM class_subject_teachers WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 AND school_id = $4',
        [class_id, subject_id, teacherId, schoolId]
      );
      if (assigned.rowCount === 0) {
        return res.status(403).json({ error: 'You are not assigned to this class/subject' });
      }
    }

    // timetable_slot_id is optional, but if given it must belong to this
    // school AND this class — otherwise a plan could be pinned to another
    // class's (or another school's) slot.
    let slotId = null;
    if (timetable_slot_id) {
      const slotCheck = await pool.query(
        'SELECT id FROM timetable_slots WHERE id = $1 AND school_id = $2 AND class_id = $3',
        [timetable_slot_id, schoolId, class_id]
      );
      if (slotCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Timetable slot not found for this class' });
      }
      slotId = timetable_slot_id;
    }

    const { rows } = await pool.query(
      `INSERT INTO lesson_plans (school_id, class_id, subject_id, teacher_id, title, content, attachment_url, timetable_slot_id, plan_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [schoolId, class_id, subject_id || null, teacherId, title, content || null, attachment_url || null, slotId, plan_date || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lesson-plans?class_id=&subject_id=&teacher_id= — a principal sees
// every plan in the school (optionally filtered by class/subject/teacher); a
// teacher only ever sees their own, regardless of a teacher_id passed in the
// query string, so they can't page through a colleague's plans by guessing ids.
router.get('/lesson-plans', requireAuth, teacherOrPrincipalOnly, async (req, res) => {
  const schoolId = req.user.school_id;
  const { class_id, subject_id, teacher_id } = req.query;

  try {
    const params = [schoolId];
    let where = 'lp.school_id = $1';

    if (req.user.role === 'teacher') {
      params.push(req.user.teacher_id);
      where += ` AND lp.teacher_id = $${params.length}`;
    } else if (teacher_id) {
      params.push(teacher_id);
      where += ` AND lp.teacher_id = $${params.length}`;
    }

    if (class_id) {
      params.push(class_id);
      where += ` AND lp.class_id = $${params.length}`;
    }
    if (subject_id) {
      params.push(subject_id);
      where += ` AND lp.subject_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT lp.*, c.name AS class_name, s.name AS subject_name, t.name AS teacher_name
       FROM lesson_plans lp
       JOIN classes c ON c.id = lp.class_id
       LEFT JOIN subjects s ON s.id = lp.subject_id
       JOIN teachers t ON t.id = lp.teacher_id
       WHERE ${where}
       ORDER BY lp.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
