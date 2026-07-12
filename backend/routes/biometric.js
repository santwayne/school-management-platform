import express from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { getAdapter } from '../services/biometricAdapters/index.js';

const router = express.Router();

async function insertPunch({ schoolId, deviceId, deviceInternalId, timestamp, punchType, rawPayload }) {
  const mappingRes = await pool.query(
    'SELECT teacher_id FROM teacher_device_mapping WHERE device_id = $1 AND device_internal_id = $2',
    [deviceId, deviceInternalId]
  );
  if (mappingRes.rowCount === 0) {
    return { skipped: true, reason: `No teacher mapped to device_internal_id ${deviceInternalId} on this device` };
  }
  const teacherId = mappingRes.rows[0].teacher_id;

  await pool.query(
    `INSERT INTO teacher_punch_events (school_id, teacher_id, device_id, punch_time, punch_type, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [schoolId, teacherId, deviceId, timestamp, punchType, JSON.stringify(rawPayload)]
  );
  return { skipped: false, teacherId };
}

// POST /api/biometric/webhook/:vendor — devices/bridge scripts push here directly.
// No JWT (devices can't hold one) — instead each device has its own webhook_token,
// sent as a query param or header, checked against biometric_devices.webhook_token.
router.post('/webhook/:vendor', async (req, res) => {
  const { vendor } = req.params;
  const token = req.query.token || req.headers['x-webhook-token'];

  const adapter = getAdapter(vendor);
  if (!adapter) {
    return res.status(400).json({ error: `Unknown vendor adapter: ${vendor}` });
  }
  if (!token) {
    return res.status(401).json({ error: 'Missing webhook token' });
  }

  try {
    const deviceRes = await pool.query(
      'SELECT id, school_id FROM biometric_devices WHERE webhook_token = $1 AND vendor = $2',
      [token, vendor]
    );
    if (deviceRes.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid webhook token for this vendor' });
    }
    const device = deviceRes.rows[0];

    const normalized = adapter.normalize(req.body);
    const result = await insertPunch({
      schoolId: device.school_id,
      deviceId: device.id,
      deviceInternalId: normalized.deviceInternalId,
      timestamp: normalized.timestamp,
      punchType: normalized.punchType,
      rawPayload: req.body,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/biometric/csv-import — fallback for schools whose biometric software
// can only export a file (no push capability at all).
router.post('/csv-import', requireAuth, requirePrincipal, async (req, res) => {
  const { device_id, rows } = req.body;
  const schoolId = req.user.school_id;

  if (!device_id || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'device_id and a non-empty rows array are required' });
  }

  try {
    const deviceRes = await pool.query('SELECT id FROM biometric_devices WHERE id = $1 AND school_id = $2', [device_id, schoolId]);
    if (deviceRes.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found for this school' });
    }

    const adapter = getAdapter('csv_import');
    const results = [];
    for (const row of rows) {
      const normalized = adapter.normalize(row);
      const result = await insertPunch({
        schoolId,
        deviceId: device_id,
        deviceInternalId: normalized.deviceInternalId,
        timestamp: normalized.timestamp,
        punchType: normalized.punchType,
        rawPayload: row,
      });
      results.push(result);
    }

    const inserted = results.filter((r) => !r.skipped).length;
    res.status(201).json({ success: true, inserted_count: inserted, skipped_count: results.length - inserted, details: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/biometric/devices — register a new biometric device for this school
router.post('/devices', requireAuth, requirePrincipal, async (req, res) => {
  const { vendor, device_serial, label } = req.body;
  const schoolId = req.user.school_id;

  if (!vendor) {
    return res.status(400).json({ error: 'vendor is required (e.g. zkteco, csv_import)' });
  }

  const webhookToken = crypto.randomBytes(16).toString('hex');

  try {
    const { rows } = await pool.query(
      `INSERT INTO biometric_devices (school_id, vendor, device_serial, label, webhook_token)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [schoolId, vendor, device_serial || null, label || null, webhookToken]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/biometric/devices — list devices for this school
router.get('/devices', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM biometric_devices WHERE school_id = $1 ORDER BY created_at DESC', [req.user.school_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/biometric/devices/:id/map-teacher — map a device's internal enrollment ID to a teacher
router.post('/devices/:id/map-teacher', requireAuth, requirePrincipal, async (req, res) => {
  const { id } = req.params;
  const { teacher_id, device_internal_id } = req.body;

  if (!teacher_id || !device_internal_id) {
    return res.status(400).json({ error: 'teacher_id and device_internal_id are required' });
  }

  try {
    const deviceCheck = await pool.query('SELECT id FROM biometric_devices WHERE id = $1 AND school_id = $2', [id, req.user.school_id]);
    if (deviceCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found for this school' });
    }

    const { rows } = await pool.query(
      `INSERT INTO teacher_device_mapping (teacher_id, device_id, device_internal_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id, device_internal_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id
       RETURNING *`,
      [teacher_id, id, device_internal_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/biometric/attendance/today — today's derived attendance for all teachers
router.get('/attendance/today', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  const today = new Date().toISOString().split('T')[0];
  try {
    const { rows } = await pool.query(
      `SELECT t.id AS teacher_id, t.name AS teacher_name, ad.id AS attendance_id,
              ad.first_punch, ad.last_punch, COALESCE(ad.status, 'absent') AS status
       FROM teachers t
       LEFT JOIN teacher_attendance_daily ad ON ad.teacher_id = t.id AND ad.date = $1
       WHERE t.school_id = $2 AND t.role != 'principal'
       ORDER BY t.name ASC`,
      [today, schoolId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/biometric/attendance/by-teacher/:teacherId — manual correction, upserts
// today's row (works even if the daily rollup hasn't created it yet)
router.patch('/attendance/by-teacher/:teacherId', requireAuth, requirePrincipal, async (req, res) => {
  const { teacherId } = req.params;
  const { status } = req.body;
  const today = new Date().toISOString().split('T')[0];

  if (!['present', 'absent', 'half_day', 'manual_override'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const teacherCheck = await pool.query('SELECT id FROM teachers WHERE id = $1 AND school_id = $2', [teacherId, req.user.school_id]);
    if (teacherCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Teacher not found for this school' });
    }

    const result = await pool.query(
      `INSERT INTO teacher_attendance_daily (school_id, teacher_id, date, status, corrected_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (teacher_id, date) DO UPDATE SET status = EXCLUDED.status, corrected_by = EXCLUDED.corrected_by
       RETURNING *`,
      [req.user.school_id, teacherId, today, status, req.user.teacher_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
