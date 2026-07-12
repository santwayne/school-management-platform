import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

function validateRow(row) {
  const { class_id, subject_id, chapter_id, chapter_name, target_start_date, target_end_date } = row;
  if (!class_id) return 'class_id is required';
  if (!subject_id) return 'subject_id is required';
  if (!chapter_id) return 'chapter_id is required';
  if (!chapter_name || !chapter_name.trim()) return 'chapter_name is required';
  if (!target_start_date || !target_end_date) return 'target_start_date and target_end_date are required';
  const start = new Date(target_start_date);
  const end = new Date(target_end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'invalid date format';
  if (end < start) return 'target_end_date must be on/after target_start_date';
  return null;
}

// POST /api/syllabus/upload — bulk insert (used by both the CSV importer and the manual add-row form)
router.post('/upload', requireAuth, requirePrincipal, async (req, res) => {
  const { rows } = req.body;
  const schoolId = req.user.school_id;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  const client = await pool.connect();
  const details = [];
  let insertedCount = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const validationError = validateRow(row);
      if (validationError) {
        details.push({ index: i, error: validationError, row });
        continue;
      }

      try {
        await client.query(
          `INSERT INTO syllabus_calendar
             (school_id, class_id, subject_id, chapter_id, chapter_name, target_start_date, target_end_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            schoolId,
            row.class_id,
            row.subject_id,
            row.chapter_id,
            row.chapter_name.trim(),
            row.target_start_date,
            row.target_end_date,
          ]
        );
        insertedCount++;
      } catch (rowErr) {
        details.push({ index: i, error: rowErr.message, row });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      inserted_count: insertedCount,
      failed_count: details.length,
      details,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/syllabus?class_id=&subject_id= — list, optionally filtered
router.get('/', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { class_id, subject_id } = req.query;

  const conditions = ['school_id = $1'];
  const params = [schoolId];

  if (class_id) {
    params.push(class_id);
    conditions.push(`class_id = $${params.length}`);
  }
  if (subject_id) {
    params.push(subject_id);
    conditions.push(`subject_id = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM syllabus_calendar WHERE ${conditions.join(' AND ')} ORDER BY target_start_date ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/syllabus/:id — edit dates/teacher assignment
router.patch('/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.school_id;
  const { target_start_date, target_end_date, teacher_id, chapter_name } = req.body;

  try {
    const result = await pool.query(
      `UPDATE syllabus_calendar SET
         target_start_date = COALESCE($1, target_start_date),
         target_end_date = COALESCE($2, target_end_date),
         teacher_id = COALESCE($3, teacher_id),
         chapter_name = COALESCE($4, chapter_name)
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [target_start_date || null, target_end_date || null, teacher_id || null, chapter_name || null, id, schoolId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Syllabus row not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/syllabus/:id
router.delete('/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.school_id;
  try {
    const result = await pool.query('DELETE FROM syllabus_calendar WHERE id = $1 AND school_id = $2 RETURNING id', [id, schoolId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Syllabus row not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
