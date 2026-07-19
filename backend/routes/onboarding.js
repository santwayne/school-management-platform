import express from 'express';
import { onboardingLimiter } from '../middleware/rateLimit.js';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const router = express.Router();

// Public, unauthenticated — this is the self-serve "add your school" wizard.
// Deliberately does NOT activate the school immediately: status starts at
// 'pending' so a Super Admin has to approve it before the Principal can log
// in. Wayne E Solutions sells this directly rather than running it as pure
// self-serve SaaS, so an open door that instantly creates live accounts
// isn't the right default — this keeps the full wizard experience for the
// prospect while still requiring a human to say yes before it goes live.
router.post('/', onboardingLimiter, async (req, res) => {
  const { schoolName, city, address, logoDataUrl, attendance, classes, adminName, adminEmail, adminPassword } = req.body;

  if (!schoolName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'School name, admin name, email and password are required' });
  }
  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const schoolRes = await client.query(
      `INSERT INTO schools (name, address, status, plan) VALUES ($1, $2, 'pending', 'starter') RETURNING id`,
      [schoolName, address || city || null]
    );
    const schoolId = schoolRes.rows[0].id;

    await client.query(
      `INSERT INTO school_settings (school_id, logo_url) VALUES ($1, $2)`,
      [schoolId, logoDataUrl || null]
    );

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO teachers (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'principal')`,
      [schoolId, adminName, adminEmail, passwordHash]
    );

    if (Array.isArray(classes)) {
      for (const c of classes) {
        if (c?.name?.trim()) {
          await client.query('INSERT INTO classes (school_id, name) VALUES ($1, $2)', [schoolId, c.name.trim()]);
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      school_id: schoolId,
      status: 'pending',
      message: "School submitted for approval. You'll be able to log in once a Wayne E Solutions team member activates your account.",
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this admin email already exists' });
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Failed to submit school signup' });
  } finally {
    client.release();
  }
});

export default router;
