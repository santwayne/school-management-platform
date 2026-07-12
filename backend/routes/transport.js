import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// POST /api/transport/buses — register a bus
router.post('/buses', requireAuth, requirePrincipal, async (req, res) => {
  const { route_name, vehicle_number, driver_name, driver_phone, gps_vendor, vendor_device_id } = req.body;
  const schoolId = req.user.school_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO buses (school_id, route_name, vehicle_number, driver_name, driver_phone, gps_vendor, vendor_device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [schoolId, route_name || null, vehicle_number || null, driver_name || null, driver_phone || null, gps_vendor || 'generic_poll', vendor_device_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transport/buses — list buses for this school
router.get('/buses', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM buses WHERE school_id = $1 ORDER BY created_at DESC', [req.user.school_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transport/buses/:id/location — latest location + today's trail
router.get('/buses/:id/location', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const busCheck = await pool.query('SELECT id FROM buses WHERE id = $1 AND school_id = $2', [id, req.user.school_id]);
    if (busCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Bus not found for this school' });
    }

    const latest = await pool.query(
      'SELECT * FROM bus_location_log WHERE bus_id = $1 ORDER BY recorded_at DESC LIMIT 1',
      [id]
    );
    const trail = await pool.query(
      `SELECT latitude, longitude, recorded_at FROM bus_location_log
       WHERE bus_id = $1 AND recorded_at::date = CURRENT_DATE
       ORDER BY recorded_at ASC LIMIT 200`,
      [id]
    );

    res.json({ latest: latest.rows[0] || null, trail: trail.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transport/webhook/:vendor — for push-capable vendors (e.g. traxroot)
router.post('/webhook/:vendor', async (req, res) => {
  const { vendor } = req.params;
  const token = req.query.token || req.headers['x-webhook-token'];

  if (!token) {
    return res.status(401).json({ error: 'Missing webhook token' });
  }

  try {
    // Buses don't have their own webhook_token column yet (unlike biometric
    // devices) — reuse vendor_device_id as the shared identifier for now,
    // matched against the token param. Tighten this once a real push vendor
    // is onboarded and its actual auth scheme is known.
    const busRes = await pool.query(
      'SELECT id, school_id FROM buses WHERE vendor_device_id = $1 AND gps_vendor = $2',
      [token, vendor]
    );
    if (busRes.rowCount === 0) {
      return res.status(401).json({ error: 'Unknown bus/vendor for this token' });
    }
    const bus = busRes.rows[0];

    const { latitude, longitude, speed_kmh, recorded_at } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    await pool.query(
      `INSERT INTO bus_location_log (bus_id, latitude, longitude, speed_kmh, recorded_at, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bus.id, latitude, longitude, speed_kmh || null, recorded_at ? new Date(recorded_at) : new Date(), JSON.stringify(req.body)]
    );

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
