-- ---------------------------------------------------------------------------
-- Working hours
--
-- The master switch is absolute and permanent: off is off until someone turns
-- it back on. That is the right shape for an emergency stop and the wrong one
-- for "don't work overnight" — which needed the CHO to remember, twice a day,
-- every day.
--
-- So the switch gains a schedule beside it. The schedule decides the ordinary
-- rhythm; the switch decides right now. Neither replaces the other, and either
-- can win temporarily: flipping the switch outside working hours means "work
-- anyway", flipping it during them means "stop for now", and both expire by
-- themselves at the next boundary rather than quietly persisting until someone
-- notices the agents have been idle for a week.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

alter table public.delphi_system_state
  add column if not exists schedule_enabled boolean not null default false;

-- Stored as HH:MM text rather than `time`, because that is what an <input
-- type="time"> gives and takes, and a round trip through a Postgres `time`
-- adds seconds nobody set and a parse nobody needs.
alter table public.delphi_system_state
  add column if not exists work_start text not null default '09:00';

alter table public.delphi_system_state
  add column if not exists work_end text not null default '17:00';

-- ISO weekdays: 1 Monday through 7 Sunday. Defaults to the working week.
alter table public.delphi_system_state
  add column if not exists work_days integer[] not null default '{1,2,3,4,5}';

-- An IANA zone. Hours mean nothing without one, and "the server's timezone" is
-- a decision nobody made — a CHO in Vancouver should not have their agents
-- start at 2am because a function happens to run in UTC.
alter table public.delphi_system_state
  add column if not exists timezone text not null default 'UTC';

-- The temporary win. `run` means work through a closed window, `hold` means
-- stay idle through an open one; both end at `override_until`, which is always
-- the next time the schedule itself would change its mind.
alter table public.delphi_system_state
  add column if not exists override_mode text;

alter table public.delphi_system_state
  drop constraint if exists delphi_system_state_override_mode_check;

alter table public.delphi_system_state
  add constraint delphi_system_state_override_mode_check
  check (override_mode is null or override_mode in ('run', 'hold'));

alter table public.delphi_system_state
  add column if not exists override_until timestamptz;

comment on column public.delphi_system_state.override_until is
  'When the temporary override lapses and the schedule resumes deciding. Always the next boundary, so an override cannot outlive the window it was made against.';

comment on column public.delphi_system_state.schedule_enabled is
  'False means the master switch alone decides, which is the behaviour that predates working hours.';
