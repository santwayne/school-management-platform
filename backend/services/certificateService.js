import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import pool from '../config/db.js';
import { sendTemplateMessage } from './whatsappService.js';
import { raiseException, audit, autoResolve } from './opsService.js';

// ------------------------------------------------------------------
// Automatic certificates.
//   bonafide, character_certificate → issued automatically for an active,
//                                      class-assigned student
//   fee_certificate                  → issued automatically only if no fees due
//   leaving_certificate (TC)         → principal approves (one click); blocked
//                                      while fees are due
//   anything else (id_card, ...)     → left for staff (inbox item)
// ------------------------------------------------------------------

export const AUTO_TYPES = new Set(['bonafide', 'character_certificate', 'fee_certificate']);
const TITLES = {
  bonafide: 'Bonafide Certificate',
  character_certificate: 'Character Certificate',
  fee_certificate: 'Fee Certificate',
  leaving_certificate: 'Transfer Certificate',
};
const SERIAL_PREFIX = { bonafide: 'BC', character_certificate: 'CC', fee_certificate: 'FC', leaving_certificate: 'TC' };

// Decide what to do with one request. Pure: all facts passed in.
export function decide({ type, student, duesAmount }) {
  if (!TITLES[type]) return { action: 'manual', reason: `"${type}" requests are handled by staff.` };
  if (!student?.class_id) return { action: 'manual', reason: 'Student has no class assigned.' };
  if (type === 'fee_certificate' && duesAmount > 0) return { action: 'blocked', reason: `Fees of ₹${Math.round(duesAmount).toLocaleString('en-IN')} are due.` };
  if (type === 'leaving_certificate') {
    if (duesAmount > 0) return { action: 'approval', reason: `Fees of ₹${Math.round(duesAmount).toLocaleString('en-IN')} are due; clear them before issuing.`, blocked: true };
    return { action: 'approval', reason: 'Transfer certificates always need the principal.' };
  }
  return { action: 'issue' };
}

export function formatSerial(type, year, n) {
  return `${SERIAL_PREFIX[type] || 'CT'}/${year}/${String(n).padStart(4, '0')}`;
}

async function studentFacts(client, studentId, schoolId) {
  const r = await client.query(
    `SELECT s.id, s.name, s.class_id, c.name AS class_name, c.section, p.name AS parent_name, p.phone AS parent_phone, p.opt_in_status,
            sp.date_of_birth, sp.admission_date, sp.gender,
            GREATEST(COALESCE(pay.amount_due, 0) - COALESCE(pay.amount_paid, 0), 0)
              + COALESCE((SELECT SUM(monthly_fee) FROM student_transport_fees t WHERE t.student_id = s.id AND t.collection_status <> 'collected'), 0) AS dues
     FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN parents p ON p.id = s.parent_id
     LEFT JOIN student_profiles sp ON sp.student_id = s.id LEFT JOIN student_payment pay ON pay.student_id = s.id
     WHERE s.id = $1 AND s.school_id = $2`,
    [studentId, schoolId]
  );
  return r.rows[0] || null;
}

