// E2E: per-school WhatsApp connection added by a Super Admin.
// THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-schoolWhatsApp.mjs
// Needs Redis on 6390 (same as the other e2e scripts). Uses a mock Meta
// Graph API and a mock SMTP server — nothing leaves the machine.
import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { spawn } from 'child_process';
import pg from 'pg';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5073';
const pool = new pg.Pool({ connectionString: DB });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GOOD_TOKEN = 'EAAG-school-token-good-1234';
const PHONE_ID = '111222333444555';
const NUMBER = '+919812345678';
const APP_SECRET = 'app-secret';

// ---- Mock Meta Graph API ----
const graphCalls = [];
const meta = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    graphCalls.push({ method: req.method, url: req.url, auth, body });
    res.setHeader('Content-Type', 'application/json');
    if (auth !== `Bearer ${GOOD_TOKEN}`) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token.', code: 190 } }));
    }
    if (req.method === 'GET') return res.end(JSON.stringify({ display_phone_number: '+91 98123 45678', verified_name: 'Demo Public School', quality_rating: 'GREEN', id: PHONE_ID }));
    res.end(JSON.stringify({ messages: [{ id: `wamid.${graphCalls.length}` }] }));
  });
});
await new Promise((r) => meta.listen(9996, r));

// ---- Mock SMTP ----
const mails = [];
const smtp = net.createServer((sock) => {
  let inData = false; let data = ''; let buf = ''; let authStep = 0;
  const mail = { from: null, to: [] };
  sock.write('220 mock ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    if (inData) {
      data += buf; buf = '';
      if (data.includes('\r\n.\r\n')) { inData = false; mails.push({ ...mail, data }); data = ''; sock.write('250 OK queued\r\n'); }
      return;
    }
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      const cmd = line.toUpperCase();
      if (authStep === 1) { authStep = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (authStep === 2) { authStep = 0; sock.write('235 Authenticated\r\n'); }
      else if (cmd.startsWith('EHLO')) sock.write('250-mock\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH PLAIN')) sock.write('235 Authenticated\r\n');
      else if (cmd.startsWith('AUTH LOGIN')) { authStep = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (cmd.startsWith('MAIL FROM')) { mail.from = line; sock.write('250 OK\r\n'); }
      else if (cmd.startsWith('RCPT TO')) { mail.to.push(line); sock.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); if (buf) { data = buf; buf = ''; } }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(2526, r));

const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: 'jwt', PORT: '5073', REDIS_URL: 'redis://127.0.0.1:6390', SEED_DEMO_DATA: 'true',
    SUPER_ADMIN_EMAIL: 'sa@waynur.test', SUPER_ADMIN_PASSWORD: 'sa-pass-123',
    WHATSAPP_API_BASE: 'http://127.0.0.1:9996', WHATSAPP_APP_SECRET: APP_SECRET,
    // Old global keys present on purpose — they must be ignored now.
    WHATSAPP_ACCESS_TOKEN: 'old-global-token', WHATSAPP_PHONE_NUMBER_ID: '999',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2526', SMTP_SECURE: 'false', SMTP_USER: 'info@waynur.test', SMTP_PASS: 'x', EMAIL_FROM: 'Waynur <info@waynur.test>' },
  stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(500); }
