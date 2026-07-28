import pool from '../config/db.js';

// ------------------------------------------------------------------
// Shared master-data service for student/teacher profiles.
//
// Every other module (Attendance, Billing, Transport, Activities,
// Reports, ID cards, etc.) should call getStudentProfile / getTeacherProfile
// for display data (name, photo, class, blood group) instead of storing or
// re-querying its own copy. This is the whole point of Phase 6 — see
// schema.sql's "Student & Teacher Profiles" section.
//
// Sensitive-field gating (blood group, medical_notes, emergency contact,
// parent phone/email) happens here via `viewerRole`/`viewerTeacherId`, so
// callers don't each have to re-implement the access rule.
// ------------------------------------------------------------------

const SENSITIVE_STUDENT_FIELDS = ['blood_group', 'medical_notes', 'emergency_contact_phone', 'address'];
const SENSITIVE_PARENT_FIELDS = ['phone', 'email'];

/**
 * Returns true if the viewer may see a given student's sensitive fields.
 * Allowed: super_admin, principal, that student's class teacher, or the
 * student/parent viewing their own record.
 */
async function canViewSensitiveStudentData(schoolId, studentId, viewer) {
  if (!viewer) return false;
  if (viewer.role === 'super_admin' || viewer.role === 'principal') return true;
  if (viewer.role === 'student' && String(viewer.student_id) === String(studentId)) return true;

  if (viewer.role === 'teacher') {
    const { rows } = await pool.query(
      `SELECT 1
         FROM students s
         JOIN classes c ON c.id = s.class_id
        WHERE s.id = $1 AND s.school_id = $2 AND c.class_teacher_id = $3
        LIMIT 1`,
      [studentId, schoolId, viewer.teacher_id]
    );
    return rows.length > 0;
  }
  return false;
}

function stripSensitive(row, fields) {
  if (!row) return row;
  const clone = { ...row };
  for (const f of fields) delete clone[f];
  return clone;
}

/**
 * Fetch a student's full profile (basic info + parents), gated by viewer role.
 * `viewer` is req.user from requireAuth: { role, teacher_id/student_id, school_id }.
 */
export async function getStudentProfile(schoolId, studentId, viewer) {
  const studentRes = await pool.query(
    `SELECT st.id AS student_id, st.name, st.grade, st.class_id, c.name AS class_name,
            sp.id AS profile_id, sp.photo_url, sp.date_of_birth, sp.gender, sp.blood_group,
            sp.address, sp.emergency_contact_phone, sp.medical_notes, sp.admission_date
       FROM students st
       LEFT JOIN classes c ON c.id = st.class_id
       LEFT JOIN student_profiles sp ON sp.student_id = st.id
      WHERE st.id = $1 AND st.school_id = $2`,
    [studentId, schoolId]
  );
  if (studentRes.rowCount === 0) return null;
  let profile = studentRes.rows[0];

  const parentsRes = await pool.query(
    `SELECT id, relation, name, photo_url, phone, email, occupation, is_primary_contact
       FROM parent_profiles
      WHERE student_id = $1 AND school_id = $2
      ORDER BY is_primary_contact DESC, relation ASC`,
    [studentId, schoolId]
  );
  let parents = parentsRes.rows;

  const allowed = await canViewSensitiveStudentData(schoolId, studentId, viewer);
  if (!allowed) {
    profile = stripSensitive(profile, SENSITIVE_STUDENT_FIELDS);
    parents = parents.map((p) => stripSensitive(p, SENSITIVE_PARENT_FIELDS));
  }

  return { ...profile, parents };
}

/**
 * Lightweight lookup used by other modules that just need name/photo/class —
 * avoids paying the full-profile-with-parents query cost when only a
 * display chip is needed (e.g. Activities recipient picker).
 */
export async function getStudentDisplayInfo(schoolId, studentId) {
  const { rows } = await pool.query(
    `SELECT st.id AS student_id, st.name, st.class_id, c.name AS class_name, sp.photo_url
       FROM students st
       LEFT JOIN classes c ON c.id = st.class_id
       LEFT JOIN student_profiles sp ON sp.student_id = st.id
      WHERE st.id = $1 AND st.school_id = $2`,
    [studentId, schoolId]
  );
  return rows[0] || null;
}

