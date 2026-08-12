import pool from '../config/db.js';
import { sendTextMessage, sendMediaMessage } from './whatsappService.js';

// Sends a class note to every OPTED_IN parent with a PENDING delivery row for
// it. Previously queued (classNoteQueue.add) for workers/classNoteWorker.js
// to process — moved here and called inline for the same reason as
// studentNoteService.js / routes/attendance.js: a BullMQ worker needs a
// persistent process to run, which Vercel serverless functions don't provide
// between requests, so queued sends were not reliably going out.
export async function sendClassNoteNow(noteId) {
  const noteRes = await pool.query(
    `SELECT cn.*, s.name AS subject_name FROM class_notes cn
     LEFT JOIN subjects s ON cn.subject_id = s.id WHERE cn.id = $1`,
    [noteId]
  );
  if (noteRes.rowCount === 0) return { skipped: 'note_not_found' };
  const note = noteRes.rows[0];

  const deliveries = await pool.query(
    `SELECT cnd.id AS delivery_id, p.id AS parent_id, p.phone, p.opt_in_status
     FROM class_note_deliveries cnd
     JOIN parents p ON cnd.parent_id = p.id
     WHERE cnd.note_id = $1 AND cnd.status = 'PENDING'`,
    [noteId]
  );

  const formattedMessage = `*${note.title}*\n\n${note.body_text || ''}`;

  // Sent in parallel rather than one at a time so a class of 40 parents
  // doesn't serialize into one slow request.
  const results = await Promise.all(
    deliveries.rows.map(async (row) => {
      if (row.opt_in_status !== 'OPTED_IN') {
        await pool.query(`UPDATE class_note_deliveries SET status = 'SKIPPED_NOT_OPTED_IN' WHERE id = $1`, [row.delivery_id]);
        return { parentId: row.parent_id, status: 'SKIPPED_NOT_OPTED_IN' };
      }

      try {
        if (note.attachment_url) {
          await sendMediaMessage(row.phone, note.attachment_url, formattedMessage);
        } else {
          await sendTextMessage(row.phone, formattedMessage);
        }
        await pool.query(`UPDATE class_note_deliveries SET status = 'SENT', sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.delivery_id]);
        return { parentId: row.parent_id, status: 'SENT' };
      } catch (err) {
        console.error(`[classNoteService] delivery failed for parent ${row.parent_id}:`, err.message);
        await pool.query(`UPDATE class_note_deliveries SET status = 'FAILED' WHERE id = $1`, [row.delivery_id]);
        return { parentId: row.parent_id, status: 'FAILED', error: err.message };
      }
    })
  );

  await pool.query(`UPDATE class_notes SET sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [noteId]);

  return { sent: results.filter((r) => r.status === 'SENT').length, results };
}
