// E2E for the Oct-1 QA round: payroll re-run refreshes unpaid amounts,
// stale "checkout started" banner expires, duplicate class is refused.
// THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-qaRound.mjs
import { spawn } from 'child_process';
import pg from 'pg';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5058';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5058', REDIS_URL: 'redis://127.0.0.1:6390', SEED_DEMO_DATA: 'true',
    RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'ks', BILLING_SWEEP_MS: '600000' },
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
  ok(!!token, 'principal login');
  const t = (await pool.query(`SELECT id, school_id FROM teachers WHERE email = 'teacher@demoschool.test'`)).rows[0];

  // ---- payroll: salary changed after the first run
  const period = '2026-09';
  await j('POST', '/api/payroll/salary', token, { teacher_id: t.id, monthly_amount: 12669 });
  let r = await j('POST', '/api/payroll/run', token, { period });
  ok(r.status === 201 && r.body.generated_count >= 1, `first run creates entries (${r.body.generated_count})`);
  await j('POST', '/api/payroll/salary', token, { teacher_id: t.id, monthly_amount: 14000 });
  r = await j('POST', '/api/payroll/run', token, { period });
  ok(r.status === 201 && r.body.generated_count === 0 && r.body.refreshed_count === 1, `re-run: no duplicates, 1 unpaid row refreshed (${JSON.stringify({ g: r.body.generated_count, u: r.body.refreshed_count })})`);
  let rows = (await j('GET', `/api/payroll?period=${period}`, token)).body;
  const row = rows.find((x) => x.teacher_id === t.id);
  ok(Number(row.amount_paid) === 14000, `September now shows ₹14,000 (${row.amount_paid})`);
  ok(rows.filter((x) => x.teacher_id === t.id).length === 1, 'still exactly one row for the teacher');

  await j('PATCH', `/api/payroll/${row.id}/mark-paid`, token);
  await j('POST', '/api/payroll/salary', token, { teacher_id: t.id, monthly_amount: 15000 });
  r = await j('POST', '/api/payroll/run', token, { period });
  rows = (await j('GET', `/api/payroll?period=${period}`, token)).body;
  ok(Number(rows.find((x) => x.teacher_id === t.id).amount_paid) === 14000 && r.body.refreshed_count === 0, 'PAID row is never changed by a re-run');

  // ---- stale "checkout started" banner
  await pool.query(`UPDATE subscriptions SET status = 'expired' WHERE school_id = $1 AND status = 'created'`, [t.school_id]);
  await pool.query(`INSERT INTO subscriptions (school_id, plan_code, billing_cycle, kind, status, created_at) VALUES ($1, 'starter', 'yearly', 'new', 'created', NOW() - INTERVAL '2 hours')`, [t.school_id]);
  let b = await j('GET', '/api/billing', token);
  ok(b.status === 200 && b.body.awaiting_payment === null, 'checkout abandoned 2h ago no longer shows "started but not paid"');
  await pool.query(`INSERT INTO subscriptions (school_id, plan_code, billing_cycle, kind, status) VALUES ($1, 'growth', 'yearly', 'new', 'created')`, [t.school_id]);
  b = await j('GET', '/api/billing', token);
  ok(b.body.awaiting_payment?.plan_code === 'growth', 'checkout started just now still shows the banner');

  // ---- duplicate class
  const c1 = await j('POST', '/api/academics/classes', token, { name: 'QA Class 8A' });
  const c2 = await j('POST', '/api/academics/classes', token, { name: 'QA Class 8A' });
  ok(c1.status < 300 && c2.status >= 400 && !!c2.body.error, `duplicate class refused with a message (${c2.status}: ${c2.body.error})`);
} catch (err) {
  console.error(err); fails++;
} finally {
  srv.kill(); await pool.end();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASSED (0 failures)');
  process.exit(fails ? 1 : 0);
}
