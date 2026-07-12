import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';
import { getAdapter, getVendorConfig } from '../services/gpsAdapters/index.js';

const worker = new Worker(
  'GpsPollQueue',
  async (job) => {
    const buses = await pool.query('SELECT * FROM buses');

    for (const bus of buses.rows) {
      const vendorConfig = getVendorConfig(bus.gps_vendor);
      if (!vendorConfig || vendorConfig.type !== 'pull') continue; // push vendors arrive via webhook instead

      const adapter = getAdapter(bus.gps_vendor);
      if (!adapter) {
        console.warn(`[gpsPollWorker] No adapter registered for vendor "${bus.gps_vendor}" (bus ${bus.id}) — skipping.`);
        continue;
      }

      try {
        const location = await adapter.pollLocations(bus);
        await pool.query(
          `INSERT INTO bus_location_log (bus_id, latitude, longitude, speed_kmh, recorded_at, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [bus.id, location.latitude, location.longitude, location.speed_kmh || null, location.recorded_at, JSON.stringify(location.rawPayload || {})]
        );
      } catch (err) {
        console.error(`[gpsPollWorker] Failed to poll bus ${bus.id} (${bus.gps_vendor}):`, err.message);
      }
    }
  },
  { connection }
);

export default worker;
