# Waynur — Billing v2 + production fixes (Oct 2026)

## Branches (stacked — merge IN THIS ORDER, each PR targets master after the previous one is merged)

| # | Branch | What |
|---|--------|------|
| 1 | `fix/fee-dues-real-balance` | WhatsApp bot fee check + certificate fee gate always showed ₹0 — fixed |
| 2 | `feat/billing-razorpay-v2` | Razorpay plan billing backend (P1 + P2 + P4 + P5) |
| 3 | `feat/billing-frontend` | Checkout modal, Activating state, banners, invoices (P3) |
| 4 | `chore/prod-hardening` | Demo passwords, S3 region, nginx for built frontend |

Push: `git clone waynur-branches.bundle` or `git fetch /path/waynur-branches.bundle '*:*'` then push each branch and open PRs 1→4.

## 1. Fee dues bug
`student_payment.amount_due` is never written by any route, so `amount_due − amount_paid` was always ≤ 0.
New `utils/feeDues.js` = class fee (`fee_structures`) − tuition paid this academic year + unpaid transport —
the same formula the Fee Dashboard and fee-reminder worker use. Used by `parentAssistant.fee_balance`,
`pay_now` (tuition only, so link payments reconcile) and `certificateService.studentFacts`.
**Note:** a class with no fee structure → bot says "fee details not available" (not "no dues"). Make sure every class has a fee set in Fees → Fee Structure.

## 2. Billing v2 — how it works
- `PATCH /api/billing/plan` → **super-admin only**, needs `{school_id, plan, reason}`, audited. Principals can no longer self-upgrade for free.
- `GET /api/billing/quote?plan=&cycle=monthly|yearly` → list price, 18% GST, proration, when it applies.
- `POST /api/billing/checkout` → creates Razorpay subscription (monthly) or order (yearly) + a `subscriptions` row. **Does not change the plan.**
- Plan changes **only** in `services/billingService.js#processBillingEvent`, from the webhook:
  - `subscription.activated/charged` → active, plan applied, GST invoice
  - `subscription.pending` → `payment_pending` + Operator Center alert
  - `subscription.halted` → `halted`, grace `BILLING_GRACE_DAYS` (7), then **read-only**
  - `subscription.cancelled` → access till period end, then read-only
  - `subscription.authenticated` (upgrade) → plan applied immediately; old sub cancelled at cycle end
  - `order.paid` (yearly) → 12-month term
- Webhook: timing-safe signature → stored in `billing_events` (UNIQUE `x-razorpay-event-id` = idempotency) → 200 → BullMQ `BillingQueue`.
  **If Redis is down it processes inline** (previously `queue.add` would hang forever), and a 5-min in-process sweeper retries failed/stuck events.
