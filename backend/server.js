import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import attendanceRoutes from './routes/attendance.js';
import analyticsRoutes from './routes/analytics.js';
import financeRoutes from './routes/finance.js';
import whatsappRoutes from './routes/whatsapp.js';
import premiumAiRoutes from './routes/premiumAi.js';
import adminRoutes from './routes/admin.js';
import tutorRoutes from './routes/tutor.js';

// Starting the workers here means `node server.js` runs API + background
// processing together — fine for early deploys. Split into a separate
// `worker.js` process once call/message volume grows (see README).
import './workers/attendanceWorker.js';
import './workers/dailyGuidanceWorker.js';
import { scheduleDailyGuidance } from './workers/scheduler.js';
import { runBootstrap } from './scripts/autoBootstrap.js';

dotenv.config();

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`Warning: missing env vars: ${missing.join(', ')} — related features will fail until set.`);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/premium-ai', premiumAiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tutor', tutorRoutes);

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
});
