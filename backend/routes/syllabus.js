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
        // subject_ref_id is optional (nullable FK to the real subjects.id —
        // see schema.sql's note on why subject_id alone, a free-text
        // curriculum code, can't be safely joined against elsewhere). Not
        // required so the existing CSV import format keeps working
        // unchanged for anyone not using it yet.
        await client.query(
          `INSERT INTO syllabus_calendar
             (school_id, class_id, subject_id, subject_ref_id, chapter_id, chapter_name, target_start_date, target_end_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            schoolId,
            row.class_id,
            row.subject_id,
            row.subject_ref_id || null,
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

  const conditions = ['sc.school_id = $1'];
  const params = [schoolId];

  if (class_id) {
    params.push(class_id);
    conditions.push(`sc.class_id = $${params.length}`);
  }
  if (subject_id) {
    params.push(subject_id);
    conditions.push(`sc.subject_id = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT sc.*, sub.name AS subject_ref_name
       FROM syllabus_calendar sc
       LEFT JOIN subjects sub ON sub.id = sc.subject_ref_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY sc.target_start_date ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/syllabus/:id — edit dates/teacher assignment/real-subject link
router.patch('/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.school_id;
  const { target_start_date, target_end_date, teacher_id, chapter_name, subject_ref_id } = req.body;

  // has-own-property check (same pattern used elsewhere in this codebase,
  // e.g. academics.js's PATCH /students/:id) rather than COALESCE, since
  // COALESCE can never distinguish "clear this row's link" (explicit null)
  // from "leave it as-is" (omitted) — both look identical to a plain
  // `subject_ref_id || null`, and a principal re-tagging a row to the
  // correct subject after picking the wrong one needs to be able to clear
  // it, not just set it once.
  const hasSubjectRef = Object.prototype.hasOwnProperty.call(req.body, 'subject_ref_id');

  try {
    const result = await pool.query(
      `UPDATE syllabus_calendar SET
         target_start_date = COALESCE($1, target_start_date),
         target_end_date = COALESCE($2, target_end_date),
         teacher_id = COALESCE($3, teacher_id),
         chapter_name = COALESCE($4, chapter_name),
         subject_ref_id = CASE WHEN $7 THEN $8 ELSE subject_ref_id END
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [target_start_date || null, target_end_date || null, teacher_id || null, chapter_name || null, id, schoolId, hasSubjectRef, subject_ref_id || null]
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
