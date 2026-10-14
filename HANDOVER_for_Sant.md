# Handover for Sant — School Management Platform changes (Oct 2026)

Base: `santwayne/school-management-platform`, `master` at commit `df86a4a`. Everything below is **uncommitted working-tree changes** delivered as a zip — nothing was pushed. 39 files modified, 25 new. Written by Claude; please review before merging.

## 1. How to apply
1. Unzip over a clean checkout of `master` (or unzip into a new folder and `git diff --no-index`).
2. `cd backend && npm install && npm run migrate` (all schema changes are additive and re-runnable; they are appended at the end of `backend/models/schema.sql`, which keeps its CRLF line endings).
3. Set env vars (see §5), restart the app **and the workers** (needs a persistent process, as before).
4. `cd backend && npm test` (159 tests) and `cd frontend && npm install && npm run build`.
5. Smoke-test the checklist in §6 on staging before production.

## 2. The 11 items from *School System Requirements* (all done)
| # | Item | Where |
|---|------|-------|
| 1 | AI grading fixed (robust JSON parsing, token limits scale with question count, 14 MB body limit for `/api/grading`, nginx 16 MB, client-side photo downscale) | `services/ocrGradingService.js`, `routes/premiumAi.js`, `routes/grading.js`, `server.js`, `deploy/nginx-waynur.conf`, `AIGrading.jsx` |
| 2 | WhatsApp fee-slip queue: auto student match, class + dues shown, searchable picker instead of raw ID, amount normalisation | `services/studentMatch.js`, `routes/feeIntake.js`, `routes/whatsapp.js`, `services/aiService.js`, `FeeCollectionHub.jsx` |
| 3 | Role names removed from login (one form: email→staff, Login ID→student) | `Login.jsx` |
| 4 | Already-signed-in users skip login → their dashboard | `Login.jsx` |
| 5 | Teacher payslips (bug: `/my-payslips` was shadowed by `/:id`) | `routes/payrollRuns.js` |
| 6 | Homework & lesson plans: media upload, drafts, **one-time** share, create via WhatsApp (`HOMEWORK 7A Maths: …` / `SHARE HW n`) | `services/teachingMedia.js`, `routes/teachingMedia.js`, `services/homeworkService.js`, `services/lessonPlanService.js`, `services/teacherWhatsapp.js`, `utils/teacherCommand.js`, `TeacherHomework.jsx`, `TeacherLessonPlans.jsx`, `AttachmentField.jsx` |
| 7 | Syllabus-based planning: Exam planner (syllabus → dated lesson plans / homework / tests / revision / mock test) | `utils/studyPlan.js`, `routes/examPlans.js`, `ExamPlanner.jsx` |
| 8 | Complete student profile + private documents/proofs | `services/studentDocuments.js`, `routes/profiles.js`, `StudentProfile.jsx` |
| 9 | Fee structure + paid/unpaid on the profile | `services/studentFees.js`, `StudentProfile.jsx` |
| 10 | Bulk staff import with roles (dry-run, per-row errors, one-time temp passwords) | `utils/staffImport.js`, `routes/academics.js` (`POST /teachers/bulk`), `manage/StaffImportModal.jsx` |
| 11 | Role-based salary structure (+ role-scoped components) | `routes/payroll.js`, `routes/payrollRuns.js`, `services/payrollService.js`, `AdminPayroll.jsx` |

**Assumption to confirm (item 11):** "staff role fee structure" was read as *salary per role*. If it meant fees staff pay for their own children, item 11 needs rework.

## 3. New: AI Assistant ("Ask AI") in the Control Center
- Panel at `/ops/assistant` (Control Center card, operator sidebar, principal tab row). **Principal and operator only.**
- 14 read-only tools over the school's own data (school id always taken from the login, never from the model); drafts documents → branded PDF; can only **propose** actions (`automation.run_now`, `admission.pause_ai`) that need an Approve click and run through `opsService.registerAction`.
- **Brain:** `assistant_memory` (taught/approved facts and policies, viewable/deletable at `/ops/assistant/brain`). Weekly self-review (Mon ~06:00 IST, in-process timer) writes *pending* lessons and improvement ideas; nothing affects answers until a person approves. It never changes code, settings or data on its own.
- **WhatsApp:** principal/operator numbers saved on the staff record can chat with it; `APPROVE n` / `NO n` for actions. Plain teachers and unknown numbers are not served.
- Safeguards: tool results treated as data (prompt-injection guard), 20 msg/min and 200/day per school (`ASSISTANT_DAILY_LIMIT`), every question and approval in the Activity log, conversations private per user.
- Files: `routes/assistant.js`, `services/assistant{Service,Tools,Reflection}.js`, `components/assistant/*`.

