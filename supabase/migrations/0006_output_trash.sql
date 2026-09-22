-- ---------------------------------------------------------------------------
-- Deleting outputs
--
-- The library only grows: every run adds four or five deliverables and every
-- redo adds a version. There was no way to remove any of it.
--
-- But deletion is the one action that cannot be taken back, which sits badly
-- beside everything else here — a verdict can be withdrawn, a hire un-hired, a
-- refusal cancelled. So deleting an output moves it to trash, where it can be
-- restored. Destroying it is a second, separate act behind a typed
-- confirmation, the same discipline department deletion uses.
--
-- Nothing cascades from an artifact. All three foreign keys pointing at one
-- (`delphi_reviews.artifact_id`, `delphi_handoffs.partial_artifact_id`,
-- `delphi_artifacts.supersedes`) are `on delete set null`, so even a permanent
-- purge nulls a reference rather than destroying anything else.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

alter table public.delphi_artifacts
  add column if not exists deleted_at timestamptz;

alter table public.delphi_artifacts
  add column if not exists deleted_by uuid references auth.users(id);

-- Partial, matching the `delphi_agents` archived-at index in 0001: the library
-- reads the living set on every load and the trash rarely.
create index if not exists idx_artifacts_live
  on public.delphi_artifacts(workspace_id, created_at desc)
  where deleted_at is null;

comment on column public.delphi_artifacts.deleted_at is
  'In the trash. Still readable and restorable; excluded from the library, and no longer fed to the pipeline as an upstream input.';
