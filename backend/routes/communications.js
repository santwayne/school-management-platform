import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { send as sendNotification } from '../services/notificationService.js';
import { draftBroadcastMessage } from '../services/aiService.js';

const router = express.Router();

// Only 'class:<id>' and 'student:<id>' audiences represent an addressable,
// re-visitable thread (a class or a family) — 'all_parents'/'all_staff' stay
// one-off campaigns and are never given a thread_key. See schema.sql.
function threadKeyFor(audience) {
  return audience.startsWith('class:') || audience.startsWith('student:') ? audience : null;
}

// A teacher may only message a class/individual student they actually teach
// (mirrors the class-notes assignment check); a principal can message any
// class/student in their own school. Mass 'all_parents'/'all_staff' blasts
// stay principal-only, same as before this feature.
async function assertCanSend(req, audience) {
  const schoolId = req.user.school_id;

  if (audience === 'all_parents' || audience === 'all_staff') {
    if (req.user.role !== 'principal') {
      const err = new Error('Only a principal can send a broadcast to all parents or all staff');
      err.status = 403;
      throw err;
    }
    return;
  }

  let classId = null;
  if (audience.startsWith('class:')) {
    classId = audience.split(':')[1];
  } else if (audience.startsWith('student:')) {
    const studentId = audience.split(':')[1];
    const s = await pool.query('SELECT class_id FROM students WHERE id = $1 AND school_id = $2', [studentId, schoolId]);
    if (s.rowCount === 0) {
      const err = new Error('Student not found for this school');
      err.status = 404;
      throw err;
    }
    classId = s.rows[0].class_id;
  } else {
    const err = new Error('Unrecognized audience value');
    err.status = 400;
    throw err;
  }

  if (req.user.role === 'principal') return;

  const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId]);
  if (classCheck.rowCount === 0) {
    const err = new Error('Class not found for this school');
    err.status = 404;
    throw err;
  }
  if (req.user.role === 'teacher') {
    const assigned = await pool.query(
      'SELECT 1 FROM class_subject_teachers WHERE class_id = $1 AND teacher_id = $2',
      [classId, req.user.teacher_id]
    );
    if (assigned.rowCount === 0) {
      const err = new Error('You are not assigned to this class');
      err.status = 403;
      throw err;
    }
    return;
  }

  const err = new Error('Not authorized to send messages');
  err.status = 403;
  throw err;
}

// History — reverse-chronological list of past broadcasts (mass blasts and
// threaded messages alike — this is the flat log the original Compose/
// History tabs use).
router.get('/', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT b.*, t.name AS sent_by_name
       FROM broadcasts b
       LEFT JOIN teachers t ON t.id = b.sent_by
       WHERE b.school_id = $1
       ORDER BY b.sent_at DESC
       LIMIT 100`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Broadcast history error:', err);
    res.status(500).json({ error: 'Failed to fetch broadcast history' });
  }
});

// GET /api/communications/threads — one row per class/individual thread
// (thread_key IS NOT NULL), most recently active first. Powers the Messages
// page's thread list.
router.get('/threads', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (thread_key)
         thread_key, audience_label, message AS last_message, sent_at AS last_sent_at,
         (SELECT COUNT(*) FROM broadcasts b2 WHERE b2.thread_key = b1.thread_key AND b2.school_id = $1) AS message_count
       FROM broadcasts b1
       WHERE school_id = $1 AND thread_key IS NOT NULL
       ORDER BY thread_key, sent_at DESC`,
      [school_id]
    );
    rows.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
    res.json(rows);
  } catch (err) {
    console.error('Thread list error:', err);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

// GET /api/communications/threads/:threadKey — full message history for one
// thread, oldest first (chat order), plus who each message went to.
router.get('/threads/:threadKey', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { threadKey } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT b.*, t.name AS sent_by_name
       FROM broadcasts b
       LEFT JOIN teachers t ON t.id = b.sent_by
       WHERE b.school_id = $1 AND b.thread_key = $2
       ORDER BY b.sent_at ASC`,
      [school_id, threadKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json({ thread_key: threadKey, audience_label: rows[rows.length - 1].audience_label, messages: rows });
  } catch (err) {
    console.error('Thread history error:', err);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// GET /api/communications/:id/recipients — per-recipient send/delivery
// breakdown for one broadcast (P-7: History's "Expand" previously only
// toggled the message text, with no way to see which specific number
// failed vs. delivered).
router.get('/:id/recipients', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { id } = req.params;
  try {
    const broadcastCheck = await pool.query('SELECT id FROM broadcasts WHERE id = $1 AND school_id = $2', [id, school_id]);
    if (broadcastCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }
    const { rows } = await pool.query(
      `SELECT phone, recipient_label, status, error_message, created_at, updated_at
       FROM broadcast_recipients WHERE broadcast_id = $1 ORDER BY id ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Broadcast recipients fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch recipient breakdown' });
  }
});

// Compose + send. audience is one of:
// 'all_parents' | 'all_staff' | 'class:<id>' | 'student:<id>'.
// Resolves the actual recipient list server-side — the frontend only ever
// picks a category, it never sends a raw phone number list.
// AI roadmap #3: drafts WhatsApp broadcast copy from a short prompt — the
// principal/teacher still reviews and edits before /send actually fires,
// same as before this existed. This is intentionally the only piece of
// the broadcast flow that changed: automating WHAT the message says was
// never the ask (see communications.js's own note on why this composer
// is intentionally manual) — automating the TYPING is. Nothing here sends
// anything; it only returns text for the existing composer's textarea.
router.post('/draft', requireAuth, async (req, res) => {
  const { prompt, audience_label } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const draft = await draftBroadcastMessage(prompt, audience_label);
    res.json({ draft });
  } catch (err) {
    if (err.message === 'ANTHROPIC_API_KEY is not configured') {
      return res.status(503).json({ error: 'AI drafting is not configured (ANTHROPIC_API_KEY missing) — write the message directly instead.' });
    }
    console.error('Broadcast draft generation failed:', err.message);
    res.status(502).json({ error: 'Could not generate a draft right now — write the message directly instead.' });
  }
});

