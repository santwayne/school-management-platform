import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit, registerAction } from '../services/opsService.js';
import { runEarlyWarningForSchool, notifyClassTeachers, teachersNotifiedAt } from '../services/earlyWarning.js';
import { buildPlanForSchool, getPlan, sendPlanWhatsApp } from '../services/dailyPlan.js';
import { NotesError, listNotes, editNote, decideNotes, listConsent, setConsent, draftNotesForSchool, notesSettings, approvalScope } from '../services/progressNotes.js';
import { teacherSignals, istToday } from '../utils/aiAutomation.js';

// AI automation roadmap, phases 1–2:
//   /attention  — A1 weekly early-warning list (principal/operator: all; class teacher: own class)
//   /plan       — B1 principal's daily plan (principal/operator)
//   /notes      — A2 parent progress notes: approval screen + consent (principal/operator; class teacher for own class)
//   /settings, /metrics — switches and "is it working" numbers (principal/operator)

const router = express.Router();
router.use(requireAuth);

const isOperator = (u) => ['principal', 'operator'].includes(u?.role);
const operatorOnly = (req, res, next) => (isOperator(req.user) ? next() : res.status(403).json({ error: 'Principal or operator only' }));
const staffOnly = (req, res, next) => (isOperator(req.user) || req.user?.role === 'teacher' ? next() : res.status(403).json({ error: 'Staff only' }));
const PERIOD_RE = /^\d{4}-W\d{2}$/;

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof NotesError || (err.status && err.status < 500)) return res.status(err.status).json({ error: err.message });
    console.error('[ai-automation] route error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// A heavy "do it now" button may be pressed once per school per 10 minutes.
async function cooldown(schoolId, action, minutes = 10) {
  const r = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = $2 AND created_at > NOW() - make_interval(mins => $3)`,
    [schoolId, action, minutes]
  );
  if (r.rowCount) {
    const err = new Error(`This was run less than ${minutes} minutes ago — please wait a little.`);
    err.status = 429;
    throw err;
  }
}

registerAction('attention.notify_teachers', ({ params, user }) => {
  if (!PERIOD_RE.test(params?.period || '')) {
    const err = new Error('Unknown week');
    err.status = 400;
    throw err;
  }
  return notifyClassTeachers(user.school_id, params.period, user);
});

// ---------- A1: needs attention ----------

async function teacherClassIds(user) {
  const r = await pool.query('SELECT id FROM classes WHERE school_id = $1 AND class_teacher_id = $2', [user.school_id, user.teacher_id]);
  return r.rows.map((x) => x.id);
}

router.get('/attention', staffOnly, wrap(async (req, res) => {
  const all = isOperator(req.user);
  const classIds = all ? [] : await teacherClassIds(req.user);
  if (!all && !classIds.length) return res.json({ period: null, periods: [], flags: [], class_teacher: false });
  const periods = await pool.query(
    `SELECT period, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM student_attention_flags
      WHERE school_id = $1 AND ($2::boolean OR class_id = ANY($3::int[])) GROUP BY period ORDER BY period DESC LIMIT 12`,
    [req.user.school_id, all, classIds]
  );
  const period = PERIOD_RE.test(req.query.period || '') ? req.query.period : periods.rows[0]?.period || null;
  const { rows } = await pool.query(
    `SELECT f.id, f.student_id, s.name AS student_name, c.name AS class_name, f.class_id, f.period, f.score, f.signals, f.reason, f.first_step,
            f.status, f.action_note, f.decided_at, t.name AS decided_by_name
       FROM student_attention_flags f JOIN students s ON s.id = f.student_id LEFT JOIN classes c ON c.id = f.class_id
       LEFT JOIN teachers t ON t.id = f.decided_by
      WHERE f.school_id = $1 AND f.period = $2 AND ($3::boolean OR f.class_id = ANY($4::int[]))
        AND ($5::text IS NULL OR f.status = $5) AND ($6::int IS NULL OR f.class_id = $6)
      ORDER BY (f.status = 'open') DESC, f.score DESC, s.name`,
    [req.user.school_id, period, all, classIds, req.query.status || null, Number(req.query.class_id) || null]
  );
  res.json({
    period,
    periods: periods.rows,
    class_teacher: !all,
    teachers_notified_at: all && period ? await teachersNotifiedAt(req.user.school_id, period) : null,
    flags: rows.map((f) => ({ ...f, signals: all ? f.signals : teacherSignals(f.signals) })),
  });
}));

router.post('/attention/:id/decision', staffOnly, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['acted', 'false_alarm', 'dismissed', 'open'].includes(status)) return res.status(400).json({ error: 'status must be acted, false_alarm, dismissed or open' });
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  const all = isOperator(req.user);
  const classIds = all ? [] : await teacherClassIds(req.user);
  const r = await pool.query(
    `UPDATE student_attention_flags SET status = $3::varchar, action_note = $4, decided_by = $5, decided_at = CASE WHEN $3::varchar = 'open' THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = $1 AND school_id = $2 AND ($6::boolean OR class_id = ANY($7::int[])) RETURNING id, status`,
    [req.params.id, req.user.school_id, status, note, req.user.teacher_id, all, classIds]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: `ai.attention_${status}`, entityType: 'student_attention_flag', entityId: Number(req.params.id) });
  res.json(r.rows[0]);
}));

router.post('/attention/notify-teachers', operatorOnly, wrap(async (req, res) => {
  if (!PERIOD_RE.test(req.body?.period || '')) return res.status(400).json({ error: 'period is required (e.g. 2026-W42)' });
  res.json(await notifyClassTeachers(req.user.school_id, req.body.period, req.user));
}));

router.post('/attention/run', operatorOnly, wrap(async (req, res) => {
  await cooldown(req.user.school_id, 'ai.early_warning');
  res.json(await runEarlyWarningForSchool(req.user.school_id));
}));

// ---------- B1: daily plan ----------

router.get('/plan', operatorOnly, wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : istToday();
  res.json({ date, plan: await getPlan(req.user.school_id, date) });
}));

// Builds today's plan on demand (no WhatsApp — that goes out with the
// 7:30 AM run, or via POST /plan/send). force=true rebuilds it from the latest data.
router.post('/plan/generate', operatorOnly, wrap(async (req, res) => {
  // Only manual rebuilds are rate-limited, so a refresh right after the
  // morning run (e.g. after approving something) still works.
  if (req.body?.force) {
    await cooldown(req.user.school_id, 'ai.daily_plan_rebuilt', 5);
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'ai.daily_plan_rebuilt' });
  }
  const out = await buildPlanForSchool(req.user.school_id, { force: Boolean(req.body?.force), send: false });
  res.json(out);
}));

// Sends today's plan to the principal/operator WhatsApp numbers now — to
// confirm delivery without waiting for 7:30 AM. Builds the plan first if
// there is none yet. The per-number result is shown on the plan card.
router.post('/plan/send', operatorOnly, wrap(async (req, res) => {
  await cooldown(req.user.school_id, 'ai.daily_plan_sent_manually', 5);
  const date = istToday();
  if (!(await getPlan(req.user.school_id, date))) await buildPlanForSchool(req.user.school_id, { send: false });
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'ai.daily_plan_sent_manually' });
  const out = await sendPlanWhatsApp(req.user.school_id, date);
  res.json({ ...out, plan: await getPlan(req.user.school_id, date) });
}));

router.post('/plan/items/:key/feedback', operatorOnly, wrap(async (req, res) => {
  const feedback = req.body?.feedback;
  if (!['done', 'not_useful', null].includes(feedback ?? null)) return res.status(400).json({ error: 'feedback must be done or not_useful' });
  const date = istToday();
  const plan = await getPlan(req.user.school_id, date);
  if (!plan) return res.status(404).json({ error: 'No plan for today' });
  const items = plan.items.map(({ action_status, action_result, ...i }) => (i.key === req.params.key ? { ...i, feedback: feedback ?? undefined } : i));
  if (!items.some((i) => i.key === req.params.key)) return res.status(404).json({ error: 'Item not found' });
  await pool.query('UPDATE principal_daily_plans SET items = $3 WHERE school_id = $1 AND plan_date = $2', [req.user.school_id, date, JSON.stringify(items)]);
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'ai.daily_plan_feedback', detail: { key: req.params.key, feedback } });
  res.json({ ok: true });
}));

// ---------- A2: parent progress notes ----------

router.get('/notes/classes', staffOnly, wrap(async (req, res) => {
  const scope = await approvalScope(req.user);
  const { rows } = await pool.query(
    `SELECT id, name FROM classes WHERE school_id = $1 AND ($2::boolean OR id = ANY($3::int[])) ORDER BY name`,
    [req.user.school_id, scope.all, scope.classIds || []]
  );
  res.json({ classes: rows, settings: await notesSettings(req.user.school_id), can_approve: scope.all || scope.canApprove });
}));

router.get('/notes', staffOnly, wrap(async (req, res) => {
  res.json(await listNotes(req.user, {
    period: PERIOD_RE.test(req.query.period || '') ? req.query.period : null,
    status: ['draft', 'approved', 'rejected', 'sending', 'sent', 'failed', 'expired'].includes(req.query.status) ? req.query.status : null,
    classId: Number(req.query.class_id) || null,
  }));
}));

router.patch('/notes/:id', staffOnly, wrap(async (req, res) => {
  res.json(await editNote(req.user, Number(req.params.id), req.body?.note));
}));

router.post('/notes/approve', staffOnly, wrap(async (req, res) => {
  res.json(await decideNotes(req.user, req.body?.ids, true));
}));

router.post('/notes/reject', staffOnly, wrap(async (req, res) => {
  res.json(await decideNotes(req.user, req.body?.ids, false));
}));

router.get('/notes/consent', staffOnly, wrap(async (req, res) => {
  if (!Number(req.query.class_id)) return res.status(400).json({ error: 'class_id is required' });
  res.json(await listConsent(req.user, Number(req.query.class_id)));
}));

router.post('/notes/consent', staffOnly, wrap(async (req, res) => {
  res.json(await setConsent(req.user, req.body?.parent_ids, req.body?.consent));
}));

router.post('/notes/draft-now', operatorOnly, wrap(async (req, res) => {
  await cooldown(req.user.school_id, 'ai.progress_notes_drafted');
  res.json(await draftNotesForSchool(req.user.school_id));
}));

// ---------- settings & metrics ----------

router.get('/settings', operatorOnly, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT COALESCE(early_warning_enabled, TRUE) AS early_warning_enabled, COALESCE(daily_plan_enabled, TRUE) AS daily_plan_enabled
       FROM school_settings WHERE school_id = $1`,
    [req.user.school_id]
  );
  const notes = await notesSettings(req.user.school_id);
  res.json({
    early_warning_enabled: r.rows[0]?.early_warning_enabled ?? true,
    daily_plan_enabled: r.rows[0]?.daily_plan_enabled ?? true,
    progress_notes_enabled: notes.enabled,
    progress_notes_consent_mode: notes.consent_mode,
    progress_notes_approver: notes.approver,
    progress_notes_language: notes.language,
  });
}));

