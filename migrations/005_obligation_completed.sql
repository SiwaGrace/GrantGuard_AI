-- ============================================================
-- GrantGuard AI — 005: let users mark an obligation as done.
--
-- status = 'confirmed' only means the AI's extraction was checked by a
-- person. completed_at records that the obligation itself was fulfilled
-- (report submitted, audit done, ...). NULL = not done yet, so a past
-- due_date with completed_at NULL is overdue.
--
-- Run in: Supabase Dashboard > SQL Editor. Safe to re-run.
-- ============================================================

alter table public.obligations
  add column if not exists completed_at timestamptz;
