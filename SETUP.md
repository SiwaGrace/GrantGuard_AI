# Local setup

How to run GrantGuard AI on your own machine, against **your own** Supabase project and Groq API key.

You need:

- Node.js 18 or newer (`node -v`)
- A free [Supabase](https://supabase.com) account
- A free [Groq](https://console.groq.com) account (Groq, the inference provider, not xAI's Grok)

---

## 1. Create a Supabase project

1. In the Supabase dashboard, click **New project** and wait for it to finish provisioning.
2. Open **Project Settings → API** (called **API Keys** in newer dashboards) and note down three values. You will paste them into `.env` files in step 5:
   - **Project URL**
   - **anon / publishable** key (safe for the browser)
   - **service_role / secret** key (backend only, never put it in the frontend or commit it)

## 2. Run the SQL migrations, in order

Open **SQL Editor → New query** in Supabase. For each file below, paste its entire contents and click **Run**. Run them one at a time, in this order:

| # | File | What it does |
|---|------|--------------|
| 1 | [`migrations/001_init_schema.sql`](migrations/001_init_schema.sql) | Creates the `grants`, `documents` and `obligations` tables, indexes, and Row Level Security policies |
| 2 | [`migrations/002_storage_bucket.sql`](migrations/002_storage_bucket.sql) | Creates the private `grant-documents` storage bucket and its access policies |
| 3 | [`migrations/003_rls_enable.sql`](migrations/003_rls_enable.sql) | Re-asserts RLS and owner-only policies (safe to re-run) |
| 4 | [`migrations/004_add_grant_share.sql`](migrations/004_add_grant_share.sql) | Adds `share_token` and the `anon_grant_summary()` function used by the funder share link (safe to re-run) |
| 5 | [`migrations/005_obligation_completed.sql`](migrations/005_obligation_completed.sql) | Adds `completed_at` so obligations can be marked as done; past-due obligations that aren't done show as overdue (safe to re-run) |
| 6 | [`migrations/006_grant_number.sql`](migrations/006_grant_number.sql) | Adds `grant_number`, the agreement's own reference number (e.g. GD-2026-WASH-0417) found at upload (safe to re-run) |

> `001_init_schema.sql` is **not** safe to run twice. It fails with "relation already exists". If that happens, the tables are already there and you can move on to file 2.

## 3. Check the storage bucket

Migration 2 should have created the bucket. To confirm:

1. Open **Storage** in the Supabase dashboard.
2. You should see a bucket called **`grant-documents`**, marked **private**.

If it is missing, click **New bucket**, name it exactly `grant-documents`, leave **Public bucket** switched **off**, and save. Then re-run `002_storage_bucket.sql` so the access policies are created.

## 4. Turn off email confirmation (local testing only)

By default, Supabase makes new users click a confirmation link before they can log in. For local testing that just gets in the way:

1. Go to **Authentication → Sign In / Providers** (in older dashboards: **Authentication → Providers**).
2. Open **Email** and switch **Confirm email** off, then save.

Now sign-up logs you straight in. Turn it back on for anything public.

## 5. Get a Groq API key

1. Go to [console.groq.com/keys](https://console.groq.com/keys).
2. Click **Create API Key** and copy it. Groq only shows the key once.

## 6. Create the `.env` files

Both `.env` files are gitignored. **Never commit them.** Start from the examples:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

**`backend/.env`**

| Variable | What to put |
|----------|-------------|
| `SUPABASE_URL` | Your Project URL from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role / secret key from step 1 |
| `GROQ_API_KEY` | Your Groq key from step 5 |
| `MODEL` | Groq model for extraction. Leave it as `openai/gpt-oss-120b` |
| `CHAT_MODEL` | *(optional)* A different Groq model for the chat assistant. Falls back to `MODEL` |
| `MAX_EXTRACT_CHARS` | *(optional)* How many characters of a PDF are sent to the AI, cut at a page boundary. Default `40000` (about 10k tokens). Lower it if Groq returns "request too large" |
| `PORT` | `4000` |
| `CORS_ORIGIN` | `http://localhost:5173` |

**`frontend/.env`**

| Variable | What to put |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | Your anon / publishable key from step 1 |
| `VITE_API_URL` | `http://localhost:4000` |

## 7. Install dependencies (Windows)

From the repo root:

```powershell
npm run install:all
```

This runs `npm install` in the root, `backend/` and `frontend/`.

> **Use `npm install`, not `npm ci`.** The lockfiles were generated on another operating system. With `npm ci`, the Windows native binaries for Vite (rolldown) and the linter (oxlint) are skipped and the build crashes with `Cannot find module '@rolldown/binding-win32-x64-msvc'`. `npm install` fetches them correctly.
>
> `npm install` may add a few `"peer": true` lines to the `package-lock.json` files. They are harmless; throw them away with `git checkout -- package-lock.json backend/package-lock.json frontend/package-lock.json` so they don't end up in a commit.

## 8. Run it

```powershell
npm run dev
```

This starts both apps:

- Backend at <http://localhost:4000>. <http://localhost:4000/health> should return `{"status":"ok",...}`.
- Frontend at <http://localhost:5173>.

Then:

1. Open <http://localhost:5173> and click **Create account**.
2. Click **Upload Grant**.
3. Choose [`samples/Sample_Grant_1_GlobalDev_WASH.pdf`](samples/Sample_Grant_1_GlobalDev_WASH.pdf) and click **Analyze**.
4. After a few seconds you land on the review screen with the extracted obligations.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend exits with `Missing Supabase config` | `backend/.env` is missing or `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` is empty |
| White screen, console says `Missing Supabase config` | `frontend/.env` is missing values. Restart `npm run dev` after editing it |
| Upload fails with "Could not store the PDF" | The `grant-documents` bucket is missing. See step 3 |
| "PDF contains too little extractable text" | The PDF is a scanned image. Use a text-based PDF |
| Upload says "AI extraction failed" | Check `GROQ_API_KEY`. A `429` means Groq's free-tier rate limit; wait a minute and click **Retry** on the dashboard |
| Share link page says "This link could not be loaded" | Migration 4 (`004_add_grant_share.sql`) hasn't been run |
| Login says "Email not confirmed" | Email confirmation is still on. See step 4 |

## Optional: share-link security test

`backend/tests/share_summary.test.mjs` verifies that the public share link exposes only what it should. It needs the anon key as well:

```powershell
cd backend
$env:SUPABASE_URL="<project url>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
$env:SUPABASE_ANON_KEY="<anon key>"
node tests/share_summary.test.mjs
```
