-- ============================================================
-- School Management Platform — Full Schema
-- Multi-tenant: every table is scoped by school_id (directly or
-- via a parent FK chain) so queries must always filter on it.
-- ============================================================

-- ---------- Core entities ----------
CREATE TABLE IF NOT EXISTS schools (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

CREATE TABLE IF NOT EXISTS super_admins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS class_subject_teachers (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE (class_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_cst_teacher ON class_subject_teachers(teacher_id);

CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'teacher', -- 'teacher' | 'principal'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parents (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    preferred_language VARCHAR(10) DEFAULT 'hi', -- 'hi' | 'pa' | 'en'
    opt_in_status VARCHAR(20) NOT NULL DEFAULT 'OPTED_OUT', -- hard compliance gate
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(id),
    parent_id INT REFERENCES parents(id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lightweight student portal login (no email — students log in with a short
-- login_id, e.g. roll number, plus a 4-6 digit PIN). Added via ALTER so the
-- migration also works against an already-deployed students table.
ALTER TABLE students ADD COLUMN IF NOT EXISTS login_id VARCHAR(20) UNIQUE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS grade VARCHAR(20);

-- ---------- Attendance & escalation (Phase 1) ----------
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL, -- 'present' | 'absent' | 'late'
    marked_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, date)
);

CREATE TABLE IF NOT EXISTS notification_log (
    id SERIAL PRIMARY KEY,
    attendance_id INT REFERENCES attendance(id) ON DELETE CASCADE,
    parent_id INT REFERENCES parents(id),
    type VARCHAR(20) NOT NULL, -- 'whatsapp' | 'voice'
    status VARCHAR(50) NOT NULL DEFAULT 'SENT', -- SENT | FAILED | REPLIED | ESCALATED
    replied_at TIMESTAMP,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS call_outcomes (
    id SERIAL PRIMARY KEY,
    notification_log_id INT REFERENCES notification_log(id) ON DELETE CASCADE,
    vapi_call_id VARCHAR(255),
    outcome VARCHAR(50), -- 'answered' | 'no_answer' | 'voicemail' | 'failed'
    transcript TEXT,
    duration_seconds INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Teacher guidance & performance (Phase 3) ----------
CREATE TABLE IF NOT EXISTS syllabus_calendar (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id),
    subject_id VARCHAR(50) NOT NULL,
    chapter_id VARCHAR(50) NOT NULL,
    target_start_date DATE NOT NULL,
    target_end_date DATE NOT NULL
);
ALTER TABLE syllabus_calendar ADD COLUMN IF NOT EXISTS teacher_id INT REFERENCES teachers(id);
ALTER TABLE syllabus_calendar ADD COLUMN IF NOT EXISTS chapter_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS syllabus_progress (
    id SERIAL PRIMARY KEY,
    chapter_id VARCHAR(50) NOT NULL,
    class_id INT NOT NULL REFERENCES classes(id),
    teacher_id INT REFERENCES teachers(id),
    marked_complete_date DATE
);

CREATE TABLE IF NOT EXISTS homework_suggestions (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    chapter_id VARCHAR(50) NOT NULL,
    suggested_text TEXT NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'ai', -- 'ai' | 'admin'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_snapshots (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(id),
    teacher_id INT REFERENCES teachers(id), -- nullable: class-level snapshot
    subject_id VARCHAR(50),
    period VARCHAR(20) NOT NULL, -- e.g. '2026-W27'
    metrics JSONB NOT NULL DEFAULT '{}',
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- AI Home Tutor sessions (web/mobile "Ask for Help" panel) ----------
-- Separate from student_doubts (which is the WhatsApp single-shot hint flow).
-- Each row is one homework session with the full back-and-forth so the
-- tutor keeps context (what step the student is on, what they already tried).
CREATE TABLE IF NOT EXISTS tutor_sessions (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject VARCHAR(100),
    grade VARCHAR(20),
    conversation_history JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_student ON tutor_sessions(student_id);

-- ---------- Teacher biometric attendance (multi-vendor) ----------
CREATE TABLE IF NOT EXISTS biometric_devices (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    vendor VARCHAR(50) NOT NULL, -- 'zkteco' | 'csv_import' | etc — free text, no enum, so new vendors need no migration
    device_serial VARCHAR(100),
    label VARCHAR(100), -- e.g. "Main Gate"
    webhook_token VARCHAR(100) NOT NULL, -- shared secret the device/bridge script sends back, since devices can't hold a JWT
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_device_mapping (
    id SERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    device_id INT NOT NULL REFERENCES biometric_devices(id) ON DELETE CASCADE,
    device_internal_id VARCHAR(100) NOT NULL, -- the enrollment/card ID the device itself uses
    UNIQUE (device_id, device_internal_id)
);

CREATE TABLE IF NOT EXISTS teacher_punch_events (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    device_id INT REFERENCES biometric_devices(id) ON DELETE SET NULL,
    punch_time TIMESTAMP NOT NULL,
    punch_type VARCHAR(10), -- 'in' | 'out' | 'unknown'
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_punch_teacher_date ON teacher_punch_events(teacher_id, punch_time);

CREATE TABLE IF NOT EXISTS teacher_attendance_daily (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    first_punch TIMESTAMP,
    last_punch TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'present', -- 'present' | 'absent' | 'half_day' | 'manual_override'
    corrected_by INT REFERENCES teachers(id),
    UNIQUE (teacher_id, date)
);

-- ---------- Homework & doubt solving (Phase 2) ----------
CREATE TABLE IF NOT EXISTS student_doubts (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    parent_id INT REFERENCES parents(id),
    student_id INT REFERENCES students(id),
    original_query TEXT,
    ai_response_hint TEXT,
    chapter_tag VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Fee / salary / petty cash (Phase 4, Tier 2) ----------
CREATE TABLE IF NOT EXISTS student_payment (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount_due NUMERIC(10,2) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id)
);

CREATE TABLE IF NOT EXISTS student_payment_history (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount_paid NUMERIC(10,2) NOT NULL,
    payment_mode VARCHAR(50) NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_salary (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    monthly_amount NUMERIC(10,2) NOT NULL,
    UNIQUE (teacher_id)
);

CREATE TABLE IF NOT EXISTS teacher_salary_history (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    period VARCHAR(20) NOT NULL, -- e.g. '2026-07'
    amount_paid NUMERIC(10,2) NOT NULL,
    paid_on DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | PAID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS petty_cash (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    requested_by VARCHAR(255) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    purpose TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
    approved_by VARCHAR(255),
    actioned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS petty_cash_history (
    id SERIAL PRIMARY KEY,
    petty_cash_id INT NOT NULL REFERENCES petty_cash(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL,
    actioned_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional per spec 8.3 — link only, no video storage
CREATE TABLE IF NOT EXISTS cctv_footage_url (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    label VARCHAR(255),
    url TEXT NOT NULL,
    recorded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Premium AI add-on (Phase 5, Tier 3) ----------
CREATE TABLE IF NOT EXISTS generated_tests (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subject_id VARCHAR(50) NOT NULL,
    chapter_id VARCHAR(50) NOT NULL,
    difficulty VARCHAR(20) NOT NULL,
    questions JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_rubrics (
    id SERIAL PRIMARY KEY,
    test_id INT NOT NULL REFERENCES generated_tests(id) ON DELETE CASCADE,
    question_num INT NOT NULL,
    correct_answer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_graded_submissions (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(id),
    test_id INT NOT NULL REFERENCES generated_tests(id),
    question_num INT NOT NULL,
    extracted_text TEXT,
    score NUMERIC(4,1),
    justification TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Indexes for the multi-tenant + hot-path queries ----------
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance(school_id, date);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status);
CREATE INDEX IF NOT EXISTS idx_performance_flagged ON performance_snapshots(school_id, flagged);
CREATE INDEX IF NOT EXISTS idx_doubts_school ON student_doubts(school_id);
