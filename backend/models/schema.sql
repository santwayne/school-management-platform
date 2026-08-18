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
    role VARCHAR(20) NOT NULL DEFAULT 'teacher', -- 'teacher' | 'principal' | 'accountant' | 'librarian'
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
-- Receipt photo for a petty cash expense. Same convention as
-- student_payment_history.proof_photo_url: holds a base64 data string, not a
-- real URL, when it comes from the WhatsApp intake path (routes/whatsapp.js)
-- since there's no S3/file storage wired up for cash intake anywhere yet.
ALTER TABLE petty_cash ADD COLUMN IF NOT EXISTS receipt_photo_url TEXT;

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

-- Library contacts (librarian) — mirrors fee_collectors: no login, just a
-- registered WhatsApp number that receives AI-generated due/overdue alerts.
-- Registered by the Principal from the Library admin screen.
CREATE TABLE IF NOT EXISTS library_contacts (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- ---------- Lesson plans ----------
-- A teacher's per-class/subject lesson plan. attachment_url follows the same
-- convention as class_notes — a plain URL string, not real upload infra.
-- timetable_slot_id is a nullable link to a specific (day, period) cell so a
-- plan CAN be tied to a scheduled period, but most plans won't map 1:1 to a
-- slot, so it's optional. ON DELETE SET NULL keeps the plan intact if the
-- principal later reshapes the timetable grid.
CREATE TABLE IF NOT EXISTS lesson_plans (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(id) ON DELETE SET NULL,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    attachment_url TEXT,
    timetable_slot_id INT REFERENCES timetable_slots(id) ON DELETE SET NULL,
    plan_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_school ON lesson_plans(school_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_teacher ON lesson_plans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_class ON lesson_plans(class_id);
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

-- Seed dashboard-only templates for student leave approval (Feature Group 1)
-- — the class incharge gets pinged on submission, the student gets pinged
-- on approve/decline. Neither needs WhatsApp; both are in-app only.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, dashboard_title_template, dashboard_body_template)
SELECT NULL, 'student_leave_submitted', 'dashboard', 'Student Leave Submitted', 'New leave request', '{{student_name}} requested leave from {{from_date}} to {{to_date}}'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'student_leave_submitted'
);
INSERT INTO notification_templates (school_id, trigger_event, channel, name, dashboard_title_template, dashboard_body_template)
SELECT NULL, 'student_leave_status_changed', 'dashboard', 'Leave Request Reviewed', 'Leave request {{status}}', 'Your leave request was {{status}}. {{review_note}}'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'student_leave_status_changed'
);

-- Upgrade both student-leave events to dual-channel (dashboard + WhatsApp) so
-- the parent — added as a recipient in studentLeave.js — actually gets
-- pinged, per Item 2 of the Waynur build spec. UPDATE rather than a fresh
-- INSERT because idx_notif_templates_global_trigger only allows one global
-- row per trigger_event, and the dashboard-only row above may already exist
-- from an earlier run of this file. whatsapp_template_name strings need to
-- be pre-approved in WhatsApp Business Manager before they'll actually send,
-- same as every other template here.
UPDATE notification_templates
SET channel = 'both',
    whatsapp_template_name = 'leave_submitted_alert',
    whatsapp_param_order = '["student_name","from_date","to_date"]'::jsonb
WHERE school_id IS NULL AND trigger_event = 'student_leave_submitted' AND whatsapp_template_name IS NULL;

UPDATE notification_templates
SET channel = 'both',
    whatsapp_template_name = 'leave_status_update_alert',
    whatsapp_param_order = '["student_name","status","from_date","to_date"]'::jsonb
WHERE school_id IS NULL AND trigger_event = 'student_leave_status_changed' AND whatsapp_template_name IS NULL;

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

-- Item 3 of the Waynur build spec: exam_result was already anticipated in
-- the trigger_event comment above but never seeded until now — publishing an
-- exam (POST /api/exams/:id/publish-result) fires this once per student.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'exam_result', 'both', 'Exam Result Published',
       'exam_result_alert', '["student_name","exam_name","percentage"]'::jsonb,
       'Result published: {{exam_name}}', 'You scored {{percentage}}% in {{exam_name}}.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'exam_result'
);

