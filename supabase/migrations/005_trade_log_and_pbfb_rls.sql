-- Trade tracking, daily trade log, and PBFB learning tables.
-- Idempotent: safe to run on a database where these tables already exist.

create table if not exists public.tracked_trades (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'drkkr',
  symbol text not null,
  stage text,
  entry_price numeric,
  entry_date date,
  stop_loss numeric,
  target1 numeric,
  target2 numeric,
  target3 numeric,
  disaster_stop numeric,
  param_set_key text,
  sector text,
  conviction numeric,
  status text,
  candle_pattern text,
  atr_state text,
  volume_badge text,
  regime_at_entry text,
  exit_price numeric,
  exit_date date,
  pnl_pct numeric,
  outcome text,
  notes text,
  tf_alignment text,
  rs_rank numeric,
  sw5_low_at_entry numeric,
  atr14_at_entry numeric,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tracked_trades
  add column if not exists user_id text not null default 'drkkr',
  add column if not exists symbol text,
  add column if not exists stage text,
  add column if not exists entry_price numeric,
  add column if not exists entry_date date,
  add column if not exists stop_loss numeric,
  add column if not exists target1 numeric,
  add column if not exists target2 numeric,
  add column if not exists target3 numeric,
  add column if not exists disaster_stop numeric,
  add column if not exists param_set_key text,
  add column if not exists sector text,
  add column if not exists conviction numeric,
  add column if not exists status text,
  add column if not exists candle_pattern text,
  add column if not exists atr_state text,
  add column if not exists volume_badge text,
  add column if not exists regime_at_entry text,
  add column if not exists exit_price numeric,
  add column if not exists exit_date date,
  add column if not exists pnl_pct numeric,
  add column if not exists outcome text,
  add column if not exists notes text,
  add column if not exists tf_alignment text,
  add column if not exists rs_rank numeric,
  add column if not exists sw5_low_at_entry numeric,
  add column if not exists atr14_at_entry numeric,
  add column if not exists raw_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tracked_trades_user_symbol_uidx
  on public.tracked_trades (user_id, symbol);
create index if not exists tracked_trades_user_created_idx
  on public.tracked_trades (user_id, created_at);
create index if not exists tracked_trades_user_status_idx
  on public.tracked_trades (user_id, status);

create table if not exists public.trade_daily_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'drkkr',
  symbol text not null,
  date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  day_num integer,
  mfe_pct numeric,
  mae_pct numeric,
  event_type text,
  event_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trade_daily_log
  add column if not exists user_id text not null default 'drkkr',
  add column if not exists symbol text,
  add column if not exists date date,
  add column if not exists open numeric,
  add column if not exists high numeric,
  add column if not exists low numeric,
  add column if not exists close numeric,
  add column if not exists day_num integer,
  add column if not exists mfe_pct numeric,
  add column if not exists mae_pct numeric,
  add column if not exists event_type text,
  add column if not exists event_detail text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists trade_daily_log_user_symbol_date_uidx
  on public.trade_daily_log (user_id, symbol, date);
create index if not exists trade_daily_log_symbol_date_idx
  on public.trade_daily_log (user_id, symbol, date);

create table if not exists public.pbfb_daily_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_date date not null,
  symbol_count integer not null default 0,
  event_count integer not null default 0,
  uc_count integer not null default 0,
  active_n integer not null default 0
);

create index if not exists pbfb_daily_runs_run_date_idx
  on public.pbfb_daily_runs (run_date desc);

create table if not exists public.pbfb_uc_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_date date,
  symbol text not null,
  event_date date,
  n_before integer not null,
  best_stage text,
  best_param_set text,
  classification text,
  any_zone boolean,
  is_uc_lock boolean,
  close_loc numeric,
  upper_wick_pct numeric,
  body_pct numeric,
  vol_ratio_20 numeric,
  vol_vs_pre5 numeric,
  range_atr numeric,
  atr_pct numeric,
  rsi2 numeric,
  pre10_range_avg numeric,
  pre10_vol_avg numeric,
  zone_tightness numeric,
  zone_len integer,
  move_pct numeric,
  vol_mult numeric,
  close_price numeric,
  shape_vec numeric[],
  near_breakout_tier text,
  archetype_type text,
  zone_shape text,
  hit_t1 boolean,
  hit_t2 boolean,
  stopped_out boolean,
  outcome_pct_20d numeric,
  market_regime text
);

