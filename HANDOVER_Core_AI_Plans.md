# Handover — Core (₹400) / AI (₹650) plans in Super Admin

Branch: `feat/core-ai-plans` (stacked on `feat/ai-tutor-cost-reduction` — merge that one first)

## What it does

Super Admin → **Plans (Core / AI)** (new page, `/super-admin/plans`):

- Counts: Core paid, AI paid (with student totals), demos (and ones ending in 7 days), yearly value of paid schools, renewals due in 30 days, expired, plan not set, schools still on retired plans.
- Core and AI rate cards — per-student yearly price and yearly minimum are editable (default ₹400 / ₹25,000 and ₹650 / ₹35,000, all before GST).
- School list with filters (Core, AI, Demo, Expiring soon, Expired, Plan not set, Retired plan) and search.
- **Manage** a school:
  - **Give / extend a demo** — full AI plan free for N days (1–90). When it ends the school is read-only until a payment is recorded.
  - **Record payment / renewal** — plan, students paid for, amount (pre-filled from the price, editable for discounts), period (default 1 year), method (bank, UPI, cheque, cash, Razorpay link, complimentary), reference, note. Billing is manual: money is collected outside Waynur and recorded here.
  - **Upgrade Core → AI** — mid-year price is the difference for the days left; recording it keeps the same paid-until date. "Upgrade now" also exists for a free/agreed upgrade.
  - **Downgrade AI → Core** — for a paid school it is booked for the end of the paid year (AI keeps working till then) and can be cancelled. Outside a paid period it applies now.
  - **History** of every action with who did it.
- **Add School** form has a new "Waynur AI demo — days" field (default 14).

Principal side:
- Billing page shows the Core/AI plan, its status (demo till, active till, grace, expired), students vs paid students, and both plans. No online checkout for Core/AI — "contact Waynur".
- Top banner warns when a demo ends in ≤3 days, renewal is due in ≤15 days, during grace, and when expired.

## Rules

| State | Meaning | AI features | Writes |
|---|---|---|---|
| `none` | New school, plan not set yet | only if plan is AI | allowed |
| `demo` | Free AI demo till `demo_ends_at` | on | allowed |
| `paid` | Paid till `paid_until` (whole day, IST) | on for AI, off for Core | allowed |
| grace | `PLAN_GRACE_DAYS` (default 7) after `paid_until` | as paid | allowed |
| `expired` / demo ended | | off | **read-only** (GET still works, data safe) |
| `legacy` | Still on Starter/Growth/District | unchanged (on) | old Razorpay billing rules |

**AI features gated on Core:** AI Tutor (all), Ask AI assistant, AI test generator, AI grading (actions only — old results still open), WhatsApp doubt bot (doubt is saved for the class teacher, parent gets an acknowledgement), AI understanding in the WhatsApp parent assistant and admission assistant (they fall back to their keyword rules), weekly early-warning, principal daily plan, parent progress notes.

Starter/Growth/District are retired (`active = false`): no new sales. Existing schools keep working as `legacy` until moved with "Move to Core / Move to AI" + "Record payment". New schools (Super Admin or self-registration) start on Core, state `none`.

A daily-ish sweep (runs with the billing sweeper every 5 min) expires ended demos/paid periods, applies booked downgrades and posts reminders in the school's exception inbox. Super Admin can also run it: `POST /api/super-admin/plans/sweep`.

## API (Super Admin, all under `/api/super-admin/plans`)

| Method | Path | |
|---|---|---|
| GET | `/` | overview + all schools |
| GET | `/quote?plan=core\|ai&students=N[&school_id=X]` | price (+ mid-year upgrade difference) |
| PATCH | `/catalog/:code` | `{ per_student_yearly, min_yearly, reason }` |
| GET | `/schools/:id` | plan + history |
| POST | `/schools/:id/demo` | `{ days, note }` |
| POST | `/schools/:id/demo/extend` | `{ days, note }` |
| POST | `/schools/:id/payment` | `{ plan, students, amount, period_start?, period_end?, method, reference?, note? }` |
| POST | `/schools/:id/change` | `{ to_plan, note }` |
| POST | `/schools/:id/cancel-downgrade` | |
| POST | `/sweep` | run expiry/downgrade sweep now |

## Deploy (EC2)

```bash
cd /home/ubuntu/school-management-platform
git pull origin master                       # after merging both PRs
cd backend && npm install && npm run migrate # adds columns, Core/AI plans, school_plan_events; retires old plans
pm2 restart waynur-backend --update-env
cd ../frontend && npm install && npm run build
```

Optional `.env`: `PLAN_GRACE_DAYS=7`.

After deploy, open Super Admin → Plans → filter "Retired plan" and move each existing school to Core or AI, then record its payment (or start a demo).

## Tests

```bash
cd backend && node --test tests/schoolPlans.test.js
```

Checked against a real Postgres: migration runs twice cleanly; demo → extend → Core payment → mid-year AI upgrade (₹24,932 for 100 students with ~364 days left) → downgrade booked → cancelled → booked → sweep applies it and expires the school; legacy → AI; rate edit; middleware returns `PLAN_EXPIRED` (402) on writes for expired schools and `PLAN_NO_AI` (403) for AI routes on Core. Full backend suite: 181/181 pass. Frontend builds.