const j = async (method, path, token, body, headers = {}) => {
  const raw = body ? JSON.stringify(body) : undefined;
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

try {
  const sa = (await j('POST', '/api/super-admin/login', null, { email: 'sa@waynur.test', password: 'sa-pass-123' })).body.token;
  const principal = (await j('POST', '/api/auth/login', null, { email: 'principal@demoschool.test', password: 'changeme123' })).body;
  const token = principal.token || principal.accessToken;
  ok(!!sa && !!token, 'super admin + principal logged in');
  const sid = (await pool.query(`SELECT school_id FROM teachers WHERE email = 'principal@demoschool.test'`)).rows[0].school_id;
  const cls = (await pool.query(`SELECT id FROM classes WHERE school_id = $1 LIMIT 1`, [sid])).rows[0].id;
  const p = (await pool.query(`INSERT INTO parents (school_id, name, phone, opt_in_status) VALUES ($1, 'Opted Parent', '+919999922222', 'OPTED_IN') RETURNING id`, [sid])).rows[0].id;
  const stu = (await pool.query(`INSERT INTO students (school_id, class_id, parent_id, name) VALUES ($1, $2, $3, 'Has Parent') RETURNING id`, [sid, cls, p])).rows[0].id;
  const wa = `/api/super-admin/schools/${sid}/whatsapp`;

  // 1. Not connected → strict: nothing is sent, the old global env keys are ignored.
  let r = await j('POST', '/api/attendance/mark', token, { records: [{ student_id: stu, status: 'absent' }] });
  ok(r.status === 200, `attendance marked while not connected (${r.status})`);
  ok(graphCalls.length === 0, 'no call to Meta at all while the school has no connection (global env keys ignored)');
  ok(JSON.stringify(r.body).includes('WhatsApp is not connected for this school'), 'the result says WhatsApp is not connected');

  // 2. Only a super admin may touch the connection.
  r = await j('PUT', wa, token, { whatsapp_number: NUMBER, phone_number_id: PHONE_ID, access_token: GOOD_TOKEN });
  ok(r.status === 403, `principal cannot add keys (${r.status})`);

  // 3. Wrong token → rejected by Meta, nothing saved, no email.
  r = await j('PUT', wa, sa, { whatsapp_number: NUMBER, phone_number_id: PHONE_ID, access_token: 'bad-token' });
  ok(r.status === 400 && /Meta/.test(r.body.error || ''), `bad token rejected (${r.status}: ${r.body.error})`);
  ok((await pool.query('SELECT 1 FROM school_whatsapp_credentials WHERE school_id = $1', [sid])).rowCount === 0, 'nothing saved for a bad token');
  // Right keys, wrong number typed.
  r = await j('PUT', wa, sa, { whatsapp_number: '+919800000000', phone_number_id: PHONE_ID, access_token: GOOD_TOKEN });
  ok(r.status === 400 && /belong to/.test(r.body.error || ''), `number that does not match the keys rejected (${r.status})`);
  ok(mails.length === 0, 'no email sent for failed attempts');

  // 4. Correct keys → connected, principal emailed.
  r = await j('PUT', wa, sa, { whatsapp_number: '98123 45678', phone_number_id: PHONE_ID, access_token: GOOD_TOKEN, waba_id: '555666777888' });
  ok(r.status === 200 && r.body.connection?.connected === true, `connected (${r.status})`);
  ok(r.body.connection?.whatsapp_number === NUMBER, `number stored in E.164 (${r.body.connection?.whatsapp_number})`);
  ok(r.body.email?.sent === true, `principal emailed (${JSON.stringify(r.body.email)})`);
  ok(!JSON.stringify(r.body).includes(GOOD_TOKEN), 'API response never contains the token');
  ok(mails.length === 1 && mails[0].to.some((t) => t.includes('principal@demoschool.test')), 'email went to the principal address');
  const mailText = mails[0]?.data || '';
  ok(/Subject: WhatsApp is now connected for/.test(mailText), 'email subject is the connection notice');
  ok(!mailText.includes(GOOD_TOKEN) && !mailText.includes(PHONE_ID), 'email contains no keys');
  const stored = (await pool.query('SELECT access_token_enc FROM school_whatsapp_credentials WHERE school_id = $1', [sid])).rows[0].access_token_enc;
  ok(stored.startsWith('v1:') && !stored.includes(GOOD_TOKEN), 'token is encrypted at rest');

  // 5. Principal sees read-only status, never the keys; old OTP route is gone.
  r = await j('GET', '/api/settings', token);
  ok(r.body.whatsapp_connected === true && r.body.whatsapp_business_number === NUMBER, 'principal settings show connected number');
  ok(!JSON.stringify(r.body).includes('access_token') && !JSON.stringify(r.body).includes(GOOD_TOKEN), 'principal settings contain no token');
  r = await j('PATCH', '/api/settings/whatsapp', token, { whatsapp_business_number: '+919999999999' });
  ok(r.status === 404, `principal can no longer set the number (${r.status})`);

  // 6. Sending now uses THIS school's number and token.
  graphCalls.length = 0;
  await pool.query(`DELETE FROM attendance WHERE student_id = $1`, [stu]).catch(() => {});
  r = await j('POST', '/api/attendance/mark', token, { records: [{ student_id: stu, status: 'absent' }] });
  await sleep(300);
  const send = graphCalls.find((c) => c.method === 'POST');
  ok(!!send && send.url === `/${PHONE_ID}/messages` && send.auth === `Bearer ${GOOD_TOKEN}`, `absence alert sent from the school's own number (${send?.url})`);

  // 7. Saving again with the same number (token left blank) → kept, no second email.
  r = await j('PUT', wa, sa, { whatsapp_number: NUMBER, phone_number_id: PHONE_ID });
  ok(r.status === 200 && r.body.email?.sent === false && mails.length === 1, 'token kept when left blank; principal not emailed twice');
  r = await j('POST', `${wa}/notify`, sa);
  ok(r.body.success === true && mails.length === 2, 're-send email works');

  // 8. Inbound webhook: reply goes out from the number that received it.
  graphCalls.length = 0;
  const hook = { entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, messages: [{ from: '919999922222', id: 'wamid.in1', type: 'text', text: { body: 'STOP' } }] } }] }] };
  const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(JSON.stringify(hook)).digest('hex');
  r = await j('POST', '/api/whatsapp/webhook', null, hook, { 'X-Hub-Signature-256': sig });
  ok(r.status === 200 && graphCalls.some((c) => c.url === `/${PHONE_ID}/messages`), 'webhook reply sent from the receiving school number');
  ok((await pool.query('SELECT opt_in_status FROM parents WHERE id = $1', [p])).rows[0].opt_in_status === 'OPTED_OUT', 'STOP honoured for that school');
  graphCalls.length = 0;
  hook.entry[0].changes[0].value.metadata.phone_number_id = '000000000';
  const sig2 = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(JSON.stringify(hook)).digest('hex');
  await j('POST', '/api/whatsapp/webhook', null, hook, { 'X-Hub-Signature-256': sig2 });
  ok(graphCalls.length === 0, 'message for an unknown number is ignored');

  // 9. A second school cannot reuse the same Phone Number ID.
  r = await j('POST', '/api/super-admin/schools', sa, { name: 'Second School', principal_name: 'P Two', principal_email: 'p2@second.test', principal_phone: '9876500000', principal_password: 'secret12',
    whatsapp_number: NUMBER, whatsapp_phone_number_id: PHONE_ID, whatsapp_access_token: GOOD_TOKEN });
  ok(r.status === 201 && r.body.whatsapp?.connected === false && /already connected/.test(r.body.whatsapp?.error || ''), 'school created, duplicate Phone Number ID refused');

  // 10. Disconnect → strict again.
  r = await j('DELETE', wa, sa);
  ok(r.status === 200 && r.body.connection?.connected === false, 'disconnected');
  ok((await pool.query('SELECT 1 FROM school_whatsapp_credentials WHERE school_id = $1', [sid])).rowCount === 0, 'keys deleted on disconnect');
  r = await j('POST', `${wa}/test`, sa, { to: '+919999922222' });
  ok(r.status === 409, `sending refused after disconnect (${r.status})`);
} catch (err) {
  console.error(err); fails++;
} finally {
  srv.kill(); meta.close(); smtp.close(); await pool.end();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASSED (0 failures)');
  process.exit(fails ? 1 : 0);
}
