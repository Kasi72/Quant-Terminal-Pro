-- Migration 011: add UC score and tier columns to pbfb_uc_events
-- uc_score, uc_goldmine, uc_strong, uc_elite are computed in stockEngine.ts
-- and forwarded by PBFBAnalyzer → pbfb-save route. Nullable: old rows stay null.

alter table public.pbfb_uc_events
  add column if not exists uc_score    numeric,
  add column if not exists uc_goldmine boolean,
  add column if not exists uc_strong   boolean,
  add column if not exists uc_elite    boolean;