## 4. New: Student learning memory (AI tutor "brain")
- `student_learning_profiles` is updated after every ~6 new tutor messages (`services/studentMemory.js`) from the session, teacher observations and exam marks; the tutor reads it at session start (`tutorService.js`, `routes/tutor.js`).
- Staff (principal / class teacher) see and can correct/clear it on the student profile; Ask AI includes it. Students and accountants can't see it. Learning-only by instruction (no family/health/character notes).
- **Before enabling for real children:** confirm the privacy policy / parent consent covers AI-generated learning notes.

## 5. Config
- Required for AI features: `ANTHROPIC_API_KEY`. Optional: `ASSISTANT_MODEL` (default `claude-sonnet-5`), `ASSISTANT_DAILY_LIMIT` (200).
- S3: attachments go under `teaching/<school>/` and must be **publicly readable** (WhatsApp fetches by URL). Student documents are under `waynur/student-docs/` and are **private** (streamed through an authorised endpoint).
- WhatsApp: homework still uses the approved `homework_assigned_alert` template (attachment sent as media after). Lesson-plan shares reach the Student Portal only until a Meta template is approved and set on the `lesson_plan_shared` row of `notification_templates`.
- New DB tables: `exam_syllabus_items`, `exam_plan_items`, `student_documents`, `role_salary_structures`, `assistant_*` (6), `student_learning_profiles`; new columns on `homework`, `lesson_plans`, `exams`, `salary_components`, `tutor_sessions`.

## 6. Staging checklist
1. Login: staff email and student Login ID both work; signed-in user visiting `/login` is redirected.
2. Teacher opens *Payslips* (needs an approved payroll run).
3. Upload an answer-sheet photo in AI Grading; generate a 10-question test.
4. Send a cash-slip photo from a registered collector number; check the queue shows student/class/dues.
5. Create homework with an attachment → draft → *Share with class* (second share must be refused); try `HOMEWORK …` from a teacher's WhatsApp.
6. Exam planner: enter chapters, generate, create a draft.
7. Student profile: upload an ID document, open it, check fee panel, learning panel.
8. Import 3 staff (teacher/accountant/librarian) from the template; download logins.
9. Payroll: set a role salary, confirm a person without a personal salary is paid it.
10. Ask AI: "who owes fees?", "draft a circular…" (PDF), approve an action, thumbs-down an answer, *Run review now*. Repeat one question from the principal's WhatsApp.

## 7. Tested vs not tested
- **Tested:** 159 unit tests (new: study plan, staff import, teacher command parsing, homework attachment rules); an end-to-end smoke test of all new routes against a real Postgres 16 (migration run twice, access control, one-time share races, payroll maths, role salaries, bulk import, assistant tool loop/PDF/approvals/memory/isolation, learning memory, WhatsApp principal path) — the AI itself was replaced by a stand-in. Frontend builds; **screens were not click-tested in a browser**.
- **Not tested:** real Claude answers, real WhatsApp/Meta delivery, real S3 uploads, the AI-grading flow with a real key. Please try these on staging.

## 8. Known gaps / suggestions
- Model name `claude-sonnet-5` is used across the codebase (kept for consistency); confirm it is valid for your key.
- Older automations (substitution, payroll, fee reminders, attendance alerts) remain rule-based; making them AI-assisted should be done one at a time with approval gates.
- Existing items from the earlier handoff docs still open: token-suffix logging in `whatsappService.js`, older jobs using server timezone (set `TZ=Asia/Kolkata`).
- `PROPOSABLE` actions in `assistantTools.js` is intentionally tiny; widen carefully (nothing that messages parents or moves money).
- Line endings: `schema.sql`, `academics.js`, `payroll*.js`, `api.js`, `AdminPayroll.jsx`, `TeacherPortal.jsx`, `AdminShell.jsx`, `StudentProfile.jsx` are CRLF in the repo and were kept CRLF.

More detail per item: `CHANGES_School_System_Requirements.md`.
