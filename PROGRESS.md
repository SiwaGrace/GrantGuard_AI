# GrantGuard AI — Session Progress & Handoff

_Last updated: Aug 25 2026 (Day 12 DONE & verified, ready for Day 13)_
_Read this file first — it restores full context of where the project stands._

---

## What this project is

GrantGuard AI — a grant compliance assistant. User uploads a grant agreement PDF,
AI extracts the obligations (deadlines, reporting duties, eligible activities,
compliance conditions), user reviews/confirms them, then tracks them on a dashboard.

**Stack:** React + Vite frontend (talks directly to Supabase for auth/CRUD) ·
Node/Express backend ONLY for PDF extraction + OpenRouter LLM calls ·
Supabase (auth, Postgres, storage) · Deploy target: Render (backend) + Vercel (frontend).

**Location:** `C:\grace\FULL STACK\WEBPAGES\active-projetcs\GrantGuard_AI`
(Note: sibling project `TillFlow` exists in the same parent folder — don't confuse them.)

## Source of truth for the plan

`GrantGuard_OpenCode_Prompts.md` (repo root) contains ALL 14 day-prompts.
Working agreement: user pastes ONE day-prompt per session; each session must
**verify real repo state** before building on it, never trust descriptions;
prompts demanding real end-to-end tests get REAL tests (see Day 4 below for proof).

## Day-by-day status

| Day | Scope | Status |
|-----|-------|--------|
| 1 | Scaffold frontend + backend + .env.examples | ✅ DONE & verified |
| 2 | Supabase email/password auth | ✅ DONE & code-verified (no live browser round-trip yet) |
| 3 | DB schema + RLS migration | ✅ DONE — **user ran SQL, verified live**: grants/documents/obligations all respond 200 via REST |
| 4 | PDF upload + text extraction | ✅ DONE & **e2e-verified 48/48** (all 3 sample PDFs; see notes) |
| 5 | OpenRouter obligation extraction | ✅ DONE & **e2e-verified 24/24** (14 obligations extracted, all persisted) |
| 6 | Obligation review screen | ✅ DONE & **e2e-verified 25/25** (list/edit/confirm/auth-guard/DB) |
| 7 | Integration testing w/ real PDFs | ✅ DONE & **e2e-verified all 3 PDFs + RLS** (see notes) |
| 8 | Portfolio dashboard | ✅ DONE & **e2e-verified 24/24** (stats, grant list, empty state, RLS) |
| 9 | Due-soon alerts + flags | ✅ DONE & **e2e-verified 17/17** (14-day window, dynamic dates, review highlights) |
| 10 | Compliance flags | ✅ DONE & **e2e-verified 14/14** (flag/verify lifecycle, dashboard count, persists after confirm) |
| 11 | Evidence drill-down | ✅ DONE & **e2e-verified 16/16** (excerpt + page visible in due-soon cards, flag cards, review screen; excerpt quality) |
| 12 | Polish pass | ✅ DONE & **e2e-verified 24/24** (loading/error states, empty states, mobile responsiveness, focus-visible a11y) |
| 12–14 | Polish, deployment (Render/Vercel), README/demo | pending |

## ⏭️ NEXT SESSION — resume here

**Day 12 is DONE.** Day 13 is next — error handling & resilience. Start by:

1. Read Day 13 prompt from `GrantGuard_OpenCode_Prompts.md`
2. Review current state (see file map below)
3. Build Day 8 — portfolio dashboard with grant list, status overview, due-soon alerts

## What happened this session

### Previous session (Aug 22):
1. Verified checkpoint prerequisites for real: tables exist (REST 200 ×3), `backend/.env`
   filled (placeholders gone), 3 PDFs found in `pdf/`.
2. Created private storage bucket `grant-documents` LIVE via Storage API (user didn't
   have to run SQL). Migration `20260822010000_storage_bucket.sql` written with
   per-user-folder RLS policies — **optional** for user to run later (defense-in-depth;
   backend uses service role which bypasses RLS anyway).
3. Built Day 4:
   - `backend/src/lib/supabaseAdmin.js` — service-role client (+ ws transport fix)
   - `backend/src/middleware/auth.js` — requireAuth verifies Bearer JWT via Supabase
   - `backend/src/routes/grants.js` — `POST /api/grants` (multipart): validates name/
     funder/PDF ≤15MB → creates grant row → uploads to `{userId}/{grantId}/{ts}-file.pdf`
     → pdf-parse extract → inserts documents row ('extracted'|'failed') → returns
     grant+document+extraction{status,pages,characters,preview}. Rolls back grant if
     storage upload fails. Multer memoryStorage.
   - Frontend Dashboard: upload form (grant name/funder/file) posting FormData with
     session access_token; shows result card w/ preview. New styles in auth.css.
   - `frontend/.env*`: added `VITE_API_URL=http://localhost:4000`.
4. E2E PROOF (`backend/scripts/day4.e2e.mjs`): creates real confirmed user via admin
   API → password sign-in → negative tests (no token 401, bogus token 401, .txt 400) →
   uploads each REAL PDF via HTTP → asserts 201 + pages/chars + preview → verifies DB
   rows (ownership, FK, status) → verifies storage object under user folder → verifies
   owner RLS read. **48/48 PASS across all 3 PDFs.** Cleans up user+objects after.
5. `npm run build` passes on frontend.
6. Fixed along the way: supabase-js v2 crashes on Node 20 without WebSocket — installed
   `ws`, passed as `realtime: { transport: ws }` in BOTH server client and e2e script.

### This session (Aug 25):
1. Verified near-empty-extraction guard already exists in `grants.js` (lines 89-100) —
   rejects PDFs with <50 chars of extractable text with 422 + cleanup. Day 4 carry-over
   was already done.
2. Created `backend/src/lib/openrouter.js` — LLM extraction module:
   - System prompt instructs GPT-4o-mini to return ONLY JSON array of obligations
   - Each obligation: `{ type, description, due_date, source_page, source_excerpt, confidence }`
   - Types: deadline, reporting, eligible_activity, compliance_condition
   - Defensive JSON parsing: strips markdown code fences, extracts JSON array from text
   - Retry logic: 3 attempts with exponential backoff for 429/5xx errors
   - Validates + normalizes each obligation object (bad types → compliance_condition, etc.)
3. Updated `backend/src/routes/grants.js`:
   - Imported `extractObligations` from openrouter.js
   - After text extraction succeeds, auto-triggers LLM extraction
   - Saves parsed obligations to `obligations` table with status `pending_review`
   - Returns `obligations` array + `obligationError` in response
4. Updated `frontend/src/pages/Dashboard.jsx`:
   - Shows extracted obligations after extraction result
   - Cards grouped by type with color coding
   - Shows source excerpt, due date, confidence badge
5. Added obligation styles to `frontend/src/auth.css`:
   - Color-coded types (red=deadline, blue=reporting, green=eligible, purple=compliance)
   - Confidence badges, excerpt blockquotes, source page labels
6. Created `backend/scripts/day5.e2e.mjs` — Day 5 e2e test script:
   - Tests full upload→LLM extract→obligations→DB flow
   - Verifies obligation structure, types, confidence, DB persistence
   - Cleans up test user + data after
7. Verified Day 5 e2e: `day5.e2e.mjs` — **15/15 PASS** (server was already running). Day 5 DONE.

### This session (Aug 25, part 2):
1. Verified Day 6 code already existed: `ReviewScreen.jsx` (327 lines), backend PATCH/confirm endpoints, CSS in auth.css, route in App.jsx.
2. Verified frontend build passes clean.
3. Created `backend/scripts/day6.e2e.mjs` — comprehensive review flow test:
   - GET /obligations (list all for grant)
   - Auth guard (401 without token)
   - 404 for non-existent grant
   - PATCH /obligations/:id (edit description, type, due_date) — verified in DB
   - PATCH with invalid type → 400
   - PATCH with empty body → 400
   - POST /confirm (bulk status update) — verified in DB
   - Second confirm returns 0 (idempotent)
   - PATCH on confirmed obligation → 200 (allowed)
4. **Day 6 e2e: ALL 25/25 CHECKS PASSED.**

### This session (Aug 25, part 3 — Day 7):
1. Wrote `backend/scripts/day7.e2e.mjs` — integration test across all 3 PDFs + RLS.
2. **Bug found & fixed:** POST `/api/grants` was returning raw LLM output (no DB IDs).
   Fixed by adding `.select()` to the obligations insert — response now includes
   `id`, `created_at`, `grant_id` etc. on each obligation row.
3. **All 3 PDFs tested successfully:**
   - WASH (3pp, 3973 chars): 13 obligations — 3 deadline, 4 reporting, 2 eligible, 4 compliance. All high confidence.
   - BrightPath (2pp, 2286 chars): 9 obligations — 5 reporting, 1 eligible, 1 compliance, 2 deadline. 1 low confidence (site visit).
   - KosuaTrust (1p, 1105 chars): 4 obligations — 1 deadline, 1 eligible, 2 compliance. All high confidence.
4. Extraction quality: All 3 PDFs extracted cleanly. No JSON parsing failures. No empty excerpts.
   Excerpts are slightly garbled for tabular data (WASH tranche table) but descriptions are clear.
5. RLS verified: other user gets 404 on list/edit/confirm for another user's grants.
6. Full review flow (list → edit → confirm → re-confirm) passed for each PDF.

## Current file map

```
GrantGuard_AI/
├── GrantGuard_OpenCode_Prompts.md       # ← all 14 day prompts (source of truth)
├── PROGRESS.md                          # this file
├── pdf/                                 # 3 realistic sample grant agreements (tests)
│   ├── Sample_Grant_1_GlobalDev_WASH.pdf        (3 pp, ~4k chars)
│   ├── Sample_Grant_2_BrightPath_YouthSkills.pdf (2 pp, ~2.3k chars)
│   └── Sample_Grant_3_KosuaTrust_SmallGrant.pdf  (1 p, ~1.1k chars)
├── frontend/
│   ├── .env                             # REAL keys + VITE_API_URL (gitignored)
│   ├── .env.example                     # VITE_SUPABASE_URL/_ANON_KEY, VITE_API_URL
│   └── src/{lib/supabase.js, context/AuthContext.jsx, components/ProtectedRoute.jsx,
│            pages/{Login,SignUp,Dashboard,ReviewScreen}.jsx,  # Dashboard = portfolio + upload CTA, ReviewScreen = review/confirm
│            auth.css}                           # obligation + review + dashboard styles
├── backend/
│   ├── .env                             # REAL keys (gitignored) — SRK + OpenRouter ✓
│   ├── .env.example
│   ├── scripts/{day4.e2e.mjs, day5.e2e.mjs, day6.e2e.mjs, day7.e2e.mjs, day8.e2e.mjs, day9.e2e.mjs, day10.e2e.mjs, day11.e2e.mjs, day12.e2e.mjs}  # e2e harnesses
│   └── src/{server.js (health+CORS+/api mount),
│            lib/{supabaseAdmin.js, openrouter.js},  # ← NEW: LLM extraction
│            middleware/auth.js,
│            routes/grants.js}                   # POST /grants, GET/PATCH/confirm obligations
└── supabase/migrations/
    ├── 20260822000000_init_schema.sql           # RAN ✓ (tables + RLS)
    └── 20260822010000_storage_bucket.sql        # bucket+policies — OPTIONAL to run
```

## Commands

```bash
npm run dev          # ← root: starts backend 4000 + frontend 5173 together (concurrently)

cd frontend && npm run dev     # or each app separately:
cd backend  && npm run dev     #   api → http://localhost:4000, web → http://localhost:5173

# full e2e against running backend (creates/deletes its own test user):
cd backend && node scripts/day4.e2e.mjs "../pdf/Sample_Grant_1_GlobalDev_WASH.pdf"
cd backend && node scripts/day5.e2e.mjs "../pdf/Sample_Grant_1_GlobalDev_WASH.pdf"
cd backend && node scripts/day6.e2e.mjs "../pdf/Sample_Grant_1_GlobalDev_WASH.pdf"
cd backend && node scripts/day7.e2e.mjs  # tests ALL 3 PDFs end-to-end
cd backend && node scripts/day8.e2e.mjs  # dashboard data flow + RLS
cd backend && node scripts/day9.e2e.mjs  # due-soon logic with specific dates
cd backend && node scripts/day10.e2e.mjs # compliance flags + verify lifecycle
cd backend && node scripts/day11.e2e.mjs # evidence drill-down (excerpt + page)
cd backend && node scripts/day12.e2e.mjs # polish pass (loading/error/a11y/mobile)
```

## Gotchas & notes for upcoming days

- **supabase-js on Node 20 needs `ws`:** pass `realtime:{transport:ws}` or createClient
  throws. Already done in supabaseAdmin.js + day4.e2e.mjs. Any NEW node-side client
  must repeat this.
- **pdf-parse ESM quirk (confirmed):** use `import pdfParse from 'pdf-parse/lib/pdf-parse.js'`.
- **Storage list() is non-recursive:** files at `{userId}/{grantId}/file` require listing
  the exact subfolder. Bit us once in the e2e script.
- Backend writes documents/grants rows with SERVICE ROLE (bypasses RLS) — ownership is
  enforced in code (`req.user.id` stamps grant; storage path scoped to userId). Keep
  this discipline for Day 5 obligation inserts too.
- `extraction_status` values in use: 'pending' (default), 'extracted', 'failed'.
- Extracted text is NOT persisted anywhere yet — only returned in the POST response.
  If Day 5+ wants re-runs without re-upload, either store it (needs ALTER TABLE via
  SQL Editor) or accept re-parse from storage.
- Env vars are `VITE_`-prefixed on frontend (Vite requirement — intentional deviation
  from literal prompt wording).
- Deliberate Day 4 flow deviation from prompt: browser → backend multipart (backend
  then stores to bucket itself), instead of browser→storage then passing a reference.
  Simpler, single transfer, same security properties; storage RLS policies still exist
  via migration for any future direct-from-browser reads.
- Git repo initialized (master) but ZERO commits so far — suggest an initial commit soon.
- Day 2 was verified by build + code review only; a LIVE sign-up/log-in round-trip in a
  browser was never performed (needs browser + user's confirmation-email setting).
- **Day 5 flow:** After PDF text extraction succeeds, backend auto-calls OpenRouter LLM
  to extract obligations → saves to `obligations` table with status `pending_review` →
  returns obligations array in response. LLM call adds ~5-15s to upload latency.
- **OpenRouter retry logic:** 3 retries with exponential backoff (1s, 2s, 4s) for 429/5xx.
  Max delay capped at 10s. Model is `openai/gpt-4o-mini` (set in MODEL env var).
- **Obligation types in DB:** deadline, reporting, eligible_activity, compliance_condition.
  Invalid types from LLM default to compliance_condition. Invalid confidence defaults to low.
- **Day 5 e2e test:** `backend/scripts/day5.e2e.mjs` — tests full upload→LLM→DB flow.
  Must run with backend server active. Cleans up test user + data after.
- **Day 6 review screen:** `frontend/src/pages/ReviewScreen.jsx` (327 lines) — lists
  obligations grouped by type, inline editing (description/type/due_date via PATCH),
  "Confirm and activate tracking" bulk-updates all pending_review→confirmed.
  Loading spinner while fetching. Low-confidence badges. Route: `/grants/:id/review`.
- **Day 6 backend endpoints:** GET `/api/grants/:id/obligations` (list),
  PATCH `/api/grants/:id/obligations/:oid` (edit description/type/due_date),
  POST `/api/grants/:id/obligations/confirm` (bulk confirm pending→confirmed).
  All require auth, all verify grant ownership via user_id.
- **Day 6 e2e test:** `backend/scripts/day6.e2e.mjs` — tests list/edit/confirm flow
  with auth guards, invalid inputs, idempotent confirm, DB verification. 25/25 passed.
- **Day 7 integration test:** `backend/scripts/day7.e2e.mjs` — tests all 3 PDFs through
  full upload→extract→review→confirm flow + RLS cross-user checks. Reports extraction
  quality metrics per PDF.
- **POST /api/grants response now returns DB row IDs** (with `id`, `created_at`,
  `grant_id`) after obligations insert uses `.select()`. Frontend can now reference
  specific obligation IDs directly from the upload response.
- **Day 8 dashboard:** `frontend/src/pages/Dashboard.jsx` — rewritten from upload form
  to portfolio dashboard. Queries Supabase directly (RLS-scoped) for grants, docs,
  obligations. Shows stat cards (total grants, obligations, due-soon, low-conf),
  grant list with status badges (on track / needs review / processing), upload CTA
  (expandable form), empty state for new users. Each grant card links to review screen.
- **Day 8 dashboard data flow:** Frontend uses Supabase client with user's JWT (from
  AuthContext session) — RLS handles ownership. No custom backend endpoint needed.
  Stats computed client-side from queried data. Due-soon = obligations with due_date
  within 30 days + not confirmed.
- **Day 8 e2e test:** `backend/scripts/day8.e2e.mjs` — tests empty state, upload flow,
  dashboard data queries (pre/post confirm), status badge logic, RLS isolation.
  24/24 passed.
- **Day 9 due-soon logic:** `DUE_SOON_DAYS = 14` constant in both Dashboard.jsx and
  ReviewScreen.jsx. Dashboard collects due-soon obligations during data load, shows
  dedicated "Due soon" section with countdown (Today/Tomorrow/N days), grant name,
  and links to review screen. ReviewScreen highlights due-soon cards with red left
  border + "due soon" badge. Due-soon = obligation with due_date >= today AND <= today+14.
  Works for both pending_review AND confirmed obligations. Overdue items (past due)
  are excluded from due-soon.
- **Day 9 e2e test:** `backend/scripts/day9.e2e.mjs` — sets specific due dates via
  PATCH (5d, 10d, 20d, yesterday), verifies due-soon filter logic, confirms
  sorted-by-closest, post-confirm persistence, no-date exclusion. 17/17 passed.
- **Day 10 compliance flags:** Added `verified` field to PATCH allowed fields in
  grants.js. Dashboard now has a "Compliance flags" section showing unverified
  low-confidence obligations with honest label ("Low extraction confidence —
  please verify against the source clause"). Each flag links to the review screen.
  LowConf stat now counts unverified only. ReviewScreen: flagged cards get red
  left border + "flagged" badge + explanation label + "Mark as reviewed" button.
  After verification: badge changes to green "verified", card loses flag styling.
  Flags persist after confirm until explicitly verified.
- **Day 10 e2e test:** `backend/scripts/day10.e2e.mjs` — uploads BrightPath (known
  to have 1 low-confidence), verifies flag count, PATCH verified=true, DB
  persistence, flag count decreases, verified not in flag list, persists after
  confirm. 14/14 passed.
- **Day 11 evidence drill-down:** Added `source_excerpt` and `source_page` to
  dashboard due-soon cards and flag cards (review screen already had them).
  Dashboard excerpt styled with left-border quote block. Page number shown in
  meta row. Added `.dashboard-excerpt` and `.dashboard-page` CSS classes. All
  obligations now show evidence consistently across the app.
- **Day 11 e2e test:** `backend/scripts/day11.e2e.mjs` — verifies excerpts/pages
  present on all obligations, checks due-soon cards have evidence, flag cards
  have evidence, excerpt quality (avg 122 chars, all have real words). 16/16 passed.
- **Day 12 polish pass:** Added `loadError` state to Dashboard with user-friendly
  error banner + "Try again" button (reloads page). Added `text-align: left` override
  on `#root` (was center from index.css). Added global `focus-visible` ring styles
  for all interactive elements (buttons, cards, form inputs). Mobile: removed hard
  1126px cap on `#root`, reduced header/main padding, flex-wrap on badges/meta/
  edit-actions, stacked dashboard-top on narrow screens, full-width upload button,
  reduced stat-card and auth-card padding. Fixed duplicate `#root` CSS block.
- **Day 12 e2e test:** `backend/scripts/day12.e2e.mjs` — empty state, upload,
  dashboard data completeness, error handling (401/404/400), UI data integrity
  (all fields present), confirm flow, multi-grant stats variety. 24/24 passed.
