import { Worker } from 'bullmq';
import axios from 'axios';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { recordRun, audit } from '../services/opsService.js';

// ------------------------------------------------------------------
// Operator daily digest — 8 AM IST by default.
//
// Numbers come from SQL only. Claude (if configured) only rewrites those
// numbers into one readable line; any AI failure falls back to a fixed
// template, so the digest always goes out.
//
// WhatsApp template parameters cannot contain newlines / tabs / 4+
// consecutive spaces (Meta rejects the send), so the summary is a single
// line joined with " | ". Template to create and get approved (Utility):
//
//   name: ops_daily_digest   language: en
//   body: "Waynur daily report for {{1}}: {{2}}. Open items needing you: {{3}}. Open the Control Center for details."
// ------------------------------------------------------------------

const TEMPLATE = process.env.WHATSAPP_OPS_DIGEST_TEMPLATE || 'ops_daily_digest';

export function sanitizeTemplateParam(text, max = 900) {
  return String(text ?? '')
    .replace(/[\r\n\t]+/g, ' | ')
    .replace(/ {4,}/g, '   ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .trim()
    .slice(0, max);
}

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export function fallbackDigestLine(f, lang = 'hinglish') {
  const parts = [];
  if (lang === 'en') {
    parts.push(`Absence alerts: ${f.alerts_sent} sent${f.alerts_failed ? `, ${f.alerts_failed} failed` : ''}`);
    parts.push(`Fees collected: ${inr(f.fees_collected)} (${f.payments_count} payments)`);
    if (f.automations_failed) parts.push(`${f.automations_failed} automation run(s) failed`);
    if (f.integrations_down.length) parts.push(`Needs attention: ${f.integrations_down.join(', ')}`);
    else parts.push('All systems working');
    parts.push(`Issues: ${f.exceptions_opened} new, ${f.exceptions_resolved} resolved`);
  } else {
    parts.push(`Absence alerts: ${f.alerts_sent} gaye${f.alerts_failed ? `, ${f.alerts_failed} fail hue` : ''}`);
    parts.push(`Fees aayi: ${inr(f.fees_collected)} (${f.payments_count} payments)`);
    if (f.automations_failed) parts.push(`${f.automations_failed} automation fail hui`);
    if (f.integrations_down.length) parts.push(`Dhyan do: ${f.integrations_down.join(', ')}`);
    else parts.push('Sab systems theek chal rahe hain');
    parts.push(`Issues: ${f.exceptions_opened} naye, ${f.exceptions_resolved} solve hue`);
  }
  return parts.join(' | ');
}

export async function buildDigestFacts(schoolId) {
  // "Yesterday" in IST, as a [start, end) pair of naive IST timestamps
  // compared against (col AT TIME ZONE 'Asia/Kolkata').
  const day = `(NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1`;
  const inDay = (col) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date = ${day}`;

  const [alerts, fees, opened, resolved, openNow, integ, autos, school] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE nl.status <> 'FAILED')::int AS sent, COUNT(*) FILTER (WHERE nl.status = 'FAILED')::int AS failed
       FROM notification_log nl JOIN attendance a ON a.id = nl.attendance_id
       WHERE a.school_id = $1 AND nl.type = 'whatsapp' AND ${inDay('nl.sent_at')}`,
      [schoolId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total, COUNT(*)::int AS n
       FROM student_payment_history WHERE school_id = $1 AND ${inDay('created_at')}`,
      [schoolId]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM ops_exceptions WHERE school_id = $1 AND ${inDay('created_at')}`, [schoolId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM ops_exceptions WHERE school_id = $1 AND ${inDay('resolved_at')}`, [schoolId]),
    pool.query(
      `SELECT severity, COUNT(*)::int AS n FROM ops_exceptions
       WHERE school_id = $1 AND (status = 'open' OR (status = 'snoozed' AND snoozed_until <= NOW()))
       GROUP BY severity`,
      [schoolId]
    ),
    pool.query(
      `SELECT integration FROM integration_health
       WHERE (school_id = $1 OR school_id IS NULL) AND status IN ('down', 'degraded') ORDER BY integration`,
      [schoolId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM automation_runs
       WHERE (school_id = $1 OR school_id IS NULL) AND status IN ('failed', 'partial') AND ${inDay('started_at')}`,
      [schoolId]
    ),
    pool.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]),
  ]);

  const openBySeverity = Object.fromEntries(openNow.rows.map((r) => [r.severity, r.n]));
  return {
    school_name: school.rows[0]?.name || 'your school',
    alerts_sent: alerts.rows[0].sent,
    alerts_failed: alerts.rows[0].failed,
    fees_collected: Number(fees.rows[0].total),
    payments_count: fees.rows[0].n,
    exceptions_opened: opened.rows[0].n,
    exceptions_resolved: resolved.rows[0].n,
    open_total: Object.values(openBySeverity).reduce((a, b) => a + b, 0),
    open_by_severity: openBySeverity,
    integrations_down: integ.rows.map((r) => r.integration),
    automations_failed: autos.rows[0].n,
  };
}

