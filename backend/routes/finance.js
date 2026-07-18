import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal, requireFinance } from '../middleware/auth.js';

const router = express.Router();

// Record a fee payment (parameterized queries, wrapped in a transaction).
router.post('/fee/collect', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { student_id, amount_paid, payment_mode, remarks, proof_photo } = req.body;

  if (!student_id || !amount_paid || !payment_mode) {
    return res.status(400).json({ error: 'student_id, amount_paid and payment_mode are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // proof_photo is optional — small base64 images only for now (this is
    // stored directly in the DB; move to S3 if this needs to scale up).
    const paymentRes = await client.query(
      `INSERT INTO student_payment_history (school_id, student_id, amount_paid, payment_mode, remarks, proof_photo_url, collected_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [school_id, student_id, amount_paid, payment_mode, remarks || null, proof_photo || null, req.user.teacher_id || null]
    );

    await client.query(
      `INSERT INTO student_payment (school_id, student_id, amount_paid, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id)
       DO UPDATE SET amount_paid = student_payment.amount_paid + EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
      [school_id, student_id, amount_paid]
    );

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Fee recorded successfully.', paymentId: paymentRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fee collect error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

// GET /api/finance/petty-cash — list requests for this school (most recent first)
router.get('/petty-cash', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM petty_cash WHERE school_id = $1 ORDER BY created_at DESC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Petty cash list error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// GET /api/finance/students/search?q= — lets Accountant/Principal resolve a
// student to their internal numeric id by typing a name or the student's
// visible login ID (e.g. STD-2-KKSY). Accountants can't call
// GET /api/academics/students (principal-only), which was the underlying
// cause of the "student_id always null" fee-collection bug: with no way to
// look up the id, staff typed the login_id string into a numeric-id field,
// parseInt() on it returned NaN, and JSON serialized that as null.
router.get('/students/search', requireAuth, requireFinance, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.login_id, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $1 AND (s.name ILIKE $2 OR s.login_id ILIKE $2)
       ORDER BY s.name LIMIT 10`,
      [req.user.school_id, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('Student search error:', err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// GET /api/finance/fee/history — recent fee payments for this school, for
// the Accountant / Principal fee collection screen.
router.get('/fee/history', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.student_id, s.name AS student_name, h.amount_paid, h.payment_mode,
              h.remarks, h.created_at
       FROM student_payment_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.school_id = $1
       ORDER BY h.created_at DESC
       LIMIT 50`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Fee history error:', err);
    res.status(500).json({ error: 'Failed to load fee history' });
  }
});

router.post('/petty-cash/request', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { requested_by, amount, purpose } = req.body;

  if (!requested_by || !amount) {
    return res.status(400).json({ error: 'requested_by and amount are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO petty_cash (school_id, requested_by, amount, purpose, status)
       VALUES ($1, $2, $3, $4, 'PENDING') RETURNING id`,
      [school_id, requested_by, amount, purpose || null]
    );
    res.status(200).json({ success: true, message: 'Expense request raised.', requestId: result.rows[0].id });
  } catch (err) {
    console.error('Petty cash request error:', err);
    res.status(500).json({ error: 'Failed to raise request' });
  }
});

// Principal or Accountant can approve/reject petty cash, enforced
// server-side. An accountant can only approve requests at or under the
// school's configured limit (school_settings.petty_cash_accountant_limit,
// default ₹5,000) — anything above that must go to the principal.
router.patch('/petty-cash/approve/:id', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { id } = req.params;
  const { status } = req.body; // 'APPROVED' | 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: "status must be 'APPROVED' or 'REJECTED'" });
  }

  try {
    if (req.user.role === 'accountant' && status === 'APPROVED') {
      const requestRes = await pool.query(
        'SELECT amount FROM petty_cash WHERE id = $1 AND school_id = $2',
        [id, school_id]
      );
      if (requestRes.rowCount === 0) {
        return res.status(404).json({ error: 'Request not found for this school' });
      }
      const settingsRes = await pool.query(
        'SELECT petty_cash_accountant_limit FROM school_settings WHERE school_id = $1',
        [school_id]
      );
      const limit = settingsRes.rowCount > 0 ? parseFloat(settingsRes.rows[0].petty_cash_accountant_limit) : 5000;
      if (parseFloat(requestRes.rows[0].amount) > limit) {
        return res.status(403).json({
          error: `This request is above your approval limit (Rs ${limit}). It needs Principal approval.`,
        });
      }
    }

    const result = await pool.query(
      `UPDATE petty_cash
       SET status = $1, approved_by = $2, actioned_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND school_id = $4
       RETURNING id`,
      [status, req.user.teacher_id, id, school_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found for this school' });
    }

    await pool.query(
      `INSERT INTO petty_cash_history (petty_cash_id, action, actioned_by) VALUES ($1, $2, $3)`,
      [id, status, req.user.teacher_id]
    );

    res.status(200).json({ success: true, message: `Request status updated to ${status}` });
  } catch (err) {
    console.error('Petty cash approval error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

export default router;
