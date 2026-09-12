-- Migration 014: add ML + screener signal columns to pbfb_uc_logger
-- These are computed at scan time in page.tsx and stored for DNA mining.
-- All nullable — rows logged before this deploy remain null.
-- Tier 1 (highest expected d): xgb_score, candle_dna, near_breakout, archetype_type
-- Tier 2: bayes_wr, stats_score, momentum_score, rs_nifty20, volatility_expansion_ratio
-- Tier 3: ultra_precision_score

alter table public.pbfb_uc_logger
  add column if not exists xgb_score                   numeric,        -- XGBoost P(hit_t1) 0-1
  add column if not exists candle_dna_score            numeric,        -- CandleDNA composite 0-100
  add column if not exists candle_dna_tier             text,           -- ELITE/STRONG/GOOD/WEAK
  add column if not exists near_breakout_tier          text,           -- IMMINENT/NEAR/WATCH/EARLY
  add column if not exists near_breakout_pct           numeric,        -- % distance from resistance
  add column if not exists archetype_type              text,           -- VolumeFootprint/CompressionCoil/etc
  add column if not exists bayes_wr                    numeric,        -- Bayesian posterior win rate 0-1
  add column if not exists stats_score                 integer,        -- statistical composite 0-100
  add column if not exists momentum_score              integer,        -- momentum composite 0-100
  add column if not exists rs_nifty20                  numeric,        -- relative strength vs Nifty 20d
  add column if not exists volatility_expansion_ratio  numeric,        -- current range / ATR14
  add column if not exists ultra_precision_score       numeric;        -- UPS composite
