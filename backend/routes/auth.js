import express from 'express';
import { loginLimiter } from '../middleware/rateLimit.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../services/refreshTokenService.js';

const router = express.Router();

// Login for teachers and principals (same table, distinguished by `role`)
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT t.id, t.school_id, t.name, t.email, t.role, t.password_hash, s.status AS school_status
       FROM teachers t JOIN schools s ON s.id = t.school_id
       WHERE t.email = $1`,
      [email]
    );
    const user = result.rows[0];

    // Same generic error whether the email doesn't exist or the password is
    // wrong, so login can't be used to enumerate registered emails.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.school_status === 'pending') {
      return res.status(403).json({ error: 'Your school signup is awaiting approval. You will be able to log in once a Wayne E Solutions team member activates your account.' });
    }
    if (user.school_status === 'suspended') {
      return res.status(403).json({ error: 'This school account is currently suspended. Contact Wayne E Solutions for help.' });
    }

    const token = jwt.sign(
      { teacher_id: user.id, school_id: user.school_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    const refreshToken = await issueRefreshToken({ subjectType: 'teacher', subjectId: user.id, schoolId: user.school_id });

    res.json({
      success: true,
      token,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, school_id: user.school_id },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Student portal login — no email, just a short login_id (e.g. roll number)
// plus a PIN, since students of any age need to be able to log in easily.
// loginLimiter applies here too (previously missing) — a short numeric PIN
// is even lower-entropy than a real password, and login_ids based on roll
// numbers are often sequential/guessable, so this endpoint needed the same
// brute-force protection as /login, not less.
router.post('/student-login', loginLimiter, async (req, res) => {
  const { login_id, pin } = req.body;
  if (!login_id || !pin) {
    return res.status(400).json({ error: 'login_id and pin are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, school_id, name, grade, login_id, pin_hash FROM students WHERE login_id = $1',
      [login_id]
    );
    const student = result.rows[0];

    // Same generic error for unknown login_id vs wrong PIN, so login can't
    // be used to enumerate valid student IDs.
    if (!student || !student.pin_hash || !(await bcrypt.compare(String(pin), student.pin_hash))) {
      return res.status(401).json({ error: 'Invalid login ID or PIN' });
    }

    const token = jwt.sign(
      { student_id: student.id, school_id: student.school_id, role: 'student' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    const refreshToken = await issueRefreshToken({ subjectType: 'student', subjectId: student.id, schoolId: student.school_id });

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: student.id,
        name: student.name,
        grade: student.grade,
        role: 'student',
        school_id: student.school_id,
      },
    });
  } catch (err) {
    console.error('Student login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Exchanges a still-valid refresh token for a new 12h access token, without
// requiring the password again. Rebuilds the JWT payload from a fresh DB
// read (not from anything cached in the refresh token itself) so a role
// change or account deletion since the last login takes effect immediately
// on the next refresh, exactly as it already does on the next full login.
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    let payload;
    if (rotated.subjectType === 'teacher') {
      const { rows } = await pool.query('SELECT id, school_id, role FROM teachers WHERE id = $1', [rotated.subjectId]);
      if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
      payload = { teacher_id: rows[0].id, school_id: rows[0].school_id, role: rows[0].role };
    } else if (rotated.subjectType === 'student') {
      const { rows } = await pool.query('SELECT id, school_id FROM students WHERE id = $1', [rotated.subjectId]);
      if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
      payload = { student_id: rows[0].id, school_id: rows[0].school_id, role: 'student' };
    } else if (rotated.subjectType === 'super_admin') {
      const { rows } = await pool.query('SELECT id FROM super_admins WHERE id = $1', [rotated.subjectId]);
      if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
      payload = { super_admin_id: rows[0].id, role: 'super_admin' };
    } else {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ success: true, token, refreshToken: rotated.refreshToken });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Could not refresh session' });
  }
});

// Revokes a refresh token on explicit logout, so a copy left in a stolen
// device/browser can't silently keep renewing access forever. Always
// succeeds (even with no/invalid token) — logging out should never itself
// error, and there's nothing more to reveal by distinguishing the cases.
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken).catch((err) => console.error('Logout revoke error:', err.message));
  }
  res.json({ success: true });
});

export default router;
