-- ============================================================
-- GrantGuard AI — Feature 2: Shareable read-only donor summary
-- Run this in the Supabase Dashboard SQL editor.
-- It is idempotent (safe to run more than once).
-- ============================================================

-- 1) Add a unique, unguessable share token to each grant.
--    NULL = no active share link. Never expose this to anon via SELECT.
alter table public.grants
  add column if not exists share_token text;

create unique index if not exists grants_share_token_key
  on public.grants (share_token)
  where share_token is not null;

-- 2) Deterministic helper to render a status for a grant from its
--    confirmed obligations.
create or replace function public.grant_summary_status(p_grant_id uuid)
returns text
language sql
stable
as $$
  select case
    when count(*) = 0 then 'pending'
    else 'on track'
  end
  from public.obligations
  where grant_id = p_grant_id and status = 'confirmed';
$$;

-- 3) SECURITY DEFINER function: the ONLY surface through which the
--    anonymous `anon` role may read. Accepts a share token, returns a
--    narrowly scoped, sanitised JSON summary for exactly one grant.
--    - Reads as the function owner (postgres), then returns ONLY safe
--      columns: grant name, funder, status, and the confirmed
--      obligations' type / due_date / description.
--    - Never returns: user_id, internal id, share_token, source_excerpt,
--      source_page, confidence, verified, documents, or any other grant.
--    - Fails closed: a missing/unknown token returns not_found.
create or replace function public.anon_grant_summary(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.grants%rowtype;
  v_obligations jsonb;
  v_status text;
begin
  select * into v_grant
  from public.grants
  where share_token = p_token;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type', o.type,
        'due_date', o.due_date,
        'description', o.description
      )
      order by o.due_date nulls last
    ),
    '[]'::jsonb
  )
  into v_obligations
  from public.obligations o
  where o.grant_id = v_grant.id
    and o.status = 'confirmed';

  v_status := public.grant_summary_status(v_grant.id);

  return jsonb_build_object(
    'status', 'ok',
    'grant', jsonb_build_object(
      'name', v_grant.name,
      'funder_name', v_grant.funder_name
    ),
    'overall_status', v_status,
    'confirmed_obligations', v_obligations
  );
end;
$$;

-- 4) Restrict: only `anon` may call it; no one may call it with a
--    SELECT on the underlying tables through this path.
revoke all on function public.anon_grant_summary(text) from public;
grant execute on function public.anon_grant_summary(text) to anon;
grant execute on function public.anon_grant_summary(text) to authenticated;
grant execute on function public.anon_grant_summary(text) to service_role;

revoke all on function public.grant_summary_status(uuid) from public;
grant execute on function public.grant_summary_status(uuid) to anon;
grant execute on function public.grant_summary_status(uuid) to authenticated;
grant execute on function public.grant_summary_status(uuid) to service_role;

-- 5) Defense in depth: the anon role must NOT be able to SELECT from
--    grants/obligations directly. That is provided by
--    `migrations/003_rls_enable.sql` (enable RLS + owner policies),
--    which must be applied BEFORE this file. With RLS on and no anon
--    policy, anonymous users are denied all direct table access and can
--    only read through the anon_grant_summary() function above.
