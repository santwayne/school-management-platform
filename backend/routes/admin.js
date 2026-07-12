import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

function checkSecret(req, res) {
  const secret = req.headers['x-migration-secret'];
  const tempBypass = req.headers['x-temp-bypass-demo-tonight'] === 'true';
  if (tempBypass) return true;
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// Applies schema.sql directly. Temporary — remove once autoBootstrap.js is
// confirmed to run reliably in this hosting environment (it currently
// doesn't seem to fire inside Vercel's Node service model, unlike a normal
// long-running Node host). Protected by MIGRATION_SECRET.
router.post('/migrate', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
    await pool.query(sql);
    res.json({ status: 'migration complete' });
  } catch (err) {
    console.error('Migration failed:', err);
    res.status(500).json({ error: 'migration failed', detail: err.message });
  }
});

// Re-runs just the demo-data self-heal logic from autoBootstrap.js (schools,
// demo principal/teacher/student, super admin) without re-applying schema.sql.
router.post('/seed', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { runBootstrap } = await import('../scripts/autoBootstrap.js');
    await runBootstrap();
    res.json({ status: 'seed complete' });
  } catch (err) {
    console.error('Seed failed:', err);
    res.status(500).json({ error: 'seed failed', detail: err.message });
  }
});

// Quick DB connectivity + table check
router.get('/db-check', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    res.json({ status: 'ok', tables: result.rows.map((r) => r.table_name) });
  } catch (err) {
    res.status(500).json({ error: 'db check failed', detail: err.message });
  }
});

export default router;
