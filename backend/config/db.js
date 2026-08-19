import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Items 10/11 of the QA fix list — root cause: nothing in this app ever
// pinned a timezone, so every CURRENT_DATE / CURRENT_TIMESTAMP-derived
// "today" (attendance's date DEFAULT, reports.js's today/date-range
// queries, payroll periods, library due dates, transport payouts, ...)
// reflected whatever timezone the Postgres host happens to default to —
// UTC on essentially every managed provider — not the school's actual IST
// calendar day. That's a silent, several-hours-wide mismatch every single
// day (IST is UTC+5:30 — from IST midnight until ~05:30 IST, Postgres's
// CURRENT_DATE still shows "yesterday"), and it's the same reason
// GET /api/reports/overview's "Attendance Today" stat can read no data
// even once attendance really has been marked for the day.
// This app is India-only (see utils/phone.js's DEFAULT_COUNTRY_CODE='91')
// so pinning every new pooled connection's session timezone to the
// school's actual zone is the correct fix — applied once, here, rather
// than sprinkling AT TIME ZONE casts across every date query in the app.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Kolkata'").catch((err) => {
    console.error('Failed to set session timezone on new Postgres connection:', err.message);
  });
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

export default pool;
