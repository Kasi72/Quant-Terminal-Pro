-- Brain V3 configuration store — key/value table for live model updates
-- Stores winner cluster centroids, false-negative candidates, daily precision snapshots.
-- Page reads centroids at scan time; no deploy needed when model updates.

CREATE TABLE IF NOT EXISTS uc_brain_config (
  config_key   TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Rows that will be upserted by pattern_similarity_engine.js and daily_brain_trainer.js:
--   'winner_clusters'        → { version, trained_on, n_winners, clusters: [{id,centroid,precision,n}] }
--   'false_negative_clauses' → { version, candidate_clauses: [{id,fA,fB,threshA,threshB,precision,n}] }
--   'daily_precision'        → { date, clauses: {A:{p7d,p14d,p30d}, B:..., ANY:...}, drift_flags }

ALTER TABLE uc_brain_config ENABLE ROW LEVEL SECURITY;

-- Allow service role full access; anon/authenticated can only read
CREATE POLICY "service full access" ON uc_brain_config
  FOR ALL TO service_role USING (true);

CREATE POLICY "anon read" ON uc_brain_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated read" ON uc_brain_config
  FOR SELECT TO authenticated USING (true);
