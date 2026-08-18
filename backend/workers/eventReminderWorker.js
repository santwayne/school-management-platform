import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// Audit candidate #3 — see schema.sql's comment for the days-before/
// audience-scope decisions made without asking.

const worker = new Worker(
  'EventReminderQueue',
  async (job) => {
    if (job.name === 'dailyEventReminders') {
      return handleDailyReminders();
    }
    console.warn(`Unknown job name on EventReminderQueue: ${job.name}`);
  },
  { connection }
);

async function handleDailyReminders() {
  const { rows: events } = await pool.query(
    `SELECT e.id, e.school_id, e.title, e.event_date, COALESCE(ss.event_reminder_days_before, 2) AS days_before
     FROM school_events e
     LEFT JOIN school_settings ss ON ss.school_id = e.school_id
     WHERE e.audience IN ('all', 'parents')
       AND e.event_date = CURRENT_DATE + (COALESCE(ss.event_reminder_days_before, 2) || ' days')::interval
       AND NOT EXISTS (SELECT 1 FROM event_reminder_log l WHERE l.event_id = e.id)`
  );

  let sent = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const students = await pool.query(`SELECT id FROM students WHERE school_id = $1`, [event.school_id]);
      if (students.rowCount === 0) continue; // no one to notify — leave un-logged, will retry tomorrow if event_date math still matches

      await sendNotification({
        triggerEvent: 'upcoming_event_reminder',
        schoolId: event.school_id,
        recipients: students.rows.map((s) => ({ type: 'parent', studentId: s.id })),
        variables: {
          event_title: event.title,
          event_date: event.event_date instanceof Date ? event.event_date.toISOString().slice(0, 10) : String(event.event_date),
          days_before: event.days_before,
        },
      });

      await pool.query(`INSERT INTO event_reminder_log (school_id, event_id) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`, [
        event.school_id,
        event.id,
      ]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[eventReminderWorker] Reminder failed for school_events ${event.id}:`, err.message);
    }
  }

  console.log(`[eventReminderWorker] Done — ${sent} events reminded, ${failed} failed.`);
  return { sent, failed };
}

worker.on('failed', (job, err) => {
  console.error(`EventReminderQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
