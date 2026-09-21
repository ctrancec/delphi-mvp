-- ---------------------------------------------------------------------------
-- CHO review: decline, send back, and escalate
--
-- Until now a decision was binary. The CHO could approve an action or reject
-- it, and rejecting skipped the task — the work was refused, and that was the
-- end of it. A deliverable that was nearly right had nowhere to go: no way to
-- say "this is close, do it again knowing what I know", and no way for that
-- feedback to reach the agent that wrote it.
--
-- This adds the third answer. Sending work back returns the task to the queue
-- with the CHO's reason attached, the agent reads that reason as part of its
-- brief, and the loop repeats until the work is satisfactory or Delphi decides
-- the agent is not the one to produce it.
--
-- Idempotent throughout, so re-running it is safe.
-- ---------------------------------------------------------------------------

-- --- approvals: a decision can now be "do it again" ------------------------

alter table public.delphi_approvals
  drop constraint if exists delphi_approvals_status_check;

alter table public.delphi_approvals
  add constraint delphi_approvals_status_check
  check (status in (
    'pending','approved','rejected','expired','cancelled',
    -- Refused, but not abandoned: the task goes back to the agent.
    'revision_requested'
  ));

-- What the CHO said when they sent it back. Distinct from `conditions`, which
-- qualifies an approval — this is the reason a thing was *not* approved, and
-- the agent is expected to act on it.
alter table public.delphi_approvals
  add column if not exists revision_note text;

alter table public.delphi_approvals
  add column if not exists revision_count integer not null default 0;

-- --- artifacts: every deliverable is reviewable ----------------------------

-- `pending` for work the CHO has not ruled on, which is the honest default for
-- everything already in the library.
alter table public.delphi_artifacts
  add column if not exists review_status text not null default 'pending';

alter table public.delphi_artifacts
  drop constraint if exists delphi_artifacts_review_status_check;

alter table public.delphi_artifacts
  add constraint delphi_artifacts_review_status_check
  check (review_status in ('pending','approved','declined','superseded'));

alter table public.delphi_artifacts
  add column if not exists review_note text;

alter table public.delphi_artifacts
  add column if not exists reviewed_by uuid references auth.users(id);

alter table public.delphi_artifacts
  add column if not exists reviewed_at timestamptz;

-- Which attempt this is. A redo writes a new artifact rather than overwriting
-- the old one, so the CHO can see what changed and why.
alter table public.delphi_artifacts
  add column if not exists revision integer not null default 1;

-- The artifact this one replaces, if any. Kept rather than deleted: the trail
-- from a declined draft to the version that satisfied is the record of what
-- the feedback actually changed.
alter table public.delphi_artifacts
  add column if not exists supersedes uuid references public.delphi_artifacts(id) on delete set null;

create index if not exists idx_artifacts_review
  on public.delphi_artifacts(workspace_id, review_status);

-- --- tasks: carry the CHO's words to the agent -----------------------------

-- Read into the agent's brief on the next run. This is the whole point: a
-- rejection the agent never sees changes nothing about what it produces.
alter table public.delphi_tasks
  add column if not exists cho_note text;

alter table public.delphi_tasks
  add column if not exists revision_count integer not null default 0;

-- Set when Delphi escalates a task to a stronger model than the agent's own.
-- Per-task rather than on the agent, because an agent that struggled with one
-- objective should not become permanently more expensive everywhere else.
alter table public.delphi_tasks
  add column if not exists model_override text;

-- --- events ----------------------------------------------------------------

comment on column public.delphi_tasks.cho_note is
  'What the CHO asked to be different. Cleared once the task produces work they accept.';

comment on column public.delphi_artifacts.review_status is
  'pending until the CHO rules. declined sends the task back; superseded means a later revision replaced it.';
