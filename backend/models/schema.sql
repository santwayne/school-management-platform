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
