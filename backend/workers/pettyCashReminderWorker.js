import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// Second finding from the automated-parent-notifications audit (see
// schema.sql's comment on petty_cash.reminder_sent_at): unlike fee
// reminders there was no reminder at all — manual or automatic — when a
// petty cash request sat pending. Low volume compared to fee reminders (one
// request, not one per student), so this is intentionally simpler: one
// one-time nudge per request, no batching/rate-limiting needed at this
// scale.

const worker = new Worker(
  'PettyCashReminderQueue',
  async (job) => {
    if (job.name === 'dailyPettyCashReminders') {
      return handleDailyReminders();
    }
    console.warn(`Unknown job name on PettyCashReminderQueue: ${job.name}`);
  },
  { connection }
);

async function handleDailyReminders() {
  const pending = await pool.query(
    `SELECT pc.id, pc.school_id, pc.requested_by, pc.amount
     FROM petty_cash pc
     LEFT JOIN school_settings ss ON ss.school_id = pc.school_id
     WHERE pc.status = 'PENDING'
       AND pc.reminder_sent_at IS NULL
       AND pc.created_at <= NOW() - (COALESCE(ss.petty_cash_reminder_days, 2) || ' days')::interval`
  );

  let sent = 0;
  let failed = 0;
  for (const request of pending.rows) {
    try {
      const principals = await pool.query(
        `SELECT id FROM teachers WHERE school_id = $1 AND role = 'principal'`,
        [request.school_id]
      );
      if (principals.rowCount === 0) continue; // no one to notify — leave reminder_sent_at unset, will retry tomorrow

      await sendNotification({
        triggerEvent: 'petty_cash_pending_reminder',
        schoolId: request.school_id,
        recipients: principals.rows.map((p) => ({ type: 'staff', teacherId: p.id })),
        variables: { requested_by: request.requested_by, amount: request.amount },
      });

      await pool.query(`UPDATE petty_cash SET reminder_sent_at = NOW() WHERE id = $1`, [request.id]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[pettyCashReminderWorker] Reminder failed for petty_cash ${request.id}:`, err.message);
    }
  }

  console.log(`[pettyCashReminderWorker] Done — ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

worker.on('failed', (job, err) => {
  console.error(`PettyCashReminderQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