-- New trigger_event for the shared NotificationService (see notification_templates
-- above) — fired once when the principal's "Add Student" bulk-upsert flow
-- (routes/studentRecords.js) creates a brand-new student and generates a
-- login_id + PIN, so the parent gets the credentials on WhatsApp instead of
-- them only ever appearing in the API response. whatsapp_template_name still
-- needs to be created + approved in WhatsApp Business Manager before this
-- will actually send (same as every other whatsapp_template_name here) —
-- until then notificationService.send() safely no-ops on the WhatsApp leg
-- and only writes the dashboard_notifications row.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'student_credentials', 'both', 'Student Login Credentials Created',
       'student_credentials_alert', '["student_name","login_id","pin"]'::jsonb,
       'Login created for {{student_name}}', 'Login ID: {{login_id}} · PIN: {{pin}} — keep this safe.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'student_credentials'
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

-- ---------- Student Records & Documents ----------
-- Leaving-certificate letterhead/signatory text, configurable per school so a
-- principal can edit it without a code deploy (feature 4.3). One generic PDF
-- layout is shared across schools — only this text is per-tenant.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS leaving_cert_letterhead_text TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS leaving_cert_signatory_name VARCHAR(255);
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS leaving_cert_signatory_designation VARCHAR(255);

-- Generic document/ID-card request queue (features 4.4 and 4.7 share this
-- table). request_type is a free-text VARCHAR rather than an enum so new
-- request kinds (e.g. 'transfer_certificate') can be added later without a
-- migration — the admin queue UI is parameterized by request_type instead of
-- needing a new table + a near-duplicate queue component per type.
CREATE TABLE IF NOT EXISTS document_requests (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    request_type VARCHAR(50) NOT NULL, -- 'leaving_certificate' | 'bonafide' | 'id_card' | ...
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED | READY
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT REFERENCES teachers(id),
    reviewed_at TIMESTAMP,
    review_note TEXT,
    document_url TEXT -- NULL for certs regenerated client-side on demand; set if a real file/data-URL was stored
);
CREATE INDEX IF NOT EXISTS idx_document_requests_school ON document_requests(school_id, request_type, status);
CREATE INDEX IF NOT EXISTS idx_document_requests_student ON document_requests(student_id);

