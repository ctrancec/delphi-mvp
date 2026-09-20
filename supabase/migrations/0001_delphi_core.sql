-- Delphi — AI CEO Operating System
-- Core schema: departments, agents, hiring, pipelines, artifacts, approvals, memory.
--
-- Hierarchy:  CHO (you) -> Delphi (CEO) -> Departments -> Agents -> Tasks
--
-- Every table carries workspace_id and is guarded by RLS that mirrors the
-- existing workspace_members model. Child tables denormalize workspace_id so
-- policies stay a single indexed predicate instead of a join chain.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- semantic memory (column reserved, unused for now)

-- ---------------------------------------------------------------------------
-- RLS helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies can read workspace_members without recursing
-- through that table's own RLS.
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

-- ---------------------------------------------------------------------------
-- channels — how agents reach the world (MCP servers and REST connectors)
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_channels (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  kind           text not null check (kind in (
                   'mcp','perplexity','worldmonitor','higgsfield','gdrive',
                   'fred','rss','telegram','local_fs','http')),
  label          text not null,
  -- Non-secret connection details (endpoint URL, default model, feed list...).
  config         jsonb not null default '{}'::jsonb,
  -- Name of the server-side env var holding the secret. Never the secret itself.
  credential_ref text,
  enabled        boolean not null default true,
  health         text not null default 'unknown'
                   check (health in ('unknown','ok','degraded','error')),
  health_detail  text,
  last_ok_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (workspace_id, label)
);

comment on column public.delphi_channels.credential_ref is
  'Env var NAME holding the credential (e.g. WORLDMONITOR_API_KEY). Secrets never live in the database.';

-- ---------------------------------------------------------------------------
-- agents — the roster. Seeded specialists plus the ones Delphi invents.
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_agents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  slug           text not null,
  name           text not null,
  title          text not null,
  avatar_seed    text,
  system_prompt  text not null,
  skills         text[] not null default '{}',
  channel_ids    uuid[] not null default '{}',
  model          text not null default 'gemini-3.8-flash',
  -- 1 = cheap/fast, 2 = standard, 3 = expensive/deep. The agent's "salary".
  cost_tier      smallint not null default 1 check (cost_tier between 1 and 3),
  origin         text not null default 'seed' check (origin in ('seed','invented')),
  invented_for   uuid,  -- department that prompted this hire (FK added below)
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (workspace_id, slug)
);

