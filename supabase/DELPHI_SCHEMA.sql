-- ============================================================================
-- DELPHI — full schema (migrations 0001 + 0002 combined)
--
-- Run this ONCE in the Supabase SQL Editor. 0000_base_workspaces.sql is
-- already applied; this is everything that still needs to go in.
--
-- Safe to re-run: every statement is idempotent (create if not exists,
-- create or replace, drop policy if exists).
-- ============================================================================

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


-- ===========================================================================

-- Delphi — governance, diagnostics, world news, and the legal reference library.
--
-- Builds on 0001_delphi_core.sql. Four groups:
--   1. Governance  — the L.L.R. board, deliberation transcripts, system on/off
--   2. Diagnostics — performance grading and replacement-with-continuity
--   3. Delphi World — global news ingestion, translation, corroboration, streams
--   4. Legal library — the corpus the board cites from

-- ---------------------------------------------------------------------------
-- 1. GOVERNANCE
-- ---------------------------------------------------------------------------

-- Board membership is a property of the agent, not of a hire: board agents
-- attach to every department rather than being staffed per project.
alter table public.delphi_agents
  add column if not exists is_board boolean not null default false;

create table if not exists public.delphi_reviews (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  project_id     uuid references public.delphi_projects(id) on delete cascade,
  task_id        uuid references public.delphi_tasks(id) on delete cascade,
  artifact_id    uuid references public.delphi_artifacts(id) on delete set null,
  approval_id    uuid references public.delphi_approvals(id) on delete set null,
  subject_kind   text not null check (subject_kind in ('artifact','approval','project')),
  -- Full board on outward-facing work, legal-only for third-party media,
  -- skip for internal drafts. Without tiering, review doubles project cost.
  depth          text not null default 'full' check (depth in ('full','legal','skip')),
  status         text not null default 'pending'
                   check (status in ('pending','deliberating','complete','escalated')),
  verdict        text check (verdict in ('clear','conditions','block')),
  recommendation text,
  rounds         smallint not null default 0,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create table if not exists public.delphi_review_findings (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  review_id         uuid not null references public.delphi_reviews(id) on delete cascade,
  reviewer_agent_id uuid not null references public.delphi_agents(id),
  category          text not null,
  severity          text not null default 'medium' check (severity in ('low','medium','high','critical')),
  finding           text not null,
  remedy            text,
  -- Citation into the reference library. A legal finding without one is recall,
  -- not research, and the UI marks it as such.
  citation_doc_id   uuid,
  citation_section  text,
  jurisdiction      text,
  addressed         boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Deliberation is a readable record, not a debugging side effect.
create table if not exists public.delphi_threads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  project_id    uuid references public.delphi_projects(id) on delete cascade,
  review_id     uuid references public.delphi_reviews(id) on delete cascade,
  title         text not null,
  status        text not null default 'open' check (status in ('open','closed')),
  created_at    timestamptz not null default now()
);

create table if not exists public.delphi_messages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  thread_id        uuid not null references public.delphi_threads(id) on delete cascade,
  -- Exactly one author. The CHO speaks into these threads too, which is what
  -- makes "discussions before approval" bidirectional.
  author_agent_id  uuid references public.delphi_agents(id),
  author_user_id   uuid references auth.users(id),
  role             text not null check (role in ('ceo','reviewer','worker','cho','system')),
  content          text not null,
  in_reply_to      uuid references public.delphi_messages(id) on delete set null,
  round            smallint not null default 0,
  created_at       timestamptz not null default now(),
  constraint delphi_messages_one_author check (
    (author_agent_id is not null) <> (author_user_id is not null)
  )
);

-- The master switch. Lives in the database so flipping it on the phone stops
-- the engine everywhere, immediately.
create table if not exists public.delphi_system_state (
  workspace_id  uuid primary key references public.workspaces(id) on delete cascade,
  mode          text not null default 'running' check (mode in ('running','paused','stopped')),
  reason        text,
  changed_by    uuid references auth.users(id),
  changed_at    timestamptz not null default now()
);

