import express from 'express';
import pool from '../config/db.js';
import { gradeAnswerSheetWithAI, generateTestWithRubric } from '../services/ocrGradingService.js';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { studentNoteQueue } from '../config/queue.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// AI test generator — produces a question paper from topic + difficulty,
// and now also generates + stores the grading rubric (correct answer per
// question) in the same call, so a test is immediately gradeable instead of
// needing someone to type answer keys in separately afterwards.
router.post('/test/generate', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { subject_id, chapter_id, difficulty, title, class_id, question_count } = req.body;

  if (!subject_id || !chapter_id || !difficulty) {
    return res.status(400).json({ error: 'subject_id, chapter_id and difficulty are required' });
  }

  const client = await pool.connect();
  try {
    const questions = await generateTestWithRubric({
      subject: subject_id,
      chapter: chapter_id,
      difficulty,
      questionCount: question_count || 5,
    });

    await client.query('BEGIN');
    const testRes = await client.query(
      `INSERT INTO generated_tests (school_id, subject_id, chapter_id, difficulty, questions, title, class_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        school_id, subject_id, chapter_id, difficulty,
        JSON.stringify(questions.map((q) => ({ q_num: q.q_num, question: q.question, marks: q.marks }))),
        title || `${subject_id} — ${chapter_id}`,
        class_id || null,
        req.user.teacher_id || null,
      ]
    );
    const testId = testRes.rows[0].id;

    for (const q of questions) {
      await client.query(
        `INSERT INTO test_rubrics (test_id, question_num, correct_answer, max_marks) VALUES ($1, $2, $3, $4)`,
        [testId, q.q_num, q.correct_answer || '', q.marks || 10]
      );
    }
    await client.query('COMMIT');

    res.status(200).json({ success: true, testId, questions });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Test generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate test' });
  } finally {
    client.release();
  }
});

// OCR answer-sheet grading — isolated sandbox endpoint per the spec's own
// risk note; requires a rubric to already exist for the question.
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

    // Fire-and-forget: generates an AI note about this student's performance
    // and pushes it to the assigned teacher's WhatsApp — queued so grading
    // stays fast even if the AI note / WhatsApp send is slow.
    await studentNoteQueue.add('studentNote', { studentId: student_id, testId: test_id });

    res.status(200).json({ success: true, evaluation });
  } catch (err) {
    console.error('AI grading error:', err.message);
    res.status(500).json({ error: 'Failed to process AI grading' });
  }
});

export default router;
