import { Worker } from 'bullmq';
import { connection, attendanceQueue, ESCALATION_DELAY_MS } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { triggerEscalationCall } from '../services/voiceService.js';

// Meta requires an approved template for the first outbound message in a
// conversation window — this name must match a template approved in the
// WhatsApp Business Manager for this number.
const ABSENCE_TEMPLATE_NAME = process.env.WHATSAPP_ABSENCE_TEMPLATE || 'student_absence_alert';

const attendanceWorker = new Worker(
  'AttendanceQueue',
  async (job) => {
    if (job.name === 'sendAbsentNotification') {
      return handleSendNotification(job.data);
    }
    if (job.name === 'escalateToVoiceCall') {
      return handleEscalation(job.data);
    }
    console.warn(`Unknown job name on AttendanceQueue: ${job.name}`);
  },
  { connection }
);

async function handleSendNotification({ attendanceId, parentId, parentPhone, parentLanguage, studentName }) {
  let status = 'SENT';
  try {
    await sendTemplateMessage(parentPhone, ABSENCE_TEMPLATE_NAME, parentLanguage === 'pa' ? 'pa' : 'hi', [
      studentName,
    ]);
  } catch (err) {
    console.error(`WhatsApp send failed for attendance ${attendanceId}:`, err.message);
    status = 'FAILED';
  }

  const logRes = await pool.query(
    `INSERT INTO notification_log (attendance_id, parent_id, type, status)
     VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
    [attendanceId, parentId, status]
  );
  const notificationLogId = logRes.rows[0].id;

  // Schedule the escalation check — if the WhatsApp send failed outright,
  // still escalate, since the parent never got any alert at all.
  await attendanceQueue.add(
    'escalateToVoiceCall',
    { attendanceId, parentId, parentPhone, parentLanguage, studentName, notificationLogId },
    { delay: ESCALATION_DELAY_MS }
  );
}

async function handleEscalation({ parentId, parentPhone, parentLanguage, studentName, notificationLogId }) {
  // If the parent already replied within the window, cancel the escalation.
  const logRes = await pool.query('SELECT status, replied_at FROM notification_log WHERE id = $1', [
    notificationLogId,
  ]);
  const log = logRes.rows[0];
  if (log && (log.replied_at || log.status === 'REPLIED')) {
    console.log(`Notification ${notificationLogId} already replied to — skipping voice escalation.`);
    return;
  }

  let outcome = 'triggered';
  let vapiCallId = null;
  try {
    const call = await triggerEscalationCall(parentPhone, { studentName, language: parentLanguage });
    vapiCallId = call.id || null;
  } catch (err) {
    console.error(`Voice escalation call failed for parent ${parentId}:`, err.message);
    outcome = 'failed';
  }

  await pool.query(`UPDATE notification_log SET status = 'ESCALATED' WHERE id = $1`, [notificationLogId]);

  await pool.query(
    `INSERT INTO call_outcomes (notification_log_id, vapi_call_id, outcome)
     VALUES ($1, $2, $3)`,
    [notificationLogId, vapiCallId, outcome]
  );
}

attendanceWorker.on('failed', (job, err) => {
  console.error(`AttendanceQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default attendanceWorker;
