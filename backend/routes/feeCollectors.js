import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fc.*,
              COALESCE(SUM(w.confirmed_amount) FILTER (WHERE w.status = 'CONFIRMED' AND w.confirmed_at > NOW() - INTERVAL '30 days'), 0) AS collected_last_30_days
       FROM fee_collectors fc
       LEFT JOIN whatsapp_cash_intake w ON w.fee_collector_id = fc.id
       WHERE fc.school_id = $1
       GROUP BY fc.id
       ORDER BY fc.name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fee collectors list error:', err);
    res.status(500).json({ error: 'Failed to load fee collectors' });
  }
});

router.post('/', requireAuth, requirePrincipal, async (req, res) => {
  const { name, whatsapp_number } = req.body;
  if (!name || !whatsapp_number) {
    return res.status(400).json({ error: 'name and whatsapp_number are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO fee_collectors (school_id, name, whatsapp_number) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.school_id, name, whatsapp_number]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This WhatsApp number is already registered' });
    console.error('Fee collector create error:', err);
    res.status(500).json({ error: 'Failed to add fee collector' });
  }
});

router.delete('/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM fee_collectors WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Fee collector delete error:', err);
    res.status(500).json({ error: 'Failed to remove fee collector' });
  }
});

export default router;
