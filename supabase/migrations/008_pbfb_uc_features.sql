-- Migration 008: add rsi2_velocity and cl_trend to pbfb_uc_events
-- These are computed locally in stockEngine.ts and now forwarded by PBFBAnalyzer.
-- Nullable: older events logged before this deploy will remain null.

alter table public.pbfb_uc_events
  add column if not exists rsi2_velocity numeric,
  add column if not exists cl_trend      numeric;
