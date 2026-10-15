import pool from '../config/db.js';
import { pickPlanItems, planWhatsAppLine, istToday, toTemplateParam } from '../utils/aiAutomation.js';
import { askJSON } from './aiText.js';
import { audit, RUN_NOW_ALLOWED } from './opsService.js';
import { sendTemplateMessage } from './whatsappService.js';
import { AI_SCHOOLS_SQL } from './schoolPlans.js';

// B1 — the principal's "what I would do today" plan.
//
// SQL finds every candidate (open urgent items, waiting approvals, students
// flagged this week, notes to approve, fresh enquiries, fee follow-up) and
// scores it. Claude only chooses the three that matter most and explains why
// in a line each — it can only pick from the candidate list, never add one.
// Where a safe one-tap action exists (re-run a failed automation, tell class
// teachers about flagged students) it is queued as an approval the principal
// can press in the panel or answer with APPROVE <n> on WhatsApp.
//
// WhatsApp template to create and get approved (Utility, en):
//   name: principal_daily_plan
//   body: "Good morning. Today's plan for {{1}}: {{2}}. Open the Control Center for details."

const TEMPLATE = process.env.WHATSAPP_DAILY_PLAN_TEMPLATE || 'principal_daily_plan';
// "1 student", "2 students", "3 enquiries" — consonant + y takes "ies".
const pluralWord = (word) => (/[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);
const plural = (n, word) => `${n} ${n === 1 ? word : pluralWord(word)}`;
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export async function planCandidates(schoolId, today) {
  const q = (sql, params = [schoolId]) => pool.query(sql, params).then((r) => r.rows).catch((err) => {
    console.error('[daily plan] candidate query failed:', err.message);
    return [];
  });
  const [urgent, autos, attention, notes, staffLeave, studentLeave, payroll, enquiries, fees] = await Promise.all([
    q(`SELECT id, severity, title, occurrences, suggested_action FROM ops_exceptions
        WHERE school_id = $1 AND source <> 'early_warning' AND severity IN ('critical','high')
          AND (status = 'open' OR (status = 'snoozed' AND snoozed_until <= NOW()))
        ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, last_seen_at DESC LIMIT 5`),
    q(`SELECT automation_key, display_name, last_error FROM automation_registry WHERE last_status = 'failed' ORDER BY last_run_at DESC LIMIT 5`, []),
    q(`SELECT f.period, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE f.score >= 5)::int AS serious,
              EXISTS (SELECT 1 FROM audit_log a WHERE a.school_id = $1 AND a.action = 'ai.attention_teachers_notified' AND a.detail->>'period' = f.period) AS notified
         FROM student_attention_flags f WHERE f.school_id = $1 AND f.status = 'open' AND f.created_at > NOW() - INTERVAL '8 days'
        GROUP BY f.period ORDER BY f.period DESC LIMIT 1`),
    q(`SELECT COUNT(*)::int AS n FROM parent_progress_notes WHERE school_id = $1 AND status = 'draft'`),
    q(`SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest FROM staff_leave_requests WHERE school_id = $1 AND status = 'PENDING'`),
    q(`SELECT COUNT(*)::int AS n FROM student_leave_requests WHERE school_id = $1 AND status = 'PENDING' AND created_at < NOW() - INTERVAL '1 day'`),
    q(`SELECT period FROM payroll_runs WHERE school_id = $1 AND status = 'draft' ORDER BY period DESC LIMIT 1`),
    q(`SELECT COUNT(*)::int AS n FROM admission_enquiries
        WHERE school_id = $1 AND stage IN ('new','qualifying','qualified') AND created_at > NOW() - INTERVAL '14 days'
          AND COALESCE(last_outbound_at, created_at) < NOW() - INTERVAL '2 days'`),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(due), 0) AS due FROM (
         SELECT fs.amount - COALESCE((SELECT SUM(h.amount_paid) FROM student_payment_history h
                                      WHERE h.student_id = s.id AND h.created_at >= (CASE WHEN EXTRACT(MONTH FROM $2::date) >= 4
                                        THEN make_date(EXTRACT(YEAR FROM $2::date)::int, 4, 1) ELSE make_date(EXTRACT(YEAR FROM $2::date)::int - 1, 4, 1) END)
                                        AND (h.remarks IS NULL OR h.remarks NOT LIKE 'Transport fee%')), 0) AS due,
                (SELECT MAX(h.created_at) FROM student_payment_history h WHERE h.student_id = s.id) AS last_paid
           FROM students s JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
          WHERE s.school_id = $1) d
        WHERE due > 0 AND (last_paid IS NULL OR last_paid < $2::date - 60)`, [schoolId, today]),
  ]);

  const c = [];
  for (const e of urgent) {
    const act = e.suggested_action?.action === 'automation.run_now' && RUN_NOW_ALLOWED.has(e.suggested_action?.params?.automation_key) ? e.suggested_action : null;
    c.push({
      kind: `inbox`, key: `inbox:${e.id}`, priority: e.severity === 'critical' ? 95 : 75,
      title: e.title, evidence: `${e.severity} item in the Control Center inbox${e.occurrences > 1 ? `, seen ${e.occurrences} times` : ''}`,
      link: `/ops/inbox?focus=${e.id}`,
      action: act ? { key: act.action, params: act.params, summary: `${act.label || 'Run it again'}: ${e.title}` } : null,
    });
  }
  for (const a of autos) {
    if (urgent.some((e) => e.suggested_action?.params?.automation_key === a.automation_key)) continue;
    c.push({
      kind: 'automation', key: `automation:${a.automation_key}`, priority: 80,
      title: `Fix "${a.display_name}" — its last run failed`, evidence: a.last_error ? String(a.last_error).slice(0, 160) : 'last run failed',
      link: `/ops/automations/${a.automation_key}`,
      action: RUN_NOW_ALLOWED.has(a.automation_key) ? { key: 'automation.run_now', params: { automation_key: a.automation_key }, summary: `Run "${a.display_name}" again now` } : null,
    });
  }
  const att = attention[0];
  if (att?.n) {
    c.push({
      kind: 'attention', key: `attention:${att.period}`, priority: att.notified ? 45 : 70 + Math.min(att.serious * 3, 15),
      title: `Look at the ${plural(att.n, 'student')} flagged as needing attention`, evidence: `${att.n} open this week${att.serious ? `, ${att.serious} with several warning signs` : ''}${att.notified ? '; class teachers already told' : ''}`,
      link: '/ops/attention',
      action: att.notified ? null : { key: 'attention.notify_teachers', params: { period: att.period }, summary: `Tell the class teachers about the ${plural(att.n, 'flagged student')} (in-app notice to staff only)` },
    });
  }
  if (notes[0]?.n) {
    c.push({ kind: 'progress_notes', key: 'progress_notes', priority: 60, title: `Approve ${plural(notes[0].n, 'parent progress note')}`, evidence: `${notes[0].n} drafts waiting; unapproved notes expire after 4 days`, link: '/ops/progress-notes' });
  }
  if (staffLeave[0]?.n) {
    const days = staffLeave[0].oldest ? Math.floor((Date.now() - new Date(staffLeave[0].oldest)) / 86400000) : 0;
    c.push({ kind: 'staff_leave', key: 'staff_leave', priority: 55 + Math.min(days * 5, 25), title: `Decide ${plural(staffLeave[0].n, 'staff leave request')}`, evidence: `oldest waiting ${plural(days, 'day')}`, link: '/admin/staff-leave' });
  }
  if (studentLeave[0]?.n) {
    c.push({ kind: 'student_leave', key: 'student_leave', priority: 45, title: `Clear ${plural(studentLeave[0].n, 'student leave request')} waiting over a day`, evidence: `${studentLeave[0].n} pending`, link: '/student-leave' });
  }
  if (payroll[0]) {
    c.push({ kind: 'payroll', key: `payroll:${payroll[0].period}`, priority: 50, title: `Review and approve payroll for ${payroll[0].period}`, evidence: 'draft run waiting for your approval', link: '/admin/payroll' });
  }
  if (enquiries[0]?.n) {
    c.push({ kind: 'admissions', key: 'admissions', priority: 50 + Math.min(enquiries[0].n * 3, 20), title: `Call back ${plural(enquiries[0].n, 'admission enquiry')} not contacted for 2+ days`, evidence: `${enquiries[0].n} recent enquiries without a reply in 2 days`, link: '/ops/admissions' });
  }
  if (fees[0]?.n) {
    c.push({ kind: 'fees', key: 'fees', priority: 35 + Math.min(fees[0].n, 20), title: `Follow up fees for ${plural(fees[0].n, 'student')} with no payment in 60+ days`, evidence: `${inr(fees[0].due)} outstanding across them`, link: '/finance' });
  }
  return c;
}

async function choose(candidates, schoolName) {
  const fallback = pickPlanItems(candidates, 3).map((x) => ({ ...x, why: x.evidence }));
  if (candidates.length <= 1) return { items: fallback, summary: null, by: 'rules' };
  const out = await askJSON({
    maxTokens: 600,
    system:
      `You are the chief of staff for the principal of ${schoolName}, an Indian school. From the candidate list, choose the THREE that matter most today ` +
      `(urgent problems and things blocking other people first; money and children's wellbeing before paperwork). Return ` +
      `{"items":[{"key":"<candidate key, copied exactly>","why":"one plain sentence, max 160 characters, using only the candidate's evidence"}],"summary":"one short sentence for the whole day, max 160 characters"}. ` +
      'Only use keys from the list. Never invent numbers or names.',
    payload: { candidates: candidates.map(({ key, title, evidence, priority }) => ({ key, title, evidence, rule_priority: priority })) },
  });
  if (!out || !Array.isArray(out.items)) return { items: fallback, summary: null, by: 'rules' };
  const byKey = new Map(candidates.map((x) => [x.key, x]));
  const items = [];
  for (const it of out.items) {
    const cand = byKey.get(it?.key);
    if (!cand || items.some((x) => x.key === cand.key)) continue;
    items.push({ ...cand, why: String(it.why || cand.evidence).slice(0, 200) });
    if (items.length === 3) break;
  }
  if (!items.length) return { items: fallback, summary: null, by: 'rules' };
  return { items, summary: out.summary ? String(out.summary).slice(0, 200) : null, by: 'ai' };
}

export async function getPlan(schoolId, date) {
  const r = await pool.query('SELECT * FROM principal_daily_plans WHERE school_id = $1 AND plan_date = $2', [schoolId, date]);
  if (!r.rowCount) return null;
  const plan = r.rows[0];
  const ids = plan.items.map((i) => i.action_id).filter(Boolean);
  if (ids.length) {
    const acts = await pool.query('SELECT id, status, result FROM assistant_actions WHERE school_id = $1 AND id = ANY($2::int[])', [schoolId, ids]);
    const byId = new Map(acts.rows.map((a) => [a.id, a]));
    plan.items = plan.items.map((i) => (i.action_id ? { ...i, action_status: byId.get(i.action_id)?.status, action_result: byId.get(i.action_id)?.result } : i));
  }
  return plan;
}

// Builds (or with force, rebuilds) today's plan. A rebuild keeps any action
// already decided and withdraws the still-pending ones it replaces.
export async function buildPlanForSchool(schoolId, { today = istToday(), force = false, send = true } = {}) {
  const existing = await getPlan(schoolId, today);
  if (existing && !force) return { plan: existing, created: false };

  const school = await pool.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
  const schoolName = school.rows[0]?.name || 'the school';
  const candidates = await planCandidates(schoolId, today);
  const { items, summary, by } = await choose(candidates, schoolName);

  if (existing) {
    const stale = existing.items.filter((i) => i.action_id && i.action_status === 'pending').map((i) => i.action_id);
    if (stale.length) await pool.query(`UPDATE assistant_actions SET status = 'rejected', result = 'Withdrawn: replaced by a newer daily plan' WHERE school_id = $1 AND id = ANY($2::int[]) AND status = 'pending'`, [schoolId, stale]);
  }
  const stored = [];
  for (const it of items) {
    let actionId = null;
    if (it.action) {
      const a = await pool.query(
        `INSERT INTO assistant_actions (school_id, action_key, params, summary, source) VALUES ($1,$2,$3,$4,'daily_plan') RETURNING id`,
        [schoolId, it.action.key, JSON.stringify(it.action.params || {}), it.action.summary]
      );
      actionId = a.rows[0].id;
    }
    stored.push({ key: it.key, kind: it.kind, title: it.title, why: it.why, evidence: it.evidence, link: it.link, action_id: actionId, action_summary: it.action?.summary || null });
  }

  await pool.query(
    `INSERT INTO principal_daily_plans (school_id, plan_date, items, summary, generated_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (school_id, plan_date) DO UPDATE SET items = EXCLUDED.items, summary = EXCLUDED.summary, generated_by = EXCLUDED.generated_by, created_at = CURRENT_TIMESTAMP`,
    [schoolId, today, JSON.stringify(stored), summary, by]
  );

  let whatsappSent = 0;
  if (send && !existing) {
    if (stored.length) {
      const staff = await pool.query(`SELECT id FROM teachers WHERE school_id = $1 AND role IN ('principal','operator')`, [schoolId]);
      const body = stored.map((i, n) => `${n + 1}. ${i.title}`).join('\n');
      for (const t of staff.rows) {
        await pool.query(
          `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body, link)
           VALUES ($1, 'principal_daily_plan', 'staff', $2, 'dashboard', 'Today''s plan', $3, '/ops')`,
          [schoolId, t.id, body]
        );
      }
    }
    whatsappSent = (await sendPlanWhatsApp(schoolId, today, { schoolName, items: stored })).sent;
  }
  await audit({ schoolId, action: 'ai.daily_plan', detail: { date: today, candidates: candidates.length, items: stored.length, by, whatsapp_sent: whatsappSent, rebuilt: Boolean(existing) } });
  return { plan: await getPlan(schoolId, today), created: !existing, whatsapp_sent: whatsappSent };
}

const maskPhone = (p) => (p ? `••••${String(p).slice(-4)}` : '');

// Sends the plan to the principal / operator numbers from Control Center →
// Daily report and records, per number, whether Meta accepted it (and why
// not), so "did it go out?" is answered on the plan card itself. Returns
// { sent, results }. A quiet day still sends a short "nothing urgent" line so
// the principal knows the plan ran.
export async function sendPlanWhatsApp(schoolId, date, { schoolName, items } = {}) {
  if (!schoolName) {
    const school = await pool.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
    schoolName = school.rows[0]?.name || 'the school';
  }
  if (!items) items = (await getPlan(schoolId, date))?.items || [];
  const s = await pool.query('SELECT principal_digest_phone, operator_digest_phone FROM school_settings WHERE school_id = $1', [schoolId]);
  const phones = [...new Set([s.rows[0]?.principal_digest_phone, s.rows[0]?.operator_digest_phone].filter(Boolean))];
  const line = items.length ? planWhatsAppLine(items) : 'Nothing urgent today - all clear';
  const results = [];
  if (!phones.length) {
    results.push({ ok: false, error: 'No principal/operator WhatsApp number set in Control Center → Daily report.' });
  }
  for (const phone of phones) {
    try {
      await sendTemplateMessage(schoolId, phone, TEMPLATE, 'en', [toTemplateParam(schoolName, 100), line]);
      results.push({ phone: maskPhone(phone), ok: true });
    } catch (err) {
      const reason = err.response?.data?.error?.message || err.message;
      console.error(`[daily plan] WhatsApp send failed for school ${schoolId}:`, reason);
      results.push({ phone: maskPhone(phone), ok: false, error: String(reason).slice(0, 300) });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  await pool.query(
    'UPDATE principal_daily_plans SET whatsapp_sent = $3, whatsapp_result = $4, whatsapp_sent_at = CURRENT_TIMESTAMP WHERE school_id = $1 AND plan_date = $2',
    [schoolId, date, sent, JSON.stringify(results)]
  );
  return { sent, results };
}

export async function runDailyPlans() {
  const schools = await pool.query(
    `SELECT s.id FROM schools s LEFT JOIN school_settings ss ON ss.school_id = s.id
      WHERE s.status = 'active' AND COALESCE(ss.daily_plan_enabled, TRUE) = TRUE AND ${AI_SCHOOLS_SQL}`
  );
  let processed = 0;
  let failed = 0;
  for (const s of schools.rows) {
    try {
      await buildPlanForSchool(s.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[daily plan] school ${s.id} failed:`, err.message);
    }
  }
  return { processed, failed };
}
