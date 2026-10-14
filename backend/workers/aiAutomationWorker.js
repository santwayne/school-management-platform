import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { runEarlyWarning } from '../services/earlyWarning.js';
import { runDailyPlans } from '../services/dailyPlan.js';
import { runDraftNotes, sendApprovedNotes } from '../services/progressNotes.js';

// AI automation roadmap, phases 1–2 — one queue, four jobs. Each job loops
// over schools and is safe to run twice (results are keyed by student+week
// or school+day), which is why all four may be started from "Run now".
export const AI_AUTOMATION_JOBS = {
  weeklyEarlyWarning: 'student_early_warning',
  dailyPrincipalPlan: 'principal_daily_plan',
  draftProgressNotes: 'progress_notes_draft',
  sendProgressNotes: 'progress_notes_send',
};

const worker = new Worker(
  'AiAutomationQueue',
  async (job) => {
    if (job.name === 'weeklyEarlyWarning') return runEarlyWarning();
    if (job.name === 'dailyPrincipalPlan') return runDailyPlans();
    if (job.name === 'draftProgressNotes') return runDraftNotes();
    if (job.name === 'sendProgressNotes') return sendApprovedNotes();
    console.warn(`Unknown job name on AiAutomationQueue: ${job.name}`);
    return null;
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error(`AiAutomationQueue job ${job?.id} (${job?.name}) failed:`, err.message);
});

export default worker;
