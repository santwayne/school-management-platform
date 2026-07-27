import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// Maps the logged-in user to their recipient_type/recipient_id for the feed
// query — teachers/principal/accountant are all 'staff' rows in `teachers`.
function recipientFromUser(user) {
  if (user.role === 'student') return { recipientType: 'student', recipientId: user.student_id };
  if (['teacher', 'principal', 'accountant'].includes(user.role)) return { recipientType: 'staff', recipientId: user.teacher_id };
  return null;
}

// ---------------- Dashboard feed (bell icon) ----------------

router.get('/', requireAuth, async (req, res) => {
  const who = recipientFromUser(req.user);
  if (!who) return res.status(403).json({ error: 'No notification feed for this account type' });

  try {
    const { rows } = await pool.query(
      `SELECT id, trigger_event, title, body, is_read, created_at, student_id
         FROM dashboard_notifications
        WHERE school_id = $1 AND recipient_type = $2 AND recipient_id = $3
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.user.school_id, who.recipientType, who.recipientId]
    );
    const unreadCount = rows.filter((r) => !r.is_read).length;
    res.json({ notifications: rows, unread_count: unreadCount });
  } catch (err) {
    console.error('Notification feed error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  const who = recipientFromUser(req.user);
  if (!who) return res.status(403).json({ error: 'No notification feed for this account type' });

  try {
    const { rows } = await pool.query(
      `UPDATE dashboard_notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND school_id = $2 AND recipient_type = $3 AND recipient_id = $4
        RETURNING id`,
      [req.params.id, req.user.school_id, who.recipientType, who.recipientId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark-as-read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.patch('/read-all', requireAuth, async (req, res) => {
  const who = recipientFromUser(req.user);
  if (!who) return res.status(403).json({ error: 'No notification feed for this account type' });

  try {
    await pool.query(
      `UPDATE dashboard_notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
        WHERE school_id = $1 AND recipient_type = $2 AND recipient_id = $3 AND is_read = FALSE`,
      [req.user.school_id, who.recipientType, who.recipientId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark-all-read error:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ---------------- Template CRUD (Principal — no code deploy needed) ----------------

router.get('/templates', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notification_templates WHERE school_id = $1 OR school_id IS NULL ORDER BY trigger_event`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Template list error:', err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// Creates/updates a SCHOOL-SPECIFIC override for a trigger_event (the global
// default row, school_id IS NULL, is seeded by schema.sql).
router.put('/templates/:triggerEvent', requireAuth, requirePrincipal, async (req, res) => {
  const {
    channel, name, whatsapp_template_name, whatsapp_param_order,
    dashboard_title_template, dashboard_body_template, media_supported,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO notification_templates
         (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order,
          dashboard_title_template, dashboard_body_template, media_supported)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (school_id, trigger_event) WHERE school_id IS NOT NULL
       DO UPDATE SET
         channel = EXCLUDED.channel, name = EXCLUDED.name,
         whatsapp_template_name = EXCLUDED.whatsapp_template_name,
         whatsapp_param_order = EXCLUDED.whatsapp_param_order,
         dashboard_title_template = EXCLUDED.dashboard_title_template,
         dashboard_body_template = EXCLUDED.dashboard_body_template,
         media_supported = EXCLUDED.media_supported,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        req.user.school_id, req.params.triggerEvent, channel || 'both', name,
        whatsapp_template_name || null, JSON.stringify(whatsapp_param_order || []),
        dashboard_title_template || null, dashboard_body_template || null, !!media_supported,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Template upsert error:', err);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

export default router;
