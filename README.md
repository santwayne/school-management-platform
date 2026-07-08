# WhatsApp-First School Management & AI Learning Platform

Wayne E Solutions — internal build. Full product spec: see `School_Software_Full_Spec.docx` (Sant's copy).

Multi-tenant SaaS: one backend serves many schools, scoped by `school_id`. Attendance auto-escalation
(WhatsApp → delayed AI voice call), homework doubt-solving, daily teacher guidance, performance analytics,
fee/petty-cash admin, and a Phase 5 AI test-generator/OCR-grading prototype.

## What changed from the first scaffold

The original Gemini-generated snippets were disconnected fragments. This version:

- Fixes the `res.status200()` typo and the stray `[cite: N]` text pasted into the JSX/JS that broke compilation.
- Wires **every** route into `server.js` (previously only `/api/attendance` was mounted — finance, analytics,
  WhatsApp webhook, and premium-AI all 404'd).
- Adds the **missing worker** that actually processes queued attendance jobs (`workers/attendanceWorker.js`) —
  before this, jobs were queued but nothing ever sent the WhatsApp message or triggered the voice call.
- Adds the **scheduler** that puts a job on `GuidanceQueue` every morning — before this, the guidance worker
  existed but nothing ever fed it a job.
- Adds real `whatsappService.js` (Meta Graph API) and `voiceService.js` (Vapi) integrations, replacing the
  `// TODO` comments.
- Adds JWT auth (`routes/auth.js`, `middleware/auth.js`) — routes now trust `req.user.school_id` from a verified
  token instead of an unchecked `school_id` in the request body.
- Adds every table the routes already queried but that didn't exist yet: `call_outcomes`, `homework_suggestions`,
  `performance_snapshots`, `teacher_salary(_history)`, `petty_cash_history`, `generated_tests`, `test_rubrics`,
  `ai_graded_submissions`.
- Adds parent-reply detection in the WhatsApp webhook, so a voice-call escalation is skipped if the parent
  already replied within the wait window.

## Repo layout

```
backend/
  config/       db.js, queue.js
  middleware/   auth.js
  models/       schema.sql
  routes/       auth, attendance, analytics, finance, whatsapp, premiumAi
  services/     whatsappService, voiceService, aiService, ocrGradingService
  workers/      attendanceWorker, dailyGuidanceWorker, scheduler
  scripts/      migrate.js, seed.js
  server.js
frontend/
  src/
    components/ Login, AttendanceForm, PrincipalDashboard, FinanceAdmin, AIGradingPrototype, ProtectedRoute
    App.jsx, AuthContext.jsx, api.js, main.jsx
```

## Local setup

Prereqs: Node 18+, PostgreSQL, Redis.

```bash
# Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL at minimum to start
npm install
npm run migrate             # creates all tables
npm run seed                # creates a demo school + logins (see console output)
npm run dev                 # http://localhost:5000

# Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Login with the credentials printed by `npm run seed` (`principal@demoschool.test` / `changeme123`).

### Env vars that gate real functionality

The app **runs** with just `DATABASE_URL`, `JWT_SECRET`, and Redis — but these features are stubbed/no-ops
until you add real credentials:

| Feature | Needs |
|---|---|
| WhatsApp alerts / doubt replies | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, approved templates |
| Voice-call escalation | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID_*` |
| AI hints / test generation / OCR grading | `ANTHROPIC_API_KEY` |

Until then, attendance marking, fee collection, petty cash, and login all work fully against Postgres —
only the outbound WhatsApp/voice/AI calls will log an error and fail gracefully.

## Known gaps still open (be upfront about these before pitching to a school)

- **Image OCR is not wired in.** The webhook detects an image message and downloads it, but text extraction
  from the image itself needs a real OCR/vision provider plugged into `routes/whatsapp.js`.
- **No admin UI to create schools/classes/students/parents yet** — currently only `scripts/seed.js`. Needed
  before onboarding a second real school.
- **`test_rubrics` has no authoring UI** — a teacher currently can't add the correct answer for OCR grading
  through the app; it must be inserted directly for now.
- **No refresh-token flow** — JWTs expire after 12h and the user is simply logged out; fine for MVP.
- Per the original spec's own risk note: prototype OCR grading against real handwriting samples before
  promising it to any school — accuracy has not been validated here.

## Deploying live

A reasonable free/cheap first deploy:

1. **Postgres + Redis**: Railway or Render both offer managed Postgres and Redis add-ons.
2. **Backend**: Render/Railway "Web Service" pointed at `backend/`, build command `npm install`, start command
   `npm start`. Run `npm run migrate` once via their shell/console after first deploy.
3. **Frontend**: Vercel or Netlify pointed at `frontend/`, build command `npm run build`, output `dist/`.
   Set `VITE_API_URL` to the backend's deployed URL.
4. **WhatsApp**: register the backend's `/api/whatsapp/webhook` URL in Meta's WhatsApp Business app dashboard,
   and get the `student_absence_alert` / `daily_teaching_guidance` templates approved (template approval can
   take a day or two — start this early).
5. **Vapi**: point `VAPI_PHONE_NUMBER_ID` at an India-compliant number per the VoCallM pattern already in use.

## Pushing to GitHub

```bash
git init
git add .
git commit -m "Complete school management platform: wire routes, add missing workers/tables, fix syntax bugs"
git branch -M master
git remote add origin <your-repo-url>
git push -u origin master
```