alter table public.pbfb_uc_events
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists run_date date,
  add column if not exists symbol text,
  add column if not exists event_date date,
  add column if not exists n_before integer,
  add column if not exists best_stage text,
  add column if not exists best_param_set text,
  add column if not exists classification text,
  add column if not exists any_zone boolean,
  add column if not exists is_uc_lock boolean,
  add column if not exists close_loc numeric,
  add column if not exists upper_wick_pct numeric,
  add column if not exists body_pct numeric,
  add column if not exists vol_ratio_20 numeric,
  add column if not exists vol_vs_pre5 numeric,
  add column if not exists range_atr numeric,
  add column if not exists atr_pct numeric,
  add column if not exists rsi2 numeric,
  add column if not exists pre10_range_avg numeric,
  add column if not exists pre10_vol_avg numeric,
  add column if not exists zone_tightness numeric,
  add column if not exists zone_len integer,
  add column if not exists move_pct numeric,
  add column if not exists vol_mult numeric,
  add column if not exists close_price numeric,
  add column if not exists shape_vec numeric[],
  add column if not exists near_breakout_tier text,
  add column if not exists archetype_type text,
  add column if not exists zone_shape text,
  add column if not exists hit_t1 boolean,
  add column if not exists hit_t2 boolean,
  add column if not exists stopped_out boolean,
  add column if not exists outcome_pct_20d numeric,
  add column if not exists market_regime text;

create unique index if not exists pbfb_uc_events_symbol_event_n_uidx
  on public.pbfb_uc_events (symbol, event_date, n_before);
create index if not exists pbfb_uc_events_event_date_idx
  on public.pbfb_uc_events (event_date desc);
create index if not exists pbfb_uc_events_classification_idx
  on public.pbfb_uc_events (classification);

alter table public.tracked_trades enable row level security;
alter table public.trade_daily_log enable row level security;
alter table public.pbfb_daily_runs enable row level security;
alter table public.pbfb_uc_events enable row level security;

grant select, insert, update, delete on public.tracked_trades to anon;
grant select on public.trade_daily_log to anon;
grant select on public.pbfb_daily_runs to anon;
grant select on public.pbfb_uc_events to anon;

drop policy if exists "tracked_trades anon read drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon insert drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon update drkkr" on public.tracked_trades;
drop policy if exists "tracked_trades anon delete drkkr" on public.tracked_trades;
create policy "tracked_trades anon read drkkr" on public.tracked_trades
  for select to anon using (user_id = 'drkkr');
create policy "tracked_trades anon insert drkkr" on public.tracked_trades
  for insert to anon with check (user_id = 'drkkr');
create policy "tracked_trades anon update drkkr" on public.tracked_trades
  for update to anon using (user_id = 'drkkr') with check (user_id = 'drkkr');
create policy "tracked_trades anon delete drkkr" on public.tracked_trades
  for delete to anon using (user_id = 'drkkr');

drop policy if exists "trade_daily_log anon read drkkr" on public.trade_daily_log;
create policy "trade_daily_log anon read drkkr" on public.trade_daily_log
  for select to anon using (user_id = 'drkkr');

drop policy if exists "pbfb_daily_runs anon read" on public.pbfb_daily_runs;
drop policy if exists "pbfb_uc_events anon read" on public.pbfb_uc_events;
create policy "pbfb_daily_runs anon read" on public.pbfb_daily_runs
  for select to anon using (true);
create policy "pbfb_uc_events anon read" on public.pbfb_uc_events
  for select to anon using (true);
