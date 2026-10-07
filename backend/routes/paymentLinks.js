import express from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { send as sendNotification } from '../services/notificationService.js';
import { audit } from '../services/opsService.js';
import { verifyWebhookSignature } from '../utils/razorpay.js';
import { schoolRazorpayClient, schoolWebhookSecret, markSchoolWebhookSeen, schoolRazorpayStatus, razorpayFailure } from '../services/razorpayConnection.js';
import { recordBillingEvent, isPlanBillingEvent, processBillingEvent } from '../services/billingService.js';
import { billingQueue, connection as redisConnection } from '../config/queue.js';

const router = express.Router();

// ------------------------------------------------------------------
// Two Razorpay accounts are in play, and they never mix:
//
//   * the SCHOOL's own account (services/razorpayConnection.js) — every
//     fee payment link, fee reminder link and admission application-fee
//     link is created there, so the money settles to the school's bank.
//     That account posts its webhooks to /webhook/school/:schoolId.
//
//   * WAYNUR's platform account (.env keys) — only Waynur's own plan
//     billing. It posts to /webhook.
//
// A link remembers which account created it (razorpay_account) and can
// only be marked paid by a webhook from that same account.
// ------------------------------------------------------------------

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
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    const err = new Error('amount must be a positive number');
    err.statusCode = 400;
    throw err;
  }

  // The school's OWN Razorpay account — throws RAZORPAY_NOT_CONNECTED (409)
  // when the school has none. Never the platform account.
  const razorpay = await schoolRazorpayClient(schoolId);

  const referenceId = `waynur-${schoolId}-${studentId}-${Date.now()}`;

  let razorRes;
  try {
    razorRes = await razorpay.post('/payment_links', {
      amount: Math.round(rupees * 100), // paise
      currency: 'INR',
      reference_id: referenceId,
      description: `Fee payment for ${student.name}`,
      customer: { name: student.parent_name || 'Parent', contact: student.phone },
      notify: { sms: false, email: false }, // we send it via WhatsApp ourselves, not Razorpay's own channels
      callback_method: 'get',
    });
  } catch (rzErr) {
    const failure = razorpayFailure(rzErr);
    console.error(`[payment link] Razorpay call failed for school ${schoolId}:`, rzErr.response?.data || rzErr.message);
    const err = new Error(failure.message);
    err.statusCode = failure.status;
    throw err;
  }

  const link = razorRes.data;

  const result = await pool.query(
    `INSERT INTO fee_payment_links (school_id, student_id, amount, reference_id, razorpay_link_id, razorpay_link_url, created_by, razorpay_account)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'school') RETURNING *`,
    [schoolId, studentId, rupees, referenceId, link.id, link.short_url, createdByTeacherId || null]
  );

  return { link: result.rows[0], student };
}

// Whether this school can take online fee payments at all — lets the Fees
// screen say so up front instead of failing on the first click.
router.get('/status', requireAuth, requireFinance, async (req, res) => {
  try {
    res.json(await schoolRazorpayStatus(req.user.school_id));
  } catch (err) {
    console.error('Payment status error:', err);
    res.status(500).json({ error: 'Failed to load online payment status' });
  }
});

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
      school_id,
      student.phone,
      `Fee payment due for ${student.name}: ₹${amount}. Pay securely here: ${link.razorpay_link_url}`
    ).catch((err) => console.error('Payment link WhatsApp send failed (link was still created):', err.message));

    res.status(201).json(link);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Payment link creation error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment link. Please try again.' });
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

// ---------- settling a paid link ----------

const isAdmissionReference = (ref) => ref.startsWith('waynur-admission-') || ref.startsWith('wn-adm-');

