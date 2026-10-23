-- ============================================================
-- GrantGuard AI — 006: store the agreement's own reference number.
--
-- grant_number is the funder's grant/agreement/reference number as written
-- in the document (e.g. "GD-2026-WASH-0417"), extracted at upload time.
-- NULL when none was found; the app then shows a short internal ID.
--
-- Run in: Supabase Dashboard > SQL Editor. Safe to re-run.
-- ============================================================

alter table public.grants
  add column if not exists grant_number text;
