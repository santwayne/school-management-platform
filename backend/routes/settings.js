import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// Get this school's settings — creates a default row on first read so the
// frontend never has to handle a missing-settings case.
router.get('/', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    let result = await pool.query('SELECT * FROM school_settings WHERE school_id = $1', [school_id]);
    if (result.rowCount === 0) {
      result = await pool.query(
        'INSERT INTO school_settings (school_id) VALUES ($1) RETURNING *',
        [school_id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update branding (logo + school name). Logo upload itself (S3/Cloudinary)
// is not wired here yet — this accepts a logo_url once that's in place;
// for now the frontend can pass a hosted URL or leave it null.
router.patch('/branding', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { logo_url, school_name } = req.body;
  try {
    if (school_name) {
      await pool.query('UPDATE schools SET name = $1 WHERE id = $2', [school_name, school_id]);
    }
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, logo_url) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, logo_url || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Branding update error:', err);
    res.status(500).json({ error: 'Failed to update branding' });
  }
});

// Update WhatsApp Business number. NOTE: this stores the number and flips
// whatsapp_connected — it does not itself perform WhatsApp Business API
// verification. Wire that check in before trusting whatsapp_connected=true
// in production; right now a principal typing a number in is enough to
// set it to true, which is a placeholder, not a real verification.
router.patch('/whatsapp', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { whatsapp_business_number } = req.body;
  if (!whatsapp_business_number) {
    return res.status(400).json({ error: 'whatsapp_business_number is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, whatsapp_business_number, whatsapp_connected)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (school_id) DO UPDATE SET
         whatsapp_business_number = EXCLUDED.whatsapp_business_number,
         whatsapp_connected = TRUE,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, whatsapp_business_number]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('WhatsApp settings update error:', err);
    res.status(500).json({ error: 'Failed to update WhatsApp settings' });
  }
});

// Update notification toggles.
router.patch('/notifications', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { notify_attendance, notify_homework, notify_fees, notify_payroll } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, notify_attendance, notify_homework, notify_fees, notify_payroll)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id) DO UPDATE SET
         notify_attendance = COALESCE(EXCLUDED.notify_attendance, school_settings.notify_attendance),
         notify_homework = COALESCE(EXCLUDED.notify_homework, school_settings.notify_homework),
         notify_fees = COALESCE(EXCLUDED.notify_fees, school_settings.notify_fees),
         notify_payroll = COALESCE(EXCLUDED.notify_payroll, school_settings.notify_payroll),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, notify_attendance, notify_homework, notify_fees, notify_payroll]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Notification settings update error:', err);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// Update the accountant petty-cash approval limit — requests at/under this
// amount can be approved by an accountant; above it, they need the principal.
router.patch('/petty-cash-limit', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { limit } = req.body;
  if (limit === undefined || isNaN(limit) || limit < 0) {
    return res.status(400).json({ error: 'A valid non-negative limit is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, petty_cash_accountant_limit)
       VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET
         petty_cash_accountant_limit = EXCLUDED.petty_cash_accountant_limit,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, limit]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Petty cash limit update error:', err);
    res.status(500).json({ error: 'Failed to update petty cash limit' });
  }
});

export default router;