-- Teacher-logged behavioral/academic notes against a student (feature 4.6).
-- created_at doubles as the observation date — no separate date column needed.
CREATE TABLE IF NOT EXISTS student_observations (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    visible_to_student BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_observations_student ON student_observations(student_id);

-- ---------- Academic Evaluation System (AES) — Marks Entry & Report Cards ----------
-- Deliberately separate from generated_tests/test_rubrics/ai_graded_submissions
-- (the AI-assisted OCR test-grading prototype in grading.js/AIGrading.jsx).
-- This is plain manual marks entry per exam/term (e.g. a teacher typing in a
-- student's Mid-Term Maths score) — the two systems are not merged here.
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g. 'Mid-Term 2026'
    term VARCHAR(50),
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exams_school_class ON exams(school_id, class_id);

-- Publish flow (Item 3 of the Waynur build spec) — NULL until the principal
-- publishes once for the whole exam. Marks get entered subject-by-subject
-- over time via POST /:id/marks with no notification; this timestamp is what
-- gates the one-time "result_published" notification fan-out plus the
-- student-portal results list (WHERE result_published_at IS NOT NULL).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS result_published_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS exam_marks (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id),
    marks_obtained NUMERIC(5,2) NOT NULL,
    max_marks NUMERIC(5,2) NOT NULL DEFAULT 100,
    entered_by INT REFERENCES teachers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_marks_exam ON exam_marks(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_marks_student ON exam_marks(student_id);

-- ---------- Fee Structure (Item 5 of the QA fix list) ----------
-- Fixes the Fee Dashboard always showing Rs 0 Expected/Unpaid: student_payment
-- .amount_due (above) is never written by any real route — there was simply
-- no screen to configure an expected fee amount anywhere. This is
-- deliberately ONE amount per class (no per-term/fee-type breakdown), same
-- level of simplicity as student_payment itself (see its "no itemized
-- fee_type breakdown anywhere in the platform yet" comment further up this
-- file) — a real school does have per-term fee schedules, but adding that
-- here would mean inventing an academic-year/term concept this schema
-- doesn't have anywhere else (the closest precedent, exams.term, is just a
-- free-text label, not a structural concept queries rely on). If per-term
-- amounts are needed later, this table is the natural place to add a
-- nullable `term` column.
-- amount_due is intentionally NOT backfilled into student_payment from this
-- table — finance.js's dashboard query joins fee_structures live instead, so
-- the numbers never go stale when a fee amount changes or a student moves
-- classes. amount_due itself is dead going forward but left in place since
-- dropping a column is riskier than just not writing to it.
CREATE TABLE IF NOT EXISTS fee_structures (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_fee_structures_school ON fee_structures(school_id);

-- Item 16 of the QA fix list: petty_cash.requested_by was plain free text
-- with no link to the teachers table at all — hand-typed by whoever (the
-- Accountant/Principal) was logging the request on a staff member's behalf,
-- which is how a typo ("sant" instead of the real name) got saved. Nullable
-- FK added rather than replacing requested_by outright — the text column
-- stays as the display value (now always populated from the resolved
-- teacher's real name server-side, never hand-typed) so every existing
-- reader of petty_cash.requested_by keeps working unchanged.
ALTER TABLE petty_cash ADD COLUMN IF NOT EXISTS requested_by_teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL;

-- ---------- Bus proximity alerts (Item 18 — new feature, not a bug fix) ----------
-- "Notify parent by WhatsApp when the bus is near home." Nullable — most
-- families won't set this immediately, and a student with no home location
-- (or no bus assignment) is simply never checked, never an error.
ALTER TABLE students ADD COLUMN IF NOT EXISTS home_latitude NUMERIC(9,6);
ALTER TABLE students ADD COLUMN IF NOT EXISTS home_longitude NUMERIC(9,6);

-- School-level default "how close counts as near" — same config pattern as
-- petty_cash_accountant_limit above. No per-route override in this MVP
-- (routes/buses have no distinct identity beyond the bus itself — see the
-- direction note on bus_proximity_alerts below).
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS proximity_alert_radius_meters INT NOT NULL DEFAULT 500;

-- Dedup/state table so a lingering-nearby bus doesn't re-notify a parent on
-- every ~30s GPS poll. One row per (bus, student, day, direction) —
-- inserted the first time that combination crosses into radius; a second
-- crossing on the same day+direction hits the UNIQUE constraint and is
-- silently skipped (checkBusProximityAndNotify treats "no row inserted" as
-- "already notified").
--
-- NOTE on `direction`: this schema has no trip/route/session entity at all
-- (checked buses, bus_location_log, student_transport_fees, transport.js,
-- AdminTransport.jsx) — one `buses` row is one physical vehicle with a
-- single free-text route_name, and it does BOTH the morning pickup and
-- afternoon drop-off run; bus_location_log is one continuous GPS stream per
-- bus with no trip-boundary markers. Rather than bolt a static direction
-- onto `buses` (wrong — a bus isn't only ever "pickup" or only "dropoff")
-- or duplicate bus rows per direction (fragments the one real GPS stream
-- across two logical records and touches every existing buses/
-- bus_location_log consumer), direction is derived per GPS ping from time
-- of day (see services/busProximityService.js) and recorded here, on the
-- event/notification record, rather than on the bus. A real production
-- version should replace the time-of-day heuristic with actual configured
-- pickup/drop-off windows once this schema has a real trip concept.
CREATE TABLE IF NOT EXISTS bus_proximity_alerts (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    trip_date DATE NOT NULL,
    direction VARCHAR(10) NOT NULL, -- 'pickup' | 'dropoff'
    notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bus_id, student_id, trip_date, direction)
);
CREATE INDEX IF NOT EXISTS idx_bus_proximity_alerts_school ON bus_proximity_alerts(school_id);

-- New trigger_event for the shared NotificationService (see notification_templates
-- further up this file) — fired by services/busProximityService.js when a
-- bus first crosses into a student's home radius for a given day+direction.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'bus_approaching', 'both', 'Bus Approaching Home',
       'bus_approaching_alert', '["student_name","direction_label"]'::jsonb,
       'Bus approaching', '{{student_name}}''s school bus is near home for {{direction_label}}.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'bus_approaching'
);

-- ---------- Automated fee-payment reminders ----------
-- Converts the "Send payment link" flow (routes/paymentLinks.js,
-- FeeCollectionHub.jsx) from something an accountant has to manually
-- trigger per student into a daily automatic reminder — see the audit in
-- workers/feeReminderWorker.js's header comment for why this was the
-- clearest "should become automatic" candidate at scale (a school can have
-- thousands of students; one accountant clicking Send per unpaid student
-- doesn't scale).
--
-- DEPENDS ON the fee_structures table from the QA fix list's Item 5 (Fee
-- Structure config) — that fix made "expected amount per class" a real,
-- populated value for the first time (previously nothing ever wrote
-- student_payment.amount_due, so there was no reliable source of "what is
-- this student expected to pay" to build an automatic reminder against).
-- This migration only adds new columns/tables of its own; it does not
-- re-create fee_structures — apply the Item 5 migration first if these two
-- pieces of work land in a database separately from each other.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS fee_reminder_grace_days INT NOT NULL DEFAULT 7;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS fee_reminder_interval_days INT NOT NULL DEFAULT 7;

-- One row per reminder actually sent — lets the worker space reminders out
-- (fee_reminder_interval_days apart) instead of re-messaging the same
-- parent every single day. "Stop once paid" needs no separate flag here:
-- the worker's candidate query re-checks the real outstanding balance
-- live on every run, so a student who's paid simply stops matching and
-- naturally drops out — no explicit unsent/cancelled state to manage.
CREATE TABLE IF NOT EXISTS fee_reminder_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    payment_link_id INT REFERENCES fee_payment_links(id) ON DELETE SET NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fee_reminder_log_student ON fee_reminder_log(student_id, sent_at DESC);

-- New trigger_event for the shared NotificationService — a worker-driven
-- send (no human composing anything) so it goes through sendTemplateMessage
-- (an approved Meta template), not the free-form sendTextMessage the manual
-- "Send payment link" flow uses today, since a worker can't assume it's
-- inside an open 24h WhatsApp conversation window with that parent.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'fee_payment_reminder', 'both', 'Fee Payment Reminder',
       'fee_payment_reminder_alert', '["student_name","amount","link_url"]'::jsonb,
       'Fee payment reminder', 'A payment of ₹{{amount}} is due for {{student_name}}. Pay here: {{link_url}}', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'fee_payment_reminder'
);

-- ---------- Automated petty-cash pending reminders ----------
-- Second finding from the same automated-parent-notifications audit:
-- unlike fee reminders, there was no reminder AT ALL (manual or automatic)
-- when a petty cash request sat pending — a principal/accountant only ever
-- found out by opening the Petty Cash tab. Lower volume than fee reminders
-- (one request, not one per student) and self-resolving once seen, so a
-- single one-time nudge is enough — no repeat-spacing log table needed,
-- just a timestamp on the row itself so it's never sent twice.
ALTER TABLE petty_cash ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS petty_cash_reminder_days INT NOT NULL DEFAULT 2;

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'petty_cash_pending_reminder', 'both', 'Petty Cash Pending Reminder',
       'petty_cash_pending_reminder_alert', '["requested_by","amount"]'::jsonb,
       'Petty cash awaiting approval', 'A ₹{{amount}} petty cash request from {{requested_by}} has been pending for a few days.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'petty_cash_pending_reminder'
);

-- ---------- Automated per-student library due-date reminders ----------
-- workers/libraryDueDateWorker.js already ran daily and already sent
-- WhatsApp — but only an AGGREGATE COUNT digest ("3 due soon, 1 overdue")
-- to library_contacts (librarian/staff numbers registered in Settings).
-- No parent and no student ever learned WHICH book, or that it was THEIR
-- child/themselves at all — the per-recipient piece was simply missing,
-- not just unwired. That digest is left as-is (still useful for staff
-- awareness) and this adds the actual per-loan notification on top of it,
-- reusing the same shared NotificationService + dashboard_notifications
-- pattern as every other automated reminder in this file (fee/petty-cash/
-- bus-proximity) — 'student' recipients land in the student portal's
-- existing notification bell (frontend/src/components/StudentShell.jsx's
-- StudentNotificationBell, GET /api/notifications) with zero frontend
-- changes needed, since that feed is already generic.
--
-- last_reminder_sent_at is per-LOAN (not per-day) dedup: a book due
-- tomorrow gets exactly one "due soon" nudge, and once overdue gets nudged
-- again no more than every 3 days (checked in the worker) rather than once
-- for every daily digest run it happens to still be overdue for.
ALTER TABLE library_issues ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMP;

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'library_book_reminder', 'both', 'Library Book Due/Overdue',
       'library_book_reminder_alert', '["book_title","status_label","due_date"]'::jsonb,
       'Library book {{status_label}}', '"{{book_title}}" is {{status_label}} (due {{due_date}}).', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'library_book_reminder'
);

-- ---------- Automated staff-leave pending reminder ----------
-- Third finding from the broader "what else should be autonomous" audit
-- (see SUMMARY.md): routes/staffLeave.js's POST /requests (teacher applies)
-- and PUT /requests/:id (principal approves/rejects) send NO notification
-- at all today, in either direction — confirmed by reading the whole file,
-- not assumed. This adds only the piece the user explicitly asked for
-- (nudge the principal when a request has sat PENDING too long) — same
-- shape as petty_cash_pending_reminder just above (one-time nudge, no
-- batching needed at this volume). A separate, still-open gap: neither
-- approval nor rejection notifies the requesting teacher either — flagged
-- in SUMMARY.md as a related but distinct candidate, not built here to
-- keep this commit scoped to what was actually asked.
ALTER TABLE staff_leave_requests ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS staff_leave_reminder_days INT NOT NULL DEFAULT 2;

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'staff_leave_pending_reminder', 'both', 'Staff Leave Pending Reminder',
       'staff_leave_pending_reminder_alert', '["teacher_name","leave_type","days_count"]'::jsonb,
       'Leave request awaiting approval', '{{teacher_name}}''s {{leave_type}} leave request ({{days_count}} day(s)) has been pending for a few days.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'staff_leave_pending_reminder'
);

