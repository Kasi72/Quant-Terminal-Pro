-- Daily batch screener results — one row per symbol per trading session.
-- Populated nightly by /api/batch-screener (cron 15:30 UTC = 21:00 IST).
-- Frontend reads this table on page load for instant results (no live Yahoo fetch).

CREATE TABLE IF NOT EXISTS daily_scan_results (
  id             BIGSERIAL PRIMARY KEY,
  session_date   DATE        NOT NULL,
  symbol         TEXT        NOT NULL,
  best_stage     TEXT        NOT NULL,  -- e.g. 'BUY', 'STRONG_BUY', 'NO_SIGNAL'
  best_param_set TEXT,                  -- winning ParamSetKey
  inflection_score NUMERIC,
  last_close     NUMERIC,
  uc_score       NUMERIC,
  passed_sets    TEXT[]      DEFAULT '{}',
  passed_count   INTEGER     DEFAULT 0,
  raw_json       JSONB,                 -- full MultiAnalysisResult for front-end use
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_dsr_date_stage
  ON daily_scan_results (session_date, best_stage);

CREATE INDEX IF NOT EXISTS idx_dsr_date_score
  ON daily_scan_results (session_date, inflection_score DESC NULLS LAST);

-- RLS: service role writes; anon/authenticated reads own-date rows (public screener data)
ALTER TABLE daily_scan_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON daily_scan_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon read" ON daily_scan_results
  FOR SELECT TO anon, authenticated USING (true);
