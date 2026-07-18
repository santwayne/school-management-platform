import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

const EVENT_TYPES = ['holiday', 'exam', 'ptm', 'general', 'sports', 'other'];
const AUDIENCES = ['all', 'staff', 'students', 'parents'];

// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD — defaults to the current month
router.get('/', requireAuth, async (req, res) => {
  const now = new Date();
  const from = req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = req.query.to || `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

  try {
    const { rows } = await pool.query(
      `SELECT e.*, t.name AS created_by_name FROM school_events e
       LEFT JOIN teachers t ON t.id = e.created_by
       WHERE e.school_id = $1 AND e.event_date >= $2 AND e.event_date < $3
       ORDER BY e.event_date ASC`,
      [req.user.school_id, from, to]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events — principal creates an event (holiday, exam date, PTM, etc.)
router.post('/', requireAuth, requirePrincipal, async (req, res) => {
  const { title, description, event_date, end_date, event_type = 'general', audience = 'all' } = req.body;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'title and event_date are required' });
  }
  if (!EVENT_TYPES.includes(event_type)) {
    return res.status(400).json({ error: `event_type must be one of: ${EVENT_TYPES.join(', ')}` });
  }
  if (!AUDIENCES.includes(audience)) {
    return res.status(400).json({ error: `audience must be one of: ${AUDIENCES.join(', ')}` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO school_events (school_id, title, description, event_date, end_date, event_type, audience, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.school_id, title, description || null, event_date, end_date || null, event_type, audience, req.user.teacher_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { title, description, event_date, end_date, event_type, audience } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE school_events SET
         title = COALESCE($1, title), description = COALESCE($2, description),
         event_date = COALESCE($3, event_date), end_date = $4,
         event_type = COALESCE($5, event_type), audience = COALESCE($6, audience)
       WHERE id = $7 AND school_id = $8 RETURNING *`,
      [title, description, event_date, end_date || null, event_type, audience, req.params.id, req.user.school_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM school_events WHERE id = $1 AND school_id = $2',
      [req.params.id, req.user.school_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