-- ---------- Automated "what am I teaching next" reminder for teachers ----------
-- NOTE: there is already a workers/dailyGuidanceWorker.js + GuidanceQueue
-- ("daily what to teach today nudge") — but reading it closely, it is NOT
-- what this feature needs and appears to be effectively dead in practice
-- today: it joins class_subject_teachers.subject_id (an INT, the real
-- subjects.id) to syllabus_calendar.subject_id (a free-text curriculum
-- code like "MATH101" — see SyllabusManager.jsx's own CSV template) via
-- `cst.subject_id::text = sc.subject_id`, which only matches if a school
-- happens to type the literal numeric subjects.id into that free-text
-- field instead of a code, which the UI itself doesn't ask for or expect.
-- That's a pre-existing bug found while reading this code for this
-- feature, left as-is (not what was asked here — flagged in SUMMARY.md).
-- It's also daily, not period-aware, so it wouldn't meet "reminded before
-- MY period starts" even if the join worked.
--
-- Rather than route through syllabus_calendar's unreliable identity, this
-- feature is built on the two properly-typed data sources: timetable_slots
-- (real subjects.id, real start_time/day_of_week) for WHEN + WHAT CLASS,
-- and lesson_plans (also real subjects.id, has plan_date and an optional
-- timetable_slot_id link) for the topic, when a teacher has actually
-- logged one for today. There is no reliable "current chapter" pointer
-- anywhere in this schema that's safe to join automatically — see the
-- syllabus_calendar note above — so when no matching lesson plan exists,
-- the reminder is scoped down to just class + subject + time, with no
-- fabricated chapter name. A real "current chapter per class+subject"
-- pointer (settable by the teacher/principal, keyed on the real
-- subjects.id) is the natural follow-up once this data model gap is
-- addressed on purpose rather than worked around.
--
-- One row per (teacher, timetable_slot, day) so a period only ever
-- triggers one reminder, even though the worker's poll window (next 15
-- min) overlaps across consecutive 10-minute poll runs by design.
CREATE TABLE IF NOT EXISTS teaching_reminder_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    timetable_slot_id INT NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
    class_date DATE NOT NULL,
    notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (teacher_id, timetable_slot_id, class_date)
);
CREATE INDEX IF NOT EXISTS idx_teaching_reminder_log_school ON teaching_reminder_log(school_id);

