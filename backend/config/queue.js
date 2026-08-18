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

// Teacher attendance aggregation: rolls up raw biometric punch events into
// one present/absent/half_day row per teacher per day
export const teacherAttendanceQueue = new Queue('TeacherAttendanceQueue', { connection });

// GPS polling: fetches current location for every pull-based-vendor bus on an interval
export const gpsPollQueue = new Queue('GpsPollQueue', { connection });

// Library queue: daily "books due/overdue" digest to registered library contacts
export const libraryQueue = new Queue('LibraryQueue', { connection });

// Fee reminder queue: daily automatic "you have an unpaid balance" WhatsApp
// nudge (with a fresh payment link) — converts the previously-manual
// "Send payment link" flow into something that scales to a school with
// thousands of students instead of needing one click per student.
export const feeReminderQueue = new Queue('FeeReminderQueue', { connection });

// Petty cash reminder queue: daily one-time nudge to the principal when a
// request has sat pending too long — there was no reminder at all before.
export const pettyCashReminderQueue = new Queue('PettyCashReminderQueue', { connection });

// Staff leave reminder queue: same shape as petty cash — daily one-time
// nudge to the principal when a leave request has sat pending too long.
export const staffLeaveReminderQueue = new Queue('StaffLeaveReminderQueue', { connection });

// Teaching reminder queue: polls every ~10 min for periods about to start
// and reminds the assigned teacher (class + subject + today's lesson plan
// topic, if logged) — see workers/teachingReminderWorker.js.
export const teachingReminderQueue = new Queue('TeachingReminderQueue', { connection });

// Low attendance alert queue: weekly rolling-threshold check — see
// workers/lowAttendanceAlertWorker.js for the threshold/window decisions.
export const lowAttendanceAlertQueue = new Queue('LowAttendanceAlertQueue', { connection });

// How long to wait for a parent reply before escalating to a voice call (ms)
export const ESCALATION_DELAY_MS = Number(process.env.ESCALATION_DELAY_MS || 2 * 60 * 60 * 1000); // default 2 hrs
