# Deploy Handoff — PR #21: WhatsApp send fixes + webhook security

Branch: `fix/attendance-whatsapp-send-synchronously` | Compiled: 2026-08-10

This covers everything in PR #21 before it merges — what changed, why, what you need to do before/during deploy, what to test, and what's still open afterward.

## Why this PR exists

The original ask: absence WhatsApp alerts weren't reaching parents. Root cause: they were queued via BullMQ (`attendanceQueue.add(...)`) for `workers/attendanceWorker.js` to process — but that worker needs a **persistent, always-running Node process** to stay alive and keep listening. This backend is deployed on **Vercel as serverless functions**, where every request is a fresh, short-lived invocation with nothing left running afterward. Queued jobs sat in Redis with no consumer. This is very likely why messages weren't sending — not a one-off bug, but the whole background-job architecture being on the wrong hosting model for it.

While fixing that, a broader "check for other faults" pass found the same bug in two more places, plus two unrelated real issues (see below).

## What changed (4 fixes)

1. **Attendance absence alerts** — `/api/attendance/mark` now sends the WhatsApp message inline, after the attendance records commit, in parallel across all absent students in one request — instead of queuing it.
2. **Class notes and AI-grading teacher notes** — same bug, same fix. `classNoteQueue` and `studentNoteQueue` had the identical problem. Extracted into `services/classNoteService.js` / `services/studentNoteService.js`, called synchronously from `POST /class-notes/:id/send`, `POST /grading/submit`, and `POST /premium-ai/ocr/grade`. The now-dead worker files (`workers/classNoteWorker.js`, `workers/studentNoteWorker.js`) and their queue definitions were removed.
3. **WhatsApp webhook had no signature verification** (security fix, not related to the queue bug). `POST /api/whatsapp/webhook` — which processes incoming replies (including the one that cancels a live voice-call escalation) and fee-collector cash-slip photos — trusted any POST body based on URL secrecy alone. Now verifies Meta's `X-Hub-Signature-256` header (HMAC-SHA256, `crypto.timingSafeEqual`). **Fails closed** if unconfigured, matching how this codebase already protects the Razorpay webhook.
4. **`/api/auth/student-login` had no rate limiting**, unlike the other two login routes. Added `loginLimiter`. Matters more here, not less — student PINs are short/numeric.

## Action required before/during this deploy

**Set a new environment variable: `WHATSAPP_APP_SECRET`.**

- Where to get it: Meta App Dashboard → your app → Settings → Basic → "App Secret".
- This is **different** from `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_VERIFY_TOKEN`, which already exist — this is a third, separate value.
- **If this isn't set, the WhatsApp webhook will reject every incoming message with a 500** (fails closed, on purpose — see fix #3 above). That means: parent replies that should cancel an escalation call won't be processed, and fee-collector cash-slip photos won't be processed either, until this is set.
- Documented in `backend/.env.example` alongside the existing WhatsApp vars.

No other new environment variables are needed for this PR.

## What to test in staging before this reaches real parents/students

Nothing here could be tested end-to-end in the environment this PR was built in (no live Postgres/Redis/WhatsApp/Meta credentials available) — only syntax, module-loading, and the signature-verification logic itself (unit-tested in isolation, 5/5 cases pass: valid signature accepted; tampered body, wrong secret, missing header, and unconfigured secret all correctly rejected). Please run through, in order:

1. **Set `WHATSAPP_APP_SECRET`** per above, before testing anything webhook-related.
2. Mark a test student absent → confirm the parent's WhatsApp message actually arrives (not just that the API call returns 200).
3. Send a class note to a test class → confirm all opted-in parents receive it, and the delivery-status counts shown in the UI look right.
4. Submit an AI-graded answer (`/grading/submit` or `/premium-ai/ocr/grade`) for a student whose class has an opted-in teacher → confirm the teacher gets the AI-generated performance note on WhatsApp.
5. Have a real parent (or a test number registered as one) reply to an absence alert within the escalation window → confirm the reply is accepted (webhook returns 200, not 401) and the escalation call is actually cancelled.
6. Try replaying an old/tampered webhook payload (e.g. resend a captured request with a stale signature) → confirm it's rejected with 401.
7. Try logging into the student portal with a wrong PIN 20+ times quickly → confirm it gets rate-limited instead of allowed to continue guessing.

## What this PR does NOT fix (real, not silently skipped)

The 2-hour delayed voice-call escalation job (used by the fix in #1 above) is still a BullMQ delayed job — correctly so, since a "check back in 2 hours" action can't happen inside a single HTTP request. But it has the **same underlying problem**: nothing reliably keeps a worker running to fire it. Same story for four other, genuinely scheduled/recurring queues that weren't touched in this PR because they can't be fixed the same way (making a request synchronous doesn't help a job that isn't triggered by a request):

- `GuidanceQueue` — daily "what to teach today" nudge to teachers
- `TeacherAttendanceQueue` — rolls up biometric punch events into daily attendance
- `GpsPollQueue` — polls vehicle locations on an interval
- `LibraryQueue` — daily books due/overdue digest

**Two real fix paths for these, not yet decided:**
1. Move the backend off Vercel to Render/Railway — this repo's own README already recommended this for the backend from the start (`vercel.json` currently deploys both frontend and backend to Vercel, which is the mismatch). Fixes all four at once, no per-feature patches needed.
2. Keep the backend on Vercel, convert each of the four to a Vercel Cron Job hitting a dedicated endpoint instead of a BullMQ delayed/repeatable job.

Recommend deciding on one of these as the next piece of work after this PR — the same silent-failure risk this PR just fixed for attendance/class-notes/grading-notes almost certainly still applies to daily guidance, GPS tracking, the teacher attendance rollup, and the library digest today.

## Files changed in this PR

```
backend/.env.example
backend/config/queue.js
backend/routes/attendance.js
backend/routes/auth.js
backend/routes/classNotes.js
backend/routes/grading.js
backend/routes/premiumAi.js
backend/routes/whatsapp.js
backend/server.js
backend/services/classNoteService.js       (new)
backend/services/studentNoteService.js     (new)
backend/workers/classNoteWorker.js         (deleted)
backend/workers/studentNoteWorker.js       (deleted)
frontend/src/components/ClassNotesComposer.jsx
```
