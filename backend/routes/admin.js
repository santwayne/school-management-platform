import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

function checkSecret(req, res) {
  const secret = req.headers['x-migration-secret'];
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// One-off endpoint to apply schema.sql to the connected Postgres database.
// Protected by MIGRATION_SECRET env var. Remove this route once the
// database has been migrated in production.
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
