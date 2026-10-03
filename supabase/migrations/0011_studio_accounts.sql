-- ---------------------------------------------------------------------------
-- The Studio: media accounts, production tasks, and a home for the files.
--
-- A department that produces for YouTube or a social page needs to know
-- *which* channel or page each piece is for. One account is one channel or
-- page: its platform, its handle, and the preferences that shape everything
-- made for it — niche, audience, tone, format, length, brand colours, voice.
-- Delphi plans one production chain per account, so two channels never share
-- a script, and the studio renders each deliverable to that account's
-- preferences.
--
-- Tasks gain a deliverable. 'text' is what every task has been until
-- now. The four formats (short, landscape, post, carousel) are produced by
-- the studio rather than written:
-- the agent plans the piece, and ffmpeg renders it.
--
-- Rendered files live in Supabase Storage, in the bucket the Outputs library
-- has always expected and nothing had yet written to. Paths start with the
-- workspace id, which is what the storage policies key on.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

create table if not exists public.delphi_media_accounts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid references public.delphi_departments(id) on delete set null,
  platform       text not null check (platform in (
                   'youtube','instagram','tiktok','facebook','x','linkedin','threads','other')),
  name           text not null,
  handle         text,
  url            text,
  status         text not null default 'active' check (status in ('active','paused')),
  -- Content preferences and brand kit. Shaped and defaulted in code
  -- (src/lib/studio/accounts.ts), stored loosely so a new preference does not
  -- need a migration.
  preferences    jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, platform, name)
);

create index if not exists idx_delphi_media_accounts_ws
  on public.delphi_media_accounts(workspace_id, department_id);

comment on table public.delphi_media_accounts is
  'One YouTube channel or social page a department produces for, with the preferences that shape what is made for it.';

alter table public.delphi_media_accounts enable row level security;

drop policy if exists delphi_media_accounts_member_read on public.delphi_media_accounts;
create policy delphi_media_accounts_member_read on public.delphi_media_accounts
  for select using (public.delphi_is_workspace_member(workspace_id));

drop policy if exists delphi_media_accounts_owner_insert on public.delphi_media_accounts;
create policy delphi_media_accounts_owner_insert on public.delphi_media_accounts
  for insert with check (public.is_workspace_owner(workspace_id));

drop policy if exists delphi_media_accounts_owner_update on public.delphi_media_accounts;
create policy delphi_media_accounts_owner_update on public.delphi_media_accounts
  for update using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists delphi_media_accounts_owner_delete on public.delphi_media_accounts;
create policy delphi_media_accounts_owner_delete on public.delphi_media_accounts
  for delete using (public.is_workspace_owner(workspace_id));

-- --- tasks: which account, and what kind of thing ---------------------------

alter table public.delphi_tasks
  add column if not exists account_id uuid references public.delphi_media_accounts(id) on delete set null;

alter table public.delphi_tasks
  add column if not exists deliverable text not null default 'text';

alter table public.delphi_tasks
  drop constraint if exists delphi_tasks_deliverable_check;

alter table public.delphi_tasks
  add constraint delphi_tasks_deliverable_check
  check (deliverable in ('text','short','landscape','post','carousel'));

comment on column public.delphi_tasks.deliverable is
  'text: the agent writes it. short, landscape, post, carousel: the agent plans it and the studio renders it.';

-- --- artifacts: filterable by account --------------------------------------

alter table public.delphi_artifacts
  add column if not exists account_id uuid references public.delphi_media_accounts(id) on delete set null;

create index if not exists idx_delphi_artifacts_account
  on public.delphi_artifacts(account_id, created_at desc);

-- --- storage: the bucket, private, 50 MB a file -----------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('delphi-artifacts', 'delphi-artifacts', false, 52428800)
on conflict (id) do nothing;

-- Objects are filed under <workspace id>/<project id>/<task id>/<run>/<file>,
-- so the first folder names the workspace and the ordinary membership check
-- applies. Members read; the owner writes; the engine's cron is the service
-- role and is not subject to these.
--
-- The folder is checked to be a uuid before it is cast to one, inside a CASE:
-- Postgres does not promise to evaluate AND in order, and a cast that ran
-- first on some other bucket's object would fail that bucket's reads.
create or replace function public.delphi_storage_workspace(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function public.delphi_storage_workspace(text) is
  'The workspace a delphi-artifacts object belongs to: its first folder, when that is a uuid; otherwise null, which no policy admits.';

drop policy if exists delphi_artifacts_member_read_objects on storage.objects;
create policy delphi_artifacts_member_read_objects on storage.objects
  for select using (
    bucket_id = 'delphi-artifacts'
    and coalesce(public.delphi_is_workspace_member(public.delphi_storage_workspace(name)), false)
  );

drop policy if exists delphi_artifacts_owner_insert_objects on storage.objects;
create policy delphi_artifacts_owner_insert_objects on storage.objects
  for insert with check (
    bucket_id = 'delphi-artifacts'
    and coalesce(public.is_workspace_owner(public.delphi_storage_workspace(name)), false)
  );

drop policy if exists delphi_artifacts_owner_update_objects on storage.objects;
create policy delphi_artifacts_owner_update_objects on storage.objects
  for update using (
    bucket_id = 'delphi-artifacts'
    and coalesce(public.is_workspace_owner(public.delphi_storage_workspace(name)), false)
  );

drop policy if exists delphi_artifacts_owner_delete_objects on storage.objects;
create policy delphi_artifacts_owner_delete_objects on storage.objects
  for delete using (
    bucket_id = 'delphi-artifacts'
    and coalesce(public.is_workspace_owner(public.delphi_storage_workspace(name)), false)
  );
