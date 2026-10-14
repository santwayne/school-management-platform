# School System Requirements — what changed

Covers the 11 items in `School_System_Requirements.pdf`. Run `npm run migrate` in `backend/` after deploying (new tables/columns are additive and safe to re-run).

| # | Item | What was done |
|---|------|---------------|
| 1 | AI grading | Model replies are now parsed robustly (fenced/prosey JSON no longer breaks grading); generated-test `max_tokens` scales with question count (was a fixed 1200, truncating larger tests); scores/marks coerced to numbers; grading uploads get a 14 MB body limit (was 8 MB, rejecting phone photos) and photos are downscaled in the browser; nginx limit raised to 16 MB; real error text shown instead of a generic failure. |
| 2 | WhatsApp queue | Slips are now auto-matched to a student (exact login/admission no. or a unique name) when they arrive; the queue shows the student's name, class and what they owe, and a searchable student picker replaces typing a raw database ID. Slip amounts like "₹1,500" are normalised (previously they could fail or store wrongly). |
| 3 | Login page | Role tabs removed. One form: an email signs in staff, anything else is treated as a student Login ID + PIN. Everyone is redirected to their own dashboard by role. |
| 4 | Session handling | Visiting `/login` while signed in goes straight to the user's dashboard. |
| 5 | Teacher payslips | Bug: `/api/payroll-runs/my-payslips` was shadowed by `/:id` (manager-only), so teachers got 403. Route order fixed. |
| 6 | Homework & lesson plans | Photo/document upload (JPG, PNG, WebP, PDF, Word, PowerPoint, Excel, 15 MB); save as draft or share on creation; **one-time** "Share with class" (atomic latch, concurrent calls tested); teachers can also create by WhatsApp (`HOMEWORK 7A Maths: title` + optional attachment, then `SHARE HW <n>`; same for `LESSON PLAN` / `SHARE LP <n>`); students see homework attachments. |
| 7 | Syllabus-based planning | New **Exam planner**: per-exam syllabus (chapters + weights, can import from the Syllabus page) split by date into lesson plans, homework, chapter tests, revision and a final mock test (Sundays skipped). Plan rows become draft homework / lesson plans in one click. |
| 8 | Complete student profile | Profile now shows admission no., login ID, address, parents, **documents & proofs** (private storage, streamed through an authorised endpoint, 8 MB JPG/PNG/WebP/PDF), fees; linked from the student list. Also fixed: any logged-in user could edit any student's profile — now only the principal or the class teacher can. |
| 9 | Fee structure & status | Profile shows the class fee structure, paid, unpaid, transport months and this year's payments. |
| 10 | Bulk staff import | **Manage School → Staff → Import staff**: CSV/Excel with name, email, phone, role (+ optional password), validated first (dry run), per-row errors, generated temporary passwords downloadable once. |
| 11 | Role-based salary structure | Salaries tab: one base salary per role; a personal salary overrides it; allowances/deductions can target a whole role. Used by Payroll Runs and the flat payroll run. Assumes "staff role fee structure" = salary per role (see note in the PDF — please confirm). |

## Things to set up / know
- **S3**: homework/lesson-plan attachments are stored under `teaching/<school>/` and must be publicly readable (WhatsApp fetches them by URL). Student documents are stored privately under `waynur/student-docs/` and need no public access.
- **WhatsApp**: homework still goes out via the approved `homework_assigned_alert` template, with the attachment sent as a media message after it. Lesson-plan shares go to the Student Portal only until a WhatsApp template is approved on Meta and set on the `lesson_plan_shared` row in `notification_templates`. Teacher-originated WhatsApp commands need the teacher's number saved on their staff record.
- AI grading could not be run end-to-end here (needs an Anthropic key); all other backend changes were exercised against a real Postgres 16 with an end-to-end smoke test, plus 159 unit tests passing.

---

# AI Assistant for principal & operator (added later)

It is a panel of the Control Center: open **Ask AI** in the Control Center sidebar (operator) or tab row (principal), `/ops/assistant`. Principal and operator only.

- **Conversation with the whole software.** Claude answers from the school's own records through 14 read-only tools (students & full overview, fee defaulters, fee collection, attendance, staff, payroll, exam results, admissions, Control Center status, certificates / document requests / leave / events / homework). The school is always the caller's own; the model never writes SQL or picks a school.
- **Documents.** It drafts circulars, notices, letters and reports and saves them as school-branded PDFs (Download button under the answer).
- **Acts only with approval.** It can only *propose* actions (currently `automation.run_now` and `admission.pause_ai`); each waits for an Approve click and runs through the existing whitelisted action registry. Payroll approval, messaging parents and anything touching money are deliberately not proposable.
- **Brain.** `assistant_memory`: things you tell it to remember (policies, preferences). Review, add or forget them under *Assistant memory & ideas*. Personal data about individual students/parents is never to be stored.
- **Improves over time, safely.** Thumbs up/down on answers, plus a weekly review (Mondays ~6 AM IST, or "Run review now") over feedback, questions it couldn't answer, recurring Control Center problems and failing automations. It writes *lessons* (pending until you approve them — only approved ones affect future answers) and *ideas for the Waynur team* (accept/dismiss). It never changes code, settings or data on its own.
- **Safeguards.** Tool results are treated as data, never instructions (prompt-injection guard); answers cite only looked-up data; 20 messages/min and 200/day per school (`ASSISTANT_DAILY_LIMIT`); every question and approved action is written to the Activity log; conversations are private to each user.
- **Setup.** Needs `ANTHROPIC_API_KEY`; optional `ASSISTANT_MODEL` (default `claude-sonnet-5`). Run `npm run migrate`.
- **Testing.** Exercised end-to-end against Postgres 16 with a stand-in for the AI (tool loop, PDF, approvals, memory, isolation, weekly review). Real answer quality with a live key has not been tested — try it with a few real questions first.

## Honest limits
- "Self-improving" means learning from feedback and proposing improvements for people to approve — it cannot rewrite the software.
- The deterministic automations (substitution, payroll, fee reminders, attendance alerts) are unchanged; making more of them AI-driven is a next step, best done one at a time with approval gates.

---

# Round 3: Ask AI on the Control Center home, WhatsApp access, student learning memory

- **Ask AI card** at the top of the Control Center overview, plus the "Ask AI" panel/tab.
- **Principal / operator on WhatsApp.** Message the school's WhatsApp number from the phone saved on your staff record (Manage School → Staff → WhatsApp number). Anything that isn't a homework command goes to the same assistant; replies are short. Approvals: reply `APPROVE <n>` / `NO <n>`. Documents are saved and downloaded as PDF from the Ask AI panel. Unregistered numbers and plain teachers are not served. Only principal and operator get this.
- **Student learning memory ("the tutor's brain").** After every ~6 new tutoring messages the AI merges what the session shows (plus teacher observations and exam marks) into a per-student learning profile: summary, strengths, what they find difficult, interests, how they learn, what would help next. The tutor reads it at the start of every session (builds on strengths, uses their interests, never recites the notes). Teachers/principal see it on the student profile ("What the AI tutor knows"), can correct it or clear it; Ask AI includes it in a student overview. Learning-related only — the builder is instructed not to record family, health, religion or character judgements. Students cannot see the staff view; accountants cannot see it.
- New table `student_learning_profiles`, column `tutor_sessions.memory_reviewed_len`; run `npm run migrate`.
- Please check your privacy policy / parent consent covers AI-generated learning notes about students before switching this on for real children.
