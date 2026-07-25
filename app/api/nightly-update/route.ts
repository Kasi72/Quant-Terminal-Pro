import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import type { TrackedTrade } from '@/lib/tradeOps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const USER_ID = 'drkkr';

// ── Yahoo Finance fetch (inline, same pattern as fetch-ohlcv/route.ts) ────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
};

const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function tryFetch(sym: string): Promise<{ ok: boolean; data?: unknown; rateLimited?: boolean }> {
  for (const host of YF_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&includePrePost=false`;
      const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(6000) });
      if (r.status === 404) return { ok: false };
      if (r.status === 429) return { ok: false, rateLimited: true };
      if (!r.ok) continue;
      return { ok: true, data: await r.json() };
    } catch { /* try next host */ }
  }
  return { ok: false };
}

async function tryFetchWithRetry(sym: string): Promise<{ ok: boolean; data?: unknown }> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await tryFetch(sym);
    if (res.ok) return res;
    if (res.rateLimited && attempt < 2) { await new Promise(r => setTimeout(r, 300 * (attempt + 1))); continue; }
    if (!res.ok && attempt < 2) { await new Promise(r => setTimeout(r, 150)); continue; }
    return res;
  }
  return { ok: false };
}

// ── Candle parsing ────────────────────────────────────────────────────────────

interface DayBar { date: string; open: number; high: number; low: number; close: number; }

function parseYahooCandles(json: Record<string, unknown>): DayBar[] {
  const r0 = ((json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!r0) return [];
  const timestamps = r0.timestamp as number[] | undefined;
  const q = ((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, (number | null)[]> | undefined;
  if (!timestamps || !q) return [];

  const bars: DayBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = q.open?.[i] ?? null, h = q.high?.[i] ?? null;
    const l = q.low?.[i] ?? null, c = q.close?.[i] ?? null;
    if (o == null || h == null || l == null || c == null) continue;
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (c <= 0 || h < l || h <= 0 || l <= 0) continue;
    // timestamps from Yahoo are UTC epoch; add IST offset (+5:30 = +19800s) for date
    const date = new Date((timestamps[i] + 19800) * 1000).toISOString().slice(0, 10);
    bars.push({ date, open: o, high: h, low: l, close: c });
  }
  return bars;
}

// ── Supabase row helpers (mirrored from tradeSync.ts) ─────────────────────────

function safeNum(v: unknown): number | undefined {
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function fromRow(row: Record<string, unknown>): TrackedTrade {
  const base = (row.raw_json ?? {}) as Partial<TrackedTrade>;
  return {
    ...base,
    symbol: (row.symbol ?? base.symbol) as string,
    status: (row.status ?? base.status) as TrackedTrade['status'],
    stage: (row.stage ?? base.stage) as TrackedTrade['stage'],
    entryPrice: safeNum(row.entry_price) ?? base.entryPrice ?? 0,
    stopLoss: safeNum(row.stop_loss) ?? base.stopLoss ?? 0,
    target1: safeNum(row.target1) ?? base.target1 ?? 0,
    target2: safeNum(row.target2) ?? base.target2 ?? 0,
    target3: safeNum(row.target3) ?? base.target3 ?? 0,
    disasterStop: safeNum(row.disaster_stop) ?? base.disasterStop ?? 0,
    entryDate: (row.entry_date ?? base.entryDate) as string,
    paramSetKey: (row.param_set_key ?? base.paramSetKey) as string,
    sector: (row.sector ?? base.sector) as string,
    conviction: safeNum(row.conviction) ?? base.conviction ?? 0,
    candlePattern: (row.candle_pattern ?? base.candlePattern) as string | undefined,
    atrState: (row.atr_state ?? base.atrState) as string | undefined,
    volumeBadge: (row.volume_badge ?? base.volumeBadge) as string | undefined,
    regimeAtEntry: (row.regime_at_entry ?? base.regimeAtEntry) as string | undefined,
    closedPrice: safeNum(row.exit_price) ?? base.closedPrice,
    closedDate: (row.exit_date ?? base.closedDate) as string | undefined,
    pnlPct: safeNum(row.pnl_pct) ?? base.pnlPct,
    tfAlignment: (row.tf_alignment ?? base.tfAlignment) as string | undefined,
    rsRank: safeNum(row.rs_rank) ?? base.rsRank,
    sw5LowAtEntry: safeNum(row.sw5_low_at_entry) ?? base.sw5LowAtEntry,
    atr14AtEntry: safeNum(row.atr14_at_entry) ?? base.atr14AtEntry,
  } as TrackedTrade;
}

function toRow(t: TrackedTrade) {
  return {
    user_id: USER_ID,
    symbol: t.symbol,
    stage: t.stage,
    entry_price: t.entryPrice,
    entry_date: t.entryDate,
    stop_loss: t.stopLoss,
    target1: t.target1,
    target2: t.target2,
    target3: t.target3,
    disaster_stop: t.disasterStop,
    param_set_key: t.paramSetKey,
    sector: t.sector,
    conviction: t.conviction,
    status: t.status,
    candle_pattern: t.candlePattern ?? null,
    atr_state: t.atrState ?? null,
    volume_badge: t.volumeBadge ?? null,
    regime_at_entry: t.regimeAtEntry ?? null,
    exit_price: t.closedPrice ?? null,
    exit_date: t.closedDate ?? null,
    pnl_pct: t.pnlPct ?? null,
    outcome: null,
    notes: t.notes ?? null,
    tf_alignment: t.tfAlignment ?? null,
    rs_rank: t.rsRank ?? null,
    sw5_low_at_entry: t.sw5LowAtEntry ?? null,
    atr14_at_entry: t.atr14AtEntry ?? null,
    raw_json: t,
    updated_at: new Date().toISOString(),
  };
}

// ── Trade status computation (candle-by-candle replay) ────────────────────────
// Uses intraday HIGH for target checks, intraday LOW for stop checks —
// more accurate than EOD close, matches real-world bracket-order behavior.

function processTrade(trade: TrackedTrade, bars: DayBar[]): TrackedTrade {
  if (trade.status !== 'open') return trade;

  const entryDate = trade.entryDate.slice(0, 10);
  const postEntry = bars.filter(b => b.date > entryDate);
  if (postEntry.length === 0) return trade;

  const rps = trade.entryPrice > 0 && trade.stopLoss > 0
    ? trade.entryPrice - trade.stopLoss : 0;

  let mfe = trade.mfe ?? 0;
  let mae = trade.mae ?? 0;
  let highestPrice = trade.highestPrice ?? trade.entryPrice;

  const mfeR = (pct: number) => rps > 0 ? Math.round((pct / 100 * trade.entryPrice / rps) * 100) / 100 : undefined;
  const maeR = (pct: number) => rps > 0 ? Math.round((pct / 100 * trade.entryPrice / rps) * 100) / 100 : undefined;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const daysFrom = (date: string) =>
    Math.ceil((new Date(date).getTime() - new Date(entryDate).getTime()) / 86400000);

  const baseUpdate = (bar: DayBar) => ({
    ...trade,
    currentPrice: bar.close,
    highestPrice,
    mfe: round2(mfe),
    mae: round2(mae),
    mfeR: mfeR(mfe),
    maeR: maeR(mae),
    daysHeld: daysFrom(bar.date),
    lastCheckDate: bar.date,
  });

  for (const bar of postEntry) {
    // Track MFE / MAE before checking exits
    const barMfe = ((bar.high - trade.entryPrice) / trade.entryPrice) * 100;
    const barMae = ((trade.entryPrice - bar.low) / trade.entryPrice) * 100;
    if (barMfe > mfe) mfe = barMfe;
    if (barMae > mae) mae = barMae;
    if (bar.high > highestPrice) highestPrice = bar.high;

    // Stop check: use stricter of disasterStop and stopLoss
    const stopLevel = (trade.disasterStop > 0 && trade.stopLoss > 0)
      ? Math.max(trade.disasterStop, trade.stopLoss)
      : (trade.stopLoss > 0 ? trade.stopLoss : trade.disasterStop);

    if (stopLevel > 0 && bar.low <= stopLevel) {
      const pnlPct = round2(((stopLevel - trade.entryPrice) / trade.entryPrice) * 100);
      return {
        ...baseUpdate(bar),
        status: 'stopped',
        closedPrice: stopLevel,
        closedDate: bar.date,
        pnlPct,
        pnlR: rps > 0 ? round2((stopLevel - trade.entryPrice) / rps) : -1,
      };
    }

    // Target checks — T3 first (highest bar)
    if (trade.target3 > 0 && bar.high >= trade.target3) {
      const wt = trade.target1 * 0.5 + trade.target2 * 0.3 + trade.target3 * 0.2;
      const pnlPct = round2(((wt - trade.entryPrice) / trade.entryPrice) * 100);
      return {
        ...baseUpdate(bar),
        status: 'hit_t3',
        closedPrice: trade.target3,
        closedDate: bar.date,
        pnlPct,
        pnlR: rps > 0 ? round2((wt - trade.entryPrice) / rps) : 0,
      };
    }
    if (trade.target2 > 0 && bar.high >= trade.target2) {
      const wt = trade.target1 * 0.5 + trade.target2 * 0.3 + bar.close * 0.2;
      const pnlPct = round2(((wt - trade.entryPrice) / trade.entryPrice) * 100);
      return {
        ...baseUpdate(bar),
        status: 'hit_t2',
        closedPrice: trade.target2,
        closedDate: bar.date,
        pnlPct,
        pnlR: rps > 0 ? round2((wt - trade.entryPrice) / rps) : 0,
      };
    }
    if (trade.target1 > 0 && bar.high >= trade.target1) {
      const wt = trade.target1 * 0.5 + bar.close * 0.5;
      const pnlPct = round2(((wt - trade.entryPrice) / trade.entryPrice) * 100);
      return {
        ...baseUpdate(bar),
        status: 'hit_t1',
        closedPrice: trade.target1,
        closedDate: bar.date,
        pnlPct,
        pnlR: rps > 0 ? round2((wt - trade.entryPrice) / rps) : 0,
      };
    }
  }

  // Still open — apply expiry check and update metrics
  const lastBar = postEntry[postEntry.length - 1];
  const daysHeld = daysFrom(lastBar.date);

  if (daysHeld >= 20) {
    const pnlPct = round2(((lastBar.close - trade.entryPrice) / trade.entryPrice) * 100);
    return {
      ...baseUpdate(lastBar),
      status: 'expired',
      closedPrice: lastBar.close,
      closedDate: lastBar.date,
      pnlPct,
      pnlR: rps > 0 ? round2((lastBar.close - trade.entryPrice) / rps) : 0,
    };
  }

  return { ...baseUpdate(lastBar), status: 'open' };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const db = getServiceClient();

  // Load all open trades
  const { data: rows, error: loadErr } = await db
    .from('tracked_trades')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('status', 'open');

  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });

  const trades = (rows ?? []).map(fromRow);
  if (trades.length === 0) return NextResponse.json({ ok: true, open: 0, processed: 0, updated: 0 });

  // Process in parallel batches of 5 to respect Yahoo rate limits
  const summary = {
    ok: true,
    open: trades.length,
    processed: 0,
    updated: 0,
    stopped: 0, hit_t1: 0, hit_t2: 0, hit_t3: 0, expired: 0,
    errors: [] as string[],
  };

  const processTrade_ = async (trade: TrackedTrade) => {
    const sym = trade.symbol.includes('.') ? trade.symbol : `${trade.symbol}.NS`;

    const fetched = await tryFetchWithRetry(sym);
    if (!fetched.ok || !fetched.data) {
      summary.errors.push(`${trade.symbol}: fetch failed`);
      return;
    }

    const bars = parseYahooCandles(fetched.data as Record<string, unknown>);
    if (bars.length === 0) {
      summary.errors.push(`${trade.symbol}: no candles`);
      return;
    }

    const updated = processTrade(trade, bars);
    summary.processed++;

    // Always upsert to keep currentPrice, mfe, mae fresh even if status unchanged
    const { error: upsertErr } = await db
      .from('tracked_trades')
      .upsert(toRow(updated), { onConflict: 'user_id,symbol' });

    if (upsertErr) {
      summary.errors.push(`${trade.symbol}: upsert failed: ${upsertErr.message}`);
      return;
    }

    summary.updated++;
    if (updated.status !== trade.status) {
      const k = updated.status as keyof typeof summary;
      if (typeof summary[k] === 'number') (summary[k] as number)++;
    }
  };

  const BATCH = 5;
  for (let i = 0; i < trades.length; i += BATCH) {
    await Promise.all(trades.slice(i, i + BATCH).map(processTrade_));
  }

  return NextResponse.json(summary);
}
