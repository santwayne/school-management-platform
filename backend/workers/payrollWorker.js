import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import { runMonthlyPayrollPreparation } from '../services/payrollService.js';

const worker = new Worker('PayrollQueue', async (job) => (job.name === 'preparePayroll' ? runMonthlyPayrollPreparation() : null), { connection });
worker.on('failed', (job, err) => console.error(`PayrollQueue job ${job?.id} failed:`, err.message));
export default worker;
