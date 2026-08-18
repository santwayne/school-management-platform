import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// Third finding from the "what else should be autonomous" audit: neither
// submitting nor approving/rejecting a staff leave request sends any
// notification today (confirmed by reading routes/staffLeave.js in full).
// This adds only the piece explicitly asked for — remind the principal
// when a request has sat PENDING too long — same shape as
// pettyCashReminderWorker.js: one-time nudge, no batching needed at this
// volume (one request, not one per student).

const worker = new Worker(
  'StaffLeaveReminderQueue',
  async (job) => {
    if (job.name === 'dailyStaffLeaveReminders') {
      return handleDailyReminders();
    }
    console.warn(`Unknown job name on StaffLeaveReminderQueue: ${job.name}`);
  },
  { connection }
);

async function handleDailyReminders() {
  const pending = await pool.query(
    `SELECT sl.id, sl.school_id, sl.leave_type, sl.days_count, t.name AS teacher_name
     FROM staff_leave_requests sl
     JOIN teachers t ON t.id = sl.teacher_id
     LEFT JOIN school_settings ss ON ss.school_id = sl.school_id
     WHERE sl.status = 'PENDING'
       AND sl.reminder_sent_at IS NULL
       AND sl.created_at <= NOW() - (COALESCE(ss.staff_leave_reminder_days, 2) || ' days')::interval`
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
        triggerEvent: 'staff_leave_pending_reminder',
        schoolId: request.school_id,
        recipients: principals.rows.map((p) => ({ type: 'staff', teacherId: p.id })),
        variables: { teacher_name: request.teacher_name, leave_type: request.leave_type, days_count: request.days_count },
      });

      await pool.query(`UPDATE staff_leave_requests SET reminder_sent_at = NOW() WHERE id = $1`, [request.id]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[staffLeaveReminderWorker] Reminder failed for staff_leave_requests ${request.id}:`, err.message);
    }
  }

  console.log(`[staffLeaveReminderWorker] Done — ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

worker.on('failed', (job, err) => {
  console.error(`StaffLeaveReminderQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
