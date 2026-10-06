import pool from '../config/db.js';

// ------------------------------------------------------------------
// "Is this school set up for the staff automations to actually run?"
//
// Substitution cover, class reminders and daily guidance all stay silent
// (no error anywhere) when the thing they read from is empty. This gathers
// those prerequisites in one place so the dashboard checklist can show the
// principal exactly what is still missing.
// ------------------------------------------------------------------

// Pure: turns the raw counts into the checklist the dashboard shows.
export function readinessChecklist({ whatsappConnected, staffTotal, staffWithWhatsapp, teachersTotal, timetableSlots, teachersWithPeriods, chapters, chaptersTagged }) {
  return [
    {
      key: 'whatsapp',
      done: Boolean(whatsappConnected),
      detail: whatsappConnected ? 'Connected' : 'Not connected yet. The Waynur team connects the school\u2019s WhatsApp Business number.',
    },
    {
      key: 'staff_whatsapp',
      done: staffTotal > 0 && staffWithWhatsapp >= staffTotal,
      detail: `${staffWithWhatsapp} of ${staffTotal} staff have a WhatsApp number`,
    },
    {
      key: 'timetable',
      done: timetableSlots > 0 && teachersWithPeriods >= teachersTotal,
      detail: timetableSlots === 0
        ? 'No periods yet'
        : `${teachersWithPeriods} of ${teachersTotal} teachers have periods`,
    },
    {
      key: 'syllabus',
      done: chapters > 0 && chaptersTagged >= chapters,
      detail: chapters === 0
        ? 'No chapters planned yet'
        : `${chaptersTagged} of ${chapters} chapters are linked to a subject`,
    },
  ];
}

export async function getAutomationReadiness(schoolId) {
  const [settings, staff, timetable, syllabus] = await Promise.all([
    pool.query(`SELECT COALESCE(whatsapp_connected, FALSE) AS connected FROM school_settings WHERE school_id = $1`, [schoolId]),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE whatsapp_number IS NOT NULL AND whatsapp_opt_in_status = 'OPTED_IN')::int AS with_whatsapp,
              COUNT(*) FILTER (WHERE role = 'teacher')::int AS teachers
         FROM teachers WHERE school_id = $1`,
      [schoolId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS slots,
              COUNT(DISTINCT ts.teacher_id) FILTER (WHERE t.role = 'teacher')::int AS teachers_with_periods
         FROM timetable_slots ts LEFT JOIN teachers t ON t.id = ts.teacher_id
        WHERE ts.school_id = $1`,
      [schoolId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS chapters,
              COUNT(*) FILTER (WHERE subject_ref_id IS NOT NULL)::int AS tagged
         FROM syllabus_calendar WHERE school_id = $1 AND target_end_date >= CURRENT_DATE`,
      [schoolId]
    ),
  ]);

  const counts = {
    whatsappConnected: settings.rows[0]?.connected === true,
    staffTotal: staff.rows[0].total,
    staffWithWhatsapp: staff.rows[0].with_whatsapp,
    teachersTotal: staff.rows[0].teachers,
    timetableSlots: timetable.rows[0].slots,
    teachersWithPeriods: timetable.rows[0].teachers_with_periods,
    chapters: syllabus.rows[0].chapters,
    chaptersTagged: syllabus.rows[0].tagged,
  };
  return { counts, items: readinessChecklist(counts) };
}
