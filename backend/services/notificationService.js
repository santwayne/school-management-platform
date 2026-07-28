import pool from '../config/db.js';
import { sendTemplateMessage, sendMediaMessage } from './whatsappService.js';

// ------------------------------------------------------------------
// Central notification service. Every module (attendance, fees, homework,
// exams, payroll, activities) should call notificationService.send()
// instead of calling whatsappService or inserting dashboard rows directly.
//
// Design notes / constraints carried over from the rest of the codebase:
// - WhatsApp Business API requires a Meta-APPROVED template for the first
//   message in a 24h conversation window (see workers/attendanceWorker.js).
//   So `variables` get mapped into the template's positional {{1}} {{2}}...
//   slots via whatsapp_param_order — they are NOT free-form text.
// - Dashboard notifications are ALWAYS written, even if WhatsApp fails or
//   there's no approved template configured yet — a failed/missing WhatsApp
//   channel must never block the in-app feed.
// - Parents have no web login in Waynur (see schema.sql comment above
//   notification_templates) — for recipient_type='parent' the WhatsApp
//   send IS the notification. The dashboard_notifications row is still
//   written for audit/history and in case a parent portal exists later.
// ------------------------------------------------------------------

async function getTemplate(schoolId, triggerEvent) {
  const { rows } = await pool.query(
    `SELECT * FROM notification_templates
      WHERE trigger_event = $1 AND (school_id = $2 OR school_id IS NULL)
      ORDER BY school_id NULLS LAST
      LIMIT 1`,
    [triggerEvent, schoolId]
  );
  return rows[0] || null;
}

function fillTemplate(text, variables) {
  if (!text) return text;
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key) => (variables[key] !== undefined ? variables[key] : ''));
}

// Resolves a recipient descriptor ({type, studentId|teacherId|parentId}) to
// { dashboardRecipientId, studentId, phone, optedIn, language }.
async function resolveRecipient(schoolId, recipient) {
  if (recipient.type === 'parent') {
    const { rows } = await pool.query(
      `SELECT p.id AS parent_id, p.phone, p.opt_in_status, p.preferred_language, s.id AS student_id, s.name AS student_name
         FROM students s JOIN parents p ON p.id = s.parent_id
        WHERE s.id = $1 AND s.school_id = $2`,
      [recipient.studentId, schoolId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      recipientType: 'parent',
      recipientId: row.parent_id,
      studentId: row.student_id,
      phone: row.phone,
      optedIn: row.opt_in_status === 'OPTED_IN',
      language: row.preferred_language === 'pa' ? 'pa' : 'hi',
      studentName: row.student_name,
    };
  }

  if (recipient.type === 'staff') {
    const { rows } = await pool.query(
      `SELECT id, whatsapp_number, whatsapp_opt_in_status, name FROM teachers WHERE id = $1 AND school_id = $2`,
      [recipient.teacherId, schoolId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      recipientType: 'staff',
      recipientId: row.id,
      studentId: null,
      phone: row.whatsapp_number,
      optedIn: row.whatsapp_opt_in_status === 'OPTED_IN',
      language: 'en',
      studentName: null,
    };
  }

  if (recipient.type === 'student') {
    const { rows } = await pool.query(`SELECT id, name FROM students WHERE id = $1 AND school_id = $2`, [
      recipient.studentId,
      schoolId,
    ]);
    if (rows.length === 0) return null;
    // Students have no WhatsApp number of their own in this platform —
    // dashboard-only channel regardless of what the template requests.
    return {
      recipientType: 'student',
      recipientId: rows[0].id,
      studentId: rows[0].id,
      phone: null,
      optedIn: false,
      language: 'en',
      studentName: rows[0].name,
    };
  }

  return null;
}

/**
 * notificationService.send({ triggerEvent, recipients, variables, attachments, batchKey })
 *
 * recipients: [{ type: 'parent'|'staff'|'student', studentId?, teacherId? }]
 * variables: flat object merged with per-recipient context (student_name is
 *            auto-filled from the resolved recipient if not passed explicitly)
 * attachments: [{ url, type }] optional — sent as WhatsApp media after the
 *              template message, when the template's media_supported = true
 * batchKey: optional string to group a fan-out send (e.g. 'activity:42')
 * link: optional deep-link the notification bell should navigate to when
 *       clicked (e.g. a specific message thread) — falls back to a generic
 *       destination on the frontend when omitted.
 *
 * Returns { sent, failed, skipped } counts.
 */
export async function send({ triggerEvent, recipients, variables = {}, attachments = [], batchKey = null, link = null, schoolId }) {
  if (!schoolId) throw new Error('notificationService.send requires schoolId');
  if (!recipients || recipients.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const template = await getTemplate(schoolId, triggerEvent);
  if (!template) {
    console.warn(`[NotificationService] No template configured for trigger_event="${triggerEvent}" — dashboard-only fallback with no title/body.`);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const resolved = await resolveRecipient(schoolId, recipient);
    if (!resolved) {
      skipped += 1;
      continue;
    }

    const mergedVars = { student_name: resolved.studentName, ...variables };
    const wantsWhatsapp = template && (template.channel === 'whatsapp' || template.channel === 'both');
    const canWhatsapp = wantsWhatsapp && resolved.phone && resolved.optedIn && template.whatsapp_template_name;

    let whatsappStatus = 'not_applicable';
    let whatsappMessageId = null;
    let errorMessage = null;

    if (canWhatsapp) {
      try {
        const paramOrder = Array.isArray(template.whatsapp_param_order) ? template.whatsapp_param_order : [];
        const params = paramOrder.map((key) => mergedVars[key] ?? '');
        const result = await sendTemplateMessage(resolved.phone, template.whatsapp_template_name, resolved.language, params);
        whatsappStatus = 'sent';
        whatsappMessageId = result?.messages?.[0]?.id || null;

        if (template.media_supported && attachments.length > 0) {
          for (const att of attachments) {
            await sendMediaMessage(resolved.phone, att.url, mergedVars.title || '').catch((mediaErr) => {
              console.error(`[NotificationService] media send failed for ${triggerEvent}:`, mediaErr.message);
            });
          }
        }
      } catch (err) {
        console.error(`[NotificationService] WhatsApp send failed for ${triggerEvent} -> recipient ${resolved.recipientType}:${resolved.recipientId}:`, err.message);
        whatsappStatus = 'failed';
        errorMessage = err.message;
      }
    } else if (wantsWhatsapp) {
      // Wanted WhatsApp but couldn't (not opted in / no phone / no approved
      // template configured yet) — this must NOT block the dashboard row.
      whatsappStatus = 'not_applicable';
    }

    const title = template ? fillTemplate(template.dashboard_title_template, mergedVars) : null;
    const body = template ? fillTemplate(template.dashboard_body_template, mergedVars) : null;

    try {
      await pool.query(
        `INSERT INTO dashboard_notifications
           (school_id, template_id, trigger_event, recipient_type, recipient_id, student_id,
            channel_used, title, body, payload_sent, whatsapp_status, whatsapp_message_id,
            error_message, batch_key, link, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)`,
        [
          schoolId, template?.id || null, triggerEvent, resolved.recipientType, resolved.recipientId,
          resolved.studentId, template?.channel || 'dashboard', title, body,
          JSON.stringify({ variables: mergedVars, attachments }), whatsappStatus, whatsappMessageId,
          errorMessage, batchKey, link,
        ]
      );
      if (whatsappStatus === 'failed') failed += 1;
      else sent += 1;
    } catch (err) {
      console.error('[NotificationService] Failed to write dashboard_notifications row:', err.message);
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}

export default { send };
