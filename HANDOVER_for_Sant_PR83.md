# Handover for Sant — PR #83: AI automation phases 1–2 (Oct 2026)

PR: https://github.com/santwayne/school-management-platform/pull/83
Branch `feat/ai-automation-phase-1-2` (commit `9d31001`), **stacked on PR #81** (`feat/school-system-requirements-ask-ai`). Merge #81 first; GitHub then moves #83 onto `master`. Written by Claude; please review before merging.

Delivers roadmap items **A1** (student early-warning), **B1** (principal's daily plan) and **A2** (parent weekly progress notes) from `AI_Automation_Roadmap.md`. 15 files changed, 12 new. Full design notes: `docs/AI_AUTOMATION_PHASE_1_2.md`.

## 1. How to deploy (EC2)
Do this only after #81 is merged and deployed.
1. Merge #83, then on the EC2: `cd /home/ubuntu/school-management-platform/backend && git pull origin master && npm install && npm run migrate`. All schema changes are additive and re-runnable. They are appended at the end of `backend/models/schema.sql`, which keeps its CRLF line endings.
2. `pm2 restart waynur-backend --update-env`. The new workers run inside the same process; the new queue `AiAutomationQueue` is scheduled at startup.
3. `cd ../frontend && npm install && npm run build` (nginx serves `frontend/dist`).
4. Get the two WhatsApp templates in §5 approved in Meta.
5. Run the staging checklist in §6.

## 2. What was built
| Item | When it runs | Where | Reaches parents? |
|---|---|---|---|
| **A1 Needs attention** | Sunday 9:00 PM IST | Control Center → *Needs attention* (`/ops/attention`); Teacher Portal → *Needs attention* (`/teacher/attention`, class teacher's own class) | No |
| **B1 Today's plan** | Mon–Sat 7:30 AM IST | Card at the top of the Control Center + WhatsApp to the principal/operator digest numbers | No |
| **A2 Parent notes** | Drafts Sunday 9:30 PM IST; sender every 30 min, only sends 8 AM–8 PM IST | Control Center → *Parent notes* (`/ops/progress-notes`); Teacher Portal → *Parent notes* (`/teacher/progress-notes`) | Yes, but only after approval and only with consent |

Rules applied to all three:
- Facts and decisions come from SQL. Claude only words them, and every sentence has a template fallback, so everything also works without `ANTHROPIC_API_KEY`.
- Anything going to a parent needs a person's approval.
- Notes about children are learning-only.

### A1 — early-warning (`services/earlyWarning.js`, scoring in `utils/aiAutomation.js`)
- **Strong signals** (weight 2):
  - attendance under 75% over the last 2 weeks
  - attendance dropped 15+ points vs the 4 weeks before
  - 3+ absences in a row
  - exam average fell 15+ points, or is under 40%
- **Supporting signals** (weight 1):
  - homework under 50% done (with at least 3 shared)
  - 3+ leave requests in 30 days
  - 2+ "finds difficult" items in the AI tutor profile
  - fees overdue 90+ days
- A student is flagged only with at least one strong signal **and** a score of 3 or more.
- **Fees are principal-only context.** They are never shown to teachers, never in the reason text, and never enough on their own to flag a child.
- One inbox item per week with a one-click **Tell the class teachers** action. This sends an in-app notice to staff only.
- Teachers mark each flag *Acted on* (with a note), *False alarm* or *Dismiss*. Re-running the same week never overwrites a decision.

### B1 — daily plan (`services/dailyPlan.js`)
- **Candidates** (all from SQL):
  - urgent/high inbox items and failed automations
  - flagged students
  - notes waiting for approval
  - pending staff/student leave and draft payroll
  - admission enquiries not contacted for 2+ days
  - families with no fee payment for 60+ days
- Claude picks the top 3 and writes a "why" line for each. It can only pick keys from the candidate list; invented ones are ignored.
- **Safe one-tap actions** go into `assistant_actions` with `source = 'daily_plan'`. They are approved from the card or by replying `APPROVE n` on WhatsApp (the existing Ask AI handler). Two kinds exist: re-run a failed automation that is in `RUN_NOW_ALLOWED`, and tell class teachers about flagged students. Nothing that moves money or messages parents.
- `RUN_NOW_ALLOWED` moved from `routes/ops.js` to `services/opsService.js` so the plan can share it. Behaviour is unchanged, plus the four new automations.

### A2 — parent notes (`services/progressNotes.js`)
- **Who gets a draft:** the parent must be WhatsApp `OPTED_IN` **and** have consent recorded in the new `parents.ai_notes_consent`. Consent mode is set per school:
  - *explicit* (default): only parents marked "agreed"
  - *opt-out*: everyone except parents marked "said no"
- **What a note is written from:** this week's attendance, shared homework, **published** results only, teacher notes visible to the student, and the learning profile.
- **Format:** 3–4 sentences, positive first, ending with one 10-minute thing to do at home.
- **Language:** each parent's `preferred_language` (hi/pa/en), or English / Hinglish for everyone.
- **Safety check** on every AI note and every staff edit. It blocks labels (weak, lazy, kamzor, कमज़ोर, ਕਮਜ਼ੋਰ…), links and phone numbers. An unsafe AI note is replaced by the template note.
- **Approval screen:** inline edit, select all, Approve & send / Don't send, and a Consent tab per class.
- **Who approves:** the class teacher (principal can always approve), or principal/operator only — a school setting.
- **Expiry and withdrawal:** drafts expire after 4 days. Marking a parent "said no" withdraws their pending notes at once.
- **Sending:** the sender re-checks opt-in and consent before each send. A send interrupted mid-way is marked *failed* and **never retried automatically**, so a parent never gets a note twice.
- When a school turns notes on, the old class-level weekly summary (`weeklyProgressSummaryWorker`) skips that school. Parents get one weekly message, not two.

## 3. Database changes (all additive)
- New tables: `student_attention_flags`, `principal_daily_plans`, `parent_progress_notes`.
- New columns:
  - `parents.ai_notes_consent`, `ai_notes_consent_at`, `ai_notes_consent_by`
  - `assistant_actions.source`
  - `school_settings.early_warning_enabled` (default on), `daily_plan_enabled` (default on), `progress_notes_enabled` (**default off**), `progress_notes_consent_mode`, `progress_notes_approver`, `progress_notes_language`
- New `notification_templates` row: `parent_progress_note`.
- New `automation_registry` rows: `student_early_warning`, `principal_daily_plan`, `progress_notes_draft`, `progress_notes_send`. All four are allowed for "Run now".

## 4. API
Everything is under `/api/ai-automation` (`routes/aiAutomation.js`).

| Area | Endpoints | Who |
|---|---|---|
| Attention | `GET /attention`, `POST /attention/:id/decision`, `POST /attention/notify-teachers`, `POST /attention/run` | Run and notify: principal/operator |
| Plan | `GET /plan`, `POST /plan/generate`, `POST /plan/items/:key/feedback` | Principal/operator |
| Notes | `GET /notes/classes`, `GET /notes`, `PATCH /notes/:id`, `POST /notes/approve`, `POST /notes/reject`, `GET` + `POST /notes/consent`, `POST /notes/draft-now` | Draft-now: principal/operator |
| Settings & metrics | `GET` + `PUT /settings`, `GET /metrics` | Principal/operator |

- "Check now", "Draft this week now" and plan rebuilds have a 5–10 minute cooldown per school.
- The new approval action is `attention.notify_teachers`. It is in the new `APPROVABLE` set in `assistantTools.js`. Ask AI itself still can only *propose* the old `PROPOSABLE` actions.

## 5. Config
- **WhatsApp templates** to create and get approved in the Waynur WABA (Utility, language `en`). Add `hi`/`pa` later; sends fall back to English automatically.
  - `principal_daily_plan` — `Good morning. Today's plan for {{1}}: {{2}}. Open the Control Center for details.`
  - `student_progress_note` — `Weekly note about {{1}} from school: {{2}} Reply STOP to stop school messages.`
  - Until they are approved, the plan still shows on the Control Center, and notes fail with a clear reason on the approval screen.
- **WhatsApp numbers:** the plan goes to the same principal/operator numbers as the daily report (Control Center → Daily report).
- **Optional env:**

| Variable | Default |
|---|---|
| `AI_AUTOMATION_MODEL` | `ASSISTANT_MODEL`, then `claude-sonnet-5` |
| `EARLY_WARNING_AI_LIMIT` | 60 AI calls per school per run |
| `PROGRESS_NOTES_AI_LIMIT` | 400 |
| `EARLY_WARNING_CRON` | `0 21 * * 0` |
| `DAILY_PLAN_CRON` | `30 7 * * 1-6` |
| `PROGRESS_NOTES_CRON` | `30 21 * * 0` |
| `WHATSAPP_DAILY_PLAN_TEMPLATE` | `principal_daily_plan` |

## 6. Staging checklist
1. **Control Center:** the *Today's plan* card shows. Click *Make today's plan now*, approve an action, and mark an item ✓.
2. **Needs attention:** click *Check now*. Each listed student shows evidence chips; the fee chip says "principal only". Mark one *I acted on it* with a note.
3. **Tell class teachers:** the class teacher sees a bell notice and a *Needs attention* list with only their class and no fee chip.
4. **Parent notes → Settings:** turn notes on and keep consent on "Only parents who agreed". On the *Consent* tab, mark a test parent (your own number) as *Agreed*.
5. **Draft this week now:** check the note's language, and open "What this was written from".
6. **Edit refusal:** edit a note to include "weak"; it must be refused. Make a clean edit, then *Approve & send* between 8 AM and 8 PM. The note should arrive on WhatsApp after `student_progress_note` is approved.
7. **Consent withdrawal:** mark that parent *Said no*. Their pending drafts disappear.
8. **WhatsApp plan:** check the 7:30 AM plan arrives on the principal's WhatsApp. Reply `APPROVE <n>` for an action in it.
9. **Automations:** Control Center → Automations shows the 4 new AI automations running green.

## 7. Tested vs not tested
**Tested:**
- 175 unit tests (16 new): scoring and thresholds, fee privacy, note safety in 4 languages, fallback notes, plan picking.
- Real Postgres 16 + Redis: migration run twice, plus 24 end-to-end checks:
  - school isolation and class-teacher scoping
  - decisions survive re-runs; plan is idempotent
  - approval → teacher notice
  - both consent modes, label refusal, approver setting, send window
  - WhatsApp failure handled cleanly, metrics, weekly-summary skip
- AI path against a stand-in Claude endpoint: clean AI wording is used, an unsafe note is replaced, invented plan items are ignored. A real BullMQ job was recorded by the Control Center.
- Headless Chromium click-through of every new screen: principal and class teacher, desktop and 390px phone width (no sideways scroll).

Testing found and fixed two bugs:
- a Postgres parameter-type error that would have made **every** note send fail
- the same error on the "acted / false alarm" button

**Not tested:** real Claude answers, real WhatsApp/Meta delivery (templates not approved yet), behaviour on real school data volumes.

## 8. Known gaps / decisions to confirm
- **Consent wording** for AI-written notes is still to be decided (roadmap §5.1). Only use "opt-out" if the admission form / privacy policy mentions AI learning notes.
- **Defaults chosen:**
  - approver = class teacher
  - language = each parent's preference
  - early-warning threshold = score 3 with one strong signal
  - Tune these after the first few weeks using the false-alarm rate on the *Needs attention* page.
- **Mixed-language template notes:** learning-profile phrases are stored in English, so *template* notes in Hindi/Punjabi can contain English phrases. AI-written notes translate them.
- **Retention:** profiles and notes are deleted only when the student is deleted. A time-based retention rule (roadmap §5.6) is not built yet.
- **Parent STOP:** a parent replying STOP turns off all school WhatsApp, as before. There is no separate "stop notes only" keyword yet.
- **Next phases** (roadmap §4): C4 voice notes and A4 teacher morning briefing.
