import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import attendanceRoutes from './routes/attendance.js';
import analyticsRoutes from './routes/analytics.js';
import financeRoutes from './routes/finance.js';
import whatsappRoutes from './routes/whatsapp.js';
import premiumAiRoutes from './routes/premiumAi.js';
import tutorRoutes from './routes/tutor.js';
import superAdminRoutes from './routes/superAdmin.js';
import academicsRoutes from './routes/academics.js';
import syllabusRoutes from './routes/syllabus.js';
import biometricRoutes from './routes/biometric.js';
import classNotesRoutes from './routes/classNotes.js';
import payrollRoutes from './routes/payroll.js';
import transportRoutes from './routes/transport.js';
import settingsRoutes from './routes/settings.js';
import communicationsRoutes from './routes/communications.js';
import billingRoutes from './routes/billing.js';
import reportsRoutes from './routes/reports.js';
import gradingRoutes from './routes/grading.js';
import studentPortalRoutes from './routes/studentPortal.js';
import feeCollectorsRoutes from './routes/feeCollectors.js';
import feeIntakeRoutes from './routes/feeIntake.js';
import paymentLinksRoutes from './routes/paymentLinks.js';
import onboardingRoutes from './routes/onboarding.js';
import staffLeaveRoutes from './routes/staffLeave.js';
import timetableRoutes from './routes/timetable.js';
import eventsRoutes from './routes/events.js';
import libraryRoutes from './routes/library.js';
import aiVoiceTutorRoutes from './routes/aiVoiceTutor.js';
import './workers/gpsPollWorker.js';
import './workers/teacherAttendanceAggregationWorker.js';
import './workers/classNoteWorker.js';
import './workers/studentNoteWorker.js';

// Starting the workers here means `node server.js` runs API + background
// processing together — fine for early deploys. Split into a separate
// `worker.js` process once call/message volume grows (see README).
import './workers/attendanceWorker.js';
import './workers/dailyGuidanceWorker.js';
import { scheduleDailyGuidance, scheduleTeacherAttendanceAggregation, scheduleGpsPolling } from './workers/scheduler.js';
import { runBootstrap } from './scripts/autoBootstrap.js';

dotenv.config();

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`Warning: missing env vars: ${missing.join(', ')} — related features will fail until set.`);
}

const app = express();
app.use(cors());
// verify captures the raw bytes onto req.rawBody before parsing — needed so
// the Razorpay webhook route can check its HMAC signature against the exact
// bytes Razorpay sent (by the time middleware chains reach the route, the
// body has already been parsed to JSON and the original bytes are gone
// unless captured here). Limit bumped from 5mb to 8mb to fit base64-encoded
// cash-slip photos from the WhatsApp intake flow alongside the JSON body.
app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/premium-ai', premiumAiRoutes);
app.use('/api/tutor', tutorRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/biometric', biometricRoutes);
app.use('/api', classNotesRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/communications', communicationsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/grading', gradingRoutes);
app.use('/api/student', studentPortalRoutes);
app.use('/api/fee-collectors', feeCollectorsRoutes);
app.use('/api/fee-intake', feeIntakeRoutes);
app.use('/api/payment-links', paymentLinksRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/staff-leave', staffLeaveRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/super-admin/ai-voice-tutor', aiVoiceTutorRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Core Backend running on port ${PORT}`);
  try {
    await runBootstrap();
  } catch (err) {
    console.error('Bootstrap (migration + demo credentials) failed:', err.message);
  }
  try {
    await scheduleDailyGuidance();
  } catch (err) {
    console.error('Failed to schedule daily guidance job (is Redis running?):', err.message);
  }
  try {
    await scheduleTeacherAttendanceAggregation();
  } catch (err) {
    console.error('Failed to schedule teacher attendance aggregation job (is Redis running?):', err.message);
  }
  try {
    await scheduleGpsPolling();
  } catch (err) {
    console.error('Failed to schedule GPS polling job (is Redis running?):', err.message);
  }
});
