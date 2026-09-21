-- Base multi-tenancy for delphi-mvp.
--
-- src/lib/types/database.ts types `workspaces` and `workspace_members`, but
-- nothing in the app ever created them — onboarding only writes auth user
-- metadata. The Supabase project therefore has auth and nothing else, and every
-- later migration that keys RLS off workspace membership fails without this.
--
-- Column shapes match database.ts exactly so no application code has to change.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  type          text not null default 'personal',
  tier          text not null default 'free',
  owner_id      uuid not null references auth.users(id) on delete cascade,
  enabled_tools text[]
);

create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member',
  unique (workspace_id, user_id)
);

create index if not exists idx_workspaces_owner on public.workspaces(owner_id);
create index if not exists idx_workspace_members_user on public.workspace_members(user_id);
create index if not exists idx_workspace_members_ws on public.workspace_members(workspace_id);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
-- Both are SECURITY DEFINER, which is what makes the policies below terminate.
-- A policy on workspace_members that queried workspace_members through RLS
-- would recurse infinitely — and Postgres only raises that at query time, not
-- when the policy is created, so it looks fine until the first real read.

create or replace function public.delphi_is_workspace_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
  );
$$;

comment on function public.delphi_is_workspace_member(uuid) is
  'True when the current auth user belongs to the given workspace. Used by every Delphi RLS policy.';

create or replace function public.is_workspace_owner(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = ws
      and w.owner_id = auth.uid()
  );
$$;

comment on function public.is_workspace_owner(uuid) is
  'True when the current auth user owns the given workspace. Reads only workspaces, so workspace_members policies can use it without recursing.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- workspaces: owners and members can read; only owners can write.
drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces
  for select
  using (owner_id = auth.uid() or public.delphi_is_workspace_member(id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert
  with check (owner_id = auth.uid());

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
  for delete
  using (owner_id = auth.uid());

-- workspace_members: you can see your own memberships; owners manage the roster.
-- Neither branch touches workspace_members through RLS, so there is no cycle.
drop policy if exists workspace_members_read on public.workspace_members;
create policy workspace_members_read on public.workspace_members
  for select
  using (user_id = auth.uid() or public.is_workspace_owner(workspace_id));

drop policy if exists workspace_members_write on public.workspace_members;
create policy workspace_members_write on public.workspace_members
  for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- Owner auto-enrolment
-- ---------------------------------------------------------------------------
-- Every Delphi policy keys off membership, so an owner who is not also a member
-- would create a workspace and then be unable to see anything inside it.

create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_workspace_owner_member on public.workspaces;
create trigger trg_workspace_owner_member
  after insert on public.workspaces
  for each row execute function public.add_owner_as_member();

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------
-- Creates a workspace for the calling user and returns its id, so a fresh
-- project has somewhere to seed the agent roster. Call it once from the SQL
-- editor while signed in, or from the app.

create or replace function public.bootstrap_workspace(workspace_name text default 'Delphi')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'bootstrap_workspace must be called by an authenticated user';
  end if;

  -- Reuse an existing workspace of the same name rather than piling up copies
  -- when this is run more than once.
  select w.id into ws
  from public.workspaces w
  where w.owner_id = uid and w.name = workspace_name
  limit 1;

  if ws is not null then
    return ws;
  end if;

  insert into public.workspaces (name, owner_id, type, tier)
  values (workspace_name, uid, 'personal', 'free')
  returning id into ws;

  return ws;
end;
$$;

-- `authenticated` is a Supabase-provided role. Guarded so the migration also
-- applies to a plain Postgres (local validation, self-hosting) where it is absent.
do $$
begin
  grant execute on function public.bootstrap_workspace(text) to authenticated;
exception
  when undefined_object then
    raise notice 'Role "authenticated" not present; skipping grant (expected outside Supabase).';
end $$;
