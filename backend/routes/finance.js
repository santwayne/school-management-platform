import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

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
router.get('/petty-cash', requireAuth, requirePrincipal, async (req, res) => {
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

// Only a principal can approve/reject petty cash — enforced server-side,
// not just hidden in the UI.
router.patch('/petty-cash/approve/:id', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { id } = req.params;
  const { status } = req.body; // 'APPROVED' | 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: "status must be 'APPROVED' or 'REJECTED'" });
  }

  try {
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
