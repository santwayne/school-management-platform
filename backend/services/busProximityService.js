import pool from '../config/db.js';
import { send as sendNotification } from './notificationService.js';

// Item 18 — "notify parent by WhatsApp when the bus is near home." MVP scope
// only: no live map, no parent-facing settings UI, no per-route geofence
// editing — just detect proximity from GPS pings already being collected
// and fire the existing parent-notification pipeline. See the
// bus_proximity_alerts comment in schema.sql for why `direction` is derived
// here rather than stored on `buses`.

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_RADIUS_METERS = 500;

// No trip/schedule concept exists anywhere in this schema (see schema.sql) —
// this is a fixed midday split standing in for real configured pickup/
// drop-off windows: any ping before noon is treated as the pickup run,
// anything from noon onward as the drop-off run. Good enough for a typical
// single AM run + single PM run school day; a real version would let each
// school configure its actual windows once bus_proximity_alerts is joined
// to a genuine trip/schedule table.
const MIDDAY_CUTOFF_HOUR = 12;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function directionFor(atDate) {
  return atDate.getHours() < MIDDAY_CUTOFF_HOUR ? 'pickup' : 'dropoff';
}

/**
 * Called after a fresh GPS position lands for a bus (from either the poll
 * worker or the push webhook — both insert into bus_location_log the same
 * way). Best-effort: every failure is caught by the caller so a proximity
 * check can never break the GPS ingestion path it's attached to.
 *
 * @param {{id: number, school_id: number}} bus
 * @param {{latitude: number, longitude: number, recorded_at?: Date|string}} location
 */
export async function checkBusProximityAndNotify(bus, location) {
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  // "Now" rather than the vendor-supplied recorded_at — pings arrive close
  // enough to real time (30s poll interval / near-instant push webhook)
  // that the server's own clock is the more reliable and simpler signal,
  // rather than trusting each GPS vendor's own timestamp semantics.
  const now = new Date();
  const direction = directionFor(now);
  const tripDate = now.toISOString().slice(0, 10);

  const settingsRes = await pool.query(
    'SELECT proximity_alert_radius_meters FROM school_settings WHERE school_id = $1',
    [bus.school_id]
  );
  const radiusMeters = settingsRes.rowCount > 0
    ? Number(settingsRes.rows[0].proximity_alert_radius_meters) || DEFAULT_RADIUS_METERS
    : DEFAULT_RADIUS_METERS;

  // Students currently assigned to this bus (student_transport_fees is the
  // only student<->bus link in this schema — see its schema.sql comment)
  // who also have a home location saved. DISTINCT because
  // student_transport_fees has one row per billing_month, and this MVP
  // doesn't try to pick "the current month's" row specifically — a student
  // riding the same bus for years would otherwise get checked against many
  // duplicate rows for no benefit.
  const studentsRes = await pool.query(
    `SELECT DISTINCT s.id, s.name, s.home_latitude, s.home_longitude
     FROM student_transport_fees stf
     JOIN students s ON s.id = stf.student_id
     WHERE stf.bus_id = $1 AND s.home_latitude IS NOT NULL AND s.home_longitude IS NOT NULL`,
    [bus.id]
  );

  for (const student of studentsRes.rows) {
    const distance = haversineMeters(lat, lng, Number(student.home_latitude), Number(student.home_longitude));
    if (distance > radiusMeters) continue;

    // INSERT ... ON CONFLICT DO NOTHING doubles as the dedup check — only a
    // row that was actually inserted (first crossing today, this direction)
    // triggers a send. Avoids a separate SELECT-then-INSERT race between
    // the poll worker and the push webhook checking the same bus.
    const inserted = await pool.query(
      `INSERT INTO bus_proximity_alerts (school_id, bus_id, student_id, trip_date, direction)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bus_id, student_id, trip_date, direction) DO NOTHING
       RETURNING id`,
      [bus.school_id, bus.id, student.id, tripDate, direction]
    );
    if (inserted.rowCount === 0) continue; // already notified for this student/day/direction

    try {
      await sendNotification({
        triggerEvent: 'bus_approaching',
        schoolId: bus.school_id,
        recipients: [{ type: 'parent', studentId: student.id }],
        variables: { direction_label: direction === 'pickup' ? 'pickup' : 'drop-off' },
      });
    } catch (err) {
      console.error(`[busProximityService] Notification failed for student ${student.id} (bus ${bus.id}):`, err.message);
    }
  }
}
