import pool from '../config/db.js';
import { getStudentDues } from '../utils/feeDues.js';
import { getStudentFeeSummary } from './studentFees.js';
import { searchStudents } from './studentMatch.js';
import { getLearningProfile } from './studentMemory.js';
import { hasAction } from './opsService.js';

// The assistant's hands. Every tool is READ-ONLY and the school is always the
// caller's own (req.user.school_id) — the model never supplies a school id or
// any SQL. Results are capped so one question can't pull a whole table.
// The only way it can change anything is propose_action, which just queues a
// request that a person must approve.

const MAX_ROWS = 25;
const clip = (rows) => ({ rows: rows.slice(0, MAX_ROWS), total: rows.length, truncated: rows.length > MAX_ROWS });
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const today = async () => (await pool.query(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;

export const TOOLS = [
  {
    name: 'search_students',
    description: 'Find students by name, login ID or admission number. Returns id, name, class. Use this first when a question names a student.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_student_overview',
    description: 'Everything about one student: profile, class, parent contacts, fee structure with paid/unpaid, attendance % for the last 30 days, list of uploaded documents (names only), recent exam marks and the AI tutor learning profile (strengths, struggles, interests, how they learn, what would help next).',
    input_schema: { type: 'object', properties: { student_id: { type: 'integer' } }, required: ['student_id'] },
  },
  {
    name: 'list_fee_defaulters',
    description: 'Students with unpaid tuition for this academic year, largest due first. Optional class name filter (e.g. "7A") and minimum due amount.',
    input_schema: { type: 'object', properties: { class_name: { type: 'string' }, min_due: { type: 'number' } } },
  },
  {
    name: 'fee_collection_summary',
    description: 'Fees collected between two dates (YYYY-MM-DD), total and by payment mode. Defaults to the last 30 days.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
  {
    name: 'attendance_report',
    description: 'Student attendance for one date (default today): present/absent/late counts per class and the names of absent students.',
    input_schema: { type: 'object', properties: { date: { type: 'string' }, class_name: { type: 'string' } } },
  },
  {
    name: 'staff_overview',
    description: 'List staff with role, phone, WhatsApp opt-in status, and staff on approved leave today.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'payroll_summary',
    description: 'Payroll run for a month (YYYY-MM): status, totals and flagged anomalies. Defaults to the latest run.',
    input_schema: { type: 'object', properties: { period: { type: 'string' } } },
  },
  {
    name: 'exam_results_summary',
    description: 'Average marks per subject for an exam, by exam name search (e.g. "Mid-Term") and optional class name.',
    input_schema: { type: 'object', properties: { exam_name: { type: 'string' }, class_name: { type: 'string' } }, required: ['exam_name'] },
  },
  {
    name: 'admissions_pipeline',
    description: 'Admission enquiries counted by stage, plus the most recent enquiries.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'control_center_status',
    description: 'Open items in the Control Center inbox (by severity, with titles) and the health/last-run status of every automation.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_records',
    description: 'Recent records of one kind: "certificates" (issued), "document_requests", "student_leave", "staff_leave", "events", "homework". Optional text filter on the title/name.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['certificates', 'document_requests', 'student_leave', 'staff_leave', 'events', 'homework'] }, filter: { type: 'string' } }, required: ['kind'] },
  },
  {
    name: 'create_document',
    description: 'Save a finished document (circular, notice, letter, report, minutes, policy…) so the person can download it as a PDF. Write the full final text in plain text with blank lines between paragraphs. Use after you have gathered any facts it needs.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
  },
  {
    name: 'remember',
    description: 'Save something to the school\'s long-term memory (a preference, policy, name, or lesson). Use ONLY when the person asks you to remember something, or you learned a durable fact they confirmed. Never store personal data about individual students or parents.',
    input_schema: { type: 'object', properties: { content: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'policy', 'lesson'] } }, required: ['content'] },
  },
  {
    name: 'propose_action',
    description: 'Ask the person to approve a change. Nothing happens until they click Approve. Only actions in the available list can be proposed.',
    input_schema: { type: 'object', properties: { action_key: { type: 'string' }, params: { type: 'object' }, summary: { type: 'string', description: 'One plain sentence saying exactly what will happen.' } }, required: ['action_key', 'summary'] },
  },
];

async function classFilter(schoolId, className) {
  if (!className) return null;
  const r = await pool.query('SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = LOWER($2)', [schoolId, String(className).trim()]);
  return r.rows[0]?.id ?? -1;
}

const handlers = {
  async search_students({ schoolId }, { query }) {
    return clip(await searchStudents(schoolId, query, MAX_ROWS));
  },

  async get_student_overview({ schoolId }, { student_id }) {
    const s = await pool.query(
      `SELECT st.id, st.name, st.login_id, st.admission_number, c.name AS class_name,
              sp.date_of_birth, sp.gender, sp.blood_group, sp.admission_date
         FROM students st LEFT JOIN classes c ON c.id = st.class_id LEFT JOIN student_profiles sp ON sp.student_id = st.id
        WHERE st.id = $1 AND st.school_id = $2`,
      [student_id, schoolId]
    );
    if (!s.rowCount) return { error: 'Student not found' };
    const [parents, fees, att, docs, marks, learning] = await Promise.all([
      pool.query('SELECT relation, name, phone, email FROM parent_profiles WHERE student_id = $1 AND school_id = $2', [student_id, schoolId]),
      getStudentFeeSummary(schoolId, student_id),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present, COUNT(*)::int AS total
           FROM attendance WHERE student_id = $1 AND school_id = $2 AND date >= CURRENT_DATE - 30`, [student_id, schoolId]).catch(() => ({ rows: [{}] })),
      pool.query('SELECT doc_type, title, created_at FROM student_documents WHERE student_id = $1 AND school_id = $2 ORDER BY created_at DESC', [student_id, schoolId]),
      pool.query(
        `SELECT e.name AS exam, sub.name AS subject, m.marks_obtained, m.max_marks
           FROM exam_marks m JOIN exams e ON e.id = m.exam_id JOIN subjects sub ON sub.id = m.subject_id
          WHERE m.student_id = $1 AND m.school_id = $2 ORDER BY e.created_at DESC LIMIT 20`, [student_id, schoolId]),
      getLearningProfile(schoolId, student_id),
    ]);
    return {
      student: s.rows[0],
      parents: parents.rows,
      fees: fees && { tuition: fees.tuition, transport_due: fees.transport.due, total_due: fees.total_due, recent_payments: fees.payments.slice(0, 5) },
      attendance_last_30_days: att.rows[0],
      documents_on_file: docs.rows,
      recent_marks: marks.rows,
      ai_tutor_learning_profile: learning ? { summary: learning.summary, strengths: learning.strengths, struggles: learning.struggles, interests: learning.interests, engagement: learning.engagement, next_steps: learning.next_steps } : 'No tutoring history yet',
    };
  },

  async list_fee_defaulters({ schoolId }, { class_name, min_due }) {
    const classId = await classFilter(schoolId, class_name);
    if (classId === -1) return { error: `No class named "${class_name}"` };
    const { rows } = await pool.query(
      `SELECT s.id AS student_id, s.name, c.name AS class_name, fs.amount AS fee,
              COALESCE(p.paid, 0) AS paid, fs.amount - COALESCE(p.paid, 0) AS due
         FROM students s JOIN classes c ON c.id = s.class_id
         JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
         LEFT JOIN LATERAL (
           SELECT SUM(h.amount_paid) AS paid FROM student_payment_history h
            WHERE h.student_id = s.id AND h.school_id = s.school_id
              AND h.created_at >= (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                                        THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 4, 1)
                                        ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int - 1, 4, 1) END)
              AND (h.remarks IS NULL OR h.remarks NOT LIKE 'Transport fee%')) p ON TRUE
        WHERE s.school_id = $1 AND ($2::int IS NULL OR s.class_id = $2) AND fs.amount - COALESCE(p.paid, 0) > GREATEST($3::numeric, 0)
        ORDER BY due DESC`,
      [schoolId, classId, Number(min_due) || 0]
    );
    return { ...clip(rows.map((r) => ({ ...r, fee: Number(r.fee), paid: Number(r.paid), due: Number(r.due) }))), total_due: rows.reduce((a, r) => a + Number(r.due), 0) };
  },

  async fee_collection_summary({ schoolId }, { from, to }) {
    const end = isoDate(to) || (await today());
    const start = isoDate(from) || (await pool.query(`SELECT ($1::date - 30)::text AS d`, [end])).rows[0].d;
    const { rows } = await pool.query(
      `SELECT payment_mode, COUNT(*)::int AS payments, SUM(amount_paid) AS total
         FROM student_payment_history WHERE school_id = $1 AND created_at::date BETWEEN $2 AND $3 GROUP BY payment_mode ORDER BY total DESC`,
      [schoolId, start, end]
    );
    return { from: start, to: end, by_mode: rows.map((r) => ({ ...r, total: Number(r.total) })), grand_total: rows.reduce((a, r) => a + Number(r.total), 0) };
  },

  async attendance_report({ schoolId }, { date, class_name }) {
    const d = isoDate(date) || (await today());
    const classId = await classFilter(schoolId, class_name);
    if (classId === -1) return { error: `No class named "${class_name}"` };
    const [summary, absent] = await Promise.all([
      pool.query(
        `SELECT c.name AS class_name, COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
                COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent, COUNT(*) FILTER (WHERE a.status = 'late')::int AS late
           FROM attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = s.class_id
          WHERE a.school_id = $1 AND a.date = $2 AND ($3::int IS NULL OR s.class_id = $3) GROUP BY c.name ORDER BY c.name`, [schoolId, d, classId]),
      pool.query(
        `SELECT s.name, c.name AS class_name FROM attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = s.class_id
          WHERE a.school_id = $1 AND a.date = $2 AND a.status = 'absent' AND ($3::int IS NULL OR s.class_id = $3) ORDER BY c.name, s.name`, [schoolId, d, classId]),
    ]);
    return { date: d, by_class: summary.rows, absent_students: clip(absent.rows), note: summary.rowCount ? undefined : 'No attendance has been marked for this date.' };
  },

  async staff_overview({ schoolId }) {
    const [staff, onLeave] = await Promise.all([
      pool.query(`SELECT id, name, role, phone, whatsapp_opt_in_status FROM teachers WHERE school_id = $1 AND COALESCE(is_demo, FALSE) = FALSE ORDER BY role, name`, [schoolId]),
      pool.query(
        `SELECT t.name, l.start_date::text, l.end_date::text FROM staff_leave_requests l JOIN teachers t ON t.id = l.teacher_id
          WHERE l.school_id = $1 AND l.status = 'APPROVED' AND CURRENT_DATE BETWEEN l.start_date AND l.end_date`, [schoolId]),
    ]);
    return { staff: clip(staff.rows), on_leave_today: onLeave.rows };
  },

  async payroll_summary({ schoolId }, { period }) {
    const { rows } = await pool.query(
      `SELECT period, status, working_days, totals, anomalies FROM payroll_runs WHERE school_id = $1 AND ($2::text IS NULL OR period = $2) ORDER BY period DESC LIMIT 1`,
      [schoolId, /^\d{4}-\d{2}$/.test(period || '') ? period : null]
    );
    return rows[0] || { note: 'No payroll run found.' };
  },

  async exam_results_summary({ schoolId }, { exam_name, class_name }) {
    const classId = await classFilter(schoolId, class_name);
    if (classId === -1) return { error: `No class named "${class_name}"` };
    const { rows } = await pool.query(
      `SELECT e.name AS exam, c.name AS class_name, sub.name AS subject, COUNT(*)::int AS students,
              ROUND(AVG(m.marks_obtained / NULLIF(m.max_marks, 0) * 100), 1) AS avg_percent
         FROM exam_marks m JOIN exams e ON e.id = m.exam_id JOIN classes c ON c.id = e.class_id JOIN subjects sub ON sub.id = m.subject_id
        WHERE m.school_id = $1 AND e.name ILIKE $2 AND ($3::int IS NULL OR e.class_id = $3)
        GROUP BY e.name, c.name, sub.name ORDER BY c.name, sub.name`,
      [schoolId, `%${exam_name}%`, classId]
    );
    return rows.length ? clip(rows) : { note: 'No marks found for that exam.' };
  },

  async admissions_pipeline({ schoolId }) {
    const [stages, recent] = await Promise.all([
      pool.query(`SELECT stage, COUNT(*)::int AS n FROM admission_enquiries WHERE school_id = $1 GROUP BY stage ORDER BY n DESC`, [schoolId]),
      pool.query(`SELECT id, child_name, parent_name, applying_class_text, stage, source, created_at::date::text AS date FROM admission_enquiries WHERE school_id = $1 ORDER BY created_at DESC LIMIT 10`, [schoolId]),
    ]);
    return { by_stage: stages.rows, recent: recent.rows };
  },

  async control_center_status({ schoolId }) {
    const [open, autos] = await Promise.all([
      pool.query(`SELECT severity, title, occurrences, source FROM ops_exceptions WHERE school_id = $1 AND status = 'open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, last_seen_at DESC LIMIT 25`, [schoolId]),
      pool.query(`SELECT automation_key, display_name, category, last_run_at, last_status, last_error FROM automation_registry ORDER BY category, display_name`),
    ]);
    return { open_items: open.rows, automations: autos.rows, available_actions: 'automation.run_now (params: automation_key)' };
  },

  async list_records({ schoolId }, { kind, filter }) {
    const like = `%${String(filter || '').trim()}%`;
    const q = {
      certificates: [`SELECT ic.id, ic.cert_type, ic.serial, s.name AS student, ic.issued_at::date::text AS issued, (ic.revoked_at IS NOT NULL) AS revoked FROM issued_certificates ic LEFT JOIN students s ON s.id = ic.student_id WHERE ic.school_id = $1 AND COALESCE(s.name,'') ILIKE $2 ORDER BY ic.issued_at DESC LIMIT 50`],
      document_requests: [`SELECT d.id, d.request_type, d.status, s.name AS student, d.requested_at::date::text AS requested FROM document_requests d LEFT JOIN students s ON s.id = d.student_id WHERE d.school_id = $1 AND COALESCE(s.name,'') ILIKE $2 ORDER BY d.requested_at DESC LIMIT 50`],
      student_leave: [`SELECT l.id, s.name AS student, l.from_date::text AS from_date, l.to_date::text AS to_date, l.status FROM student_leave_requests l JOIN students s ON s.id = l.student_id WHERE l.school_id = $1 AND s.name ILIKE $2 ORDER BY l.created_at DESC LIMIT 50`],
      staff_leave: [`SELECT l.id, t.name AS staff, l.start_date::text AS from_date, l.end_date::text AS to_date, l.status FROM staff_leave_requests l JOIN teachers t ON t.id = l.teacher_id WHERE l.school_id = $1 AND t.name ILIKE $2 ORDER BY l.created_at DESC LIMIT 50`],
      events: [`SELECT id, title, event_type, event_date::text AS date FROM school_events WHERE school_id = $1 AND title ILIKE $2 ORDER BY event_date DESC LIMIT 50`],
      homework: [`SELECT h.id, h.title, h.subject_id AS subject, c.name AS class_name, h.due_date::text AS due FROM homework h JOIN classes c ON c.id = h.class_id WHERE h.school_id = $1 AND h.title ILIKE $2 ORDER BY h.created_at DESC LIMIT 50`],
    }[kind];
    if (!q) return { error: 'Unknown record kind' };
    try {
      return clip((await pool.query(q[0], [schoolId, like])).rows);
    } catch (err) {
      // A column differing from what the query expects must degrade into a
      // readable answer, not a crashed conversation.
      console.error(`[assistant] list_records(${kind}) failed:`, err.message);
      return { error: `Could not read ${kind} records.` };
    }
  },

  async create_document({ schoolId, user, conversationId }, { title, body }) {
    const t = String(title || '').trim().slice(0, 200);
    const b = String(body || '').trim();
    if (!t || !b) return { error: 'A title and body are required' };
    const { rows } = await pool.query(
      `INSERT INTO assistant_documents (school_id, conversation_id, title, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, conversationId, t, b.slice(0, 20000), user.teacher_id]
    );
    return { saved: true, document_id: rows[0].id, note: 'The person will see a Download PDF button under your answer. Do not paste the whole document again; summarise it.' };
  },

  async remember({ schoolId, user }, { content, kind }) {
    const c = String(content || '').trim().slice(0, 500);
    if (!c) return { error: 'Nothing to remember' };
    const { rows } = await pool.query(
      `INSERT INTO assistant_memory (school_id, kind, content, source, status, created_by) VALUES ($1,$2,$3,'user','active',$4) RETURNING id`,
      [schoolId, ['fact', 'preference', 'policy', 'lesson'].includes(kind) ? kind : 'fact', c, user.teacher_id]
    );
    return { remembered: true, memory_id: rows[0].id };
  },

  async propose_action({ schoolId, conversationId }, { action_key, params, summary }) {
    if (!hasAction(action_key) || !PROPOSABLE.has(action_key)) {
      return { error: `"${action_key}" is not an action you can propose. Available: ${[...PROPOSABLE].filter(hasAction).join(', ') || 'none'}.` };
    }
    const { rows } = await pool.query(
      `INSERT INTO assistant_actions (school_id, conversation_id, action_key, params, summary) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, conversationId, action_key, JSON.stringify(params && typeof params === 'object' ? params : {}), String(summary || '').slice(0, 500)]
    );
    return { proposed: true, action_id: rows[0].id, note: 'Waiting for the person to click Approve. Tell them what will happen.' };
  },
};

// Actions the assistant may even propose (a person still has to approve each
// one). Deliberately narrow: nothing that messages parents or moves money.
export const PROPOSABLE = new Set(['automation.run_now', 'admission.pause_ai']);

// What a person may approve from the Ask AI panel or by replying APPROVE n on
// WhatsApp: everything the assistant can propose, plus actions the principal's
// daily plan proposes. Still staff-only and money-free.
export const APPROVABLE = new Set([...PROPOSABLE, 'attention.notify_teachers']);

export async function runTool(name, ctx, input) {
  const fn = handlers[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  try {
    return await fn(ctx, input || {});
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err.message);
    return { error: 'That lookup failed.' };
  }
}
