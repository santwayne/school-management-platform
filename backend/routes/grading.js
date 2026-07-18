import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// List submissions awaiting teacher confirmation. AI grading (via
// /api/premium-ai/ocr/grade) writes rows here already — this endpoint is the
// missing piece: a queue a teacher can actually review before anything counts
// as final. Nothing here is ever auto-confirmed.
router.get('/pending', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT g.id, g.student_id, s.name AS student_name, g.test_id, g.question_num,
              g.extracted_text, g.score AS ai_score, g.justification, g.created_at
       FROM ai_graded_submissions g
       JOIN students s ON s.id = g.student_id
       JOIN generated_tests t ON t.id = g.test_id
       WHERE t.school_id = $1 AND g.teacher_confirmed = FALSE
       ORDER BY g.created_at DESC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Pending grading fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

// Confirm (or override) a single graded answer. final_score defaults to the
// AI's score if the teacher doesn't provide an override — but the row is
// only ever marked confirmed by an explicit call to this endpoint, never
// automatically.
router.patch('/:id/confirm', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { final_score } = req.body;
  const teacher_id = req.user.teacher_id;

  try {
    // Joined through generated_tests to scope this to the caller's own
    // school — without this, any teacher could confirm/override any
    // school's AI grading submissions just by knowing/guessing an id.
    const existing = await pool.query(
      `SELECT g.score FROM ai_graded_submissions g
       JOIN generated_tests t ON t.id = g.test_id
       WHERE g.id = $1 AND t.school_id = $2`,
      [id, req.user.school_id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Submission not found' });

    const scoreToUse = final_score !== undefined && final_score !== null ? final_score : existing.rows[0].score;

    const result = await pool.query(
      `UPDATE ai_graded_submissions g
       SET teacher_confirmed = TRUE, final_score = $1, confirmed_by = $2, confirmed_at = CURRENT_TIMESTAMP
       FROM generated_tests t
       WHERE g.id = $3 AND g.test_id = t.id AND t.school_id = $4
       RETURNING g.*`,
      [scoreToUse, teacher_id, id, req.user.school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Grading confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm grade' });
  }
});

export default router;
