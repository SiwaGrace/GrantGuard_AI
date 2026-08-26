# GrantGuard AI — OpenCode Prompt List (14 Days)

Stack: React (frontend, talks to Supabase directly for auth/CRUD) + Node/Express
(one small service, only for PDF extraction + OpenRouter calls) + Supabase (auth,
Postgres, storage) + Render (Express service) + Vercel (frontend).

Paste one day's prompt into OpenCode at a time. Each prompt assumes OpenCode can see
the real repo state from previous days — it should verify what actually exists before
building on it, not just trust this description.

---

## Day 1 — Project setup

```
Set up the initial project structure for GrantGuard AI, a grant compliance assistant.

Stack:
- Frontend: React + Vite, will talk directly to Supabase for auth and data (no custom 
  backend for CRUD)
- Backend: one small Node/Express service, used ONLY for PDF text extraction and 
  calling the OpenRouter API (LLM calls must never happen from the frontend, since 
  that would expose the API key)
- Database + Auth + Storage: Supabase (I will create the Supabase project separately 
  and provide the URL/keys)

TASKS:
1. Create /frontend — React + Vite app, install @supabase/supabase-js, set up a 
   Supabase client singleton that reads SUPABASE_URL and SUPABASE_ANON_KEY from env vars.
2. Create /backend — Node/Express app. Install express, pdf-parse, dotenv, cors, and 
   a fetch-capable HTTP client if not using native fetch. Set up a basic server with 
   a GET /health endpoint.
3. Create .env.example files for both frontend and backend listing every env var 
   needed (SUPABASE_URL, SUPABASE_ANON_KEY for frontend; SUPABASE_URL, 
   SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY, MODEL for backend).
4. Set up CORS on the Express service to allow requests from the frontend's local 
   dev URL (localhost:5173).
5. Confirm both apps run locally and give me the exact commands to start each.

Do not build any features yet — this is scaffolding only. Show me the resulting 
folder structure when done.
```

---

## Day 2 — Authentication with Supabase

```
Add authentication to GrantGuard AI using Supabase Auth (email/password).

TASKS:
1. On the frontend, build Sign Up, Login, and Logout using supabase-js's built-in 
   auth methods (supabase.auth.signUp, signInWithPassword, signOut) — do not build 
   custom auth logic, Supabase handles this.
2. Add an auth context/provider that tracks the current session and exposes it to 
   the rest of the app.
3. Protect app routes: if there's no active session, redirect to the login page.
4. Build simple, clean Sign Up and Login pages/forms with basic validation and 
   error display (e.g. wrong password, email already in use).
5. Confirm session persistence works — refreshing the page should not log the user out.

Verify by actually signing up a test user and logging in/out, and tell me the result.
```

---

## Day 3 — Database schema + Row Level Security

```
Set up the GrantGuard AI database schema in Supabase and secure it with Row Level 
Security (RLS).

TASKS:
1. Design and create these tables via Supabase SQL (show me the SQL before running 
   it, or write it as a migration file):
   - grants (id, user_id, name, funder_name, status, created_at)
   - documents (id, grant_id, file_path, uploaded_at, extraction_status)
   - obligations (id, grant_id, type [deadline/reporting/eligible_activity/
     compliance_condition], description, due_date nullable, source_page, 
     source_excerpt, confidence [high/low], status [pending_review/confirmed], 
     created_at)
2. Every table that stores user-owned data must have RLS enabled, with policies 
   ensuring a user can only SELECT/INSERT/UPDATE/DELETE rows they own (directly via 
   user_id on grants, and via a join to grants.user_id for documents/obligations).
3. Write the RLS policies explicitly and explain what each one does — this is the 
   most important security boundary in the whole app, so do not skip or simplify it.
4. Show me how to verify RLS is working: what happens if I try to query another 
   user's grant while logged in as a different user (it should return nothing).

Confirm the schema and policies are applied, and give me a quick way to test RLS 
is actually enforced, not just defined.
```

---

## Day 4 — Document upload + text extraction