-- Track record. Separate table so hiring can read it without loading prompts.
create table if not exists public.delphi_agent_stats (
  agent_id         uuid primary key references public.delphi_agents(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  hires            integer not null default 0,
  tasks_completed  integer not null default 0,
  tasks_failed     integer not null default 0,
  avg_duration_ms  integer not null default 0,
  total_cost_usd   numeric(12,6) not null default 0,
  -- Delphi's post-run review score, 0..1. Null until the agent has been reviewed.
  avg_quality      numeric(4,3) check (avg_quality between 0 and 1),
  last_hired_at    timestamptz,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- departments — standing organizations (News, Global News, Social, Media...)
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_departments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  charter       text not null,
  status        text not null default 'draft' check (status in (
                  'draft','hiring','awaiting_approval','active','paused','archived')),
  cadence_cron  text,                       -- e.g. '0 7 * * *' for a daily brief
  channel_ids   uuid[] not null default '{}',
  budget_usd    numeric(10,4) not null default 5.0000,
  spent_usd     numeric(12,6) not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.delphi_agents
  drop constraint if exists delphi_agents_invented_for_fkey;
alter table public.delphi_agents
  add constraint delphi_agents_invented_for_fkey
  foreign key (invented_for) references public.delphi_departments(id) on delete set null;

-- hires — Delphi's staffing decision for a department
create table if not exists public.delphi_hires (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid not null references public.delphi_departments(id) on delete cascade,
  agent_id       uuid not null references public.delphi_agents(id) on delete cascade,
  score          numeric(4,3) not null check (score between 0 and 1),
  rationale      text not null,
  seq            integer not null,
  created_at     timestamptz not null default now(),
  unique (department_id, agent_id)
);

-- ---------------------------------------------------------------------------
-- projects and tasks — a bounded run through a department's pipeline
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_projects (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid not null references public.delphi_departments(id) on delete cascade,
  title          text not null,
  brief          text not null,
  status         text not null default 'draft' check (status in (
                   'draft','planning','awaiting_approval','running','paused',
                   'done','failed','halted_budget','cancelled')),
  budget_usd     numeric(10,4) not null default 2.0000,
  spent_usd      numeric(12,6) not null default 0,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- One agent, one job. depends_on is the handoff edge.
create table if not exists public.delphi_tasks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  project_id    uuid not null references public.delphi_projects(id) on delete cascade,
  agent_id      uuid not null references public.delphi_agents(id),
  seq           integer not null,
  title         text not null,
  objective     text not null,
  depends_on    uuid references public.delphi_tasks(id) on delete set null,
  status        text not null default 'pending' check (status in (
                  'pending','running','awaiting_approval','done','failed','skipped')),
  created_at    timestamptz not null default now(),
  unique (project_id, seq)
);

-- Every attempt, with full cost accounting.
create table if not exists public.delphi_task_runs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  task_id            uuid not null references public.delphi_tasks(id) on delete cascade,
  attempt            integer not null default 1,
  status             text not null default 'running' check (status in (
                       'running','done','failed','cancelled')),
  model              text,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  cached_tokens      integer not null default 0,
  cost_usd           numeric(12,6) not null default 0,
  output             jsonb,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  unique (task_id, attempt)
);

-- ---------------------------------------------------------------------------
-- artifacts — everything the agents make. This is the Outputs library.
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_artifacts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  project_id     uuid not null references public.delphi_projects(id) on delete cascade,
  task_id        uuid references public.delphi_tasks(id) on delete set null,
  kind           text not null check (kind in (
                   'report','doc','dataset','image','video','audio',
                   'social_draft','brief','other')),
  title          text not null,
  -- Text deliverables live inline; binaries live in Supabase Storage.
  content_md     text,
  storage_path   text,
  mime_type      text,
  size_bytes     bigint,
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- approvals — CHO consent for anything outward-facing or irreversible
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_approvals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  project_id     uuid references public.delphi_projects(id) on delete cascade,
  task_id        uuid references public.delphi_tasks(id) on delete cascade,
  action_type    text not null check (action_type in (
                   'social_post','publish','send_email','send_message',
                   'spend','file_write','file_delete','external_api','other')),
  summary        text not null,
  -- Exactly what would be executed: the caption, the file, the request body.
  payload        jsonb not null default '{}'::jsonb,
  risk           text not null default 'medium' check (risk in ('low','medium','high')),
  status         text not null default 'pending' check (status in (
                   'pending','approved','rejected','expired','cancelled')),
  conditions     text,      -- set when approved with conditions
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memories — organizational memory across projects
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_memories (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  scope          text not null default 'org' check (scope in ('org','department','agent','project')),
  department_id  uuid references public.delphi_departments(id) on delete cascade,
  agent_id       uuid references public.delphi_agents(id) on delete cascade,
  project_id     uuid references public.delphi_projects(id) on delete set null,
  kind           text not null check (kind in ('fact','preference','lesson','outcome')),
  title          text not null,
  body           text not null,
  tags           text[] not null default '{}',
  importance     smallint not null default 3 check (importance between 1 and 5),
  -- Reserved for semantic recall. Retrieval ships as full-text search; turning
  -- vectors on later is a backfill plus a rerank, not a query-layer rewrite.
  embedding      vector(768),
  ts             tsvector generated always as (
                   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
                 ) stored,
  access_count   integer not null default 0,
  last_accessed_at timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- events — append-only activity stream. Powers live UI and replay.
-- ---------------------------------------------------------------------------
create table if not exists public.delphi_events (
  id             bigserial primary key,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  department_id  uuid references public.delphi_departments(id) on delete cascade,
  project_id     uuid references public.delphi_projects(id) on delete cascade,
  task_id        uuid references public.delphi_tasks(id) on delete cascade,
  type           text not null,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_delphi_channels_ws       on public.delphi_channels(workspace_id);
create index if not exists idx_delphi_agents_ws         on public.delphi_agents(workspace_id) where archived_at is null;
create index if not exists idx_delphi_agents_skills     on public.delphi_agents using gin(skills);
create index if not exists idx_delphi_departments_ws    on public.delphi_departments(workspace_id);
create index if not exists idx_delphi_hires_dept        on public.delphi_hires(department_id, seq);
create index if not exists idx_delphi_projects_dept     on public.delphi_projects(department_id, created_at desc);
create index if not exists idx_delphi_projects_active   on public.delphi_projects(status) where status in ('planning','running');
create index if not exists idx_delphi_tasks_project     on public.delphi_tasks(project_id, seq);
create index if not exists idx_delphi_task_runs_task    on public.delphi_task_runs(task_id, attempt desc);
create index if not exists idx_delphi_task_runs_stale   on public.delphi_task_runs(started_at) where status = 'running';
create index if not exists idx_delphi_artifacts_project on public.delphi_artifacts(project_id, created_at desc);
create index if not exists idx_delphi_artifacts_ws_kind on public.delphi_artifacts(workspace_id, kind, created_at desc);
create index if not exists idx_delphi_approvals_pending on public.delphi_approvals(workspace_id, created_at desc) where status = 'pending';
create index if not exists idx_delphi_memories_ts       on public.delphi_memories using gin(ts);
create index if not exists idx_delphi_memories_tags     on public.delphi_memories using gin(tags);
create index if not exists idx_delphi_memories_scope    on public.delphi_memories(workspace_id, scope, importance desc);
create index if not exists idx_delphi_events_project    on public.delphi_events(project_id, id desc);
create index if not exists idx_delphi_events_ws         on public.delphi_events(workspace_id, id desc);

-- ---------------------------------------------------------------------------
-- Row level security — every table, same predicate
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'delphi_channels','delphi_agents','delphi_agent_stats','delphi_departments',
    'delphi_hires','delphi_projects','delphi_tasks','delphi_task_runs',
    'delphi_artifacts','delphi_approvals','delphi_memories','delphi_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_access', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.delphi_is_workspace_member(workspace_id))
         with check (public.delphi_is_workspace_member(workspace_id))',
      t || '_member_access', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime — the UI subscribes to these instead of a hand-built SSE layer
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'delphi_events','delphi_tasks','delphi_task_runs',
    'delphi_projects','delphi_approvals','delphi_artifacts'
  ]
  loop
    -- Idempotent: adding a table already in the publication raises 42710.
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;  -- publication absent (non-Supabase Postgres)
    end;
  end loop;
end $$;
