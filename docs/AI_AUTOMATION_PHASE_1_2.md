# AI automation roadmap — phases 1 & 2 (handover)

Built on top of PR #81 (Ask AI + student learning memory). Covers roadmap items **A1 early-warning**, **B1 principal's daily plan** and **A2 parent weekly progress notes**. Written by Claude; please review before merging.

## What it does

| Item | When | Who sees it | Sends to parents? |
|---|---|---|---|
| **A1 Needs attention** | Sunday 9:00 PM IST | Principal/operator: all classes (+ fee context). Class teacher: own class, from the Teacher Portal | No |
| **B1 Today's plan** | Mon–Sat 7:30 AM IST | Principal/operator: Control Center card + WhatsApp | No |
| **A2 Parent notes** | Drafts Sunday 9:30 PM IST; approved notes sent every 30 min between 8 AM and 8 PM IST | Approval screen: class teacher (own class) or principal/operator | Yes — only after approval, only with consent |

All three follow the roadmap's rules: the decision and every number come from SQL; Claude only phrases (with a template fallback for every sentence); anything to parents needs a person's approval; notes about children stay learning-only.

### A1 — early-warning (`services/earlyWarning.js`, scoring in `utils/aiAutomation.js`)
- Signals per student: attendance last 2 weeks (< 75%) and its drop vs the 4 weeks before (≥ 15 pts), absence streak (≥ 3 days), exam average falling ≥ 15 pts or < 40%, homework completion (< 50% of ≥ 3 shared), leave requests (≥ 3 in 30 days), AI tutor "finds difficult" items (≥ 2), fees overdue 90+ days.
- Strong signals weigh 2, supporting 1. Flagged only with at least one strong signal **and** a score ≥ 3 (high threshold, to keep false alarms low at the start). Fees are principal-only context: never shown to teachers, never in the reason text, never enough to flag a child.
- One inbox item per week ("N students may need attention") with a one-click **Tell the class teachers** (in-app notice to staff only).
- Staff mark each flag *Acted on* (with a note), *False alarm* or *Dismiss*; these feed the action-rate / false-alarm metrics. Re-running a week never overwrites a decision.

### B1 — daily plan (`services/dailyPlan.js`)
- Candidates from SQL: urgent inbox items, failed automations, flagged students, notes awaiting approval, pending staff/student leave, draft payroll, enquiries not contacted for 2+ days, families with no fee payment in 60+ days.
- Claude picks the top 3 and writes one "why" line each; it can only choose keys from the list (invented ones are ignored). Without a key, the rule priority decides.
- Safe actions (re-run a failed automation that is safe to re-run, tell class teachers about flagged students) become approvals: **Approve** button on the card, or reply `APPROVE <n>` on WhatsApp (existing Ask AI handler). Money and parent messages are never one-tap.
- ✓ / 👎 per item and the approval rate are tracked (`assistant_actions.source = 'daily_plan'`).

### A2 — parent notes (`services/progressNotes.js`)
- Eligible parent: WhatsApp opted in **and** consent (`parents.ai_notes_consent`): school choice of *explicit* (only "agreed", default) or *opt-out* (everyone except "said no").
- Written from this week's attendance, shared homework, **published** results, visible teacher notes and the learning profile. 3–4 sentences, positive first, one 10-minute thing to do at home. Language: each parent's `preferred_language` (Hindi/Punjabi/English), or English/Hinglish for all.
- Safety check on every AI note and every human edit: blocks labels (weak, lazy, kamzor, कमज़ोर, ਕਮਜ਼ੋਰ…), links and phone numbers; unsafe AI notes fall back to the template note.
- Approval screen: edit inline, select all, Approve & send / Don't send; Consent tab per class. Drafts expire after 4 days. A parent marked "said no" has pending notes withdrawn immediately.
- Sending re-checks opt-in and consent; a send interrupted mid-way is marked failed (never retried automatically, so no double messages).
- While notes are on, the old class-level weekly summary is skipped, so parents get one weekly message.

## Deploy

1. `cd backend && npm install && npm run migrate` — additive, re-runnable (appended to `models/schema.sql`, CRLF kept).
2. Restart backend (workers run in the same process). New BullMQ queue `AiAutomationQueue` is scheduled at startup.
3. `cd frontend && npm install && npm run build`.
4. **Meta templates** (Utility, language `en`; add `hi`/`pa` later — sends fall back to English automatically):
   - `principal_daily_plan` — body: `Good morning. Today's plan for {{1}}: {{2}}. Open the Control Center for details.`
   - `student_progress_note` — body: `Weekly note about {{1}} from school: {{2}} Reply STOP to stop school messages.`
   Until approved, the plan still appears on the Control Center and notes fail with a clear reason (nothing is lost).
5. Optional env: `AI_AUTOMATION_MODEL` (defaults to `ASSISTANT_MODEL`, then `claude-sonnet-5`), `EARLY_WARNING_AI_LIMIT` (60 AI calls/school/run), `PROGRESS_NOTES_AI_LIMIT` (400), `EARLY_WARNING_CRON`, `DAILY_PLAN_CRON`, `PROGRESS_NOTES_CRON`, `WHATSAPP_DAILY_PLAN_TEMPLATE`.

Defaults per school: early-warning **on**, daily plan **on** (staff-only), parent notes **off** until the school switches them on in Control Center → Parent notes → Settings.

## Decisions to confirm (roadmap §5)
- **Consent wording** for AI-written learning notes — default is explicit consent; "opt-out" should only be used if the admission form / privacy policy covers it.
- **Approver** — default class teacher (principal can always approve); switchable to principal-only.
- **Languages** — default each parent's preferred language. Note: learning-profile phrases are stored in English, so template (non-AI) notes in Hindi/Punjabi can contain English phrases; AI notes translate them.
- **Cost** — caps above; with no `ANTHROPIC_API_KEY` everything runs on templates.
- **Retention** — profiles/notes are deleted with the student (FK cascade); a time-based retention rule is not built yet.

## Tested
- 175 unit tests (16 new: scoring, thresholds, fee privacy, note safety in 4 languages, fallback notes, plan picking).
- Real Postgres 16 + Redis: migration twice; 24 end-to-end checks (school isolation, class-teacher scoping, decisions survive re-runs, plan idempotency, approval → teacher notice, consent modes, label refusal, approver setting, send window, WhatsApp failure handled, metrics, weekly-summary skip).
- AI path against a stand-in Claude endpoint: AI wording used when clean, unsafe note replaced, invented plan items ignored; real BullMQ job recorded by the Control Center.
- Headless Chromium click-through of all new screens (principal + class teacher, desktop + 390px phone width, no sideways scroll).

**Not tested:** real Claude answers, real WhatsApp/Meta delivery (templates not yet approved).
