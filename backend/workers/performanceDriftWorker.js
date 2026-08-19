import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import Anthropic from '@anthropic-ai/sdk';

// ------------------------------------------------------------------
// Populates performance_snapshots for real, PER STUDENT. The table, the
// "3+ weeks sustained drift" framing, flagged/flag_reason, GET
// /api/analytics/drift-alerts, and the Principal Dashboard UI all already
// existed — confirmed the only existing writer anywhere in the codebase
// was scripts/seedPankaj.js's demo data (class+subject-level, no student
// identity). This worker is the real writer.
//
// REVISED from a first pass that computed class+subject-level snapshots
// (matching the table's original shape, which had no student_id column).
// A follow-up spec explicitly asked for a risk signal PER STUDENT — "a
// principal/teacher needs to trust and act on it" reads as needing to
// know WHICH student, not just which class — so this version adds
// student_id (see schema.sql) and computes one row per student per week
// instead of one row per class+subject per week.
//
// DECISIONS MADE WITHOUT ASKING (see SUMMARY.md's section of the same
// name):
// 1. METRICS ARE PER-STUDENT, NOT PER-STUDENT-PER-SUBJECT: attendance_pct
//    and homework_completion_pct are inherently whole-student (attendance
//    isn't recorded per subject; homework spans a student's whole
//    course-load). avg_score is averaged across ALL of a student's recent
//    exam_marks within the lookback window (not just their most recent
//    single exam) — this is a deliberate simplification vs. the earlier
//    class-level design's "most recent exam only," and arguably a better
//    signal at student granularity (smooths over one unusually hard/easy
//    paper). subject_id is left NULL on these rows — an overall risk
//    signal isn't tied to one subject.
// 2. BASELINE: the school's own average for that metric across ALL
//    STUDENTS this week (a much larger, more stable sample than the
//    earlier per-class-average design).
// 3. "BELOW BASELINE" / "SUSTAINED": unchanged from the first pass — more
//    than 15 points/percentage-points under that average, sustained for
//    3 consecutive weekly runs on the SAME metric for the SAME student.
// 4. AI'S ROLE STAYS NARROW: the flagging decision is deterministic
//    threshold logic — auditable, reproducible, no hallucination risk on
//    "is this student actually struggling." Claude is called ONLY for
//    students who actually get flagged (a small fraction of the school,
//    keeping cost/latency down) to turn the confirmed numbers into a
//    one-sentence human-readable flag_reason. Falls back to a template
//    sentence if ANTHROPIC_API_KEY isn't configured or the call fails.
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

