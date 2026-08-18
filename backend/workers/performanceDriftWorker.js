import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import Anthropic from '@anthropic-ai/sdk';

// ------------------------------------------------------------------
// Populates performance_snapshots for real. The table, the "3+ weeks
// sustained drift" framing, the flagged/flag_reason columns, and the
// GET /api/analytics/drift-alerts + PrincipalDashboard.jsx UI all already
// existed — the only thing missing was a real writer (confirmed: the only
// existing INSERT anywhere in the codebase was scripts/seedPankaj.js's
// demo data). This worker is that writer.
//
// DECISIONS MADE WITHOUT ASKING (see SUMMARY.md's section of the same
// name for the full list) — this file makes more of them than most,
// because "what counts as at-risk" is inherently a judgment call and the
// existing scaffold (class+subject+week granularity, not per-student —
// performance_snapshots has no student_id column at all) already
// committed to a specific shape before this worker existed:
//
// 1. GRANULARITY: class+subject+week, matching the existing table/UI
//    exactly (not per-individual-student — that would need a new table
//    and a bigger design pass; flagged as a real limitation below).
// 2. METRICS: attendance_pct (real, computed weekly from `attendance`).
//    homework_completion (best-effort — homework.subject_id is free text,
//    matched against subjects.name case-insensitively; when nothing
//    matches for a class+subject+week, the metric is simply omitted, not
//    fabricated as 0%). avg_score (from exam_marks, which IS a real FK to
//    subjects.id — but exams are infrequent, not weekly, so this uses the
//    most recent exam within a 90-day lookback rather than inventing a
//    "this week's exam average" that usually wouldn't exist; omitted
//    entirely if no exam in that window).
// 3. BASELINE: the school's own average for that metric across all
//    class+subject rows in the same week — a class is only "behind" its
//    own school's peers this week, not an external/absolute standard.
// 4. "BELOW BASELINE": more than 15 points/percentage-points under that
//    average.
// 5. "SUSTAINED": the SAME metric has been below baseline for this
//    class+subject in this run AND the two most recent prior weekly runs
//    (3 consecutive weeks) — matches the UI's own "3+ Weeks" framing and
//    the guardrail note about not flagging off one bad test.
// 6. AI'S ROLE IS NARROW ON PURPOSE: the actual flagging decision (steps
//    3-5) is deterministic threshold logic, not an LLM judgment call —
//    auditable, reproducible, no hallucination risk on "is this student
//    actually struggling." Claude is used ONLY to turn confirmed numbers
//    into the human-readable flag_reason sentence (matching the seed
//    data's narrative style) — never to decide whether to flag. If
//    ANTHROPIC_API_KEY isn't configured or the call fails, a deterministic
//    template sentence is used instead so the feature never breaks
//    because Claude is unavailable.
// ------------------------------------------------------------------

const BASELINE_GAP_THRESHOLD = 15; // points/percentage-points below the school average
const SUSTAINED_WEEKS = 3;
const SCORE_LOOKBACK_DAYS = 90;

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const worker = new Worker(
  'PerformanceDriftQueue',
  async (job) => {
    if (job.name === 'weeklyPerformanceSnapshot') {
      return handleWeeklySnapshot();
    }
    console.warn(`Unknown job name on PerformanceDriftQueue: ${job.name}`);
  },
  { connection }
);

// ISO week label matching the seed data's format, e.g. '2026-W27'.
function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Monday-Sunday boundaries for "the week that just ended" (this runs
// Sunday night, so "this week" is the 7 days ending today).
function weekBounds(now) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end, label: isoWeekLabel(now) };
}

async function computeAttendancePct(classId, start, end) {
  const { rows } = await pool.query(
    `SELECT ROUND(100.0 * SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct
     FROM attendance a JOIN students s ON s.id = a.student_id
     WHERE s.class_id = $1 AND a.date >= $2 AND a.date <= $3`,
    [classId, start, end]
  );
  const pct = rows[0]?.pct;
  return pct === null || pct === undefined ? null : Number(pct);
}

