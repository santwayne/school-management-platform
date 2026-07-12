import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTextMessage, sendMediaMessage } from '../services/whatsappService.js';

const worker = new Worker(
  'ClassNoteQueue',
  async (job) => {
    const { noteId } = job.data;

    const noteRes = await pool.query(
      `SELECT cn.*, s.name AS subject_name FROM class_notes cn
       LEFT JOIN subjects s ON cn.subject_id = s.id WHERE cn.id = $1`,
      [noteId]
    );
    if (noteRes.rowCount === 0) return;
    const note = noteRes.rows[0];

    const deliveries = await pool.query(
      `SELECT cnd.id AS delivery_id, p.id AS parent_id, p.phone, p.opt_in_status
       FROM class_note_deliveries cnd
       JOIN parents p ON cnd.parent_id = p.id
       WHERE cnd.note_id = $1 AND cnd.status = 'PENDING'`,
      [noteId]
    );

    for (const row of deliveries.rows) {
      if (row.opt_in_status !== 'OPTED_IN') {
        await pool.query(`UPDATE class_note_deliveries SET status = 'SKIPPED_NOT_OPTED_IN' WHERE id = $1`, [row.delivery_id]);
        continue;
      }

      try {
        const formattedMessage = `*${note.title}*\n\n${note.body_text || ''}`;

        if (note.attachment_url) {
          await sendMediaMessage(row.phone, note.attachment_url, formattedMessage);
        } else {
          await sendTextMessage(row.phone, formattedMessage);
        }

        await pool.query(`UPDATE class_note_deliveries SET status = 'SENT', sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.delivery_id]);
      } catch (err) {
        console.error(`Class note delivery failed for parent ${row.parent_id}:`, err.message);
        await pool.query(`UPDATE class_note_deliveries SET status = 'FAILED' WHERE id = $1`, [row.delivery_id]);
      }
    }

    await pool.query(`UPDATE class_notes SET sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [noteId]);
  },
  { connection }
);

export default worker;
