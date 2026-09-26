# Waynur Implementation Audit
Generated 2026-09-25 against `santwayne/school-management-platform`, branch `master` (commit `2801450`), cross-referenced with `Waynur_Complete_Feature_Guide.pdf`.

## 0. Branch/PR integrity finding (read this first)

PRs #30, #31, #32 (Phases 2, 3, 4) were each opened with their **base set to the previous feature branch instead of `master`**:

| PR | Feature | Base | Merged into master? |
|---|---|---|---|
| #29 | Phase 1: Operator Control Center | `master` | Yes |
| #30 | Phase 2: Admissions Automation | `feat/p1-operator-control-center` | **No** |
| #31 | Phase 3: Parent WhatsApp Assistant | `feat/p2-admission-automation` | **No** |
| #32 | Phase 4: Staff Automation | `feat/p3-parent-assistant` | **No** |

Result: Phases 2-4 were "merged" (into each other) but never reached `master`/production. A local test merge of `feat/p4-staff-automation` (which contains all of phases 2+3+4 stacked on phase 1) into `master` completed cleanly with **zero conflicts** — it just needs a PR opened with `base: master`, `compare: feat/p4-staff-automation`.

Compare/PR link: https://github.com/santwayne/school-management-platform/compare/master...feat/p4-staff-automation?expand=1

(PR creation was attempted from this session but failed — the logged-in GitHub account, `arpanwayne`, is not a collaborator on the repo. User will open/merge this PR directly.)

## 1. Priority 1 — Core

