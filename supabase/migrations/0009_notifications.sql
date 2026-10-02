-- ---------------------------------------------------------------------------
-- Notifications outside the app.
--
-- Two small tables, both per person:
--
--   delphi_notify_prefs        which events reach them, and the address for
--                              email; nothing is sent to anyone who has not
--                              switched it on.
--   delphi_push_subscriptions  the browsers that asked for push, one row per
--                              device. An endpoint the push service says is
--                              gone is removed.
--
-- Members of a workspace can read each other's rows, because the engine
-- notifies everyone in the workspace whichever member's run produced the
-- news; only the person themself writes their own.
--
-- Until this runs, nothing breaks: the senders find no preferences and send
-- nothing, and the Account page says so.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

create table if not exists public.delphi_notify_prefs (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text,
  on_report     boolean not null default true,
  on_approval   boolean not null default true,
  on_halt       boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.delphi_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_ok_at    timestamptz,
  failures      integer not null default 0
);

create index if not exists idx_delphi_push_subscriptions_ws on public.delphi_push_subscriptions(workspace_id);

alter table public.delphi_notify_prefs enable row level security;
alter table public.delphi_push_subscriptions enable row level security;

drop policy if exists delphi_notify_prefs_read on public.delphi_notify_prefs;
create policy delphi_notify_prefs_read on public.delphi_notify_prefs
  for select using (public.delphi_is_workspace_member(workspace_id));

drop policy if exists delphi_notify_prefs_own on public.delphi_notify_prefs;
create policy delphi_notify_prefs_own on public.delphi_notify_prefs
  for all
  using (user_id = auth.uid() and public.delphi_is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.delphi_is_workspace_member(workspace_id));

drop policy if exists delphi_push_subscriptions_read on public.delphi_push_subscriptions;
create policy delphi_push_subscriptions_read on public.delphi_push_subscriptions
  for select using (public.delphi_is_workspace_member(workspace_id));

drop policy if exists delphi_push_subscriptions_own on public.delphi_push_subscriptions;
create policy delphi_push_subscriptions_own on public.delphi_push_subscriptions
  for all
  using (user_id = auth.uid() and public.delphi_is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.delphi_is_workspace_member(workspace_id));

comment on table public.delphi_notify_prefs is
  'Per person: which events reach them outside the app, and where. Nothing is sent to anyone who has not switched it on.';
comment on table public.delphi_push_subscriptions is
  'The browsers that asked for push notifications, one row per device. Endpoints the push service reports gone are removed.';
