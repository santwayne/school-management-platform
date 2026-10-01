// Local end-to-end test for Super Admin plan management: real server + Postgres + mock Razorpay.
// Run against a THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-planAdmin.mjs
import { spawn } from 'child_process';
import pg from 'pg';
import { startMock, plans as rzpPlans } from './e2e-mockRazorpay.mjs';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5056';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await startMock(9998);
const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5056', REDIS_URL: 'redis://127.0.0.1:6390',
    RAZORPAY_API_BASE: 'http://127.0.0.1:9998/v1', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'ks',
    RAZORPAY_WEBHOOK_SECRET: 'whsec', RAZORPAY_PLAN_ID_STARTER: 'plan_envStarter', RAZORPAY_PLAN_ID_GROWTH: '', RAZORPAY_PLAN_ID_DISTRICT: '',
    SUPER_ADMIN_EMAIL: 'sa@test.local', SUPER_ADMIN_PASSWORD: 'Sup3r-Secret!', SEED_DEMO_DATA: 'true', BILLING_SWEEP_MS: '600000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(500); }

const j = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const plan = (list, code) => list.find((p) => p.code === code);

try {
  // ---- auth
  const sa = await j('POST', '/api/super-admin/login', null, { email: 'sa@test.local', password: 'Sup3r-Secret!' });
  const token = sa.body.token;
  ok(!!token, 'super admin login');
  const pr = await j('POST', '/api/auth/login', null, { email: 'principal@demoschool.test', password: 'changeme123' });
  const ptoken = pr.body.token || pr.body.accessToken;
  ok((await j('GET', '/api/billing/admin/plans', ptoken)).status === 403, 'principal cannot open plan admin');

  // ---- list
  let r = await j('GET', '/api/billing/admin/plans', token);
  ok(r.status === 200 && r.body.mode === 'test', `list plans (mode=${r.body.mode})`);
  ok(plan(r.body.plans, 'starter').razorpay_plan_source === 'env' && plan(r.body.plans, 'starter').razorpay_plan_id === 'plan_envStarter', 'starter falls back to .env plan ID');
  ok(plan(r.body.plans, 'growth').razorpay_plan_source === 'missing', 'growth has no plan ID yet');
  ok(plan(r.body.plans, 'district').price_with_gst === 35398.82, 'district shows GST-inclusive ₹35,398.82');

  // ---- create in Razorpay
  r = await j('POST', '/api/billing/admin/plans/growth/razorpay', token);
  let growthId = r.body.razorpay_plan_id;
  ok(r.status === 200 && /^plan_mock/.test(growthId), `create Growth in Razorpay (${growthId})`);
  ok(rzpPlans[growthId]?.item.amount === 1533882 && rzpPlans[growthId].period === 'monthly' && rzpPlans[growthId].interval === 1, 'Razorpay plan = ₹15,338.82 monthly');
  ok(plan(r.body.plans, 'growth').razorpay_plan_source === 'database', 'growth plan ID now stored in DB');

  // ---- school billing page sees monthly online now
  const bill = await j('GET', '/api/billing', ptoken);
  ok(bill.body.all_plans?.growth?.monthly_online === true, 'school Billing page: Growth monthly is now purchasable');

  // ---- link existing (verify)
  // A second Growth-priced plan (now Growth's current ID) — wrong amount for District.
  const wrong = (await j('POST', '/api/billing/admin/plans/growth/razorpay', token)).body.razorpay_plan_id;
  growthId = wrong;
  r = await j('PUT', '/api/billing/admin/plans/district/razorpay-id', token, { razorpay_plan_id: wrong });
  ok(r.status === 400 && /should be ₹35398\.82/.test(r.body.error), 'linking a plan with the wrong amount is refused');
  r = await j('PUT', '/api/billing/admin/plans/district/razorpay-id', token, { razorpay_plan_id: 'plan_doesNotExist' });
  ok(r.status === 400 && /not found/.test(r.body.error), 'linking an unknown plan ID is refused');
  r = await j('PUT', '/api/billing/admin/plans/district/razorpay-id', token, { razorpay_plan_id: 'not-a-plan' });
  ok(r.status === 400, 'malformed plan ID refused');
  r = await j('POST', '/api/billing/admin/plans/district/razorpay', token);
  const distId = r.body.razorpay_plan_id;
  r = await j('PUT', '/api/billing/admin/plans/district/razorpay-id', token, { razorpay_plan_id: '' });
  ok(r.status === 200 && plan(r.body.plans, 'district').razorpay_plan_source === 'missing', 'clearing district plan ID');
  r = await j('PUT', '/api/billing/admin/plans/district/razorpay-id', token, { razorpay_plan_id: distId });
  ok(r.status === 200 && plan(r.body.plans, 'district').razorpay_plan_id === distId, 'linking the correct district plan works');

  // ---- edit limits (applies to schools on that plan)
  await pool.query(`UPDATE schools SET plan='growth' WHERE id = (SELECT school_id FROM teachers WHERE email='principal@demoschool.test')`);
  r = await j('PATCH', '/api/billing/admin/plans/growth', token, { student_limit: 650, accountant_seats: 3 });
  ok(r.status === 400 && /reason/.test(r.body.error), 'edit without a reason is refused');
  r = await j('PATCH', '/api/billing/admin/plans/growth', token, { student_limit: 650, accountant_seats: 3, reason: 'More seats for Growth tier' });
  ok(r.status === 200 && plan(r.body.plans, 'growth').student_limit === 650 && r.body.schools_updated >= 1, `limits updated (schools_updated=${r.body.schools_updated})`);
  const sch = (await pool.query(`SELECT student_limit, accountant_seat_limit FROM schools WHERE id = (SELECT school_id FROM teachers WHERE email='principal@demoschool.test')`)).rows[0];
  ok(sch.student_limit === 650 && sch.accountant_seat_limit === 3, 'existing Growth school got the new limits');
  ok(plan(r.body.plans, 'growth').razorpay_plan_id === growthId, 'limit-only edit keeps the same Razorpay plan');

  // ---- price change creates a new Razorpay plan
  r = await j('PATCH', '/api/billing/admin/plans/growth', token, { price: 13999, reason: 'Price revision Oct 2026' });
  const newId = r.body.new_razorpay_plan_id;
  ok(r.status === 200 && newId && newId !== growthId, `price change → new Razorpay plan (${newId})`);
  ok(rzpPlans[newId]?.item.amount === 1651882, 'new Razorpay plan amount = ₹13,999 + 18% = ₹16,518.82');
  ok(plan(r.body.plans, 'growth').price === 13999 && plan(r.body.plans, 'growth').razorpay_plan_id === newId, 'DB price + plan ID switched');
  const q = await j('GET', '/api/billing/quote?plan=growth&cycle=monthly', ptoken);
  ok(q.status === 200, `quote still works after price change (${q.status})`);

  // ---- validation + history
  r = await j('PATCH', '/api/billing/admin/plans/growth', token, { price: 0, reason: 'bad price test' });
  ok(r.status === 400, 'invalid price refused');
  r = await j('PATCH', '/api/billing/admin/plans/nope', token, { price: 1, reason: 'unknown plan' });
  ok(r.status === 404, 'unknown plan → 404');
  r = await j('GET', '/api/billing/admin/plans', token);
  const actions = r.body.history.map((h) => h.action);
  ok(actions.includes('plan_updated') && actions.includes('razorpay_plan_created') && actions.includes('razorpay_plan_linked') && actions.includes('razorpay_plan_cleared'), `change history recorded (${r.body.history.length} entries)`);
} catch (err) {
  console.error(err);
  fails++;
} finally {
  srv.kill();
  await pool.end();
  if (fails) console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-15).join('\n'));
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASSED (0 failures)');
  process.exit(fails ? 1 : 0);
}
