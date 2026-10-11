-- Migration 016: schedule edge functions with pg_cron + pg_net.
-- Token and project URL are read from Vault at run time (never stored in the repo).
-- Vault secrets 'function_internal_token' and 'project_url' are set out-of-band.
-- Times are UTC: 13:30 = 19:00 IST, 15:30 = 21:00 IST, Sun 01:30 = 07:00 IST.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_edge_function(fn text, query text default '')
returns bigint
language sql
security definer
set search_path = public, extensions, vault
as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/' || fn || query,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-token', (select decrypted_secret from vault.decrypted_secrets where name = 'function_internal_token')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;

revoke all on function public.call_edge_function(text, text) from public, anon, authenticated;

select cron.schedule('fetch-bulk-deals',        '30 13 * * 1-5', $$select public.call_edge_function('fetch-bulk-deals')$$);
select cron.schedule('fetch-bulk-deals-final',  '30 15 * * 1-5', $$select public.call_edge_function('fetch-bulk-deals', '?final=1')$$);
select cron.schedule('refresh-symbol-crossref', '30 1 * * 0',    $$select public.call_edge_function('refresh-symbol-crossref')$$);
