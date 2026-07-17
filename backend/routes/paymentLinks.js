import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = express.Router();

// NOTE: this calls the real Razorpay REST API (no SDK needed, plain axios —
// same pattern as whatsappService.js). It requires RAZORPAY_KEY_ID and
// RAZORPAY_KEY_SECRET to be set in the environment. Without real Razorpay
// credentials this will fail at request time with a clear auth error rather
// than silently pretending to succeed — nothing here is mocked.
function razorpayClient() {
  return axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: {
      username: process.env.RAZORPAY_KEY_ID,
      password: process.env.RAZORPAY_KEY_SECRET,
    },
    timeout: 10000,
  });
}

// Create a payment link for one student's fee, and WhatsApp it to the parent.
// The reference_id is what makes reconciliation automatic — Razorpay echoes
// it back on the webhook, so we always know exactly which student paid even
// if ten parents pay the same amount on the same day.
router.post('/', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { student_id, amount } = req.body;
  if (!student_id || !amount) {
    return res.status(400).json({ error: 'student_id and amount are required' });
  }

  try {
    const studentRes = await pool.query(
      `SELECT s.name, p.phone, p.name AS parent_name
       FROM students s LEFT JOIN parents p ON p.id = s.parent_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [student_id, school_id]
    );
    if (studentRes.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    const student = studentRes.rows[0];
    if (!student.phone) return res.status(400).json({ error: 'This student has no parent phone number on file' });

    const referenceId = `waynur-${school_id}-${student_id}-${Date.now()}`;

    const razorRes = await razorpayClient().post('/payment_links', {
      amount: Math.round(Number(amount) * 100), // paise
      currency: 'INR',
      reference_id: referenceId,
      description: `Fee payment for ${student.name}`,
      customer: { name: student.parent_name || 'Parent', contact: student.phone },
      notify: { sms: false, email: false }, // we send it via WhatsApp ourselves, not Razorpay's own channels
      callback_method: 'get',
    });

    const link = razorRes.data;

    const result = await pool.query(
      `INSERT INTO fee_payment_links (school_id, student_id, amount, reference_id, razorpay_link_id, razorpay_link_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [school_id, student_id, amount, referenceId, link.id, link.short_url, req.user.teacher_id || null]
    );

    await sendTextMessage(
      student.phone,
      `Fee payment due for ${student.name}: ₹${amount}. Pay securely here: ${link.short_url}`
    ).catch((err) => console.error('Payment link WhatsApp send failed (link was still created):', err.message));

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Payment link creation error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment link — check RAZORPAY_KEY_ID/SECRET are set correctly' });
  }
});

router.get('/', requireAuth, requireFinance, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, s.name AS student_name, p.name AS parent_name
       FROM fee_payment_links l
       JOIN students s ON s.id = l.student_id
       LEFT JOIN parents p ON p.id = s.parent_id
       WHERE l.school_id = $1
       ORDER BY l.created_at DESC LIMIT 50`,
      [req.user.school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Payment links list error:', err);
    res.status(500).json({ error: 'Failed to load payment links' });
  }
});

// Razorpay webhook — fires on payment.captured. Verifies the signature
// against RAZORPAY_WEBHOOK_SECRET before trusting anything in the payload.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not set — refusing to process webhook');
      return res.sendStatus(500);
    }
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (expected !== signature) {
      console.error('Razorpay webhook signature mismatch — possible spoofed request');
      return res.sendStatus(403);
    }

    const event = req.body.event;
    if (event !== 'payment_link.paid' && event !== 'payment.captured') return res.sendStatus(200);

    const referenceId = req.body.payload?.payment_link?.entity?.reference_id;
    if (!referenceId) return res.sendStatus(200);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const linkRes = await client.query(
        `SELECT * FROM fee_payment_links WHERE reference_id = $1 AND status = 'CREATED'`,
        [referenceId]
      );
      if (linkRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.sendStatus(200); // already processed or unknown — not an error to Razorpay
      }
      const link = linkRes.rows[0];

      const paymentRes = await client.query(
        `INSERT INTO student_payment_history (school_id, student_id, amount_paid, payment_mode, remarks)
         VALUES ($1, $2, $3, 'UPI / Online', $4) RETURNING id`,
        [link.school_id, link.student_id, link.amount, `Online payment via link ${referenceId}`]
      );

      await client.query(
        `INSERT INTO student_payment (school_id, student_id, amount_paid, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (student_id)
         DO UPDATE SET amount_paid = student_payment.amount_paid + EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
        [link.school_id, link.student_id, link.amount]
      );

      await client.query(
        `UPDATE fee_payment_links SET status = 'PAID', payment_history_id = $1, paid_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [paymentRes.rows[0].id, link.id]
      );

      await client.query('COMMIT');
      res.sendStatus(200);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Razorpay webhook processing error:', err);
    res.sendStatus(500);
  }
});

export default router;
