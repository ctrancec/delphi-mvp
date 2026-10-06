-- ---------------------------------------------------------------------------
-- Departments by kind: settings, rooms, compartments, playbooks and ideas.
--
-- Run after 0009, 0010 and 0011. Covers everything the four department
-- pushes use, so it is run once.
--
--   departments   a kind (research, studio, general) and the CHO's settings
--                 for it: house rules, notes per role, pinned agents, how
--                 much Diablo decides alone, the schedule.
--   threads       rooms: one per department and one per channel, alongside
--                 the board's review threads and the CEO conversation.
--   messages      an action card, and the work a message carries.
--   memories      a channel compartment of its own (account_id), the
--                 'account' scope and the 'decision' kind. Lessons that were
--                 filed organisation-wide but came from a department move to
--                 that department, which is where recall now looks.
--   playbooks     how a department works, approved once: the steps and who
--                 does them. A studio has one per channel.
--   projects      a project becomes one run of a playbook: for a channel, at
--                 a scheduled time, on an approved idea.
--   ideas         topics per channel: proposed, approved, made, published.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

-- --- departments -------------------------------------------------------------

alter table public.delphi_departments
  add column if not exists kind text not null default 'research';

alter table public.delphi_departments
  drop constraint if exists delphi_departments_kind_check;

alter table public.delphi_departments
  add constraint delphi_departments_kind_check
  check (kind in ('research','studio','general'));

alter table public.delphi_departments
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column public.delphi_departments.kind is
  'research: reports on a schedule. studio: video and images for channels. general: anything else.';
comment on column public.delphi_departments.settings is
  'The CHO''s settings: house rules, role notes, pinned agents, autonomy, schedule, research setup. Shaped in src/lib/delphi/kinds.';

-- --- playbooks --------------------------------------------------------------

create table if not exists public.delphi_playbooks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid not null references public.delphi_departments(id) on delete cascade,
  -- Null for a department's own playbook; set for a channel's.
  account_id     uuid references public.delphi_media_accounts(id) on delete cascade,
  steps          jsonb not null default '[]'::jsonb,
  status         text not null default 'approved' check (status in ('approved','retired')),
  approved_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- One live playbook per department, and one per channel.
create unique index if not exists uniq_delphi_playbook_department
  on public.delphi_playbooks(department_id) where status = 'approved' and account_id is null;
create unique index if not exists uniq_delphi_playbook_account
  on public.delphi_playbooks(account_id) where status = 'approved' and account_id is not null;

comment on table public.delphi_playbooks is
  'How a department (or one of its channels) works: the ordered steps and who does each. A project is one run of it.';

-- --- ideas ------------------------------------------------------------------

