import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import Anthropic from '@anthropic-ai/sdk';
import { send as sendNotification } from '../services/notificationService.js';

// AI roadmap #4 — see schema.sql's comment for the class-level (not
// per-student) and new-toggle decisions made without asking.

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// Same batching shape as feeReminderWorker.js — this fans out to every
// parent in a class per notification call already (sendNotification takes
// an array), so the real burst risk is many CLASSES in one run, not many
// students within one class. Small delay between classes is enough here.
const CLASS_BATCH_DELAY_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = new Worker(
  'WeeklyProgressSummaryQueue',
  async (job) => {
    if (job.name === 'weeklyClassSummaries') {
      return handleWeeklySummaries();
    }
    console.warn(`Unknown job name on WeeklyProgressSummaryQueue: ${job.name}`);
  },
  { connection }
);

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

async function computeClassStats(classId, start, end) {
  const [attendanceRes, homeworkRes, examRes] = await Promise.all([
    pool.query(
      `SELECT ROUND(100.0 * SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct
       FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE s.class_id = $1 AND a.date >= $2 AND a.date <= $3`,
      [classId, start, end]
    ),
    pool.query(
      `WITH hw AS (SELECT id FROM homework WHERE class_id = $1 AND created_at >= $2 AND created_at <= $3)
       SELECT
         (SELECT COUNT(*) FROM hw) AS hw_count,
         (SELECT COUNT(*) FROM homework_completions hc JOIN hw ON hw.id = hc.homework_id) AS completions,
         (SELECT COUNT(*) FROM students WHERE class_id = $1) AS student_count`,
      [classId, start, end]
    ),
    pool.query(
      `SELECT ROUND(AVG(100.0 * em.marks_obtained / NULLIF(em.max_marks, 0)), 1) AS avg_score, COUNT(DISTINCT e.id) AS exam_count
       FROM exam_marks em JOIN exams e ON e.id = em.exam_id
       WHERE e.class_id = $1 AND e.created_at >= $2 AND e.created_at <= $3`,
      [classId, start, end]
    ),
  ]);

  const stats = {};
  const attPct = attendanceRes.rows[0]?.pct;
  if (attPct !== null && attPct !== undefined) stats.attendance_pct = Number(attPct);

  const { hw_count, completions, student_count } = homeworkRes.rows[0];
  if (Number(hw_count) > 0 && Number(student_count) > 0) {
    stats.homework_assigned = Number(hw_count);
    stats.homework_completion_pct = Math.round((Number(completions) / (Number(hw_count) * Number(student_count))) * 1000) / 10;
  }

  const { avg_score, exam_count } = examRes.rows[0];
  if (Number(exam_count) > 0 && avg_score !== null) {
    stats.avg_exam_score = Number(avg_score);
  }

  return stats;
}

async function generateSummaryText(className, stats) {
  const parts = [];
  if (stats.attendance_pct !== undefined) parts.push(`attendance ${stats.attendance_pct}%`);
  if (stats.homework_completion_pct !== undefined) parts.push(`homework completion ${stats.homework_completion_pct}% (${stats.homework_assigned} assignment(s) this week)`);
  if (stats.avg_exam_score !== undefined) parts.push(`average exam score ${stats.avg_exam_score}%`);
  const fallback = parts.length > 0
    ? `This week in ${className}: ${parts.join(', ')}.`
    : `No new attendance, homework, or exam activity recorded for ${className} this week.`;

  if (!anthropic || parts.length === 0) return fallback;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 150,
      system:
        'You write a short, warm 2-3 sentence weekly progress summary for parents of a school class, from raw ' +
        'stats. State only the numbers given — never add a specific cause, praise, or concern the numbers don\'t ' +
        'support. Plain text, no markdown, no emoji.',
      messages: [{ role: 'user', content: `Class: ${className}\nThis week's stats: ${JSON.stringify(stats)}` }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text?.trim() || fallback;
  } catch (err) {
    console.error('[weeklyProgressSummaryWorker] summary generation failed, using fallback:', err.message);
    return fallback;
  }
}

async function handleWeeklySummaries() {
  const { start, end, label } = weekBounds(new Date());

  const classesRes = await pool.query(
    `SELECT c.id AS class_id, c.name AS class_name, c.school_id
     FROM classes c
     LEFT JOIN school_settings ss ON ss.school_id = c.school_id
     WHERE COALESCE(ss.notify_weekly_summary, TRUE) = TRUE`
  );

  let sent = 0;
  let skipped = 0;
  for (const cls of classesRes.rows) {
    try {
      const alreadySent = await pool.query(
        `SELECT 1 FROM weekly_progress_summary_log WHERE class_id = $1 AND period = $2`,
        [cls.class_id, label]
      );
      if (alreadySent.rowCount > 0) { skipped += 1; continue; }

      const stats = await computeClassStats(cls.class_id, start, end);
      if (Object.keys(stats).length === 0) { skipped += 1; continue; } // nothing happened this week — no summary to send

      const studentsRes = await pool.query(`SELECT id FROM students WHERE class_id = $1`, [cls.class_id]);
      if (studentsRes.rowCount === 0) { skipped += 1; continue; }

      const summaryText = await generateSummaryText(cls.class_name, stats);

      await sendNotification({
        triggerEvent: 'weekly_class_progress_summary',
        schoolId: cls.school_id,
        recipients: studentsRes.rows.map((s) => ({ type: 'parent', studentId: s.id })),
        variables: { class_name: cls.class_name, summary_text: summaryText },
      });

      await pool.query(
        `INSERT INTO weekly_progress_summary_log (school_id, class_id, period) VALUES ($1, $2, $3) ON CONFLICT (class_id, period) DO NOTHING`,
        [cls.school_id, cls.class_id, label]
      );
      sent += 1;
      await sleep(CLASS_BATCH_DELAY_MS);
    } catch (err) {
      console.error(`[weeklyProgressSummaryWorker] Failed for class ${cls.class_id}:`, err.message);
    }
  }

  console.log(`[weeklyProgressSummaryWorker] Done — ${sent} classes summarized, ${skipped} skipped, week ${label}.`);
  return { sent, skipped };
}

worker.on('failed', (job, err) => {
  console.error(`WeeklyProgressSummaryQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
