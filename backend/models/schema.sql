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


ALTER TABLE teachers ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);
ALTER TABLE teachers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS whatsapp_opt_in_status VARCHAR(20) NOT NULL DEFAULT 'OPTED_OUT';

CREATE TABLE IF NOT EXISTS class_notes (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id),
    subject_id INT REFERENCES subjects(id),
    teacher_id INT NOT NULL REFERENCES teachers(id),
    title VARCHAR(255) NOT NULL,
    body_text TEXT,
    attachment_url TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS class_note_deliveries (
    id SERIAL PRIMARY KEY,
    note_id INT NOT NULL REFERENCES class_notes(id) ON DELETE CASCADE,
    parent_id INT NOT NULL REFERENCES parents(id),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NOT_OPTED_IN'
    sent_at TIMESTAMP
);

-- ---------- School bus GPS tracking (multi-vendor) ----------
CREATE TABLE IF NOT EXISTS buses (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    route_name VARCHAR(100),
    vehicle_number VARCHAR(50),
    driver_name VARCHAR(255),
    driver_phone VARCHAR(20),
    gps_vendor VARCHAR(50), -- free text, e.g. 'generic_poll' | 'trackmybus' | 'traxroot'
    vendor_device_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ---------- Transport GPS — production connection details ----------
-- webhook_token is real per-bus auth for push vendors (previously the
-- webhook route reused vendor_device_id as the "token", which meant anyone
-- who knew a bus's device id could post fake locations — this closes that).
-- The vendor_api_* / vendor_field_* columns back a generic REST-polling
-- adapter that works with most vendors' "get current location" endpoints
-- without needing bespoke code per vendor.
ALTER TABLE buses ADD COLUMN IF NOT EXISTS webhook_token VARCHAR(64);
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_api_base_url TEXT;
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_api_key TEXT;
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_lat_path VARCHAR(100) DEFAULT 'lat';
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_lng_path VARCHAR(100) DEFAULT 'lng';
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_speed_path VARCHAR(100);
ALTER TABLE buses ADD COLUMN IF NOT EXISTS vendor_timestamp_path VARCHAR(100);
ALTER TABLE buses ADD COLUMN IF NOT EXISTS last_poll_status VARCHAR(20); -- 'ok' | 'error'
ALTER TABLE buses ADD COLUMN IF NOT EXISTS last_poll_error TEXT;
ALTER TABLE buses ADD COLUMN IF NOT EXISTS last_poll_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS bus_location_log (
    id SERIAL PRIMARY KEY,
    bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    speed_kmh NUMERIC(5,1),
    recorded_at TIMESTAMP NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bus_location_bus_time ON bus_location_log(bus_id, recorded_at DESC);

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
-- Cash-counter payment photo proof, for disputes ("I paid but it's not showing")
ALTER TABLE student_payment_history ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE student_payment_history ADD COLUMN IF NOT EXISTS collected_by INT REFERENCES teachers(id);

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
-- The route's own NOT EXISTS check is a TOCTOU race — two /payroll/run
-- requests close together (e.g. an impatient double-click) could both pass
-- it before either commits, creating duplicate salary rows for the same
-- teacher+period. A real unique index closes that at the DB level;
-- CREATE UNIQUE INDEX IF NOT EXISTS also retrofits it onto an existing
-- table that was created before this constraint existed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_history_teacher_period ON teacher_salary_history(teacher_id, period);

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

-- ---------- Billing (school-level plan view) ----------
ALTER TABLE schools ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'starter'; -- 'starter' | 'growth' | 'district'
ALTER TABLE schools ADD COLUMN IF NOT EXISTS plan_renews_at DATE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS student_limit INT NOT NULL DEFAULT 100;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS accountant_seat_limit INT NOT NULL DEFAULT 0;

-- ---------- Settings (branding, WhatsApp business number, notification prefs) ----------
CREATE TABLE IF NOT EXISTS school_settings (
    school_id INT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    logo_url TEXT,
    whatsapp_business_number VARCHAR(20),
    whatsapp_connected BOOLEAN NOT NULL DEFAULT FALSE,
    notify_attendance BOOLEAN NOT NULL DEFAULT TRUE,
    notify_homework BOOLEAN NOT NULL DEFAULT TRUE,
    notify_fees BOOLEAN NOT NULL DEFAULT TRUE,
    notify_payroll BOOLEAN NOT NULL DEFAULT TRUE,
    petty_cash_accountant_limit NUMERIC(10,2) NOT NULL DEFAULT 5000,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Communications (WhatsApp broadcast log) ----------
CREATE TABLE IF NOT EXISTS broadcasts (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    audience VARCHAR(50) NOT NULL, -- 'all_parents' | 'all_staff' | 'class:<id>' | 'student:<id>'
    audience_label VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    sent_by INT REFERENCES teachers(id),
    recipient_count INT NOT NULL DEFAULT 0,
    delivered_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_school ON broadcasts(school_id);

-- ---------- Reports (lightweight generation log for audit trail) ----------
CREATE TABLE IF NOT EXISTS report_generations (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL, -- 'attendance' | 'fees' | 'payroll'
    generated_by INT REFERENCES teachers(id),
    date_from DATE,
    date_to DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Grading (extend existing ai_graded_submissions with human review) ----------
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS teacher_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS final_score NUMERIC(4,1);
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS confirmed_by INT REFERENCES teachers(id);
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

-- ---------- AI Grading — production hardening ----------
-- Rubrics now carry their own marks-out-of so scoring isn't hardcoded to /10.
ALTER TABLE test_rubrics ADD COLUMN IF NOT EXISTS max_marks NUMERIC(4,1) NOT NULL DEFAULT 10;
-- Tests need a title + class scoping to be manageable from a real UI list
-- (subject_id/chapter_id alone aren't enough to tell tests apart at a glance).
ALTER TABLE generated_tests ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE generated_tests ADD COLUMN IF NOT EXISTS class_id INT REFERENCES classes(id) ON DELETE SET NULL;
ALTER TABLE generated_tests ADD COLUMN IF NOT EXISTS created_by INT REFERENCES teachers(id);
-- Submissions store the actual answer-sheet image (base64) alongside the
-- OCR text so a teacher reviewing an AI score can see the original writing,
-- not just trust the extraction blind.
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS answer_image_base64 TEXT;
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS max_marks NUMERIC(4,1) NOT NULL DEFAULT 10;
ALTER TABLE ai_graded_submissions ADD COLUMN IF NOT EXISTS ocr_confidence VARCHAR(10); -- 'high' | 'medium' | 'low'
CREATE INDEX IF NOT EXISTS idx_graded_submissions_test ON ai_graded_submissions(test_id);

-- ---------- Student Portal: Homework, Notes, Progress, Rewards ----------
CREATE TABLE IF NOT EXISTS homework (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date DATE,
    created_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id);

CREATE TABLE IF NOT EXISTS homework_completions (
    id SERIAL PRIMARY KEY,
    homework_id INT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_notes (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled note',
    subject_id VARCHAR(50),
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id);

-- ---------- Fee collectors + WhatsApp cash intake ----------
CREATE TABLE IF NOT EXISTS fee_collectors (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Nothing here is ever auto-marked as a real payment. AI reads the slip photo
-- and proposes an amount/student match; a human (Accountant/Principal) must
-- confirm before it becomes a real student_payment_history row.
CREATE TABLE IF NOT EXISTS whatsapp_cash_intake (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    fee_collector_id INT NOT NULL REFERENCES fee_collectors(id),
    photo_base64 TEXT NOT NULL,
    ai_extracted_amount NUMERIC(10,2),
    ai_extracted_student_hint VARCHAR(255),
    matched_student_id INT REFERENCES students(id),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | CONFIRMED | REJECTED
    confirmed_amount NUMERIC(10,2),
    confirmed_by INT REFERENCES teachers(id),
    confirmed_at TIMESTAMP,
    payment_history_id INT REFERENCES student_payment_history(id),
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_cash_school ON whatsapp_cash_intake(school_id);

-- ---------- Online fee payment links (Razorpay) ----------
-- reference_id is what makes "which parent paid" answerable — it's embedded
-- in the Razorpay link and comes back on the webhook, so payments never need
-- manual matching even when amounts collide.
CREATE TABLE IF NOT EXISTS fee_payment_links (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL,
    reference_id VARCHAR(100) UNIQUE NOT NULL,
    razorpay_link_id VARCHAR(100),
    razorpay_link_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED', -- CREATED | PAID | EXPIRED | CANCELLED
    payment_history_id INT REFERENCES student_payment_history(id),
    created_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fee_links_school ON fee_payment_links(school_id);

-- ---------- Staff leave management ----------
-- Balances are tracked per-teacher-per-year so a new academic year just
-- inserts a fresh row rather than needing a reset migration each time.
CREATE TABLE IF NOT EXISTS staff_leave_balances (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    year INT NOT NULL,
    leave_type VARCHAR(20) NOT NULL, -- 'casual' | 'sick' | 'earned'
    total_days NUMERIC(4,1) NOT NULL DEFAULT 0,
    used_days NUMERIC(4,1) NOT NULL DEFAULT 0,
    UNIQUE (teacher_id, year, leave_type)
);

CREATE TABLE IF NOT EXISTS staff_leave_requests (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    leave_type VARCHAR(20) NOT NULL, -- 'casual' | 'sick' | 'earned'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(4,1) NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED | CANCELLED
    reviewed_by INT REFERENCES teachers(id),
    reviewed_at TIMESTAMP,
    review_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_school ON staff_leave_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_teacher ON staff_leave_requests(teacher_id);

-- ---------- Class timetable ----------
-- One row per (class, day, period). teacher_id/subject_id nullable so a
-- principal can lay out the grid (say, "Period 3") before assigning who
-- teaches it — matches how schools actually build a timetable in practice.
CREATE TABLE IF NOT EXISTS timetable_slots (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL, -- 1=Monday .. 6=Saturday
    period_number SMALLINT NOT NULL,
    start_time TIME,
    end_time TIME,
    subject_id INT REFERENCES subjects(id) ON DELETE SET NULL,
    teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    room VARCHAR(50),
    UNIQUE (class_id, day_of_week, period_number)
);
CREATE INDEX IF NOT EXISTS idx_timetable_school ON timetable_slots(school_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_slots(teacher_id);

-- ---------- School event calendar ----------
CREATE TABLE IF NOT EXISTS school_events (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    end_date DATE, -- null for single-day events
    event_type VARCHAR(30) NOT NULL DEFAULT 'general', -- 'holiday' | 'exam' | 'ptm' | 'general' | 'sports' | 'other'
    audience VARCHAR(20) NOT NULL DEFAULT 'all', -- 'all' | 'staff' | 'students' | 'parents'
    created_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_school_date ON school_events(school_id, event_date);

-- ---------- Library management ----------
CREATE TABLE IF NOT EXISTS library_books (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255),
    isbn VARCHAR(30),
    category VARCHAR(100),
    total_copies INT NOT NULL DEFAULT 1,
    available_copies INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_library_books_school ON library_books(school_id);

CREATE TABLE IF NOT EXISTS library_issues (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    book_id INT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
    student_id INT REFERENCES students(id) ON DELETE CASCADE,
    teacher_id INT REFERENCES teachers(id) ON DELETE CASCADE,
    issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    returned_date DATE,
    fine_amount NUMERIC(8,2) DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED', -- ISSUED | RETURNED | OVERDUE | LOST
    CHECK (student_id IS NOT NULL OR teacher_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_library_issues_school ON library_issues(school_id);
CREATE INDEX IF NOT EXISTS idx_library_issues_book ON library_issues(book_id);

-- ---------- AI Tutor — Voice (Vapi) ----------
-- Single global row: super admin wires up the Vapi account once here, then
-- flips voice_tutor_enabled per school below as a plan feature — mirrors how
-- WayneRing's assistant config works, reused rather than rebuilt per-product.
CREATE TABLE IF NOT EXISTS ai_voice_tutor_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
    vapi_api_key TEXT,
    vapi_phone_number_id VARCHAR(100),
    assistant_id_english VARCHAR(100),
    assistant_id_hindi VARCHAR(100),
    assistant_id_punjabi VARCHAR(100),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_voice_tutor_call_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT REFERENCES students(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    subject VARCHAR(100),
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    vapi_call_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'INITIATED', -- INITIATED | FAILED
    error TEXT,
    initiated_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_tutor_log_school ON ai_voice_tutor_call_log(school_id);

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS voice_tutor_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- WhatsApp connection — real verification instead of a checkbox ----------
-- whatsapp_connected now only flips TRUE once the entered number has proven
-- it can receive a message from our own WhatsApp Business number (OTP-style),
-- rather than the moment someone types a number into the settings form.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS whatsapp_verify_code VARCHAR(10);
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS whatsapp_verify_expires_at TIMESTAMP;

-- ---------- Communication (Feature Group 3) ----------
-- 3.1 Messages — extends the existing `broadcasts` log (rather than a
-- parallel table) into threaded class/individual messaging. `audience`
-- already used the 'class:<id>' / 'student:<id>' shape in its comment even
-- before anything sent to those targets, so thread_key just mirrors that
-- same value for rows that represent an addressable, replayable thread.
-- Mass blasts ('all_parents' / 'all_staff') stay thread_key = NULL — they're
-- one-off campaigns, not a conversation with a single class or family, and
-- keeping them out of thread_key keeps the Messages thread list from being
-- cluttered with entries nobody would click into as a "thread".
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS thread_key VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_broadcasts_thread ON broadcasts(school_id, thread_key);

-- 3.2 Notifications — superseded by dashboard_notifications/
-- notification_templates (feature/whatsapp-notifications, see further down
-- this file) which landed a more complete generic notification center with
-- WhatsApp template integration. This branch's own `notifications` table
-- was never wired to anything after reconciling the two — intentionally not
-- created here to avoid an orphaned, unused table.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS whatsapp_pending_number VARCHAR(20);

-- ============================================================
-- Student & Teacher Profiles — shared master data (Phase 6)
-- ============================================================
-- These are ADDITIVE profile tables, not a replacement for students/teachers
-- (which stay the identity/login/FK anchor). Every other module should read
-- display data (photo, DOB, blood group, etc.) through profileService.js
-- rather than keeping its own copy.

-- One class can have a designated homeroom teacher, used to gate access to
-- a student's sensitive profile fields (blood group, medical notes, parent
-- contact) to that teacher specifically, not every teacher in the school.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS student_profiles (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    photo_url TEXT,
    date_of_birth DATE,
    gender VARCHAR(20),
    blood_group VARCHAR(10),
    address JSONB DEFAULT '{}',
    emergency_contact_phone VARCHAR(20),
    medical_notes TEXT, -- free text, e.g. allergies — optional, sensitive
    admission_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_profiles_school ON student_profiles(school_id);

-- A student can have 2+ rows here (father + mother, or a guardian). This is
-- deliberately separate from the existing `parents` table, which stays the
-- WhatsApp/notification identity (single row, opt_in_status, phone used for
-- the webhook lookup) — parent_profiles is richer display-only detail and
-- must never be joined into the compliance-gated whatsapp flows.
CREATE TABLE IF NOT EXISTS parent_profiles (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relation VARCHAR(20) NOT NULL DEFAULT 'guardian', -- 'father' | 'mother' | 'guardian'
    name VARCHAR(255) NOT NULL,
    photo_url TEXT,
    phone VARCHAR(20),
    email VARCHAR(255),
    occupation VARCHAR(255),
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_student ON parent_profiles(student_id);

CREATE TABLE IF NOT EXISTS teacher_profiles (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL UNIQUE REFERENCES teachers(id) ON DELETE CASCADE,
    photo_url TEXT,
    date_of_birth DATE,
    gender VARCHAR(20),
    blood_group VARCHAR(10),
    address JSONB DEFAULT '{}',
    emergency_contact_phone VARCHAR(20),
    qualifications JSONB DEFAULT '[]',
    subjects_taught JSONB DEFAULT '[]',
    joining_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_school ON teacher_profiles(school_id);

-- ============================================================
-- Unified Notification Service (Phase 7)
-- ============================================================
-- IMPORTANT ADAPTATION FROM THE ORIGINAL SPEC: Waynur has no parent web
-- login (parents table has no password_hash — parents only ever interact via
-- WhatsApp). So for recipient_type='parent' the WhatsApp send *is* the
-- notification; there is no separate "parent dashboard feed" to build.
-- dashboard_notifications rows are still written for parents (so a future
-- parent portal wouldn't need a backfill), but the bell/feed UI only needs
-- wiring into the Staff (teacher/principal/accountant) and Student shells.
--
-- This is a NEW, general-purpose table — it is intentionally separate from
-- the existing `notification_log` table, which stays exactly as-is (it's
-- the attendance-specific absence-alert -> voice-escalation pipeline used by
-- workers/attendanceWorker.js and the WhatsApp webhook's REPLIED update;
-- don't repoint those at this new table).

CREATE TABLE IF NOT EXISTS notification_templates (
    id SERIAL PRIMARY KEY,
    school_id INT REFERENCES schools(id) ON DELETE CASCADE, -- NULL = global default, used when no school-specific override exists
    trigger_event VARCHAR(50) NOT NULL, -- 'attendance_marked' | 'fee_due' | 'fee_payment_confirmed' | 'homework_assigned' | 'exam_result' | 'activity_shared' | 'salary_credited'
    channel VARCHAR(20) NOT NULL DEFAULT 'both', -- 'whatsapp' | 'dashboard' | 'both'
    name VARCHAR(255) NOT NULL,
    -- Meta requires a pre-approved template for the first outbound message in
    -- a WhatsApp conversation window (see workers/attendanceWorker.js) — so
    -- whatsapp_template_name must match a template already approved in the
    -- WhatsApp Business Manager, and whatsapp_param_order lists the
    -- variable keys in the exact order that template's {{1}} {{2}} ... expect.
    whatsapp_template_name VARCHAR(100),
    whatsapp_param_order JSONB NOT NULL DEFAULT '[]',
    -- Dashboard copy uses our own {{var}} named placeholders (no Meta
    -- approval needed since it's just rendered in-app, not sent as a message).
    dashboard_title_template TEXT,
    dashboard_body_template TEXT,
    media_supported BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Postgres treats every NULL as distinct under a plain UNIQUE constraint, so
-- a single UNIQUE(school_id, trigger_event) would silently allow duplicate
-- global (school_id IS NULL) templates. Two indexes instead: one for real
-- per-school overrides, one partial index enforcing exactly one global
-- default per trigger_event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_templates_school_trigger
  ON notification_templates(school_id, trigger_event) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_templates_global_trigger
  ON notification_templates(trigger_event) WHERE school_id IS NULL;

-- One row per (notification attempt, recipient) — this single table doubles
-- as both the delivery log AND the dashboard bell feed (recipient_type +
-- recipient_id + is_read is exactly what the feed query needs), so we don't
-- need a separate notification_recipients table for the simple single-send
-- case. Batch sends (Activities module) just insert multiple rows sharing
-- a batch_key.
CREATE TABLE IF NOT EXISTS dashboard_notifications (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    template_id INT REFERENCES notification_templates(id) ON DELETE SET NULL,
    trigger_event VARCHAR(50) NOT NULL,
    recipient_type VARCHAR(20) NOT NULL, -- 'parent' | 'student' | 'staff'
    recipient_id INT NOT NULL, -- parents.id | students.id | teachers.id depending on recipient_type
    student_id INT REFERENCES students(id) ON DELETE CASCADE, -- context, nullable (e.g. staff salary notice has no student)
    channel_used VARCHAR(20) NOT NULL DEFAULT 'dashboard',
    title TEXT,
    body TEXT,
    payload_sent JSONB NOT NULL DEFAULT '{}',
    whatsapp_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable', -- 'not_applicable' | 'queued' | 'sent' | 'failed'
    whatsapp_message_id VARCHAR(255),
    error_message TEXT,
    batch_key VARCHAR(100), -- e.g. 'activity:42' — groups a fan-out send for reporting
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dashboard_notif_recipient ON dashboard_notifications(school_id, recipient_type, recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_dashboard_notif_batch ON dashboard_notifications(batch_key);

-- Deep-link target for the notification bell (e.g. a specific message
-- thread) — without this, every non-student-context notification fell back
-- to a generic /dashboard link regardless of what it was actually about.
ALTER TABLE dashboard_notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- Seed a dashboard-only template for the Messages feature's principal ping
-- (feature/communication-messages-notifications) — no WhatsApp side, this
-- notification is purely an in-app "someone sent a message" alert.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, dashboard_title_template, dashboard_body_template)
SELECT NULL, 'new_message', 'dashboard', 'New Message', 'New message', '{{sender_name}} sent a message to {{audience_label}}'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'new_message'
);

-- Seed global default templates for the two modules retrofitted first
-- (fees + homework) to prove the pattern, per the build spec. School-level
-- overrides can be added later via SuperAdmin CRUD (same table, school_id set).
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, v.trigger_event, v.channel, v.name, v.whatsapp_template_name, v.whatsapp_param_order::jsonb, v.dashboard_title_template, v.dashboard_body_template, v.media_supported
FROM (VALUES
  ('homework_assigned', 'both', 'Homework Assigned',
   'homework_assigned_alert', '["student_name","subject","title","due_date"]',
   'New homework: {{title}}', '{{subject}} — due {{due_date}}. {{description}}', FALSE),
  ('fee_payment_confirmed', 'both', 'Fee Payment Confirmed',
   'fee_payment_confirmed_alert', '["student_name","amount"]',
   'Payment received', 'We received ₹{{amount}} for {{student_name}}. Thank you!', FALSE)
) AS v(trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = v.trigger_event
);

-- ============================================================
-- Transport — split driver payout from student fee collection (Phase 8)
-- ============================================================
-- ADAPTATION FROM THE ORIGINAL SPEC: this platform has no separate
-- drivers/vehicles/routes tables — `buses` already IS route+vehicle+driver
-- combined (one row per bus, with driver_name/driver_phone/route_name
-- fields). Rather than fork a parallel driver/vehicle/route model, this
-- extends `buses` with payout fields and keys everything off bus_id.
ALTER TABLE buses ADD COLUMN IF NOT EXISTS rate_per_km NUMERIC(6,2);
ALTER TABLE buses ADD COLUMN IF NOT EXISTS driver_bank_details JSONB DEFAULT '{}';

-- km per trip/day. `gps_auto` rows are computed by transportPayoutService.js
-- (haversine distance summed over that bus's bus_location_log pings for the
-- day) — no new GPS infra needed, it reuses pings already being collected.
-- `manual_entry` is the fallback for routes with no GPS vendor connected yet
-- (see buses.gps_vendor / last_poll_status).
CREATE TABLE IF NOT EXISTS driver_trip_logs (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    trip_date DATE NOT NULL,
    km_logged NUMERIC(6,2) NOT NULL,
    km_source VARCHAR(20) NOT NULL DEFAULT 'manual_entry', -- 'gps_auto' | 'manual_entry'
    logged_by INT REFERENCES teachers(id), -- set only for manual_entry
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bus_id, trip_date) -- one consolidated km figure per bus per day
);
CREATE INDEX IF NOT EXISTS idx_driver_trip_logs_bus ON driver_trip_logs(bus_id, trip_date);

CREATE TABLE IF NOT EXISTS driver_payouts (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_km NUMERIC(8,2) NOT NULL,
    rate_per_km NUMERIC(6,2) NOT NULL,
    calculated_amount NUMERIC(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'paid'
    approved_by INT REFERENCES teachers(id),
    paid_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_bus ON driver_payouts(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_school ON driver_payouts(school_id, status);

-- Per-student transport fee, independent of driver_payouts (acceptance
-- criteria: editing/deleting one must never touch the other's records —
-- the only shared link is bus_id, used for the route-profitability report,
-- never for storage). billing_month keyed so "Generate Payout"/collection
-- runs are idempotent per month, same convention as teacher_salary_history.
CREATE TABLE IF NOT EXISTS student_transport_fees (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    pickup_point VARCHAR(255),
    monthly_fee NUMERIC(8,2) NOT NULL,
    billing_month VARCHAR(7) NOT NULL, -- e.g. '2026-08'
    collection_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'collected'
    -- NOTE: student_payment/student_payment_history (existing Billing module)
    -- store a single cumulative amount_due/amount_paid per student — there is
    -- no itemized fee_type breakdown anywhere in the platform yet. Collecting
    -- a transport fee inserts into student_payment_history same as any other
    -- collection (tagged in `remarks`) and links back here via
    -- payment_history_id; a true itemized-ledger fee_type column is a larger
    -- Billing-module refactor, out of scope for this feature.
    payment_history_id INT REFERENCES student_payment_history(id),
    collected_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, billing_month)
);
CREATE INDEX IF NOT EXISTS idx_student_transport_fees_school ON student_transport_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_student_transport_fees_bus ON student_transport_fees(bus_id, billing_month);

-- ============================================================
-- Activities module (Phase 9)
-- ============================================================
-- ADAPTATIONS FROM THE ORIGINAL SPEC:
-- 1. This platform has no "section" entity — only `classes` (e.g. one row
--    per "Grade 8", no "8-A"/"8-B" split). So visibility_scope only supports
--    'all' | 'class' | 'individual', not 'section'.
-- 2. No parent web portal exists (see the notification_templates comment
--    above) — the "parent dashboard feed" from the spec is realized as the
--    WhatsApp message itself for parents, and as a real feed tab on the
--    STUDENT portal instead (students do have a web login).
CREATE TABLE IF NOT EXISTS activities (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by INT REFERENCES teachers(id),
    visibility_scope VARCHAR(20) NOT NULL DEFAULT 'all', -- 'all' | 'class' | 'individual'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activities_school ON activities(school_id, activity_date DESC);

CREATE TABLE IF NOT EXISTS activity_media (
    id SERIAL PRIMARY KEY,
    activity_id INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_type VARCHAR(10) NOT NULL DEFAULT 'photo', -- 'photo' | 'video'
    thumbnail_url TEXT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_media_activity ON activity_media(activity_id);

-- Recipients are resolved to actual student rows AT SEND TIME (per
-- acceptance criteria: a student added to the class later must never
-- retroactively see old activities) — this table stores the resolved list,
-- not the scope, so nothing here changes after creation.
CREATE TABLE IF NOT EXISTS activity_recipients (
    id SERIAL PRIMARY KEY,
    activity_id INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (activity_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_recipients_student ON activity_recipients(student_id);

-- New trigger_event for the shared NotificationService (see notification_templates
-- above) — media_supported = TRUE so notificationService.send() attaches photos.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'activity_shared', 'both', 'Activity Shared',
       'activity_shared_alert', '["student_name","title"]'::jsonb,
       '{{title}}', '{{description}}', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'activity_shared'
);

-- ---------- Teacher Management additions: Optional Subjects + Student Leave ----------
-- `classes` had no section column at all — sections aren't modeled anywhere
-- else in the schema (each class name like "Class 8A" already implies its
-- own roster/class row), so this is added as free-text rather than a new
-- sections table, per the spec's guidance for this ambiguous case.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS section VARCHAR(20);

-- `students` had no admission number either. Nullable — real schools need
-- this field, but existing/legacy rows shouldn't be forced to backfill it.
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_number VARCHAR(50);

CREATE TABLE IF NOT EXISTS optional_subjects (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, name)
);

-- `section` here is a denormalized copy of classes.section at assignment
-- time (free text, matching the classes table — see above), not a
-- section_id FK, since there is no sections table to reference.
CREATE TABLE IF NOT EXISTS student_optional_subject_assignments (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES optional_subjects(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    section VARCHAR(20),
    assigned_by INT REFERENCES teachers(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_optional_subject_assignments_school ON student_optional_subject_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_optional_subject_assignments_class ON student_optional_subject_assignments(class_id);

-- Student leave approval — distinct from staff_leave_requests above (that's
-- for teaching/admin staff; this is students applying to their class
-- teacher/principal). Both principal and the student's class teacher(s) can
-- review — see backend/routes/studentLeave.js for the access rule.
CREATE TABLE IF NOT EXISTS student_leave_requests (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | DECLINED
    reviewed_by INT REFERENCES teachers(id),
    reviewed_at TIMESTAMP,
    review_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_leave_requests_school ON student_leave_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_student_leave_requests_student ON student_leave_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_student_leave_requests_class ON student_leave_requests(class_id);
