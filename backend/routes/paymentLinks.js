import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { send as sendNotification } from '../services/notificationService.js';
import { audit } from '../services/opsService.js';

const router = express.Router();

// NOTE: this calls the real Razorpay REST API (no SDK needed, plain axios —
// same pattern as whatsappService.js). It requires RAZORPAY_KEY_ID and
// RAZORPAY_KEY_SECRET to be set in the environment. Without real Razorpay
// credentials this will fail at request time with a clear auth error rather
// than silently pretending to succeed — nothing here is mocked.
export function razorpayClient() {
  return axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: {
      username: process.env.RAZORPAY_KEY_ID,
      password: process.env.RAZORPAY_KEY_SECRET,
    },
    timeout: 10000,
  });
}

// Core "create a Razorpay payment link for one student's fee" logic — pulled
// out of the POST / route below so the automatic fee-reminder worker
// (workers/feeReminderWorker.js) can reuse the exact same link-creation path
// instead of duplicating it. Does NOT send anything itself — sending is the
// caller's job, since the manual route (free-form sendTextMessage, only
// valid inside an open 24h WhatsApp window) and the worker (sendTemplateMessage
// via notificationService, since a worker can't assume that window is open)
// need different send mechanics. Throws on any failure; errors carry a
// `.statusCode` so the route can map them to the right HTTP response.
export async function createPaymentLinkRecord(schoolId, studentId, amount, createdByTeacherId) {
  const studentRes = await pool.query(
    `SELECT s.name, p.phone, p.name AS parent_name
     FROM students s LEFT JOIN parents p ON p.id = s.parent_id
     WHERE s.id = $1 AND s.school_id = $2`,
    [studentId, schoolId]
  );
  if (studentRes.rowCount === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }
  const student = studentRes.rows[0];
  if (!student.phone) {
    const err = new Error('This student has no parent phone number on file');
    err.statusCode = 400;
    throw err;
  }

  const referenceId = `waynur-${schoolId}-${studentId}-${Date.now()}`;

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
    [schoolId, studentId, amount, referenceId, link.id, link.short_url, createdByTeacherId || null]
  );

  return { link: result.rows[0], student };
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
    const { link, student } = await createPaymentLinkRecord(school_id, student_id, amount, req.user.teacher_id);

    await sendTextMessage(
      student.phone,
      `Fee payment due for ${student.name}: ₹${amount}. Pay securely here: ${link.razorpay_link_url}`
    ).catch((err) => console.error('Payment link WhatsApp send failed (link was still created):', err.message));

    res.status(201).json(link);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
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

// Marks an admission application-fee link paid and moves the enquiry on to
// 'applied' — same idempotency guard as the student-fee path (status =
// 'CREATED' in the WHERE clause means a retried webhook delivery is a no-op
// the second time, not a double-processed payment).
async function handleAdmissionPaymentWebhook(referenceId, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const linkRes = await client.query(`SELECT * FROM admission_payment_links WHERE reference_id = $1 AND status = 'CREATED'`, [referenceId]);
    if (linkRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.sendStatus(200);
    }
    const link = linkRes.rows[0];
    await client.query(`UPDATE admission_payment_links SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = $1`, [link.id]);
    // Only advance the stage forward — an enquiry already further along
    // (visited, approved, admitted) shouldn't be pulled backward by a fee
    // that happens to clear late.
    const advanced = await client.query(
      `UPDATE admission_enquiries SET stage = 'applied', updated_at = NOW()
       WHERE id = $1 AND stage IN ('new', 'qualifying', 'qualified', 'visit_booked', 'visited') RETURNING id`,
      [link.enquiry_id]
    );
    await client.query('COMMIT');
    res.sendStatus(200);

    await audit({ schoolId: link.school_id, actorType: 'system', action: 'admission.fee_paid', entityType: 'admission_enquiry', entityId: link.enquiry_id, detail: { amount: link.amount, reference_id: referenceId, stage_advanced: advanced.rowCount > 0 } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admission payment webhook error:', err);
    res.sendStatus(500);
  } finally {
    client.release();
  }
}

// School plan subscriptions (routes/billing.js). billing_status is
// informational only, by product decision — a failed/halted renewal is
// surfaced for Super Admin review, NOT used to auto-restrict access.
async function handleSubscriptionWebhook(event, payload, res) {
  const subscription = payload?.subscription?.entity;
  if (!subscription?.id) return res.sendStatus(200);

  try {
    let billingStatus;
    let renewsAt = null;
    if (event === 'subscription.activated' || event === 'subscription.charged') {
      billingStatus = 'active';
      // current_end is Unix seconds (UTC) — Razorpay's own subscription
      // clock, independent of the school's IST academic-year clock used
      // elsewhere (utils/academicYear.js); nothing to reconcile between the
      // two, they answer different questions (renewal date vs. fee period).
      if (subscription.current_end) renewsAt = new Date(subscription.current_end * 1000);
    } else if (event === 'subscription.pending' || event === 'subscription.halted') {
      billingStatus = 'past_due';
    } else if (event === 'subscription.cancelled' || event === 'subscription.completed') {
      billingStatus = 'cancelled';
    } else {
      return res.sendStatus(200); // other lifecycle events (e.g. subscription.updated) — nothing to do
    }

    // The plan itself only actually takes effect here, on activation/first
    // charge — POST /subscribe (routes/billing.js) deliberately never
    // touches schools.plan itself, since the mandate isn't authorized (or
    // charged) until the principal completes Razorpay's hosted page.
    // subscription.notes.plan is the same value this app set at creation
    // time (POST /subscriptions), read back rather than trusted from
    // anywhere else in this payload.
    const plan = subscription.notes?.plan;
    await pool.query(
      `UPDATE schools SET
         billing_status = $1,
         plan_renews_at = COALESCE($2, plan_renews_at),
         plan = CASE WHEN $3::text IS NOT NULL AND $1 = 'active' THEN $3 ELSE plan END
       WHERE razorpay_subscription_id = $4`,
      [billingStatus, renewsAt, plan || null, subscription.id]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Subscription webhook processing error:', err);
    res.sendStatus(500);
  }
}

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

    // School plan subscriptions (routes/billing.js POST /subscribe) — a
    // separate Razorpay product (Subscriptions, not Payment Links) landing
    // on this same webhook URL, since a merchant configures one webhook URL
    // account-wide covering every event type, not one per feature.
    if (event.startsWith('subscription.')) {
      return handleSubscriptionWebhook(event, req.body.payload, res);
    }

    if (event !== 'payment_link.paid' && event !== 'payment.captured') return res.sendStatus(200);

    const referenceId = req.body.payload?.payment_link?.entity?.reference_id;
    if (!referenceId) return res.sendStatus(200);

    // Admission application-fee links use their own table (there's no
    // student_id yet at that stage) but the same Razorpay account/webhook —
    // route on the reference_id prefix rather than running two webhooks.
    if (referenceId.startsWith('waynur-admission-')) {
      return handleAdmissionPaymentWebhook(referenceId, res);
    }

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

      // Fire-and-forget, after commit — Razorpay just wants a 200 quickly,
      // and a slow/failed WhatsApp send must never risk the webhook retrying
      // and double-processing the payment.
      sendNotification({
        triggerEvent: 'fee_payment_confirmed',
        schoolId: link.school_id,
        recipients: [{ type: 'parent', studentId: link.student_id }],
        variables: { amount: link.amount },
      }).catch((notifyErr) => {
        console.error('fee_payment_confirmed notification failed:', notifyErr.message);
      });
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
