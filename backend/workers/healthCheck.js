import axios from 'axios';
import pool from '../config/db.js';
import { connection } from '../config/queue.js';
import { isStale, recordRun, raiseException, raiseExceptionForAllSchools, autoResolve } from '../services/opsService.js';

// ------------------------------------------------------------------
// Control Center health check.
//
// Runs on an in-process setInterval, NOT a BullMQ repeatable job: the most
// important thing it detects is Redis being down, and a BullMQ-scheduled
// check would silently stop firing in exactly that case.
//
// Each check writes integration_health (what the Control Center shows) and
// raises / auto-resolves an exception on state change, deduped so a
// problem that lasts all day is one inbox item with a counter, not 144.
// ------------------------------------------------------------------

const PROCESS_STARTED_AT = new Date();
const HOUR = 60 * 60 * 1000;

// Paid / rate-limited external checks run at most hourly; results are
// cached in-memory between runs.
const externalCache = new Map(); // integration -> { at, result }

// IST wall-clock parts, independent of the server's TZ setting.
export function istParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

export function isSchoolHours(now = new Date()) {
  const { weekday, hour } = istParts(now);
  return weekday !== 'Sun' && hour >= 7 && hour < 17;
}

async function cachedExternal(name, fn) {
  const hit = externalCache.get(name);
  if (hit && Date.now() - hit.at < HOUR) return hit.result;
  let result;
  try {
    result = await fn();
  } catch (err) {
    result = { status: 'down', detail: err.message };
  }
  externalCache.set(name, { at: Date.now(), result });
  return result;
}

async function upsertHealth(schoolId, integration, { status, detail = null }) {
  await pool.query(
    `INSERT INTO integration_health (school_id, integration, status, detail, checked_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT ((COALESCE(school_id, 0)), integration)
     DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = NOW()`,
    [schoolId, integration, status, detail]
  );
}

const LABELS = {
  postgres: 'Database',
  redis: 'Redis (background jobs)',
  whatsapp: 'WhatsApp',
  anthropic: 'AI (Claude API)',
  razorpay: 'Razorpay payments',
  vapi: 'Voice calls (Vapi)',
  s3: 'File storage (S3)',
  gps: 'Bus GPS',
  biometric: 'Biometric attendance',
};

// What an operator should actually do, in plain words, per integration.
const FIX_HINTS = {
  redis: 'Background jobs (fee reminders, voice-call escalations, digests) are NOT running. Ask the developer to restart Redis on the server (sudo systemctl restart redis) and then restart the app (pm2 restart all).',
  whatsapp: 'Parents are not receiving WhatsApp messages. The access token has most likely expired — generate a permanent System User token in Meta Business Settings and update WHATSAPP_ACCESS_TOKEN.',
  anthropic: 'AI features (tutor, doubt hints, grading, summaries) are failing or using fallbacks. Check ANTHROPIC_API_KEY and the account balance.',
  razorpay: 'Online fee payments and payment links may fail. Check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.',
  vapi: 'Absence voice-call escalations will fail. Check VAPI_API_KEY.',
  gps: 'Live bus location is unavailable for parents. Check the GPS device / vendor connection for the listed buses.',
  biometric: 'No teacher punches have been received today. The biometric device or its bridge may be offline.',
};

async function reportPlatform(integration, result, { critical = false } = {}) {
  await upsertHealth(null, integration, result);
  const dedupeKey = `integration:${integration}`;
  if (result.status === 'down' || result.status === 'degraded') {
    await raiseExceptionForAllSchools({
      source: 'integration',
      severity: result.status === 'down' ? (critical ? 'critical' : 'high') : 'medium',
      title: `${LABELS[integration] || integration} is ${result.status}`,
      body: [result.detail, FIX_HINTS[integration]].filter(Boolean).join('\n\n'),
      entityType: 'integration',
      dedupeKey,
    });
  } else if (result.status === 'ok') {
    await autoResolve(dedupeKey);
  }
}

async function reportSchool(schoolId, integration, result) {
  await upsertHealth(schoolId, integration, result);
  const dedupeKey = `integration:${integration}`;
  if (result.status === 'down' || result.status === 'degraded') {
    await raiseException({
      schoolId,
      source: 'integration',
      severity: result.status === 'down' ? 'high' : 'medium',
      title: `${LABELS[integration] || integration} is ${result.status}`,
      body: [result.detail, FIX_HINTS[integration]].filter(Boolean).join('\n\n'),
      entityType: 'integration',
      dedupeKey,
    });
  } else {
    await autoResolve(dedupeKey, { schoolId });
  }
}

// ---------- Individual checks ----------

