import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { send as sendNotification } from '../services/notificationService.js';
import { formatNotifyDate } from '../utils/notifyDate.js';
import { DEFAULT_LIBRARY_DIGEST_TEMPLATE, libraryDigestParams } from '../utils/messageFormat.js';
import { CLASS_LABEL_SQL } from '../utils/classLabel.js';

// Meta requires an approved template for the first outbound message in a
// conversation window — same reasoning as attendanceWorker/dailyGuidanceWorker.
// Which Meta template the librarian's digest uses. The default names the
// overdue books; see libraryDigestParams for the variables and for how the
// earlier counts-only template can still be selected with this env var.
const LIBRARY_DIGEST_TEMPLATE = process.env.WHATSAPP_LIBRARY_DIGEST_TEMPLATE || DEFAULT_LIBRARY_DIGEST_TEMPLATE;

// Once a book is overdue, don't re-notify the same loan every single day —
// space repeat nudges out, same spacing idea as fee_reminder_interval_days.
const OVERDUE_RENOTIFY_DAYS = 3;

const libraryWorker = new Worker(
  'LibraryQueue',
  async (job) => {
    if (job.name === 'dailyLibraryDigest') {
      await handleDailyDigest();
      return handlePerStudentReminders();
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
            COALESCE(s.name, t.name) AS borrower_name,
            ${CLASS_LABEL_SQL} AS class_name,
            (CURRENT_DATE - li.due_date) AS days_late
     FROM library_issues li
     JOIN library_books lb ON lb.id = li.book_id
     LEFT JOIN students s ON s.id = li.student_id
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN teachers t ON t.id = li.teacher_id
     WHERE li.status IN ('ISSUED', 'OVERDUE')
       AND (li.due_date <= CURRENT_DATE + INTERVAL '1 day')
     ORDER BY li.due_date ASC, li.id ASC`
  );

  const bySchool = {};
  for (const row of rows.rows) {
    if (!bySchool[row.school_id]) bySchool[row.school_id] = { dueSoon: 0, overdueItems: [] };
    // Oldest first (see ORDER BY), so the longest-overdue books lead the list.
    if (row.status === 'OVERDUE') {
      bySchool[row.school_id].overdueItems.push({
        title: row.title,
        borrower: row.borrower_name,
        className: row.class_name,
        daysLate: row.days_late,
      });
    } else bySchool[row.school_id].dueSoon += 1;
  }

  for (const schoolId of Object.keys(bySchool)) {
    const digest = bySchool[schoolId];
    // Only when there is something for the librarian to chase. Books merely
    // due today/tomorrow already got a reminder to the parent (below), and a
    // daily "1 due soon, 0 overdue" was noise with nothing to act on.
    if (digest.overdueItems.length === 0) continue;
    const params = libraryDigestParams(LIBRARY_DIGEST_TEMPLATE, digest);

    const contacts = await pool.query(
      `SELECT whatsapp_number FROM library_contacts WHERE school_id = $1`,
      [schoolId]
    );

    for (const contact of contacts.rows) {
      try {
        await sendTemplateMessage(schoolId, contact.whatsapp_number, LIBRARY_DIGEST_TEMPLATE, 'en', params);
      } catch (err) {
        console.error(`Library digest send failed for school ${schoolId}:`, err.message);
      }
    }
  }
}

// The digest above tells library staff "3 due soon, 1 overdue" in aggregate
// — it never told any specific parent or student which book, or that it
// was theirs. This is the actual per-loan notification, fanned out to
// {type:'parent'} + {type:'student'} for the borrowing student through the
// shared NotificationService — same trigger_event either way, so the
// parent gets a WhatsApp message (if opted in / phone on file) and the
// student sees the identical alert in their portal's notification bell,
// automatically, since 'student' recipients are always dashboard-only
// (see notificationService.js's resolveRecipient — no WhatsApp number
// exists for students in this platform).
//
// Teacher-borrowed books are intentionally NOT covered here (only
// student_id-linked loans) — the aggregate staff digest above already
// surfaces those in the counts a librarian sees.
async function handlePerStudentReminders() {
  const { rows } = await pool.query(
    `SELECT li.id, li.school_id, li.student_id, li.status, li.due_date, lb.title
     FROM library_issues li
     JOIN library_books lb ON lb.id = li.book_id
     WHERE li.status IN ('ISSUED', 'OVERDUE')
       AND li.student_id IS NOT NULL
       AND li.due_date <= CURRENT_DATE + INTERVAL '1 day'
       AND (
         li.last_reminder_sent_at IS NULL
         -- first day overdue: the last reminder said "due soon", so tell the
         -- parent it is now overdue instead of waiting out the 3-day spacing
         OR (li.status = 'OVERDUE' AND li.last_reminder_sent_at < li.due_date + INTERVAL '1 day')
         OR (li.status = 'OVERDUE' AND li.last_reminder_sent_at < CURRENT_DATE - ($1 || ' days')::interval)
       )`,
    [OVERDUE_RENOTIFY_DAYS]
  );

  for (const row of rows) {
    const statusLabel = row.status === 'OVERDUE' ? 'overdue' : 'due soon';
    try {
      await sendNotification({
        triggerEvent: 'library_book_reminder',
        schoolId: row.school_id,
        recipients: [
          { type: 'parent', studentId: row.student_id },
          { type: 'student', studentId: row.student_id },
        ],
        variables: {
          book_title: row.title,
          status_label: statusLabel,
          due_date: formatNotifyDate(row.due_date),
        },
      });
      await pool.query('UPDATE library_issues SET last_reminder_sent_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
    } catch (err) {
      console.error(`Library per-loan reminder failed for library_issues.id=${row.id}:`, err.message);
    }
  }
}

libraryWorker.on('failed', (job, err) => {
  console.error(`LibraryQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default libraryWorker;
