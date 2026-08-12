import { NextRequest, NextResponse } from 'next/server';
import { canonicalNseSymbol } from '@/lib/symbolCrossref';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Yahoo Finance helpers ──────────────────────────────────────────────────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
};

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function tryFetch(sym: string): Promise<{ ok: boolean; data?: unknown; status?: number; rateLimited?: boolean }> {
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false`;
      const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(5000) });
      if (r.status === 404) return { ok: false, status: 404 };
      if (r.status === 429) return { ok: false, status: 429, rateLimited: true };
      if (!r.ok) continue;
      return { ok: true, data: await r.json() };
    } catch { /* try next host */ }
  }
  return { ok: false };
}

async function tryFetchWithRetry(sym: string, maxRetries = 2): Promise<{ ok: boolean; data?: unknown; status?: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await tryFetch(sym);
    if (result.ok || result.status === 404) return result;
    // Shorter sleeps — fail fast so the scan worker can move to the next symbol
    if (result.rateLimited && attempt < maxRetries) { await sleep(200 * (attempt + 1)); continue; }
    if (!result.ok && attempt < maxRetries) { await sleep(150); continue; }
    return result;
  }
  return { ok: false };
}

// ── Meta-based candle repair ───────────────────────────────────────────────────
// Yahoo v8 chart responses include a `meta` object with regularMarketPrice and
// regularMarketTime — these are always populated even when the OHLCV candle array
// has close=null (the finalization lag that affects NSE stocks).
// Strategy: inject the meta price as a synthetic candle at the end of the array,
// so parseRaw in fetchClient.ts picks it up without any extra API call.

interface DayCandle { ts: number; o: number; h: number; l: number; c: number; v: number; }

// Extracts today's candle from the meta field already present in the Yahoo v8 response.
// Returns null if meta has no usable price or the price is not newer than lastValidDate.
function extractMetaCandle(
  yahooJson: Record<string, unknown>,
  lastValidDate: string,
  today: string,
): DayCandle | null {
  const r0 = ((yahooJson?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!r0) return null;
  const meta = r0.meta as Record<string, unknown> | undefined;
  if (!meta) return null;

  const metaTs = meta.regularMarketTime as number | undefined;
  const metaC  = meta.regularMarketPrice as number | undefined;
  if (!metaTs || !metaC || metaC <= 0 || !isFinite(metaC)) return null;

  // Convert meta timestamp to IST date and check it's newer than the last valid candle
  const metaDate = new Date((metaTs + 19800) * 1000).toISOString().slice(0, 10);
  if (metaDate <= lastValidDate || metaDate > today) return null;

  // Use OHLV from the existing null-close candle (the last timestamps entry) if available,
  // otherwise fall back to all fields = close.  This gives accurate high/low for the day.
  const timestamps = r0.timestamp as number[] | undefined;
  const q = ((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, (number | null)[]> | undefined;
  const lastIdx = (timestamps?.length ?? 0) - 1;
  const rawH = (lastIdx >= 0 ? q?.high?.[lastIdx] : null) ?? null;
  const rawL = (lastIdx >= 0 ? q?.low?.[lastIdx]  : null) ?? null;
  const rawO = (lastIdx >= 0 ? q?.open?.[lastIdx] : null) ?? null;
  const rawV = (lastIdx >= 0 ? q?.volume?.[lastIdx] : null) ?? null;

  const h = (rawH != null && isFinite(rawH) && rawH > 0) ? rawH : metaC;
  const l = (rawL != null && isFinite(rawL) && rawL > 0) ? rawL : metaC;
  const o = (rawO != null && isFinite(rawO) && rawO > 0) ? rawO : metaC;
  const v = (rawV != null && isFinite(rawV) && rawV >= 0) ? rawV : 0;

  const adjH = Math.max(h, o, metaC);
  const adjL = Math.min(l, o, metaC);
  if (adjL <= 0 || adjH <= 0 || adjL > adjH) return null;

  // Use the candle's own timestamp (midnight-ish UTC corresponding to the trading date)
  // rather than meta.regularMarketTime (intraday). Keeps the candle ts consistent with
  // what parseRaw expects when calculating IST dates.
  const candleTs = (timestamps && lastIdx >= 0) ? timestamps[lastIdx] : metaTs;
  return { ts: candleTs, o, h: adjH, l: adjL, c: metaC, v };
}

// Appends a single candle to the parallel arrays in Yahoo-format JSON.
// Used to patch the null-close latest-day issue without touching historical data.
// parseRaw already skips the null-close candle; this valid one comes after it.
function injectCandle(yahooJson: Record<string, unknown>, candle: DayCandle): Record<string, unknown> {
  const chart = yahooJson.chart as Record<string, unknown>;
  const results = (chart?.result as Record<string, unknown>[]) ?? [];
  const r0 = results[0];
  if (!r0) return yahooJson;

  const oldTs = (r0.timestamp as number[]) ?? [];
  const oldQ  = ((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, unknown[]> | undefined;
  if (!oldQ) return yahooJson;

  return {
    ...yahooJson,
    chart: {
      ...chart,
      result: [
        {
          ...r0,
          timestamp: [...oldTs, candle.ts],
          indicators: {
            ...r0.indicators as object,
            quote: [{
              open:   [...(oldQ.open   as number[]),            candle.o],
              high:   [...(oldQ.high   as number[]),            candle.h],
              low:    [...(oldQ.low    as number[]),            candle.l],
              close:  [...(oldQ.close  as (number | null)[]),  candle.c],
              volume: [...(oldQ.volume as number[]),            candle.v],
            }],
          },
        },
        ...results.slice(1),
      ],
    },
  };
}

// Replaces the last candle's close (and adjusts high/low) with the live
// meta.regularMarketPrice when it's for today. Used when today's candle already
// exists in Yahoo's response but was fetched early-in-day and is now stale
// (e.g. stock moved +5% after the first candle snapshot but meta.regularMarketPrice
// reflects the latest trade while the candle close does not).
function updateTodayWithMeta(
  yahooJson: Record<string, unknown>,
  today: string,
): Record<string, unknown> | null {
  const r0 = ((yahooJson?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!r0) return null;
  const meta = r0.meta as Record<string, unknown> | undefined;
  if (!meta) return null;

  const metaTs  = meta.regularMarketTime as number | undefined;
  const metaC   = meta.regularMarketPrice as number | undefined;
  if (!metaTs || !metaC || metaC <= 0 || !isFinite(metaC)) return null;

  // Only update if meta timestamp belongs to today (IST)
  const metaDate = new Date((metaTs + 19800) * 1000).toISOString().slice(0, 10);
  if (metaDate !== today) return null;

  const timestamps = r0.timestamp as number[] | undefined;
  if (!timestamps?.length) return null;
  const lastIdx = timestamps.length - 1;

  // Check meta is actually newer than the last candle's snapshot timestamp
  if (metaTs <= timestamps[lastIdx]) return null;

  const chart = yahooJson.chart as Record<string, unknown>;
  const oldQ = ((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, (number | null)[]> | undefined;
  if (!oldQ) return null;

  const oldH = (oldQ.high?.[lastIdx] ?? 0) as number;
  const oldL = (oldQ.low?.[lastIdx]  ?? metaC) as number;
  const newH  = Math.max(oldH, metaC);
  const newL  = oldL > 0 ? Math.min(oldL, metaC) : metaC;

  const newHigh  = [...(oldQ.high  as number[])];  newHigh[lastIdx]  = newH;
  const newLow   = [...(oldQ.low   as number[])];  newLow[lastIdx]   = newL;
  const newClose = [...(oldQ.close as (number | null)[])]; newClose[lastIdx] = metaC;

  return {
    ...yahooJson,
    chart: {
      ...chart,
      result: [{
        ...r0,
        indicators: {
          ...r0.indicators as object,
          quote: [{ ...oldQ, high: newHigh, low: newLow, close: newClose }],
        },
      }, ...((chart?.result as Record<string, unknown>[]).slice(1))],
    },
  };
}

// ── NSE Direct Fallback (last resort) ─────────────────────────────────────────
// NSE's official history API. Requires session cookies from a browser-like visit.
// NSE frequently blocks cloud/datacenter IPs; used only when all Yahoo paths fail.

const NSE_BASE_HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-IN,en-US;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const MONTHS_MAP: Record<string, string> = {
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
};

function parseNSETimestamp(ts: string): number {
  let iso: string;
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(ts)) {
    const [d, m, y] = ts.split('-');
    const mm = MONTHS_MAP[m]; if (!mm) return 0;
    iso = `${y}-${mm}-${d}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
    iso = ts;
  } else { return 0; }
  return Math.floor(Date.parse(iso + 'T00:00:00+05:30') / 1000);
}

