import { guidanceQueue, teacherAttendanceQueue, gpsPollQueue, libraryQueue, feeReminderQueue, pettyCashReminderQueue, staffLeaveReminderQueue, teachingReminderQueue, lowAttendanceAlertQueue, eventReminderQueue, performanceDriftQueue, weeklyProgressSummaryQueue } from '../config/queue.js';

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

// Polls every ~10 min for timetable periods about to start and reminds the
// assigned teacher — see workers/teachingReminderWorker.js for why this
// polls timetable_slots/lesson_plans instead of extending the existing
// (daily, not period-aware, and — per schema.sql's note — effectively
// broken today) GuidanceQueue/dailyGuidanceWorker.js.
export async function scheduleTeachingReminders() {
  await teachingReminderQueue.add(
    'checkUpcomingClasses',
    {},
    {
      repeat: { every: 10 * 60 * 1000 },
      removeOnComplete: true,
      jobId: 'teaching-reminder-poll',
    }
  );
  console.log('Upcoming-class teacher reminder polling job scheduled.');
}

// Low-attendance rolling-threshold check — weekly (Monday morning) rather
// than daily, since the underlying percentage barely moves day to day and
// a daily check would just be re-querying the same slow-moving number.
export async function scheduleLowAttendanceAlerts() {
  await lowAttendanceAlertQueue.add(
    'weeklyLowAttendanceCheck',
    {},
    {
      repeat: { pattern: process.env.LOW_ATTENDANCE_ALERT_CRON || '15 8 * * 1' }, // Monday 8:15 AM
      removeOnComplete: true,
      jobId: 'weekly-low-attendance-check',
    }
  );
  console.log('Weekly low-attendance alert job scheduled.');
}

// Upcoming-event parent reminder — daily, 8:45 AM (after the other morning jobs).
export async function scheduleEventReminders() {
  await eventReminderQueue.add(
    'dailyEventReminders',
    {},
    {
      repeat: { pattern: process.env.EVENT_REMINDER_CRON || '45 8 * * *' }, // 8:45 AM daily
      removeOnComplete: true,
      jobId: 'daily-event-reminders',
    }
  );
  console.log('Daily event reminder job scheduled.');
}

// Weekly performance-snapshot computation, Sunday night (after the school
// week ends) so the Principal Dashboard has fresh drift flags Monday morning.
export async function schedulePerformanceDrift() {
  await performanceDriftQueue.add(
    'weeklyPerformanceSnapshot',
    {},
    {
      repeat: { pattern: process.env.PERFORMANCE_DRIFT_CRON || '0 20 * * 0' }, // Sunday 8:00 PM
      removeOnComplete: true,
      jobId: 'weekly-performance-snapshot',
    }
  );
  console.log('Weekly performance drift snapshot job scheduled.');
}

// Weekly class-progress summary to parents — Sunday 8:30 PM, after the
// performance drift job (they share some of the same underlying data,
// running back-to-back keeps both reads close to the same week boundary).
export async function scheduleWeeklyProgressSummaries() {
  await weeklyProgressSummaryQueue.add(
    'weeklyClassSummaries',
    {},
    {
      repeat: { pattern: process.env.WEEKLY_SUMMARY_CRON || '30 20 * * 0' }, // Sunday 8:30 PM
      removeOnComplete: true,
      jobId: 'weekly-class-progress-summaries',
    }
  );
  console.log('Weekly class-progress summary job scheduled.');
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
