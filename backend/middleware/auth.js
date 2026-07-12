import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

// Verifies the JWT and attaches { teacher_id, school_id, role } to req.user.
// Every route that touches school data should sit behind this — it is what
// makes school_id trustworthy instead of taking it from the request body.
//
// Also blocks access if the token's school has been suspended by a super
// admin (super-admin tokens carry no school_id, so they skip this check).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload; // { teacher_id / student_id / super_admin_id, school_id, role }

  try {
    if (req.user.school_id) {
      const schoolRes = await pool.query('SELECT status FROM schools WHERE id = $1', [req.user.school_id]);
      if (schoolRes.rowCount === 0 || schoolRes.rows[0].status === 'suspended') {
        return res.status(403).json({ error: 'This school is currently suspended.' });
      }
    }
    next();
  } catch (err) {
    console.error('requireAuth school-status check failed:', err.message);
    return res.status(500).json({ error: 'Internal server error while verifying access' });
  }
}

// Restricts a route to principals only (e.g. petty-cash approval, analytics).
export function requirePrincipal(req, res, next) {
  if (!req.user || req.user.role !== 'principal') {
    return res.status(403).json({ error: 'Principal role required' });
  }
  next();
}

// Restricts a route to the student portal (e.g. AI tutor chat) — keeps
// student tokens out of teacher/principal-only endpoints and vice versa.
export function requireStudent(req, res, next) {
  if (!req.user || req.user.role !== 'student') {
    return res.status(403).json({ error: 'Student login required' });
  }
  next();
}

// Restricts a route to the super admin (multi-school management) panel.
export function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin role required' });
  }
  next();
}