```
Build the grant agreement upload and text extraction flow.

TASKS:
1. Frontend: an upload UI where a logged-in user selects a PDF and uploads it to a 
   Supabase Storage bucket (create a "grant-documents" bucket if it doesn't exist, 
   scoped so a user can only access their own files — mirror the RLS approach from 
   the database).
2. After upload, the frontend calls the Express backend with a reference to the 
   uploaded file (e.g. storage path), not the raw file itself if avoidable.
3. Backend: an endpoint that fetches the PDF from Supabase Storage (using the 
   service role key, since this is a trusted backend context), extracts its text 
   using pdf-parse, and returns the raw extracted text.
4. Handle the case where a PDF has no extractable text (e.g. it's a scanned image) 
   — detect near-empty extraction and return a clear error rather than silently 
   proceeding with empty text.
5. Save a documents row (grant_id, file_path, extraction_status) once this step 
   completes.

Test with a real PDF and confirm you get real extracted text back, and show me what 
the empty-PDF error case looks like.
```

---

## Day 5 — AI obligation extraction (core feature)

```
Build the core AI extraction step: turn raw grant agreement text into a structured 
list of obligations.

TASKS:
1. On the backend, write a function that sends the extracted text to OpenRouter 
   (model from the MODEL env var) with a system prompt instructing it to return ONLY 
   valid JSON: an array of obligations, each with { type, description, due_date 
   (nullable), source_page, source_excerpt (the exact clause text this came from), 
   confidence ("high" or "low") }.
2. Types should be one of: deadline, reporting, eligible_activity, compliance_condition.
3. Add defensive JSON parsing: strip markdown code fences if present, try/catch the 
   parse, and if parsing fails, return a clear error rather than crashing or 
   returning garbage to the frontend.
4. Save the parsed obligations to the obligations table with status "pending_review".
5. Wire this into the flow: after Day 4's text extraction succeeds, automatically 
   trigger this extraction step.
6. Add basic retry logic for rate-limit/server errors from OpenRouter (2-3 retries 
   with backoff), same pattern as a typical LLM API wrapper.

Test end-to-end with a real grant PDF and show me the actual structured obligations 
list that comes out.
```

---

## Day 6 — Obligation review screen

```
Build the screen where a user reviews and confirms the AI-extracted obligations 
before they're activated.

TASKS:
1. Frontend: a review screen listing all obligations for a given document/grant, 
   grouped or badged by type (Deadline, Reporting, Eligible activity, Compliance 
   condition), with a visible "needs review" indicator for any marked confidence: low.
2. Each obligation should show its source_excerpt so the user can verify it against 
   the original clause without reopening the PDF.
3. Allow inline editing: the user can correct the description, due date, or type of 
   any obligation before confirming.
4. A "Confirm and activate tracking" action that updates all obligations for this 
   grant from status "pending_review" to "confirmed", and updates the grant's 
   overall status.
5. Handle the empty/loading state while extraction (Day 5) is still processing — 
   don't show a blank screen, show a clear "processing" state.

Walk me through the full flow after this: upload a PDF, wait for extraction, land on 
this review screen, edit something, confirm, and tell me what changed in the database.
```

---

## Day 7 — Buffer + integration testing

```
Do an integration pass over the full flow built so far: sign up → log in → upload a 
grant agreement → text extraction → AI obligation extraction → review screen → 
confirm.

TASKS:
1. Test this flow with at least 2-3 different real or realistic sample grant 
   agreement PDFs (different lengths/structures) and tell me what breaks or looks 
   wrong with each one.
2. Pay particular attention to the AI extraction step (Day 5) — flag any cases where 
   the obligation list looks clearly wrong, incomplete, or where the JSON parsing 
   failed, and suggest specific prompt adjustments to fix it.
3. Fix any bugs found in the chain from upload through confirmation.
4. Check RLS is still correctly scoping data — try accessing another test user's 
   grant and confirm it's blocked.

Give me a summary of what you tested, what you found, and what you fixed.
```

---

## Day 8 — Portfolio dashboard

```
Build the portfolio dashboard — the main screen a logged-in user lands on.

TASKS:
1. Query Supabase directly from the frontend (respecting RLS, no custom backend 
   endpoint needed for this) to get: total active grants, count of obligations due 
   soon, count of flagged/low-confidence obligations, total obligations tracked.
2. Build the dashboard UI: stat cards at the top, followed by a list of the user's 
   grants with a status badge per grant (on track / needs review / processing).
3. Each grant in the list should link to its review/detail screen.
4. Add an "Upload agreement" call-to-action prominently on this screen, since it's 
   the main entry point into the whole flow.
5. Handle the empty state for a brand new user with zero grants — a clear invitation 
   to upload their first one, not a blank/broken-looking screen.

Show me the dashboard with real data from at least one confirmed grant.
```

---

## Day 9 — Deadline "due soon" logic