-- Registered clients, so the CHO can see what is connected.
create table if not exists public.delphi_devices (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  platform      text not null check (platform in ('web','desktop','android','ios')),
  surface       text check (surface in ('cover','inner','desk')),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Resume-where-you-left-off across surfaces.
create table if not exists public.delphi_user_state (
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  last_department_id  uuid references public.delphi_departments(id) on delete set null,
  last_project_id     uuid references public.delphi_projects(id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. DIAGNOSTICS — grading and replacement
-- ---------------------------------------------------------------------------

create table if not exists public.delphi_performance_reviews (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  task_id               uuid not null references public.delphi_tasks(id) on delete cascade,
  task_run_id           uuid references public.delphi_task_runs(id) on delete cascade,
  agent_id              uuid not null references public.delphi_agents(id) on delete cascade,
  -- Anchored to mechanically checkable things where possible: does every claim
  -- carry a locator, and does the locator resolve?
  accuracy_score        numeric(4,3) check (accuracy_score between 0 and 1),
  completeness_score    numeric(4,3) check (completeness_score between 0 and 1),
  adherence_score       numeric(4,3) check (adherence_score between 0 and 1),
  efficiency_score      numeric(4,3) check (efficiency_score between 0 and 1),
  overall               numeric(4,3) not null check (overall between 0 and 1),
  reasoning             text not null,
  unsourced_claims      smallint not null default 0,
  triggered_replacement boolean not null default false,
  created_at            timestamptz not null default now()
);

-- The dossier that lets a replacement resume instead of restarting. The task
-- keeps its id and seq, so the pipeline position and downstream dependency
-- survive the swap.
create table if not exists public.delphi_handoffs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  task_id             uuid not null references public.delphi_tasks(id) on delete cascade,
  from_agent_id       uuid references public.delphi_agents(id),
  to_agent_id         uuid not null references public.delphi_agents(id),
  reason              text not null,
  completed_summary   text not null,
  remaining_work      text not null,
  sources_consulted   jsonb not null default '[]'::jsonb,
  partial_artifact_id uuid references public.delphi_artifacts(id) on delete set null,
  created_at          timestamptz not null default now()
);

-- Replacement count per task, so a failing objective cannot spin a carousel.
alter table public.delphi_tasks
  add column if not exists replacement_count smallint not null default 0;

-- ---------------------------------------------------------------------------
-- 3. DELPHI WORLD — global news
-- ---------------------------------------------------------------------------

create table if not exists public.delphi_news_sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  name              text not null,
  country           text not null,          -- ISO 3166-1 alpha-2
  language          text not null,          -- ISO 639-1
  category          text not null check (category in ('wire','national','financial','regional','broadcast')),
  -- Carried on every item so nothing is presented as neutral when it isn't.
  lean              text check (lean in ('left','center-left','center','center-right','right','state')),
  reliability_tier  smallint not null default 2 check (reliability_tier between 1 and 3),
  rss_url           text,
  api_url           text,
  site_url          text,
  enabled           boolean not null default true,
  -- Feeds break constantly; ingestion degrades to partial coverage rather than failing.
  health            text not null default 'unknown' check (health in ('unknown','ok','degraded','error')),
  last_ok_at        timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.delphi_news_clusters (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  title_en            text not null,
  summary_en          text,
  -- The accuracy feature: agreement across independent, geographically and
  -- editorially diverse outlets is the strongest signal a story is real.
  corroboration_score numeric(4,3) not null default 0 check (corroboration_score between 0 and 1),
  outlet_count        smallint not null default 0,
  country_count       smallint not null default 0,
  lean_diversity      numeric(4,3) not null default 0,
  has_wire            boolean not null default false,
  first_seen_at       timestamptz not null default now(),
  corroborated_at     timestamptz,
  regions             text[] not null default '{}',
  topics              text[] not null default '{}',
  created_at          timestamptz not null default now()
);

create table if not exists public.delphi_news_items (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  source_id       uuid not null references public.delphi_news_sources(id) on delete cascade,
  cluster_id      uuid references public.delphi_news_clusters(id) on delete set null,
  url             text not null,
  -- Both original and translation are kept so any claim can be checked against
  -- the source language.
  language        text not null,
  title_original  text not null,
  summary_original text,
  title_en        text,
  summary_en      text,
  translated_at   timestamptz,
  published_at    timestamptz,
  fetched_at      timestamptz not null default now(),
  unique (workspace_id, url)
);

create table if not exists public.delphi_streams (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  source_id     uuid references public.delphi_news_sources(id) on delete set null,
  label         text not null,
  -- Official, publicly embeddable streams only. No scraping or re-streaming.
  provider      text not null default 'youtube' check (provider in ('youtube','vimeo','hls')),
  external_id   text not null,
  category      text not null default 'news' check (category in ('news','financial','regional')),
  language      text,
  enabled       boolean not null default true,
  sort_order    smallint not null default 100,
  created_at    timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);

-- ---------------------------------------------------------------------------
-- 4. LEGAL REFERENCE LIBRARY
-- ---------------------------------------------------------------------------

create table if not exists public.delphi_legal_documents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  title          text not null,
  jurisdiction   text not null,            -- 'US', 'CA', 'CA-ON', 'EU', 'UK', 'platform'
  category       text not null check (category in (
                   'statute','regulation','case','guidance','tos','circular','open-commentary')),
  source_url     text not null,
  -- Only free and lawfully redistributable material is stored. Copyrighted
  -- textbooks and paywalled databases are explicitly out of scope.
  licence        text not null,
  effective_date date,
  -- Stale law is worse than no law, so the board surfaces the age of what it cites.
  retrieved_at   timestamptz not null default now(),
  refresh_days   smallint not null default 90,
  checksum       text,
  created_at     timestamptz not null default now(),
  unique (workspace_id, source_url)
);

create table if not exists public.delphi_legal_chunks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.delphi_legal_documents(id) on delete cascade,
  section      text,
  ordinal      integer not null default 0,
  text         text not null,
  -- Legal retrieval is genuinely semantic: "can I use this song over my clip"
  -- must find a licensing clause that never says "song". This is the one place
  -- vectors ship from day one.
  embedding    vector(768),
  ts           tsvector generated always as (to_tsvector('english', coalesce(text,''))) stored,
  created_at   timestamptz not null default now()
);

