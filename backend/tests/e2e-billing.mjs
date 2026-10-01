// Local end-to-end billing test: real server + Postgres + mock Razorpay, Redis deliberately off.
// Run against a THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-billing.mjs
import crypto from 'crypto';
import { spawn } from 'child_process';
import pg from 'pg';
import { startMock, calls } from './e2e-mockRazorpay.mjs';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const SECRET = 'whsec_test';
const API = 'http://127.0.0.1:5055';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await startMock(9999);
const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5055', REDIS_URL: 'redis://127.0.0.1:6390',
    RAZORPAY_API_BASE: 'http://127.0.0.1:9999/v1', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'ks',
    RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_PLAN_ID_STARTER: 'plan_s', RAZORPAY_PLAN_ID_GROWTH: 'plan_g', RAZORPAY_PLAN_ID_DISTRICT: 'plan_d',
    BILLING_SWEEP_MS: '600000', SEED_DEMO_DATA: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(500); }

const j = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let evN = 0;
const hook = async (event, payload, eventId = `evt_${++evN}`) => {
  const raw = JSON.stringify({ event, payload });
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const r = await fetch(API + '/api/payment-links/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': eventId }, body: raw });
  await sleep(600); // inline processing (Redis down)
  return r.status;
};
const school = async () => (await pool.query(`SELECT * FROM schools WHERE id = (SELECT school_id FROM teachers WHERE email='principal@demoschool.test')`)).rows[0];
const now = () => Math.floor(Date.now() / 1000);

// ---- login
const login = await j('POST', '/api/auth/login', null, { email: 'principal@demoschool.test', password: 'changeme123' });
const token = login.body.token || login.body.accessToken || login.body.access_token;
ok(!!token, 'principal login');
const sid = (await school()).id;
await pool.query(`UPDATE schools SET plan='starter', billing_status='active', current_subscription_id=NULL, pending_plan_code=NULL, billing_grace_until=NULL, current_period_end=NULL, billing_state_code='03' WHERE id=$1`, [sid]);

// ---- P1: free upgrade hole closed
const patch = await j('PATCH', '/api/billing/plan', token, { plan: 'district' });
ok(patch.status === 403, `PATCH /plan as principal → 403 (got ${patch.status})`);
ok((await school()).plan === 'starter', 'plan unchanged after PATCH attempt');

// ---- quote + checkout (new, growth monthly)
const q = await j('GET', '/api/billing/quote?plan=growth&cycle=monthly', token);
ok(q.status === 200 && q.body.list_price_paise === 1299900 && q.body.recurring_total_paise === 1533882, `quote growth = ₹12,999 + GST = ₹15,338.82 (${q.body.recurring_total_paise})`);
const dq = await j('GET', '/api/billing/quote?plan=district&cycle=monthly', token);
ok(dq.body.afa_each_debit === true, 'District monthly flagged for per-debit OTP (>₹15k)');
const co = await j('POST', '/api/billing/checkout', token, { plan: 'growth', cycle: 'monthly' });
ok(co.status === 201 && co.body.checkout.subscription_id, 'checkout returns subscription_id');
ok((await school()).plan === 'starter', 'checkout alone does NOT change plan');

