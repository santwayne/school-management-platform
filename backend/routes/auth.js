import express from 'express';
import { loginLimiter } from '../middleware/rateLimit.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

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

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, school_id: user.school_id },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Student portal login — no email, just a short login_id (e.g. roll number)
// plus a PIN, since students of any age need to be able to log in easily.
router.post('/student-login', async (req, res) => {
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

    res.json({
      success: true,
      token,
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

export default router;
