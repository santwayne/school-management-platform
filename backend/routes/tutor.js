import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireStudent } from '../middleware/auth.js';
import { askTutor, TUTOR_MAX_MESSAGE_CHARS } from '../services/tutorService.js';
import { logAiUsage, tutorQuotaFor } from '../services/aiUsage.js';
import { reviewSessionIfDue, tutorContextFor } from '../services/studentMemory.js';

const router = express.Router();

// Start or continue a tutoring session. If session_id is omitted, a new
// session is created. Conversation history is stored server-side so the
// student's phone/browser doesn't need to hold state between messages.
router.post('/ask', requireAuth, requireStudent, async (req, res) => {
  const { student_id, school_id } = req.user;
  const { session_id, subject, grade, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  // Huge pastes (a whole chapter, a long essay) cost a lot and are not how
  // the tutor is meant to be used — ask for the actual question instead.
  if (message.length > TUTOR_MAX_MESSAGE_CHARS) {
    return res.status(400).json({
      error: `Your message is too long — please send just the question you are stuck on (max ${TUTOR_MAX_MESSAGE_CHARS} characters).`,
      code: 'message_too_long',
    });
  }

  try {
    // Monthly per-student tutor quota (TUTOR_MONTHLY_TOKEN_CAP; off when unset).
    const quota = await tutorQuotaFor(student_id);
    if (quota.exhausted) {
      return res.status(429).json({
        error: 'You have used all your AI Tutor time for this month.',
        code: 'tutor_quota_exhausted',
        quota,
      });
    }

    let session;

    if (session_id) {
      const existing = await pool.query(
        'SELECT id, subject, grade, conversation_history FROM tutor_sessions WHERE id = $1 AND student_id = $2',
        [session_id, student_id]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      session = existing.rows[0];
    } else {
      if (!subject) {
        return res.status(400).json({ error: 'subject is required to start a new session' });
      }
      const created = await pool.query(
        `INSERT INTO tutor_sessions (school_id, student_id, subject, grade, conversation_history)
         VALUES ($1, $2, $3, $4, '[]')
         RETURNING id, subject, grade, conversation_history`,
        [school_id, student_id, subject, grade || null]
      );
      session = created.rows[0];
    }

    const history = session.conversation_history || [];
    let reply;
    let aiCall;
    try {
      // What the tutor has learned about this student so far (never blocks the chat).
      const context = await tutorContextFor(school_id, student_id).catch(() => '');
      aiCall = await askTutor(history, message, session.subject, session.grade, context);
      reply = aiCall.text;
    } catch (tutorErr) {
      // Genuine AI integration failure (e.g. missing/invalid ANTHROPIC_API_KEY,
      // model error, rate limit). Log the real cause and tell the caller this
      // actually failed — don't write a fake assistant turn into the saved
      // conversation, and don't report 200 OK for a request that didn't work.
      console.error('Tutor ask error (AI call failed):', tutorErr.message);
      if (tutorErr.message === 'ANTHROPIC_API_KEY is not configured') {
        return res.status(502).json({ error: 'AI Tutor is unavailable — API key not configured.' });
      }
      return res.status(502).json({ error: 'The AI tutor is temporarily unavailable — please try again in a bit.' });
    }

    const updatedHistory = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: reply },
    ];

    await pool.query(
      `UPDATE tutor_sessions SET conversation_history = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(updatedHistory), session.id]
    );

    // Meter the call (never blocks or fails the reply).
    await logAiUsage({ schoolId: school_id, studentId: student_id, feature: 'tutor', model: aiCall.model, usage: aiCall.usage, refId: session.id });

    res.status(200).json({ success: true, session_id: session.id, reply, conversation_history: updatedHistory });

    // After the reply is sent: fold what this session showed into the student's learning profile.
    reviewSessionIfDue(school_id, student_id, session.id).catch((e) => console.error('Student memory review failed:', e.message));
  } catch (err) {
    console.error('Tutor route error:', err.message);
    res.status(500).json({ error: 'Failed to process tutor request' });
  }
});

// This student's AI Tutor allowance for the current month (for the dashboard).
router.get('/usage', requireAuth, requireStudent, async (req, res) => {
  try {
    res.status(200).json({ success: true, quota: await tutorQuotaFor(req.user.student_id) });
  } catch (err) {
    console.error('Tutor usage error:', err.message);
    res.status(500).json({ error: 'Failed to load tutor usage' });
  }
});

// List this student's past sessions (most recent first) for a session picker.
router.get('/sessions', requireAuth, requireStudent, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, subject, grade, updated_at,
              conversation_history -> -2 ->> 'content' AS last_student_message
       FROM tutor_sessions WHERE student_id = $1 ORDER BY updated_at DESC LIMIT 20`,
      [req.user.student_id]
    );
    res.status(200).json({ success: true, sessions: result.rows });
  } catch (err) {
    console.error('Tutor sessions list error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// Full history for one session (e.g. resuming after closing the app).
router.get('/sessions/:id', requireAuth, requireStudent, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, subject, grade, conversation_history FROM tutor_sessions WHERE id = $1 AND student_id = $2',
      [req.params.id, req.user.student_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.status(200).json({ success: true, session: result.rows[0] });
  } catch (err) {
    console.error('Tutor session fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

export default router;
