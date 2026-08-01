import { guidanceQueue, teacherAttendanceQueue, gpsPollQueue, libraryQueue } from '../config/queue.js';

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