```
Add logic to surface obligations with an approaching due date.

TASKS:
1. On the frontend (or via a Supabase query/view), identify confirmed obligations 
   with a due_date within the next 14 days (make this window a constant that's easy 
   to change later).
2. Surface these on the dashboard as a distinct "due soon" section or count, and on 
   the relevant grant's detail view.
3. Keep this in-app only for now (no email/SMS) — a clearly visible list is enough 
   for the MVP.
4. Make sure the "due soon" state considers today's actual date dynamically, not a 
   hardcoded date.

Show me the dashboard with at least one obligation that falls inside the due-soon 
window, and confirm it's correctly highlighted.
```

---

## Day 10 — Compliance flags

```
Surface obligations that need review due to low AI extraction confidence as 
compliance flags.

TASKS:
1. Anywhere an obligation has confidence: "low" (already captured back in Day 5), 
   make sure it's clearly flagged both on the dashboard (a count/badge) and on the 
   grant's obligation list (a distinct visual treatment, not just a small icon).
2. Add a short, honest label explaining why it's flagged (e.g. "Low extraction 
   confidence — please verify against the source clause"), not just a generic warning.
3. Confirm flagged obligations remain visually distinct even after a user edits and 
   confirms them, until they're explicitly marked as verified (add a 
   "verified"/reviewed boolean if this distinction doesn't exist yet).

Show me a flagged obligation from creation through to being marked reviewed.
```

---

## Day 11 — Evidence drill-down

```
Improve the evidence trail so every obligation is easy to verify against its source.

TASKS:
1. On any obligation (dashboard, review screen, or detail view), clicking it should 
   show its full source_excerpt clearly, not just a page number reference.
2. If feasible without much extra complexity, show the source_page number alongside 
   the excerpt so a user could find it in the original PDF quickly.
3. This should work everywhere an obligation appears in the app, not just on the 
   original review screen — consistency matters here since "always traceable to 
   evidence" is a core product promise.

Show me this working from at least two different places in the app where an 
obligation is displayed.
```

---

## Day 12 — Polish pass

```
Do a polish pass across the whole app — no new features, just quality.

TASKS:
1. Add proper loading states everywhere an async action happens (upload, extraction, 
   dashboard data fetch) — no blank screens during a wait.
2. Add proper error states (failed upload, failed extraction, network error) with 
   clear, non-technical messages a real user would understand.
3. Confirm empty states are handled everywhere (no grants yet, no obligations yet, 
   no flags yet).
4. Do a full mobile responsiveness pass — test at a narrow viewport width and fix 
   anything broken or unusable.
5. Do a quick accessibility check: color is never the only signal for status (pair 
   with text/icon), and interactive elements have visible focus states.

Give me a list of what you found and fixed in this pass.
```

---

## Day 13 — Deployment

```
Deploy GrantGuard AI to production.

TASKS:
1. Deploy the Express backend (PDF extraction + OpenRouter service) to Render. Set 
   production environment variables there: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 
   OPENROUTER_API_KEY, MODEL. Lock CORS to the real production frontend URL only.
2. Deploy the React frontend to Vercel. Set production environment variables there: 
   SUPABASE_URL, SUPABASE_ANON_KEY, and the production Express backend URL.
3. Confirm Supabase itself needs no separate deployment, but double check the 
   production frontend/backend URLs are what's actually allowed in Supabase's auth 
   redirect URL settings if relevant.
4. Test the FULL flow on the live deployed URLs (not localhost): sign up, log in, 
   upload a real grant PDF, go through extraction, review, confirm, check the 
   dashboard.
5. Fix anything that only breaks in production (env var mismatches, CORS errors, 
   cold-start timeouts on the free tier).

Give me the final live URLs and confirm the full flow works end-to-end on them.
```

---

## Day 14 — Buffer + demo prep

```
Final pass before demoing GrantGuard AI.

TASKS:
1. Fix any remaining issues found from using the live deployed app one more time, 
   start to finish.
2. Check that a first-time visitor with no prior context can understand what the 
   app does within the first screen or two.
3. Prepare a short README with: what the app does, the tech stack, how to run it 
   locally, and the live deployed URLs.
4. Suggest a realistic demo script: which grant PDF to upload live, what to point 
   out at each step (extraction quality, source-linked evidence, dashboard, flags), 
   and roughly how long each part should take to stay within a short demo window.

Give me the finished README and the suggested demo script.
```
