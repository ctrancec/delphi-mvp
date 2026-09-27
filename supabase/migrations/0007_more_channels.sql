-- ---------------------------------------------------------------------------
-- Two more data channels: the Bank of Canada, and GDELT.
--
-- `delphi_channels.kind` is constrained to a fixed list (0001), so a channel
-- the database does not know about cannot be recorded, and an agent can never
-- be bound to it. This widens the list by two:
--
--   boc    Bank of Canada Valet API — USD/CAD, the overnight rate, Government
--          of Canada benchmark yields, core CPI. Official, daily, no key.
--   gdelt  GDELT DOC 2.0 — world news in 65+ languages, tagged by source
--          country and language. No key.
--
-- The original constraint was declared inline, so Postgres named it. Rather
-- than guess that name, this drops whichever check constraint on the table
-- lists the channel kinds, then adds it back under a name of its own.
--
-- Until this runs, nothing breaks: the app skips the two new channel rows with
-- a logged reason, and the three existing channels keep working.
--
-- Idempotent, so re-running it is safe.
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'delphi_channels'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%perplexity%'
  loop
    execute format('alter table public.delphi_channels drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.delphi_channels
  add constraint delphi_channels_kind_check check (kind in (
    'mcp','perplexity','worldmonitor','higgsfield','gdrive',
    'fred','rss','telegram','local_fs','http',
    'boc','gdelt'
  ));
