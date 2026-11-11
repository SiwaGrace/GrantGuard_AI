-- ============================================================
-- GrantGuard AI — 007: alert actions.
--
-- snoozed_until hides an obligation from Overdue / Due soon until the
-- timestamp passes. NULL means it is not snoozed.
--
-- flag_verified_at records when a low-confidence clause was checked.
-- `verified` remains the field the app reads for its Flagged count, so
-- existing rows and the Review screen keep working unchanged.
--
-- Run in: Supabase Dashboard > SQL Editor. Safe to re-run.
-- ============================================================

alter table public.obligations
  add column if not exists snoozed_until timestamptz,
  add column if not exists flag_verified_at timestamptz;
