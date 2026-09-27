-- ---------------------------------------------------------------------------
-- Two market-data channels, both free.
--
--   sec      SEC EDGAR — US company fundamentals and filings. Official, no
--            key; SEC asks every caller to identify itself with a contact
--            address, which Delphi reads from the SEC_CONTACT env var.
--   finnhub  Finnhub's free tier — US stock prices, 52-week ranges, returns,
--            ratios, company news and the earnings calendar. Needs a free key
--            (FINNHUB_API_KEY); personal, non-commercial use.
--
-- Together they let the market departments emulate stock screening without a
-- paid data feed. Same approach as 0007: drop whichever check constraint on
-- the table lists the channel kinds, then add it back under its own name.
--
-- Until this runs, nothing breaks: the two channel rows are skipped with a
-- logged reason, and every existing channel keeps working.
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
    'boc','gdelt','sec','finnhub'
  ));
