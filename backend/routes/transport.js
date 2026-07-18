import express from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { getAdapter, getVendorConfig } from '../services/gpsAdapters/index.js';

const router = express.Router();

// POST /api/transport/buses — register a bus. A real webhook_token is
// generated here (not derived from vendor_device_id) so a push-vendor's
// webhook can be trusted on its own, independent of any device id someone
// might guess or already know from elsewhere.
router.post('/buses', requireAuth, requirePrincipal, async (req, res) => {
  const { route_name, vehicle_number, driver_name, driver_phone, gps_vendor, vendor_device_id } = req.body;
  const schoolId = req.user.school_id;
  const webhookToken = crypto.randomBytes(16).toString('hex');

  try {
    const { rows } = await pool.query(
      `INSERT INTO buses (school_id, route_name, vehicle_number, driver_name, driver_phone, gps_vendor, vendor_device_id, webhook_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [schoolId, route_name || null, vehicle_number || null, driver_name || null, driver_phone || null, gps_vendor || 'generic_poll', vendor_device_id || null, webhookToken]
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

// PUT /api/transport/buses/:id/connection — set/update how this bus's GPS
// gets connected: for generic_rest, the vendor's REST endpoint + API key +
// field paths; for push vendors, nothing to configure here (the webhook
// token from creation is what they use). This is the "connect GPS" panel.
router.put('/buses/:id/connection', requireAuth, requirePrincipal, async (req, res) => {
  const {
    gps_vendor, vendor_device_id, vendor_api_base_url, vendor_api_key,
    vendor_lat_path, vendor_lng_path, vendor_speed_path, vendor_timestamp_path,
  } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM buses WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Bus not found for this school' });
    const bus = existing.rows[0];

    const { rows } = await pool.query(
      `UPDATE buses SET
         gps_vendor = COALESCE($1, gps_vendor),
         vendor_device_id = COALESCE($2, vendor_device_id),
         vendor_api_base_url = $3,
         vendor_api_key = COALESCE($4, vendor_api_key),
         vendor_lat_path = COALESCE($5, vendor_lat_path),
         vendor_lng_path = COALESCE($6, vendor_lng_path),
         vendor_speed_path = $7,
         vendor_timestamp_path = $8
       WHERE id = $9 AND school_id = $10 RETURNING *`,
      [
        gps_vendor, vendor_device_id,
        vendor_api_base_url !== undefined ? vendor_api_base_url : bus.vendor_api_base_url,
        // Only overwrite the API key if a non-empty one was sent — lets the
        // admin update other fields without re-pasting the key every time.
        vendor_api_key !== undefined && vendor_api_key !== '' ? vendor_api_key : null,
        vendor_lat_path, vendor_lng_path,
        vendor_speed_path !== undefined ? vendor_speed_path : bus.vendor_speed_path,
        vendor_timestamp_path !== undefined ? vendor_timestamp_path : bus.vendor_timestamp_path,
        req.params.id, req.user.school_id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transport/buses/:id/test-connection — poll once, right now, and
// report success/failure immediately instead of waiting for the scheduled
// worker — this is how an admin verifies the wiring actually works.
router.post('/buses/:id/test-connection', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const busRes = await pool.query('SELECT * FROM buses WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    if (busRes.rowCount === 0) return res.status(404).json({ error: 'Bus not found for this school' });
    const bus = busRes.rows[0];

    const vendorConfig = getVendorConfig(bus.gps_vendor);
    if (vendorConfig?.type === 'push') {
      return res.status(400).json({
        error: `"${bus.gps_vendor}" is a push vendor — it sends data to your webhook rather than being polled. Give the vendor your webhook URL and token instead.`,
        webhook_url: `/api/transport/webhook/${bus.gps_vendor}?token=${bus.webhook_token}`,
      });
    }

    const adapter = getAdapter(bus.gps_vendor);
    if (!adapter) {
      return res.status(400).json({ error: `Unknown vendor adapter: ${bus.gps_vendor}` });
    }

    const location = await adapter.pollLocations(bus);
    await pool.query(`UPDATE buses SET last_poll_status = 'ok', last_poll_error = NULL, last_poll_at = NOW() WHERE id = $1`, [bus.id]);
    res.json({ success: true, location });
  } catch (err) {
    await pool.query(
      `UPDATE buses SET last_poll_status = 'error', last_poll_error = $1, last_poll_at = NOW() WHERE id = $2`,
      [err.message.slice(0, 500), req.params.id]
    ).catch(() => {});
    res.status(502).json({ success: false, error: err.message });
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

// POST /api/transport/webhook/:vendor — for push-capable vendors (e.g. traxroot).
// Auth is the bus's own webhook_token, generated at creation — independent
// of vendor_device_id, so knowing a bus's device id alone can't fake a location.
router.post('/webhook/:vendor', async (req, res) => {
  const { vendor } = req.params;
  const token = req.query.token || req.headers['x-webhook-token'];

  if (!token) {
    return res.status(401).json({ error: 'Missing webhook token' });
  }

  try {
    const busRes = await pool.query(
      'SELECT id, school_id FROM buses WHERE webhook_token = $1 AND gps_vendor = $2',
      [token, vendor]
    );
    if (busRes.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid webhook token for this vendor' });
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
    await pool.query(`UPDATE buses SET last_poll_status = 'ok', last_poll_error = NULL, last_poll_at = NOW() WHERE id = $1`, [bus.id]);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
