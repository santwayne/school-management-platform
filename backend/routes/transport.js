import express from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal, requireFinance } from '../middleware/auth.js';
import { getAdapter, getVendorConfig } from '../services/gpsAdapters/index.js';
import { checkBusProximityAndNotify } from '../services/busProximityService.js';
import {
  computeKmFromGPS, logManualKm, generatePayout, updatePayoutStatus,
  collectTransportFee, getRouteProfitability,
} from '../services/transportPayoutService.js';

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

    // Item 18 — after responding: the vendor just wants a quick 200, and a
    // slow/failed proximity check must never hold up or fail the webhook
    // ack (same fire-after-respond pattern as paymentLinks.js's webhook).
    checkBusProximityAndNotify(bus, { latitude, longitude }).catch((err) => {
      console.error(`[transport webhook] Proximity check failed for bus ${bus.id}:`, err.message);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// Driver payout — independent of student fee collection below (acceptance
// criteria: editing/deleting one must never touch the other's records).
// ================================================================

// Set/update a bus's per-km payout rate + driver bank details.
router.patch('/buses/:id/payout-rate', requireAuth, requirePrincipal, async (req, res) => {
  const { rate_per_km, driver_bank_details } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE buses SET
         rate_per_km = COALESCE($1, rate_per_km),
         driver_bank_details = COALESCE($2, driver_bank_details)
       WHERE id = $3 AND school_id = $4 RETURNING *`,
      [rate_per_km, driver_bank_details ? JSON.stringify(driver_bank_details) : null, req.params.id, req.user.school_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Bus not found for this school' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Set payout rate error:', err);
    res.status(500).json({ error: 'Failed to update payout rate' });
  }
});

// Auto-pull km for a given day from existing GPS pings (bus_location_log).
// Returns null if there weren't enough pings that day — frontend should
// then prompt for manual entry via POST /buses/:id/trip-logs/manual.
router.post('/buses/:id/trip-logs/auto', requireAuth, requirePrincipal, async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  try {
    const km = await computeKmFromGPS(req.user.school_id, req.params.id, date);
    if (km === null) {
      return res.status(200).json({ km: null, message: 'Not enough GPS pings for this day — enter km manually.' });
    }
    res.json({ km });
  } catch (err) {
    console.error('Auto km computation error:', err);
    res.status(500).json({ error: 'Failed to compute km from GPS data' });
  }
});

// Manual fallback entry for a day with no usable GPS data.
router.post('/buses/:id/trip-logs/manual', requireAuth, requirePrincipal, async (req, res) => {
  const { date, km } = req.body;
  if (!date || km == null) return res.status(400).json({ error: 'date and km are required' });
  try {
    const row = await logManualKm(req.user.school_id, req.params.id, date, km, req.user.teacher_id);
    res.json(row);
  } catch (err) {
    console.error('Manual km entry error:', err);
    res.status(500).json({ error: 'Failed to log manual km' });
  }
});

// "Generate Payout" — sums logged km over the period and creates a pending
// driver_payouts row. Does not touch student_transport_fees.
router.post('/buses/:id/generate-payout', requireAuth, requirePrincipal, async (req, res) => {
  const { period_start, period_end } = req.body;
  if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end are required' });
  try {
    const payout = await generatePayout(req.user.school_id, req.params.id, period_start, period_end);
    res.status(201).json(payout);
  } catch (err) {
    console.error('Generate payout error:', err);
    res.status(400).json({ error: err.message });
  }
});

router.get('/payouts', requireAuth, requireFinance, async (req, res) => {
  const { bus_id, status } = req.query;
  try {
    const conditions = ['school_id = $1'];
    const params = [req.user.school_id];
    if (bus_id) { params.push(bus_id); conditions.push(`bus_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT dp.*, b.route_name, b.driver_name FROM driver_payouts dp
         JOIN buses b ON b.id = dp.bus_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY dp.period_start DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Payout list error:', err);
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

// SuperAdmin/Accountant reviews and approves -> 'approved', then 'paid' once
// the bank transfer is done manually (no live payment API integration yet).
router.patch('/payouts/:id/status', requireAuth, requireFinance, async (req, res) => {
  const { status } = req.body;
  try {
    const updated = await updatePayoutStatus(req.user.school_id, req.params.id, status, req.user.teacher_id);
    if (!updated) return res.status(404).json({ error: 'Payout not found for this school' });
    res.json(updated);
  } catch (err) {
    console.error('Payout status update error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ================================================================
// Student transport fee — separate ledger from driver payout above.
// ================================================================

// Assign/update a student's monthly transport fee for a route+billing_month.
router.post('/fees', requireAuth, requireFinance, async (req, res) => {
  const { student_id, bus_id, pickup_point, monthly_fee, billing_month } = req.body;
  if (!student_id || !bus_id || !monthly_fee || !billing_month) {
    return res.status(400).json({ error: 'student_id, bus_id, monthly_fee and billing_month are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO student_transport_fees (school_id, student_id, bus_id, pickup_point, monthly_fee, billing_month)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (student_id, billing_month) DO UPDATE SET
         bus_id = EXCLUDED.bus_id, pickup_point = EXCLUDED.pickup_point, monthly_fee = EXCLUDED.monthly_fee
       RETURNING *`,
      [req.user.school_id, student_id, bus_id, pickup_point || null, monthly_fee, billing_month]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Assign transport fee error:', err);
    res.status(500).json({ error: 'Failed to assign transport fee' });
  }
});

router.get('/fees', requireAuth, requireFinance, async (req, res) => {
  const { billing_month, bus_id } = req.query;
  try {
    const conditions = ['stf.school_id = $1'];
    const params = [req.user.school_id];
    if (billing_month) { params.push(billing_month); conditions.push(`stf.billing_month = $${params.length}`); }
    if (bus_id) { params.push(bus_id); conditions.push(`stf.bus_id = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT stf.*, s.name AS student_name, b.route_name
         FROM student_transport_fees stf
         JOIN students s ON s.id = stf.student_id
         JOIN buses b ON b.id = stf.bus_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.route_name, s.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Transport fee list error:', err);
    res.status(500).json({ error: 'Failed to load transport fees' });
  }
});

// Reuses the existing fee-collection pattern (student_payment_history +
// cumulative student_payment update) — same Accountant dashboard flow as
// any other fee, just tagged as transport in `remarks`.
router.post('/fees/:id/collect', requireAuth, requireFinance, async (req, res) => {
  const { payment_mode } = req.body;
  try {
    const updated = await collectTransportFee(req.user.school_id, req.params.id, {
      paymentMode: payment_mode,
      collectedBy: req.user.teacher_id,
    });
    if (!updated) return res.status(404).json({ error: 'Transport fee record not found' });
    res.json(updated);
  } catch (err) {
    console.error('Collect transport fee error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ================================================================
// Route profitability — Principal/SuperAdmin dashboard. Joins driver_payouts
// and student_transport_fees ONLY for this read; they never share storage.
// ================================================================
router.get('/route-profitability', requireAuth, requirePrincipal, async (req, res) => {
  const billingMonth = req.query.billing_month || new Date().toISOString().slice(0, 7);
  try {
    const rows = await getRouteProfitability(req.user.school_id, billingMonth);
    res.json({ billing_month: billingMonth, routes: rows });
  } catch (err) {
    console.error('Route profitability error:', err);
    res.status(500).json({ error: 'Failed to load route profitability' });
  }
});

export default router;
