import express from 'express';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { getAutomationReadiness } from '../services/automationReadiness.js';

const router = express.Router();

// GET /api/automation-readiness — what the staff automations still need
// (WhatsApp connection, staff numbers, timetable, syllabus). Read-only.
router.get('/', requireAuth, requireOperator, async (req, res) => {
  try {
    res.json(await getAutomationReadiness(req.user.school_id));
  } catch (err) {
    console.error('automation readiness error:', err);
    res.status(500).json({ error: 'Failed to load setup status' });
  }
});

export default router;
