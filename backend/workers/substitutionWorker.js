import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { runSubstitutionCycle } from '../services/substitutionService.js';

const worker = new Worker(
  'SubstitutionQueue',
  async (job) => {
    if (job.name === 'planSubstitutions') return runSubstitutionCycle();
  },
  { connection }
);
worker.on('failed', (job, err) => console.error(`SubstitutionQueue job ${job?.id} failed:`, err.message));
export default worker;
