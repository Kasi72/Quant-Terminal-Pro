-- Sweep function: deletes rows from daily_scan_results older than the N most
-- recent distinct session_dates. Called by /api/batch-screener after each nightly run.

CREATE OR REPLACE FUNCTION sweep_old_scan_sessions(keep_n INTEGER DEFAULT 10)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM daily_scan_results
  WHERE session_date NOT IN (
    SELECT DISTINCT session_date
    FROM daily_scan_results
    ORDER BY session_date DESC
    LIMIT keep_n
  );
$$;
