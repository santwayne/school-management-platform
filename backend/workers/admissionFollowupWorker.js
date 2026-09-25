import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { recordRun, raiseException, audit } from '../services/opsService.js';
import { formatSlot } from '../services/admissionAgent.js';

// ------------------------------------------------------------------
// Every 30 min:
//  1. Follow-ups: enquiries that went quiet get a reminder on day 1, 3 and 7
//     (school_settings.admission_followup_days), then are marked lost.
//  2. Visit reminders: 24 h and 2 h before a booked campus visit.
//  3. Visit outcome: 3 h after a visit ends, ask the operator whether the
//     family came (one-click attended / no-show).
//
// These are business-initiated messages outside the 24 h window, so they
// MUST be approved templates (Utility category):
//   admission_followup  {{1}} parent name, {{2}} school name
//     "Hi {{1}}, this is {{2}}. Do you have any questions about admission? Reply here and we'll help. Reply STOP to opt out."
//   visit_reminder      {{1}} parent name, {{2}} school name, {{3}} date/time
//     "Hi {{1}}, a reminder of your visit to {{2}} on {{3}}. Reply here if you need to change the time."
// ------------------------------------------------------------------

const FOLLOWUP_TEMPLATE = process.env.WHATSAPP_ADMISSION_FOLLOWUP_TEMPLATE || 'admission_followup';
const VISIT_TEMPLATE = process.env.WHATSAPP_VISIT_REMINDER_TEMPLATE || 'visit_reminder';

export function followupPlan(daysCsv) {
  const days = String(daysCsv || '1,3,7')
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  return days.length ? days : [1, 3, 7];
}

// Hours from the previous follow-up to the next one, given the plan and how
// many have already been sent. null = plan finished.
export function hoursUntilNext(plan, sentCount) {
  if (sentCount >= plan.length) return null;
  const prevDay = sentCount === 0 ? 0 : plan[sentCount - 1];
  return (plan[sentCount] - prevDay) * 24;
}

async function sendAndLog(e, template, params, label) {
  try {
    await sendTemplateMessage(e.phone.replace(/^\+/, ''), template, 'en', params);
    await pool.query(
      `INSERT INTO enquiry_messages (school_id, enquiry_id, direction, body, template_name, sent_by, delivery_status) VALUES ($1,$2,'out',$3,$4,'system','sent')`,
      [e.school_id, e.id, label, template]
    );
    return true;
  } catch (err) {
    await pool.query(
      `INSERT INTO enquiry_messages (school_id, enquiry_id, direction, body, template_name, sent_by, delivery_status) VALUES ($1,$2,'out',$3,$4,'system','failed')`,
      [e.school_id, e.id, label, template]
    );
    console.error(`[admissionFollowup] ${template} failed for enquiry ${e.id}:`, err.response?.data?.error?.message || err.message);
    return false;
  }
}

