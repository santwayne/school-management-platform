import pool from '../config/db.js';

// ------------------------------------------------------------------
// Transport payout/fee split.
// - Driver payout (what the school pays) and student transport fee (what
//   the school collects) are fully independent — no shared storage, only
//   joined via bus_id for the read-only profitability report.
// - km_logged auto-pulls from existing GPS pings (bus_location_log) where
//   available; falls back to manual entry only when a route has no usable
//   GPS data for that day.
// ------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sums haversine distance between consecutive GPS pings for a bus on a given
 * date and upserts the result into driver_trip_logs as 'gps_auto'. Returns
 * the computed km, or null if there weren't at least 2 pings that day (in
 * which case the caller should fall back to manual entry instead).
 */
export async function computeKmFromGPS(schoolId, busId, date) {
  const { rows: pings } = await pool.query(
    `SELECT latitude, longitude, recorded_at FROM bus_location_log
      WHERE bus_id = $1 AND recorded_at::date = $2
      ORDER BY recorded_at ASC`,
    [busId, date]
  );

  if (pings.length < 2) return null;

  let totalKm = 0;
  for (let i = 1; i < pings.length; i++) {
    totalKm += haversineKm(
      Number(pings[i - 1].latitude), Number(pings[i - 1].longitude),
      Number(pings[i].latitude), Number(pings[i].longitude)
    );
  }
  totalKm = Math.round(totalKm * 100) / 100;

  await pool.query(
    `INSERT INTO driver_trip_logs (school_id, bus_id, trip_date, km_logged, km_source)
     VALUES ($1, $2, $3, $4, 'gps_auto')
     ON CONFLICT (bus_id, trip_date) DO UPDATE SET km_logged = EXCLUDED.km_logged, km_source = 'gps_auto'`,
    [schoolId, busId, date, totalKm]
  );

  return totalKm;
}

/** Manual fallback entry for a day with no usable GPS data. */
export async function logManualKm(schoolId, busId, date, km, loggedByTeacherId) {
  const { rows } = await pool.query(
    `INSERT INTO driver_trip_logs (school_id, bus_id, trip_date, km_logged, km_source, logged_by)
     VALUES ($1, $2, $3, $4, 'manual_entry', $5)
     ON CONFLICT (bus_id, trip_date) DO UPDATE SET km_logged = EXCLUDED.km_logged, km_source = 'manual_entry', logged_by = EXCLUDED.logged_by
     RETURNING *`,
    [schoolId, busId, date, km, loggedByTeacherId || null]
  );
  return rows[0];
}

/**
 * "Generate Payout" — sums driver_trip_logs.km_logged (gps_auto + manual,
 * whichever exists per day) over [periodStart, periodEnd] and creates a
 * pending driver_payouts row. Does NOT touch student_transport_fees.
 */
