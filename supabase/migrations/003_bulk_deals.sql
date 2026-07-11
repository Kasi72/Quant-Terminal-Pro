-- Phase 3: BSE bulk deal ingestion schema

create table if not exists bulk_deals (
  id uuid primary key default gen_random_uuid(),
  deal_date date not null,
  exchange text not null default 'BSE' check (exchange in ('BSE','NSE')),
  symbol text not null,                 -- normalized NSE-style symbol where matched
  bse_scrip_code text,
  security_name text,
  client_name text,
  client_name_normalized text,
  client_category text not null default 'unknown'
    check (client_category in ('institutional','promoter_group','operator_hni','inter_se_transfer','unknown')),
  side text check (side in ('BUY','SELL')),
  quantity numeric,
  price numeric,
  deal_value numeric generated always as (quantity * price) stored,
  row_seq int not null,
  source_file_hash text not null,
  created_at timestamptz default now(),
  unique (deal_date, source_file_hash, row_seq)
);
create index if not exists bulk_deals_symbol_date_idx on bulk_deals(symbol, deal_date desc);
create index if not exists bulk_deals_date_idx on bulk_deals(deal_date desc);

create table if not exists market_data_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  run_date date not null,
  attempt int not null default 1,
  status text not null check (status in ('success','empty','error','skipped')),
  rows_ingested int default 0,
  error_message text,
  source_file_hash text,
  started_at timestamptz default now(),
  completed_at timestamptz
);
create index if not exists ingestion_runs_source_date_idx on market_data_ingestion_runs(source, run_date desc);

create table if not exists symbol_crossref (
  nse_symbol text primary key,
  bse_scrip_code text,
  isin text,
  company_name text,
  updated_at timestamptz default now()
);
create index if not exists symbol_crossref_scrip_idx on symbol_crossref(bse_scrip_code);

create table if not exists bulk_deal_daily_scores (
  deal_date date not null,
  symbol text not null,
  gross_buy_value numeric default 0,
  gross_sell_value numeric default 0,
  net_buy_value numeric default 0,
  net_buy_ratio numeric default 0,
  abnormality_z numeric,
  client_credibility numeric default 0.5,
  final_bulk_score numeric,
  confidence text default 'low' check (confidence in ('high','medium','low','new_large_deal')),
  flags jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  primary key (deal_date, symbol)
);
create index if not exists bulk_scores_symbol_idx on bulk_deal_daily_scores(symbol, deal_date desc);

-- RLS: read-only for anon (screener queries), writes via service role only
alter table bulk_deals enable row level security;
alter table market_data_ingestion_runs enable row level security;
alter table symbol_crossref enable row level security;
alter table bulk_deal_daily_scores enable row level security;

create policy "anon read bulk_deals" on bulk_deals for select using (true);
create policy "anon read ingestion_runs" on market_data_ingestion_runs for select using (true);
create policy "anon read crossref" on symbol_crossref for select using (true);
create policy "anon read bulk_scores" on bulk_deal_daily_scores for select using (true);
