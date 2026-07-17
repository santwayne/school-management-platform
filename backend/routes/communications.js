import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = express.Router();

// History — reverse-chronological list of past broadcasts.
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

// Compose + send. audience is one of: 'all_parents' | 'all_staff' | 'class:<id>'.
// Resolves the actual recipient list server-side — the frontend only ever
// picks a category, it never sends a raw phone number list.
router.post('/send', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { audience, audience_label, message } = req.body;

  if (!audience || !message) {
    return res.status(400).json({ error: 'audience and message are required' });
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

    const logResult = await pool.query(
      `INSERT INTO broadcasts (school_id, audience, audience_label, message, sent_by, recipient_count, delivered_count, failed_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [school_id, audience, audience_label || audience, message, req.user.teacher_id || null, recipients.length, delivered, failed]
    );

    res.status(200).json(logResult.rows[0]);
  } catch (err) {
    console.error('Broadcast send error:', err);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

export default router;