router.put('/settings', operatorOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  const pick = (v, allowed) => (allowed.includes(v) ? v : null);
  if (b.progress_notes_consent_mode && !pick(b.progress_notes_consent_mode, ['explicit', 'opt_out'])) return res.status(400).json({ error: 'consent mode must be explicit or opt_out' });
  if (b.progress_notes_approver && !pick(b.progress_notes_approver, ['class_teacher', 'principal'])) return res.status(400).json({ error: 'approver must be class_teacher or principal' });
  if (b.progress_notes_language && !pick(b.progress_notes_language, ['parent', 'en', 'hinglish'])) return res.status(400).json({ error: 'language must be parent, en or hinglish' });
  await pool.query(
    `INSERT INTO school_settings (school_id) VALUES ($1) ON CONFLICT (school_id) DO NOTHING`,
    [req.user.school_id]
  );
  await pool.query(
    `UPDATE school_settings SET
       early_warning_enabled = COALESCE($2, early_warning_enabled),
       daily_plan_enabled = COALESCE($3, daily_plan_enabled),
       progress_notes_enabled = COALESCE($4, progress_notes_enabled),
       progress_notes_consent_mode = COALESCE($5, progress_notes_consent_mode),
       progress_notes_approver = COALESCE($6, progress_notes_approver),
       progress_notes_language = COALESCE($7, progress_notes_language)
     WHERE school_id = $1`,
    [req.user.school_id, bool(b.early_warning_enabled), bool(b.daily_plan_enabled), bool(b.progress_notes_enabled),
      pick(b.progress_notes_consent_mode, ['explicit', 'opt_out']), pick(b.progress_notes_approver, ['class_teacher', 'principal']), pick(b.progress_notes_language, ['parent', 'en', 'hinglish'])]
  );
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'ai.automation_settings', detail: b });
  res.json({ ok: true });
}));

