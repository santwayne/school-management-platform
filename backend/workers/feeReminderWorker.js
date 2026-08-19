import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { createPaymentLinkRecord } from '../routes/paymentLinks.js';
import { send as sendNotification } from '../services/notificationService.js';

// ------------------------------------------------------------------------
// Automated parent-notification audit (see the fix/automated-parent-
// notifications branch) — this worker is the build-out of the one clear
// "should become automatic" finding: the "Send payment link" flow
// (routes/paymentLinks.js, FeeCollectionHub.jsx) required an accountant to
// open the page and click Send once PER unpaid student. Fine for a dozen
// students; doesn't scale to a school with thousands across many classes.
// This worker finds every student with a real outstanding balance and
// reminds their parent automatically, once a day, spaced out so the same
// family isn't messaged every single day forever.
// ------------------------------------------------------------------------

// Small batching so a large school doesn't fire hundreds/thousands of
// WhatsApp API calls back-to-back in one worker tick. NOTE: config/queue.js
// (BullMQ) is used here only for *scheduling* this job daily, the same way
// every other worker in this codebase uses it — it does not currently wrap
// individual outbound WhatsApp sends in any per-message rate limiter. This
// chunk-with-delay loop is a basic stand-in; a stronger version would push
// each reminder as its own BullMQ job with a real rate limiter
// (BullMQ Workers support a `limiter` option) instead of sending in a loop
// inside one job. Worth strengthening if reminder volume grows.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = new Worker(
  'FeeReminderQueue',
  async (job) => {
    if (job.name === 'dailyFeeReminders') {
      return handleDailyReminders();
    }
    console.warn(`Unknown job name on FeeReminderQueue: ${job.name}`);
  },
  { connection }
);

async function handleDailyReminders() {
  // Outstanding balance = fee_structures.amount for the student's class
  // minus whatever student_payment.amount_paid already shows (see the
  // fee_structures table added by the QA fix list's Item 5 — this worker
  // depends on that table existing and populated; before Item 5 nothing
  // ever set an expected-fee source, so there'd be nothing to compare
  // against and this query would simply match no one).
  //
  // fee_reminder_grace_days / fee_reminder_interval_days / notify_fees are
  // read per-school (COALESCE'd to sensible defaults for a school that's
  // never visited Settings, so a missing school_settings row doesn't just
  // silently exclude a school from reminders). notify_fees existed in
  // school_settings already (the Notifications toggle in AdminSettings.jsx)
  // but nothing actually read it before this — wiring it in here gives that
  // checkbox real effect for the first time.
  const candidates = await pool.query(
    `SELECT s.id AS student_id, s.name AS student_name, s.school_id,
            (fs.amount - COALESCE(sp.amount_paid, 0)) AS outstanding
     FROM students s
     JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
     LEFT JOIN student_payment sp ON sp.student_id = s.id AND sp.school_id = s.school_id
     LEFT JOIN school_settings ss ON ss.school_id = s.school_id
     WHERE (fs.amount - COALESCE(sp.amount_paid, 0)) > 0
       AND COALESCE(ss.notify_fees, TRUE) = TRUE
       AND s.created_at <= CURRENT_DATE - (COALESCE(ss.fee_reminder_grace_days, 7) || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM fee_reminder_log frl
         WHERE frl.student_id = s.id
           AND frl.sent_at > CURRENT_DATE - (COALESCE(ss.fee_reminder_interval_days, 7) || ' days')::interval
       )
     ORDER BY s.school_id, s.id`
  );

  console.log(`[feeReminderWorker] ${candidates.rowCount} student(s) due a fee reminder today.`);

  let sent = 0;
  let failed = 0;
  const rows = candidates.rows;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      try {
        const { link } = await createPaymentLinkRecord(row.school_id, row.student_id, row.outstanding, null);

        // sendTemplateMessage (via notificationService), not the manual
        // route's free-form sendTextMessage — a worker can't assume it's
        // inside an open 24h WhatsApp conversation window with this parent.
        await sendNotification({
          triggerEvent: 'fee_payment_reminder',
          schoolId: row.school_id,
          recipients: [{ type: 'parent', studentId: row.student_id }],
          variables: { amount: row.outstanding, link_url: link.razorpay_link_url },
        });

        await pool.query(
          `INSERT INTO fee_reminder_log (school_id, student_id, payment_link_id) VALUES ($1, $2, $3)`,
          [row.school_id, row.student_id, link.id]
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`[feeReminderWorker] Reminder failed for student ${row.student_id}:`, err.message);
      }
    }
    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`[feeReminderWorker] Done — ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

worker.on('failed', (job, err) => {
  console.error(`FeeReminderQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
