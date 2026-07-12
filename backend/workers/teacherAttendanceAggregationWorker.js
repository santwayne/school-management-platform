import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import pool from '../config/db.js';

const worker = new Worker(
  'TeacherAttendanceQueue',
  async (job) => {
    console.log(`Processing teacher attendance aggregation job: ${job.id}`);
    const today = new Date().toISOString().split('T')[0];

    // One row per teacher who actually punched today — first/last punch time.
    const punches = await pool.query(
      `SELECT school_id, teacher_id, MIN(punch_time) AS first_punch, MAX(punch_time) AS last_punch
       FROM teacher_punch_events
       WHERE punch_time::date = $1
       GROUP BY school_id, teacher_id`,
      [today]
    );

    for (const row of punches.rows) {
      await pool.query(
        `INSERT INTO teacher_attendance_daily (school_id, teacher_id, date, first_punch, last_punch, status)
         VALUES ($1, $2, $3, $4, $5, 'present')
         ON CONFLICT (teacher_id, date)
         DO UPDATE SET first_punch = EXCLUDED.first_punch, last_punch = EXCLUDED.last_punch
         WHERE teacher_attendance_daily.status != 'manual_override'`,
        [row.school_id, row.teacher_id, today, row.first_punch, row.last_punch]
      );
    }

    // Anyone with zero punches today (and no manual correction already) is absent.
    await pool.query(
      `INSERT INTO teacher_attendance_daily (school_id, teacher_id, date, status)
       SELECT t.school_id, t.id, $1, 'absent'
       FROM teachers t
       WHERE t.role != 'principal'
         AND NOT EXISTS (
           SELECT 1 FROM teacher_attendance_daily ad WHERE ad.teacher_id = t.id AND ad.date = $1
         )`,
      [today]
    );

    console.log(`Teacher attendance aggregated for ${today}: ${punches.rows.length} teachers punched.`);
  },
  { connection }
);

export default worker;
