import PDFDocument from 'pdfkit';
import pool from '../config/db.js';
import { sendTemplateMessage } from './whatsappService.js';
import { raiseException, audit, autoResolve } from './opsService.js';

// ------------------------------------------------------------------
// Monthly payroll. The system prepares, a human approves, nothing is
// paid automatically. All money maths lives in computePay (pure, tested).
// ------------------------------------------------------------------

const r2 = (n) => Math.round(Number(n) || 0); // payroll is in whole rupees

// Mon–Sat working days in a month, minus school holidays.
export function countWorkingDays(period, holidayIsoDates = []) {
  const [y, m] = period.split('-').map(Number);
  const holidays = new Set(holidayIsoDates);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= days; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    const iso = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && !holidays.has(iso)) n++;
  }
  return n;
}

export function computePay({ base, workingDays, lopDays = 0, components = [] }) {
  const baseAmt = Number(base) || 0;
  const earnings = [];
  const deductions = [];
  for (const c of components) {
    const amount = r2(c.calc === 'percent_of_base' ? (baseAmt * Number(c.value)) / 100 : Number(c.value));
    if (!amount) continue;
    (c.kind === 'earning' ? earnings : deductions).push({ name: c.name, amount });
  }
  const lopAmount = workingDays > 0 && lopDays > 0 ? r2((baseAmt / workingDays) * Math.min(lopDays, workingDays)) : 0;
  if (lopAmount) deductions.push({ name: `Loss of pay (${lopDays} day${lopDays === 1 ? '' : 's'})`, amount: lopAmount });
  const gross = r2(baseAmt + earnings.reduce((a, e) => a + e.amount, 0));
  const totalDeductions = r2(deductions.reduce((a, d) => a + d.amount, 0));
  const net = gross - totalDeductions;
  return { base: r2(baseAmt), earnings, deductions, gross, deductions_total: totalDeductions, net: Math.max(0, net), negative: net < 0, working_days: workingDays, lop_days: lopDays };
}

export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const inr = (n) => `₹${r2(n).toLocaleString('en-IN')}`;

