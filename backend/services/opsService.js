import pool from '../config/db.js';

// ------------------------------------------------------------------
// Operator Control Center — shared plumbing.
//
// Every automation (BullMQ worker, inline send, AI step) reports here so
// that "did it run, did it work" is answerable from one screen, and every
// case an automation could not finish becomes an ops_exceptions row the
// operator clears. Nothing in here may throw into a caller's happy path:
// observability failing must never break the thing being observed, so all
// public functions catch and log their own errors.
// ------------------------------------------------------------------

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// ---------- Pure helpers (unit-tested in tests/opsService.test.js) ----------

// Workers return a mix of shapes today: { sent, failed }, { sent, failed,
// skipped }, { processed }, { flagged }, a number, or nothing. Normalise to
// { total, succeeded, failed } without guessing beyond what is there.
export function parseCounts(returnValue) {
  if (returnValue == null) return { total: 0, succeeded: 0, failed: 0 };
  if (typeof returnValue === 'number') return { total: returnValue, succeeded: returnValue, failed: 0 };
  if (typeof returnValue !== 'object') return { total: 0, succeeded: 0, failed: 0 };

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const succeeded = num(returnValue.succeeded ?? returnValue.sent ?? returnValue.processed ?? returnValue.success ?? 0);
  const failed = num(returnValue.failed ?? returnValue.errors ?? 0);
  const skipped = num(returnValue.skipped ?? 0);
  const total = num(returnValue.total ?? succeeded + failed + skipped);
  return { total, succeeded, failed };
}

export function deriveStatus({ succeeded = 0, failed = 0 }) {
  if (failed > 0 && succeeded === 0) return 'failed';
  if (failed > 0) return 'partial';
  return 'success';
}

// A scheduled automation is stale when it hasn't run within 1.5x its
// expected interval (grace for queue delay / restarts). Event-driven
// automations (no interval) are never stale. Never-run automations only
// count as stale once the process has been up longer than the grace
// window, so a fresh deploy doesn't flood the inbox.
export function isStale(row, now = new Date(), processStartedAt = new Date(0)) {
  if (!row || !row.expected_interval_minutes) return false;
  const graceMs = row.expected_interval_minutes * 1.5 * 60 * 1000;
  if (!row.last_run_at) return now - processStartedAt > graceMs;
  return now - new Date(row.last_run_at) > graceMs;
}

export function maxSeverity(a, b) {
  return (SEVERITY_RANK[a] || 0) >= (SEVERITY_RANK[b] || 0) ? a : b;
}

// ---------- Run recording ----------

export async function recordRun({
  key,
  schoolId = null,
  status,
  startedAt = new Date(),
  itemsTotal = 0,
  itemsSucceeded = 0,
  itemsFailed = 0,
  errorSummary = null,
  meta = {},
}) {
  try {
    const reg = await pool.query(
      `UPDATE automation_registry
       SET last_run_at = NOW(),
           last_status = $2::varchar,
           last_success_at = CASE WHEN $2::varchar IN ('success', 'skipped') THEN NOW() ELSE last_success_at END,
           last_error = CASE WHEN $2::varchar IN ('success', 'skipped') THEN NULL ELSE $3::text END
       WHERE automation_key = $1
       RETURNING record_every_minutes`,
      [key, status, errorSummary]
    );
    if (reg.rowCount === 0) {
      console.warn(`[ops] recordRun: unknown automation_key "${key}" — add it to automation_registry in schema.sql`);
    }

    // High-frequency jobs: keep every failure, but only one success row per
    // record_every_minutes window.
    const every = reg.rows[0]?.record_every_minutes;
    if (every && status === 'success') {
      const recent = await pool.query(
        `SELECT 1 FROM automation_runs
         WHERE automation_key = $1 AND COALESCE(school_id, 0) = COALESCE($2::int, 0)
           AND started_at > NOW() - make_interval(mins => $3::int)
         LIMIT 1`,
        [key, schoolId, every]
      );
      if (recent.rowCount > 0) return;
    }

    await pool.query(
      `INSERT INTO automation_runs (school_id, automation_key, status, started_at, finished_at,
                                    items_total, items_succeeded, items_failed, error_summary, meta)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9)`,
      [schoolId, key, status, startedAt, itemsTotal, itemsSucceeded, itemsFailed, errorSummary, JSON.stringify(meta)]
    );
  } catch (err) {
    console.error(`[ops] recordRun failed for ${key}:`, err.message);
  }
}

// Convenience wrapper for inline code paths: times fn, records the outcome,
// and rethrows so the caller's own error handling is unchanged. fn may
// return a counts-shaped object (see parseCounts).
export async function withRun(key, schoolId, fn) {
  const startedAt = new Date();
  try {
    const result = await fn();
    const counts = parseCounts(result);
    await recordRun({
      key,
      schoolId,
      status: deriveStatus(counts),
      startedAt,
      itemsTotal: counts.total,
      itemsSucceeded: counts.succeeded,
      itemsFailed: counts.failed,
    });
    return result;
  } catch (err) {
    await recordRun({ key, schoolId, status: 'failed', startedAt, errorSummary: err.message });
    throw err;
  }
}

