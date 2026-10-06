import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { runDailyGuidance } from '../services/dailyGuidanceService.js';

// The guidance logic lives in services/dailyGuidanceService.js so it can be
// tested without a queue; this file only connects it to BullMQ.
const guidanceWorker = new Worker(
  'GuidanceQueue',
  async (job) => {
    console.log(`Processing daily guidance job: ${job.id}`);
    const result = await runDailyGuidance();
    console.log('Daily guidance finished:', result);
    return result;
  },
  { connection }
);

guidanceWorker.on('failed', (job, err) => {
  console.error(`GuidanceQueue job ${job?.id} failed:`, err.message);
});

export default guidanceWorker;