// Does this webhook really describe THIS link? `scope` says which Razorpay
// account the (already signature-verified) webhook came from:
//   { account: 'platform' }                  Waynur's account
//   { account: 'school', schoolId: 12 }      school 12's own account
// A link is only settled by the account that created it, and — because a
// school's account is controlled by that school — only ever a link of that
// same school. The Razorpay link id and the amount paid are checked too, so
// a look-alike link made by hand with a copied reference_id settles nothing.
function linkMismatch(link, entity, scope) {
  if (link.razorpay_account !== scope.account) return `created in the ${link.razorpay_account} account, webhook came from the ${scope.account} account`;
  if (scope.account === 'school' && Number(link.school_id) !== Number(scope.schoolId)) return `belongs to school ${link.school_id}, webhook came from school ${scope.schoolId}`;
  if (entity?.id && link.razorpay_link_id && entity.id !== link.razorpay_link_id) return `Razorpay link id ${entity.id} is not the link we created (${link.razorpay_link_id})`;
  const paidPaise = Number(entity?.amount_paid);
  const duePaise = Math.round(Number(link.amount) * 100);
  if (Number.isFinite(paidPaise) && entity?.amount_paid !== undefined && entity?.amount_paid !== null && paidPaise < duePaise) {
    return `only ${paidPaise} of ${duePaise} paise paid`;
  }
  return null;
}

// Marks an admission application-fee link paid and moves the enquiry on to
// 'applied'. Idempotent: the row is locked and must still be 'CREATED', so
// a retried or simultaneous webhook delivery is a no-op the second time.
async function settleAdmissionLink(referenceId, entity, scope) {
  const client = await pool.connect();
  let link = null;
  try {
    await client.query('BEGIN');
    const linkRes = await client.query(`SELECT * FROM admission_payment_links WHERE reference_id = $1 AND status = 'CREATED' FOR UPDATE`, [referenceId]);
    if (linkRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return;
    }
    link = linkRes.rows[0];
    const mismatch = linkMismatch(link, entity, scope);
    if (mismatch) {
      await client.query('ROLLBACK');
      console.error(`[Razorpay webhook] admission link ${referenceId} not settled: ${mismatch}`);
      return;
    }
    await client.query(`UPDATE admission_payment_links SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = $1`, [link.id]);
    // Only advance the stage forward — an enquiry already further along
    // (visited, approved, admitted) shouldn't be pulled backward by a fee
    // that happens to clear late.
    await client.query(
      `UPDATE admission_enquiries SET stage = 'applied', updated_at = NOW()
       WHERE id = $1 AND stage IN ('new', 'qualifying', 'qualified', 'visit_booked', 'visited')`,
      [link.enquiry_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await audit({ schoolId: link.school_id, actorType: 'system', action: 'admission.fee_paid', entityType: 'admission_enquiry', entityId: link.enquiry_id, detail: { amount: link.amount, reference_id: referenceId } })
    .catch((auditErr) => console.error('admission.fee_paid audit failed:', auditErr.message));
}

// Records a student's fee payment against a paid link. Same idempotency
// guard: the link row is locked (FOR UPDATE) and must still be 'CREATED',
// so two deliveries of the same webhook arriving together cannot both add
// the payment.
async function settleFeeLink(referenceId, entity, scope) {
  const client = await pool.connect();
  let link = null;
  try {
    await client.query('BEGIN');

    const linkRes = await client.query(
      `SELECT * FROM fee_payment_links WHERE reference_id = $1 AND status = 'CREATED' FOR UPDATE`,
      [referenceId]
    );
    if (linkRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return; // already processed or unknown — not an error to Razorpay
    }
    link = linkRes.rows[0];
    const mismatch = linkMismatch(link, entity, scope);
    if (mismatch) {
      await client.query('ROLLBACK');
      console.error(`[Razorpay webhook] fee link ${referenceId} not settled: ${mismatch}`);
      return;
    }

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
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Fire-and-forget, after commit — a slow/failed WhatsApp send must never
  // make Razorpay retry the webhook.
  sendNotification({
    triggerEvent: 'fee_payment_confirmed',
    schoolId: link.school_id,
    recipients: [{ type: 'parent', studentId: link.student_id }],
    variables: { amount: link.amount },
  }).catch((notifyErr) => {
    console.error('fee_payment_confirmed notification failed:', notifyErr.message);
  });
}

// One verified `payment_link.paid` event -> the right table.
async function handleLinkPaid(body, scope) {
  const entity = body.payload?.payment_link?.entity;
  const referenceId = entity?.reference_id;
  if (!referenceId) return;
  if (isAdmissionReference(String(referenceId))) return settleAdmissionLink(referenceId, entity, scope);
  return settleFeeLink(referenceId, entity, scope);
}

// School PLAN billing (Waynur's own subscriptions/orders) — store the event
// once (idempotent on Razorpay's event id), ack 200 immediately, and let the
// BillingQueue worker apply it. If Redis is unreachable, process inline so a
// plan payment is never lost; the sweeper retries anything that fails.
async function handlePlanBillingWebhook(req, res) {
  const eventId = req.headers['x-razorpay-event-id']
    || `body-${crypto.createHash('sha256').update(req.rawBody).digest('hex')}`;
  const { id, duplicate } = await recordBillingEvent(eventId, req.body);
  res.sendStatus(200);
  if (duplicate || !id) return;
  try {
    // With Redis down, ioredis (maxRetriesPerRequest: null) makes queue.add()
    // hang forever instead of throwing — so never wait on it blindly.
    if (redisConnection.status !== 'ready') throw new Error(`redis ${redisConnection.status}`);
    await Promise.race([
      billingQueue.add('billingEvent', { billingEventId: id }, {
        jobId: `billing-${id}`, attempts: 5, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 1000,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('enqueue timeout')), 2000)),
    ]);
  } catch (err) {
    console.error('[billing] enqueue failed (Redis?) — processing inline:', err.message);
    processBillingEvent(id).catch((e) => console.error('[billing] inline processing failed, sweeper will retry:', e.message));
  }
}

// WAYNUR's own Razorpay account — plan billing. Verifies the signature
// against RAZORPAY_WEBHOOK_SECRET before trusting anything. It also still
// settles fee/admission links that were created in the platform account
// before schools had their own (razorpay_account = 'platform'); it can never
// settle a link created in a school's account.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not set — refusing to process webhook');
      return res.sendStatus(500);
    }
    if (!verifyWebhookSignature(req.rawBody, signature, secret)) {
      console.error('Razorpay webhook signature mismatch — possible spoofed request');
      return res.sendStatus(403);
    }

    if (isPlanBillingEvent(req.body)) {
      return await handlePlanBillingWebhook(req, res);
    }

    if (req.body.event === 'payment_link.paid') await handleLinkPaid(req.body, { account: 'platform' });
    res.sendStatus(200);
  } catch (err) {
    console.error('Razorpay webhook processing error:', err);
    if (!res.headersSent) res.sendStatus(500);
  }
});