create table if not exists public.delphi_ideas (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid not null references public.delphi_departments(id) on delete cascade,
  account_id     uuid not null references public.delphi_media_accounts(id) on delete cascade,
  title          text not null,
  angle          text,
  format         text check (format in ('short','landscape','post','carousel')),
  status         text not null default 'proposed' check (status in (
                   'proposed','approved','rejected','scheduled','made','published')),
  source         text not null default 'team' check (source in ('team','cho','chat')),
  scheduled_for  timestamptz,
  project_id     uuid references public.delphi_projects(id) on delete set null,
  artifact_id    uuid references public.delphi_artifacts(id) on delete set null,
  published_url  text,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_delphi_ideas_account
  on public.delphi_ideas(account_id, status, created_at desc);

comment on table public.delphi_ideas is
  'Topics for one channel. The strategist proposes; the CHO approves (or the team picks); an approved idea becomes an episode.';

-- --- projects: one run of a playbook ----------------------------------------

alter table public.delphi_projects
  add column if not exists playbook_id uuid references public.delphi_playbooks(id) on delete set null;
alter table public.delphi_projects
  add column if not exists account_id uuid references public.delphi_media_accounts(id) on delete set null;
alter table public.delphi_projects
  add column if not exists scheduled_for timestamptz;
alter table public.delphi_projects
  add column if not exists idea_id uuid references public.delphi_ideas(id) on delete set null;

-- A slot starts once. Two ticks reaching the same slot is the double start
-- this exists to make impossible.
create unique index if not exists uniq_delphi_project_slot
  on public.delphi_projects(playbook_id, scheduled_for)
  where playbook_id is not null and scheduled_for is not null;

create index if not exists idx_delphi_projects_account
  on public.delphi_projects(account_id, created_at desc);

-- --- threads: rooms ---------------------------------------------------------

alter table public.delphi_threads
  add column if not exists department_id uuid references public.delphi_departments(id) on delete cascade;
alter table public.delphi_threads
  add column if not exists account_id uuid references public.delphi_media_accounts(id) on delete cascade;
alter table public.delphi_threads
  add column if not exists kind text not null default 'review';

alter table public.delphi_threads
  drop constraint if exists delphi_threads_kind_check;
alter table public.delphi_threads
  add constraint delphi_threads_kind_check check (kind in ('review','ceo','room'));

update public.delphi_threads set kind = 'ceo'
  where kind = 'review' and review_id is null and project_id is null
    and title = 'Conversation with Delphi';

create unique index if not exists uniq_delphi_room_department
  on public.delphi_threads(department_id) where kind = 'room' and account_id is null;
create unique index if not exists uniq_delphi_room_account
  on public.delphi_threads(account_id) where kind = 'room' and account_id is not null;

-- Every existing department and channel gets its room now, so a reviewer
-- opening one first finds it there rather than being unable to create it.
insert into public.delphi_threads (workspace_id, department_id, account_id, kind, title, status)
select d.workspace_id, d.id, null, 'room', d.name, 'open'
from public.delphi_departments d
where not exists (
  select 1 from public.delphi_threads t
  where t.kind = 'room' and t.department_id = d.id and t.account_id is null
);

insert into public.delphi_threads (workspace_id, department_id, account_id, kind, title, status)
select a.workspace_id, a.department_id, a.id, 'room', a.name, 'open'
from public.delphi_media_accounts a
where a.department_id is not null
  and not exists (
    select 1 from public.delphi_threads t
    where t.kind = 'room' and t.account_id = a.id
  );

-- --- messages: cards and attached work --------------------------------------

alter table public.delphi_messages
  add column if not exists card jsonb;
alter table public.delphi_messages
  add column if not exists artifact_ids uuid[] not null default '{}';

comment on column public.delphi_messages.card is
  'An action card: what would change, and its state (pending, done, dismissed, failed). Only the owner confirms one.';

-- --- memories: compartments -------------------------------------------------

alter table public.delphi_memories
  add column if not exists account_id uuid references public.delphi_media_accounts(id) on delete cascade;

alter table public.delphi_memories drop constraint if exists delphi_memories_scope_check;
alter table public.delphi_memories
  add constraint delphi_memories_scope_check
  check (scope in ('org','department','agent','project','account'));

alter table public.delphi_memories drop constraint if exists delphi_memories_kind_check;
alter table public.delphi_memories
  add constraint delphi_memories_kind_check
  check (kind in ('fact','preference','lesson','outcome','decision'));

-- Lessons a department learned were filed organisation-wide, and recall
-- searched the whole workspace, so every department read every other's.
update public.delphi_memories
  set scope = 'department'
  where scope = 'org' and department_id is not null;

create index if not exists idx_delphi_memories_compartment
  on public.delphi_memories(workspace_id, department_id, account_id);

-- --- RLS on the new tables: members read, the owner writes -------------------

do $$
declare t text;
begin
  foreach t in array array['delphi_playbooks','delphi_ideas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format(
      'create policy %I on public.%I for select using (public.delphi_is_workspace_member(workspace_id))',
      t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_workspace_owner(workspace_id))',
      t || '_owner_insert', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id))',
      t || '_owner_update', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_workspace_owner(workspace_id))',
      t || '_owner_delete', t);
  end loop;
end $$;

-- --- realtime: rooms update as messages arrive ------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delphi_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.delphi_messages';
  end if;
end $$;
