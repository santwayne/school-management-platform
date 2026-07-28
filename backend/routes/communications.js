import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { notify } from '../services/notificationService.js';

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

// Compose + send. audience is one of:
// 'all_parents' | 'all_staff' | 'class:<id>' | 'student:<id>'.
// Resolves the actual recipient list server-side — the frontend only ever
// picks a category, it never sends a raw phone number list.
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
    let recipients = [];

    if (audience === 'all_parents') {
      const r = await pool.query(
        `SELECT phone FROM parents WHERE school_id = $1 AND opt_in_status = 'OPTED_IN'`,
        [school_id]
      );
      recipients = r.rows.map((row) => row.phone);
    } else if (audience === 'all_staff') {
      const r = await pool.query(`SELECT phone FROM teachers WHERE school_id = $1`, [school_id]);
      recipients = r.rows.map((row) => row.phone);
    } else if (audience.startsWith('class:')) {
      const classId = audience.split(':')[1];
      const r = await pool.query(
        `SELECT p.phone FROM parents p
         JOIN students s ON s.parent_id = p.id
         WHERE s.school_id = $1 AND s.class_id = $2 AND p.opt_in_status = 'OPTED_IN'`,
        [school_id, classId]
      );
      recipients = r.rows.map((row) => row.phone);
    } else if (audience.startsWith('student:')) {
      const studentId = audience.split(':')[1];
      const r = await pool.query(
        `SELECT p.phone FROM parents p
         JOIN students s ON s.parent_id = p.id
         WHERE s.school_id = $1 AND s.id = $2 AND p.opt_in_status = 'OPTED_IN'`,
        [school_id, studentId]
      );
      recipients = r.rows.map((row) => row.phone);
    } else {
      return res.status(400).json({ error: 'Unrecognized audience value' });
    }

    let delivered = 0;
    let failed = 0;
    for (const phone of recipients) {
      try {
        await sendTextMessage(phone, message);
        delivered += 1;
      } catch (sendErr) {
        console.error(`Broadcast send failed for ${phone}:`, sendErr.message);
        failed += 1;
      }
    }

    const thread_key = threadKeyFor(audience);

    const logResult = await pool.query(
      `INSERT INTO broadcasts (school_id, audience, audience_label, message, sent_by, recipient_count, delivered_count, failed_count, thread_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [school_id, audience, audience_label || audience, message, req.user.teacher_id || null, recipients.length, delivered, failed, thread_key]
    );
    const broadcast = logResult.rows[0];

    // End-to-end example of the generic notification hook: a new threaded
    // message pings every principal in the school (other than the sender,
    // if the sender happens to be one) so the notification bell has a real,
    // working event to show — not just plumbing. Best-effort: a notify()
    // failure shouldn't fail the send that already succeeded.
    if (thread_key) {
      try {
        const principals = await pool.query(
          `SELECT id, name FROM teachers WHERE school_id = $1 AND role = 'principal' AND id != $2`,
          [school_id, req.user.teacher_id || 0]
        );
        const senderName = req.user.role === 'principal' || req.user.role === 'teacher'
          ? (await pool.query('SELECT name FROM teachers WHERE id = $1', [req.user.teacher_id])).rows[0]?.name
          : 'Someone';
        for (const p of principals.rows) {
          await notify({
            schoolId: school_id,
            recipientRole: 'principal',
            recipientId: p.id,
            eventType: 'new_message',
            message: `${senderName || 'A staff member'} sent a message to ${broadcast.audience_label}`,
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
