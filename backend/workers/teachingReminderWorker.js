import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// How far ahead to look for a period about to start. The poll itself runs
// every 10 minutes (scheduler.js) — a 15-minute window means consecutive
// polls overlap on purpose, so a period is never missed just because its
// start_time fell between two poll timestamps. teaching_reminder_log's
// UNIQUE(teacher_id, timetable_slot_id, class_date) is what actually
// prevents a double-send from that overlap, not the window size.
const LOOKAHEAD_MINUTES = 15;

const teachingReminderWorker = new Worker(
  'TeachingReminderQueue',
  async (job) => {
    if (job.name === 'checkUpcomingClasses') {
      return handleUpcomingClasses();
    }
    console.warn(`Unknown job name on TeachingReminderQueue: ${job.name}`);
  },
  { connection }
);

async function handleUpcomingClasses() {
  // day_of_week is 1=Monday..6=Saturday (timetable_slots' own comment) —
  // ISODOW returns 1=Monday..7=Sunday, so they line up directly for the
  // 6-day week this schema assumes (no Sunday slots are ever created).
  // DEPENDS ON the QA fix list's Item 10/11 (config/db.js pins every pooled
  // connection's session timezone to Asia/Kolkata) for CURRENT_DATE/
  // CURRENT_TIME here to reflect the school's local time rather than UTC —
  // this branch is built off master (which doesn't have that pin yet) but
  // is intended to be folded into the combined branch where it already
  // exists, same dependency note as the fee-reminder worker's fee_structures
  // dependency. Applying this branch's patches standalone against a bare
  // master, without Item 10/11, means this worker's "next 15 minutes"
  // window is computed in UTC instead of IST.
  const { rows: upcoming } = await pool.query(
    `SELECT ts.id AS timetable_slot_id, ts.school_id, ts.class_id, ts.subject_id, ts.teacher_id,
            c.name AS class_name, sub.name AS subject_name
     FROM timetable_slots ts
     JOIN classes c ON c.id = ts.class_id
     LEFT JOIN subjects sub ON sub.id = ts.subject_id
     WHERE ts.teacher_id IS NOT NULL
       AND ts.day_of_week = EXTRACT(ISODOW FROM CURRENT_DATE)
       AND ts.start_time IS NOT NULL
       AND ts.start_time BETWEEN CURRENT_TIME AND (CURRENT_TIME + ($1 || ' minutes')::interval)`,
    [LOOKAHEAD_MINUTES]
  );

  for (const slot of upcoming) {
    try {
      // Dedup-as-insert (same pattern as bus_proximity_alerts): only the
      // request that actually inserts the row goes on to send anything, so
      // a second poll catching the same slot in its overlapping window is
      // a silent no-op, not a duplicate WhatsApp message.
      const inserted = await pool.query(
        `INSERT INTO teaching_reminder_log (school_id, teacher_id, timetable_slot_id, class_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (teacher_id, timetable_slot_id, class_date) DO NOTHING
         RETURNING id`,
        [slot.school_id, slot.teacher_id, slot.timetable_slot_id]
      );
      if (inserted.rowCount === 0) continue;

      // Best-effort topic: a lesson plan this teacher logged for this
      // exact slot today, or for this class+subject today more loosely.
      // Both sides use the real subjects.id — see schema.sql's note on why
      // syllabus_calendar (a different, text-keyed subject identity) is
      // deliberately NOT used here. No match just means no topic line —
      // never a fabricated chapter name.
      const planRes = await pool.query(
        `SELECT title FROM lesson_plans
         WHERE teacher_id = $1 AND class_id = $2
           AND (subject_id = $3 OR subject_id IS NULL)
           AND (timetable_slot_id = $4 OR plan_date = CURRENT_DATE)
         ORDER BY (timetable_slot_id = $4) DESC, created_at DESC
         LIMIT 1`,
        [slot.teacher_id, slot.class_id, slot.subject_id, slot.timetable_slot_id]
      );
      const topic = planRes.rows[0]
        ? `Today's plan: ${planRes.rows[0].title}`
        : 'No lesson plan logged for this class yet.';

      await sendNotification({
        triggerEvent: 'upcoming_class_reminder',
        schoolId: slot.school_id,
        recipients: [{ type: 'staff', teacherId: slot.teacher_id }],
        variables: {
          class_name: slot.class_name,
          subject_name: slot.subject_name || 'class',
          topic,
        },
      });
    } catch (err) {
      console.error(`Upcoming-class reminder failed for timetable_slot ${slot.timetable_slot_id}:`, err.message);
    }
  }
}

teachingReminderWorker.on('failed', (job, err) => {
  console.error(`TeachingReminderQueue job ${job?.id} failed:`, err.message);
});

export default teachingReminderWorker;
