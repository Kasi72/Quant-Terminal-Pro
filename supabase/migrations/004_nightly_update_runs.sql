create table if not exists public.nightly_update_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  trigger_source text not null default 'unknown',
  schedule text,
  total_trades integer not null default 0,
  candidates integer not null default 0,
  processed integer not null default 0,
  updated integer not null default 0,
  log_rows integer not null default 0,
  latest_market_date date,
  errors jsonb not null default '[]'::jsonb,
  duration_ms integer
);

create index if not exists nightly_update_runs_started_at_idx
  on public.nightly_update_runs (started_at desc);

alter table public.nightly_update_runs enable row level security;
