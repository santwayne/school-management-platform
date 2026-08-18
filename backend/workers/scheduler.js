import { guidanceQueue, teacherAttendanceQueue, gpsPollQueue, libraryQueue, feeReminderQueue, pettyCashReminderQueue, staffLeaveReminderQueue } from '../config/queue.js';

// The worker only reacts to jobs that land on GuidanceQueue — nothing put
// any there before. This registers a repeatable job so it actually fires
// every morning instead of the worker sitting idle forever.
export async function scheduleDailyGuidance() {
  await guidanceQueue.add(
    'dailyNudge',
    {},
    {
      repeat: { pattern: process.env.GUIDANCE_CRON || '0 7 * * *' }, // 7:00 AM daily, server timezone
      removeOnComplete: true,
      jobId: 'daily-guidance-nudge', // prevents duplicate repeatables on restart
    }
  );
  console.log('Daily guidance job scheduled.');
}

// Rolls up the day's raw punch events into teacher_attendance_daily, once a
// day late at night so the day's punches are all in.
export async function scheduleTeacherAttendanceAggregation() {
  await teacherAttendanceQueue.add(
    'aggregateDaily',
    {},
    {
      repeat: { pattern: process.env.ATTENDANCE_AGGREGATION_CRON || '0 22 * * *' }, // 10:00 PM daily
      removeOnComplete: true,
      jobId: 'daily-teacher-attendance-aggregation',
    }
  );
  console.log('Daily teacher attendance aggregation job scheduled.');
}

// Marks overdue books and sends a due/overdue WhatsApp digest to every
// registered library contact — mirrors the daily guidance job's pattern.
export async function scheduleLibraryDigest() {
  await libraryQueue.add(
    'dailyLibraryDigest',
    {},
    {
      repeat: { pattern: process.env.LIBRARY_DIGEST_CRON || '0 8 * * *' }, // 8:00 AM daily
      removeOnComplete: true,
      jobId: 'daily-library-digest',
    }
  );
  console.log('Daily library digest job scheduled.');
}

// Automatic fee-payment reminders — mirrors the daily library digest job's
// pattern. 9:00 AM (after the library digest at 8:00) so a school's morning
// WhatsApp sends don't all land in the exact same minute.
export async function scheduleFeeReminders() {
  await feeReminderQueue.add(
    'dailyFeeReminders',
    {},
    {
      repeat: { pattern: process.env.FEE_REMINDER_CRON || '0 9 * * *' }, // 9:00 AM daily
      removeOnComplete: true,
      jobId: 'daily-fee-reminders',
    }
  );
  console.log('Daily fee reminder job scheduled.');
}

// Petty cash pending reminder — 9:30 AM, after the fee reminder job.
export async function schedulePettyCashReminders() {
  await pettyCashReminderQueue.add(
    'dailyPettyCashReminders',
    {},
    {
      repeat: { pattern: process.env.PETTY_CASH_REMINDER_CRON || '30 9 * * *' }, // 9:30 AM daily
      removeOnComplete: true,
      jobId: 'daily-petty-cash-reminders',
    }
  );
  console.log('Daily petty cash reminder job scheduled.');
}

// Staff leave pending reminder — 10:00 AM, after the petty cash reminder job.
export async function scheduleStaffLeaveReminders() {
  await staffLeaveReminderQueue.add(
    'dailyStaffLeaveReminders',
    {},
    {
      repeat: { pattern: process.env.STAFF_LEAVE_REMINDER_CRON || '0 10 * * *' }, // 10:00 AM daily
      removeOnComplete: true,
      jobId: 'daily-staff-leave-reminders',
    }
  );
  console.log('Daily staff leave reminder job scheduled.');
}

// Polls pull-based-vendor buses every 30s for their current location.
export async function scheduleGpsPolling() {
  await gpsPollQueue.add(
    'pollBuses',
    {},
    {
      repeat: { every: 30 * 1000 },
      removeOnComplete: true,
      jobId: 'gps-poll-buses',
    }
  );
  console.log('GPS bus polling job scheduled.');
}