async function computeHomeworkCompletion(classId, subjectName, start, end) {
  const { rows } = await pool.query(
    `WITH hw AS (
       SELECT id FROM homework
       WHERE class_id = $1 AND lower(subject_id) = lower($2)
         AND created_at >= $3 AND created_at <= $4
     )
     SELECT
       (SELECT COUNT(*) FROM hw) AS hw_count,
       (SELECT COUNT(*) FROM homework_completions hc JOIN hw ON hw.id = hc.homework_id) AS completions,
       (SELECT COUNT(*) FROM students WHERE class_id = $1) AS student_count`,
    [classId, subjectName, start, end]
  );
  const { hw_count, completions, student_count } = rows[0];
  if (Number(hw_count) === 0 || Number(student_count) === 0) return null;
  return Math.round((Number(completions) / (Number(hw_count) * Number(student_count))) * 1000) / 10;
}

async function computeAvgScore(classId, subjectId) {
  const { rows } = await pool.query(
    `SELECT AVG(100.0 * em.marks_obtained / NULLIF(em.max_marks, 0)) AS avg_score, e.name AS exam_name
     FROM exam_marks em
     JOIN exams e ON e.id = em.exam_id
     WHERE em.subject_id = $1 AND e.class_id = $2
       AND e.id = (
         SELECT id FROM exams
         WHERE class_id = $2 AND created_at >= NOW() - ($3 || ' days')::interval
         ORDER BY created_at DESC LIMIT 1
       )
     GROUP BY e.name`,
    [subjectId, classId, SCORE_LOOKBACK_DAYS]
  );
  if (rows.length === 0 || rows[0].avg_score === null) return null;
  return { avg_score: Math.round(Number(rows[0].avg_score) * 10) / 10, exam_name: rows[0].exam_name };
}

