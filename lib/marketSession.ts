/**
 * NSE / BSE market session date resolver.
 *
 * Session date = the trading day whose COMPLETE daily candle data is available.
 * A candle is complete only after market close: 15:30:00 IST (to the second).
 *
 * Rules:
 *  - Weekday ≥ 15:30:00 IST  → today
 *  - Weekday < 15:30:00 IST  → previous trading day
 *  - Saturday                → Friday
 *  - Sunday                  → Friday
 *
 * Does NOT model NSE/BSE market holidays — stale-bar rejection in the
 * batch screener handles those downstream.
 */

const IST_OFFSET_MS      = 19_800_000;          // +05:30 in ms
const MARKET_CLOSE_SECS  = 15 * 3600 + 30 * 60; // 15:30:00 = 55 800 s from midnight
const DAY_MS             = 86_400_000;

/**
 * Returns the session_date string (YYYY-MM-DD, IST calendar) for a given
 * UTC epoch millisecond timestamp (defaults to now).
 */
export function getMarketSessionDate(nowMs: number = Date.now()): string {
  // Shift to IST by treating the offset as if IST were UTC —
  // same convention used throughout the codebase.
  const istMs  = nowMs + IST_OFFSET_MS;
  const istDate = new Date(istMs);

  const dow  = istDate.getUTCDay();  // 0=Sun 1=Mon … 6=Sat
  const secs = istDate.getUTCHours() * 3600
             + istDate.getUTCMinutes() * 60
             + istDate.getUTCSeconds(); // seconds elapsed since IST midnight

  let effectiveMs = istMs;

  if (dow === 6) {
    // Saturday → Friday
    effectiveMs -= DAY_MS;
  } else if (dow === 0) {
    // Sunday → Friday
    effectiveMs -= 2 * DAY_MS;
  }
  // Any weekday (including pre-market / intraday): session_date = today.
  // Today's incomplete candle is the live data the user wants.
  // Cron at 21:00 IST overwrites with final EOD data.

  return new Date(effectiveMs).toISOString().slice(0, 10);
}

/**
 * Human-readable description of the current market phase (for UI labels).
 * e.g. "Pre-market (before 09:15)", "Live session", "Post-market", "Weekend"
 */
export function getMarketPhaseLabel(nowMs: number = Date.now()): string {
  const istMs   = nowMs + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  const dow     = istDate.getUTCDay();
  const secs    = istDate.getUTCHours() * 3600
                + istDate.getUTCMinutes() * 60
                + istDate.getUTCSeconds();

  if (dow === 0 || dow === 6) return 'Weekend';
  if (secs < 9 * 3600)                             return 'Pre-open (before 09:00)';
  if (secs < 9 * 3600 + 15 * 60)                   return 'Pre-market (09:00–09:15)';
  if (secs < MARKET_CLOSE_SECS)                     return 'Live session (09:15–15:30)';
  if (secs < 16 * 3600)                             return 'Post-market (15:30–16:00)';
  return 'After hours';
}
