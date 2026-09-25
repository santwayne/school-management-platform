# Deploy Handoff: Phase 1, Operator Control Center

Branch: `feat/p1-operator-control-center`
Spec: `WAYNUR_AUTOMATION_SPEC.md` §2

## What this adds
One place where a single operator sees whether every automation ran, whether every integration is up, and a deduplicated inbox of everything a human must handle.

- **Tables** (appended to `schema.sql`, idempotent, auto-applied on boot): `automation_registry`, `automation_runs`, `integration_health`, `ops_exceptions`, `audit_log`, plus digest columns on `school_settings`.
- **`services/opsService.js`**: `recordRun`, `withRun`, `raiseException` (dedupes, severity only escalates), `raiseExceptionForAllSchools`, `autoResolve`, `audit`, and a whitelisted one-click action registry.
- **`workers/instrumentation.js`**: records every run of all 14 existing workers via their `completed`/`failed` events. No worker file was edited.
- **`workers/healthCheck.js`**: every 10 min, on an in-process timer (deliberately not BullMQ, so it still works when Redis is down). Checks Postgres, Redis, WhatsApp token, Anthropic, Razorpay, Vapi, S3, per-school bus GPS and biometric punches, and flags automations that have not run within 1.5x their interval. Problems raise exceptions with plain-language fix steps; recoveries auto-resolve them.
- **`workers/dailyDigestWorker.js`**: 8:00 AM IST (pinned with `tz`). Facts from SQL; Claude only phrases one line, with a fixed-template fallback. Sent on WhatsApp to the operator/principal digest phones and always copied to the dashboard.
- **`routes/ops.js`** at `/api/ops` (operator or principal only): overview, automation run history, run-now (whitelisted + 10 min cooldown), exceptions list/resolve/dismiss/snooze/one-click action, audit log, digest settings and preview.
- **Attendance**: `/api/attendance/mark` now records each run, audits each alert, and raises an exception when an alert fails **or when an absent child's parent is unlinked / not opted in** (previously skipped silently). `Promise.all` became `Promise.allSettled` so one failed escalation-queue add no longer 500s the request after attendance was committed.
- **New role `operator`**: creatable from the Staff tab API (`POST /api/academics/teachers` with `role: "operator"`), gets staff dashboard notifications.
- `generateAIHint` moved from `claude-sonnet-4-6` to `claude-sonnet-5` (all other AI calls already used it).

## Frontend
- `OperatorShell.jsx`: focused sidebar for the `operator` role (Control Center, Inbox with open-count badge, Automations, Activity log, Daily report). Principals see the same pages inside their normal `AdminShell`, with a tab row, and get a "Control Center" link in the admin sidebar.
- `components/ops/`: `OpsOverview` (one-sentence headline of what needs attention, today's numbers, connections, automations by category with working/waiting/check/failing lights), `ExceptionInbox` (filters, expand, one-click action / resolve with note / snooze 1 h, 4 h, 1 day / dismiss; keyboard triage j/k/Enter/r/s/d/a), `Automations` (list + run history + Run now where safe), `AuditLog`, `OpsSettings` (digest phones, language, live preview).
- Routes `/ops`, `/ops/inbox`, `/ops/automations(/:key)`, `/ops/audit`, `/ops/settings` behind a new `operatorOnly` guard; operator logins land on `/ops`; Staff tab can create an "Operator (Control Center)" account.
- Colour never carries meaning alone (lights have text labels); keyboard focus rings on interactive elements; works down to phone width.

## Before / during deploy
1. **Must run on a persistent process** (EC2 + PM2 or Render web service). Not Vercel serverless.
2. **Submit WhatsApp template for approval** (Utility, language `en`):
   - name: `ops_daily_digest`
   - body: `Waynur daily report for {{1}}: {{2}}. Open items needing you: {{3}}. Open the Control Center for details.`
   Until approved, the digest still appears on the dashboard; WhatsApp sends fail and are recorded.
3. Optional env vars (all have defaults): `HEALTH_CHECK_INTERVAL_MINUTES` (10), `OPS_DIGEST_CRON` (`0 8 * * *`, IST), `WHATSAPP_OPS_DIGEST_TEMPLATE` (`ops_daily_digest`), `OPS_HEALTH_AI_MODEL` (`claude-haiku-4-5-20251001`; used for an hourly 1-token key check).
4. Create an operator login and set digest phones via `PUT /api/ops/settings`.

## Tested locally (Postgres 16 + Redis, real server)
- Migration runs twice cleanly; server boots; 14 workers instrumented; GPS (30 s job) writes one run row per 15 min, not per run.
- Teacher token gets 403 on `/api/ops/*`.
- Absent student with failed WhatsApp gives a high exception; absent student with no parent gives a medium exception; re-marking bumps `occurrences` instead of duplicating.
- Redis shut down gives a critical exception with fix steps; Redis restarted auto-resolves it.
- `fee_reminder` last run set to 3 days ago gives a critical stale exception; one-click "Run now" queues it, it runs, the exception auto-resolves.
- Run-now refused for `daily_guidance` (would re-send messages). Snooze/resolve/dismiss/validation paths verified.
- Digest: settings validation, preview, run writes dashboard copies and records the (sandbox-blocked) WhatsApp failure.
- Frontend: `vite build` passes; operator login lands on `/ops`; overview and inbox checked in a headless browser against the local backend.
- `npm test`: 7/7 unit tests (count parsing, status, staleness, template-param sanitising, digest line, IST helpers).

**Not tested end-to-end:** real WhatsApp/Anthropic/Razorpay/Vapi calls (no credentials in the build environment). On staging, verify the health check reports each as `ok`.

## Known gaps / not in this PR
- The operator logs in from the existing Admin tab on the login page (all staff tabs use the same endpoint); there's no separate "Operator" tab yet.
- Student record links in the inbox are shown to principals only, because student profile pages are principal/teacher routes.
- Existing jobs (7 AM guidance, 9 AM fee reminders, ...) run on the **server's** timezone. On a UTC server they fire 5.5 h late in IST. Not changed here because it alters existing behaviour; recommend setting `TZ=Asia/Kolkata` in the PM2 ecosystem file or adding `tz` to each repeat.
- `services/whatsappService.js` logs the last 6 characters of the WhatsApp token on every send. Should be removed.
- Workers are platform-wide, so their runs are recorded with `school_id = NULL` and critical failures appear in every school's inbox.
- `ops_exceptions` id-cursor paging is approximate because the inbox is ordered by severity first.