export async function generatePayout(schoolId, busId, periodStart, periodEnd) {
  const busRes = await pool.query('SELECT rate_per_km FROM buses WHERE id = $1 AND school_id = $2', [busId, schoolId]);
  if (busRes.rowCount === 0) throw new Error('Bus not found for this school');
  const rate = Number(busRes.rows[0].rate_per_km || 0);
  if (!rate) throw new Error('Set a rate_per_km on this bus before generating a payout');

  const kmRes = await pool.query(
    `SELECT COALESCE(SUM(km_logged), 0) AS total_km FROM driver_trip_logs
      WHERE bus_id = $1 AND trip_date BETWEEN $2 AND $3`,
    [busId, periodStart, periodEnd]
  );
  const totalKm = Number(kmRes.rows[0].total_km);
  const calculatedAmount = Math.round(totalKm * rate * 100) / 100;

  const { rows } = await pool.query(
    `INSERT INTO driver_payouts (school_id, bus_id, period_start, period_end, total_km, rate_per_km, calculated_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [schoolId, busId, periodStart, periodEnd, totalKm, rate, calculatedAmount]
  );
  return rows[0];
}

export async function updatePayoutStatus(schoolId, payoutId, status, approvedByTeacherId) {
  if (!['pending', 'approved', 'paid'].includes(status)) throw new Error('Invalid status');
  const { rows } = await pool.query(
    `UPDATE driver_payouts SET
       status = $1,
       approved_by = CASE WHEN $1 IN ('approved','paid') THEN COALESCE($2, approved_by) ELSE approved_by END,
       paid_date = CASE WHEN $1 = 'paid' THEN CURRENT_DATE ELSE paid_date END
     WHERE id = $3 AND school_id = $4
     RETURNING *`,
    [status, approvedByTeacherId || null, payoutId, schoolId]
  );
  return rows[0] || null;
}

/**
 * Collects a student's transport fee for a billing_month — reuses the same
 * student_payment_history + student_payment cumulative-update pattern as
 * feeIntake.js/finance.js (see schema.sql comment: there's no itemized
 * fee_type column in Billing yet, so this is tagged via `remarks`).
 */
export async function collectTransportFee(schoolId, studentTransportFeeId, { paymentMode, collectedBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const feeRes = await client.query(
      `SELECT * FROM student_transport_fees WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [studentTransportFeeId, schoolId]
    );
    if (feeRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const fee = feeRes.rows[0];
    if (fee.collection_status === 'collected') {
      await client.query('ROLLBACK');
      throw new Error('This month\'s transport fee is already marked collected');
    }

    const busRes = await client.query('SELECT route_name FROM buses WHERE id = $1', [fee.bus_id]);
    const routeName = busRes.rows[0]?.route_name || `bus #${fee.bus_id}`;

    const paymentRes = await client.query(
      `INSERT INTO student_payment_history (school_id, student_id, amount_paid, payment_mode, remarks, collected_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [schoolId, fee.student_id, fee.monthly_fee, paymentMode || 'Cash', `Transport fee (${routeName}, ${fee.billing_month})`, collectedBy || null]
    );

    await client.query(
      `INSERT INTO student_payment (school_id, student_id, amount_paid, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id)
       DO UPDATE SET amount_paid = student_payment.amount_paid + EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
      [schoolId, fee.student_id, fee.monthly_fee]
    );

    const updated = await client.query(
      `UPDATE student_transport_fees SET collection_status = 'collected', payment_history_id = $1, collected_date = CURRENT_TIMESTAMP
        WHERE id = $2 RETURNING *`,
      [paymentRes.rows[0].id, studentTransportFeeId]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Per-route (per-bus) profitability for a billing_month: students enrolled,
 * fee collected, driver payout for the same calendar period, margin.
 * Joins driver_payouts and student_transport_fees ONLY for this read — they
 * never share storage (acceptance criteria).
 */
export async function getRouteProfitability(schoolId, billingMonth) {
  const { rows } = await pool.query(
    `SELECT
       b.id AS bus_id, b.route_name, b.driver_name,
       COUNT(DISTINCT stf.student_id) AS students_enrolled,
       COALESCE(SUM(stf.monthly_fee) FILTER (WHERE stf.collection_status = 'collected'), 0) AS fee_collected,
       COALESCE(SUM(stf.monthly_fee), 0) AS fee_expected,
       COALESCE(payout.total_payout, 0) AS driver_payout
     FROM buses b
     LEFT JOIN student_transport_fees stf ON stf.bus_id = b.id AND stf.billing_month = $2
     LEFT JOIN (
       SELECT bus_id, SUM(calculated_amount) AS total_payout
         FROM driver_payouts
        WHERE school_id = $1 AND to_char(period_start, 'YYYY-MM') = $2
        GROUP BY bus_id
     ) payout ON payout.bus_id = b.id
     WHERE b.school_id = $1
     GROUP BY b.id, b.route_name, b.driver_name, payout.total_payout
     ORDER BY b.route_name`,
    [schoolId, billingMonth]
  );

  return rows.map((r) => ({
    ...r,
    margin: Number(r.fee_collected) - Number(r.driver_payout),
  }));
}