export async function upsertStudentProfile(schoolId, studentId, fields) {
  const {
    photo_url, date_of_birth, gender, blood_group, address,
    emergency_contact_phone, medical_notes, admission_date,
  } = fields;

  const { rows } = await pool.query(
    `INSERT INTO student_profiles
       (school_id, student_id, photo_url, date_of_birth, gender, blood_group, address,
        emergency_contact_phone, medical_notes, admission_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (student_id) DO UPDATE SET
       photo_url = COALESCE(EXCLUDED.photo_url, student_profiles.photo_url),
       date_of_birth = COALESCE(EXCLUDED.date_of_birth, student_profiles.date_of_birth),
       gender = COALESCE(EXCLUDED.gender, student_profiles.gender),
       blood_group = COALESCE(EXCLUDED.blood_group, student_profiles.blood_group),
       address = COALESCE(EXCLUDED.address, student_profiles.address),
       emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, student_profiles.emergency_contact_phone),
       medical_notes = COALESCE(EXCLUDED.medical_notes, student_profiles.medical_notes),
       admission_date = COALESCE(EXCLUDED.admission_date, student_profiles.admission_date),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [schoolId, studentId, photo_url || null, date_of_birth || null, gender || null,
     blood_group || null, address ? JSON.stringify(address) : null,
     emergency_contact_phone || null, medical_notes || null, admission_date || null]
  );
  return rows[0];
}

export async function upsertParentProfile(schoolId, studentId, fields) {
  const { id, relation, name, photo_url, phone, email, occupation, is_primary_contact } = fields;

  if (id) {
    const { rows } = await pool.query(
      `UPDATE parent_profiles SET
         relation = COALESCE($1, relation), name = COALESCE($2, name),
         photo_url = COALESCE($3, photo_url), phone = COALESCE($4, phone),
         email = COALESCE($5, email), occupation = COALESCE($6, occupation),
         is_primary_contact = COALESCE($7, is_primary_contact), updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND student_id = $9 AND school_id = $10
       RETURNING *`,
      [relation, name, photo_url, phone, email, occupation, is_primary_contact, id, studentId, schoolId]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `INSERT INTO parent_profiles
       (school_id, student_id, relation, name, photo_url, phone, email, occupation, is_primary_contact)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [schoolId, studentId, relation || 'guardian', name, photo_url || null, phone || null,
     email || null, occupation || null, !!is_primary_contact]
  );
  return rows[0];
}

export async function deleteParentProfile(schoolId, studentId, parentProfileId) {
  const { rowCount } = await pool.query(
    'DELETE FROM parent_profiles WHERE id = $1 AND student_id = $2 AND school_id = $3',
    [parentProfileId, studentId, schoolId]
  );
  return rowCount > 0;
}

/**
 * Teacher profile — sensitive fields (blood group, DOB, address, emergency
 * contact) restricted to super_admin/principal or the teacher viewing self.
 */
export async function getTeacherProfile(schoolId, teacherId, viewer) {
  const { rows } = await pool.query(
    `SELECT t.id AS teacher_id, t.name, t.email, t.phone, t.role,
            tp.id AS profile_id, tp.photo_url, tp.date_of_birth, tp.gender, tp.blood_group,
            tp.address, tp.emergency_contact_phone, tp.qualifications, tp.subjects_taught, tp.joining_date
       FROM teachers t
       LEFT JOIN teacher_profiles tp ON tp.teacher_id = t.id
      WHERE t.id = $1 AND t.school_id = $2`,
    [teacherId, schoolId]
  );
  if (rows.length === 0) return null;
  let profile = rows[0];

  const isSelf = viewer && viewer.role === 'teacher' && String(viewer.teacher_id) === String(teacherId);
  const isAdmin = viewer && (viewer.role === 'super_admin' || viewer.role === 'principal');
  if (!isSelf && !isAdmin) {
    profile = stripSensitive(profile, ['blood_group', 'date_of_birth', 'address', 'emergency_contact_phone']);
  }
  return profile;
}

export async function getTeacherDisplayInfo(schoolId, teacherId) {
  const { rows } = await pool.query(
    `SELECT t.id AS teacher_id, t.name, t.role, tp.photo_url, tp.subjects_taught
       FROM teachers t
       LEFT JOIN teacher_profiles tp ON tp.teacher_id = t.id
      WHERE t.id = $1 AND t.school_id = $2`,
    [teacherId, schoolId]
  );
  return rows[0] || null;
}

export async function upsertTeacherProfile(schoolId, teacherId, fields) {
  const {
    photo_url, date_of_birth, gender, blood_group, address,
    emergency_contact_phone, qualifications, subjects_taught, joining_date,
  } = fields;

  const { rows } = await pool.query(
    `INSERT INTO teacher_profiles
       (school_id, teacher_id, photo_url, date_of_birth, gender, blood_group, address,
        emergency_contact_phone, qualifications, subjects_taught, joining_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (teacher_id) DO UPDATE SET
       photo_url = COALESCE(EXCLUDED.photo_url, teacher_profiles.photo_url),
       date_of_birth = COALESCE(EXCLUDED.date_of_birth, teacher_profiles.date_of_birth),
       gender = COALESCE(EXCLUDED.gender, teacher_profiles.gender),
       blood_group = COALESCE(EXCLUDED.blood_group, teacher_profiles.blood_group),
       address = COALESCE(EXCLUDED.address, teacher_profiles.address),
       emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, teacher_profiles.emergency_contact_phone),
       qualifications = COALESCE(EXCLUDED.qualifications, teacher_profiles.qualifications),
       subjects_taught = COALESCE(EXCLUDED.subjects_taught, teacher_profiles.subjects_taught),
       joining_date = COALESCE(EXCLUDED.joining_date, teacher_profiles.joining_date),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [schoolId, teacherId, photo_url || null, date_of_birth || null, gender || null,
     blood_group || null, address ? JSON.stringify(address) : null, emergency_contact_phone || null,
     qualifications ? JSON.stringify(qualifications) : null,
     subjects_taught ? JSON.stringify(subjects_taught) : null, joining_date || null]
  );
  return rows[0];
}
