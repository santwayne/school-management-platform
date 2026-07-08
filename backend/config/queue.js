import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// Attendance queue: immediate WhatsApp send + delayed voice-call escalation
export const attendanceQueue = new Queue('AttendanceQueue', { connection });

// Guidance queue: daily "what to teach today" nudge to teachers
export const guidanceQueue = new Queue('GuidanceQueue', { connection });

// How long to wait for a parent reply before escalating to a voice call (ms)
export const ESCALATION_DELAY_MS = Number(process.env.ESCALATION_DELAY_MS || 2 * 60 * 60 * 1000); // default 2 hrs
