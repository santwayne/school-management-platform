# Waynur — Merge & Deploy Handover: PR #88

- **PR:** https://github.com/santwayne/school-management-platform/pull/88
- **Branch:** `fix/qa-oct16-import-grading-daily-plan` → **`master`** (Waynur's main branch is `master`, not `main`)
- **Commit:** `d51a5d6` · based on `master` at `1bc1a75` (no conflicts)
- **Server:** EC2 `i-00ddfa0b4e48f82a1` (Mumbai, "waynur"), PM2 process `waynur-backend`
- **Downtime:** none expected (a few seconds while PM2 restarts)

---

## 1. What this PR fixes

| QA # | Item | Fix in one line |
|---|---|---|
| 3 | Daily plan WhatsApp | Delivery result shown on the plan card, "Send to WhatsApp now" button, `APPROVE n` works from the Daily-report number |
| 4 | Automations | Daily plan no longer shows "stale" on Sunday/Monday |
| 7 | AI Grading | Tests generate in the background with Generating / Ready / Failed status and a Retry button |
| 10 | Staff bulk import | Accepts real designations (TGT, Maths Teacher, Cashier…), header and phone variations; downloadable problem list |
| 11 | Role salary | Verified working; logic now unit-tested |

Details per item: `HANDOVER_QA_Oct16.md` in the repo.

---

## 2. Before merging (5 min)

1. Open the PR → **Files changed** → skim. 18 files, ~600 lines added (incl. these two handover docs).
2. Optional local check:
   ```bash
   git fetch origin && git checkout fix/qa-oct16-import-grading-daily-plan
   cd backend && npm install && npm test        # expect: 197 pass, 0 fail
   cd ../frontend && npm install && npm run build   # expect: "built in …s"
   ```
3. Note the current production commit for rollback (on the EC2):
   ```bash
   cd /home/ubuntu/school-management-platform && git rev-parse --short HEAD
   ```
   Expected `1bc1a75`. Write it down.

## 3. Merge

1. On the PR page click **Merge pull request** → **Confirm merge** (regular merge commit, same as previous PRs).
2. Base must be **master**.
3. Delete the branch afterwards (optional).

---

## 4. Deploy on the EC2

Open AWS console → EC2 → `i-00ddfa0b4e48f82a1` → **Connect** → **EC2 Instance Connect** (user `ubuntu`).

### 4.1 Backend (pull, migrate, restart)
```bash
cd /home/ubuntu/school-management-platform/backend
git pull origin master
npm install
npm run migrate
pm2 restart waynur-backend --update-env
pm2 logs waynur-backend --lines 40 --nostream
```
- `npm run migrate` must end with **`Migration complete.`** All changes are additive and safe to run more than once:
  - `principal_daily_plans`: new columns `whatsapp_result`, `whatsapp_sent_at`
  - `generated_tests`: `subject_id` / `chapter_id` widened to 255; new columns `status` (default `ready`), `error`, `requested_questions`
  - `automation_registry`: daily plan interval 1440 → 2160 minutes
- In the logs, look for the usual startup lines (no new env vars needed).

### 4.2 Frontend (rebuild)
```bash
cd /home/ubuntu/school-management-platform/frontend
npm install
npm run build
```
nginx serves `frontend/dist` directly, so the new build is live as soon as this finishes. (If your nginx `root` points to `/var/www/waynur` instead, also run `sudo cp -r dist/. /var/www/waynur/`. Check with `grep root /etc/nginx/sites-enabled/waynur`.)

### 4.3 nginx timeout (one-time, manual)
AI requests can take longer than nginx's default 60 seconds.
```bash
sudo nano /etc/nginx/sites-enabled/waynur
```
Inside the `location /api/ { … }` block, add these two lines (next to `client_max_body_size`):
```
proxy_read_timeout 180s;
proxy_send_timeout 180s;
```
Then:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
`nginx -t` must say **syntax is ok** and **test is successful** before you reload. If it fails, undo the edit.

---

## 5. Verify on production (15 min)

Log in to waynur.com as the principal of **Waynur Public School** (test school).

| # | Steps | Pass when |
|---|---|---|
| 10 | Staff → **Import staff** → upload the same 8-row file that failed | Rows show "Ready"; import creates them. Any failed row has a clear reason; **Download problem list** works |
| 7 | AI Grading → **Generate test** → 10 questions | Modal closes at once; row shows "Generating…" then **Ready** in 1–2 min. Open **Answer key** and **Grade answers** |
| 3 | Control Center → Today's plan → **Send to WhatsApp now** | Status line shows `••••XXXX sent at …`; message arrives on the principal's WhatsApp |
| 3 | Reply `APPROVE <n>` (or `NO <n>`) to that message if it has an action | Reply "Approved #n…" arrives; card shows Done / Skipped |
| 4 | Control Center → Automations | "Principal's daily plan (AI)" is green |
| 11 | Staff & Payroll → set a **teacher** role salary → run payroll for this month | A teacher without a personal salary is paid the role amount |

If "Send to WhatsApp now" shows **failed: …**, the reason is Meta's (e.g. template not approved, number not connected). That is now visible instead of silent.

---

## 6. Rollback (only if something breaks)

The database changes are additive, so the old code runs fine on the new schema — **no database rollback needed**.
```bash
cd /home/ubuntu/school-management-platform
git checkout 1bc1a75          # the commit noted in step 2.3
cd backend && npm install && pm2 restart waynur-backend --update-env
cd ../frontend && npm install && npm run build
```
Then return to master later with `git checkout master && git pull origin master` and redeploy.

The nginx timeout change is harmless and can stay.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm run migrate` fails | Copy the error. Most likely DB connection (`DATABASE_URL` in `backend/.env`). Nothing is half-applied; fix and re-run |
| Test stays "Could not generate: The AI key… is missing or invalid" | Check `ANTHROPIC_API_KEY` in `backend/.env`, then `pm2 restart waynur-backend --update-env` and press **Retry** |
| Test "Could not generate: model is not available" | The model name `claude-sonnet-5` is not valid for the key — needs a code/env change |
| Generating > 10 min | Shows as "interrupted" automatically; press **Retry** |
| Plan status "No principal/operator WhatsApp number set" | Control Center → Daily report → add the principal's number |
| Plan status "WhatsApp is not connected for this school" | Super Admin → school → add WhatsApp number + keys |
| Import row "already has a Waynur login" | That email was imported/created before — remove the row or change the email |
| Blank page after frontend deploy | Hard refresh (Ctrl+Shift+R); confirm `npm run build` finished without errors |

---

*Written by Claude. Not click-tested in a browser; real WhatsApp/Meta and real AI calls were not tested — section 5 covers them.*
