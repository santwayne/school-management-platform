import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

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
    const schoolRes = await pool.query('SELECT name FROM schools WHERE id = $1', [school_id]);
    res.json({ ...result.rows[0], school_name: schoolRes.rows[0]?.name || null });
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

// Step 1: send a 6-digit code to the number via our own WhatsApp Business
// API. Nothing is marked "connected" yet — that only happens once the code
// comes back correctly in /whatsapp/verify below. Previously this route set
// whatsapp_connected = TRUE the instant someone typed a number in, with no
// actual proof the number could receive anything.
router.patch('/whatsapp', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { whatsapp_business_number } = req.body;
  if (!whatsapp_business_number) {
    return res.status(400).json({ error: 'whatsapp_business_number is required' });
  }
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    await sendTextMessage(whatsapp_business_number, `Your Waynur WhatsApp verification code is ${code}. It expires in 10 minutes.`);
  } catch (err) {
    console.error('WhatsApp verification send failed:', err.message);
    return res.status(502).json({ error: 'Could not send a verification message to that number. Check the number and try again.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, whatsapp_pending_number, whatsapp_verify_code, whatsapp_verify_expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id) DO UPDATE SET
         whatsapp_pending_number = EXCLUDED.whatsapp_pending_number,
         whatsapp_verify_code = EXCLUDED.whatsapp_verify_code,
         whatsapp_verify_expires_at = EXCLUDED.whatsapp_verify_expires_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING school_id, whatsapp_pending_number`,
      [school_id, whatsapp_business_number, code, expiresAt]
    );
    res.json({ success: true, pending_number: result.rows[0].whatsapp_pending_number, message: 'Verification code sent via WhatsApp.' });
  } catch (err) {
    console.error('WhatsApp settings update error:', err);
    res.status(500).json({ error: 'Failed to save pending verification' });
  }
});

// Step 2: confirm the code — only this flips whatsapp_connected to TRUE.
router.post('/whatsapp/verify', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });

  try {
    const { rows } = await pool.query('SELECT * FROM school_settings WHERE school_id = $1', [school_id]);
    const settings = rows[0];
    if (!settings?.whatsapp_verify_code || !settings?.whatsapp_pending_number) {
      return res.status(400).json({ error: 'No verification in progress — request a new code first.' });
    }
    if (new Date(settings.whatsapp_verify_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired — request a new one.' });
    }
    if (String(code).trim() !== settings.whatsapp_verify_code) {
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    const result = await pool.query(
      `UPDATE school_settings SET
         whatsapp_business_number = whatsapp_pending_number,
         whatsapp_connected = TRUE,
         whatsapp_pending_number = NULL,
         whatsapp_verify_code = NULL,
         whatsapp_verify_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE school_id = $1 RETURNING *`,
      [school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('WhatsApp verify error:', err);
    res.status(500).json({ error: 'Failed to verify WhatsApp number' });
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

// Upload school logo to S3, save URL to DB, return updated settings.
router.post('/logo', requireAuth, requirePrincipal, (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File must be under 2 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const key = `logos/${req.user.school_id}/${Date.now()}${ext}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const logo_url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    const result = await pool.query(
      `INSERT INTO school_settings (school_id, logo_url) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.user.school_id, logo_url]
    );

    res.json({ logo_url, settings: result.rows[0] });
  } catch (err) {
    console.error('S3 logo upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and bucket policy' });
  }
});

export default router;
