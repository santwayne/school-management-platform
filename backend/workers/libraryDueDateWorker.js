import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';

// Meta requires an approved template for the first outbound message in a
// conversation window — same reasoning as attendanceWorker/dailyGuidanceWorker.
const LIBRARY_DIGEST_TEMPLATE = process.env.WHATSAPP_LIBRARY_DIGEST_TEMPLATE || 'library_due_digest';

const libraryWorker = new Worker(
  'LibraryQueue',
  async (job) => {
    if (job.name === 'dailyLibraryDigest') {
      return handleDailyDigest();
    }
    console.warn(`Unknown job name on LibraryQueue: ${job.name}`);
  },
  { connection }
);

async function handleDailyDigest() {
  // Anything past due_date and still ISSUED is now OVERDUE. AI does this
  // calculation — no human marks books overdue manually.
  await pool.query(
    `UPDATE library_issues SET status = 'OVERDUE'
     WHERE status = 'ISSUED' AND due_date < CURRENT_DATE`
  );

  // Books due today/tomorrow (reminder window) or already overdue, per school.
  const rows = await pool.query(
    `SELECT li.school_id, li.status, li.due_date, lb.title,
            COALESCE(s.name, t.name) AS borrower_name
     FROM library_issues li
     JOIN library_books lb ON lb.id = li.book_id
     LEFT JOIN students s ON s.id = li.student_id
     LEFT JOIN teachers t ON t.id = li.teacher_id
     WHERE li.status IN ('ISSUED', 'OVERDUE')
       AND (li.due_date <= CURRENT_DATE + INTERVAL '1 day')`
  );

  const bySchool = {};
  for (const row of rows.rows) {
    if (!bySchool[row.school_id]) bySchool[row.school_id] = { dueSoon: 0, overdue: 0 };
    if (row.status === 'OVERDUE') bySchool[row.school_id].overdue += 1;
    else bySchool[row.school_id].dueSoon += 1;
  }

  for (const schoolId of Object.keys(bySchool)) {
    const { dueSoon, overdue } = bySchool[schoolId];
    if (dueSoon === 0 && overdue === 0) continue;

    const contacts = await pool.query(
      `SELECT whatsapp_number FROM library_contacts WHERE school_id = $1`,
      [schoolId]
    );

    for (const contact of contacts.rows) {
      try {
        await sendTemplateMessage(contact.whatsapp_number, LIBRARY_DIGEST_TEMPLATE, 'en', [
          String(dueSoon),
          String(overdue),
        ]);
      } catch (err) {
        console.error(`Library digest send failed for school ${schoolId}:`, err.message);
      }
    }
  }
}

libraryWorker.on('failed', (job, err) => {
  console.error(`LibraryQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default libraryWorker;