function fmtNSEDate(d: Date): string {
  const ist = new Date(d.getTime() + 19800000);
  return `${String(ist.getUTCDate()).padStart(2,'0')}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${ist.getUTCFullYear()}`;
}

function extractCookies(h: string | null): string {
  if (!h) return '';
  return h.split(/,\s*(?=[^;=,\s]+=[^;,])/g).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function fetchFromNSE(bareSymbol: string): Promise<Record<string, unknown> | null> {
  let cookies = '';
  try {
    const cr = await fetch('https://www.nseindia.com/report-detail/eq_security', {
      headers: { ...NSE_BASE_HEADERS, referer: 'https://www.nseindia.com/', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'upgrade-insecure-requests': '1' },
      signal: AbortSignal.timeout(3000), redirect: 'follow',
    });
    const setCookieFn = (cr.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    cookies = setCookieFn
      ? setCookieFn.call(cr.headers).map((c: string) => c.split(';')[0].trim()).join('; ')
      : extractCookies(cr.headers.get('set-cookie'));
  } catch { return null; }

  const to = new Date(), from = new Date();
  from.setFullYear(from.getFullYear() - 2);
  const params = new URLSearchParams({ symbol: bareSymbol, from: fmtNSEDate(from), to: fmtNSEDate(to), type: 'priceVolumeDeliverable', series: 'ALL' });

  try {
    const dr = await fetch(`https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData?${params}`, {
      headers: { ...NSE_BASE_HEADERS, referer: 'https://www.nseindia.com/report-detail/eq_security', ...(cookies ? { cookie: cookies } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    if (!dr.ok) return null;
    const json = await dr.json();
    const data = json?.data;
    if (!Array.isArray(data) || data.length < 30) return null;

    const sorted = [...data].reverse();
    const timestamps: number[] = [], opens: number[] = [], highs: number[] = [], lows: number[] = [], closes: number[] = [], volumes: number[] = [];
    for (const row of sorted) {
      const tsVal = parseNSETimestamp(String(row.CH_TIMESTAMP ?? ''));
      const o = parseFloat(row.CH_OPENING_PRICE), h = parseFloat(row.CH_TRADE_HIGH_PRICE);
      const l = parseFloat(row.CH_TRADE_LOW_PRICE), c = parseFloat(row.CH_CLOSING_PRICE);
      const v = parseInt(String(row.CH_TOT_TRADED_QTY), 10);
      if (tsVal === 0 || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v)) continue;
      if (c <= 0 || h < l) continue;
      timestamps.push(tsVal); opens.push(o); highs.push(h); lows.push(l); closes.push(c); volumes.push(v);
    }
    if (timestamps.length < 30) return null;
    return { chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ open: opens, high: highs, low: lows, close: closes, volume: volumes }] } }] } };
  } catch { return null; }
}