-- Teachers already receive automated WhatsApp via the shared
-- NotificationService's 'staff' recipient type (teachers.whatsapp_number /
-- whatsapp_opt_in_status — same channel used for petty_cash_pending_reminder
-- and payroll alerts), so this reuses it rather than assuming a new channel.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'upcoming_class_reminder', 'both', 'Upcoming Class Reminder',
       'upcoming_class_alert', '["class_name","subject_name","topic"]'::jsonb,
       'Upcoming class', '{{class_name}} — {{subject_name}} starting soon. {{topic}}', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'upcoming_class_reminder'
);

-- ---------- Staff-leave decision notification (audit candidate #1, built) ----------
-- routes/staffLeave.js's PUT /requests/:id (approve/reject) sent no
-- notification to the requesting teacher in either direction before this
-- — confirmed by reading the route, not assumed. One trigger_event for
-- both outcomes (status is a template variable) rather than two separate
-- events, matching the same "one event, vary content via variables"
-- pattern as library_book_reminder's status_label — DECISION MADE WITHOUT
-- ASKING (see SUMMARY.md's "Decisions made without asking" section): kept
-- as one event instead of splitting into staff_leave_approved /
-- staff_leave_rejected, since a school customizing notification copy would
-- otherwise have to configure two near-identical template rows for what
-- is really one event with two outcomes.
INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'staff_leave_decision', 'both', 'Staff Leave Decision',
       'staff_leave_decision_alert', '["leave_type","status","start_date","end_date"]'::jsonb,
       'Leave request {{status}}', 'Your {{leave_type}} leave request ({{start_date}} to {{end_date}}) has been {{status}}.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'staff_leave_decision'
);

-- ---------- Low-attendance rolling-threshold parent alert (audit candidate #2, built) ----------
-- The existing attendanceWorker.js alert is same-day-absence-only — no
-- rolling "below X% over the last N days" concept existed anywhere before
-- this. The original audit table listed this as needing "a real product
-- decision on the threshold/window" before building. Per the new standing
-- rule (decide sensibly, document, don't block), the following were
-- picked without asking — see SUMMARY.md's "Decisions made without
-- asking":
--   - Default threshold 75% — the common minimum-attendance bar used by
--     Indian CBSE/state-board schools for exam eligibility, so it reads as
--     a real school policy number rather than an arbitrary pick.
--   - Default rolling window 30 days — long enough to smooth over a
--     single bad week (a cold going around a class) without waiting a
--     full term to flag a real pattern.
--   - Minimum 5 recorded attendance days before a student is even
--     considered — a brand-new enrollment with 1-2 days on record
--     shouldn't get flagged off a tiny sample.
--   - Re-notify no more than every half the window (15 days by default)
--     while still below threshold — same "space it out, don't spam"
--     shape as every other reminder built in this round, tuned to the
--     window instead of a fixed separately-configurable interval to keep
--     the settings UI to one card, two numbers.
-- Both the threshold and window are configurable per school in Settings,
-- same pattern as every other reminder timing added this round. Reuses
-- the EXISTING notify_attendance toggle (already wired for the same-day
-- absence alert) rather than adding a second toggle for what is still
-- conceptually "attendance notifications."
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS low_attendance_threshold_percent INT NOT NULL DEFAULT 75;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS low_attendance_window_days INT NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS low_attendance_alert_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    attendance_percent NUMERIC(5,1) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_low_attendance_alert_log_student ON low_attendance_alert_log(student_id, sent_at DESC);

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'low_attendance_alert', 'both', 'Low Attendance Alert',
       'low_attendance_alert', '["student_name","attendance_percent","window_days"]'::jsonb,
       'Low attendance', '{{student_name}}''s attendance over the last {{window_days}} days is {{attendance_percent}}% — below the school''s minimum.', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'low_attendance_alert'
);

-- ---------- Upcoming events/exams reminder to parents (audit candidate #3, built) ----------
-- school_events already has an `audience` field ('all'|'staff'|'students'
-- |'parents') and routes/events.js, but sent nothing on creation or
-- beforehand — confirmed by reading the whole file. Decisions made
-- without asking (see SUMMARY.md):
--   - Default 2 days before event_date — enough notice for a PTM/exam
--     without feeling like spam for a same-week reminder.
--   - Every student in the school is a recipient when audience is 'all'
--     or 'parents' — school_events has no class/grade targeting at all
--     (checked: no class_id column), so "every family" is the only
--     correct scope without inventing a targeting concept that doesn't
--     exist. audience='staff'/'students' events are skipped for this
--     parent-facing reminder — no channel is being built for those here.
--   - Reminds once, before the event's start (event_date) only — a
--     multi-day event's end_date does not get a second reminder, to keep
--     this to one reminder per event rather than a full run-up campaign.
-- One row per event ever sent, not per-day, since this fires once and is
-- done — no repeat-spacing needed, unlike the reminders above.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS event_reminder_days_before INT NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS event_reminder_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    event_id INT NOT NULL REFERENCES school_events(id) ON DELETE CASCADE,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id)
);

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'upcoming_event_reminder', 'both', 'Upcoming Event Reminder',
       'upcoming_event_reminder_alert', '["event_title","event_date","days_before"]'::jsonb,
       'Upcoming: {{event_title}}', '{{event_title}} is coming up on {{event_date}} ({{days_before}} day(s) from now).', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'upcoming_event_reminder'
);

