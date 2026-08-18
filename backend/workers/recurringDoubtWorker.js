import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { send as sendNotification } from '../services/notificationService.js';

// AI roadmap #2 revision — see schema.sql's comment for why this notifies
// every teacher assigned to the class (any subject) rather than trying to
// pinpoint one exact subject teacher from chapter_tag.

const MIN_STUDENTS = 3; // same threshold as the GET /recurring-doubts dashboard card

const worker = new Worker(
  'RecurringDoubtQueue',
  async (job) => {
    if (job.name === 'weeklyRecurringDoubtCheck') {
      return handleWeeklyCheck();
    }
    console.warn(`Unknown job name on RecurringDoubtQueue: ${job.name}`);
  },
  { connection }
);

// ISO week label, same helper shape as the other weekly workers.
function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekBounds(now) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end, label: isoWeekLabel(now) };
}

async function handleWeeklyCheck() {
  const { start, end, label } = weekBounds(new Date());

  const { rows: groups } = await pool.query(
    `SELECT sd.school_id, c.id AS class_id, c.name AS class_name, sd.chapter_tag,
            COUNT(DISTINCT sd.student_id) AS student_count
     FROM student_doubts sd
     JOIN students s ON s.id = sd.student_id
     JOIN classes c ON c.id = s.class_id
     WHERE sd.chapter_tag IS NOT NULL AND sd.chapter_tag != 'Untagged'
       AND sd.created_at >= $1 AND sd.created_at <= $2
     GROUP BY sd.school_id, c.id, c.name, sd.chapter_tag
     HAVING COUNT(DISTINCT sd.student_id) >= $3`,
    [start, end, MIN_STUDENTS]
  );

  let sent = 0;
  let skipped = 0;
  for (const group of groups) {
    try {
      const alreadySent = await pool.query(
        `SELECT 1 FROM recurring_doubt_notification_log WHERE class_id = $1 AND chapter_tag = $2 AND period = $3`,
        [group.class_id, group.chapter_tag, label]
      );
      if (alreadySent.rowCount > 0) { skipped += 1; continue; }

      const teachersRes = await pool.query(
        `SELECT DISTINCT teacher_id FROM class_subject_teachers WHERE class_id = $1`,
        [group.class_id]
      );
      if (teachersRes.rowCount === 0) { skipped += 1; continue; } // no assigned teacher to notify

      await sendNotification({
        triggerEvent: 'recurring_doubt_signal',
        schoolId: group.school_id,
        recipients: teachersRes.rows.map((t) => ({ type: 'staff', teacherId: t.teacher_id })),
        variables: { chapter_tag: group.chapter_tag, class_name: group.class_name, student_count: group.student_count },
      });

      await pool.query(
        `INSERT INTO recurring_doubt_notification_log (school_id, class_id, chapter_tag, period) VALUES ($1, $2, $3, $4)
         ON CONFLICT (class_id, chapter_tag, period) DO NOTHING`,
        [group.school_id, group.class_id, group.chapter_tag, label]
      );
      sent += 1;
    } catch (err) {
      console.error(`[recurringDoubtWorker] Failed for class ${group.class_id} / ${group.chapter_tag}:`, err.message);
    }
  }

  console.log(`[recurringDoubtWorker] Done — ${sent} signals sent, ${skipped} skipped, week ${label}.`);
  return { sent, skipped };
}

worker.on('failed', (job, err) => {
  console.error(`RecurringDoubtQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
