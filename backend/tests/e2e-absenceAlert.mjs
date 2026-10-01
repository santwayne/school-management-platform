// E2E: a failed absence-alert run records WHY it failed (Control Center "Error" column).
// THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-absenceAlert.mjs
import http from 'http';
import { spawn } from 'child_process';
import pg from 'pg';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5072';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mock Graph API answering exactly like Meta does without WABA permission.
const meta = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.statusCode = 403; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: '(#200) You do not have the necessary permissions to send messages on behalf of this WhatsApp Business Account', code: 200 } }));
  });
});
await new Promise((r) => meta.listen(9995, r));

const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5072', REDIS_URL: 'redis://127.0.0.1:6390', SEED_DEMO_DATA: 'true',
    WHATSAPP_API_BASE: 'http://127.0.0.1:9995', WHATSAPP_ACCESS_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: '1' },
  stdio: 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(500); }
const j = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

try {
  const login = await j('POST', '/api/auth/login', null, { email: 'principal@demoschool.test', password: 'changeme123' });
  const token = login.body.token || login.body.accessToken;
  const sid = (await pool.query(`SELECT school_id FROM teachers WHERE email = 'principal@demoschool.test'`)).rows[0].school_id;
  const cls = (await pool.query(`SELECT id FROM classes WHERE school_id = $1 LIMIT 1`, [sid])).rows[0].id;
  const p = (await pool.query(`INSERT INTO parents (school_id, name, phone, opt_in_status) VALUES ($1, 'Opted Parent', '+919999911111', 'OPTED_IN') RETURNING id`, [sid])).rows[0].id;
  const withParent = (await pool.query(`INSERT INTO students (school_id, class_id, parent_id, name) VALUES ($1, $2, $3, 'Has Parent') RETURNING id`, [sid, cls, p])).rows[0].id;
  const noParent = (await pool.query(`INSERT INTO students (school_id, class_id, name) VALUES ($1, $2, 'No Parent') RETURNING id`, [sid, cls])).rows[0].id;

  const r = await j('POST', '/api/attendance/mark', token, { records: [{ student_id: withParent, status: 'absent' }, { student_id: noParent, status: 'absent' }] });
  ok(r.status === 200, `attendance marked (${r.status})`);
  await sleep(500);
  const run = (await pool.query(`SELECT status, error_summary FROM automation_runs WHERE automation_key = 'attendance_alert' ORDER BY id DESC LIMIT 1`)).rows[0];
  ok(run?.status === 'failed', `run recorded as failed (${run?.status})`);
  ok(/WhatsApp 403: \(#200\) You do not have the necessary permissions/.test(run?.error_summary || ''), 'Error column shows Meta\'s real reason');
  ok(/1 student has no parent linked/.test(run?.error_summary || ''), 'Error column also counts the student with no parent');
  console.log('      error_summary =', run?.error_summary);
  const reg = (await pool.query(`SELECT last_error FROM automation_registry WHERE automation_key = 'attendance_alert'`)).rows[0];
  ok(!!reg?.last_error, 'automation "Last error" banner is filled too');
} catch (err) {
  console.error(err); fails++;
} finally {
  srv.kill(); meta.close(); await pool.end();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASSED (0 failures)');
  process.exit(fails ? 1 : 0);
}