// The roadmap's "how we will know it works" numbers, last 8 weeks / 30 days.
router.get('/metrics', operatorOnly, wrap(async (req, res) => {
  const s = req.user.school_id;
  const [flags, plan, planFeedback, notes, consent] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'acted')::int AS acted, COUNT(*) FILTER (WHERE status = 'false_alarm')::int AS false_alarm,
              COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed, COUNT(*) FILTER (WHERE status = 'open')::int AS open
         FROM student_attention_flags WHERE school_id = $1 AND created_at > NOW() - INTERVAL '56 days'`, [s]),
    // Withdrawn proposals (replaced by a rebuilt plan) were never shown long
    // enough to judge, so they are left out of the rate.
    pool.query(
      `SELECT COUNT(*)::int AS proposed, COUNT(*) FILTER (WHERE status = 'approved')::int AS approved, COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM assistant_actions WHERE school_id = $1 AND source = 'daily_plan' AND created_at > NOW() - INTERVAL '30 days'
          AND COALESCE(result, '') NOT LIKE 'Withdrawn:%'`, [s]),
    pool.query(
      `SELECT COUNT(*)::int AS items, COUNT(*) FILTER (WHERE i->>'feedback' = 'done')::int AS done, COUNT(*) FILTER (WHERE i->>'feedback' = 'not_useful')::int AS not_useful
         FROM principal_daily_plans p CROSS JOIN LATERAL jsonb_array_elements(p.items) i WHERE p.school_id = $1 AND p.plan_date > CURRENT_DATE - 30`, [s]),
    pool.query(`SELECT status, COUNT(*)::int AS n FROM parent_progress_notes WHERE school_id = $1 AND created_at > NOW() - INTERVAL '56 days' GROUP BY status`, [s]),
    pool.query(`SELECT ai_notes_consent AS consent, COUNT(*)::int AS n FROM parents WHERE school_id = $1 GROUP BY ai_notes_consent`, [s]),
  ]);
  const f = flags.rows[0];
  const decided = f.acted + f.false_alarm + f.dismissed;
  res.json({
    early_warning: { ...f, action_rate: decided ? Math.round((100 * f.acted) / decided) : null, false_alarm_rate: decided ? Math.round((100 * f.false_alarm) / decided) : null },
    daily_plan: { ...plan.rows[0], ...planFeedback.rows[0], approval_rate: plan.rows[0].proposed ? Math.round((100 * plan.rows[0].approved) / plan.rows[0].proposed) : null },
    progress_notes: Object.fromEntries(notes.rows.map((r) => [r.status, r.n])),
    consent: Object.fromEntries(consent.rows.map((r) => [r.consent, r.n])),
  });
}));

export default router;
