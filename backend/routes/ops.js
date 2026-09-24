import express from 'express';
import pool from '../config/db.js';
import * as queues from '../config/queue.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { audit, registerAction, runAction, hasAction } from '../services/opsService.js';
import { runHealthCheck } from '../workers/healthCheck.js';
import { buildDigestFacts, fallbackDigestLine } from '../workers/dailyDigestWorker.js';

const router = express.Router();
router.use(requireAuth, requireOperator);

// ------------------------------------------------------------------
// "Run now" is only offered for automations that are safe to re-run —
// ones that dedupe via their own *_log table / reminder_sent_at column,
// or have no side effects. daily_guidance and library_digest would
// re-send the same WhatsApp to every teacher/contact, and
// performance_drift's "3 consecutive weekly runs" logic would be skewed
// by an extra run, so they are excluded.
//
// Note: these workers are platform-wide (one job loops over every
// school), so a run triggered here runs for all schools. The cooldown
// stops one school's operator from hammering a shared job.
// ------------------------------------------------------------------
const RUN_NOW_ALLOWED = new Set([
  'gps_poll',
  'teacher_attendance_rollup',
  'fee_reminder',
  'petty_cash_reminder',
  'staff_leave_reminder',
  'teaching_reminder',
  'low_attendance_alert',
  'event_reminder',
  'weekly_progress_summary',
  'recurring_doubt',
  'ops_health_check',
  'ops_daily_digest',
]);
const RUN_NOW_COOLDOWN_MINUTES = 10;

const queueByName = new Map(
  Object.values(queues)
    .filter((q) => q && typeof q === 'object' && typeof q.add === 'function' && q.name)
    .map((q) => [q.name, q])
);

async function triggerRunNow(automationKey, user) {
  if (!RUN_NOW_ALLOWED.has(automationKey)) {
    const err = new Error('This automation cannot be run manually (it would re-send messages or skew its own statistics).');
    err.status = 400;
    throw err;
  }
  const reg = await pool.query('SELECT * FROM automation_registry WHERE automation_key = $1', [automationKey]);
  const row = reg.rows[0];
  if (!row) {
    const err = new Error('Unknown automation');
    err.status = 404;
    throw err;
  }
  // Health check is read-only and guards its own concurrency, so no cooldown.
  if (automationKey !== 'ops_health_check' && row.last_run_at && Date.now() - new Date(row.last_run_at) < RUN_NOW_COOLDOWN_MINUTES * 60 * 1000 && row.last_status === 'success') {
    const err = new Error(`It ran successfully less than ${RUN_NOW_COOLDOWN_MINUTES} minutes ago — no need to run it again yet.`);
    err.status = 429;
    throw err;
  }

  if (automationKey === 'ops_health_check') {
    const result = await runHealthCheck();
    await audit({ schoolId: user.school_id, actorType: 'user', actorId: user.teacher_id, action: 'automation.run_now', entityType: 'automation', detail: { automation_key: automationKey } });
    return { ran: true, result };
  }

  const queue = queueByName.get(row.queue_name);
  if (!queue || !row.job_name) {
    const err = new Error('This automation has no queue configured for manual runs.');
    err.status = 400;
    throw err;
  }
  const job = await queue.add(row.job_name, {}, { removeOnComplete: true, removeOnFail: 100 });
  await audit({ schoolId: user.school_id, actorType: 'user', actorId: user.teacher_id, action: 'automation.run_now', entityType: 'automation', detail: { automation_key: automationKey, job_id: job.id } });
  return { queued: true, job_id: job.id };
}

registerAction('automation.run_now', ({ params, user }) => triggerRunNow(params?.automation_key, user));

const sendError = (res, err) => res.status(err.status || 500).json({ error: err.message });

// Snoozed items whose snooze has expired count as open again everywhere.
const OPEN_SQL = `(status = 'open' OR (status = 'snoozed' AND snoozed_until <= NOW()))`;

// ---------- Overview ----------