// ---- bad signature
const bad = await fetch(API + '/api/payment-links/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'nope' }, body: JSON.stringify({ event: 'subscription.activated', payload: {} }) });
ok(bad.status === 403, 'forged webhook rejected');

// ---- activation + charge
const subId = co.body.checkout.subscription_id;
const ps = now() - 60, pe = now() + 30 * 86400;
const subEnt = (status) => ({ subscription: { entity: { id: subId, status, current_start: ps, current_end: pe, notes: { school_id: String(sid), plan: 'growth' } } } });
ok(await hook('subscription.activated', subEnt('active')) === 200, 'activated webhook acked');
let s = await school();
ok(s.plan === 'growth' && s.billing_status === 'active', `plan → growth via webhook (${s.plan}/${s.billing_status})`);
const chargePayload = { ...subEnt('active'), payment: { entity: { id: 'pay_1', amount: 1533882, created_at: now() } } };
await hook('subscription.charged', chargePayload, 'evt_charge_1');
await hook('subscription.charged', chargePayload, 'evt_charge_1'); // retry, same id
await hook('invoice.paid', { invoice: { entity: { subscription_id: subId, payment_id: 'pay_1', amount_paid: 1533882 } }, payment: { entity: { id: 'pay_1', amount: 1533882 } } });
const inv = (await pool.query(`SELECT * FROM invoices WHERE school_id=$1`, [sid])).rows;
ok(inv.length === 1, `exactly one invoice despite duplicate + invoice.paid (${inv.length})`);
ok(inv[0] && Number(inv[0].cgst_paise) + Number(inv[0].sgst_paise) + Number(inv[0].taxable_paise) === 1533882 && Number(inv[0].igst_paise) === 0, 'Punjab buyer → CGST+SGST, totals reconcile');
ok(/^WN\/\d{4}-\d{2}\/\d{5}$/.test(inv[0]?.invoice_number || ''), `invoice number ${inv[0]?.invoice_number}`);
const ev = (await pool.query(`SELECT COUNT(*)::int n FROM billing_events WHERE razorpay_event_id='evt_charge_1'`)).rows[0].n;
ok(ev === 1, 'duplicate event stored once');
ok(/processing inline/.test(log), 'Redis down → inline processing fallback used');

// ---- invoices API + PDF
const il = await j('GET', '/api/billing/invoices', token);
ok(il.status === 200 && il.body.length === 1, 'GET /invoices');
const pdf = await fetch(`${API}/api/billing/invoices/${inv[0].id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
ok(pdf.status === 200 && (pdf.headers.get('content-type') || '').includes('pdf'), 'invoice PDF downloads');

// ---- upgrade growth → district (prorated, immediate)
const uq = await j('GET', '/api/billing/quote?plan=district&cycle=monthly', token);
ok(uq.body.kind === 'upgrade' && uq.body.proration_total_paise > 0 && uq.body.applies === 'now', `upgrade quote: proration ₹${(uq.body.proration_total_paise / 100).toFixed(2)}`);
calls.length = 0;
const uco = await j('POST', '/api/billing/checkout', token, { plan: 'district', cycle: 'monthly' });
const created = calls.find((c) => c.url === '/v1/subscriptions');
ok(created?.body.addons?.[0]?.item.amount === uq.body.proration_total_paise && created?.body.start_at, 'upgrade sub has prorated addon + start_at = period end');
const uSub = uco.body.checkout.subscription_id;
await hook('subscription.authenticated', { subscription: { entity: { id: uSub, status: 'authenticated', notes: { school_id: String(sid), plan: 'district', kind: 'upgrade' } } } });
s = await school();
ok(s.plan === 'district', `upgrade applied immediately (${s.plan})`);
ok(calls.some((c) => c.url === `/v1/subscriptions/${subId}/cancel` && c.body.cancel_at_cycle_end === 1), 'old sub cancelled at cycle end on Razorpay');
// late charge on old sub must not revert plan
await hook('subscription.charged', { ...subEnt('active'), payment: { entity: { id: 'pay_old2', amount: 1533882 } } });
ok((await school()).plan === 'district', 'late event on superseded sub does not revert plan');

// ---- downgrade blocked by usage
await pool.query(`INSERT INTO teachers (school_id, name, email, phone, password_hash, role) VALUES ($1,'Acc A','acca@x.test','+919999900001','x','accountant'),($1,'Acc B','accb@x.test','+919999900002','x','accountant'),($1,'Acc C','accc@x.test','+919999900003','x','accountant')`, [sid]);
// make district sub current so downgrade is a "downgrade"
await pool.query(`UPDATE subscriptions SET status='active', current_period_start=to_timestamp($2), current_period_end=to_timestamp($3) WHERE razorpay_subscription_id=$1`, [uSub, ps, pe]);
await pool.query(`UPDATE schools SET current_subscription_id=(SELECT id FROM subscriptions WHERE razorpay_subscription_id=$2) WHERE id=$1`, [sid, uSub]);
const dg = await j('GET', '/api/billing/quote?plan=growth&cycle=monthly', token);
ok(dg.status === 409 && dg.body.code === 'DOWNGRADE_BLOCKED', `downgrade blocked: ${dg.body.error}`);
await pool.query(`DELETE FROM teachers WHERE email IN ('accb@x.test','accc@x.test')`);
const dg2 = await j('GET', '/api/billing/quote?plan=growth&cycle=monthly', token);
ok(dg2.status === 200 && dg2.body.applies === 'next_cycle', 'downgrade allowed once usage fits, applies next cycle');

// ---- limits enforced on backend
await pool.query(`UPDATE schools SET plan='starter' WHERE id=$1`, [sid]);
const acc = await j('POST', '/api/academics/teachers', token, { name: 'New Acc', email: 'newacc@x.test', phone: '9876543210', password: 'Passw0rd!', role: 'accountant' });
ok(acc.status === 402, `starter: accountant creation blocked (${acc.status})`);
const cls = (await pool.query(`SELECT id FROM classes WHERE school_id=$1 LIMIT 1`, [sid])).rows[0].id;
const bulk = await j('POST', '/api/academics/students/bulk', token, { class_id: cls, students: Array.from({ length: 101 }, (_, i) => ({ name: `Kid ${i}` })) });
ok(bulk.status === 402, `starter: 101 students blocked (${bulk.status})`);
await pool.query(`UPDATE schools SET plan='district' WHERE id=$1`, [sid]);

// ---- halt → grace → read-only
await hook('subscription.halted', { subscription: { entity: { id: uSub, status: 'halted', notes: { school_id: String(sid), plan: 'district' } } } });
s = await school();
ok(s.billing_status === 'halted' && s.billing_grace_until, 'halted → grace period set');
let w = await j('POST', '/api/academics/students/bulk', token, { class_id: cls, students: [{ name: 'During grace' }] });
ok(w.status !== 402, `writes still allowed during grace (${w.status})`);
await pool.query(`UPDATE schools SET billing_grace_until = NOW() - INTERVAL '1 minute' WHERE id=$1`, [sid]);
w = await j('POST', '/api/academics/students/bulk', token, { class_id: cls, students: [{ name: 'After grace' }] });
ok(w.status === 402 && w.body.code === 'BILLING_READ_ONLY', `after grace: write → 402 read-only (${w.status})`);
const r = await j('GET', '/api/billing', token);
ok(r.status === 200 && r.body.read_only === true, 'reads still work, billing shows read_only');
const pay = await j('GET', '/api/billing/quote?plan=district&cycle=yearly', token);
ok(pay.status === 200, 'billing routes stay usable while read-only (can pay)');

// ---- yearly order flow restores access
const yco = await j('POST', '/api/billing/checkout', token, { plan: 'district', cycle: 'yearly' });
ok(yco.status === 201 && yco.body.checkout.order_id, 'yearly checkout → Razorpay order');
await hook('order.paid', { order: { entity: { id: yco.body.checkout.order_id, notes: { app: 'waynur_plan' } } }, payment: { entity: { id: 'pay_y1', amount: yco.body.checkout.amount, order_id: yco.body.checkout.order_id, notes: { app: 'waynur_plan' } } } });
s = await school();
ok(s.billing_status === 'active' && s.plan === 'district', `yearly paid → active again (${s.billing_status})`);
w = await j('POST', '/api/academics/students/bulk', token, { class_id: cls, students: [{ name: 'After renew' }] });
ok(w.status !== 402, 'writes work again after payment');

// ---- fee dues fix is on another branch; skip here
console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${fails} failures)`);
if (fails) console.log(log.split('\n').filter((l) => /error|Error|failed/.test(l)).slice(-25).join('\n'));
srv.kill(); await pool.end(); process.exit(fails ? 1 : 0);