// ── Staleness helpers ─────────────────────────────────────────────────────────

// Returns IST date of the last candle whose close is a valid positive number.
// Yahoo v8 sometimes returns the newest candle with close=null (finalization lag),
// which parseRaw in fetchClient.ts drops — this finds the last surviving candle date.
function getLastValidDateIST(json: Record<string, unknown>): string | null {
  const r0 = ((json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!r0) return null;
  const timestamps = r0.timestamp as number[] | undefined;
  const closes = (((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, (number | null)[]> | undefined)?.close;
  if (!timestamps?.length) return null;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const c = closes?.[i] ?? null;
    if (c != null && isFinite(c) && c > 0) return new Date((timestamps[i] + 19800) * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function todayIST(): string {
  return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rawSym = req.nextUrl.searchParams.get('symbol');
  if (!rawSym) return NextResponse.json({ error: 'missing symbol' }, { status: 400 });
  if (rawSym.length > 30 || !/^[A-Za-z0-9._^&-]+$/.test(rawSym)) return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
  const sym = canonicalNseSymbol(rawSym);

  const base = sym.replace(/\.(NS|BO)$/i, '');
  const isNS = sym.toUpperCase().endsWith('.NS') || !sym.includes('.');

  let candidates: string[];
  if (sym.startsWith('^'))                     candidates = [sym];  // index symbols are exact — no .NS/.BO variants
  else if (sym.toUpperCase().endsWith('.BO'))  candidates = [`${base}.BO`, `${base}.NS`];
  else if (sym.toUpperCase().endsWith('.NS')) candidates = [`${base}.NS`, `${base}.BO`];
  else                                         candidates = [`${base}.NS`, `${base}.BO`, base];
  candidates = [...new Set(candidates)];

  for (const candidate of candidates) {
    const result = await tryFetchWithRetry(candidate);
    if (!result.ok) continue;

    const json = result.data as Record<string, unknown>;
    const chartResult = (json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[];
    if (!chartResult?.[0]) continue;

    const entry = chartResult[0];
    const timestamps = entry.timestamp as number[] | undefined;
    const indicators = entry.indicators as Record<string, unknown[]> | undefined;
    const quote = indicators?.quote?.[0] as Record<string, unknown[]> | undefined;
    if (!timestamps || timestamps.length < 30 || !quote?.open || !quote?.close || !quote?.high || !quote?.low || !quote?.volume) continue;

    // For .NS symbols: detect and repair the null-close finalization lag.
    //
    // Yahoo v8 sometimes returns the latest candle with close=null for NSE stocks.
    // parseRaw drops it, making the CMP one day stale (e.g. JINDRILL shows Jul-7
    // ₹540.20 instead of Jul-8 ₹601.05 because Yahoo's Jul-8 candle has close=null).
    //
    // Fix (no extra API call): the v8 response always includes meta.regularMarketPrice —
    // the last traded price, which IS the closing price after market hours. We inject
    // this as a synthetic final candle so parseRaw picks up the correct close.
    //
    // Fallback (if meta is missing): try NSE direct API as last resort.
    if (candidate.toUpperCase().endsWith('.NS')) {
      const lastValidDate = getLastValidDateIST(json);
      const today = todayIST();
      if (lastValidDate && lastValidDate < today) {
        // Layer 1: meta.regularMarketPrice (already in the response — zero extra calls)
        const metaCandle = extractMetaCandle(json, lastValidDate, today);
        if (metaCandle) {
          return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: injectCandle(json, metaCandle) });
        }
        // Layer 2: NSE direct (may be blocked from datacenter IPs, silent on failure)
        const nseJson = await fetchFromNSE(base).catch(() => null);
        if (nseJson) {
          const nseLatest = getLastValidDateIST(nseJson);
          if (nseLatest && nseLatest > lastValidDate) {
            return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: nseJson });
          }
        }
      } else if (lastValidDate === today) {
        // Today's candle exists but may be stale (fetched early in the session).
        // meta.regularMarketPrice always reflects the last traded price — use it to
        // keep CMP current throughout the trading day without extra API calls.
        const updated = updateTodayWithMeta(json, today);
        if (updated) {
          return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: updated });
        }
      }
    }

    // For index symbols (^NSEI, ^INDIAVIX, etc.): indices always have today's candle
    // during market hours but the close may be a stale Yahoo snapshot.
    // Apply meta-price refresh so the displayed Nifty/VIX is the last traded price,
    // not a Yahoo cache value from an earlier point in the session.
    if (candidate.startsWith('^')) {
      const updated = updateTodayWithMeta(json, todayIST());
      if (updated) return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: updated });
    }

    return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: json });
  }

  // All Yahoo candidates failed — NSE last resort for .NS symbols
  if (isNS) {
    const nseJson = await fetchFromNSE(base).catch(() => null);
    if (nseJson) return NextResponse.json({ ok: true, resolvedSymbol: `${base}.NS`, raw: nseJson });
  }

  return NextResponse.json({ ok: false, error: `No data for ${sym}` }, { status: 404 });
}
