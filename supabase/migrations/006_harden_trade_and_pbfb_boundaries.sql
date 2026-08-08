-- Harden browser data exposure and keep PBFB worker schema in lock-step.

alter table public.pbfb_uc_events
  add column if not exists outcome_labeled_at date;

create index if not exists pbfb_uc_events_outcome_label_idx
  on public.pbfb_uc_events (outcome_labeled_at, event_date)
  where n_before = 1;

revoke all on public.tracked_trades from anon;
revoke select on public.trade_daily_log from anon;

drop policy if exists "tracked_trades anon read drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon insert drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon update drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon delete drkkr" on public.tracked_trades;
drop policy if exists "trade_daily_log anon read drkkr" on public.trade_daily_log;