async function generateFlagReason(studentName, className, metricLabel, threeWeekValues, latest) {
  const fallback = `${studentName} (${className}) has been below the school average on ${metricLabel} for ${SUSTAINED_WEEKS}+ consecutive weeks — latest value ${latest}. Worth a check-in.`;
  if (!anthropic) return fallback;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 120,
      system:
        'You write one-to-two sentence at-risk-student alerts for a teacher/principal dashboard, in the style of ' +
        '"Attendance for this student has dropped to 62% and stayed there for 3+ consecutive weeks." ' +
        'State only what the numbers show — never speculate about causes not in the data, never suggest a specific ' +
        'intervention. Plain, factual, concise, and never alarmist.',
      messages: [
        {
          role: 'user',
          content: `Student: ${studentName}\nClass: ${className}\nMetric: ${metricLabel}\nLast ${SUSTAINED_WEEKS} weekly values: ${threeWeekValues.join(', ')}`,
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

  // Batch, set-based queries across ALL students at once — one query per
  // metric, not one query per student — so this stays reasonable at
  // school scale (thousands of students) instead of N-times-3 round trips.
  const [attendanceRes, homeworkRes, scoreRes, studentsRes] = await Promise.all([
    pool.query(
      `SELECT s.id AS student_id, s.school_id, s.class_id,
              ROUND(100.0 * SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS attendance_pct
       FROM students s
       JOIN attendance a ON a.student_id = s.id AND a.date >= $1 AND a.date <= $2
       GROUP BY s.id, s.school_id, s.class_id`,
      [start, end]
    ),
    pool.query(
      `SELECT s.id AS student_id,
              COUNT(DISTINCT h.id) AS hw_count,
              COUNT(DISTINCT hc.homework_id) AS completed_count
       FROM students s
       JOIN homework h ON h.class_id = s.class_id AND h.created_at >= $1 AND h.created_at <= $2
       LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = s.id
       GROUP BY s.id`,
      [start, end]
    ),
    pool.query(
      `SELECT em.student_id, ROUND(AVG(100.0 * em.marks_obtained / NULLIF(em.max_marks, 0)), 1) AS avg_score
       FROM exam_marks em
       JOIN exams e ON e.id = em.exam_id
       WHERE e.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY em.student_id`,
      [SCORE_LOOKBACK_DAYS]
    ),
    pool.query(`SELECT id AS student_id, school_id, class_id, name FROM students WHERE class_id IS NOT NULL`),
  ]);

  const attendanceByStudent = new Map(attendanceRes.rows.map((r) => [r.student_id, Number(r.attendance_pct)]));
  const homeworkByStudent = new Map();
  for (const r of homeworkRes.rows) {
    if (Number(r.hw_count) > 0) {
      homeworkByStudent.set(r.student_id, Math.round((Number(r.completed_count) / Number(r.hw_count)) * 1000) / 10);
    }
  }
  const scoreByStudent = new Map(scoreRes.rows.map((r) => [r.student_id, Number(r.avg_score)]));
  const studentInfo = new Map(studentsRes.rows.map((r) => [r.student_id, r]));

  // Only students with SOME data this week get a row at all.
  const computed = [];
  for (const [studentId, info] of studentInfo) {
    const metrics = {};
    if (attendanceByStudent.has(studentId)) metrics.attendance_pct = attendanceByStudent.get(studentId);
    if (homeworkByStudent.has(studentId)) metrics.homework_completion = homeworkByStudent.get(studentId);
    if (scoreByStudent.has(studentId)) metrics.avg_score = scoreByStudent.get(studentId);
    if (Object.keys(metrics).length === 0) continue;
    computed.push({ studentId, schoolId: info.school_id, classId: info.class_id, studentName: info.name, metrics });
  }

  // School-wide baseline per metric, computed across every student who has
  // that metric this week (much larger sample than the earlier per-class
  // design, so a more stable "normal for this school" reference point).
  const baselineSums = {}; // schoolId -> { metricKey: [values] }
  for (const row of computed) {
    if (!baselineSums[row.schoolId]) baselineSums[row.schoolId] = {};
    for (const key of ['attendance_pct', 'homework_completion', 'avg_score']) {
      if (row.metrics[key] === undefined) continue;
      (baselineSums[row.schoolId][key] ||= []).push(row.metrics[key]);
    }
  }
  const baselineAvg = {};
  for (const schoolId of Object.keys(baselineSums)) {
    baselineAvg[schoolId] = {};
    for (const key of Object.keys(baselineSums[schoolId])) {
      const vals = baselineSums[schoolId][key];
      baselineAvg[schoolId][key] = vals.reduce((s, v) => s + v, 0) / vals.length;
    }
  }

  const classNameCache = new Map();
  async function classNameFor(classId) {
    if (classNameCache.has(classId)) return classNameCache.get(classId);
    const { rows } = await pool.query('SELECT name FROM classes WHERE id = $1', [classId]);
    const name = rows[0]?.name || `Class ${classId}`;
    classNameCache.set(classId, name);
    return name;
  }

  let inserted = 0;
  let flagged = 0;
  for (const row of computed) {
    const schoolBaseline = baselineAvg[row.schoolId] || {};
    const belowBaseline = {};
    for (const key of ['attendance_pct', 'homework_completion', 'avg_score']) {
      if (row.metrics[key] === undefined || schoolBaseline[key] === undefined) continue;
      belowBaseline[key] = schoolBaseline[key] - row.metrics[key] >= BASELINE_GAP_THRESHOLD;
    }

    const priorRes = await pool.query(
      `SELECT metrics FROM performance_snapshots
       WHERE school_id = $1 AND student_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [row.schoolId, row.studentId, SUSTAINED_WEEKS - 1]
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
          const className = await classNameFor(row.classId);
          flagReason = await generateFlagReason(row.studentName, className, metricLabel, history, row.metrics[key]);
          isFlagged = true;
          break; // one reason is enough — a student rarely needs two separate drift alerts in the same week
        }
      }
    }

    const storedMetrics = { ...row.metrics, _below_baseline: belowBaseline };

    try {
      await pool.query(
        `INSERT INTO performance_snapshots (school_id, class_id, student_id, subject_id, period, metrics, flagged, flag_reason)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
        [row.schoolId, row.classId, row.studentId, label, JSON.stringify(storedMetrics), isFlagged, flagReason]
      );
      inserted += 1;
      if (isFlagged) flagged += 1;
    } catch (err) {
      console.error(`[performanceDriftWorker] Insert failed for student ${row.studentId}:`, err.message);
    }
  }

  console.log(`[performanceDriftWorker] Done — ${inserted} snapshots written, ${flagged} students flagged, week ${label}.`);
  return { inserted, flagged };
}

worker.on('failed', (job, err) => {
  console.error(`PerformanceDriftQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
