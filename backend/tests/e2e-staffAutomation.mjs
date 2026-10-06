// E2E: homework alert, substitution notices, class reminders, daily guidance
// and the automation setup status, against a real database and a mock of
// Meta's Graph API that records every WhatsApp it is asked to send.
// THROWAWAY database only:  E2E_DATABASE_URL=postgres://... node tests/e2e-staffAutomation.mjs
import http from 'http';
import { spawn } from 'child_process';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const DB = process.env.E2E_DATABASE_URL || 'postgres://w:w@127.0.0.1:5432/waynur';
const API = 'http://127.0.0.1:5073';
const META_PORT = 9996;
process.env.DATABASE_URL = DB;
process.env.JWT_SECRET = 'jwt';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6390';
process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${META_PORT}`;

const pool = new pg.Pool({ connectionString: DB });
pool.on('connect', (c) => c.query("SET TIME ZONE 'Asia/Kolkata'"));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = async (sql, params) => (await pool.query(sql, params)).rows;

// Mock Graph API. Like production today, templates are approved in English
// only: a Hindi/Punjabi send is rejected with 132001, anything else accepted.
const sentToMeta = [];
const meta = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* ignore */ }
    const t = body.template || {};
    const lang = t.language?.code;
    res.setHeader('Content-Type', 'application/json');
    if (lang && lang !== 'en') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: 'Template name does not exist in the translation', code: 132001 } }));
    }
    sentToMeta.push({ to: body.to, name: t.name, lang, params: (t.components?.[0]?.parameters || []).map((p) => p.text) });
    res.end(JSON.stringify({ messages: [{ id: `wamid.${sentToMeta.length}` }] }));
  });
});
await new Promise((r) => meta.listen(META_PORT, r));
const metaFor = (name) => sentToMeta.filter((m) => m.name === name);

const srv = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: '5073', SEED_DEMO_DATA: 'true' },
  stdio: process.env.E2E_SERVER_LOG ? 'inherit' : 'ignore',
});
for (let i = 0; i < 80; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch { /* not up yet */ } await sleep(500); }

const j = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const login = async (email) => {
  const r = await j('POST', '/api/auth/login', null, { email, password: 'changeme123' });
  return r.body.token || r.body.accessToken;
};

try {
  // The services under test, loaded into this process so "the day of the
  // class" can be simulated by passing a date instead of waiting for it.
  const { sendDueSubstitutionAlerts } = await import('../services/substitutionService.js');
  const { runUpcomingClassReminders } = await import('../services/teachingReminderService.js');
  const { runDailyGuidance } = await import('../services/dailyGuidanceService.js');
  const { encryptSecret } = await import('../utils/secretBox.js');

  // ---------- fixtures ----------
  const sid = (await q(`SELECT school_id FROM teachers WHERE email = 'principal@demoschool.test'`))[0].school_id;
  await pool.query(`INSERT INTO school_settings (school_id, whatsapp_business_number, whatsapp_phone_number_id, whatsapp_connected) VALUES ($1, '+919800000001', '1', TRUE)
    ON CONFLICT (school_id) DO UPDATE SET whatsapp_business_number = EXCLUDED.whatsapp_business_number, whatsapp_phone_number_id = '1', whatsapp_connected = TRUE`, [sid]);
  await pool.query(`INSERT INTO school_whatsapp_credentials (school_id, access_token_enc) VALUES ($1, $2)
    ON CONFLICT (school_id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc`, [sid, encryptSecret('x')]);

  const hash = await bcrypt.hash('changeme123', 4);
  const tag = Date.now();
  const mkTeacher = async (name, wa) => (await q(
    `INSERT INTO teachers (school_id, name, email, phone, password_hash, role, whatsapp_number, whatsapp_opt_in_status)
     VALUES ($1, $2, $3, '9000000000', $4, 'teacher', $5, $6) RETURNING id`,
    [sid, name, `${name.toLowerCase().replace(/\s+/g, '.')}.${tag}@e2e.test`, hash, wa, wa ? 'OPTED_IN' : 'OPTED_OUT']
  ))[0].id;
  const T2 = (await q(`SELECT id FROM teachers WHERE email = 'teacher@demoschool.test'`))[0].id; // "Demo Teacher", no WhatsApp
  const T3 = await mkTeacher('Second Teacher', '+919000000003');
  const T4 = await mkTeacher('Third Teacher', '+919000000004');
  const T5 = await mkTeacher('Fifth Teacher', '+919000000005');
  const t3Email = (await q(`SELECT email FROM teachers WHERE id = $1`, [T3]))[0].email;

  const cls = (await q(`SELECT id, name FROM classes WHERE school_id = $1 ORDER BY id LIMIT 1`, [sid]))[0];
  const mkSubject = async (name) => (await q(`INSERT INTO subjects (school_id, name) VALUES ($1, $2) ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [sid, name]))[0].id;
  const maths = await mkSubject('Maths');
  const science = await mkSubject('Science');
  const english = await mkSubject('English');
  await pool.query(`DELETE FROM class_subject_teachers WHERE class_id = $1`, [cls.id]);
  await pool.query(`INSERT INTO class_subject_teachers (school_id, class_id, subject_id, teacher_id) VALUES ($1,$2,$3,$4), ($1,$2,$5,$6), ($1,$2,$7,$8)`,
    [sid, cls.id, maths, T2, science, T3, english, T5]);

  // A second school: nothing in it may be reachable from the first.
  const other = (await q(`INSERT INTO schools (name, status) VALUES ('Other School ${tag}', 'active') RETURNING id`))[0].id;
  const otherClass = (await q(`INSERT INTO classes (school_id, name) VALUES ($1, 'Other 1A') RETURNING id`, [other]))[0].id;
  const otherSubject = (await q(`INSERT INTO subjects (school_id, name) VALUES ($1, 'Maths') RETURNING id`, [other]))[0].id;

  const principal = await login('principal@demoschool.test');
  const teacher = await login('teacher@demoschool.test');
  const teacher3 = await login(t3Email);
  const studentLogin = await j('POST', '/api/auth/student-login', null, { login_id: 'STU001', pin: '1234' });
  const student = studentLogin.body.token || studentLogin.body.accessToken;
  ok(!!principal && !!teacher && !!teacher3 && !!student, 'logged in as principal, two teachers and a student');

  const day = (await q(`SELECT CURRENT_DATE::text AS today, (CURRENT_DATE + 1)::text AS tomorrow, (CURRENT_DATE - 1)::text AS yesterday,
      EXTRACT(ISODOW FROM CURRENT_DATE)::int AS dow, to_char(LOCALTIME, 'HH24:MI') AS now_hm`))[0];

  // ================= 1. Homework =================
  console.log('\n-- Homework');
  const opts = await j('GET', '/api/homework/options', teacher);
  ok(opts.status === 200 && opts.body.length === 1 && opts.body[0].subject_name === 'Maths', 'teacher is offered only the class + subject they teach');
  const optsP = await j('GET', '/api/homework/options', principal);
  ok(optsP.body.length === 3, 'principal is offered every assigned class + subject');

  const hw = await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: maths, title: '  Chapter 5 \n  exercises ', description: 'Q1 to Q10', due_date: day.tomorrow });
  ok(hw.status === 201 && hw.body.subject_name === 'Maths', `homework created (${hw.status})`);
  ok(hw.body.title === 'Chapter 5 exercises', 'title is tidied onto one line');
  ok(hw.body.due_date === day.tomorrow, 'due date comes back as a plain date');
  await sleep(1200);
  const hwMsgs = metaFor('homework_assigned_alert');
  ok(hwMsgs.length === 1, `parent got exactly one homework WhatsApp (${hwMsgs.length})`);
  ok(hwMsgs[0]?.lang === 'en', 'sent in English after Hindi was not available');
  ok(hwMsgs[0]?.params[0] === 'Demo Student' && hwMsgs[0]?.params[1] === 'Maths' && hwMsgs[0]?.params[2] === 'Chapter 5 exercises',
    `message carries student, subject NAME and title (${JSON.stringify(hwMsgs[0]?.params)})`);
  ok(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(hwMsgs[0]?.params[3] || ''), `due date is readable (${hwMsgs[0]?.params[3]})`);

  const stuList = await j('GET', '/api/student/homework', student);
  ok(stuList.body.some((h) => h.id === hw.body.id && h.subject_id === 'Maths'), 'student sees it with the subject name');
  const stuBell = await q(`SELECT title, body FROM dashboard_notifications WHERE trigger_event = 'homework_assigned' AND recipient_type = 'student' ORDER BY id DESC LIMIT 1`);
  ok(/Chapter 5 exercises/.test(stuBell[0]?.title || '') && /^Maths/.test(stuBell[0]?.body || ''), `student bell notification reads right ("${stuBell[0]?.body}")`);

  const dup = await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: maths, title: 'chapter 5 exercises', due_date: day.tomorrow });
  await sleep(600);
  ok(dup.status === 409 && metaFor('homework_assigned_alert').length === 1, 'a double submit is refused and parents are not messaged twice');

  ok((await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: science, title: 'x' })).status === 403, 'teacher cannot assign for a subject they do not teach');
  ok((await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: maths, title: 'x', due_date: day.yesterday })).status === 400, 'past due date refused');
  ok((await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: maths, title: 'x', due_date: '2026-02-31' })).status === 400, 'impossible date refused');
  ok((await j('POST', '/api/homework', teacher, { class_id: cls.id, subject_id: maths, title: '   ' })).status === 400, 'empty title refused');
  ok((await j('POST', '/api/homework', principal, { class_id: otherClass, subject_id: maths, title: 'x' })).status === 404, 'another school\'s class is not reachable');
  ok((await j('POST', '/api/homework', principal, { class_id: cls.id, subject_id: otherSubject, title: 'x' })).status === 404, 'another school\'s subject is not reachable');
  ok((await j('POST', '/api/student/homework', principal, { class_id: otherClass, subject_id: otherSubject, title: 'x' })).status === 404, 'the older endpoint has the same protection');
  ok((await j('GET', '/api/homework', student)).status === 403, 'students cannot use the staff homework API');
  ok((await q(`SELECT COUNT(*)::int AS n FROM homework WHERE class_id = $1`, [otherClass]))[0].n === 0, 'nothing was written into the other school');

  await j('POST', `/api/student/homework/${hw.body.id}/toggle`, student);
  const listP = await j('GET', '/api/homework', principal);
  const rowP = listP.body.find((h) => h.id === hw.body.id);
  ok(rowP && rowP.student_count >= 1 && rowP.done_count === 1 && rowP.class_name === cls.name, 'principal sees it with the done count');
  ok((await j('GET', '/api/homework', teacher3)).body.every((h) => h.id !== hw.body.id), 'another teacher does not see it in their list');
  ok((await j('DELETE', `/api/homework/${hw.body.id}`, teacher3)).status === 404, 'another teacher cannot delete it');
  ok((await j('DELETE', `/api/homework/${hw.body.id}`, teacher)).status === 200, 'its author can delete it');
  ok((await j('GET', '/api/student/homework', student)).body.every((h) => h.id !== hw.body.id), 'it is gone from the student\'s list');

  // ================= 2. Setup status =================
  console.log('\n-- Setup status');
  const ready = await j('GET', '/api/automation-readiness', principal);
  const item = (k) => ready.body.items?.find((i) => i.key === k);
  ok(ready.status === 200 && item('whatsapp')?.done === true, 'WhatsApp shows as connected');
  const staffCount = (await q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE whatsapp_number IS NOT NULL AND whatsapp_opt_in_status = 'OPTED_IN')::int AS wa FROM teachers WHERE school_id = $1`, [sid]))[0];
  ok(item('staff_whatsapp')?.done === false && item('staff_whatsapp')?.detail === `${staffCount.wa} of ${staffCount.total} staff have a WhatsApp number`, `staff numbers are counted (${item('staff_whatsapp')?.detail})`);
  ok(item('timetable')?.done === false && item('timetable')?.detail === 'No periods yet', 'empty timetable is reported');
  ok(item('syllabus')?.done === false, 'empty syllabus calendar is reported');
  ok((await j('GET', '/api/automation-readiness', teacher)).status === 403, 'teachers cannot read the setup status');

  // ================= 3. Substitution =================
  console.log('\n-- Substitution');
  // 3a. A teacher is absent but the school has no timetable.
  const noTt = await j('POST', '/api/substitutions/mark-absent', principal, { teacher_id: T2 });
  ok(noTt.status === 200 && noTt.body.noTimetable === true && noTt.body.assigned === 0, 'no timetable: nothing planned, and it says why');
  const exc = await q(`SELECT title, body, status FROM ops_exceptions WHERE school_id = $1 AND dedupe_key = 'sub_no_timetable'`, [sid]);
  ok(exc.length === 1 && exc[0].status === 'open' && /Demo Teacher/.test(exc[0].body), 'Control Center inbox explains the missing timetable');
  await j('POST', '/api/substitutions/mark-absent', principal, { teacher_id: T2 });
  ok((await q(`SELECT COUNT(*)::int AS n FROM ops_exceptions WHERE school_id = $1 AND dedupe_key = 'sub_no_timetable' AND status = 'open'`, [sid]))[0].n === 1, 'the inbox item is not duplicated');

  // 3b. Leave approved in advance, for a school day at least two days away.
  const future = (await q(`SELECT d::date::text AS date, EXTRACT(ISODOW FROM d)::int AS dow FROM generate_series(CURRENT_DATE + 2, CURRENT_DATE + 4, INTERVAL '1 day') d
                           WHERE EXTRACT(ISODOW FROM d) <> 7 ORDER BY d LIMIT 1`))[0];
  await pool.query(`INSERT INTO timetable_slots (school_id, class_id, day_of_week, period_number, start_time, end_time, subject_id, teacher_id) VALUES ($1,$2,$3,1,'09:00','09:40',$4,$5)`,
    [sid, cls.id, future.dow, maths, T2]);
  await pool.query(`INSERT INTO lesson_plans (school_id, class_id, subject_id, teacher_id, title, plan_date) VALUES ($1,$2,$3,$4,'Fractions revision',$5)`, [sid, cls.id, maths, T2, future.date]);
  await pool.query(`INSERT INTO staff_leave_requests (school_id, teacher_id, leave_type, start_date, end_date, days_count, status) VALUES ($1,$2,'casual',$3,$3,1,'APPROVED')`, [sid, T2, future.date]);
  const before = sentToMeta.length;
  const plan = await j('POST', '/api/substitutions/plan', principal, { date: future.date });
  ok(plan.status === 200 && plan.body.assigned === 1 && plan.body.unfilled === 0, `cover planned for ${future.date} (${JSON.stringify(plan.body)})`);
  let sub = (await q(`SELECT id, substitute_teacher_id, notify_pending, status FROM substitutions WHERE school_id = $1 AND date = $2`, [sid, future.date]))[0];
  ok(sub?.status === 'assigned' && sub.notify_pending === true, 'substitute chosen and marked "still to be told on WhatsApp"');
  ok(sentToMeta.length === before, 'no "substitution today" WhatsApp is sent days ahead');
  const bell = (await q(`SELECT title, body FROM dashboard_notifications WHERE trigger_event = 'substitution_assigned' AND recipient_id = $1 ORDER BY id DESC LIMIT 1`, [sub.substitute_teacher_id]))[0];
  ok(/^Substitution on (Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2}$/.test(bell?.title || ''), `bell notification names the day ("${bell?.title}")`);
  ok(bell?.body === `Period 1 (09:00), ${cls.name}, Maths for Demo Teacher. Lesson plan: Fractions revision.`, `bell notification has the details ("${bell?.body}")`);
  ok((await q(`SELECT status FROM ops_exceptions WHERE school_id = $1 AND dedupe_key = 'sub_no_timetable' ORDER BY id DESC LIMIT 1`, [sid]))[0].status === 'resolved', 'the "no timetable" inbox item closes itself once a timetable exists');

  // 3c. The day arrives.
  let r = await sendDueSubstitutionAlerts(sid, { today: future.date, nowTime: '05:10:00' });
  ok(r.sent === 0 && sentToMeta.length === before, 'nothing is sent before the morning');
  r = await sendDueSubstitutionAlerts(sid, { today: future.date, nowTime: '07:00:00' });
  const subMsgs = () => metaFor('substitution_assigned');
  ok(r.sent === 1 && subMsgs().length === 1, 'on the day, the substitute gets the WhatsApp');
  const subName = (await q(`SELECT name, whatsapp_number FROM teachers WHERE id = $1`, [sub.substitute_teacher_id]))[0];
  ok(subMsgs()[0]?.to === subName.whatsapp_number.replace('+', '') && subMsgs()[0]?.params[0] === subName.name
    && subMsgs()[0]?.params[1] === `Period 1 (09:00), ${cls.name}, Maths for Demo Teacher. Lesson plan: Fractions revision.`, 'it goes to the right teacher with the right details');
  r = await sendDueSubstitutionAlerts(sid, { today: future.date, nowTime: '07:15:00' });
  ok(r.sent === 0 && subMsgs().length === 1, 'the next cycle does not send it again');

  // 3d. Operator changes the substitute by hand.
  const firstSub = sub.substitute_teacher_id;
  const newSub = [T3, T4, T5].find((t) => t !== firstSub);
  const patch = await j('PATCH', `/api/substitutions/${sub.id}`, principal, { substitute_teacher_id: newSub });
  ok(patch.status === 200, 'manual reassignment accepted');
  sub = (await q(`SELECT substitute_teacher_id, notify_pending FROM substitutions WHERE id = $1`, [sub.id]))[0];
  ok(sub.substitute_teacher_id === newSub && sub.notify_pending === true, 'new substitute is queued for a WhatsApp');
  ok((await q(`SELECT COUNT(*)::int AS n FROM dashboard_notifications WHERE trigger_event = 'substitution_cancelled' AND recipient_id = $1`, [firstSub]))[0].n === 1, 'the previous substitute is told it is cancelled');
  ok(/^Substitution on /.test((await q(`SELECT title FROM dashboard_notifications WHERE trigger_event = 'substitution_assigned' AND recipient_id = $1 ORDER BY id DESC LIMIT 1`, [newSub]))[0]?.title || ''), 'the new substitute gets the detailed bell notification');
  ok((await j('PATCH', `/api/substitutions/${sub.id ?? 0}`, principal, { substitute_teacher_id: newSub })).status !== 500, 'reassigning to the same teacher is harmless');

  // 3e. New substitute has no WhatsApp number yet, then gets one.
  ok((await j('DELETE', `/api/teachers/${newSub}/whatsapp`, principal)).status === 200, 'principal can remove a staff WhatsApp number');
  ok((await j('DELETE', `/api/teachers/${newSub}/whatsapp`, teacher)).status === 403, 'a teacher cannot');
  r = await sendDueSubstitutionAlerts(sid, { today: future.date, nowTime: '07:30:00' });
  ok(r.sent === 0 && subMsgs().length === 1, 'no number: nothing sent, nothing lost');
  await j('POST', `/api/teachers/${newSub}/whatsapp`, principal, { whatsapp_number: '9000000099' });
  r = await sendDueSubstitutionAlerts(sid, { today: future.date, nowTime: '07:45:00' });
  ok(r.sent === 1 && subMsgs().length === 2 && subMsgs()[1].to === '919000000099', 'once a number is added, the pending WhatsApp goes out');

  // ================= 4. Today: same-day cover + class reminders =================
  if (day.dow === 7) {
    console.log('\n-- Today is Sunday: same-day substitution and class reminder checks skipped');
  } else {
    console.log('\n-- Same-day cover');
    // T2 was marked absent for today in 3a. Their period starts in 5 minutes.
    await pool.query(`DELETE FROM timetable_slots WHERE class_id = $1 AND day_of_week = $2`, [cls.id, day.dow]);
    const slotAt = async (period, mins, subject, t) => (await q(
      `INSERT INTO timetable_slots (school_id, class_id, day_of_week, period_number, start_time, subject_id, teacher_id)
       VALUES ($1,$2,$3,$4, (CURRENT_TIME + ($5 || ' minutes')::interval)::time, $6, $7) RETURNING id`, [sid, cls.id, day.dow, period, mins, subject, t]))[0].id;
    const slotAbsent = await slotAt(1, 5, maths, T2);
    const slotPresent = await slotAt(2, 6, science, T3);
    const beforeToday = subMsgs().length;
    const planToday = await j('POST', '/api/substitutions/plan', principal, {});
    ok(planToday.body.assigned === 1, `same-day cover planned (${JSON.stringify(planToday.body)})`);
    const subToday = (await q(`SELECT substitute_teacher_id, notify_pending FROM substitutions WHERE timetable_slot_id = $1 AND date = CURRENT_DATE`, [slotAbsent]))[0];
    const hasNumber = (await q(`SELECT whatsapp_number FROM teachers WHERE id = $1`, [subToday.substitute_teacher_id]))[0].whatsapp_number;
    if (day.now_hm >= '06:30' && hasNumber) {
      ok(subMsgs().length === beforeToday + 1 && subToday.notify_pending === false, 'same-day cover is sent on WhatsApp straight away');
    } else {
      ok(subMsgs().length === beforeToday && subToday.notify_pending === true, 'outside notify hours / no number: kept pending');
    }
    ok((await q(`SELECT title FROM dashboard_notifications WHERE trigger_event = 'substitution_assigned' AND recipient_id = $1 ORDER BY id DESC LIMIT 1`, [subToday.substitute_teacher_id]))[0]?.title === 'Substitution today', 'same-day bell notification says "today"');

    console.log('\n-- Class reminders');
    // A third period whose teacher is on leave today with nobody covering.
    await pool.query(`INSERT INTO staff_leave_requests (school_id, teacher_id, leave_type, start_date, end_date, days_count, status) VALUES ($1,$2,'sick',CURRENT_DATE,CURRENT_DATE,1,'APPROVED')`, [sid, T5]);
    const slotUncovered = await slotAt(3, 7, english, T5);
    const remBefore = metaFor('upcoming_class_alert').length;
    const run1 = await runUpcomingClassReminders();
    const logFor = async (slot) => (await q(`SELECT teacher_id FROM teaching_reminder_log WHERE timetable_slot_id = $1 AND class_date = CURRENT_DATE`, [slot])).map((x) => x.teacher_id);
    ok(JSON.stringify(await logFor(slotAbsent)) === JSON.stringify([subToday.substitute_teacher_id]), 'absent teacher\'s period: the SUBSTITUTE is reminded, not the absent teacher');
    const subBell = (await q(`SELECT body FROM dashboard_notifications WHERE trigger_event = 'upcoming_class_reminder' AND recipient_id = $1 AND body LIKE '%Maths%' ORDER BY id DESC LIMIT 1`, [subToday.substitute_teacher_id]))[0];
    ok(/You are covering for Demo Teacher\./.test(subBell?.body || ''), `substitute's reminder says who they cover for ("${subBell?.body}")`);
    ok(JSON.stringify(await logFor(slotPresent)) === JSON.stringify([T3]), 'a present teacher is reminded about their own period');
    ok((await logFor(slotUncovered)).length === 0, 'a teacher on leave with no cover is not reminded');
    ok(run1.skipped >= 1 && run1.failed === 0, `run reports the skip and no failures (${JSON.stringify(run1)})`);
    const remAfter = metaFor('upcoming_class_alert');
    ok(remAfter.length > remBefore && remAfter.every((m) => m.params.length === 3), `WhatsApp reminders sent with 3 variables (${remAfter.length - remBefore})`);
    const count1 = remAfter.length;
    await runUpcomingClassReminders();
    ok(metaFor('upcoming_class_alert').length === count1, 'the overlapping next poll sends nothing twice');
  }

  // ================= 5. Daily guidance =================
  console.log('\n-- Daily guidance');
  await pool.query(`DELETE FROM syllabus_calendar WHERE school_id = $1`, [sid]);
  await pool.query(
    `INSERT INTO syllabus_calendar (school_id, class_id, subject_id, chapter_id, chapter_name, target_start_date, target_end_date, subject_ref_id) VALUES
       ($1,$2,'MATH','M5','Fractions', CURRENT_DATE - 1, CURRENT_DATE + 3, $3),
       ($1,$2,'SCI','S2','Light', CURRENT_DATE - 1, CURRENT_DATE + 3, $4),
       ($1,$2,'ENG','E1','Untagged chapter', CURRENT_DATE - 1, CURRENT_DATE + 3, NULL)`, [sid, cls.id, maths, science]);
  const gBefore = metaFor('daily_teaching_guidance').length;
  const g1 = await runDailyGuidance();
  if (day.dow === 7) {
    ok(g1.note === 'sunday' && metaFor('daily_teaching_guidance').length === gBefore, 'Sunday: no guidance is sent');
  } else {
    const bellT2 = await q(`SELECT title, body, whatsapp_status FROM dashboard_notifications WHERE trigger_event = 'daily_teaching_guidance' AND recipient_id = $1`, [T2]);
    ok(bellT2.length === 1 && /Fractions/.test(bellT2[0].body), 'a teacher WITHOUT WhatsApp still gets the guidance in their portal');
    const gMsgs = metaFor('daily_teaching_guidance').slice(gBefore);
    const t3Number = (await q(`SELECT whatsapp_number FROM teachers WHERE id = $1`, [T3]))[0].whatsapp_number.replace('+', '');
    ok(gMsgs.length === 1 && String(gMsgs[0].to).replace('+', '') === t3Number && gMsgs[0].params.length === 4 && gMsgs[0].params[0] === 'Second Teacher' && gMsgs[0].params[2] === 'Light', `a teacher with WhatsApp gets the template with 4 variables (${JSON.stringify(gMsgs[0]?.params)})`);
    ok(g1.sent === 2 && g1.failed === 0, `two chapters, two nudges; the untagged chapter is left out (${JSON.stringify(g1)})`);
    const g2 = await runDailyGuidance();
    ok(g2.sent === 0 && g2.skipped === 2 && metaFor('daily_teaching_guidance').length === gBefore + 1, 'running it again the same day sends nothing new');
  }
  const ready2 = await j('GET', '/api/automation-readiness', principal);
  ok(ready2.body.items.find((i) => i.key === 'syllabus')?.detail === '2 of 3 chapters are linked to a subject', 'setup status counts the untagged chapter');
  ok(ready2.body.items.find((i) => i.key === 'timetable')?.done === false && /of \d+ teachers have periods/.test(ready2.body.items.find((i) => i.key === 'timetable')?.detail), 'setup status shows a partly-built timetable');
  const runNow = await j('POST', '/api/ops/automations/daily_guidance/run-now', principal);
  ok(runNow.status === 200 || runNow.status === 429, `daily guidance can be run on demand from the Control Center (${runNow.status})`);
} catch (err) {
  console.error(err); fails++;
} finally {
  srv.kill(); meta.close(); await pool.end();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASSED (0 failures)');
  process.exit(fails ? 1 : 0);
}
