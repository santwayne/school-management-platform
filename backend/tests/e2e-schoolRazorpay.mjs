// E2E: each school's OWN Razorpay account for school fee money.
// THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-schoolRazorpay.mjs
// Needs Redis on 6390 (same as the other e2e scripts). Uses a mock Razorpay
// API — nothing leaves the machine.
import http from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';
import pg from 'pg';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5074';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLATFORM = { id: 'rzp_test_PlatformKey0001', secret: 'platform-key-secret', hook: 'platform-hook-secret' };
const A = { id: 'rzp_test_SchoolAKey00001', secret: 'school-a-key-secret', hook: 'school-a-hook-secret' };
const B = { id: 'rzp_live_SchoolBKey00001', secret: 'school-b-key-secret', hook: 'school-b-hook-secret' };
const VALID = new Map([[PLATFORM.id, PLATFORM.secret], [A.id, A.secret], [B.id, B.secret]]);

// ---- Mock Razorpay ----
const rzCalls = [];
let linkSeq = 0;
const rz = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const [user, pass] = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
    const b = body ? JSON.parse(body) : {};
    rzCalls.push({ method: req.method, url: req.url, user, body: b });
    res.setHeader('Content-Type', 'application/json');
    if (VALID.get(user) !== pass) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }));
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/payment_links')) return res.end(JSON.stringify({ payment_links: [] }));
    if (req.method === 'POST' && req.url === '/v1/payment_links') {
      const id = `plink_mock${++linkSeq}`;
      return res.end(JSON.stringify({ id, short_url: `https://rzp.io/i/${id}`, reference_id: b.reference_id, amount: b.amount, status: 'created' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => rz.listen(9997, r));

const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5074', REDIS_URL: 'redis://127.0.0.1:6390', SEED_DEMO_DATA: 'true',
    SUPER_ADMIN_EMAIL: 'sa@waynur.test', SUPER_ADMIN_PASSWORD: 'sa-pass-123',
    RAZORPAY_API_BASE: 'http://127.0.0.1:9997/v1',
    // Waynur's platform keys are present on purpose — school fee links must never use them.
    RAZORPAY_KEY_ID: PLATFORM.id, RAZORPAY_KEY_SECRET: PLATFORM.secret, RAZORPAY_WEBHOOK_SECRET: PLATFORM.hook,
    PUBLIC_SITE_URL: 'https://waynur.test/' },
  stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(500); }
const j = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// A Razorpay webhook: exact raw bytes signed with `secret`.
const hook = async (path, secret, payload) => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
  return r.status;
};
const paid = (link, over = {}) => ({
  event: 'payment_link.paid',
  payload: { payment_link: { entity: { id: link.razorpay_link_id, reference_id: link.reference_id, amount: Math.round(Number(link.amount) * 100), amount_paid: Math.round(Number(link.amount) * 100), status: 'paid', ...over } } },
});
const linkRow = async (id) => (await pool.query('SELECT * FROM fee_payment_links WHERE id = $1', [id])).rows[0];
const historyCount = async (studentId) => Number((await pool.query('SELECT COUNT(*) FROM student_payment_history WHERE student_id = $1', [studentId])).rows[0].count);
const postedLinks = () => rzCalls.filter((c) => c.method === 'POST' && c.url === '/v1/payment_links');