-- ---------- Fix dailyGuidanceWorker.js's dead join (found while building the above) ----------
-- syllabus_calendar.subject_id is a free-text curriculum code (e.g.
-- "MATH101" — see SyllabusManager.jsx's own CSV template), not the real
-- integer subjects.id used everywhere else in this schema
-- (class_subject_teachers, timetable_slots, lesson_plans, exam_marks).
-- workers/dailyGuidanceWorker.js's join
-- (`cst.subject_id::text = sc.subject_id`) compares those two different
-- identity systems and only ever matches by coincidence, making that
-- worker's "what to teach today" nudge effectively dead in practice.
--
-- Fix: add a nullable, properly-typed FK alongside the existing free-text
-- code rather than replacing it — subject_id stays as the display/import
-- value (so the existing CSV import format keeps working unchanged), and
-- subject_ref_id is the new reliable join target once a row is tagged
-- with a real subject. Additive and non-destructive: existing rows get
-- subject_ref_id = NULL and simply don't match the guidance worker's join
-- (the same "doesn't match" behavior they have today) until someone
-- re-saves them via the updated SyllabusManager.jsx form, which now lets
-- a principal optionally pick the real subject. This does NOT retroactively
-- fix historical data — only rows tagged going forward will actually
-- trigger the daily guidance nudge.
ALTER TABLE syllabus_calendar ADD COLUMN IF NOT EXISTS subject_ref_id INT REFERENCES subjects(id) ON DELETE SET NULL;

-- ---------- Weekly class-progress summary for parents (AI roadmap #4, built) ----------
-- Nothing like this existed before — every parent-facing notification in
-- this codebase is single-event (one homework, one exam, one absence),
-- never a rolled-up digest. Decisions made without asking (see SUMMARY.md):
--   - CLASS-level, not per-student — "summarize a class's weekly
--     progress" (the actual ask) reads as one summary per class, and it's
--     far more scalable: one Claude call per class per week instead of
--     one per student (a school with 2,000 students is 2,000 calls/week
--     under a per-student design, ~60-100 under a per-class one). A
--     personalized per-student version is a natural follow-up, not what
--     was asked here.
--   - New notify_weekly_summary toggle, not reusing notify_homework —
--     this covers attendance + homework + exam performance together, not
--     just homework, so folding it into an existing single-domain toggle
--     would be misleading about what it controls.
--   - Sent identically to every parent in the class (same content, not
--     personalized) — same "one message, many recipients" shape as the
--     existing library digest / broadcast composer, not a new pattern.
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS notify_weekly_summary BOOLEAN NOT NULL DEFAULT TRUE;

-- One row per class per week actually sent — prevents a re-run of the
-- same week's job (e.g. after a crash/restart) from sending twice.
CREATE TABLE IF NOT EXISTS weekly_progress_summary_log (
    id SERIAL PRIMARY KEY,
    school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    period VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, period)
);

INSERT INTO notification_templates (school_id, trigger_event, channel, name, whatsapp_template_name, whatsapp_param_order, dashboard_title_template, dashboard_body_template, media_supported)
SELECT NULL, 'weekly_class_progress_summary', 'both', 'Weekly Class Progress Summary',
       'weekly_progress_summary_alert', '["class_name","summary_text"]'::jsonb,
       'This week in {{class_name}}', '{{summary_text}}', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates nt WHERE nt.school_id IS NULL AND nt.trigger_event = 'weekly_class_progress_summary'
);

-- ---------- At-risk flagging: reworked to per-student (AI roadmap #1, revised) ----------
-- The first pass of performanceDriftWorker.js computed class+subject-level
-- snapshots, matching performance_snapshots' pre-existing shape (no
-- student_id column at the time). A follow-up spec explicitly asked for a
-- risk signal PER STUDENT — "a principal/teacher needs to trust and act
-- on it" reads as needing to know WHICH student, not just which class.
-- Added additively: student_id is nullable, so it doesn't retroactively
-- break anything, and a school could in principle have both class-level
-- and student-level rows in history (the worker itself now only writes
-- student-level going forward — see performanceDriftWorker.js).
ALTER TABLE performance_snapshots ADD COLUMN IF NOT EXISTS student_id INT REFERENCES students(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_student ON performance_snapshots(student_id);
