-- ============================================================
-- GrantGuard AI — Day 3: schema + Row Level Security
-- Run this whole file in: Supabase Dashboard > SQL Editor > New query
-- Safe to re-run? No — it creates tables/policies. Run once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------

create table public.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  funder_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.grants (id) on delete cascade,
  file_path text not null,
  uploaded_at timestamptz not null default now(),
  extraction_status text not null default 'pending'
);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.grants (id) on delete cascade,
  type text not null check (
    type in ('deadline', 'reporting', 'eligible_activity', 'compliance_condition')
  ),
  description text not null,
  due_date date,
  source_page integer,
  source_excerpt text not null,
  confidence text not null default 'low' check (confidence in ('high', 'low')),
  status text not null default 'pending_review' check (status in ('pending_review', 'confirmed')),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Speeds up the RLS ownership checks and the common "list my X" queries
create index grants_user_id_idx on public.grants (user_id);
create index documents_grant_id_idx on public.documents (grant_id);
create index obligations_grant_id_idx on public.obligations (grant_id);

-- ------------------------------------------------------------
-- 2. ENABLE ROW LEVEL SECURITY
-- No policy = everything denied for anon/authenticated roles,
-- so we enable it first, then add explicit allow-policies below.
-- ------------------------------------------------------------

alter table public.grants enable row level security;
alter table public.documents enable row level security;
alter table public.obligations enable row level security;

-- ------------------------------------------------------------
-- 3. POLICIES — grants
-- Ownership is direct: grants.user_id must equal the caller's
-- auth.uid(). auth.uid() reads the JWT of whoever is making the
-- request, so a user literally cannot name someone else's rows.
-- ------------------------------------------------------------

-- SELECT own: listing/grabbing a grant only returns it if you own it.
create policy "grants_select_own" on public.grants
  for select
  using (user_id = auth.uid());

-- INSERT own: you may only create grants stamped with YOUR user_id.
-- with-check rejects inserts that try to forge another user's id.
create policy "grants_insert_own" on public.grants
  for insert
  with check (user_id = auth.uid());

-- UPDATE own: you can only edit rows you already own, and cannot
-- re-assign them to someone else via the update.
create policy "grants_update_own" on public.grants
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE own: only the owner can remove their grant.
create policy "grants_delete_own" on public.grants
  for delete
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. POLICIES — documents (ownership via parent grant)
-- Documents have no user_id column; ownership is inherited through
-- the grant they belong to. The EXISTS subquery walks
-- document -> grants.user_id and checks it against the caller.
-- ------------------------------------------------------------

-- SELECT own: visible only if the parent grant belongs to you.
create policy "documents_select_own" on public.documents
  for select
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

-- INSERT own: you may only attach documents to YOUR OWN grants.
create policy "documents_insert_own" on public.documents
  for insert
  with check (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

-- UPDATE own / DELETE own follow the same inheritance rule.
create policy "documents_update_own" on public.documents
  for update
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

create policy "documents_delete_own" on public.documents
  for delete
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 5. POLICIES — obligations (same join-through-grants rule)
-- ------------------------------------------------------------

create policy "obligations_select_own" on public.obligations
  for select
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

create policy "obligations_insert_own" on public.obligations
  for insert
  with check (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

create policy "obligations_update_own" on public.obligations
  for update
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );

create policy "obligations_delete_own" on public.obligations
  for delete
  using (
    exists (
      select 1 from public.grants g
      where g.id = grant_id and g.user_id = auth.uid()
    )
  );