try {
  const sa = (await j('POST', '/api/super-admin/login', null, { email: 'sa@waynur.test', password: 'sa-pass-123' })).body.token;
  const principal = (await j('POST', '/api/auth/login', null, { email: 'principal@demoschool.test', password: 'changeme123' })).body;
  const token = principal.token || principal.accessToken;
  ok(!!sa && !!token, 'super admin + principal logged in');
  const sidA = (await pool.query(`SELECT school_id FROM teachers WHERE email = 'principal@demoschool.test'`)).rows[0].school_id;
  const cls = (await pool.query(`SELECT id FROM classes WHERE school_id = $1 LIMIT 1`, [sidA])).rows[0].id;
  const tag = Date.now().toString().slice(-7);
  const par = (await pool.query(`INSERT INTO parents (school_id, name, phone, opt_in_status) VALUES ($1, 'Fee Parent', $2, 'OPTED_IN') RETURNING id`, [sidA, `+91990${tag}`])).rows[0].id;
  const stu = (await pool.query(`INSERT INTO students (school_id, class_id, parent_id, name) VALUES ($1, $2, $3, 'Fee Student') RETURNING id`, [sidA, cls, par])).rows[0].id;
  const rzA = `/api/super-admin/schools/${sidA}/razorpay`;
  const hookA = `/api/payment-links/webhook/school/${sidA}`;
  await pool.query('DELETE FROM school_razorpay_credentials WHERE school_id = $1', [sidA]);

  // 1. School without its own account: nothing is created, and the platform keys are NOT used.
  let r = await j('GET', '/api/payment-links/status', token);
  ok(r.status === 200 && r.body.connected === false, 'status says online payments are not set up');
  r = await j('POST', '/api/payment-links', token, { student_id: stu, amount: 500 });
  ok(r.status === 409 && /not set up/.test(r.body.error || ''), `link refused with a clear message while not connected (${r.status})`);
  ok(postedLinks().length === 0, 'no link was created in ANY Razorpay account (platform keys not used for school fees)');
  ok(await hook(hookA, A.hook, { event: 'payment_link.paid', payload: {} }) === 404, 'webhook URL of a school without keys answers 404');

  // 2. Only a super admin may touch the connection; bad input and bad keys save nothing.
  r = await j('PUT', rzA, token, { key_id: A.id, key_secret: A.secret, webhook_secret: A.hook });
  ok(r.status === 403, `principal cannot add keys (${r.status})`);
  r = await j('PUT', rzA, sa, { key_id: 'not-a-key', key_secret: A.secret, webhook_secret: A.hook });
  ok(r.status === 400 && /rzp_live_/.test(r.body.error || ''), `malformed key id rejected (${r.status})`);
  r = await j('PUT', rzA, sa, { key_id: A.id, key_secret: A.secret });
  ok(r.status === 400 && /webhook_secret/.test(r.body.error || ''), `missing webhook secret rejected (${r.status})`);
  r = await j('PUT', rzA, sa, { key_id: A.id, key_secret: 'wrong-secret', webhook_secret: A.hook });
  ok(r.status === 400 && /did not accept/.test(r.body.error || ''), `wrong key secret rejected by Razorpay (${r.status}: ${r.body.error})`);
  ok((await pool.query('SELECT 1 FROM school_razorpay_credentials WHERE school_id = $1', [sidA])).rowCount === 0, 'nothing saved for rejected attempts');

  // 3. Good keys.
  r = await j('PUT', rzA, sa, { key_id: A.id, key_secret: A.secret, webhook_secret: A.hook });
  ok(r.status === 200 && r.body.connection?.connected === true && r.body.connection.mode === 'test', `keys saved (${r.status}, mode ${r.body.connection?.mode})`);
  ok(r.body.connection?.webhook_url === `https://waynur.test/api/payment-links/webhook/school/${sidA}`, `webhook URL returned (${r.body.connection?.webhook_url})`);
  const dump = JSON.stringify(r.body);
  ok(!dump.includes(A.secret) && !dump.includes(A.hook), 'the response never contains the key secret or webhook secret');
  const stored = (await pool.query('SELECT * FROM school_razorpay_credentials WHERE school_id = $1', [sidA])).rows[0];
  ok(stored.key_secret_enc.startsWith('v1:') && !JSON.stringify(stored).includes(A.secret) && !JSON.stringify(stored).includes(A.hook), 'secrets are stored encrypted');
  r = await j('GET', rzA, sa);
  ok(r.status === 200 && r.body.connected && !JSON.stringify(r.body).includes(A.secret), 'GET shows the connection without secrets');
  r = await j('GET', '/api/settings', token);
  ok(!JSON.stringify(r.body).includes(A.secret) && !JSON.stringify(r.body).includes('key_secret_enc'), 'school settings API does not leak the keys');
  r = await j('GET', '/api/payment-links/status', token);
  ok(r.body.connected === true && r.body.mode === 'test', 'status now says online payments are set up');
  r = await j('GET', '/api/super-admin/schools', sa);
  ok(r.body.find((s) => s.id === sidA)?.razorpay_mode === 'test', 'school list shows the Razorpay mode');

  // 4. A second school created WITH its own keys in one step.
  r = await j('POST', '/api/super-admin/schools', sa, { name: `Razorpay School B ${tag}`, principal_name: 'B Principal', principal_email: `b${tag}@waynur.test`, principal_phone: '9876543210', principal_password: 'b-pass-12345',
    razorpay_key_id: B.id, razorpay_key_secret: B.secret, razorpay_webhook_secret: B.hook });
  const sidB = r.body.schoolId;
  ok(r.status === 201 && r.body.razorpay?.connected === true && r.body.razorpay.mode === 'live', `school created with its Razorpay account connected (${r.status})`);
  const hookB = `/api/payment-links/webhook/school/${sidB}`;

  // 5. Link is created in school A's OWN account.
  r = await j('POST', '/api/payment-links', token, { student_id: stu, amount: 1500 });
  ok(r.status === 201 && r.body.razorpay_account === 'school', `payment link created (${r.status})`);
  ok(postedLinks().length === 1 && postedLinks()[0].user === A.id, `Razorpay call used school A's key, not the platform key (${postedLinks()[0]?.user})`);
  ok(postedLinks()[0].body.amount === 150000 && postedLinks()[0].body.reference_id.length <= 40, 'amount in paise, reference id within Razorpay\'s 40 characters');
  let link = await linkRow(r.body.id);

  // 6. Webhooks that must NOT settle it.
  ok(await hook(hookA, 'some-other-secret', paid(link)) === 403, 'wrong signature on the school webhook is refused (403)');
  ok(await hook('/api/payment-links/webhook', PLATFORM.hook, paid(link)) === 200 && (await linkRow(link.id)).status === 'CREATED', 'platform webhook cannot settle a school-account link');
  ok(await hook(hookB, B.hook, paid(link)) === 200 && (await linkRow(link.id)).status === 'CREATED', 'another school\'s webhook cannot settle this school\'s link');
  ok(await hook(hookA, A.hook, paid(link, { id: 'plink_lookalike' })) === 200 && (await linkRow(link.id)).status === 'CREATED', 'a look-alike link with a copied reference id settles nothing');
  ok(await hook(hookA, A.hook, paid(link, { amount_paid: 100 })) === 200 && (await linkRow(link.id)).status === 'CREATED', 'an underpaid link settles nothing');
  ok(await historyCount(stu) === 0, 'no payment was recorded by any of those');

  // 7. The real one settles it — once.
  ok(await hook(hookA, A.hook, paid(link)) === 200, 'correctly signed webhook accepted');
  link = await linkRow(link.id);
  ok(link.status === 'PAID' && link.payment_history_id, 'link marked PAID');
  ok(await historyCount(stu) === 1, 'exactly one payment recorded');
  await hook(hookA, A.hook, paid(link));
  ok(await historyCount(stu) === 1, 'a replayed webhook does not record the payment twice');
  ok((await pool.query('SELECT last_webhook_at FROM school_razorpay_credentials WHERE school_id = $1', [sidA])).rows[0].last_webhook_at, 'last webhook time recorded for the super admin screen');

  // 8. Five simultaneous deliveries of the same event -> still one payment.
  r = await j('POST', '/api/payment-links', token, { student_id: stu, amount: 700 });
  const link2 = await linkRow(r.body.id);
  const statuses = await Promise.all([1, 2, 3, 4, 5].map(() => hook(hookA, A.hook, paid(link2))));
  ok(statuses.every((s) => s === 200) && await historyCount(stu) === 2, `5 simultaneous webhooks recorded exactly one more payment (history rows: ${await historyCount(stu)})`);
  const total = Number((await pool.query('SELECT amount_paid FROM student_payment WHERE student_id = $1', [stu])).rows[0].amount_paid);
  ok(total === 2200, `running total is 1500 + 700 = 2200 (got ${total})`);

  // 9. A link made in the platform account before this change still settles there, and only there.
  const legacyRef = `waynur-${sidA}-${stu}-legacy${tag}`;
  const legacy = (await pool.query(`INSERT INTO fee_payment_links (school_id, student_id, amount, reference_id, razorpay_link_id, razorpay_link_url) VALUES ($1,$2,300,$3,'plink_legacy','https://rzp.io/i/legacy') RETURNING *`, [sidA, stu, legacyRef])).rows[0];
  ok(legacy.razorpay_account === 'platform', 'existing links default to the platform account');
  await hook(hookA, A.hook, paid(legacy));
  ok((await linkRow(legacy.id)).status === 'CREATED', 'school webhook cannot settle a platform-account link');
  await hook('/api/payment-links/webhook', PLATFORM.hook, paid(legacy));
  ok((await linkRow(legacy.id)).status === 'PAID' && await historyCount(stu) === 3, 'platform webhook still settles a platform-account link');

  // 10. Rotate only the webhook secret (key secret kept).
  r = await j('PUT', rzA, sa, { key_id: A.id, webhook_secret: 'rotated-hook-secret' });
  ok(r.status === 200, `webhook secret rotated without re-typing the key secret (${r.status})`);
  r = await j('POST', '/api/payment-links', token, { student_id: stu, amount: 100 });
  ok(r.status === 201 && postedLinks().at(-1).user === A.id, 'kept key secret still works');
  const link3 = await linkRow(r.body.id);
  ok(await hook(hookA, A.hook, paid(link3)) === 403, 'old webhook secret no longer accepted');
  ok(await hook(hookA, 'rotated-hook-secret', paid(link3)) === 200 && (await linkRow(link3.id)).status === 'PAID', 'new webhook secret accepted');
  r = await j('PUT', rzA, sa, { key_id: B.id, webhook_secret: 'rotated-hook-secret' });
  ok(r.status === 400 && /key_secret is required/.test(r.body.error || ''), 'a different Key ID needs its own Key Secret');

  // 11. Admission application fee uses the school's account too.
  const enq = (await pool.query(`INSERT INTO admission_enquiries (school_id, source, phone, parent_name, child_name) VALUES ($1, 'walk_in', $2, 'Enq Parent', 'Enq Child') RETURNING id`, [sidA, `+91980${tag}`])).rows[0].id;
  r = await j('POST', `/api/admissions/enquiries/${enq}/request-payment`, token, { amount: 250 });
  ok(r.status === 201 && r.body.razorpay_account === 'school' && postedLinks().at(-1).user === A.id, `admission fee link created in the school's account (${r.status})`);
  ok(String(r.body.reference_id).length <= 40, `admission reference id fits Razorpay's 40 characters (${String(r.body.reference_id).length})`);
  const adm = r.body;
  await hook('/api/payment-links/webhook', PLATFORM.hook, paid(adm));
  ok((await pool.query('SELECT status FROM admission_payment_links WHERE id = $1', [adm.id])).rows[0].status === 'CREATED', 'platform webhook cannot settle the admission link');
  await hook(hookA, 'rotated-hook-secret', paid(adm));
  ok((await pool.query('SELECT status FROM admission_payment_links WHERE id = $1', [adm.id])).rows[0].status === 'PAID', 'school webhook settles the admission link');
  ok((await pool.query('SELECT stage FROM admission_enquiries WHERE id = $1', [enq])).rows[0].stage === 'applied', 'enquiry moved to applied');

  // 12. Disconnect.
  r = await j('DELETE', rzA, token);
  ok(r.status === 403, `principal cannot disconnect (${r.status})`);
  r = await j('DELETE', rzA, sa);
  ok(r.status === 200 && r.body.connection.connected === false, 'super admin disconnected the account');
  const before = postedLinks().length;
  r = await j('POST', '/api/payment-links', token, { student_id: stu, amount: 100 });
  ok(r.status === 409 && postedLinks().length === before, 'after disconnecting, links are refused again and nothing is created');
  ok(await hook('/api/payment-links/webhook/school/99999999', A.hook, paid(link3)) === 404, 'unknown school webhook URL answers 404');

  await pool.query('DELETE FROM schools WHERE id = $1', [sidB]);
} catch (e) {
  console.error(e);
  fails++;
} finally {
  srv.kill();
  rz.close();
  await pool.end();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}