async function aiDigestLine(facts, lang) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-5',
        max_tokens: 250,
        system:
          `You write a one-line morning status report for a school's software operator. ` +
          `Use ONLY the numbers in the JSON — never invent or estimate a number. ` +
          `Write in ${lang === 'en' ? 'plain English' : 'casual Hinglish (Hindi in Latin script mixed with English)'}. ` +
          `Mention anything failing or down first. Max 350 characters. Single line, no line breaks, no emojis, no markdown. ` +
          `Separate points with " | ". Output only the line.`,
        messages: [{ role: 'user', content: JSON.stringify(facts) }],
      },
      {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout: 20000,
      }
    );
    const text = r.data?.content?.find((b) => b.type === 'text')?.text;
    return text ? sanitizeTemplateParam(text, 400) : null;
  } catch (err) {
    console.error('[ops digest] AI line failed, using fallback:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

export async function runDailyDigest() {
  const schools = await pool.query(
    `SELECT s.id, ss.operator_digest_phone, ss.principal_digest_phone, COALESCE(ss.digest_enabled, TRUE) AS enabled,
            COALESCE(ss.digest_language, 'hinglish') AS lang
     FROM schools s LEFT JOIN school_settings ss ON ss.school_id = s.id
     WHERE s.status = 'active'`
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of schools.rows) {
    const startedAt = new Date();
    if (!s.enabled) {
      skipped += 1;
      continue;
    }
    try {
      const facts = await buildDigestFacts(s.id);
      const line = (await aiDigestLine(facts, s.lang)) || fallbackDigestLine(facts, s.lang);

      // Dashboard copy for every principal/operator — works even if no
      // digest phone is configured or WhatsApp is down.
      const staff = await pool.query(
        `SELECT id FROM teachers WHERE school_id = $1 AND role IN ('principal', 'operator')`,
        [s.id]
      );
      for (const t of staff.rows) {
        await pool.query(
          `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body, payload_sent)
           VALUES ($1, 'ops_daily_digest', 'staff', $2, 'dashboard', $3, $4, $5)`,
          [s.id, t.id, 'Daily Control Center report', line, JSON.stringify(facts)]
        );
      }

      const phones = [...new Set([s.operator_digest_phone, s.principal_digest_phone].filter(Boolean))];
      let schoolFailed = 0;
      for (const phone of phones) {
        try {
          await sendTemplateMessage(phone, TEMPLATE, 'en', [
            sanitizeTemplateParam(facts.school_name, 100),
            line,
            String(facts.open_total),
          ]);
          sent += 1;
        } catch (err) {
          schoolFailed += 1;
          failed += 1;
          console.error(`[ops digest] WhatsApp send failed for school ${s.id}:`, err.response?.data?.error?.message || err.message);
        }
      }
      await audit({ schoolId: s.id, action: 'ops.digest_sent', detail: { phones: phones.length, failed: schoolFailed, line } });
      await recordRun({
        key: 'ops_daily_digest',
        schoolId: s.id,
        status: schoolFailed && schoolFailed === phones.length && phones.length > 0 ? 'failed' : schoolFailed ? 'partial' : 'success',
        startedAt,
        itemsTotal: phones.length,
        itemsSucceeded: phones.length - schoolFailed,
        itemsFailed: schoolFailed,
        meta: { line, whatsapp_recipients: phones.length },
      });
    } catch (err) {
      failed += 1;
      console.error(`[ops digest] failed for school ${s.id}:`, err.message);
      await recordRun({ key: 'ops_daily_digest', schoolId: s.id, status: 'failed', startedAt, errorSummary: err.message });
    }
  }
  return { sent, failed, skipped };
}

const worker = new Worker(
  'OpsDigestQueue',
  async (job) => {
    if (job.name === 'dailyDigest') return runDailyDigest();
    console.warn(`Unknown job name on OpsDigestQueue: ${job.name}`);
  },
  { connection }
);

// Platform-level heartbeat so the staleness check sees the digest ran even
// on days when every school has it disabled.
worker.on('completed', (job, rv) => {
  recordRun({ key: 'ops_daily_digest', status: rv?.failed && !rv?.sent ? 'failed' : 'success', meta: rv || {} });
});
worker.on('failed', (job, err) => {
  console.error(`OpsDigestQueue job ${job?.id} failed:`, err.message);
  recordRun({ key: 'ops_daily_digest', status: 'failed', errorSummary: err.message });
});

export default worker;