// ---------- Exceptions ----------

// Upserts on (school_id, dedupe_key) while the previous one is still open
// or snoozed: repeat occurrences bump a counter instead of flooding the
// inbox. Severity only ever escalates on repeat, never silently drops.
export async function raiseException({
  schoolId,
  source,
  severity = 'medium',
  title,
  body = null,
  entityType = null,
  entityId = null,
  suggestedAction = null,
  dedupeKey = null,
}) {
  if (!schoolId || !source || !title) {
    console.error('[ops] raiseException requires schoolId, source and title', { schoolId, source, title });
    return null;
  }
  try {
    const params = [
      schoolId,
      source,
      severity,
      title.slice(0, 255),
      body,
      entityType,
      entityId,
      suggestedAction ? JSON.stringify(suggestedAction) : null,
      dedupeKey,
    ];
    if (!dedupeKey) {
      const r = await pool.query(
        `INSERT INTO ops_exceptions (school_id, source, severity, title, body, entity_type, entity_id, suggested_action, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        params
      );
      return r.rows[0].id;
    }
    const r = await pool.query(
      `INSERT INTO ops_exceptions (school_id, source, severity, title, body, entity_type, entity_id, suggested_action, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (school_id, dedupe_key) WHERE status IN ('open', 'snoozed') AND dedupe_key IS NOT NULL
       DO UPDATE SET
         occurrences = ops_exceptions.occurrences + 1,
         last_seen_at = NOW(),
         body = EXCLUDED.body,
         title = EXCLUDED.title,
         severity = CASE
           WHEN (CASE EXCLUDED.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
              > (CASE ops_exceptions.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
           THEN EXCLUDED.severity ELSE ops_exceptions.severity END
       RETURNING id`,
      params
    );
    return r.rows[0].id;
  } catch (err) {
    console.error('[ops] raiseException failed:', err.message);
    return null;
  }
}

async function activeSchoolIds() {
  const r = await pool.query(`SELECT id FROM schools WHERE status = 'active'`);
  return r.rows.map((row) => row.id);
}

// Platform-wide problems (Redis down, WhatsApp token expired) affect every
// school, and each school's operator needs to see them in their own inbox.
export async function raiseExceptionForAllSchools(args) {
  try {
    const ids = await activeSchoolIds();
    for (const schoolId of ids) await raiseException({ ...args, schoolId });
  } catch (err) {
    console.error('[ops] raiseExceptionForAllSchools failed:', err.message);
  }
}

// When the underlying problem recovers (Redis back, automation ran again),
// close the matching open exception automatically so the inbox only ever
// shows things that still need a human.
export async function autoResolve(dedupeKey, { schoolId = null, note = 'Recovered automatically' } = {}) {
  try {
    await pool.query(
      `UPDATE ops_exceptions
       SET status = 'resolved', resolved_at = NOW(), resolution_note = $3
       WHERE dedupe_key = $1 AND status IN ('open', 'snoozed')
         AND ($2::int IS NULL OR school_id = $2)`,
      [dedupeKey, schoolId, note]
    );
  } catch (err) {
    console.error('[ops] autoResolve failed:', err.message);
  }
}

// ---------- Audit ----------

export async function audit({ schoolId, actorType = 'system', actorId = null, action, entityType = null, entityId = null, detail = {} }) {
  if (!schoolId || !action) return;
  try {
    await pool.query(
      `INSERT INTO audit_log (school_id, actor_type, actor_id, action, entity_type, entity_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [schoolId, actorType, actorId, action, entityType, entityId, JSON.stringify(detail)]
    );
  } catch (err) {
    console.error('[ops] audit failed:', err.message);
  }
}

// ---------- One-click actions from the inbox ----------
// Later phases register their own (certificate.approve, payment.match, ...).
// Only registered keys can ever be executed from a suggested_action — the
// JSON stored in the row is never trusted to name arbitrary code.

const actionHandlers = new Map();

export function registerAction(key, handler) {
  actionHandlers.set(key, handler);
}

export function hasAction(key) {
  return actionHandlers.has(key);
}

export async function runAction(key, ctx) {
  const handler = actionHandlers.get(key);
  if (!handler) {
    const err = new Error(`Unknown action "${key}"`);
    err.status = 400;
    throw err;
  }
  return handler(ctx);
}

export default {
  parseCounts,
  deriveStatus,
  isStale,
  recordRun,
  withRun,
  raiseException,
  raiseExceptionForAllSchools,
  autoResolve,
  audit,
  registerAction,
  hasAction,
  runAction,
};
