import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Surfaces sustained (3+ week) performance drift for human review — never
// an automatic verdict. Scoped to the caller's own school via the token.
router.get('/drift-alerts', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const alerts = await pool.query(
      `SELECT ps.*, c.name AS class_name, t.name AS teacher_name
       FROM performance_snapshots ps
       JOIN classes c ON ps.class_id = c.id
       LEFT JOIN teachers t ON ps.teacher_id = t.id
       WHERE ps.school_id = $1 AND ps.flagged = TRUE
       ORDER BY ps.period DESC`,
      [school_id]
    );

    res.json({
      success: true,
      framing: 'These patterns are surfaced for human review, not as automatic verdicts.',
      data: alerts.rows,
    });
  } catch (err) {
    console.error('Drift alerts error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
