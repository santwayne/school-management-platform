import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

const guidanceWorker = new Worker(
  'GuidanceQueue',
  async (job) => {
    console.log(`Processing daily guidance job: ${job.id}`);
    const today = new Date().toISOString().split('T')[0];

    // Today's active chapters per class, joined to the SPECIFIC teacher
    // assigned to that class+subject (not every teacher in the school),
    // plus the latest AI/admin homework suggestion. Falls back to the
    // teacher's regular phone if no WhatsApp-specific number is set yet.
    //
    // FIX (found while building workers/teachingReminderWorker.js): this
    // join used to compare cst.subject_id::text (the real integer
    // subjects.id, cast to text) against sc.subject_id (syllabus_calendar's
    // free-text curriculum code, e.g. "MATH101") — two different identity
    // systems that only ever matched by coincidence, making this worker's
    // guidance nudge effectively dead in practice. Now joins on the real,
    // properly-typed sc.subject_ref_id (nullable FK to subjects.id — see
    // schema.sql's note) instead. This does NOT retroactively fix existing
    // syllabus_calendar rows — only rows a principal has re-saved via the
    // updated SyllabusManager.jsx form (which now lets them pick the real
    // subject) will have subject_ref_id set and actually match here.
    const targetChapters = await pool.query(
      `SELECT sc.school_id, sc.class_id, sc.subject_id, sc.chapter_id, sc.chapter_name, sc.target_end_date,
              c.name AS class_name, t.id AS teacher_id, t.name AS teacher_name,
              COALESCE(t.whatsapp_number, t.phone) AS teacher_phone, hs.suggested_text
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
       WHERE $1 BETWEEN sc.target_start_date AND sc.target_end_date
         AND sc.subject_ref_id IS NOT NULL
         AND t.whatsapp_opt_in_status = 'OPTED_IN'`,
      [today]
    );

    for (const row of targetChapters.rows) {
      try {
        // Routed through the shared NotificationService (instead of calling
        // whatsappService directly) so every send leaves a dashboard_notifications
        // row \u2014 visible in the Teacher Portal's NotificationBell \u2014 rather than
        // only a console.log neither a teacher nor a principal can ever see.
        const result = await sendNotification({
          triggerEvent: 'daily_teaching_guidance',
          schoolId: row.school_id,
          recipients: [{ type: 'staff', teacherId: row.teacher_id }],
          variables: {
            teacher_name: row.teacher_name,
            class_name: row.class_name,
            chapter_name: row.chapter_name || row.chapter_id,
            suggestion: row.suggested_text || 'Review today\u2019s chapter and assign practice questions.',
          },
        });
        console.log(`Guidance logged for ${row.teacher_name} (${row.class_name} / ${row.chapter_id}):`, result);
      } catch (err) {
        console.error(`Guidance send failed for teacher ${row.teacher_id}:`, err.message);
      }

      // Flag drift: chapter's target end date has passed but no progress row exists yet.
      if (new Date(row.target_end_date) < new Date(today)) {
        const progress = await pool.query(
          `SELECT 1 FROM syllabus_progress WHERE chapter_id = $1 AND class_id = $2 AND marked_complete_date IS NOT NULL`,
          [row.chapter_id, row.class_id]
        );
        if (progress.rowCount === 0) {
          console.warn(`Syllabus drift: chapter ${row.chapter_id} overdue for class ${row.class_name}`);
        }
      }
    }
  },
  { connection }
);

guidanceWorker.on('failed', (job, err) => {
  console.error(`GuidanceQueue job ${job?.id} failed:`, err.message);
});

export default guidanceWorker;