router.post('/send', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { audience, audience_label, message } = req.body;

  if (!audience || !message) {
    return res.status(400).json({ error: 'audience and message are required' });
  }

  try {
    await assertCanSend(req, audience);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  try {
    // { phone, label } pairs — a phone-less row is dropped from `recipients`
    // (and counted in noNumberCount) instead of silently being attempted
    // and mis-reported as a failed send (T-2).
    let rows = [];

    if (audience === 'all_parents') {
      const r = await pool.query(
        `SELECT p.phone, s.name AS label FROM parents p
         LEFT JOIN students s ON s.parent_id = p.id
         WHERE p.school_id = $1 AND p.opt_in_status = 'OPTED_IN'`,
        [school_id]
      );
      rows = r.rows;
    } else if (audience === 'all_staff') {
      const r = await pool.query(`SELECT phone, name AS label FROM teachers WHERE school_id = $1`, [school_id]);
      rows = r.rows;
    } else if (audience.startsWith('class:')) {
      const classId = audience.split(':')[1];
      const r = await pool.query(
        `SELECT p.phone, s.name AS label FROM parents p
         JOIN students s ON s.parent_id = p.id
         WHERE s.school_id = $1 AND s.class_id = $2 AND p.opt_in_status = 'OPTED_IN'`,
        [school_id, classId]
      );
      rows = r.rows;
    } else if (audience.startsWith('student:')) {
      const studentId = audience.split(':')[1];
      const r = await pool.query(
        `SELECT p.phone, s.name AS label FROM parents p
         JOIN students s ON s.parent_id = p.id
         WHERE s.school_id = $1 AND s.id = $2 AND p.opt_in_status = 'OPTED_IN'`,
        [school_id, studentId]
      );
      rows = r.rows;
    } else {
      return res.status(400).json({ error: 'Unrecognized audience value' });
    }

    const recipients = rows.filter((row) => row.phone && row.phone.trim());
    const noNumberCount = rows.length - recipients.length;

    let delivered = 0;
    let failed = 0;
    const recipientResults = [];
    for (const { phone, label } of recipients) {
      try {
        const result = await sendTextMessage(phone, message);
        delivered += 1;
        recipientResults.push({ phone, label, status: 'SENT', wa_message_id: result?.messages?.[0]?.id || null, error_message: null });
      } catch (sendErr) {
        console.error(`Broadcast send failed for ${phone}:`, sendErr.message);
        failed += 1;
        recipientResults.push({ phone, label, status: 'FAILED', wa_message_id: null, error_message: sendErr.message });
      }
    }

    const thread_key = threadKeyFor(audience);

    const logResult = await pool.query(
      `INSERT INTO broadcasts (school_id, audience, audience_label, message, sent_by, recipient_count, delivered_count, failed_count, no_number_count, thread_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [school_id, audience, audience_label || audience, message, req.user.teacher_id || null, recipients.length, delivered, failed, noNumberCount, thread_key]
    );
    const broadcast = logResult.rows[0];

    // Per-recipient rows power the History "Expand" breakdown (P-7) and give
    // the /webhook status handler something to match a delivery/read/failed
    // callback against via wa_message_id.
    if (recipientResults.length > 0) {
      const values = [];
      const placeholders = recipientResults.map((r, i) => {
        const base = i * 6;
        values.push(broadcast.id, r.phone, r.label || null, r.status, r.wa_message_id, r.error_message);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      });
      await pool.query(
        `INSERT INTO broadcast_recipients (broadcast_id, phone, recipient_label, status, wa_message_id, error_message)
         VALUES ${placeholders.join(', ')}`,
        values
      );
    }

    // A new threaded message pings every principal in the school (other than
    // the sender, if the sender happens to be one) via the shared
    // notificationService — routed through the 'new_message' template
    // (seeded in schema.sql) rather than the notification bell's raw
    // trigger_event fallback text. Best-effort: a failure here must never
    // fail the send that already succeeded.
    if (thread_key) {
      try {
        const principals = await pool.query(
          `SELECT id FROM teachers WHERE school_id = $1 AND role = 'principal' AND id != $2`,
          [school_id, req.user.teacher_id || 0]
        );
        const senderName = req.user.role === 'principal' || req.user.role === 'teacher'
          ? (await pool.query('SELECT name FROM teachers WHERE id = $1', [req.user.teacher_id])).rows[0]?.name
          : 'Someone';
        if (principals.rows.length > 0) {
          await sendNotification({
            triggerEvent: 'new_message',
            schoolId: school_id,
            recipients: principals.rows.map((p) => ({ type: 'staff', teacherId: p.id })),
            variables: {
              sender_name: senderName || 'A staff member',
              audience_label: broadcast.audience_label,
            },
            link: `/admin/messages?thread=${encodeURIComponent(thread_key)}`,
          });
        }
      } catch (notifyErr) {
        console.error('Failed to notify principals of new message:', notifyErr.message);
      }
    }

    res.status(200).json(broadcast);
  } catch (err) {
    console.error('Broadcast send error:', err);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

export default router;
