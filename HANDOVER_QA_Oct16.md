# Handover — QA follow-ups (Oct 16, 2026)

Fixes for the five items left "partial / pending" in the QA round. Written by Claude; please review before merging.

## Deploy (EC2)
1. Merge, then: `cd /home/ubuntu/school-management-platform/backend && git pull origin master && npm install && npm run migrate` (additive, re-runnable).
2. `pm2 restart waynur-backend --update-env`
3. `cd ../frontend && npm install && npm run build`
4. Nginx: add to the `/api/` block of `/etc/nginx/sites-enabled/waynur` (same as `deploy/nginx-waynur.conf`), then `sudo nginx -t && sudo systemctl reload nginx`:
   ```
   proxy_read_timeout 180s;
   proxy_send_timeout 180s;
   ```

## What changed and how to re-test

| # | Item | Cause found | Fix | Re-test |
|---|------|-------------|-----|---------|
| 3 | Daily plan WhatsApp | (a) Delivery result was only in server logs. (b) `APPROVE n` was only accepted from a number saved on a principal/operator **staff record**, but the plan goes to the **Daily report** numbers — a reply from a number not on a staff record fell through to the parent flow. (c) A quiet day sent nothing. | Per-number result (sent / Meta's reason) saved on the plan and shown on the *Today's plan* card; **Send to WhatsApp now** button (`POST /api/ai-automation/plan/send`, 5-min cooldown); `APPROVE n` / `NO n` from a Daily-report number is accepted (only approve/reject — not Ask AI); empty plan sends "Nothing urgent today". | Control Center → Today's plan → *Send to WhatsApp now*, check the status line, reply `APPROVE <n>` from that phone. |
| 4 | Automations status | Daily plan runs Mon–Sat but was registered as every 24 h, so it showed stale/overdue every Sunday–Monday morning. | Interval set to 36 h (stale only after 54 h). | Control Center → Automations: *Principal's daily plan* green. Other 3 AI automations need no change. |
| 7 | AI grading — generated test pending | 10 questions + model answers can take longer than nginx's 60 s timeout → browser error while the test sometimes appeared later. Also subject/chapter columns were 50 chars, so a longer topic failed *after* the AI call. | Generation now runs in the background: `POST /test/generate` returns 202 at once, the Tests list shows *Generating… / Ready / Could not generate: reason* and polls; **Retry** button (`POST /test/:id/retry`); a test stuck > 10 min shows as interrupted. Columns widened to 255; readable error messages (e.g. invalid `ANTHROPIC_API_KEY`); nginx timeout 180 s. | AI Grading → Generate test (10 questions) → wait for *Ready* → Answer key → Grade answers. |
| 10 | Staff bulk import — all 8 rejected | Import only accepted the exact words teacher/accountant/librarian/operator and exact headers; designations ("TGT English", "Maths Teacher", "Cashier", "Computer Operator"), headers like "Mobile No." / "Email Address", Excel's `9.87E+09` phones, `.0` phones and spaces in emails were all rejected. Re-importing the same people also gave a vague "already exists". | Designations mapped to roles; headers matched ignoring case/punctuation (missing columns named up front); phones accept `+91-…`, `0…`, `91…`, `….0`, two numbers in one cell; Excel scientific notation gets a clear fix-it message; emails cleaned; **Download problem list** (CSV). Principal / vice principal still refused by design. | Staff → Import staff with the same 8-row file. If any row still fails, download the problem list. |
| 11 | Role salary | Not tested before. | No bug found. Tested end-to-end: personal salary wins over role salary; staff without one get the role amount; role-scoped components apply only to that role. Small refactor so this is unit-tested. | Staff & Payroll → set *teacher* role salary → run payroll → a teacher without a personal salary is paid the role amount. |

## Tested
- 197 unit tests pass (`npm test`), including new ones for designations, phone formats, the daily-plan stale window and role salaries.
- Smoke test against a real Postgres 16 (old schema → new migration run twice): 8-row import (7 created, 1 Excel-mangled phone flagged with reason), role salary through a real payroll run, background test generation → failed with reason → retry → interrupted, plan WhatsApp result recording + cooldown, `NO n` from the Daily-report number recorded against the principal, unknown numbers ignored.
- Frontend builds. **Not click-tested in a browser; real Meta/WhatsApp and real Claude calls not tested** — please run the re-test column above on production.