export async function runAdmissionFollowups() {
  let sent = 0;
  let failed = 0;

  // 1. Follow-ups for quiet enquiries.
  const due = await pool.query(
    `SELECT e.*, s.name AS school_name, COALESCE(ss.admission_followup_days, '1,3,7') AS plan
     FROM admission_enquiries e JOIN schools s ON s.id = e.school_id LEFT JOIN school_settings ss ON ss.school_id = e.school_id
     WHERE e.stage IN ('new', 'qualifying', 'qualified') AND NOT e.opted_out
       AND (e.ai_paused_until IS NULL OR e.ai_paused_until < NOW())
       AND e.next_followup_at IS NOT NULL AND e.next_followup_at <= NOW()
     LIMIT 200`
  );
  for (const e of due.rows) {
    const plan = followupPlan(e.plan);
    if (e.followup_count >= plan.length) {
      await pool.query(`UPDATE admission_enquiries SET stage = 'lost', lost_reason = 'no_response', next_followup_at = NULL, updated_at = NOW() WHERE id = $1`, [e.id]);
      await audit({ schoolId: e.school_id, action: 'admission.lost', entityType: 'enquiry', entityId: e.id, detail: { reason: 'no_response' } });
      continue;
    }
    const ok = await sendAndLog(e, FOLLOWUP_TEMPLATE, [e.parent_name || 'there', e.school_name], `[Follow-up ${e.followup_count + 1}]`);
    ok ? sent++ : failed++;
    const nextHours = hoursUntilNext(plan, e.followup_count + 1);
    await pool.query(
      `UPDATE admission_enquiries SET followup_count = followup_count + 1,
              next_followup_at = CASE WHEN $2::int IS NULL THEN NOW() + INTERVAL '2 days' ELSE NOW() + make_interval(hours => $2::int) END
       WHERE id = $1`,
      [e.id, nextHours]
    );
  }

  // 2. Visit reminders (slot times are IST wall-clock).
  const reminders = await pool.query(
    `SELECT v.id AS visit_id, v.reminded_24h, v.reminded_2h, cs.slot_start, e.*, s.name AS school_name,
            (cs.slot_start <= (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '2 hours') AS within_2h
     FROM campus_visits v JOIN campus_visit_slots cs ON cs.id = v.slot_id
     JOIN admission_enquiries e ON e.id = v.enquiry_id JOIN schools s ON s.id = e.school_id
     WHERE v.status = 'booked' AND NOT e.opted_out
       AND cs.slot_start > (NOW() AT TIME ZONE 'Asia/Kolkata')
       AND ((NOT v.reminded_24h AND cs.slot_start <= (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '24 hours')
         OR (NOT v.reminded_2h AND cs.slot_start <= (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '2 hours'))`
  );
  for (const r of reminders.rows) {
    const ok = await sendAndLog(r, VISIT_TEMPLATE, [r.parent_name || 'there', r.school_name, formatSlot(r.slot_start)], `[Visit reminder]`);
    ok ? sent++ : failed++;
    // Mark both flags when we're already inside 2 h, so a late booking
    // doesn't get two reminders in one run.
    await pool.query(
      `UPDATE campus_visits SET reminded_24h = TRUE, reminded_2h = reminded_2h OR $2 WHERE id = $1`,
      [r.visit_id, r.within_2h || r.reminded_24h]
    );
  }

  // 3. Ask the operator about visits that have ended.
  const ended = await pool.query(
    `SELECT v.id AS visit_id, e.id, e.school_id, e.parent_name, e.child_name, e.phone, cs.slot_start
     FROM campus_visits v JOIN campus_visit_slots cs ON cs.id = v.slot_id JOIN admission_enquiries e ON e.id = v.enquiry_id
     WHERE v.status = 'booked' AND cs.slot_end + INTERVAL '3 hours' < (NOW() AT TIME ZONE 'Asia/Kolkata')`
  );
  for (const v of ended.rows) {
    await raiseException({
      schoolId: v.school_id,
      source: 'admission',
      severity: 'low',
      title: `Did ${v.parent_name || v.phone}${v.child_name ? ` (${v.child_name})` : ''} come for the campus visit?`,
      body: `Visit was booked for ${formatSlot(v.slot_start)}. Mark it so follow-ups go right: families who visited get the application link, no-shows get a reschedule message.`,
      entityType: 'enquiry',
      entityId: v.id,
      suggestedAction: { label: 'Yes, they visited', action: 'admission.visit_attended', params: { visit_id: v.visit_id } },
      dedupeKey: `visit_outcome:${v.visit_id}`,
    });
  }

  return { sent, failed };
}

const worker = new Worker(
  'AdmissionFollowupQueue',
  async (job) => {
    if (job.name === 'admissionFollowups') return runAdmissionFollowups();
  },
  { connection }
);
worker.on('failed', (job, err) => console.error(`AdmissionFollowupQueue job ${job?.id} failed:`, err.message));

export default worker;