async function checkRedis() {
  try {
    const pong = await Promise.race([
      connection.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out after 3s')), 3000)),
    ]);
    return pong === 'PONG' ? { status: 'ok' } : { status: 'degraded', detail: `Unexpected reply: ${pong}` };
  } catch (err) {
    return { status: 'down', detail: err.message };
  }
}

async function checkWhatsApp() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { status: 'not_configured', detail: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set' };
  return cachedExternal('whatsapp', async () => {
    try {
      const r = await axios.get(`https://graph.facebook.com/v21.0/${phoneId}`, {
        params: { fields: 'status,quality_rating,display_phone_number', access_token: token },
        timeout: 8000,
      });
      const quality = r.data?.quality_rating;
      if (quality === 'RED') return { status: 'degraded', detail: `Number ${r.data.display_phone_number} quality rating is RED — Meta may limit sending.` };
      return { status: 'ok', detail: `Number ${r.data?.display_phone_number || ''} · quality ${quality || 'unknown'}` };
    } catch (err) {
      const metaErr = err.response?.data?.error;
      if (metaErr?.code === 190) return { status: 'down', detail: 'Access token is invalid or expired (Meta error 190).' };
      return { status: 'down', detail: metaErr?.message || err.message };
    }
  });
}

async function checkAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'not_configured', detail: 'ANTHROPIC_API_KEY not set — AI features use fallbacks or fail.' };
  return cachedExternal('anthropic', async () => {
    try {
      await axios.post(
        'https://api.anthropic.com/v1/messages',
        { model: process.env.OPS_HEALTH_AI_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        {
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          timeout: 15000,
        }
      );
      return { status: 'ok' };
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      if (status === 401 || status === 403) return { status: 'down', detail: `API key rejected: ${msg}` };
      if (status === 429 || status === 529) return { status: 'degraded', detail: `Rate-limited / overloaded: ${msg}` };
      return { status: 'down', detail: msg };
    }
  });
}

async function checkRazorpay() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return { status: 'not_configured', detail: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set' };
  return cachedExternal('razorpay', async () => {
    try {
      await axios.get('https://api.razorpay.com/v1/payments', { params: { count: 1 }, auth: { username: id, password: secret }, timeout: 8000 });
      return { status: 'ok' };
    } catch (err) {
      const status = err.response?.status;
      return { status: status === 401 ? 'down' : 'degraded', detail: err.response?.data?.error?.description || err.message };
    }
  });
}

async function checkVapi() {
  if (!process.env.VAPI_API_KEY) return { status: 'not_configured', detail: 'VAPI_API_KEY not set — voice-call escalation disabled.' };
  return cachedExternal('vapi', async () => {
    try {
      await axios.get('https://api.vapi.ai/assistant', {
        params: { limit: 1 },
        headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
        timeout: 8000,
      });
      return { status: 'ok' };
    } catch (err) {
      const status = err.response?.status;
      return { status: status === 401 ? 'down' : 'degraded', detail: err.response?.data?.message || err.message };
    }
  });
}

function checkS3() {
  const ok = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET;
  return ok ? { status: 'ok', detail: `Bucket ${process.env.AWS_S3_BUCKET}` } : { status: 'not_configured', detail: 'AWS S3 credentials / bucket not set' };
}

