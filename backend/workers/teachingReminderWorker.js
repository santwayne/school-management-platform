import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { runUpcomingClassReminders } from '../services/teachingReminderService.js';

// The reminder logic lives in services/teachingReminderService.js so it can
// be tested without a queue; this file only connects it to BullMQ.
const teachingReminderWorker = new Worker(
  'TeachingReminderQueue',
  async (job) => {
    if (job.name === 'checkUpcomingClasses') {
      return runUpcomingClassReminders();
    }
    console.warn(`Unknown job name on TeachingReminderQueue: ${job.name}`);
  },
  { connection }
);

teachingReminderWorker.on('failed', (job, err) => {
  console.error(`TeachingReminderQueue job ${job?.id} failed:`, err.message);
});

export default teachingReminderWorker;
