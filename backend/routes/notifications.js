import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Maps the authenticated user onto the (recipient_role, recipient_id) shape
// notifications are stored under — mirrors req.user directly, see
// services/notificationService.js.
function currentRecipient(req) {
  const recipientId = req.user.role === 'student' ? req.user.student_id : req.user.teacher_id;
  return { recipientRole: req.user.role, recipientId };
}

// GET /api/notifications — current user's notifications, most recent first,
// with an unread count for the bell badge.
router.get('/', requireAuth, async (req, res) => {
  const { recipientRole, recipientId } = currentRecipient(req);
  if (!recipientId) {
    return res.json({ notifications: [], unread_count: 0 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications
       WHERE school_id = $1 AND recipient_role = $2 AND recipient_id = $3
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.school_id, recipientRole, recipientId]
    );
    const unread_count = rows.filter((n) => !n.read_at).length;
    res.json({ notifications: rows, unread_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read — mark a single notification read
router.put('/:id/read', requireAuth, async (req, res) => {
  const { recipientRole, recipientId } = currentRecipient(req);
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND school_id = $2 AND recipient_role = $3 AND recipient_id = $4
       RETURNING *`,
      [req.params.id, req.user.school_id, recipientRole, recipientId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all — bulk mark-all-read for the bell dropdown
router.put('/read-all', requireAuth, async (req, res) => {
  const { recipientRole, recipientId } = currentRecipient(req);
  try {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE school_id = $1 AND recipient_role = $2 AND recipient_id = $3 AND read_at IS NULL`,
      [req.user.school_id, recipientRole, recipientId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
