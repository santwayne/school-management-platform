import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// GET /api/timetable/class/:classId — full week grid for one class
router.get('/class/:classId', requireAuth, async (req, res) => {
  const { classId } = req.params;
  try {
    const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [classId, req.user.school_id]);
    if (classCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Class not found for this school' });
    }

    const { rows } = await pool.query(
      `SELECT ts.*, s.name AS subject_name, t.name AS teacher_name
       FROM timetable_slots ts
       LEFT JOIN subjects s ON s.id = ts.subject_id
       LEFT JOIN teachers t ON t.id = ts.teacher_id
       WHERE ts.class_id = $1
       ORDER BY ts.day_of_week, ts.period_number`,
      [classId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/teacher/:teacherId — a teacher's own weekly schedule
// (useful for the teacher portal and for clash-checking before assigning them)
router.get('/teacher/:teacherId', requireAuth, async (req, res) => {
  const { teacherId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT ts.*, s.name AS subject_name, c.name AS class_name
       FROM timetable_slots ts
       LEFT JOIN subjects s ON s.id = ts.subject_id
       JOIN classes c ON c.id = ts.class_id
       WHERE ts.teacher_id = $1 AND ts.school_id = $2
       ORDER BY ts.day_of_week, ts.period_number`,
      [teacherId, req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/timetable/slot — upsert a single (class, day, period) cell.
// Passing subject_id/teacher_id as null clears that cell's assignment
// without deleting the row (keeps the grid shape stable).
router.put('/slot', requireAuth, requirePrincipal, async (req, res) => {
  const { class_id, day_of_week, period_number, start_time, end_time, subject_id, teacher_id, room } = req.body;

  if (!class_id || !day_of_week || !period_number) {
    return res.status(400).json({ error: 'class_id, day_of_week and period_number are required' });
  }
  if (day_of_week < 1 || day_of_week > 6) {
    return res.status(400).json({ error: 'day_of_week must be 1 (Monday) through 6 (Saturday)' });
  }

  try {
    // Prevent double-booking: same teacher, same day+period, different class.
    if (teacher_id) {
      const clash = await pool.query(
        `SELECT ts.id, c.name AS class_name FROM timetable_slots ts JOIN classes c ON c.id = ts.class_id
         WHERE ts.teacher_id = $1 AND ts.day_of_week = $2 AND ts.period_number = $3 AND ts.class_id != $4`,
        [teacher_id, day_of_week, period_number, class_id]
      );
      if (clash.rowCount > 0) {
        return res.status(409).json({ error: `Teacher already scheduled in ${clash.rows[0].class_name} for this period` });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO timetable_slots (school_id, class_id, day_of_week, period_number, start_time, end_time, subject_id, teacher_id, room)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (class_id, day_of_week, period_number)
       DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
                     subject_id = EXCLUDED.subject_id, teacher_id = EXCLUDED.teacher_id, room = EXCLUDED.room
       RETURNING *`,
      [req.user.school_id, class_id, day_of_week, period_number, start_time || null, end_time || null, subject_id || null, teacher_id || null, room || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/timetable/slot/:id — remove a cell entirely (shrinks the grid,
// e.g. when a school reduces periods for a class)
router.delete('/slot/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM timetable_slots WHERE id = $1 AND school_id = $2',
      [req.params.id, req.user.school_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Slot not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
