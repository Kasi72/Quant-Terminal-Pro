import type { Candle } from './compute';
import { canonicalNseSymbol } from './symbolCrossref';

function parseRaw(json: Record<string, unknown>): Candle[] {
  const chartResult = (json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[];
  const result = chartResult?.[0];
  if (!result) return [];

  const quotes = (result.indicators as Record<string, unknown[]>)?.quote?.[0] as Record<string, (number | null)[]> | undefined;
  const timestamps = (result.timestamp as number[]) ?? [];
  if (!quotes) return [];
  const candles: Candle[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const c = quotes.close?.[i] ?? null;
    const h = quotes.high?.[i] ?? null;
    const l = quotes.low?.[i] ?? null;
    const v = quotes.volume?.[i] ?? null;
    const o = quotes.open?.[i] ?? null;
    if (c == null || h == null || l == null || v == null || o == null) continue;
    if (!Number.isFinite(c) || !Number.isFinite(h) || !Number.isFinite(l) ||
        !Number.isFinite(v) || !Number.isFinite(o)) continue;
    if (c <= 0 || v < 0) continue;
    // Normalize before validating — Yahoo Finance NSE data occasionally has close > high
    // or open < low around corporate actions / circuit limits. Clamp rather than drop.
    const adjH = Math.max(h, o, c);
    const adjL = Math.min(l, o, c);
    if (adjH <= 0 || adjL <= 0 || adjL > adjH) continue;
    candles.push({ ts: timestamps[i], o, h: adjH, l: adjL, c, v });
  }
  return candles;
}

// Calls our own API proxy (/api/fetch-ohlcv) which fetches Yahoo Finance server-side
// This avoids both CORS (browser → YF) and datacenter IP blocking (Vercel → YF with browser headers)
export async function fetchOHLCVClient(rawSymbol: string): Promise<{ candles: Candle[]; resolvedSymbol: string }> {
  const sym = canonicalNseSymbol(rawSymbol);

  const res = await fetch(`/api/fetch-ohlcv?symbol=${encodeURIComponent(sym)}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch { /* ignore */ }
    throw new Error(errMsg);
  }

  const body = await res.json();
  if (!body.ok) throw new Error(body.error ?? 'No data returned');

  if (!body.raw) throw new Error('Missing raw candle data');
  const candles = parseRaw(body.raw);
  if (candles.length < 30) {
    throw new Error(`Too few candles (${candles.length}) — possibly delisted or suspended`);
  }

  return { candles, resolvedSymbol: body.resolvedSymbol };
}
