import pool from '../config/db.js';
import { getCurrentAcademicYearStart, TUITION_ONLY_FILTER } from '../utils/academicYear.js';
import { scoreStudent, teacherSignals, fallbackReason, fallbackFirstStep, isoWeekLabel, istToday, noteProblems } from '../utils/aiAutomation.js';
import { askJSON, makeBudget } from './aiText.js';
import { raiseException, autoResolve, audit } from './opsService.js';
import { AI_SCHOOLS_SQL } from './schoolPlans.js';

// A1 — weekly "needs attention" list.
//
// Combines attendance, marks, homework, leave, the AI tutor's notes and
// (principal-only) fee context into one score per student. The decision to
// flag is pure rules (utils/aiAutomation.js scoreStudent) so it is auditable;
// Claude only turns the evidence into one plain sentence and a suggested
// first step. Flags land on the Control Center as one summary item per week,
// and each class teacher sees their own class's flags in the Teacher Portal.

const AI_CALLS_PER_SCHOOL = Number(process.env.EARLY_WARNING_AI_LIMIT) || 60;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

export async function gatherFacts(schoolId, today) {
  const yearStart = await getCurrentAcademicYearStart();
  const [students, att, prior, marks, hw, leave, learning, fees] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.class_id, c.name AS class_name
         FROM students s JOIN classes c ON c.id = s.class_id
        WHERE s.school_id = $1 AND COALESCE(s.is_demo, FALSE) = FALSE`,
      [schoolId]
    ),
    // Last 14 days, row by row — also gives the absence streak.
    pool.query(
      `SELECT student_id, date::text AS date, status FROM attendance
        WHERE school_id = $1 AND date > $2::date - 14 AND date <= $2::date ORDER BY student_id, date DESC`,
      [schoolId, today]
    ),
    pool.query(
      `SELECT student_id, COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present, COUNT(*)::int AS total
         FROM attendance WHERE school_id = $1 AND date > $2::date - 42 AND date <= $2::date - 14 GROUP BY student_id`,
      [schoolId, today]
    ),
    // One percentage per student per exam, then averaged by period.
    pool.query(
      `WITH per_exam AS (
         SELECT m.student_id, COALESCE(e.exam_date, e.created_at::date) AS d,
                100.0 * SUM(m.marks_obtained) / NULLIF(SUM(m.max_marks), 0) AS p
           FROM exam_marks m JOIN exams e ON e.id = m.exam_id
          WHERE m.school_id = $1 AND COALESCE(e.exam_date, e.created_at::date) > $2::date - 180
          GROUP BY m.student_id, e.id)
       SELECT student_id,
              AVG(p) FILTER (WHERE d > $2::date - 45) AS recent,
              AVG(p) FILTER (WHERE d <= $2::date - 45) AS prior
         FROM per_exam GROUP BY student_id`,
      [schoolId, today]
    ),
    pool.query(
      `SELECT s.id AS student_id, COUNT(DISTINCT h.id)::int AS assigned, COUNT(DISTINCT hc.homework_id)::int AS completed
         FROM students s
         JOIN homework h ON h.class_id = s.class_id AND h.shared_at IS NOT NULL AND h.shared_at::date > $2::date - 14
         LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = s.id
        WHERE s.school_id = $1 GROUP BY s.id`,
      [schoolId, today]
    ),
    pool.query(
      `SELECT student_id, COUNT(*)::int AS n FROM student_leave_requests
        WHERE school_id = $1 AND created_at::date > $2::date - 30 GROUP BY student_id`,
      [schoolId, today]
    ),
    pool.query(
      `SELECT student_id, jsonb_array_length(struggles)::int AS n FROM student_learning_profiles
        WHERE school_id = $1 AND updated_at::date > $2::date - 30`,
      [schoolId, today]
    ),
    pool.query(
      `SELECT s.id AS student_id, fs.amount - COALESCE(p.paid, 0) AS due,
              ($3::date - COALESCE(p.last_paid, $4::date))::int AS days_since_payment
         FROM students s
         JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
         LEFT JOIN LATERAL (
           SELECT SUM(h.amount_paid) AS paid, MAX(h.created_at)::date AS last_paid FROM student_payment_history h
            WHERE h.student_id = s.id AND h.school_id = s.school_id AND h.created_at >= $2
              AND ${TUITION_ONLY_FILTER.replace(/remarks/g, 'h.remarks')}) p ON TRUE
        WHERE s.school_id = $1`,
      [schoolId, yearStart, today, yearStart]
    ),
  ]);

  const facts = new Map();
  for (const s of students.rows) {
    facts.set(s.id, { student: s, att_recent: { present: 0, total: 0 }, att_prior: { present: 0, total: 0 }, absence_streak: 0, hw: { assigned: 0, completed: 0 } });
  }
  const streakOpen = new Set();
  for (const r of att.rows) {
    const f = facts.get(r.student_id);
    if (!f) continue;
    f.att_recent.total += 1;
    if (r.status === 'present' || r.status === 'late') f.att_recent.present += 1;
    // Rows come newest first: count absences until the first present day.
    if (!streakOpen.has(r.student_id)) {
      if (r.status === 'absent') f.absence_streak += 1;
      else streakOpen.add(r.student_id);
    }
  }
  for (const r of prior.rows) if (facts.has(r.student_id)) facts.get(r.student_id).att_prior = { present: r.present, total: r.total };
  for (const r of marks.rows) {
    const f = facts.get(r.student_id);
    if (!f) continue;
    f.marks_recent_pct = r.recent === null ? null : Number(r.recent);
    f.marks_prior_pct = r.prior === null ? null : Number(r.prior);
  }
  for (const r of hw.rows) if (facts.has(r.student_id)) facts.get(r.student_id).hw = { assigned: r.assigned, completed: r.completed };
  for (const r of leave.rows) if (facts.has(r.student_id)) facts.get(r.student_id).leaves_30d = r.n;
  for (const r of learning.rows) if (facts.has(r.student_id)) facts.get(r.student_id).struggles = r.n;
  for (const r of fees.rows) if (facts.has(r.student_id)) facts.get(r.student_id).fee = { due: Number(r.due), days_since_payment: r.days_since_payment };
  return facts;
}

async function phrase(f, scored, budget) {
  const shown = teacherSignals(scored.signals);
  const fallback = { reason: fallbackReason(firstName(f.student.name), scored.signals), first_step: fallbackFirstStep(scored.signals) };
  const out = await askJSON({
    budget,
    maxTokens: 300,
    system:
      'You help a school teacher notice a student who may need support. From the evidence given, write ' +
      '{"reason":"one or two plain sentences, max 220 characters, saying what the evidence shows","first_step":"one practical, kind first thing the teacher could do this week, max 160 characters"}. ' +
      'Use ONLY the evidence; never guess causes (family, health, behaviour) and never use labels like weak, lazy or poor. Refer to the student by first name.',
    payload: { first_name: firstName(f.student.name), class: f.student.class_name, evidence: shown.map((s) => ({ signal: s.label, evidence: s.evidence })) },
  });
  if (!out) return { ...fallback, by: 'rules' };
  const reason = String(out.reason || '').trim().slice(0, 300);
  const step = String(out.first_step || '').trim().slice(0, 220);
  if (!reason || noteProblems(reason).length || (step && noteProblems(step).length)) return { ...fallback, by: 'rules' };
  return { reason, first_step: step || fallback.first_step, by: 'ai' };
}

export async function runEarlyWarningForSchool(schoolId, { today = istToday() } = {}) {
  const period = isoWeekLabel(today);
  const facts = await gatherFacts(schoolId, today);
  const budget = makeBudget(AI_CALLS_PER_SCHOOL);
  const flagged = [];

  for (const f of facts.values()) {
    const scored = scoreStudent(f);
    if (!scored.flagged) continue;
    const text = await phrase(f, scored, budget);
    flagged.push({ f, scored, text });
  }
  flagged.sort((a, b) => b.scored.score - a.scored.score);

  // Decided rows (acted / false alarm / dismissed) are never overwritten; an
  // open row from an earlier run this week is refreshed or removed.
  const ids = flagged.map((x) => x.f.student.id);
  await pool.query(
    `DELETE FROM student_attention_flags WHERE school_id = $1 AND period = $2 AND status = 'open' AND NOT (student_id = ANY($3::int[]))`,
    [schoolId, period, ids]
  );
  for (const { f, scored, text } of flagged) {
    await pool.query(
      `INSERT INTO student_attention_flags (school_id, student_id, class_id, period, score, signals, reason, first_step)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (student_id, period) DO UPDATE SET score = EXCLUDED.score, signals = EXCLUDED.signals,
         reason = EXCLUDED.reason, first_step = EXCLUDED.first_step, class_id = EXCLUDED.class_id
       WHERE student_attention_flags.status = 'open'`,
      [schoolId, f.student.id, f.student.class_id, period, scored.score, JSON.stringify(scored.signals), text.reason, text.first_step]
    );
  }

  const dedupeKey = `early_warning:${period}`;
  if (flagged.length) {
    const top = flagged.slice(0, 5).map((x) => `${x.f.student.name} (${x.f.student.class_name})`).join(', ');
    await raiseException({
      schoolId,
      source: 'early_warning',
      severity: flagged.some((x) => x.scored.score >= 5) ? 'high' : 'medium',
      title: `${flagged.length} student${flagged.length === 1 ? '' : 's'} may need attention this week`,
      body: `Based on attendance, marks, homework and tutor notes. Top of the list: ${top}. Open Control Center → Needs attention for the evidence and a suggested first step for each.`,
      entityType: 'attention_week',
      suggestedAction: { label: 'Tell the class teachers', action: 'attention.notify_teachers', params: { period } },
      dedupeKey,
    });
  } else {
    await autoResolve(dedupeKey, { schoolId, note: 'No student crossed the threshold this week' });
  }
  await audit({ schoolId, action: 'ai.early_warning', detail: { period, students_checked: facts.size, flagged: flagged.length, ai_phrased: flagged.filter((x) => x.text.by === 'ai').length } });
  return { period, checked: facts.size, flagged: flagged.length };
}

export async function runEarlyWarning() {
  const schools = await pool.query(
    `SELECT s.id FROM schools s LEFT JOIN school_settings ss ON ss.school_id = s.id
      WHERE s.status = 'active' AND COALESCE(ss.early_warning_enabled, TRUE) = TRUE AND ${AI_SCHOOLS_SQL}`
  );
  let processed = 0;
  let failed = 0;
  let flagged = 0;
  for (const s of schools.rows) {
    try {
      const r = await runEarlyWarningForSchool(s.id);
      flagged += r.flagged;
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[early warning] school ${s.id} failed:`, err.message);
    }
  }
  return { processed, failed, flagged };
}

