import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';

const router = express.Router();

// Pending WhatsApp cash-slip photos awaiting confirmation.
router.get('/pending', requireAuth, requireFinance, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.photo_base64, w.ai_extracted_amount, w.ai_extracted_student_hint,
              w.matched_student_id, s.name AS matched_student_name, w.received_at,
              fc.name AS collector_name
       FROM whatsapp_cash_intake w
       JOIN fee_collectors fc ON fc.id = w.fee_collector_id
       LEFT JOIN students s ON s.id = w.matched_student_id
       WHERE w.school_id = $1 AND w.status = 'PENDING'
       ORDER BY w.received_at DESC`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fee intake pending list error:', err);
    res.status(500).json({ error: 'Failed to load pending cash entries' });
  }
});

// Recently confirmed/rejected — for the "recently handled" section.
router.get('/recent', requireAuth, requireFinance, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.status, w.confirmed_amount, s.name AS student_name, w.confirmed_at
       FROM whatsapp_cash_intake w
       LEFT JOIN students s ON s.id = w.matched_student_id
       WHERE w.school_id = $1 AND w.status != 'PENDING'
       ORDER BY w.confirmed_at DESC LIMIT 20`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fee intake recent list error:', err);
    res.status(500).json({ error: 'Failed to load recent cash entries' });
  }
});

// Confirm a pending entry — this is the ONLY path that turns a WhatsApp
// photo into a real payment. Requires an explicit student_id and amount
// from the human reviewer (pre-filled from the AI read, but editable) —
// nothing here trusts the AI extraction on its own.
router.patch('/:id/confirm', requireAuth, requireFinance, async (req, res) => {
  const { id } = req.params;
  const { student_id, amount } = req.body;
  const school_id = req.user.school_id;

  if (!student_id || !amount) {
    return res.status(400).json({ error: 'student_id and amount are required to confirm' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const entryRes = await client.query(
      `SELECT * FROM whatsapp_cash_intake WHERE id = $1 AND school_id = $2 AND status = 'PENDING'`,
      [id, school_id]
    );
    if (entryRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending entry not found' });
    }
    const entry = entryRes.rows[0];

    // student_id comes from the reviewer's edit of the AI's guess — it must
    // still be re-verified against this school, otherwise a mistyped or
    // malicious id could record a payment against another school's student.
    const studentCheck = await client.query('SELECT id FROM students WHERE id = $1 AND school_id = $2', [student_id, school_id]);
    if (studentCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That student does not belong to this school' });
    }

    const paymentRes = await client.query(
      `INSERT INTO student_payment_history (school_id, student_id, amount_paid, payment_mode, remarks, proof_photo_url, collected_by)
       VALUES ($1, $2, $3, 'Cash (WhatsApp)', $4, $5, $6) RETURNING id`,
      [school_id, student_id, amount, `Confirmed from WhatsApp cash intake #${id}`, entry.photo_base64, req.user.teacher_id || null]
    );

    await client.query(
      `INSERT INTO student_payment (school_id, student_id, amount_paid, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id)
       DO UPDATE SET amount_paid = student_payment.amount_paid + EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
      [school_id, student_id, amount]
    );

    await client.query(
      `UPDATE whatsapp_cash_intake
       SET status = 'CONFIRMED', matched_student_id = $1, confirmed_amount = $2,
           confirmed_by = $3, confirmed_at = CURRENT_TIMESTAMP, payment_history_id = $4
       WHERE id = $5`,
      [student_id, amount, req.user.teacher_id || null, paymentRes.rows[0].id, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, paymentId: paymentRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fee intake confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm entry' });
  } finally {
    client.release();
  }
});

router.patch('/:id/reject', requireAuth, requireFinance, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE whatsapp_cash_intake
       SET status = 'REJECTED', confirmed_by = $1, confirmed_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND school_id = $3 AND status = 'PENDING' RETURNING id`,
      [req.user.teacher_id || null, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Pending entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Fee intake reject error:', err);
    res.status(500).json({ error: 'Failed to reject entry' });
  }
});

export default router;
