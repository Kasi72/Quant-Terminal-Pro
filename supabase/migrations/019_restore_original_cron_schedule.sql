-- Migration 019: restore the original project's pg_cron schedule exactly (recovered from its cron.job
-- listing). 016 approximated it with 3 jobs; the original ran 3 bulk-deal attempts + weekly crossref.
-- Times UTC: 13:45 = 19:15 IST, 14:45 = 20:15 IST, 16:00 = 21:30 IST, Sun 02:00 = 07:30 IST.

do $$
begin
  perform cron.unschedule(jobname) from cron.job
  where jobname in ('fetch-bulk-deals', 'fetch-bulk-deals-final', 'refresh-symbol-crossref');
end $$;

select cron.schedule('fetch-bulk-deals-1',             '45 13 * * 1-5', $$select public.call_edge_function('fetch-bulk-deals')$$);
select cron.schedule('fetch-bulk-deals-2',             '45 14 * * 1-5', $$select public.call_edge_function('fetch-bulk-deals')$$);
select cron.schedule('fetch-bulk-deals-final',         '0 16 * * 1-5',  $$select public.call_edge_function('fetch-bulk-deals', '?final=1')$$);
select cron.schedule('refresh-symbol-crossref-weekly', '0 2 * * 0',     $$select public.call_edge_function('refresh-symbol-crossref')$$);
