import { guidanceQueue } from '../config/queue.js';

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