-- Findings cite documents; wired here now that the table exists.
alter table public.delphi_review_findings
  drop constraint if exists delphi_review_findings_citation_fkey;
alter table public.delphi_review_findings
  add constraint delphi_review_findings_citation_fkey
  foreign key (citation_doc_id) references public.delphi_legal_documents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_delphi_reviews_pending   on public.delphi_reviews(workspace_id, created_at desc) where status <> 'complete';
create index if not exists idx_delphi_findings_review   on public.delphi_review_findings(review_id, severity);
create index if not exists idx_delphi_threads_review    on public.delphi_threads(review_id);
create index if not exists idx_delphi_messages_thread   on public.delphi_messages(thread_id, created_at);
create index if not exists idx_delphi_perf_agent        on public.delphi_performance_reviews(agent_id, created_at desc);
create index if not exists idx_delphi_handoffs_task     on public.delphi_handoffs(task_id, created_at desc);
create index if not exists idx_delphi_agents_board      on public.delphi_agents(workspace_id) where is_board;

create index if not exists idx_delphi_news_items_cluster on public.delphi_news_items(cluster_id, published_at desc);
create index if not exists idx_delphi_news_items_recent  on public.delphi_news_items(workspace_id, published_at desc);
create index if not exists idx_delphi_news_items_untranslated
  on public.delphi_news_items(workspace_id, fetched_at) where title_en is null;
create index if not exists idx_delphi_clusters_score     on public.delphi_news_clusters(workspace_id, corroboration_score desc, first_seen_at desc);
create index if not exists idx_delphi_sources_enabled    on public.delphi_news_sources(workspace_id) where enabled;
create index if not exists idx_delphi_streams_enabled    on public.delphi_streams(workspace_id, sort_order) where enabled;

create index if not exists idx_delphi_legal_docs_juris   on public.delphi_legal_documents(workspace_id, jurisdiction, category);
create index if not exists idx_delphi_legal_docs_stale
  on public.delphi_legal_documents(retrieved_at);
create index if not exists idx_delphi_legal_chunks_ts    on public.delphi_legal_chunks using gin(ts);

-- HNSW for semantic retrieval over the legal corpus. Guarded: the index method
-- is unavailable on older pgvector builds, and full-text search still works
-- without it.
do $$
begin
  execute 'create index if not exists idx_delphi_legal_chunks_vec
           on public.delphi_legal_chunks using hnsw (embedding vector_cosine_ops)';
exception
  when others then
    raise notice 'Skipped HNSW index on delphi_legal_chunks (%). Full-text search is unaffected.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — same predicate as 0001
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'delphi_reviews','delphi_review_findings','delphi_threads','delphi_messages',
    'delphi_system_state','delphi_devices','delphi_user_state',
    'delphi_performance_reviews','delphi_handoffs',
    'delphi_news_sources','delphi_news_items','delphi_news_clusters','delphi_streams',
    'delphi_legal_documents','delphi_legal_chunks'
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
-- Realtime — the UI subscribes rather than polling
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'delphi_reviews','delphi_review_findings','delphi_messages',
    'delphi_system_state','delphi_performance_reviews','delphi_handoffs',
    'delphi_news_clusters'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