- Upgrade: new subscription starts at current period end + a Razorpay **addon** for the prorated difference charged now → works for card, UPI and e-mandate (Razorpay's "update subscription" API only works for cards).
- Downgrade: next cycle; blocked (409) if students/accountants exceed the new limit.
- Only Principal can change plans; Accountant can view billing + invoices.
- Limits enforced server-side (402): `/academics/students/bulk`, `/student-records/bulk-upsert` (per row), admission convert, `/academics/teachers` (accountant seats).
- Read-only: `requireAuth` returns 402 `BILLING_READ_ONLY` for non-GET requests, except `/api/billing` and `/api/auth`. Reads never blocked. Public parent/WhatsApp flows keep working.
- GST invoices: `WN/2026-27/00001`, gap-free per FY (row-locked counter), SAC 998314, CGST+SGST if school state code = `WAYNUR_STATE_CODE` (03 Punjab) else IGST. PDF at `/api/billing/invoices/:id/pdf`. Schools add GSTIN/state in Billing → GST details.
- District monthly (₹35,398.82 incl. GST) > ₹15,000 → RBI e-mandate needs OTP on every debit. UI warns and offers yearly.
- Old PR #52 subscriptions (no `subscriptions` row) are adopted automatically from Razorpay notes on their next webhook.

### Tests
`node --test tests/feeDues.test.js tests/billing.test.js` (pure, no DB).
`E2E_DATABASE_URL=postgres://...throwaway... node tests/e2e-billing.mjs` — real server + Postgres + mock Razorpay, Redis off. 34 checks. **Never point it at production.**

## 3. Go-live checklist (Razorpay)
1. Settings → Business name **Waynur** (currently "unikraft"). Complete KYC / activation.
2. Create 3 Plans (monthly) at GST-inclusive amounts: Starter ₹5,898.82, Growth ₹15,338.82, District ₹35,398.82. Put IDs in `plans.razorpay_plan_id` (or `RAZORPAY_PLAN_ID_*` env).
3. Live keys → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
4. Live webhook `https://waynur.com/api/payment-links/webhook`, new secret → `RAZORPAY_WEBHOOK_SECRET`. Events: `subscription.*`, `invoice.paid`, `order.paid`, `payment.captured`, `payment_link.paid`.
5. `.env`: `WAYNUR_GSTIN`, `WAYNUR_ADDRESS`, `WAYNUR_LEGAL_NAME`, `WAYNUR_STATE_CODE=03`.
6. Test one real ₹ payment end-to-end, check invoice PDF.

## 4. Production issues found today

### WhatsApp outgoing 403
Not a code issue. Meta Business Settings (**Pankaj Thakur** portfolio) → Users → System users → select the token's user → **Assign assets** → WhatsApp accounts → Waynur WABA → Full control. Then **Generate new token** (scopes `whatsapp_business_messaging`, `whatsapp_business_management`), update `WHATSAPP_ACCESS_TOKEN`, `pm2 restart all --update-env`.
Verify: `curl -s "https://graph.facebook.com/v21.0/$WHATSAPP_PHONE_NUMBER_ID?access_token=$WHATSAPP_ACCESS_TOKEN"` should return the number, not an error.

### Redis connection refused
```
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping            # PONG
grep REDIS_URL backend/.env   # redis://127.0.0.1:6379
pm2 restart all --update-env
```
Without Redis: attendance alerts, fee reminders, digests, certificates etc. don't run (billing now survives it).

### S3 region wrong
Shared client in `utils/s3.js` (uses `AWS_S3_REGION` → `AWS_REGION`, `followRegionRedirects`). `.env.example` shipped `us-east-1`. Set `AWS_S3_REGION` to the bucket's real region (`aws s3api get-bucket-location --bucket <name>`; Mumbai = `ap-south-1`). Old rows saved with wrong-region URLs: fix with
`UPDATE ... SET url = replace(url, '.s3.us-east-1.', '.s3.ap-south-1.')` on logo/profile/activity tables after checking.

### Frontend on Vite dev server
Never `npm run dev` in production. Either keep Vercel only, or on EC2:
```
cd frontend && npm ci && npm run build
sudo mkdir -p /var/www/waynur && sudo cp -r dist/* /var/www/waynur/
sudo cp ../deploy/nginx-waynur.conf /etc/nginx/sites-available/waynur && sudo ln -sf /etc/nginx/sites-available/waynur /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
pm2 delete <vite-process-name>
```
(`npm run serve` = `vite preview` exists only as a stopgap.)

### Demo logins with default passwords
`autoBootstrap.js` recreated `principal@demoschool.test / changeme123`, `teacher@…`, `STU001/1234` and super admin `changeme123` **on every boot**. Now opt-in via `SEED_DEMO_DATA=true`; super admin only from `SUPER_ADMIN_EMAIL/PASSWORD`. On production after deploy:
```
node scripts/secureDemoAccounts.js          # dry run
node scripts/secureDemoAccounts.js --apply  # rotates; prints new super admin password ONCE — store it
```
Boot log prints `[SECURITY] default passwords still active` until done.
