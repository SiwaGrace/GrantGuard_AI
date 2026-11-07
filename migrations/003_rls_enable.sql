-- ========================================================================
-- GrantGuard AI — SECURITY FIX: enable Row Level Security (RLS).
--
-- WHY: A diagnostic confirmed the `grants` and `obligations` tables
-- currently have RLS DISABLED, so the Supabase anon key can SELECT every
-- user's data. This defeats the "React → Supabase directly (RLS enforced)"
-- model and is the exact class of cross-user data leak this feature guards
-- against.
--
-- This migration:
--   * enables RLS on grants / obligations / documents (services_role
--     bypasses it; the Express backend keeps working unchanged), and
--   * creates OWNER-only policies keyed on auth.uid() — so a logged-in
--     user can only see their own grants and their grants' obligations.
--   * grants NO policy to the `anon` role, so anonymous requests (the
--     share page) can only read via the dedicated anon_grant_summary()
--     function — never the tables.
--
-- Idempotent. Safe to run more than once.
-- Run in the Supabase Dashboard SQL editor, BEFORE the share feature file.
-- ========================================================================

-- ---------- grants: owner-scoped (user_id is on the row) ----------
alter table public.grants enable row level security;

drop policy if exists "grants_select_owner" on public.grants;
create policy "grants_select_owner" on public.grants
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "grants_insert_owner" on public.grants;
create policy "grants_insert_owner" on public.grants
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "grants_update_owner" on public.grants;
create policy "grants_update_owner" on public.grants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "grants_delete_owner" on public.grants;
create policy "grants_delete_owner" on public.grants
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------- obligations: owner via grant join (no user_id column) ----------
alter table public.obligations enable row level security;

drop policy if exists "obligations_select_owner" on public.obligations;
create policy "obligations_select_owner" on public.obligations
  for select to authenticated
  using (
    grant_id in (select id from public.grants where user_id = auth.uid())
  );

drop policy if exists "obligations_update_owner" on public.obligations;
create policy "obligations_update_owner" on public.obligations
  for update to authenticated
  using (grant_id in (select id from public.grants where user_id = auth.uid()))
  with check (grant_id in (select id from public.grants where user_id = auth.uid()));

-- ---------- documents: owner via grant join ----------
alter table public.documents enable row level security;

drop policy if exists "documents_select_owner" on public.documents;
create policy "documents_select_owner" on public.documents
  for select to authenticated
  using (grant_id in (select id from public.grants where user_id = auth.uid()));

-- NOTE: obligations/documents INSERT + DELETE are performed by the Express
-- backend under service_role, which bypasses RLS — no anon/client policy is
-- needed or granted for them. No policy is granted to `anon` anywhere, so
-- anonymous users are blocked from all direct table access.
