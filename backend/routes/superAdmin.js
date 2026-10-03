import express from 'express';
import { loginLimiter } from '../middleware/rateLimit.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';
import { issueRefreshToken } from '../services/refreshTokenService.js';
import { connectSchoolWhatsApp, disconnectSchoolWhatsApp, getWhatsAppConnection, emailPrincipalWhatsAppConnected, ConnectionError } from '../services/whatsappConnection.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { emailConfigured } from '../services/emailService.js';

const router = express.Router();

// Public: Super Admin Login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM super_admins WHERE email = $1', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { super_admin_id: admin.id, role: 'super_admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    const refreshToken = await issueRefreshToken({ subjectType: 'super_admin', subjectId: admin.id, schoolId: null });

    res.json({ token, refreshToken, user: { id: admin.id, name: admin.name, email: admin.email, role: 'super_admin' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create School + First Principal (Transaction Pattern)
router.post('/schools', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, address, contact_phone, principal_name, principal_email, principal_phone, principal_password } = req.body;
  // Optional: connect the school's WhatsApp number in the same step.
  const { whatsapp_number, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id } = req.body;
  const wantsWhatsApp = Boolean(whatsapp_number || whatsapp_phone_number_id || whatsapp_access_token);

  if (!name || !principal_name || !principal_email || !principal_phone || !principal_password) {
    return res.status(400).json({ error: 'name, principal_name, principal_email, principal_phone, principal_password are required' });
  }
  const normalizedPrincipalPhone = normalizePhone(principal_phone);
  if (!normalizedPrincipalPhone) {
    return res.status(400).json({ error: 'principal_phone must be a valid Indian mobile number (10 digits, optionally with +91)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const schoolRes = await client.query(
      `INSERT INTO schools (name, address, contact_phone, status, plan_renews_at)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE + INTERVAL '30 days') RETURNING id`,
      [name, address, contact_phone]
    );
    const schoolId = schoolRes.rows[0].id;

    const passwordHash = await bcrypt.hash(principal_password, 10);

    // teachers.phone is NOT NULL — must be supplied, unlike the original draft.
    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'principal')`,
      [schoolId, principal_name, principal_email, normalizedPrincipalPhone, passwordHash]
    );

    await client.query('COMMIT');

    // The school exists either way — a wrong key must not undo its creation.
    // The result tells the Super Admin whether WhatsApp got connected and
    // whether the principal was emailed, so they can fix it from the list.
    let whatsapp = null;
    if (wantsWhatsApp) {
      try {
        const out = await connectSchoolWhatsApp({
          schoolId, whatsappNumber: whatsapp_number, phoneNumberId: whatsapp_phone_number_id,
          accessToken: whatsapp_access_token, wabaId: whatsapp_waba_id, superAdminId: req.user.super_admin_id,
        });
        whatsapp = { connected: true, email: out.email };
      } catch (waErr) {
        if (!(waErr instanceof ConnectionError)) console.error('WhatsApp connect during school creation failed:', waErr);
        whatsapp = { connected: false, error: waErr instanceof ConnectionError ? waErr.message : 'Could not connect WhatsApp — add the keys from the school list.' };
      }
    }
    res.status(201).json({ success: true, schoolId, whatsapp });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Admin: List all schools with metrics
router.get('/schools', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM students WHERE school_id = s.id AND is_demo = FALSE) AS student_count,
        (SELECT COUNT(*) FROM teachers WHERE school_id = s.id AND is_demo = FALSE) AS teacher_count,
        COALESCE((SELECT voice_tutor_enabled FROM school_settings WHERE school_id = s.id), FALSE) AS voice_tutor_enabled,
        COALESCE((SELECT whatsapp_connected FROM school_settings WHERE school_id = s.id), FALSE) AS whatsapp_connected,
        (SELECT whatsapp_business_number FROM school_settings WHERE school_id = s.id AND whatsapp_connected) AS whatsapp_number,
        (SELECT email FROM teachers WHERE school_id = s.id AND role = 'principal' AND COALESCE(is_demo, FALSE) = FALSE ORDER BY id LIMIT 1) AS principal_email
      FROM schools s
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Toggle School Status (Active/Suspended)
router.patch('/schools/:id/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'suspended', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, suspended, or pending' });
  }

  try {
    const result = await pool.query('UPDATE schools SET status = $1 WHERE id = $2 RETURNING id', [status, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'School not found' });
    }
    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QA fix (P-6): Super Admin had no way to remove a school at all — only
// Suspend/Activate. Deleting is irreversible and wipes every table scoped
// by school_id (all 65 of them cascade off schools.id — see schema.sql),
// so this requires the caller to echo the school's exact current name back
// as `confirm_name`, the same "type the name to confirm" pattern used for
// other irreversible actions elsewhere, rather than a single click.
router.delete('/schools/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { confirm_name } = req.body;
  try {
    const schoolRes = await pool.query('SELECT name FROM schools WHERE id = $1', [id]);
    if (schoolRes.rowCount === 0) {
      return res.status(404).json({ error: 'School not found' });
    }
    if (!confirm_name || confirm_name.trim() !== schoolRes.rows[0].name) {
      return res.status(400).json({ error: 'confirm_name must exactly match the school\'s current name' });
    }
    await pool.query('DELETE FROM schools WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Generate one-click test/demo users for a school (for showing a client demo)
router.post('/schools/:id/test-users', requireAuth, requireSuperAdmin, async (req, res) => {
  const schoolId = req.params.id;
  const client = await pool.connect();
  const randStr = Math.random().toString(36).substring(2, 6).toUpperCase();

  // Randomized per generation rather than the same fixed password every
  // time — these get returned in the response below so whoever's running
  // the demo still has them right in front of them, they're just no longer
  // guessable/reusable across every demo school ever created.
  const randomPassword = () => Math.random().toString(36).slice(-6) + Math.floor(10 + Math.random() * 89);
  const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

  const pEmail = `principal.${randStr}@demo.edu`;
  const pPass = randomPassword();
  const pPhone = `+91900000${Math.floor(1000 + Math.random() * 8999)}`;
  const tEmail = `teacher.${randStr}@demo.edu`;
  const tPass = randomPassword();
  const tPhone = `+91900001${Math.floor(1000 + Math.random() * 8999)}`;
  const sLoginId = `STD-${randStr}`;
  const sPin = randomPin();

  try {
    const schoolCheck = await client.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
    if (schoolCheck.rowCount === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    await client.query('BEGIN');

    // Reset, not accumulate: remove this school's previous demo-generated
    // rows before creating a fresh set, so repeated clicks don't leave
    // multiple Principal accounts and orphaned demo students behind.
    await client.query(`DELETE FROM students WHERE school_id = $1 AND is_demo = TRUE`, [schoolId]);
    await client.query(`DELETE FROM teachers WHERE school_id = $1 AND is_demo = TRUE`, [schoolId]);

    const pHash = await bcrypt.hash(pPass, 10);
    const tHash = await bcrypt.hash(tPass, 10);
    const sHash = await bcrypt.hash(sPin, 10);

    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role, is_demo) VALUES ($1, $2, $3, $4, $5, 'principal', TRUE)`,
      [schoolId, `Demo Principal ${randStr}`, pEmail, pPhone, pHash]
    );

    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role, is_demo) VALUES ($1, $2, $3, $4, $5, 'teacher', TRUE)`,
      [schoolId, `Demo Teacher ${randStr}`, tEmail, tPhone, tHash]
    );

    await client.query(
      `INSERT INTO students (school_id, name, login_id, pin_hash, grade, is_demo) VALUES ($1, $2, $3, $4, 'Class 8', TRUE)`,
      [schoolId, `Demo Student ${randStr}`, sLoginId, sHash]
    );

    await client.query('COMMIT');
    res.json({
      principal: { email: pEmail, password: pPass },
      teacher: { email: tEmail, password: tPass },
      student: { login_id: sLoginId, pin: sPin },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- Per-school WhatsApp Business connection ----------
// Only a Super Admin adds a school's WhatsApp number and keys (Phone Number
// ID + access token). The principal sees the status read-only and is emailed
// when the number goes live. The access token is write-only: it is stored
// encrypted and never returned by any of these routes.

function sendConnectionError(res, err, fallback) {
  if (err instanceof ConnectionError) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
}

router.get('/schools/:id/whatsapp', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    res.json({ ...(await getWhatsAppConnection(req.params.id)), email_configured: emailConfigured() });
  } catch (err) {
    sendConnectionError(res, err, 'Failed to load WhatsApp connection');
  }
});

// Add or replace the number + keys. Keys are checked with Meta first; on
// success the principal is emailed (pass notify:false to skip).
router.put('/schools/:id/whatsapp', requireAuth, requireSuperAdmin, async (req, res) => {
  const { whatsapp_number, phone_number_id, access_token, waba_id, notify } = req.body;
  try {
    const out = await connectSchoolWhatsApp({
      schoolId: req.params.id, whatsappNumber: whatsapp_number, phoneNumberId: phone_number_id,
      accessToken: access_token, wabaId: waba_id, superAdminId: req.user.super_admin_id, notify: notify !== false,
    });
    res.json({ success: true, ...out });
  } catch (err) {
    sendConnectionError(res, err, 'Failed to save WhatsApp connection');
  }
});

// Re-send the "WhatsApp connected" email (e.g. SMTP was down the first time,
// or the principal's email address was corrected afterwards).
router.post('/schools/:id/whatsapp/notify', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const email = await emailPrincipalWhatsAppConnected(req.params.id);
    res.json({ success: email.sent, email });
  } catch (err) {
    sendConnectionError(res, err, 'Failed to send the email');
  }
});

// Send Meta's always-approved hello_world template from the school's number
// to confirm the connection really delivers.  { "to": "+919876543210" }
router.post('/schools/:id/whatsapp/test', requireAuth, requireSuperAdmin, async (req, res) => {
  const to = normalizePhone(req.body.to);
  if (!to) return res.status(400).json({ error: 'to must be a valid mobile number' });
  try {
    const result = await sendTemplateMessage(req.params.id, to.replace(/^\+/, ''), 'hello_world', 'en_US', []);
    res.json({ success: true, wa_message_id: result?.messages?.[0]?.id || null });
  } catch (err) {
    res.status(err.code === 'WHATSAPP_NOT_CONNECTED' ? 409 : 502).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.delete('/schools/:id/whatsapp', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    res.json({ success: true, connection: await disconnectSchoolWhatsApp({ schoolId: req.params.id, superAdminId: req.user.super_admin_id }) });
  } catch (err) {
    sendConnectionError(res, err, 'Failed to disconnect WhatsApp');
  }
});

export default router;
