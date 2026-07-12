import { guidanceQueue, teacherAttendanceQueue } from '../config/queue.js';

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
