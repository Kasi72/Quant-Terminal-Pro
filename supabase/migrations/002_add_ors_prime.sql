-- ORS-Prime Reversal — additive column migration
-- Run after 001_init.sql. Safe to re-run (IF NOT EXISTS guards).

ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS passed_ors_prime      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ors_score             numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ors_dd_from_swing_high numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ors_dist_ema20        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ors_confirmed         boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_results_ors_prime ON screening_results(passed_ors_prime) WHERE passed_ors_prime = true;