// Issue inside a transaction: gap-free serial (row lock on the counter),
// frozen snapshot, request marked READY with a download path.
export async function issueCertificate(schoolId, requestId, { issuedBy = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const req = await client.query(`SELECT * FROM document_requests WHERE id = $1 AND school_id = $2 FOR UPDATE`, [requestId, schoolId]);
    const request = req.rows[0];
    if (!request) throw Object.assign(new Error('Request not found'), { status: 404 });
    const existing = await client.query('SELECT id FROM issued_certificates WHERE request_id = $1', [requestId]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return { id: existing.rows[0].id, already: true };
    }
    const student = await studentFacts(client, request.student_id, schoolId);
    const school = await client.query(
      `SELECT s.name, s.address, ss.principal_name, ss.affiliation_number, ss.board_name FROM schools s LEFT JOIN school_settings ss ON ss.school_id = s.id WHERE s.id = $1`,
      [schoolId]
    );
    const year = Number((await client.query(`SELECT EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata')::int AS y`)).rows[0].y);
    const counter = await client.query(
      `INSERT INTO certificate_counters (school_id, cert_type, year, last_number) VALUES ($1, $2, $3, 1)
       ON CONFLICT (school_id, cert_type, year) DO UPDATE SET last_number = certificate_counters.last_number + 1
       RETURNING last_number`,
      [schoolId, request.request_type, year]
    );
    const serial = formatSerial(request.request_type, year, counter.rows[0].last_number);
    const verifyCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const data = {
      title: TITLES[request.request_type],
      school: school.rows[0],
      student: {
        name: student.name,
        class: `${student.class_name}${student.section ? ` ${student.section}` : ''}`,
        parent_name: student.parent_name,
        date_of_birth: student.date_of_birth,
        admission_date: student.admission_date,
        gender: student.gender,
      },
      dues_at_issue: Number(student.dues),
      issued_on: new Date().toISOString().slice(0, 10),
    };
    const ins = await client.query(
      `INSERT INTO issued_certificates (school_id, student_id, request_id, cert_type, serial, verify_code, data, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [schoolId, request.student_id, requestId, request.request_type, serial, verifyCode, JSON.stringify(data), issuedBy]
    );
    const certId = ins.rows[0].id;
    await client.query(
      `UPDATE document_requests SET status = 'READY', document_url = $2, reviewed_by = COALESCE($3, reviewed_by), reviewed_at = NOW(),
              review_note = COALESCE(review_note, $4) WHERE id = $1`,
      [requestId, `/api/certificates/${certId}/pdf`, issuedBy, issuedBy ? 'Approved' : 'Issued automatically']
    );
    await client.query('COMMIT');

    await audit({ schoolId, actorType: issuedBy ? 'user' : 'system', actorId: issuedBy, action: 'certificate.issued', entityType: 'student', entityId: request.student_id, detail: { serial, type: request.request_type } });
    // Template (Utility, en): certificate_ready {{1}} child name, {{2}} certificate, {{3}} serial
    // "The {{2}} for {{1}} (No. {{3}}) is ready. Please collect it from the school office or download it from the student portal."
    if (student.opt_in_status === 'OPTED_IN' && student.parent_phone) {
      try {
        await sendTemplateMessage(String(student.parent_phone).replace(/^\+/, ''), process.env.WHATSAPP_CERTIFICATE_TEMPLATE || 'certificate_ready', 'en', [student.name, data.title, serial]);
      } catch (err) {
        console.error(`[certificates] WhatsApp for request ${requestId} failed:`, err.response?.data?.error?.message || err.message);
      }
    }
    return { id: certId, serial, verify_code: verifyCode };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function processPendingRequests(schoolId = null) {
  const pending = await pool.query(
    `SELECT id, school_id, student_id, request_type FROM document_requests
     WHERE status = 'PENDING' AND ($1::int IS NULL OR school_id = $1) ORDER BY id LIMIT 200`,
    [schoolId]
  );
  let issued = 0;
  for (const r of pending.rows) {
    const student = await studentFacts(pool, r.student_id, r.school_id);
    const d = decide({ type: r.request_type, student, duesAmount: Number(student?.dues || 0) });
    const who = student?.name || `student #${r.student_id}`;
    if (d.action === 'issue') {
      try {
        await issueCertificate(r.school_id, r.id);
        await autoResolve(`cert_request:${r.id}`, { schoolId: r.school_id, note: 'Issued automatically' });
        issued++;
      } catch (err) {
        console.error(`[certificates] issue failed for request ${r.id}:`, err.message);
      }
    } else if (d.action === 'approval') {
      await raiseException({
        schoolId: r.school_id,
        source: 'certificate',
        severity: d.blocked ? 'high' : 'medium',
        title: `${TITLES[r.request_type]} requested for ${who}${d.blocked ? ': fees due' : ''}`,
        body: `${d.reason}${student?.class_name ? `\nClass: ${student.class_name}${student.section ? ` ${student.section}` : ''}` : ''}`,
        entityType: 'document_request',
        entityId: r.id,
        suggestedAction: d.blocked ? null : { label: 'Approve and issue', action: 'certificate.approve', params: { request_id: r.id } },
        dedupeKey: `cert_request:${r.id}`,
      });
    } else if (d.action === 'blocked') {
      // Stays PENDING: issued automatically on the first run after dues clear.
      await raiseException({
        schoolId: r.school_id,
        source: 'certificate',
        severity: 'low',
        title: `${TITLES[r.request_type]} for ${who} is waiting: fees due`,
        body: `${d.reason} It will be issued automatically as soon as the fees are cleared.`,
        entityType: 'document_request',
        entityId: r.id,
        dedupeKey: `cert_request:${r.id}`,
      });
    } else {
      await raiseException({
        schoolId: r.school_id,
        source: 'certificate',
        severity: 'low',
        title: `${r.request_type.replace(/_/g, ' ')} request for ${who} needs staff`,
        body: d.reason,
        entityType: 'document_request',
        entityId: r.id,
        dedupeKey: `cert_request:${r.id}`,
      });
    }
  }
  return { processed: issued };
}

export async function approveCertificate(schoolId, requestId, user) {
  if (user?.role !== 'principal') throw Object.assign(new Error('Only the principal can approve this certificate'), { status: 403 });
  const req = await pool.query(`SELECT student_id, request_type FROM document_requests WHERE id = $1 AND school_id = $2`, [requestId, schoolId]);
  if (!req.rowCount) throw Object.assign(new Error('Request not found'), { status: 404 });
  const student = await studentFacts(pool, req.rows[0].student_id, schoolId);
  const d = decide({ type: req.rows[0].request_type, student, duesAmount: Number(student?.dues || 0) });
  if (d.blocked) throw Object.assign(new Error(d.reason), { status: 409 });
  const out = await issueCertificate(schoolId, requestId, { issuedBy: user.teacher_id });
  await autoResolve(`cert_request:${requestId}`, { schoolId, note: `Issued ${out.serial || ''}`.trim() });
  return out;
}

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export async function certificatePdf(certId, schoolId) {
  const r = await pool.query(`SELECT * FROM issued_certificates WHERE id = $1 AND school_id = $2`, [certId, schoolId]);
  const c = r.rows[0];
  if (!c) return null;
  const { data } = c;
  const s = data.student;
  const he = s.gender === 'female' ? 'she' : s.gender === 'male' ? 'he' : 'they';
  const His = s.gender === 'female' ? 'Her' : s.gender === 'male' ? 'His' : 'Their';
  const child = `${s.gender === 'female' ? 'daughter' : s.gender === 'male' ? 'son' : 'ward'} of ${s.parent_name || '—'}`;
  const body = {
    bonafide: `This is to certify that ${s.name}, ${child}, is a bonafide student of this school, studying in ${s.class} during the current academic session.${s.date_of_birth ? ` ${His} date of birth as per school records is ${fmt(s.date_of_birth)}.` : ''}`,
    character_certificate: `This is to certify that ${s.name}, ${child}, is a student of ${s.class} in this school. To the best of our knowledge, ${he} bear${he === 'they' ? '' : 's'} a good moral character.`,
    fee_certificate: `This is to certify that ${s.name}, ${child}, a student of ${s.class}, has no outstanding fees with the school as on ${fmt(data.issued_on)}.`,
    leaving_certificate: `This is to certify that ${s.name}, ${child}, was a student of this school${s.admission_date ? ` from ${fmt(s.admission_date)}` : ''}, last studying in ${s.class}.${s.date_of_birth ? ` Date of birth as per school records: ${fmt(s.date_of_birth)}.` : ''} All dues have been cleared. We wish ${he === 'they' ? 'them' : he === 'she' ? 'her' : 'him'} success in the future.`,
  }[c.cert_type];

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const chunks = [];
  doc.on('data', (b) => chunks.push(b));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(1.5).stroke('#333');
  doc.font('Helvetica-Bold').fontSize(20).text(data.school?.name || '', { align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#444');
  if (data.school?.address) doc.text(data.school.address, { align: 'center' });
  if (data.school?.affiliation_number) doc.text(`${data.school.board_name ? `${data.school.board_name} ` : ''}Affiliation No. ${data.school.affiliation_number}`, { align: 'center' });
  doc.moveDown(2).fillColor('#000').font('Helvetica-Bold').fontSize(16).text(data.title.toUpperCase(), { align: 'center', underline: true });
  doc.moveDown().font('Helvetica').fontSize(10).text(`No. ${c.serial}`, { continued: true }).text(`Date: ${fmt(data.issued_on)}`, { align: 'right' });
  doc.moveDown(2).fontSize(12).text(body, { align: 'justify', lineGap: 6 });
  doc.moveDown(5).text(data.school?.principal_name || '', { align: 'right' }).text('Principal', { align: 'right' });
  doc.fontSize(8).fillColor('#666').text(`Verify this certificate with code ${c.verify_code} on the school's verification page.`, 60, doc.page.height - 90, { align: 'center', width: doc.page.width - 120 });
  if (c.revoked_at) doc.fontSize(40).fillColor('#c00').opacity(0.3).text('REVOKED', 150, 350, { rotate: -30 });
  doc.end();
  return { buffer: await done, filename: `${c.serial.replace(/\//g, '-')}.pdf`, studentId: c.student_id };
}
