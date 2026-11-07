-- ============================================================
-- GrantGuard AI — Day 4: private storage bucket for grant PDFs
-- Run this whole file in: Supabase Dashboard > SQL Editor > New query
-- Safe to re-run? Yes (bucket insert uses ON CONFLICT; policies
-- are dropped first if they exist).
-- ============================================================

-- ------------------------------------------------------------
-- 1. BUCKET
-- Private bucket: files are only readable through the backend
-- (service-role key) or via signed URLs we generate on demand.
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('grant-documents', 'grant-documents', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. POLICIES
-- Same ownership model as the DB tables: a user may only touch
-- objects whose FIRST path folder is their own auth.uid().
-- Upload path convention enforced here:
--   {user_id}/{grant_id}/{filename}
-- The backend bypasses these policies (service role), so these
-- guard any future direct-from-browser access.
-- ------------------------------------------------------------

drop policy if exists "grant_documents_select_own" on storage.objects;
drop policy if exists "grant_documents_insert_own" on storage.objects;
drop policy if exists "grant_documents_update_own" on storage.objects;
drop policy if exists "grant_documents_delete_own" on storage.objects;

create policy "grant_documents_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'grant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "grant_documents_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'grant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "grant_documents_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'grant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'grant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "grant_documents_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'grant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
