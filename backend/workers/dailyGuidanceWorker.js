import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';

const GUIDANCE_TEMPLATE_NAME = process.env.WHATSAPP_GUIDANCE_TEMPLATE || 'daily_teaching_guidance';

const guidanceWorker = new Worker(
  'GuidanceQueue',
  async (job) => {
    console.log(`Processing daily guidance job: ${job.id}`);
    const today = new Date().toISOString().split('T')[0];

    // Today's active chapters per class, joined to the SPECIFIC teacher
    // assigned to that class+subject (not every teacher in the school),
    // plus the latest AI/admin homework suggestion. Falls back to the
    // teacher's regular phone if no WhatsApp-specific number is set yet.
    const targetChapters = await pool.query(
      `SELECT sc.school_id, sc.class_id, sc.subject_id, sc.chapter_id, sc.chapter_name, sc.target_end_date,
              c.name AS class_name, t.id AS teacher_id, t.name AS teacher_name,
              COALESCE(t.whatsapp_number, t.phone) AS teacher_phone, hs.suggested_text
       FROM syllabus_calendar sc
       JOIN classes c ON sc.class_id = c.id
       JOIN class_subject_teachers cst
         ON cst.class_id = sc.class_id
        AND cst.subject_id::text = sc.subject_id -- subjects table id vs syllabus_calendar's loose text subject_id
       JOIN teachers t ON t.id = cst.teacher_id
       LEFT JOIN LATERAL (
         SELECT suggested_text FROM homework_suggestions
         WHERE chapter_id = sc.chapter_id
         ORDER BY created_at DESC LIMIT 1
       ) hs ON true
       WHERE $1 BETWEEN sc.target_start_date AND sc.target_end_date
         AND t.whatsapp_opt_in_status = 'OPTED_IN'`,
      [today]
    );

    for (const row of targetChapters.rows) {
      try {
        await sendTemplateMessage(row.teacher_phone, GUIDANCE_TEMPLATE_NAME, 'en', [
          row.teacher_name,
          row.class_name,
          row.chapter_name || row.chapter_id,
          row.suggested_text || 'Review today\u2019s chapter and assign practice questions.',
        ]);
        console.log(`Guidance sent to ${row.teacher_name} (${row.class_name} / ${row.chapter_id})`);
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