async function checkSchoolGps(schoolId, now) {
  const r = await pool.query(
    `SELECT id, route_name, vehicle_number, last_poll_status, last_poll_error, last_poll_at
     FROM buses
     WHERE school_id = $1 AND vendor_api_base_url IS NOT NULL`,
    [schoolId]
  );
  if (r.rowCount === 0) return { status: 'not_configured', detail: 'No GPS-connected buses' };
  if (!isSchoolHours(now)) return { status: 'ok', detail: `${r.rowCount} bus(es) — outside route hours, not checked` };

  const bad = r.rows.filter(
    (b) => b.last_poll_status === 'error' || !b.last_poll_at || now - new Date(b.last_poll_at) > 15 * 60 * 1000
  );
  if (bad.length === 0) return { status: 'ok', detail: `${r.rowCount} bus(es) reporting` };
  const list = bad
    .slice(0, 10)
    .map((b) => `• ${b.vehicle_number || b.route_name || `Bus #${b.id}`}: ${b.last_poll_error || 'no update in 15+ min'}`)
    .join('\n');
  return { status: bad.length === r.rowCount ? 'down' : 'degraded', detail: `${bad.length} of ${r.rowCount} bus(es) not reporting:\n${list}` };
}

async function checkSchoolBiometric(schoolId, now) {
  const settings = await pool.query(`SELECT attendance_method FROM school_settings WHERE school_id = $1`, [schoolId]);
  if (settings.rows[0]?.attendance_method !== 'biometric') return { status: 'not_configured', detail: 'School uses manual attendance' };
  const devices = await pool.query(`SELECT COUNT(*)::int AS n FROM biometric_devices WHERE school_id = $1`, [schoolId]);
  if (devices.rows[0].n === 0) return { status: 'not_configured', detail: 'No biometric devices registered' };

  const { weekday, hour } = istParts(now);
  if (weekday === 'Sun' || hour < 10) return { status: 'ok', detail: 'Checked after 10 AM on working days' };

  const punches = await pool.query(
    `SELECT COUNT(*)::int AS n FROM teacher_punch_events
     WHERE school_id = $1 AND (punch_time AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
    [schoolId]
  );
  // A holiday also produces zero punches — degraded (not down) so it reads
  // as "check this", and the operator can dismiss it on a real holiday.
  if (punches.rows[0].n === 0) return { status: 'degraded', detail: 'Zero teacher punches received today (after 10 AM). If today is not a holiday, the device or bridge is offline.' };
  return { status: 'ok', detail: `${punches.rows[0].n} punches today` };
}

async function checkStaleAutomations(now) {
  const r = await pool.query(
    `SELECT automation_key, display_name, expected_interval_minutes, critical, last_run_at, last_status
     FROM automation_registry WHERE expected_interval_minutes IS NOT NULL AND automation_key <> 'ops_health_check'`
  );
  let stale = 0;
  for (const row of r.rows) {
    const dedupeKey = `stale:${row.automation_key}`;
    if (isStale(row, now, PROCESS_STARTED_AT)) {
      stale += 1;
      await raiseExceptionForAllSchools({
        source: 'automation_failure',
        severity: row.critical ? 'critical' : 'high',
        title: `${row.display_name} has not run on schedule`,
        body: row.last_run_at
          ? `Last run: ${new Date(row.last_run_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (expected every ${row.expected_interval_minutes} min). The background worker is probably not running — check Redis and that the app process is up (pm2 status).`
          : `This automation has never run since the app started. The background worker is probably not running — check Redis and that the app process is up (pm2 status).`,
        entityType: 'automation',
        suggestedAction: { label: 'Run now', action: 'automation.run_now', params: { automation_key: row.automation_key } },
        dedupeKey,
      });
    } else {
      await autoResolve(dedupeKey);
    }
  }
  return stale;
}

// ---------- Orchestration ----------

let running = false;

export async function runHealthCheck(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  const startedAt = new Date();
  let problems = 0;
  try {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      // Can't record anything without the DB — log loudly and stop.
      console.error('[ops] HEALTH CHECK: Postgres unreachable:', err.message);
      return { failed: 1 };
    }
    await upsertHealth(null, 'postgres', { status: 'ok' });

    const platform = [
      ['redis', await checkRedis(), { critical: true }],
      ['whatsapp', await checkWhatsApp(), { critical: true }],
      ['anthropic', await checkAnthropic(), {}],
      ['razorpay', await checkRazorpay(), {}],
      ['vapi', await checkVapi(), {}],
      ['s3', checkS3(), {}],
    ];
    for (const [name, result, opts] of platform) {
      if (result.status === 'down' || result.status === 'degraded') problems += 1;
      await reportPlatform(name, result, opts);
    }

    const schools = await pool.query(`SELECT id FROM schools WHERE status = 'active'`);
    for (const { id } of schools.rows) {
      for (const [name, check] of [
        ['gps', checkSchoolGps],
        ['biometric', checkSchoolBiometric],
      ]) {
        try {
          const result = await check(id, now);
          if (result.status === 'down' || result.status === 'degraded') problems += 1;
          await reportSchool(id, name, result);
        } catch (err) {
          console.error(`[ops] ${name} check failed for school ${id}:`, err.message);
        }
      }
    }

    problems += await checkStaleAutomations(now);

    await recordRun({ key: 'ops_health_check', status: 'success', startedAt, itemsTotal: problems, meta: { problems } });
    return { problems };
  } catch (err) {
    console.error('[ops] health check crashed:', err.stack || err.message);
    await recordRun({ key: 'ops_health_check', status: 'failed', startedAt, errorSummary: err.message });
    return { failed: 1 };
  } finally {
    running = false;
  }
}

export function startHealthCheckLoop() {
  const minutes = Number(process.env.HEALTH_CHECK_INTERVAL_MINUTES || 10);
  // First run shortly after boot so the Control Center isn't empty.
  setTimeout(() => runHealthCheck().catch(() => {}), 20 * 1000);
  setInterval(() => runHealthCheck().catch(() => {}), minutes * 60 * 1000);
  console.log(`[ops] Health check every ${minutes} min.`);
}
