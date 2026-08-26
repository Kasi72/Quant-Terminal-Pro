import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { analyzeStockMulti } from '@/lib/stockEngine';
import { NIFTY_PRESETS } from '@/lib/niftyPresets';
import type { Candle } from '@/lib/compute';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  return !!secret && auth === `Bearer ${secret}`;
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
};

const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchYahoo(sym: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    for (const host of YF_HOSTS) {
      try {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&includePrePost=false`;
        const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
        if (r.status === 404) return null;
        if (r.status === 429) { await sleep(400 * (attempt + 1)); continue; }
        if (!r.ok) continue;
        return await r.json() as Record<string, unknown>;
      } catch { /* try next host */ }
    }
    if (attempt < 1) await sleep(200);
  }
  return null;
}

// ── Parse Yahoo JSON → Candle[] ───────────────────────────────────────────────
// Mirrors parseRaw in lib/fetchClient.ts (not exported there).

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
    if (!Number.isFinite(c) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(v) || !Number.isFinite(o)) continue;
    if (c <= 0 || v < 0) continue;
    const adjH = Math.max(h, o, c);
    const adjL = Math.min(l, o, c);
    if (adjH <= 0 || adjL <= 0 || adjL > adjH) continue;
    candles.push({ ts: timestamps[i], o, h: adjH, l: adjL, c, v });
  }
  return candles;
}

// ── Concurrency runner ────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        await worker(items[next++]);
      }
    })
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  console.log(`[batch-screener] secret_set=${!!secret} secret_len=${secret?.length ?? 0} auth_len=${auth.length} auth_prefix=${auth.slice(0,7)}`);
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  // Session date in IST
  const sessionDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

  const preset = NIFTY_PRESETS.find(p => p.key === 'clean_nse_2026');
  if (!preset) return NextResponse.json({ error: 'clean_nse_2026 preset not found' }, { status: 500 });

  const symbols = preset.symbols;
  const rows: Record<string, unknown>[] = [];
  let fetched = 0;
  let failed = 0;

  await runWithConcurrency(symbols, 6, async (sym) => {
    const json = await fetchYahoo(`${sym}.NS`);
    if (!json) { failed++; return; }

    const candles = parseRaw(json);
    if (candles.length < 20) { failed++; return; }

    const result = analyzeStockMulti(candles, sym);
    fetched++;

    rows.push({
      session_date:    sessionDate,
      symbol:          sym,
      best_stage:      result.best.stage,
      best_param_set:  result.best.paramSetKey ?? null,
      inflection_score: result.best.inflectionScore ?? null,
      last_close:      result.lastClose ?? null,
      uc_score:        result.best.ucScore ?? null,
      passed_sets:     result.passedSets,
      passed_count:    result.passedCount,
      raw_json:        result,
    });
  });

  // Upsert to Supabase in batches of 100
  let upserted = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('daily_scan_results')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'session_date,symbol' });
    if (!error) upserted += Math.min(BATCH, rows.length - i);
  }

  const signals = rows.filter(r => r.best_stage !== 'NO_SIGNAL').length;

  return NextResponse.json({
    ok: true,
    sessionDate,
    total: symbols.length,
    fetched,
    failed,
    signals,
    upserted,
  });
}
