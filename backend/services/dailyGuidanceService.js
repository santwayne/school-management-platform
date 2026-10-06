import pool from '../config/db.js';
import { send as sendNotification } from './notificationService.js';

// ------------------------------------------------------------------
// Daily teaching guidance: each morning, every teacher is told which
// chapter the syllabus calendar has them on today, per class, with a
// homework suggestion (WhatsApp template daily_teaching_guidance + the
// Teacher Portal bell).
//
// What it needs to have anything to say:
//   1. syllabus_calendar rows whose dates include today,
//   2. each tagged with a real subject (subject_ref_id — set from the
//      Syllabus screen), and
//   3. a teacher assigned to that class + subject.
// It does NOT use the timetable.
// ------------------------------------------------------------------

// Pure: guidance is for school days. ISO day 7 is Sunday.
export function isGuidanceDay(isoDow) {
  return Number(isoDow) >= 1 && Number(isoDow) <= 6;
}

export async function runDailyGuidance() {
  // The school's calendar day (connections are pinned to Asia/Kolkata), not
  // the server's UTC date.
  const now = await pool.query(`SELECT CURRENT_DATE::text AS today, EXTRACT(ISODOW FROM CURRENT_DATE)::int AS dow`);
  const { today, dow } = now.rows[0];
  if (!isGuidanceDay(dow)) return { sent: 0, failed: 0, skipped: 0, note: 'sunday' };

  // Today's active chapters per class, joined to the SPECIFIC teacher
  // assigned to that class + subject. Teachers without WhatsApp are
  // included on purpose: the notification service still puts the guidance
  // in their Teacher Portal bell and only sends WhatsApp to opted-in numbers.
  const targetChapters = await pool.query(
    `SELECT sc.id AS syllabus_calendar_id, sc.school_id, sc.class_id, sc.chapter_id, sc.chapter_name,
            c.name AS class_name, t.id AS teacher_id, t.name AS teacher_name, hs.suggested_text
     FROM syllabus_calendar sc
     JOIN classes c ON sc.class_id = c.id
     JOIN class_subject_teachers cst
       ON cst.class_id = sc.class_id
      AND cst.subject_id = sc.subject_ref_id
     JOIN teachers t ON t.id = cst.teacher_id
     LEFT JOIN LATERAL (
       SELECT suggested_text FROM homework_suggestions
       WHERE chapter_id = sc.chapter_id
       ORDER BY created_at DESC LIMIT 1
     ) hs ON true
     WHERE $1::date BETWEEN sc.target_start_date AND sc.target_end_date
       AND sc.subject_ref_id IS NOT NULL
     ORDER BY sc.school_id, t.id, sc.id`,
    [today]
  );

  // See teachingReminderService: `failed` is for guidance that could not be
  // produced; a rejected WhatsApp is counted apart so one school's WhatsApp
  // problem does not fail this all-schools job.
  const totals = { sent: 0, failed: 0, skipped: 0, whatsapp_failed: 0 };
  for (const row of targetChapters.rows) {
    try {
      // One nudge per teacher, chapter and day, however often the job runs.
      const inserted = await pool.query(
        `INSERT INTO daily_guidance_log (school_id, teacher_id, syllabus_calendar_id, guidance_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (teacher_id, syllabus_calendar_id, guidance_date) DO NOTHING
         RETURNING id`,
        [row.school_id, row.teacher_id, row.syllabus_calendar_id, today]
      );
      if (inserted.rowCount === 0) {
        totals.skipped += 1;
        continue;
      }

      const result = await sendNotification({
        triggerEvent: 'daily_teaching_guidance',
        schoolId: row.school_id,
        recipients: [{ type: 'staff', teacherId: row.teacher_id }],
        variables: {
          teacher_name: row.teacher_name,
          class_name: row.class_name,
          chapter_name: String(row.chapter_name || row.chapter_id).replace(/\s+/g, ' ').trim(),
          suggestion: String(row.suggested_text || 'Review today\u2019s chapter and assign practice questions.').replace(/\s+/g, ' ').trim(),
        },
      });
      totals.sent += result.sent + result.failed;
      totals.whatsapp_failed += result.failed;
      totals.skipped += result.skipped;
    } catch (err) {
      totals.failed += 1;
      console.error(`Guidance send failed for teacher ${row.teacher_id}:`, err.message);
    }
  }
  return totals;
}
