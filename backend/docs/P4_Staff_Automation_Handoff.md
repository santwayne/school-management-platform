# Deploy Handoff: Phase 4, Staff & Admin Automation (backend)

Branch: `feat/p4-staff-automation` (on top of Phase 3)
Spec: `WAYNUR_AUTOMATION_SPEC.md` §5. Four features, one commit each.

## 4a. Automatic teacher substitution (`services/substitutionService.js`)
- **Absent** = approved staff leave, or marked absent by the operator, or (biometric schools, after `substitution_cutoff_time`, default 08:15) has classes today but no punch.
- Each of their periods goes to the best **free** teacher: same subject > already teaches that class > fewest substitutions this week > lighter day. Daily cap `max_substitutions_per_day` (default 2). Deterministic; the reason is stored and shown.
- Runs every 15 min and **immediately when leave is approved** (today + next 7 days). Idempotent.
- Late arrival: a "no punch" teacher who punches in gets their not-yet-started periods back; substitutes are told.
- Substitute gets a dashboard notification + WhatsApp template `substitution_assigned`, with the lesson plan title if one exists. **Unfilled** period gives a high inbox item; filling it manually resolves it.
- API `/api/substitutions`: day board, free candidates, reassign, mark absent, plan now.
- Tested: 5 periods covered correctly; **bug found and fixed**: the daily cap wasn't applied within a run (one teacher got 4). Cap 1 gives an unfilled period, then the inbox, then manual assign, then resolved. Late arrival at 9:00 keeps 8:00/8:40, cancels the rest.

## 4d. Monthly payroll + payslips (`services/payrollService.js`)
- On the 25th, 10 AM IST: draft for every school with salaries. Pay = base + allowances − deductions (fixed or % of base, `salary_components`) − **loss of pay** (base ÷ working days × unapproved absent days; half-day = 0.5). Working days = Mon–Sat minus school holidays (`school_events` type `holiday`).
- Anomalies listed in **one** inbox approval: no salary set, ≥ 5 LOP days, > 10% change vs last month, negative net, missing bank details, attendance not tracked.
- **Only the principal can approve.** Approval writes `teacher_salary_history` (existing Payroll screen's mark-paid flow keeps working), notifies staff (dashboard + template `payslip_ready`). Nothing is paid automatically.
- Payslip PDF (staff can open only their own, only after approval); bank transfer CSV; salary components API. New bank detail columns on `teachers`.
- Tested: Sept 2026 = 25 working days (Dussehra excluded); Rajesh 2 LOP days = ₹2,400; approved leave gives no LOP; operator approve refused; re-prepare after approval refused; PDF checked visually.

## 4c. Certificates (`services/certificateService.js`)
- Bonafide / character: **issued automatically**. Fee certificate: automatically **once dues are zero** (re-checked every 10 min; inbox item auto-resolves). TC: principal one-click approval; **blocked while fees are due**. Other types (ID card): inbox for staff.
- Gap-free serials (`BC/2026/0001`, `TC/2026/0001`…), data frozen at issue, PDF on demand, **public verification** `/api/public/certificates/verify/:code` (for the next school checking a TC), revoke (principal).
- Existing screens keep working: the request becomes `READY` with `document_url = /api/certificates/:id/pdf`. Parent gets template `certificate_ready`. WhatsApp requests (Phase 3) issue instantly.
- School settings needed on the certificate: `principal_name`, `affiliation_number`, `board_name`, `schools.address`.

## 4b. Timetable generator (`services/timetableSolver.js`, `/api/timetable-generator`)
- Inputs: periods per day, working days, period times; per class subject + teacher + periods/week (+ "heavy" to keep out of the last period); teacher unavailability. "Import from current timetable" to start.
- Solver: most-constrained-first placement + local search. **Hard rules never broken** (class/teacher clash, unavailability, max 2 of a subject per day); impossible demand is reported as unplaced, never forced. Same input + seed = same timetable. Capacity checked up front.
- Publish (**principal only**): updates slots **in place** so ids, lesson plans and substitution history survive; removes only slots the new timetable doesn't have; saves the old timetable as a `backup` draft (publishable for rollback); cancels upcoming substitutions on periods whose teacher changed and re-plans today.
- Tested: 10-class / 12-teacher school with 380 lessons gives zero clashes (unit test); API run: 40 lessons, unavailability respected, 5 of 9 old slot ids kept, backup saved.

## WhatsApp templates to submit (Utility, `en`)
| Name | Params | Body |
|---|---|---|
| `substitution_assigned` | teacher, details | Hi {{1}}, you have a substitution today: {{2}}. Please check the Waynur app for details. |
| `payslip_ready` | name, month, net | Hi {{1}}, your payslip for {{2}} is ready. Net pay: {{3}}. You can download it in the Waynur app. |
| `certificate_ready` | child, certificate, serial | The {{2}} for {{1}} (No. {{3}}) is ready. Please collect it from the school office or download it from the student portal. |

## New dependency
`pdfkit` (payslips, certificates). Built-in fonts have no ₹ glyph, so PDFs print "Rs.".

## Env (optional)
`PAYROLL_CRON` (default `0 10 25 * *`, IST), `TIMETABLE_SOLVER_SECONDS` (20), `WHATSAPP_SUBSTITUTION_TEMPLATE`, `WHATSAPP_PAYSLIP_TEMPLATE`, `WHATSAPP_CERTIFICATE_TEMPLATE`.

`npm test`: 40/40 across all phases.

## Known gaps
- **No frontend screens for Phases 2–4 yet** (APIs complete).
- Timetable generation runs inside the HTTP request (time-boxed, 20 s default); fine for a school, move to a worker for very large ones.
- Timetable: no AI "paste your requirements as text" helper yet; no rooms/labs constraint.
- Certificate PDFs are generated on demand, not stored or sent as WhatsApp media (needs S3 + a public link). ID cards stay manual.
- Payroll: no statutory PF/ESI/TDS rules beyond configured components; LOP needs `teacher_attendance_daily` (biometric roll-up).
