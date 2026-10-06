import pool from '../config/db.js';
import { send as sendNotification } from './notificationService.js';

// ------------------------------------------------------------------
// "Your class starts soon" reminders (WhatsApp template upcoming_class_alert
// + the Teacher Portal bell).
//
// The poll runs every 10 minutes (workers/scheduler.js) and looks 15 minutes
// ahead, so consecutive polls overlap on purpose: a period is never missed
// because its start_time fell between two polls. teaching_reminder_log's
// UNIQUE(teacher_id, timetable_slot_id, class_date) is what prevents a
// double send from that overlap.
//
// CURRENT_DATE / CURRENT_TIME are the school's local time because every
// pooled connection is pinned to Asia/Kolkata (config/db.js).
// ------------------------------------------------------------------

const LOOKAHEAD_MINUTES = 15;

// Pure: who should be reminded about this period today?
//  - a substitute is assigned  -> the substitute
//  - cover is needed but nobody was found (unfilled) -> nobody
//  - the regular teacher is on approved leave / marked absent -> nobody
//  - otherwise -> the regular teacher
// Returns { teacherId, covering } or null.
export function reminderRecipient({ regular_teacher_id, sub_status, substitute_teacher_id, regular_absent }) {
  if (sub_status === 'assigned' && substitute_teacher_id) return { teacherId: substitute_teacher_id, covering: true };
  if (sub_status === 'unfilled') return null;
  if (regular_absent) return null;
  return regular_teacher_id ? { teacherId: regular_teacher_id, covering: false } : null;
}

export async function runUpcomingClassReminders({ lookaheadMinutes = LOOKAHEAD_MINUTES } = {}) {
  // day_of_week is 1=Monday..6=Saturday, the same numbering ISODOW uses, so
  // they line up directly (no Sunday slots are ever created).
  const { rows: upcoming } = await pool.query(
    `SELECT ts.id AS timetable_slot_id, ts.school_id, ts.class_id, ts.subject_id,
            ts.teacher_id AS regular_teacher_id, rt.name AS regular_teacher_name,
            c.name AS class_name, sub.name AS subject_name,
            x.status AS sub_status, x.substitute_teacher_id,
            (EXISTS (SELECT 1 FROM staff_leave_requests l
                      WHERE l.teacher_id = ts.teacher_id AND l.status = 'APPROVED'
                        AND CURRENT_DATE BETWEEN l.start_date AND l.end_date)
             OR EXISTS (SELECT 1 FROM teacher_absence_marks m
                         WHERE m.teacher_id = ts.teacher_id AND m.date = CURRENT_DATE)) AS regular_absent
     FROM timetable_slots ts
     JOIN classes c ON c.id = ts.class_id
     JOIN teachers rt ON rt.id = ts.teacher_id
     LEFT JOIN subjects sub ON sub.id = ts.subject_id
     LEFT JOIN substitutions x ON x.timetable_slot_id = ts.id AND x.date = CURRENT_DATE AND x.status <> 'cancelled'
     WHERE ts.teacher_id IS NOT NULL
       AND ts.day_of_week = EXTRACT(ISODOW FROM CURRENT_DATE)
       AND ts.start_time IS NOT NULL
       AND ts.start_time BETWEEN CURRENT_TIME AND (CURRENT_TIME + ($1 || ' minutes')::interval)`,
    [lookaheadMinutes]
  );

  // `failed` is only for reminders that could not be produced at all. A
  // WhatsApp that Meta rejected still reached the teacher's bell, and is
  // counted separately: this job covers every school, and one school's
  // WhatsApp problem must not mark the whole run as failed for all of them.
  const totals = { sent: 0, failed: 0, skipped: 0, whatsapp_failed: 0 };
  for (const slot of upcoming) {
    try {
      const recipient = reminderRecipient(slot);
      if (!recipient) {
        totals.skipped += 1;
        continue;
      }

      // Dedup-as-insert: only the run that actually inserts the row sends
      // anything, so a second poll catching the same slot is a no-op.
      const inserted = await pool.query(
        `INSERT INTO teaching_reminder_log (school_id, teacher_id, timetable_slot_id, class_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (teacher_id, timetable_slot_id, class_date) DO NOTHING
         RETURNING id`,
        [slot.school_id, recipient.teacherId, slot.timetable_slot_id]
      );
      if (inserted.rowCount === 0) continue;

      // Best-effort topic: the lesson plan the REGULAR teacher logged for
      // this exact slot, or for this class + subject today. A substitute
      // gets the same plan, so they know what the class was meant to cover.
      // No match means no topic line, never an invented chapter name.
      const planRes = await pool.query(
        `SELECT title FROM lesson_plans
         WHERE teacher_id = $1 AND class_id = $2
           AND (subject_id = $3 OR subject_id IS NULL)
           AND (timetable_slot_id = $4 OR plan_date = CURRENT_DATE)
         ORDER BY (timetable_slot_id = $4) DESC, created_at DESC
         LIMIT 1`,
        [slot.regular_teacher_id, slot.class_id, slot.subject_id, slot.timetable_slot_id]
      );
      const plan = planRes.rows[0]
        ? `Today's plan: ${String(planRes.rows[0].title).replace(/\s+/g, ' ').trim()}`
        : 'No lesson plan logged for this class yet.';
      const topic = recipient.covering ? `You are covering for ${slot.regular_teacher_name}. ${plan}` : plan;

      const result = await sendNotification({
        triggerEvent: 'upcoming_class_reminder',
        schoolId: slot.school_id,
        recipients: [{ type: 'staff', teacherId: recipient.teacherId }],
        variables: {
          class_name: slot.class_name,
          subject_name: slot.subject_name || 'class',
          topic,
        },
      });
      totals.sent += result.sent + result.failed;
      totals.whatsapp_failed += result.failed;
      totals.skipped += result.skipped;
    } catch (err) {
      totals.failed += 1;
      console.error(`Upcoming-class reminder failed for timetable_slot ${slot.timetable_slot_id}:`, err.message);
    }
  }
  return totals;
}
