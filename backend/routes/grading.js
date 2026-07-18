import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { gradeAnswerSheetImage } from '../services/ocrGradingService.js';
import { studentNoteQueue } from '../config/queue.js';

const router = express.Router();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB raw, matches server.js JSON body limit
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// GET /api/grading/tests — list tests for this school (optionally ?class_id=)
router.get('/tests', requireAuth, async (req, res) => {
  const { class_id } = req.query;
  try {
    const params = [req.user.school_id];
    let where = 'school_id = $1';
    if (class_id) {
      params.push(class_id);
      where += ` AND class_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, title, subject_id, chapter_id, difficulty, class_id, created_at,
         jsonb_array_length(questions) AS question_count
       FROM generated_tests WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/grading/tests/:id — full test detail: questions + rubric (marks, not the answer key itself unless principal)
router.get('/tests/:id', requireAuth, async (req, res) => {
  try {
    const testRes = await pool.query('SELECT * FROM generated_tests WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    if (testRes.rowCount === 0) return res.status(404).json({ error: 'Test not found' });

    const rubricRes = await pool.query(
      'SELECT question_num, max_marks, correct_answer FROM test_rubrics WHERE test_id = $1 ORDER BY question_num',
      [req.params.id]
    );
    res.json({ ...testRes.rows[0], rubric: rubricRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/grading/submit — the main production path: teacher/principal
// uploads a photo of a student's answer for one question, Claude vision
// extracts + grades it in one pass, result lands in the pending-review queue.
router.post('/submit', requireAuth, async (req, res) => {
  const { student_id, test_id, question_num, image_base64, media_type } = req.body;

  if (!student_id || !test_id || !question_num || !image_base64) {
    return res.status(400).json({ error: 'student_id, test_id, question_num and image_base64 are required' });
  }
  if (media_type && !ALLOWED_MEDIA_TYPES.includes(media_type)) {
    return res.status(400).json({ error: `media_type must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}` });
  }
  const approxBytes = (image_base64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image too large — please compress to under 8MB.' });
  }

  try {
    const testCheck = await pool.query('SELECT questions FROM generated_tests WHERE id = $1 AND school_id = $2', [test_id, req.user.school_id]);
    if (testCheck.rowCount === 0) return res.status(404).json({ error: 'Test not found for this school' });

    const studentCheck = await pool.query('SELECT id FROM students WHERE id = $1 AND school_id = $2', [student_id, req.user.school_id]);
    if (studentCheck.rowCount === 0) return res.status(404).json({ error: 'Student not found for this school' });

    const rubricRes = await pool.query(
      'SELECT correct_answer, max_marks FROM test_rubrics WHERE test_id = $1 AND question_num = $2',
      [test_id, question_num]
    );
    if (rubricRes.rowCount === 0) {
      return res.status(404).json({ error: 'No rubric found for this test/question — cannot grade automatically.' });
    }
    const maxMarks = Number(rubricRes.rows[0].max_marks) || 10;
    const questionText = (testCheck.rows[0].questions || []).find((q) => q.q_num === question_num)?.question;

    const evaluation = await gradeAnswerSheetImage({
      imageBase64: image_base64,
      mediaType: media_type || 'image/jpeg',
      question: questionText,
      correctAnswer: rubricRes.rows[0].correct_answer,
      maxMarks,
    });

    const { rows } = await pool.query(
      `INSERT INTO ai_graded_submissions
         (student_id, test_id, question_num, extracted_text, score, justification, answer_image_base64, max_marks, ocr_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, score, max_marks, justification, ocr_confidence`,
      [student_id, test_id, question_num, evaluation.extractedText, evaluation.score, evaluation.justification, image_base64, maxMarks, evaluation.confidence]
    );

    studentNoteQueue.add('studentNote', { studentId: student_id, testId: test_id }).catch((err) =>
      console.error('studentNoteQueue enqueue failed (non-fatal):', err.message)
    );

    res.status(200).json({ success: true, submission_id: rows[0].id, evaluation });
  } catch (err) {
    console.error('Image grading submit error:', err.message);
    res.status(500).json({ error: 'Failed to process AI grading' });
  }
});

// List submissions awaiting teacher confirmation. Nothing here is ever
// auto-confirmed — a teacher must explicitly confirm or override.
router.get('/pending', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT g.id, g.student_id, s.name AS student_name, g.test_id, t.title AS test_title, g.question_num,
              g.extracted_text, g.score AS ai_score, g.max_marks, g.justification, g.ocr_confidence,
              g.answer_image_base64, g.created_at
       FROM ai_graded_submissions g
       JOIN students s ON s.id = g.student_id
       JOIN generated_tests t ON t.id = g.test_id
       WHERE t.school_id = $1 AND g.teacher_confirmed = FALSE
       ORDER BY (g.ocr_confidence = 'low') DESC, g.created_at DESC`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Pending grading fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

// Confirm (or override) a single graded answer.
router.patch('/:id/confirm', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { final_score } = req.body;
  const teacher_id = req.user.teacher_id;

  try {
    // Join through generated_tests to scope this to the caller's own school —
    // without this, a teacher could confirm/override any school's grades by
    // guessing/incrementing a submission id.
    const existing = await pool.query(
      `SELECT g.score, g.max_marks FROM ai_graded_submissions g
       JOIN generated_tests t ON t.id = g.test_id
       WHERE g.id = $1 AND t.school_id = $2`,
      [id, req.user.school_id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Submission not found' });

    if (final_score != null && (final_score < 0 || final_score > existing.rows[0].max_marks)) {
      return res.status(400).json({ error: `final_score must be between 0 and ${existing.rows[0].max_marks}` });
    }
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

// GET /api/grading/results/:testId — final confirmed scores for a whole test (mark sheet view)
router.get('/results/:testId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.student_id, s.name AS student_name, g.question_num, g.final_score, g.score AS ai_score,
              g.max_marks, g.teacher_confirmed
       FROM ai_graded_submissions g
       JOIN students s ON s.id = g.student_id
       JOIN generated_tests t ON t.id = g.test_id
       WHERE g.test_id = $1 AND t.school_id = $2
       ORDER BY s.name, g.question_num`,
      [req.params.testId, req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