// Class teachers get an in-app notice listing how many of their students
// were flagged. Staff only — nothing goes to parents.
export async function notifyClassTeachers(schoolId, period, user) {
  const { rows } = await pool.query(
    `SELECT c.class_teacher_id AS teacher_id, c.name AS class_name, COUNT(*)::int AS n
       FROM student_attention_flags f JOIN classes c ON c.id = f.class_id
      WHERE f.school_id = $1 AND f.period = $2 AND f.status = 'open' AND c.class_teacher_id IS NOT NULL
      GROUP BY c.class_teacher_id, c.name`,
    [schoolId, period]
  );
  for (const r of rows) {
    await pool.query(
      `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body, link)
       VALUES ($1, 'attention_list', 'staff', $2, 'dashboard', $3, $4, '/teacher/attention')`,
      [schoolId, r.teacher_id, `${r.n} student${r.n === 1 ? '' : 's'} in ${r.class_name} may need attention`, 'See the evidence and a suggested first step, then mark what you did.']
    );
  }
  const orphan = await pool.query(
    `SELECT COUNT(*)::int AS n FROM student_attention_flags f LEFT JOIN classes c ON c.id = f.class_id
      WHERE f.school_id = $1 AND f.period = $2 AND f.status = 'open' AND c.class_teacher_id IS NULL`,
    [schoolId, period]
  );
  await audit({ schoolId, actorType: 'user', actorId: user?.teacher_id, action: 'ai.attention_teachers_notified', detail: { period, teachers: rows.length } });
  return { teachers_notified: rows.length, students_without_class_teacher: orphan.rows[0].n };
}
