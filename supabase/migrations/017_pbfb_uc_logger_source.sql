-- Migration 017: tag where each pbfb_uc_logger row came from.
-- 'live'     = logged by the screener at scan time (/api/log-uc-scan)
-- 'backfill' = reconstructed offline by scripts/backfill_uc_logger.js from historical candles
alter table public.pbfb_uc_logger
  add column if not exists source text not null default 'live';

create index if not exists pbfb_uc_logger_source_idx on public.pbfb_uc_logger (source);
