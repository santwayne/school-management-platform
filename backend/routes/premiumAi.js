import express from 'express';
import pool from '../config/db.js';
import { gradeAnswerSheetWithAI } from '../services/ocrGradingService.js';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// AI test generator — produces a question paper from topic + difficulty.
router.post('/test/generate', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { subject_id, chapter_id, difficulty } = req.body;

  if (!subject_id || !chapter_id || !difficulty) {
    return res.status(400).json({ error: 'subject_id, chapter_id and difficulty are required' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system:
        'You are a school exam-paper setter. Return ONLY a JSON array, no other text, of objects: ' +
        '{ "q_num": <int>, "question": "<string>", "marks": <int> }.',
      messages: [
        {
          role: 'user',
          content: `Generate 5 exam questions for subject "${subject_id}", chapter "${chapter_id}", difficulty "${difficulty}".`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const cleaned = (textBlock?.text || '[]').trim().replace(/^```json\s*|\s*```$/g, '');
    const questions = JSON.parse(cleaned);

    const testRes = await pool.query(
      `INSERT INTO generated_tests (school_id, subject_id, chapter_id, difficulty, questions)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [school_id, subject_id, chapter_id, difficulty, JSON.stringify(questions)]
    );

    res.status(200).json({ success: true, testId: testRes.rows[0].id, questions });
  } catch (err) {
    console.error('Test generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate test' });
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
      'SELECT correct_answer FROM test_rubrics WHERE test_id = $1 AND question_num = $2',
      [test_id, question_num]
    );
    if (rubricRes.rowCount === 0) {
      return res.status(404).json({ error: 'No rubric found for this test/question — cannot grade automatically.' });
    }

    const evaluation = await gradeAnswerSheetWithAI(ocr_text, rubricRes.rows[0].correct_answer);

    await pool.query(
      `INSERT INTO ai_graded_submissions (student_id, test_id, question_num, extracted_text, score, justification)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [student_id, test_id, question_num, ocr_text, evaluation.score, evaluation.justification]
    );

    res.status(200).json({ success: true, evaluation });
  } catch (err) {
    console.error('AI grading error:', err.message);
    res.status(500).json({ error: 'Failed to process AI grading' });
  }
});

export default router;
