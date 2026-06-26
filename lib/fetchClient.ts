import type { Candle } from './compute';

function parseRaw(json: Record<string, unknown>): Candle[] {
  const chartResult = (json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[];
  const result = chartResult?.[0];
  if (!result) return [];

  const quotes = (result.indicators as Record<string, unknown[]>)?.quote?.[0] as Record<string, (number | null)[]>;
  const timestamps = (result.timestamp as number[]) ?? [];
  const candles: Candle[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const c = quotes.close?.[i] ?? null;
    const h = quotes.high?.[i] ?? null;
    const l = quotes.low?.[i] ?? null;
    const v = quotes.volume?.[i] ?? null;
    const o = quotes.open?.[i] ?? null;
    if (c != null && h != null && l != null && v != null && o != null
      && Number.isFinite(c) && Number.isFinite(h) && Number.isFinite(l)
      && Number.isFinite(v) && Number.isFinite(o)
      && h > 0 && c > 0 && l > 0 && v >= 0
      && h >= l && h >= o && h >= c && l <= o && l <= c) {
      candles.push({ ts: timestamps[i], o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v });
    }
  }
  return candles;
}

// Calls our own API proxy (/api/fetch-ohlcv) which fetches Yahoo Finance server-side
// This avoids both CORS (browser → YF) and datacenter IP blocking (Vercel → YF with browser headers)
export async function fetchOHLCVClient(rawSymbol: string): Promise<{ candles: Candle[]; resolvedSymbol: string }> {
  const sym = rawSymbol.trim().toUpperCase();

  const res = await fetch(`/api/fetch-ohlcv?symbol=${encodeURIComponent(sym)}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch { /* ignore */ }
    throw new Error(`${sym}: ${errMsg}`);
  }

  const body = await res.json();
  if (!body.ok) throw new Error(`${sym}: ${body.error ?? 'no data'}`);

  const candles = parseRaw(body.raw);
  if (candles.length < 30) {
    throw new Error(`${sym}: too few candles (${candles.length})`);
  }

  return { candles, resolvedSymbol: body.resolvedSymbol };
}
