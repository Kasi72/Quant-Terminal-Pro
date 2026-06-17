-- Screening sessions
CREATE TABLE IF NOT EXISTS screening_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz DEFAULT now(),
  symbol_count  int NOT NULL DEFAULT 0,
  processed     int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending',
  error_msg     text
);

ALTER TABLE screening_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read sessions" ON screening_sessions FOR SELECT USING (true);
CREATE POLICY "service insert sessions" ON screening_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "service update sessions" ON screening_sessions FOR UPDATE USING (true);

-- Screening results
CREATE TABLE IF NOT EXISTS screening_results (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                 uuid REFERENCES screening_sessions(id) ON DELETE CASCADE,
  symbol                     text NOT NULL,
  last_close                 numeric,
  last_date                  date,
  avg_turnover_20            numeric,
  atr_pct14_pctl120          numeric,
  pre10_avg_range_atr        numeric,
  pre10_expansion_count      int,
  compression_zone_len       int,
  zone_tightness_pct         numeric,
  pre10_avg_vol_ratio        numeric,
  pre5_avg_vol_ratio         numeric,
  pre10_high_vol_count       int,
  pre10_red_vol_bias         numeric,
  exact_range_atr            numeric,
  exact_vol_ratio20          numeric,
  exact_vol_vs_pre5          numeric,
  close_loc                  numeric,
  upper_wick_pct             numeric,
  body_pct                   numeric,
  signal_range_pct           numeric,
  ultra_precision_score      numeric,
  rsi2                       numeric,
  volatility_expansion_ratio numeric,
  candle_quality_score       int,
  passed_deployable          boolean DEFAULT false,
  passed_high_precision      boolean DEFAULT false,
  passed_elite               boolean DEFAULT false,
  passed_ultra_selective     boolean DEFAULT false,
  clusters_passed            int DEFAULT 0,
  error                      text
);

ALTER TABLE screening_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read results" ON screening_results FOR SELECT USING (true);
CREATE POLICY "service insert results" ON screening_results FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_results_session ON screening_results(session_id);
CREATE INDEX IF NOT EXISTS idx_results_clusters ON screening_results(clusters_passed DESC);

-- Helper: atomically increment processed count
CREATE OR REPLACE FUNCTION increment_processed(sid uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE screening_sessions
  SET processed = processed + 1
  WHERE id = sid;
$$;

-- Helper: mark session done
CREATE OR REPLACE FUNCTION finalize_session(sid uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE screening_sessions SET status = 'done' WHERE id = sid;
$$;
