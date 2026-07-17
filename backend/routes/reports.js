import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';

const router = express.Router();

// Attendance report — per-student attendance % over a date range.
// Available to Principal only (finance roles don't need student attendance).
router.get('/attendance', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { from, to, class_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

  try {
    const params = [school_id, from, to];
    let classFilter = '';
    if (class_id) {
      params.push(class_id);
      classFilter = `AND s.class_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT s.id AS student_id, s.name AS student_name, c.name AS class_name,
              COUNT(*) FILTER (WHERE a.status = 'present') AS days_present,
              COUNT(*) FILTER (WHERE a.status = 'absent') AS days_absent,
              COUNT(*) FILTER (WHERE a.status = 'late') AS days_late,
              COUNT(*) AS days_recorded
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN $2 AND $3
       WHERE s.school_id = $1 ${classFilter}
       GROUP BY s.id, s.name, c.name
       ORDER BY c.name, s.name`,
      params
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by, date_from, date_to)
       VALUES ($1, 'attendance', $2, $3, $4)`,
      [school_id, req.user.teacher_id || null, from, to]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'Failed to generate attendance report' });
  }
});

// Fee collection summary — cash vs online, by date range.
router.get('/fees', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

  try {
    const result = await pool.query(
      `SELECT h.id, s.name AS student_name, h.amount_paid, h.payment_mode, h.remarks,
              h.created_at
       FROM student_payment_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.school_id = $1 AND h.created_at::date BETWEEN $2 AND $3
       ORDER BY h.created_at DESC`,
      [school_id, from, to]
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.total += parseFloat(row.amount_paid);
        if (row.payment_mode === 'cash') acc.cash += parseFloat(row.amount_paid);
        else acc.online += parseFloat(row.amount_paid);
        return acc;
      },
      { total: 0, cash: 0, online: 0 }
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by, date_from, date_to)
       VALUES ($1, 'fees', $2, $3, $4)`,
      [school_id, req.user.teacher_id || null, from, to]
    );

    res.json({ rows: result.rows, totals });
  } catch (err) {
    console.error('Fees report error:', err);
    res.status(500).json({ error: 'Failed to generate fees report' });
  }
});

// Payroll register — one row per teacher for the given month.
router.get('/payroll', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { month } = req.query; // format: YYYY-MM
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });

  try {
    const result = await pool.query(
      `SELECT t.name AS teacher_name, h.amount_paid, h.status, h.paid_on
       FROM teacher_salary_history h
       JOIN teachers t ON t.id = h.teacher_id
       WHERE h.school_id = $1 AND h.period = $2
       ORDER BY t.name`,
      [school_id, month]
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by)
       VALUES ($1, 'payroll', $2)`,
      [school_id, req.user.teacher_id || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Payroll report error:', err);
    res.status(500).json({ error: 'Failed to generate payroll report' });
  }
});

// Daily attendance % trend, last 30 days — powers the Admin Home chart.
router.get('/attendance-trend', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT a.date,
              ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present') / NULLIF(COUNT(*), 0), 1) AS pct
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       WHERE s.school_id = $1 AND a.date > CURRENT_DATE - INTERVAL '30 days'
       GROUP BY a.date ORDER BY a.date`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Attendance trend error:', err);
    res.status(500).json({ error: 'Failed to load attendance trend' });
  }
});

// Daily fee collection total, last 30 days — powers the Admin Home chart.
router.get('/fees-trend', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT h.created_at::date AS date, SUM(h.amount_paid) AS total
       FROM student_payment_history h
       WHERE h.school_id = $1 AND h.created_at > CURRENT_DATE - INTERVAL '30 days'
       GROUP BY h.created_at::date ORDER BY date`,
      [school_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fees trend error:', err);
    res.status(500).json({ error: 'Failed to load fees trend' });
  }
});

// Single aggregate call for the Admin Home dashboard — stats strip + a real
// activity feed assembled from actual events (payments, broadcasts,
// homework posted). Deliberately does NOT include things with no real
// backend yet (staff leave requests, granular per-teacher activity) —
// see the PR notes for why those were left out rather than faked.
router.get('/overview', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const todayAttendance = await pool.query(
      `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present') / NULLIF(COUNT(*), 0), 1) AS pct
       FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE s.school_id = $1 AND a.date = CURRENT_DATE`,
      [school_id]
    );
    const monthFees = await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM student_payment_history
       WHERE school_id = $1 AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`,
      [school_id]
    );
    const broadcastsThisWeek = await pool.query(
      `SELECT COALESCE(SUM(recipient_count), 0) AS total FROM broadcasts
       WHERE school_id = $1 AND sent_at > CURRENT_DATE - INTERVAL '7 days'`,
      [school_id]
    );
    const activeBuses = await pool.query('SELECT COUNT(*) FROM buses WHERE school_id = $1', [school_id]);
    const doubtsThisWeek = await pool.query(
      `SELECT COUNT(*) FROM student_doubts WHERE school_id = $1 AND created_at > CURRENT_DATE - INTERVAL '7 days'`,
      [school_id]
    );

    const recentPayments = await pool.query(
      `SELECT 'payment' AS type, s.name AS who, h.amount_paid AS amount, h.created_at AS when
       FROM student_payment_history h JOIN students s ON s.id = h.student_id
       WHERE h.school_id = $1 ORDER BY h.created_at DESC LIMIT 5`,
      [school_id]
    );
    const recentBroadcasts = await pool.query(
      `SELECT 'broadcast' AS type, audience_label AS who, recipient_count AS amount, sent_at AS when
       FROM broadcasts WHERE school_id = $1 ORDER BY sent_at DESC LIMIT 5`,
      [school_id]
    );
    const activity = [...recentPayments.rows, ...recentBroadcasts.rows]
      .sort((a, b) => new Date(b.when) - new Date(a.when))
      .slice(0, 8);

    res.json({
      attendance_today_pct: todayAttendance.rows[0].pct,
      fees_this_month: monthFees.rows[0].total,
      broadcasts_this_week: parseInt(broadcastsThisWeek.rows[0].total, 10),
      active_buses: parseInt(activeBuses.rows[0].count, 10),
      doubts_this_week: parseInt(doubtsThisWeek.rows[0].count, 10),
      activity,
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

export default router;
