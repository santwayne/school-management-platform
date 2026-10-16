import express from 'express';
import pool from '../config/db.js';
import { gradeAnswerSheetWithAI, generateTestWithRubric } from '../services/ocrGradingService.js';
import { requireAuth } from '../middleware/auth.js';
import { sendStudentNoteNow } from '../services/studentNoteService.js';

const router = express.Router();

// AI test generator — produces a question paper from topic + difficulty and
// stores the grading rubric (model answer per question) with it, so the test
// is immediately gradeable.
//
// Generating 10+ questions with model answers can take longer than the
// reverse proxy's 60 s timeout, which left the browser with an error while
// the test sometimes appeared later ("result still pending"). So the request
// now returns at once (202) with the test in status 'generating', the work
// finishes in the background, and the Tests list shows generating / ready /
// failed (with the reason and a Retry button).
const MAX_QUESTIONS = 20;
const STALE_GENERATING_MINUTES = 10;

// The raw SDK error is JSON; the teacher needs to know what to do.
function friendlyAiError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return 'The AI key on the server is missing or invalid (ANTHROPIC_API_KEY). Ask the Waynur team to check it.';
  if (status === 404) return 'The AI model is not available for this key. Ask the Waynur team to check the model name.';
  if (status === 429 || status === 529 || status === 503) return 'The AI service is busy right now. Please retry in a minute.';
  if (err?.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(err?.message || '')) return 'The AI took too long to answer. Try fewer questions, then retry.';
  return String(err?.message || 'Generation failed');
}

async function generateIntoTest(testId, { subject, chapter, difficulty, questionCount }) {
  const client = await pool.connect();
  try {
    const questions = await generateTestWithRubric({ subject, chapter, difficulty, questionCount });
    await client.query('BEGIN');
    await client.query('DELETE FROM test_rubrics WHERE test_id = $1', [testId]);
    for (const q of questions) {
      await client.query(
        `INSERT INTO test_rubrics (test_id, question_num, correct_answer, max_marks) VALUES ($1, $2, $3, $4)`,
        [testId, q.q_num, q.correct_answer || '', q.marks || 10]
      );
    }
    await client.query(
      `UPDATE generated_tests SET questions = $2, status = 'ready', error = NULL WHERE id = $1`,
      [testId, JSON.stringify(questions.map((q) => ({ q_num: q.q_num, question: q.question, marks: q.marks })))]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Test generation error (test ${testId}):`, err.message);
    await pool
      .query(`UPDATE generated_tests SET status = 'failed', error = $2 WHERE id = $1`, [testId, friendlyAiError(err).slice(0, 500)])
      .catch((e) => console.error('Could not mark test as failed:', e.message));
  } finally {
    client.release();
  }
}

router.post('/test/generate', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { difficulty, class_id } = req.body;
  const subject = String(req.body.subject_id ?? '').trim();
  const chapter = String(req.body.chapter_id ?? '').trim();
  const title = String(req.body.title ?? '').trim();

  if (!subject || !chapter || !difficulty) {
    return res.status(400).json({ error: 'subject_id, chapter_id and difficulty are required' });
  }
  if (subject.length > 255 || chapter.length > 255 || title.length > 255) {
    return res.status(400).json({ error: 'Subject, chapter and title must each be under 255 characters.' });
  }
  const questionCount = Math.min(MAX_QUESTIONS, Math.max(1, Math.round(Number(req.body.question_count) || 5)));

  try {
    const testRes = await pool.query(
      `INSERT INTO generated_tests (school_id, subject_id, chapter_id, difficulty, questions, title, class_id, created_by, status, requested_questions)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6, $7, 'generating', $8) RETURNING id`,
      [school_id, subject, chapter, difficulty, title || `${subject} — ${chapter}`, class_id || null, req.user.teacher_id || null, questionCount]
    );
    const testId = testRes.rows[0].id;
    // Not awaited on purpose: the server is a long-running process (PM2), and
    // the outcome is recorded on the row either way.
    generateIntoTest(testId, { subject, chapter, difficulty, questionCount });
    res.status(202).json({ success: true, testId, status: 'generating' });
  } catch (err) {
    console.error('Test generation start error:', err.message);
    res.status(500).json({ error: `Failed to start test generation: ${err.message}` });
  }
});

// Retry a test that failed (or got stuck because the server restarted mid-way).
router.post('/test/:id/retry', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE generated_tests SET status = 'generating', error = NULL, created_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND school_id = $2
          AND (status = 'failed' OR (status = 'generating' AND created_at < NOW() - make_interval(mins => $3)))
        RETURNING id, subject_id, chapter_id, difficulty, COALESCE(requested_questions, 5) AS requested_questions`,
      [req.params.id, req.user.school_id, STALE_GENERATING_MINUTES]
    );
    if (!r.rowCount) return res.status(409).json({ error: 'This test is not in a failed state (it may still be generating).' });
    const t = r.rows[0];
    generateIntoTest(t.id, { subject: t.subject_id, chapter: t.chapter_id, difficulty: t.difficulty, questionCount: t.requested_questions });
    res.status(202).json({ success: true, testId: t.id, status: 'generating' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ocr/grade', requireAuth, async (req, res) => {
  const { student_id, test_id, question_num, ocr_text } = req.body;

  if (!student_id || !test_id || !question_num || !ocr_text) {
    return res.status(400).json({ error: 'student_id, test_id, question_num and ocr_text are required' });
  }

  try {
    const rubricRes = await pool.query(
      'SELECT correct_answer, max_marks FROM test_rubrics WHERE test_id = $1 AND question_num = $2',
      [test_id, question_num]
    );
    if (rubricRes.rowCount === 0) {
      return res.status(404).json({ error: 'No rubric found for this test/question — cannot grade automatically.' });
    }
    const maxMarks = Number(rubricRes.rows[0].max_marks) || 10;

    const evaluation = await gradeAnswerSheetWithAI(ocr_text, rubricRes.rows[0].correct_answer, maxMarks);

    await pool.query(
      `INSERT INTO ai_graded_submissions (student_id, test_id, question_num, extracted_text, score, justification, max_marks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [student_id, test_id, question_num, ocr_text, evaluation.score, evaluation.justification, maxMarks]
    );

    // Generates an AI note about this student's performance and pushes it to
    // the assigned teacher's WhatsApp. Previously queued for a background
    // worker — now awaited inline, since a serverless function isn't
    // guaranteed to keep running after the response is sent, so a queued/
    // unawaited job here would not reliably execute. Failure here must never
    // fail the grading response itself.
    try {
      await sendStudentNoteNow({ studentId: student_id, testId: test_id });
    } catch (err) {
      console.error('sendStudentNoteNow failed (non-fatal):', err.message);
    }

    res.status(200).json({ success: true, evaluation });
  } catch (err) {
    console.error('AI grading error:', err.message);
    res.status(500).json({ error: 'Failed to process AI grading' });
  }
});

export default router;
