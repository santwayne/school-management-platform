import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Surfaces sustained (3+ week) performance drift for human review — never
// an automatic verdict. Scoped to the caller's own school via the token.
// Per-STUDENT since performanceDriftWorker.js's revision (see that
// worker's own header comment) — student_name is now the primary label;
// teacher_name stays NULL (LEFT JOIN) since an overall student-level
// signal isn't tied to one teacher the way the original class+subject
// design was.
router.get('/drift-alerts', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const alerts = await pool.query(
      `SELECT ps.*, c.name AS class_name, t.name AS teacher_name, st.name AS student_name
       FROM performance_snapshots ps
       JOIN classes c ON ps.class_id = c.id
       LEFT JOIN teachers t ON ps.teacher_id = t.id
       LEFT JOIN students st ON ps.student_id = st.id
       WHERE ps.school_id = $1 AND ps.flagged = TRUE
       ORDER BY ps.period DESC`,
      [school_id]
    );

    res.json({
      success: true,
      framing: 'These patterns are surfaced for human review, not as automatic verdicts.',
      data: alerts.rows,
    });
  } catch (err) {
    console.error('Drift alerts error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// AI roadmap #2: recurring-doubt signal. student_doubts.chapter_tag was
// always 'Untagged' before (see routes/whatsapp.js's fix) — now that real
// tagging happens, this surfaces "N different students asked about the
// same chapter this week" as a re-teach signal, instead of a teacher
// having to notice that pattern from memory across dozens of individual
// WhatsApp replies they never see in aggregate.
//
// DECISIONS MADE WITHOUT ASKING (see SUMMARY.md):
// - Rolling 7-day window — matches "this week" framing, short enough that
//   the signal stays current.
// - Minimum 3 DISTINCT students (not 3 messages — one chatty student
//   re-asking the same thing three times is not a class-wide pattern).
// - Teachers see only their own assigned classes (via
//   class_subject_teachers); principals see the whole school — same
//   role-scoping shape as the rest of this codebase's teacher-vs-principal
//   views, even though drift-alerts above doesn't yet differentiate.
router.get('/recurring-doubts', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const MIN_STUDENTS = 3;
  try {
    const params = [school_id, MIN_STUDENTS];
    let teacherScope = '';
    if (req.user.role === 'teacher') {
      params.push(req.user.teacher_id);
      teacherScope = `AND s.class_id IN (SELECT class_id FROM class_subject_teachers WHERE teacher_id = $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT c.id AS class_id, c.name AS class_name, sd.chapter_tag,
              COUNT(DISTINCT sd.student_id) AS student_count,
              MAX(sd.created_at) AS most_recent
       FROM student_doubts sd
       JOIN students s ON s.id = sd.student_id
       JOIN classes c ON c.id = s.class_id
       WHERE sd.school_id = $1
         AND sd.chapter_tag IS NOT NULL AND sd.chapter_tag != 'Untagged'
         AND sd.created_at >= NOW() - INTERVAL '7 days'
         ${teacherScope}
       GROUP BY c.id, c.name, sd.chapter_tag
       HAVING COUNT(DISTINCT sd.student_id) >= $2
       ORDER BY student_count DESC`,
      params
    );

    res.json({
      success: true,
      framing: 'Recurring doubts surfaced for the teacher to review — not a grading or performance judgment.',
      data: rows,
    });
  } catch (err) {
    console.error('Recurring doubts error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
