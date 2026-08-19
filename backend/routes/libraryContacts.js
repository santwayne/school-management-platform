import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';

const router = express.Router();

// Library contacts have no login — this list is just who receives the
// daily due/overdue WhatsApp digest. Registration is Principal-only, same
// as fee_collectors.
router.get('/', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM library_contacts WHERE school_id = $1 ORDER BY name`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Library contacts list error:', err);
    res.status(500).json({ error: 'Failed to load library contacts' });
  }
});

router.post('/', requireAuth, requirePrincipal, async (req, res) => {
  const { name, whatsapp_number } = req.body;
  if (!name || !whatsapp_number) {
    return res.status(400).json({ error: 'name and whatsapp_number are required' });
  }
  const normalizedNumber = normalizePhone(whatsapp_number);
  if (!normalizedNumber) {
    return res.status(400).json({ error: 'whatsapp_number must be a valid Indian mobile number (10 digits, optionally with +91)' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO library_contacts (school_id, name, whatsapp_number) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.school_id, name, normalizedNumber]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This WhatsApp number is already registered' });
    console.error('Library contact create error:', err);
    res.status(500).json({ error: 'Failed to add library contact' });
  }
});

router.delete('/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    await pool.query('DELETE FROM library_contacts WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Library contact delete error:', err);
    res.status(500).json({ error: 'Failed to remove library contact' });
  }
});

export default router;
