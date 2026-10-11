-- Migration 012a: base table for pbfb_uc_logger.
-- The original table was created by hand, so fresh databases had no definition and 014 failed.
-- Columns mirror app/api/log-uc-scan (insert) and app/api/label-uc-outcomes (outcome labels).
-- Migrations 013 and 014 add the ML/screener signal columns.

create table if not exists public.pbfb_uc_logger (
  id                      bigserial primary key,
  symbol                  text        not null,
  scan_date               date        not null,
  uc_score                numeric,
  uc_elite                boolean     default false,
  uc_strong               boolean     default false,
  uc_goldmine             boolean     default false,
  close_loc               numeric,
  rsi2                    numeric,
  body_pct                numeric,
  upper_wick_pct          numeric,
  vol_ratio_20            numeric,
  vol_pre5                numeric,
  range_atr               numeric,
  cl_trend                numeric,
  rsi2_velocity           numeric,
  zone_tightness          numeric,
  stage                   text,
  sector                  text,
  morph_type              text,
  conviction              numeric,
  day_chg_pct             numeric,
  confluence_score        numeric,
  inflection_score        numeric,
  dd52wh                  numeric,
  market_regime           text,
  total_scan_count        integer,
  guppy_spread_pct        numeric,
  guppy_compressed        boolean,
  guppy_ultra_compressed  boolean,
  guppy_compress_days     integer,
  guppy_primed            boolean,
  guppy_coiled_release    boolean,
  guppy_clean_bullish_fan boolean,
  guppy_group_gap_pct     numeric,
  hit_uc_next_day         boolean,
  next_day_chg_pct        numeric,
  hit_5pct_3d             boolean,
  hit_10pct_5d            boolean,
  uc_classification       text,
  labeled_at              timestamptz,
  created_at              timestamptz default now(),
  unique (symbol, scan_date)
);

create index if not exists pbfb_uc_logger_scan_date_idx on public.pbfb_uc_logger (scan_date);
create index if not exists pbfb_uc_logger_unlabeled_idx on public.pbfb_uc_logger (scan_date) where hit_uc_next_day is null;

alter table public.pbfb_uc_logger enable row level security;