export async function preparePayroll(schoolId, period) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw Object.assign(new Error("period must be 'YYYY-MM'"), { status: 400 });
  const existing = await pool.query('SELECT id, status FROM payroll_runs WHERE school_id = $1 AND period = $2', [schoolId, period]);
  if (existing.rows[0]?.status === 'approved') throw Object.assign(new Error(`Payroll for ${periodLabel(period)} is already approved`), { status: 409 });

  const start = `${period}-01`;
  const holidays = await pool.query(
    `SELECT DISTINCT d::date::text AS d FROM school_events e,
       generate_series(e.event_date, COALESCE(e.end_date, e.event_date), INTERVAL '1 day') d
     WHERE e.school_id = $1 AND e.event_type = 'holiday'
       AND d >= $2::date AND d < ($2::date + INTERVAL '1 month')`,
    [schoolId, start]
  );
  const holidaySet = holidays.rows.map((h) => h.d);
  const workingDays = countWorkingDays(period, holidaySet);

  const staff = await pool.query(
    `SELECT t.id, t.name, t.role, t.bank_account_number, t.bank_ifsc, s.monthly_amount
     FROM teachers t LEFT JOIN teacher_salary s ON s.teacher_id = t.id
     WHERE t.school_id = $1 AND t.role IN ('teacher', 'accountant', 'librarian', 'operator', 'principal') AND COALESCE(t.is_demo, FALSE) = FALSE
     ORDER BY t.name`,
    [schoolId]
  );
  const comps = await pool.query(`SELECT teacher_id, name, kind, calc, value FROM salary_components WHERE school_id = $1 AND active`, [schoolId]);
  const tracked = await pool.query(
    `SELECT COUNT(*)::int AS n FROM teacher_attendance_daily WHERE school_id = $1 AND date >= $2::date AND date < ($2::date + INTERVAL '1 month')`,
    [schoolId, start]
  );
  const attendanceTracked = tracked.rows[0].n > 0;
  // Absent (or half-day) on a working day, not covered by approved leave.
  const lop = await pool.query(
    `SELECT a.teacher_id, SUM(CASE WHEN a.status = 'half_day' THEN 0.5 ELSE 1 END) AS days
     FROM teacher_attendance_daily a
     WHERE a.school_id = $1 AND a.date >= $2::date AND a.date < ($2::date + INTERVAL '1 month')
       AND a.status IN ('absent', 'half_day') AND EXTRACT(ISODOW FROM a.date) <> 7
       AND NOT (a.date::text = ANY($3::text[]))
       AND NOT EXISTS (SELECT 1 FROM staff_leave_requests l WHERE l.teacher_id = a.teacher_id AND l.status = 'APPROVED' AND a.date BETWEEN l.start_date AND l.end_date)
     GROUP BY a.teacher_id`,
    [schoolId, start, holidaySet]
  );
  const lopMap = new Map(lop.rows.map((l) => [l.teacher_id, Number(l.days)]));
  const prev = await pool.query(
    `SELECT p.teacher_id, p.net_pay FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
     WHERE r.school_id = $1 AND r.period < $2 AND r.status = 'approved'
       AND r.period = (SELECT MAX(period) FROM payroll_runs WHERE school_id = $1 AND period < $2 AND status = 'approved')`,
    [schoolId, period]
  );
  const prevMap = new Map(prev.rows.map((p) => [p.teacher_id, Number(p.net_pay)]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let runId = existing.rows[0]?.id;
    if (runId) await client.query('DELETE FROM payslips WHERE payroll_run_id = $1', [runId]);
    else {
      const r = await client.query(`INSERT INTO payroll_runs (school_id, period, working_days) VALUES ($1, $2, $3) RETURNING id`, [schoolId, period, workingDays]);
      runId = r.rows[0].id;
    }
    const anomalies = [];
    if (!attendanceTracked) anomalies.push({ type: 'no_attendance', text: 'No staff attendance recorded this month, so no loss of pay was applied.' });
    let totalNet = 0;
    let count = 0;
    for (const s of staff.rows) {
      if (s.monthly_amount == null) {
        anomalies.push({ type: 'no_salary', teacher_id: s.id, text: `${s.name}: no salary set, not included.` });
        continue;
      }
      const components = comps.rows.filter((c) => c.teacher_id == null || c.teacher_id === s.id);
      const lopDays = attendanceTracked ? lopMap.get(s.id) || 0 : 0;
      const pay = computePay({ base: s.monthly_amount, workingDays, lopDays, components });
      if (pay.negative) anomalies.push({ type: 'negative', teacher_id: s.id, text: `${s.name}: deductions exceed pay; net set to ₹0.` });
      if (lopDays >= 5) anomalies.push({ type: 'high_lop', teacher_id: s.id, text: `${s.name}: ${lopDays} days loss of pay.` });
      const before = prevMap.get(s.id);
      if (before && Math.abs(pay.net - before) / before > 0.1) anomalies.push({ type: 'changed', teacher_id: s.id, text: `${s.name}: ${inr(before)} last month, ${inr(pay.net)} now.` });
      if (!s.bank_account_number || !s.bank_ifsc) anomalies.push({ type: 'no_bank', teacher_id: s.id, text: `${s.name}: bank details missing (needed for the bank transfer file).` });
      await client.query(
        `INSERT INTO payslips (school_id, payroll_run_id, teacher_id, breakdown, gross, deductions, net_pay) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [schoolId, runId, s.id, JSON.stringify(pay), pay.gross, pay.deductions_total, pay.net]
      );
      totalNet += pay.net;
      count++;
    }
    const totals = { staff: count, net: totalNet };
    await client.query(`UPDATE payroll_runs SET working_days = $2, totals = $3, anomalies = $4 WHERE id = $1`, [runId, workingDays, JSON.stringify(totals), JSON.stringify(anomalies)]);
    await client.query('COMMIT');

    const important = anomalies.filter((a) => a.type !== 'no_bank');
    await raiseException({
      schoolId,
      source: 'payslip',
      severity: important.length ? 'high' : 'medium',
      title: `Approve payroll for ${periodLabel(period)}: ${count} staff, ${inr(totalNet)}`,
      body: `${workingDays} working days.${anomalies.length ? `\n\nCheck before approving:\n${anomalies.map((a) => `• ${a.text}`).join('\n')}` : '\n\nNothing unusual found.'}\n\nApproving sends every staff member their payslip and adds the amounts to Payroll for marking as paid. No money moves automatically.`,
      entityType: 'payroll_run',
      entityId: runId,
      suggestedAction: { label: 'Approve payroll', action: 'payroll.approve', params: { run_id: runId } },
      dedupeKey: `payroll:${period}`,
    });
    return { run_id: runId, period, working_days: workingDays, totals, anomalies };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function approvePayroll(schoolId, runId, user) {
  if (user?.role !== 'principal') throw Object.assign(new Error('Only the principal can approve payroll'), { status: 403 });
  const r = await pool.query(
    `UPDATE payroll_runs SET status = 'approved', approved_by = $3, approved_at = NOW() WHERE id = $1 AND school_id = $2 AND status = 'draft' RETURNING *`,
    [runId, schoolId, user.teacher_id]
  );
  if (!r.rowCount) throw Object.assign(new Error('Payroll not found or already approved'), { status: 409 });
  const run = r.rows[0];
  const slips = await pool.query(
    `SELECT p.id, p.teacher_id, p.net_pay, t.name, t.whatsapp_number, t.whatsapp_opt_in_status FROM payslips p JOIN teachers t ON t.id = p.teacher_id WHERE p.payroll_run_id = $1`,
    [runId]
  );
  let alreadyPaid = 0;
  for (const s of slips.rows) {
    // Feed the existing Payroll screen's mark-paid flow.
    const h = await pool.query(`SELECT id, status FROM teacher_salary_history WHERE teacher_id = $1 AND period = $2`, [s.teacher_id, run.period]);
    if (!h.rowCount) {
      await pool.query(`INSERT INTO teacher_salary_history (school_id, teacher_id, period, amount_paid, status) VALUES ($1,$2,$3,$4,'PENDING')`, [schoolId, s.teacher_id, run.period, s.net_pay]);
    } else if (h.rows[0].status === 'PENDING') {
      await pool.query(`UPDATE teacher_salary_history SET amount_paid = $2 WHERE id = $1`, [h.rows[0].id, s.net_pay]);
    } else {
      alreadyPaid++;
    }
    await pool.query(
      `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body, payload_sent)
       VALUES ($1, 'payslip_ready', 'staff', $2, 'dashboard', $3, $4, $5)`,
      [schoolId, s.teacher_id, `Payslip for ${periodLabel(run.period)}`, `Net pay ${inr(s.net_pay)}. Download it from your profile.`, JSON.stringify({ payslip_id: s.id })]
    );
    // Template (Utility, en): payslip_ready {{1}} name, {{2}} month, {{3}} net
    // "Hi {{1}}, your payslip for {{2}} is ready. Net pay: {{3}}. You can download it in the Waynur app."
    if (s.whatsapp_opt_in_status === 'OPTED_IN' && s.whatsapp_number) {
      try {
        await sendTemplateMessage(String(s.whatsapp_number).replace(/^\+/, ''), process.env.WHATSAPP_PAYSLIP_TEMPLATE || 'payslip_ready', 'en', [s.name, periodLabel(run.period), inr(s.net_pay)]);
      } catch (err) {
        console.error(`[payroll] payslip WhatsApp to ${s.teacher_id} failed:`, err.response?.data?.error?.message || err.message);
      }
    }
    await pool.query('UPDATE payslips SET notified_at = NOW() WHERE id = $1', [s.id]);
  }
  await autoResolve(`payroll:${run.period}`, { schoolId, note: 'Approved' });
  await audit({ schoolId, actorType: 'user', actorId: user.teacher_id, action: 'payroll.approved', entityType: 'payroll_run', entityId: runId, detail: { period: run.period, totals: run.totals, already_paid: alreadyPaid } });
  return { approved: true, payslips: slips.rowCount, already_marked_paid: alreadyPaid };
}

export async function payslipPdf(payslipId, schoolId) {
  const r = await pool.query(
    `SELECT p.*, r.period, r.working_days, t.name AS teacher_name, t.role, t.email, s.name AS school_name
     FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id JOIN teachers t ON t.id = p.teacher_id JOIN schools s ON s.id = p.school_id
     WHERE p.id = $1 AND p.school_id = $2`,
    [payslipId, schoolId]
  );
  const p = r.rows[0];
  if (!p) return null;
  const b = p.breakdown;
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  // pdfkit's built-in fonts have no ₹ glyph, so amounts use "Rs."
  const money = (n) => `Rs. ${r2(n).toLocaleString('en-IN')}`;
  doc.fontSize(18).text(p.school_name);
  doc.fontSize(12).fillColor('#555').text(`Payslip for ${periodLabel(p.period)}`).moveDown();
  doc.fillColor('#000').fontSize(11).text(`Name: ${p.teacher_name}`).text(`Role: ${p.role}`).text(`Working days: ${b.working_days}    Loss-of-pay days: ${b.lop_days}`).moveDown();
  const row = (label, amount, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 50, y).text(money(amount), 400, y, { width: 145, align: 'right' });
    doc.moveDown(0.3);
  };
  doc.font('Helvetica-Bold').text('Earnings').font('Helvetica').moveDown(0.3);
  row('Basic salary', b.base);
  for (const e of b.earnings) row(e.name, e.amount);
  row('Gross', b.gross, true);
  doc.moveDown().font('Helvetica-Bold').text('Deductions', 50).font('Helvetica').moveDown(0.3);
  if (!b.deductions.length) doc.text('None', 50).moveDown(0.3);
  for (const d of b.deductions) row(d.name, d.amount);
  row('Total deductions', b.deductions_total, true);
  doc.moveDown();
  row('Net pay', b.net, true);
  doc.moveDown(2).fontSize(8).fillColor('#777').text('This is a computer-generated payslip.', 50);
  doc.end();
  return { buffer: await done, filename: `payslip-${p.period}-${p.teacher_name.replace(/\W+/g, '_')}.pdf`, teacherId: p.teacher_id };
}

export async function runMonthlyPayrollPreparation() {
  const period = (await pool.query(`SELECT to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS p`)).rows[0].p;
  const schools = await pool.query(`SELECT id FROM schools WHERE status = 'active'`);
  let ok = 0;
  let failed = 0;
  for (const s of schools.rows) {
    const hasSalaries = await pool.query('SELECT 1 FROM teacher_salary WHERE school_id = $1 LIMIT 1', [s.id]);
    if (!hasSalaries.rowCount) continue;
    try {
      await preparePayroll(s.id, period);
      ok++;
    } catch (err) {
      if (err.status === 409) continue; // already approved
      failed++;
      console.error(`[payroll] prepare failed for school ${s.id}:`, err.message);
    }
  }
  return { processed: ok, failed };
}
