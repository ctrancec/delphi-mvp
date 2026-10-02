-- ---------------------------------------------------------------------------
-- Members, roles and invitations.
--
-- One workspace can now have more than one person in it:
--
--   owner     the CHO. The only one who decides, staffs, spends, switches
--             the system or changes settings.
--   reviewer  reads everything and can post into review threads.
--   viewer    reads everything.
--
-- Until now every Delphi table let any member write anything, because the
-- only member was the owner. Here each table's single "member_access" policy
-- is split: members read; the owner writes; a member may add a thread
-- message or a log line, and keeps their own user state. The engine's cron
-- runs as the service role and is not affected.
--
-- Invitations are links: a token the owner hands over, good for seven days
-- and for one acceptance. Accepting is done by the server with the service
-- role, since the person accepting is not yet a member and can see nothing.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

alter table public.workspace_members add column if not exists email text;

-- The role the base migration handed out before there were roles.
update public.workspace_members set role = 'reviewer' where role = 'member';

create table if not exists public.delphi_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text,
  role          text not null check (role in ('reviewer','viewer')),
  token         text not null unique,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_by   uuid references auth.users(id) on delete set null,
  accepted_at   timestamptz,
  revoked_at    timestamptz
);

create index if not exists idx_delphi_invites_ws on public.delphi_invites(workspace_id);

alter table public.delphi_invites enable row level security;

drop policy if exists delphi_invites_owner on public.delphi_invites;
create policy delphi_invites_owner on public.delphi_invites
  for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- Members read; the owner writes; the exceptions are named.
do $$
declare t text;
begin
  foreach t in array array[
    'delphi_channels','delphi_agents','delphi_agent_stats','delphi_departments',
    'delphi_hires','delphi_projects','delphi_tasks','delphi_task_runs',
    'delphi_artifacts','delphi_approvals','delphi_memories','delphi_events',
    'delphi_reviews','delphi_review_findings','delphi_threads','delphi_messages',
    'delphi_system_state','delphi_devices','delphi_user_state',
    'delphi_performance_reviews','delphi_handoffs',
    'delphi_news_sources','delphi_news_items','delphi_news_clusters','delphi_streams',
    'delphi_legal_documents','delphi_legal_chunks'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_access', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);

    execute format(
      'create policy %I on public.%I for select using (public.delphi_is_workspace_member(workspace_id))',
      t || '_member_read', t
    );

    if t = 'delphi_user_state' then
      -- Where each person last looked is theirs alone.
      execute format(
        'create policy %I on public.%I for all
           using (public.delphi_is_workspace_member(workspace_id) and user_id = auth.uid())
           with check (public.delphi_is_workspace_member(workspace_id) and user_id = auth.uid())',
        t || '_own_write', t
      );
      continue;
    end if;

    if t in ('delphi_messages', 'delphi_events') then
      -- A reviewer posts into a thread, and what they did is logged.
      execute format(
        'create policy %I on public.%I for insert with check (public.delphi_is_workspace_member(workspace_id))',
        t || '_member_insert', t
      );
    else
      execute format(
        'create policy %I on public.%I for insert with check (public.is_workspace_owner(workspace_id))',
        t || '_owner_insert', t
      );
    end if;

    execute format(
      'create policy %I on public.%I for update
         using (public.is_workspace_owner(workspace_id))
         with check (public.is_workspace_owner(workspace_id))',
      t || '_owner_update', t
    );
    execute format(
      'create policy %I on public.%I for delete using (public.is_workspace_owner(workspace_id))',
      t || '_owner_delete', t
    );
  end loop;
end $$;

comment on table public.delphi_invites is
  'Invitation links into a workspace: one token, one role, seven days, one acceptance.';