async function generateFlagReason(className, subjectName, metricLabel, threeWeekValues, latest) {
  const fallback = `${className} ${subjectName} has been below the school average on ${metricLabel} for ${SUSTAINED_WEEKS}+ consecutive weeks — latest value ${latest}. Principal review recommended.`;
  if (!anthropic) return fallback;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 120,
      system:
        'You write one-to-two sentence performance-drift alerts for a school principal dashboard, in the style of ' +
        '"Science scores in Class 8A have dropped 18 points below school baseline for 3+ consecutive weeks." ' +
        'State only what the numbers show — never speculate about causes not in the data, never suggest a specific ' +
        'intervention. Plain, factual, concise.',
      messages: [
        {
          role: 'user',
          content: `Class: ${className}\nSubject: ${subjectName}\nMetric: ${metricLabel}\nLast ${SUSTAINED_WEEKS} weekly values: ${threeWeekValues.join(', ')}`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text?.trim() || fallback;
  } catch (err) {
    console.error('[performanceDriftWorker] flag_reason generation failed, using fallback:', err.message);
    return fallback;
  }
}

async function handleWeeklySnapshot() {
  const { start, end, label } = weekBounds(new Date());

  const assignments = await pool.query(
    `SELECT cst.school_id, cst.class_id, cst.subject_id, cst.teacher_id,
            c.name AS class_name, sub.name AS subject_name
     FROM class_subject_teachers cst
     JOIN classes c ON c.id = cst.class_id
     JOIN subjects sub ON sub.id = cst.subject_id`
  );

  // Pass 1: compute raw metrics for every class+subject this week.
  const computed = [];
  for (const a of assignments.rows) {
    const [attendance_pct, homework_completion, scoreResult] = await Promise.all([
      computeAttendancePct(a.class_id, start, end),
      computeHomeworkCompletion(a.class_id, a.subject_name, start, end),
      computeAvgScore(a.class_id, a.subject_id),
    ]);
    const metrics = {};
    if (attendance_pct !== null) metrics.attendance_pct = attendance_pct;
    if (homework_completion !== null) metrics.homework_completion = homework_completion;
    if (scoreResult) metrics.avg_score = scoreResult.avg_score;
    computed.push({ ...a, metrics });
  }

  // School-wide baseline per metric, per school, for this week only.
  const baselines = {}; // schoolId -> { metricKey: avg }
  for (const row of computed) {
    if (!baselines[row.school_id]) baselines[row.school_id] = {};
    for (const key of ['attendance_pct', 'homework_completion', 'avg_score']) {
      if (row.metrics[key] === undefined) continue;
      if (!baselines[row.school_id][key]) baselines[row.school_id][key] = [];
      baselines[row.school_id][key].push(row.metrics[key]);
    }
  }
  const baselineAvg = {};
  for (const schoolId of Object.keys(baselines)) {
    baselineAvg[schoolId] = {};
    for (const key of Object.keys(baselines[schoolId])) {
      const vals = baselines[schoolId][key];
      baselineAvg[schoolId][key] = vals.reduce((s, v) => s + v, 0) / vals.length;
    }
  }

  let inserted = 0;
  let flagged = 0;
  for (const row of computed) {
    const schoolBaseline = baselineAvg[row.school_id] || {};
    const belowBaseline = {};
    for (const key of ['attendance_pct', 'homework_completion', 'avg_score']) {
      if (row.metrics[key] === undefined || schoolBaseline[key] === undefined) continue;
      belowBaseline[key] = schoolBaseline[key] - row.metrics[key] >= BASELINE_GAP_THRESHOLD;
    }

    // Look at the last (SUSTAINED_WEEKS - 1) prior snapshots for this exact
    // class+subject to check for a sustained pattern on the same metric.
    const priorRes = await pool.query(
      `SELECT metrics FROM performance_snapshots
       WHERE school_id = $1 AND class_id = $2 AND subject_id = $3
       ORDER BY created_at DESC LIMIT $4`,
      [row.school_id, row.class_id, row.subject_name, SUSTAINED_WEEKS - 1]
    );

    let flagReason = null;
    let isFlagged = false;
    if (priorRes.rowCount === SUSTAINED_WEEKS - 1) {
      for (const key of Object.keys(belowBaseline)) {
        if (!belowBaseline[key]) continue;
        const priorAllBelow = priorRes.rows.every((r) => r.metrics?._below_baseline?.[key] === true);
        if (priorAllBelow) {
          const metricLabel = { attendance_pct: 'attendance', homework_completion: 'homework completion', avg_score: 'exam scores' }[key];
          const history = [...priorRes.rows.map((r) => r.metrics[key]).reverse(), row.metrics[key]];
          flagReason = await generateFlagReason(row.class_name, row.subject_name, metricLabel, history, row.metrics[key]);
          isFlagged = true;
          break; // one reason is enough — a class rarely needs two separate drift alerts in the same week
        }
      }
    }

    // _below_baseline is internal bookkeeping (this run's per-metric flag,
    // read back by future runs to check the sustained pattern) — not
    // rendered anywhere, so it's fine to carry alongside the real metrics.
    const storedMetrics = { ...row.metrics, _below_baseline: belowBaseline };

    try {
      await pool.query(
        `INSERT INTO performance_snapshots (school_id, class_id, teacher_id, subject_id, period, metrics, flagged, flag_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.school_id, row.class_id, row.teacher_id, row.subject_name, label, JSON.stringify(storedMetrics), isFlagged, flagReason]
      );
      inserted += 1;
      if (isFlagged) flagged += 1;
    } catch (err) {
      console.error(`[performanceDriftWorker] Insert failed for class ${row.class_id}/${row.subject_name}:`, err.message);
    }
  }

  console.log(`[performanceDriftWorker] Done — ${inserted} snapshots written, ${flagged} flagged, week ${label}.`);
  return { inserted, flagged };
}

worker.on('failed', (job, err) => {
  console.error(`PerformanceDriftQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
