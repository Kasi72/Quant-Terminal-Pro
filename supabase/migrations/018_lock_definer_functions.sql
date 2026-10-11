-- Migration 018: the SECURITY DEFINER helpers from 001/010 were callable by anyone holding the
-- public anon key via /rest/v1/rpc/* (e.g. sweep_old_scan_sessions(keep_n => 0) wipes scan history).
-- Only server code (service role) calls them, so revoke public access and pin search_path.

revoke execute on function public.sweep_old_scan_sessions(integer) from public, anon, authenticated;
revoke execute on function public.increment_processed(uuid)        from public, anon, authenticated;
revoke execute on function public.finalize_session(uuid)           from public, anon, authenticated;

alter function public.sweep_old_scan_sessions(integer) set search_path = public;
alter function public.increment_processed(uuid)        set search_path = public;
alter function public.finalize_session(uuid)           set search_path = public;
