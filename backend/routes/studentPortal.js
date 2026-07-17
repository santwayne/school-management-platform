import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireStudent, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// Homework — teacher-assigned (Principal/teacher create), student marks done
// ============================================================

// List homework for the logged-in student's class.
router.get('/homework', requireAuth, requireStudent, async (req, res) => {
  try {
    const studentRes = await pool.query('SELECT class_id FROM students WHERE id = $1', [req.user.student_id]);
    if (studentRes.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    const classId = studentRes.rows[0].class_id;

    const result = await pool.query(
      `SELECT h.id, h.subject_id, h.title, h.description, h.due_date, h.created_at,
              (hc.id IS NOT NULL) AS done
       FROM homework h
       LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = $2
       WHERE h.class_id = $1
       ORDER BY h.due_date NULLS LAST, h.created_at DESC`,
      [classId, req.user.student_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Homework list error:', err);
    res.status(500).json({ error: 'Failed to load homework' });
  }
});

// Teacher/Principal assigns homework to a class.
router.post('/homework', requireAuth, async (req, res) => {
  if (!['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  const school_id = req.user.school_id;
  const { class_id, subject_id, title, description, due_date } = req.body;
  if (!class_id || !subject_id || !title) {
    return res.status(400).json({ error: 'class_id, subject_id and title are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO homework (school_id, class_id, subject_id, title, description, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [school_id, class_id, subject_id, title, description || null, due_date || null, req.user.teacher_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Homework create error:', err);
    res.status(500).json({ error: 'Failed to create homework' });
  }
});

// Student marks/unmarks a homework item done — this also feeds Rewards XP.
router.post('/homework/:id/toggle', requireAuth, requireStudent, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await pool.query(
      'SELECT id FROM homework_completions WHERE homework_id = $1 AND student_id = $2',
      [id, req.user.student_id]
    );
    if (existing.rowCount > 0) {
      await pool.query('DELETE FROM homework_completions WHERE id = $1', [existing.rows[0].id]);
      return res.json({ done: false });
    }
    await pool.query(
      'INSERT INTO homework_completions (homework_id, student_id) VALUES ($1, $2)',
      [id, req.user.student_id]
    );
    res.json({ done: true });
  } catch (err) {
    console.error('Homework toggle error:', err);
    res.status(500).json({ error: 'Failed to update homework status' });
  }
});

// ============================================================
// Notes — student's own study notes, private to them
// ============================================================

router.get('/notes', requireAuth, requireStudent, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM student_notes WHERE student_id = $1 ORDER BY updated_at DESC',
      [req.user.student_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Notes list error:', err);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

router.post('/notes', requireAuth, requireStudent, async (req, res) => {
  const { title, subject_id, content } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO student_notes (school_id, student_id, title, subject_id, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.school_id, req.user.student_id, title || 'Untitled note', subject_id || null, content || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Note create error:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.patch('/notes/:id', requireAuth, requireStudent, async (req, res) => {
  const { id } = req.params;
  const { title, content, subject_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE student_notes SET
         title = COALESCE($1, title),
         content = COALESCE($2, content),
         subject_id = COALESCE($3, subject_id),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND student_id = $5 RETURNING *`,
      [title, content, subject_id, id, req.user.student_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Note update error:', err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/notes/:id', requireAuth, requireStudent, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM student_notes WHERE id = $1 AND student_id = $2', [id, req.user.student_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Note delete error:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ============================================================
// Progress — chapter completion (from syllabus_progress, class-wide) +
// average confirmed test score for this student
// ============================================================

router.get('/progress', requireAuth, requireStudent, async (req, res) => {
  try {
    const studentRes = await pool.query('SELECT class_id FROM students WHERE id = $1', [req.user.student_id]);
    if (studentRes.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    const classId = studentRes.rows[0].class_id;

    const bySubject = await pool.query(
      `SELECT sc.subject_id,
              COUNT(*) AS chapters_total,
              COUNT(sp.id) AS chapters_done
       FROM syllabus_calendar sc
       LEFT JOIN syllabus_progress sp ON sp.chapter_id = sc.chapter_id AND sp.class_id = sc.class_id
       WHERE sc.class_id = $1
       GROUP BY sc.subject_id`,
      [classId]
    );

    const avgScoreRes = await pool.query(
      `SELECT AVG(final_score) AS avg_score
       FROM ai_graded_submissions
       WHERE student_id = $1 AND teacher_confirmed = TRUE
       AND created_at > NOW() - INTERVAL '90 days'`,
      [req.user.student_id]
    );

    const weekChaptersRes = await pool.query(
      `SELECT COUNT(*) FROM syllabus_progress sp
       JOIN syllabus_calendar sc ON sc.chapter_id = sp.chapter_id AND sc.class_id = sp.class_id
       WHERE sp.class_id = $1 AND sp.marked_complete_date > CURRENT_DATE - INTERVAL '7 days'`,
      [classId]
    );

    res.json({
      by_subject: bySubject.rows,
      avg_score_last_90_days: avgScoreRes.rows[0].avg_score ? Number(avgScoreRes.rows[0].avg_score).toFixed(1) : null,
      chapters_this_week: parseInt(weekChaptersRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// ============================================================
// Rewards — XP + streak + badges, computed live from real activity.
// XP rule (confirmed with Pankaj): +5/day present, +10/homework done,
// +5/tutor session, +15/confirmed test score >= 80%.
// Nothing here is hardcoded per-student — every number comes from a query.
// ============================================================

const XP = { attendance: 5, homework: 10, tutorSession: 5, goodTest: 15 };
const GOOD_TEST_THRESHOLD = 80;

router.get('/rewards', requireAuth, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  try {
    const attendanceRes = await pool.query(
      `SELECT date FROM attendance WHERE student_id = $1 AND status = 'present' ORDER BY date DESC`,
      [studentId]
    );
    const presentDays = attendanceRes.rows.length;

    // Current streak: consecutive present days counting back from the most
    // recent attendance record (naive day-by-day walk — fine at this scale).
    let streak = 0;
    let cursor = null;
    for (const row of attendanceRes.rows) {
      const d = new Date(row.date);
      if (cursor === null) {
        streak = 1;
        cursor = d;
        continue;
      }
      const dayDiff = Math.round((cursor - d) / (1000 * 60 * 60 * 24));
      if (dayDiff === 1) {
        streak += 1;
        cursor = d;
      } else {
        break;
      }
    }

    const homeworkDoneRes = await pool.query(
      'SELECT COUNT(*) FROM homework_completions WHERE student_id = $1',
      [studentId]
    );
    const homeworkDone = parseInt(homeworkDoneRes.rows[0].count, 10);

    const tutorSessionsRes = await pool.query(
      'SELECT COUNT(*) FROM tutor_sessions WHERE student_id = $1',
      [studentId]
    );
    const tutorSessions = parseInt(tutorSessionsRes.rows[0].count, 10);

    const goodTestsRes = await pool.query(
      `SELECT COUNT(*) FROM ai_graded_submissions
       WHERE student_id = $1 AND teacher_confirmed = TRUE AND final_score >= $2`,
      [studentId, GOOD_TEST_THRESHOLD]
    );
    const goodTests = parseInt(goodTestsRes.rows[0].count, 10);

    const xp =
      presentDays * XP.attendance +
      homeworkDone * XP.homework +
      tutorSessions * XP.tutorSession +
      goodTests * XP.goodTest;

    // This week's homework completion rate — drives the "Perfect week" badge.
    const weekHomeworkRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE h.due_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE) AS assigned_this_week,
         COUNT(hc.id) FILTER (WHERE h.due_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE) AS done_this_week
       FROM homework h
       JOIN students s ON s.class_id = h.class_id
       LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = $1
       WHERE s.id = $1`,
      [studentId]
    );
    const { assigned_this_week, done_this_week } = weekHomeworkRes.rows[0];
    const perfectWeek = parseInt(assigned_this_week, 10) > 0 && assigned_this_week === done_this_week;

    const badges = [
      { key: 'streak_5', label: '5-day streak', earned: streak >= 5, progress: `${Math.min(streak, 5)}/5` },
      { key: 'streak_10', label: '10-day streak', earned: streak >= 10, progress: `${Math.min(streak, 10)}/10` },
      { key: 'perfect_week', label: 'Perfect week', earned: perfectWeek, progress: perfectWeek ? 'Done' : `${done_this_week}/${assigned_this_week || 0}` },
      { key: 'quiz_master', label: 'Quiz master', earned: goodTests > 0, progress: goodTests > 0 ? 'Done' : `0/1` },
    ];

    res.json({
      xp,
      streak,
      present_days: presentDays,
      homework_done: homeworkDone,
      tutor_sessions: tutorSessions,
      good_tests: goodTests,
      badges,
      xp_rules: XP,
    });
  } catch (err) {
    console.error('Rewards fetch error:', err);
    res.status(500).json({ error: 'Failed to load rewards' });
  }
});

export default router;
