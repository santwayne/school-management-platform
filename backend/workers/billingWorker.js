import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { processBillingEvent, sweepBilling } from '../services/billingService.js';

const worker = new Worker(
  'BillingQueue',
  async (job) => (job.name === 'billingEvent' ? processBillingEvent(job.data.billingEventId) : null),
  { connection, concurrency: 2 }
);
worker.on('failed', (job, err) => console.error(`BillingQueue job ${job?.id} failed:`, err.message));

// Deliberately a plain timer, not a BullMQ repeatable: billing must keep
// moving (retries, yearly rollovers, renewal reminders) even while Redis is
// unavailable — same reasoning as workers/healthCheck.js.
const SWEEP_MS = Number(process.env.BILLING_SWEEP_MS || 5 * 60 * 1000);
let sweeping = false;
export function startBillingSweeper() {
  const tick = async () => {
    if (sweeping) return;
    sweeping = true;
    try { await sweepBilling(); } catch (err) { console.error('[billing] sweep failed:', err.message); }
    finally { sweeping = false; }
  };
  setTimeout(tick, 30 * 1000).unref?.();
  return setInterval(tick, SWEEP_MS);
}

export default worker;
