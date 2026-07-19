import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireStudent } from '../middleware/auth.js';
import { askTutor } from '../services/tutorService.js';

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

  try {
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
    try {
      reply = await askTutor(history, message, session.subject, session.grade);
    } catch (tutorErr) {
      // Genuine AI integration failure (e.g. missing/invalid ANTHROPIC_API_KEY,
      // model error, rate limit). Log the real cause and tell the caller this
      // actually failed — don't write a fake assistant turn into the saved
      // conversation, and don't report 200 OK for a request that didn't work.
      console.error('Tutor ask error (AI call failed):', tutorErr.message);
      return res.status(502).json({ error: "The AI tutor is temporarily unavailable — please try again in a bit." });
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

    res.status(200).json({ success: true, session_id: session.id, reply, conversation_history: updatedHistory });
  } catch (err) {
    console.error('Tutor ask error:', err.message);
    res.status(500).json({ error: 'Failed to get tutor response' });
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
