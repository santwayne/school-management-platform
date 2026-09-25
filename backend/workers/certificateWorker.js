import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { processPendingRequests } from '../services/certificateService.js';

const worker = new Worker('CertificateQueue', async (job) => (job.name === 'processCertificates' ? processPendingRequests() : null), { connection });
worker.on('failed', (job, err) => console.error(`CertificateQueue job ${job?.id} failed:`, err.message));
export default worker;