router.get('/overview', async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const [exc, autos, integ, today] = await Promise.all([
      pool.query(
        `SELECT severity, COUNT(*)::int AS n FROM ops_exceptions WHERE school_id = $1 AND ${OPEN_SQL} GROUP BY severity`,
        [schoolId]
      ),
      pool.query(`SELECT automation_key, display_name, category, critical, expected_interval_minutes, last_run_at, last_status, last_success_at, last_error FROM automation_registry ORDER BY category, display_name`),
      pool.query(
        `SELECT DISTINCT ON (integration) integration, status, detail, checked_at, school_id
         FROM integration_health WHERE school_id = $1 OR school_id IS NULL
         ORDER BY integration, school_id NULLS LAST`,
        [schoolId]
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM attendance WHERE school_id = $1 AND date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND status = 'absent') AS absent_today,
           (SELECT COUNT(*)::int FROM notification_log nl JOIN attendance a ON a.id = nl.attendance_id
              WHERE a.school_id = $1 AND nl.type = 'whatsapp' AND (nl.sent_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND nl.status <> 'FAILED') AS alerts_sent_today,
           (SELECT COUNT(*)::int FROM notification_log nl JOIN attendance a ON a.id = nl.attendance_id
              WHERE a.school_id = $1 AND nl.type = 'whatsapp' AND (nl.sent_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND nl.status = 'FAILED') AS alerts_failed_today,
           (SELECT COALESCE(SUM(amount_paid), 0) FROM student_payment_history WHERE school_id = $1 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS fees_today,
           (SELECT COUNT(*)::int FROM ops_exceptions WHERE school_id = $1 AND status = 'resolved' AND (resolved_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS resolved_today`,
        [schoolId]
      ),
    ]);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of exc.rows) bySeverity[r.severity] = r.n;

    // Traffic light per automation: red = last run failed or stale;
    // amber = partial / never run; green = last run fine.
    const now = Date.now();
    const automations = autos.rows.map((a) => {
      const staleMs = a.expected_interval_minutes ? a.expected_interval_minutes * 1.5 * 60 * 1000 : null;
      const stale = staleMs && a.last_run_at ? now - new Date(a.last_run_at) > staleMs : false;
      let light = 'green';
      if (a.last_status === 'failed' || stale) light = 'red';
      else if (a.last_status === 'partial' || !a.last_run_at) light = 'amber';
      return { ...a, stale, light, can_run_now: RUN_NOW_ALLOWED.has(a.automation_key) };
    });

    res.json({
      exceptions: { ...bySeverity, total: Object.values(bySeverity).reduce((x, y) => x + y, 0) },
      automations,
      automation_summary: {
        green: automations.filter((a) => a.light === 'green').length,
        amber: automations.filter((a) => a.light === 'amber').length,
        red: automations.filter((a) => a.light === 'red').length,
      },
      integrations: integ.rows,
      today: { ...today.rows[0], fees_today: Number(today.rows[0].fees_today) },
    });
  } catch (err) {
    console.error('ops overview error:', err);
    res.status(500).json({ error: 'Failed to load Control Center overview' });
  }
});

// ---------- Automations ----------

router.get('/automations/:key/runs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const reg = await pool.query('SELECT * FROM automation_registry WHERE automation_key = $1', [req.params.key]);
    if (reg.rowCount === 0) return res.status(404).json({ error: 'Unknown automation' });
    const runs = await pool.query(
      `SELECT id, school_id, status, started_at, finished_at, items_total, items_succeeded, items_failed, error_summary
       FROM automation_runs
       WHERE automation_key = $1 AND (school_id IS NULL OR school_id = $2)
       ORDER BY started_at DESC LIMIT $3`,
      [req.params.key, req.user.school_id, limit]
    );
    const stats = await pool.query(
      `SELECT COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'success')::int AS ok
       FROM automation_runs
       WHERE automation_key = $1 AND (school_id IS NULL OR school_id = $2) AND started_at > NOW() - INTERVAL '7 days'`,
      [req.params.key, req.user.school_id]
    );
    res.json({
      automation: { ...reg.rows[0], can_run_now: RUN_NOW_ALLOWED.has(req.params.key) },
      runs: runs.rows,
      stats_7d: stats.rows[0],
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/automations/:key/run-now', async (req, res) => {
  try {
    res.json(await triggerRunNow(req.params.key, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- Exceptions ----------

router.get('/exceptions', async (req, res) => {
  const { status = 'open', severity, source, cursor } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = ['school_id = $1'];
  const params = [req.user.school_id];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (status === 'open') where.push(OPEN_SQL);
  else if (status === 'snoozed') where.push(`status = 'snoozed' AND snoozed_until > NOW()`);
  else if (['resolved', 'dismissed'].includes(status)) add('status = ?', status);
  else if (status !== 'all') return res.status(400).json({ error: 'invalid status' });
  if (severity) add('severity = ?', severity);
  if (source) add('source = ?', source);
  if (cursor) add('id < ?', Number(cursor));

  try {
    const r = await pool.query(
      `SELECT * FROM ops_exceptions WHERE ${where.join(' AND ')}
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                id DESC
       LIMIT ${limit + 1}`,
      params
    );
    const items = r.rows.slice(0, limit).map((row) => ({
      ...row,
      action_available: !!(row.suggested_action?.action && hasAction(row.suggested_action.action)),
    }));
    const sources = await pool.query(
      `SELECT source, COUNT(*)::int AS n FROM ops_exceptions WHERE school_id = $1 AND ${OPEN_SQL} GROUP BY source ORDER BY n DESC`,
      [req.user.school_id]
    );
    // Severity-first ordering means id-cursor paging is approximate; fine
    // for an inbox that should rarely have more than a page of open items.
    res.json({ items, next_cursor: r.rows.length > limit ? items[items.length - 1].id : null, sources: sources.rows });
  } catch (err) {
    sendError(res, err);
  }
});

async function loadOwnException(req) {
  const r = await pool.query('SELECT * FROM ops_exceptions WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
  if (r.rowCount === 0) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

async function closeException(req, res, newStatus) {
  try {
    const exc = await loadOwnException(req);
    if (!['open', 'snoozed'].includes(exc.status)) return res.status(409).json({ error: `Already ${exc.status}` });
    const r = await pool.query(
      `UPDATE ops_exceptions SET status = $1, resolved_by = $2, resolved_at = NOW(), resolution_note = $3
       WHERE id = $4 RETURNING *`,
      [newStatus, req.user.teacher_id || null, req.body?.note || null, exc.id]
    );
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: `exception.${newStatus}`, entityType: 'ops_exception', entityId: exc.id, detail: { note: req.body?.note || null, title: exc.title } });
    res.json(r.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
}

router.post('/exceptions/:id/resolve', (req, res) => closeException(req, res, 'resolved'));
router.post('/exceptions/:id/dismiss', (req, res) => closeException(req, res, 'dismissed'));

router.post('/exceptions/:id/snooze', async (req, res) => {
  const hours = Number(req.body?.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 14) return res.status(400).json({ error: 'hours must be between 0 and 336' });
  try {
    const exc = await loadOwnException(req);
    if (!['open', 'snoozed'].includes(exc.status)) return res.status(409).json({ error: `Already ${exc.status}` });
    const r = await pool.query(
      `UPDATE ops_exceptions SET status = 'snoozed', snoozed_until = NOW() + make_interval(hours => $1::int) WHERE id = $2 RETURNING *`,
      [Math.round(hours), exc.id]
    );
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'exception.snoozed', entityType: 'ops_exception', entityId: exc.id, detail: { hours } });
    res.json(r.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/exceptions/:id/action', async (req, res) => {
  try {
    const exc = await loadOwnException(req);
    const action = exc.suggested_action?.action;
    if (!action) return res.status(400).json({ error: 'This item has no one-click action' });
    const result = await runAction(action, { params: exc.suggested_action.params || {}, user: req.user, exception: exc });
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: `exception.action.${action}`, entityType: 'ops_exception', entityId: exc.id, detail: { result } });
    res.json({ ok: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- Audit ----------

router.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [req.user.school_id];
  const where = ['school_id = $1'];
  if (req.query.action) {
    params.push(`${req.query.action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (req.query.cursor) {
    params.push(Number(req.query.cursor));
    where.push(`id < $${params.length}`);
  }
  try {
    const r = await pool.query(
      `SELECT a.*, t.name AS actor_name FROM audit_log a
       LEFT JOIN teachers t ON a.actor_type = 'user' AND t.id = a.actor_id
       WHERE ${where.map((w) => 'a.' + w).join(' AND ')}
       ORDER BY a.id DESC LIMIT ${limit + 1}`,
      params
    );
    const items = r.rows.slice(0, limit);
    res.json({ items, next_cursor: r.rows.length > limit ? items[items.length - 1].id : null });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- Digest settings & preview ----------

router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT operator_digest_phone, principal_digest_phone, COALESCE(digest_enabled, TRUE) AS digest_enabled, COALESCE(digest_language, 'hinglish') AS digest_language
       FROM school_settings WHERE school_id = $1`,
      [req.user.school_id]
    );
    res.json(r.rows[0] || { operator_digest_phone: null, principal_digest_phone: null, digest_enabled: true, digest_language: 'hinglish' });
  } catch (err) {
    sendError(res, err);
  }
});

function normalizePhone(p) {
  if (p == null || p === '') return null;
  const digits = String(p).replace(/\D/g, '');
  // Same +91XXXXXXXXXX format academics.js stores staff phones in.
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return undefined; // invalid
}

router.put('/settings', async (req, res) => {
  const { operator_digest_phone, principal_digest_phone, digest_enabled, digest_language } = req.body || {};
  const op = normalizePhone(operator_digest_phone);
  const pr = normalizePhone(principal_digest_phone);
  if (op === undefined || pr === undefined) return res.status(400).json({ error: 'Phone numbers must be valid Indian mobile numbers (10 digits, optionally with +91)' });
  if (digest_language && !['en', 'hinglish'].includes(digest_language)) return res.status(400).json({ error: 'digest_language must be en or hinglish' });
  try {
    await pool.query(
      `INSERT INTO school_settings (school_id, operator_digest_phone, principal_digest_phone, digest_enabled, digest_language)
       VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, 'hinglish'))
       ON CONFLICT (school_id) DO UPDATE SET
         operator_digest_phone = EXCLUDED.operator_digest_phone,
         principal_digest_phone = EXCLUDED.principal_digest_phone,
         digest_enabled = EXCLUDED.digest_enabled,
         digest_language = EXCLUDED.digest_language,
         updated_at = NOW()`,
      [req.user.school_id, op, pr, typeof digest_enabled === 'boolean' ? digest_enabled : null, digest_language || null]
    );
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'ops.settings_updated' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Shows exactly what tomorrow's digest would say, without sending it.
router.get('/digest/preview', async (req, res) => {
  try {
    const facts = await buildDigestFacts(req.user.school_id);
    const s = await pool.query(`SELECT COALESCE(digest_language, 'hinglish') AS lang FROM school_settings WHERE school_id = $1`, [req.user.school_id]);
    res.json({ facts, line: fallbackDigestLine(facts, s.rows[0]?.lang || 'hinglish') });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
