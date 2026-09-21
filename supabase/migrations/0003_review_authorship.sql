-- ---------------------------------------------------------------------------
-- 0003 — let Delphi speak in a review thread
--
-- delphi_messages required exactly one author: an agent row or a user row.
-- Delphi is the CEO rather than a hired agent, so it has no agents row to
-- point at, and its turn in a deliberation could not be stored at all — the
-- transcript showed the board's findings with a hole where the response was.
-- The same applied to system notices.
--
-- Authorship is now: at most one, and none only for roles that have no
-- identity to attribute to. Everything else is unchanged, and this is safe to
-- run against a database that already holds messages.
-- ---------------------------------------------------------------------------

alter table public.delphi_messages
  drop constraint if exists delphi_messages_one_author;

alter table public.delphi_messages
  add constraint delphi_messages_one_author check (
    -- Never two authors.
    not (author_agent_id is not null and author_user_id is not null)
    and (
      -- A reviewer or worker is always an agent; the CHO is always a user.
      (role in ('reviewer', 'worker') and author_agent_id is not null)
      or (role = 'cho' and author_user_id is not null)
      -- Delphi and the system speak for themselves.
      or (role in ('ceo', 'system'))
    )
  );

-- ---------------------------------------------------------------------------
-- One workspace per owner per name.
--
-- A layout and its page render concurrently and both bootstrapped, producing
-- two workspaces 0.4ms apart with the roster in only one of them. The app no
-- longer does that, but two concurrent first requests still could. This makes
-- it impossible rather than unlikely.
-- ---------------------------------------------------------------------------

create unique index if not exists workspaces_owner_name_uniq
  on public.workspaces (owner_id, name);
