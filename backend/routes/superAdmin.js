import express from 'express';
import { loginLimiter } from '../middleware/rateLimit.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

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

    res.json({ token, user: { id: admin.id, name: admin.name, email: admin.email, role: 'super_admin' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create School + First Principal (Transaction Pattern)
router.post('/schools', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, address, contact_phone, principal_name, principal_email, principal_phone, principal_password } = req.body;

  if (!name || !principal_name || !principal_email || !principal_phone || !principal_password) {
    return res.status(400).json({ error: 'name, principal_name, principal_email, principal_phone, principal_password are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const schoolRes = await client.query(
      `INSERT INTO schools (name, address, contact_phone, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [name, address, contact_phone]
    );
    const schoolId = schoolRes.rows[0].id;

    const passwordHash = await bcrypt.hash(principal_password, 10);

    // teachers.phone is NOT NULL — must be supplied, unlike the original draft.
    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'principal')`,
      [schoolId, principal_name, principal_email, principal_phone, passwordHash]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, schoolId });
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
        (SELECT COUNT(*) FROM students WHERE school_id = s.id) AS student_count,
        (SELECT COUNT(*) FROM teachers WHERE school_id = s.id) AS teacher_count,
        COALESCE((SELECT voice_tutor_enabled FROM school_settings WHERE school_id = s.id), FALSE) AS voice_tutor_enabled
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

    const pHash = await bcrypt.hash(pPass, 10);
    const tHash = await bcrypt.hash(tPass, 10);
    const sHash = await bcrypt.hash(sPin, 10);

    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5, 'principal')`,
      [schoolId, `Demo Principal ${randStr}`, pEmail, pPhone, pHash]
    );

    await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5, 'teacher')`,
      [schoolId, `Demo Teacher ${randStr}`, tEmail, tPhone, tHash]
    );

    await client.query(
      `INSERT INTO students (school_id, name, login_id, pin_hash, grade) VALUES ($1, $2, $3, $4, 'Class 8')`,
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

export default router;