// A SCHOOL's own Razorpay account. The school id is in the URL; the request
// is only trusted once its signature checks out against THAT school's
// webhook secret. Only payment links are handled here — plan billing never
// arrives from a school's account, and is ignored if it does.
router.post('/webhook/school/:schoolId', async (req, res) => {
  const schoolId = Number(req.params.schoolId);
  try {
    if (!Number.isInteger(schoolId) || schoolId <= 0) return res.sendStatus(404);
    const secret = await schoolWebhookSecret(schoolId);
    // No keys saved for this school: say so (Razorpay shows the failure on
    // its dashboard) rather than pretending the payment was recorded.
    if (!secret) return res.sendStatus(404);
    if (!verifyWebhookSignature(req.rawBody, req.headers['x-razorpay-signature'], secret)) {
      console.error(`Razorpay webhook signature mismatch for school ${schoolId} — wrong webhook secret, or a spoofed request`);
      return res.sendStatus(403);
    }
    await markSchoolWebhookSeen(schoolId);

    if (req.body.event === 'payment_link.paid') await handleLinkPaid(req.body, { account: 'school', schoolId });
    res.sendStatus(200);
  } catch (err) {
    console.error(`Razorpay webhook processing error (school ${schoolId}):`, err);
    if (!res.headersSent) res.sendStatus(500);
  }
});

export default router;