| Feature | PDF Requirement | Existing Code | Existing API | Existing DB | Existing UI | Status | Missing Work |
|---|---|---|---|---|---|---|---|
| School onboarding | Classes, sections, subjects, staff, students uploaded in bulk at setup | `backend/routes/onboarding.js`, `frontend/src/components/Onboarding.jsx` (6-step wizard) | `POST /onboarding/*` (school+principal+classes only) | `schools`, `school_settings`, `teachers`, `classes` | Onboarding.jsx wizard | **PARTIAL** | Wizard only creates school/principal/classes. Subjects, staff, students, parents must be added post-login via `academics.js` / `studentRecords.js` (bulk upsert exists there, just not part of onboarding flow). No modeled "sections" entity — just a `classes.section` column. |
| RBAC | Role-based access per screen | `backend/middleware/auth.js` (7 roles) | Enforced on all audited route files | Role column on `teachers`/JWT claim | `ProtectedRoute.jsx` | **DONE** | None found. No dedicated "change role" endpoint, but not required by spec. |
| Refresh token | (implicit — session security) | — | `auth.js` issues single 12h JWT only | No refresh-token table | — | **MISSING** | No refresh endpoint, no refresh-token storage anywhere in `backend/`. Sessions expire hard at 12h, forcing re-login. Needs: refresh-token table (hashed, revocable), `/auth/refresh` endpoint, rotation on use, frontend silent-refresh handling. |
| Audit logs | "Every automated message and every staff action is logged with time and person" | `audit_log` table + `opsService.audit()` | Called from `ops.js`, `attendance.js`, `dailyDigestWorker.js` | `audit_log` table (real) | Activity log (Ops Control Center) | **PARTIAL** | Not called from `payroll.js` (run/mark-paid), `studentRecords.js` (document/TC/certificate approval), `academics.js` (staff creation, role assignment, student/parent edits). Spec claim is currently false outside the Ops surface. |
| Parent data isolation | "Every parent answer is looked up for that parent's children only" | `whatsapp.js` (phone→parent_id lookup, all queries scoped by `parent_id`), `studentPortal.js` (scoped by `req.user.student_id` from JWT, not request param) | Real server-side scoping, not UI-only | `parents`, `students.parent_id` | N/A (WhatsApp-only for parents) | **DONE** (for what's in master) | Full fee/homework/attendance/bus WhatsApp query set is implemented but currently branch-only (`feat/p3-parent-assistant`) — will land once Phase 3 is merged (see §0). |

## 2. Priority 2 — Operator Control Center (already in master via PR #29)

| Feature | Status | Evidence |
|---|---|---|
| Unified action inbox | **DONE** | `ops.js` (`GET/POST /exceptions/*`), `ops_exceptions` table w/ dedupe index, `ExceptionInbox.jsx` |
| Automation health monitoring | **DONE** | `workers/healthCheck.js` (Postgres/Redis/WhatsApp/Anthropic/Razorpay/Vapi/S3/GPS/biometric checks every 10 min), `integration_health` table, `OpsOverview.jsx` |
| Morning report | **DONE** | `workers/dailyDigestWorker.js`, cron `0 8 * * *` Asia/Kolkata, real SQL facts + AI wording with "never invent a number" guard, template fallback |
| Failure/recovery monitoring | **DONE** | `healthCheck.js checkStaleAutomations()` + `autoResolve()`, `automation_runs` table |

## 3. Priority 3/4/5 — MERGED into master (PR #33, commit 01cd0f1) and deep-audited

**Update 2026-09-25:** PR #33 merged cleanly (one trivial import-line conflict, resolved). A full deep-dive (not just file-existence check) was then run against the real code. Verdict: **all three feature areas are genuinely implemented** — real DB writes, real WhatsApp Graph API calls, real Claude calls, real PDF generation, principal-gated approvals, transactional integrity (row locks on money/seats/serial numbers). **Zero FAKE/hardcoded-success findings.** All new route files confirmed mounted in `server.js` and reachable from routed frontend pages — no orphaned/dead code.

### Priority 4 — Admissions Autopilot: 10/11 DONE, 1 PARTIAL
One-question-at-a-time flow, fees quoted only from `fee_structures` (never invented), answers scoped to `school_knowledge_base`, campus visit booking (atomic seat-taking), 24h/2h reminders, day 1/3/7 follow-ups, website enquiry form, pipeline view, one-click "Admit" (transactional, seat-capacity checked) — all **DONE** with file:line evidence in `admissionAgent.js`/`routes/admissions.js`/`admissionFollowupWorker.js`.
**PARTIAL:** "replies in family's language" — Punjabi has no dedicated copy, silently falls back to Hindi (`admissionAgent.js:148`).

### Priority 3 — Parent WhatsApp Assistant: 12/12 DONE
Every query family (fees, homework, attendance, bus location via real haversine calc, leave request, certificate request, results, holidays) scoped strictly to that parent's own children via `parent_id`/`student_id` from the DB lookup — no cross-family query exists anywhere in `parentAssistant.js`. Safety messages (bullying/violence) hit a keyword+AI-classifier gate and are **never** AI-answered — only a fixed canned reply + mandatory critical exception to the principal. Staff takeover implemented and enforced (`human_takeover_until` check). Real WhatsApp Graph API and real Anthropic API calls confirmed, both with proper error handling (no silent failures).

### Priority 5 — Staff Automation: all sub-capabilities DONE
- **Substitution**: 8:15 cutoff, same-subject-first/same-class ranking, daily fairness cap, late-arrival period restoration, idempotent via unique index — all DONE, unit-tested.
- **Timetable**: zero-clash solver with independent re-validation before publish, principal-only publish, old timetable kept as rollback snapshot, stale substitutions auto-replanned on publish — all DONE.
- **Payroll**: 25th auto-draft cron, real leave/attendance-based deductions, principal-approval gate, payslips delivered on approval, bank CSV for accountant, **confirmed no automatic money movement anywhere in the code**.
- **Certificates**: bonafide/character auto-issue, fee certificate only at zero dues, TC requires principal approval AND is blocked while fees are due, gap-free serial numbers (`TC/2026/0001` via row-locked counter), verification code + public verify endpoint, principal-only revocation — all DONE.

**Cross-cutting PARTIAL (all 3 areas):** test coverage is unit-tests-only for pure helper/decision functions (grade parsing, scoring, date math). No integration tests exercise the DB-backed orchestration functions end-to-end (`handleEnquiryMessage`, `handleParentMessage`, `planSubstitutions`, `preparePayroll`, `issueCertificate`, timetable publish). Recommend adding these before/alongside any further changes to this code, per the task's own "Add tests" rule.

## 4. Priority 6 — Transport / Biometric (master)

All **DONE**: Bus GPS (`routes/transport.js`, vendor-agnostic `gpsAdapters/`, `workers/gpsPollWorker.js`, proximity alerts), Biometric (`routes/biometric.js`, webhook + CSV import, `biometricAdapters/`), Transport fees, Driver payouts (real haversine GPS-distance calc in `transportPayoutService.js`), Route profitability (`GET /route-profitability`).

## 5. Priority 7 — Student Portal (master)

**DONE**: Exams/report cards, homework/notes/attendance/progress/rewards (all scoped by JWT `student_id`), leave/certificate requests, events, syllabus tracking.
**MISSING**: Student-facing library view — `library.js` exists but is gated `requireLibrary` (staff-only); no student endpoint or page to see their own issued books.

## 6. Priority 8 — AI Grading / Tutor (master)

- OCR grading: **DONE** — real Claude vision call in `ocrGradingService.js`, confidence-based flagging, no fake success paths.
- Rubric authoring: **PARTIAL** — rubrics are AI-generated during test creation; no manual CRUD endpoint for a teacher to hand-edit a rubric independent of generation.
- Multilingual AI tutor: **DONE** — `tutorService.js`, genuine multi-turn Socratic prompting, Hindi/Punjabi/English, errors propagate rather than being masked.

---

## Recommended next steps (Priority 1 gap closure)
1. ~~Merge `feat/p4-staff-automation` → `master`~~ — **done**, see §0/§3.
2. ~~Add refresh-token flow~~ — **done**, see §7 below.
3. ~~Extend `audit()` calls into `payroll.js`, `studentRecords.js`, `academics.js`~~ — **done**, see §7 below.
4. ~~Extend onboarding to cover subjects/staff/students/parents~~ — **done differently than first proposed**, see §7 below (a post-login checklist reusing existing screens, not new pre-approval wizard steps).
5. Add student-facing library endpoints/page (Priority 7 gap, cheap fix, listed here since it's adjacent to Priority 1's "every role sees what they need" principle). **Still open.**

---

## 7. Priority 1 gap closure — implementation report (2026-09-25)

### Implemented
- **Refresh tokens.** New `refresh_tokens` table (hashed, rotating, 30-day TTL). `POST /api/auth/refresh` re-derives the JWT payload from a live DB read (so a role change or account deletion takes effect on the very next refresh, not just the next full login) and rotates the refresh token so a replayed old one stops working immediately. `POST /api/auth/logout` revokes it. Wired into all three login flows (teacher/principal, student, super admin) and into the frontend's `apiRequest`/`apiUpload` (`frontend/src/api.js`): a 401 now attempts one silent refresh-and-retry, with concurrent 401s sharing a single in-flight refresh call, before falling back to the existing hard-redirect-to-login.
- **Audit log coverage.** Reused the existing `audit()` helper from `services/opsService.js` (previously only called from the Ops Control Center surface) and added calls for: staff created/edited/deleted, student deleted, parent deleted (`routes/academics.js`); document-request review/approval — covers bonafide/TC/character-certificate manual approvals (`routes/studentRecords.js`); legacy payroll run + mark-paid (`routes/payroll.js` — the newer `payrollRuns.js`/`payrollService.js` flow already had `payroll.approved` audited from Phase 4, confirmed during this pass).
- **Onboarding completion.** Investigated extending the actual signup wizard first, but it's deliberately public/unauthenticated and the school stays `status='pending'` until a super admin activates it — there's no real session to attach a staff/student roster to at that point, and building one would mean either inventing pre-auth data-entry endpoints or duplicating the existing authenticated CRUD. Instead: a new `SetupChecklist` component on the principal's `/dashboard` checks live counts (via the *existing* `GET /api/academics/{classes,subjects,teachers,students,parents}` endpoints — no new backend code needed for this piece) and links straight to the right tab on the *existing* Manage School page (`ManageSchool.jsx`, which already has working Classes/Staff/Students/Parents CRUD) for whatever's still empty. `ManageSchool.jsx` gained a `?tab=` query param so those links land on the right tab instead of always defaulting to Classes. The checklist disappears once every category has at least one row, and can be dismissed early.

### Partially Implemented
- None for this phase — all three targeted gaps got a working end-to-end fix.

### Still Missing
- Student-facing library view (Priority 7 gap, not part of Priority 1, noted above).
- Punjabi copy in the Admissions assistant (Priority 4 gap, noted in §3).
- Manual rubric-authoring UI (Priority 8 gap, noted in README).
- DB-integration tests for the Phase 2-4 orchestration functions (noted in §3).

### Files Changed
- Backend: `models/schema.sql`, `routes/auth.js`, `routes/superAdmin.js`, `routes/academics.js`, `routes/payroll.js`, `routes/studentRecords.js`, new `services/refreshTokenService.js`, new `tests/refreshToken.test.js`.
- Frontend: `src/api.js`, `src/AuthContext.jsx`, `src/components/AdminHome.jsx`, `src/components/ManageSchool.jsx`, new `src/components/SetupChecklist.jsx`.
- Docs: `README.md` (known-gaps section corrected and updated).

### Database Changes
- New table `refresh_tokens` (subject_type, subject_id, school_id, token_hash, expires_at, revoked_at) + index on (subject_type, subject_id). Additive only, via the existing `schema.sql` + `scripts/migrate.js` idempotent-migration convention — no existing table altered, nothing to backfill.

### API Changes
- New: `POST /api/auth/refresh`, `POST /api/auth/logout`.
- Changed response shape (additive field only): `POST /api/auth/login`, `POST /api/auth/student-login`, `POST /api/super-admin/login` now also return `refreshToken` alongside the existing `token`/`user` fields — existing callers that ignore the new field are unaffected.
- No breaking changes to any existing endpoint's request/response contract.

### Frontend Changes
- `apiRequest`/`apiUpload` transparently retry once after a silent token refresh on 401, instead of immediately redirecting to `/login`.
- Login/logout now also manage a `refreshToken` in `localStorage`; logout best-effort-revokes it server-side.
- New Setup Checklist card on the principal dashboard (`/dashboard`), linking into `ManageSchool.jsx` which now supports `?tab=` deep-linking.

### Tests
- `backend/tests/refreshToken.test.js` — 4 new tests covering the token-hashing helper (deterministic, one-way, collision-free across inputs) and raw-token entropy/uniqueness. Pure-function tests only, matching this repo's existing convention of not requiring a live DB connection inside `node --test`.
- Full existing suite re-run after every edit in this phase: **44/44 passing**, no regressions.
- Frontend production build (`npm run build`) verified clean after each frontend change.

### Environment Variables Required
- None. Refresh tokens reuse the existing `JWT_SECRET` and `DATABASE_URL` — no new configuration to set on any environment.

---

## 8. Five additional gaps closed (2026-09-26)

User-identified gaps (matched exactly against the code, all confirmed genuinely missing before this phase):

### Implemented

1. **Teacher "My Payslips"** — `GET /api/payroll-runs/my-payslips` (own approved payslips only) + `MyPayslips.jsx`, linked from the Teacher Portal header (`/teacher/payslips`). While building this, found and fixed a **pre-existing bug**: the payslip/certificate/bank-CSV download links used plain `<a href>` to authenticated endpoints — browser navigation never sends the stored Bearer token, so every one of those three download buttons (`AdminPayroll.jsx` ×2, `IssuedCertificates.jsx` ×1) was silently 401ing. Added `apiDownload()` to `api.js` (authenticated fetch → blob → save), used everywhere a PDF/CSV is downloaded now, including the new My Payslips button.

2. **Certificates: real PDF delivery, not just a text ping.** `issueCertificate()` now renders the certificate PDF once at issuance (refactored the existing renderer out of the on-demand `/pdf` route so both share one implementation), uploads it to S3 (same bucket/client `routes/profiles.js` already uses), and — best-effort, alongside the existing template notification — sends the actual file to the parent via `sendMediaMessage`. New `issued_certificates.pdf_url` column. A missing AWS config or a closed 24h WhatsApp window degrade gracefully to "notification only," exactly as before; issuance itself can never fail because of this.

3. **Payroll: real PF/ESI, honest about TDS.** `computePay()` gained `pfEnabled`/`esiEnabled` flags applying the actual statutory formulas (PF: 12% of basic capped at the ₹15,000 wage ceiling; ESI: 0.75% of gross, only below the ₹21,000 eligibility ceiling — above it, out of the scheme entirely). Off by default (`school_settings.pf_enabled`/`esi_enabled`), toggled from a new card in Admin → Payroll → Salary Components, with `PATCH /api/settings/payroll-deductions` (audited). **TDS is deliberately NOT auto-calculated** — it needs each employee's projected annual income and declarations, which this system doesn't collect; the UI now says so explicitly and points to the existing manual fixed-deduction mechanism instead of pretending to compute it.

4. **Timetable: room/lab constraint + AI-drafted requirements.**
   - `timetableSolver.js` gained an optional `room_id` per requirement, treated as a hard constraint exactly like teacher double-booking (a room can never host two classes in the same period) — purely additive, a requirement with no room is scheduled exactly as before. New `rooms` table + CRUD (`GET/POST/DELETE /api/timetable-generator/rooms`), `room_id` flows through `timetable_requirements` → solver → `timetable_drafts` → published `timetable_slots`. `hardViolations()` now also catches a room clash.
   - New `POST /api/timetable-generator/parse-requirements-text`: paste freeform notes, Claude drafts structured requirement rows — constrained to only ever pick ids from this school's real classes/subjects/teachers/rooms (given to it in the prompt); anything it can't confidently match comes back null with the original text, highlighted amber in the UI for a human to fix before saving. Never auto-saves — always lands in the same editable table as manually-added rows.
   - Also fixed a **pre-existing bug** found while extending the draft table: `DraftDetail`'s preview used `s.day_of_week`/`s.period_number`, but a draft's slots (from `solveTimetable()`'s own output, confirmed by tracing both the fresh-generate and backup-snapshot code paths) are always shaped `{day, period, ...}` — so Day/Period were rendering blank for every draft. Fixed to the correct field names while adding the new Room column.

5. **Admissions: online application fee payment.** Reuses the exact same Razorpay payment-link mechanism `routes/paymentLinks.js` already uses for student fees (a hosted checkout page sent via WhatsApp — not a redundant custom checkout UI). New `admission_payment_links` table (mirrors `fee_payment_links`, keyed to an enquiry since no student row exists yet at application stage) and `school_settings.admission_fee_amount`. `POST /api/admissions/enquiries/:id/request-payment` creates the link and sends it (`sendEnquiryText`, so it's logged in the same conversation thread the rest of the enquiry uses). The **existing** Razorpay webhook was extended (not duplicated) to also recognize `waynur-admission-*` reference ids, mark the link paid, and auto-advance the enquiry to the `applied` stage (only forward — never pulls back a lead that's already further along). `EnquiryDetail.jsx` shows payment status and a "Request application fee" / "Resend" button.

### Partially Implemented
- None — all five gaps got a working, end-to-end, non-fake fix.

### Still Missing
- Nothing new surfaced beyond what §3/§7 already listed (Punjabi copy, manual rubric authoring, integration-test coverage, student-facing library view).

### Files Changed
- Backend: `routes/payrollRuns.js`, `routes/settings.js`, `routes/timetableGenerator.js`, `routes/admissions.js`, `routes/paymentLinks.js`, `services/certificateService.js`, `services/payrollService.js`, `services/timetableSolver.js`, `tests/payroll.test.js`, `tests/timetable.test.js`.
- Frontend: `src/api.js`, `src/App.jsx`, new `src/components/MyPayslips.jsx`, `src/components/AdminPayroll.jsx`, `src/components/IssuedCertificates.jsx`, `src/components/TeacherPortal.jsx`, `src/components/staff/TimetableGenerator.jsx`, `src/components/admissions/AdmissionSettings.jsx`, `src/components/admissions/EnquiryDetail.jsx`.

### Database Changes
All additive (`CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`), via the existing `schema.sql` + `scripts/migrate.js` convention:
- `issued_certificates.pdf_url`
- `school_settings.pf_enabled`, `esi_enabled`, `admission_fee_amount`
- `rooms` table; `timetable_requirements.room_id`, `timetable_slots.room_id`
- `admission_payment_links` table

### API Changes
- New: `GET /api/payroll-runs/my-payslips`; `PATCH /api/settings/payroll-deductions`; `GET/POST/DELETE /api/timetable-generator/rooms`; `POST /api/timetable-generator/parse-requirements-text`; `POST /api/admissions/enquiries/:id/request-payment`.
- Changed (additive fields only, no breaking changes): `issueCertificate()`'s return now includes `pdf_url`; `GET /api/admissions/enquiries/:id` now includes a `payment` object; `GET /api/admissions/settings` now includes `admission_fee_amount`; timetable requirements/drafts/slots payloads now include `room_id`.

### Frontend Changes
- Fixed the authenticated-download bug across every PDF/CSV download button in the app (see item 1).
- New Teacher Portal page (My Payslips) and its header link.
- New Rooms manager + AI "paste requirements" panel in the timetable Setup tab; Room column in the draft preview.
- New Statutory Deductions toggle card in Payroll settings.
- New application-fee settings field and per-enquiry payment status/request UI in Admissions.

### Tests
- `tests/payroll.test.js`: +5 tests for PF/ESI (off-by-default, wage-ceiling cap, eligibility-ceiling cutoff, stacking with LOP).
- `tests/timetable.test.js`: +3 tests for the room constraint (never double-booked under real demand, no-room-id is unconstrained, `hardViolations` catches a room clash).
- Full suite re-run after every edit in this phase: **51/51 passing**, no regressions.
- Frontend production build verified clean after every frontend change.
- Certificate S3/WhatsApp delivery, admission payment-link creation, and the AI requirements parser are DB/external-API-dependent and follow this repo's existing convention of not being unit-tested directly (same as `createPaymentLinkRecord`, `sendTemplateMessage`, etc.) — their pure/testable logic (PF/ESI math, room constraint, token hashing) is what's covered above.

### Environment Variables Required
- None new. Everything reuses already-documented `.env.example` variables: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`/`AWS_S3_BUCKET` (certificates), `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (admission fee links), `ANTHROPIC_API_KEY` (timetable AI parsing). If any of these are unset in a given environment, the affected feature fails with a clear error at request time rather than pretending to succeed — never silently faked.
