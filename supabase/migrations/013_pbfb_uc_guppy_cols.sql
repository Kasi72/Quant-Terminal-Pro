-- Migration 013: add Guppy GMMA compression columns to pbfb_uc_logger
-- Guppy Multiple Moving Average (GMMA): 27 EMAs (3-70) — their compression
-- state at scan time predicts monster moves. These cols are computed from
-- stockEngine's guppyCompressed/guppyPrimed/etc fields and stored at scan.
-- Nullable: rows logged before this deploy remain null. Once filled,
-- uc_enhanced_dna.js will mine Guppy × 5pct correlations automatically.

alter table public.pbfb_uc_logger
  add column if not exists guppy_spread_pct        numeric,
  add column if not exists guppy_compressed         boolean,
  add column if not exists guppy_ultra_compressed   boolean,
  add column if not exists guppy_compress_days      integer,
  add column if not exists guppy_primed             boolean,
  add column if not exists guppy_coiled_release     boolean,
  add column if not exists guppy_clean_bullish_fan  boolean,
  add column if not exists guppy_group_gap_pct      numeric;
