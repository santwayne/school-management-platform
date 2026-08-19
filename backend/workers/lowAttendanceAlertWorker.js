import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// Audit candidate #2 (see schema.sql's comment for the threshold/window/
// re-notify decisions made without asking, per the new standing rule).
// Minimum recorded days before a student is even considered — avoids
// flagging a brand-new enrollment off a 1-2-day sample.
const MIN_DAYS_RECORDED = 5;

const worker = new Worker(
  'LowAttendanceAlertQueue',
  async (job) => {
    if (job.name === 'weeklyLowAttendanceCheck') {
      return handleWeeklyCheck();
    }
    console.warn(`Unknown job name on LowAttendanceAlertQueue: ${job.name}`);
  },
  { connection }
);

async function handleWeeklyCheck() {
  const { rows } = await pool.query(
    `WITH att AS (
       SELECT s.id AS student_id, s.school_id, s.name AS student_name,
              COUNT(a.*) AS days_recorded,
              SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS days_present
       FROM students s
       LEFT JOIN school_settings ss ON ss.school_id = s.school_id
       JOIN attendance a ON a.student_id = s.id
         AND a.date >= CURRENT_DATE - (COALESCE(ss.low_attendance_window_days, 30) || ' days')::interval
       GROUP BY s.id, s.school_id, s.name
     )
     SELECT att.*, ROUND(100.0 * att.days_present / att.days_recorded, 1) AS attendance_percent,
            COALESCE(ss.low_attendance_window_days, 30) AS window_days
     FROM att
     LEFT JOIN school_settings ss ON ss.school_id = att.school_id
     WHERE att.days_recorded >= $1
       AND COALESCE(ss.notify_attendance, TRUE) = TRUE
       AND (100.0 * att.days_present / att.days_recorded) < COALESCE(ss.low_attendance_threshold_percent, 75)
       AND NOT EXISTS (
         SELECT 1 FROM low_attendance_alert_log l
         WHERE l.student_id = att.student_id
           AND l.sent_at > CURRENT_DATE - (COALESCE(ss.low_attendance_window_days, 30) / 2 || ' days')::interval
       )`,
    [MIN_DAYS_RECORDED]
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sendNotification({
        triggerEvent: 'low_attendance_alert',
        schoolId: row.school_id,
        recipients: [{ type: 'parent', studentId: row.student_id }],
        variables: { attendance_percent: row.attendance_percent, window_days: row.window_days },
      });
      await pool.query(
        `INSERT INTO low_attendance_alert_log (school_id, student_id, attendance_percent) VALUES ($1, $2, $3)`,
        [row.school_id, row.student_id, row.attendance_percent]
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[lowAttendanceAlertWorker] Alert failed for student ${row.student_id}:`, err.message);
    }
  }

  console.log(`[lowAttendanceAlertWorker] Done — ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

worker.on('failed', (job, err) => {
  console.error(`LowAttendanceAlertQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
