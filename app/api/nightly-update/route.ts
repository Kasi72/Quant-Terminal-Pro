import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { isTerminalTrade, type TrackedTrade } from '@/lib/tradeOps';
import { validateTrade, applyValidation } from '@/lib/autoValidator';
import { deriveTradeEventRows, primaryTradeEventType, summarizeTradeEvents } from '@/lib/tradeEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  for (let attempt = 0; attempt <= 1; attempt++) {
    const res = await tryFetch(sym);
    if (res.ok) return res;
    if (res.rateLimited && attempt < 1) { await new Promise(r => setTimeout(r, 500)); continue; }
    if (!res.ok && attempt < 1) { await new Promise(r => setTimeout(r, 200)); continue; }
    return res;
  }
  return { ok: false };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  });
  await Promise.all(runners);
}

// ── Candle parsing ────────────────────────────────────────────────────────────

interface DayBar { date: string; open: number; high: number; low: number; close: number; volume: number; }

function parseYahooCandles(json: Record<string, unknown>): DayBar[] {
  const r0 = ((json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!r0) return [];
  const timestamps = r0.timestamp as number[] | undefined;
  const q = ((r0.indicators as Record<string, unknown[]>)?.quote?.[0]) as Record<string, (number | null)[]> | undefined;
  if (!timestamps || !q) return [];
  const meta = r0.meta as Record<string, unknown> | undefined;
  const metaTime = Number(meta?.regularMarketTime);
  const metaPrice = Number(meta?.regularMarketPrice);
  const metaDate = Number.isFinite(metaTime)
    ? new Date((metaTime + 19800) * 1000).toISOString().slice(0, 10)
    : null;

  const bars: DayBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date((timestamps[i] + 19800) * 1000).toISOString().slice(0, 10);
    const o = q.open?.[i] ?? null;
    let h = q.high?.[i] ?? null;
    let l = q.low?.[i] ?? null;
    let c = q.close?.[i] ?? null;
    const v = q.volume?.[i] ?? 0;
    if (
      i === timestamps.length - 1 &&
      metaDate === date &&
      Number.isFinite(metaPrice) &&
      metaPrice > 0 &&
      Number.isFinite(metaTime) &&
      metaTime > timestamps[i]
    ) {
      c = metaPrice;
      if (h != null) h = Math.max(h, metaPrice);
      if (l != null) l = Math.min(l, metaPrice);
    }
    if (o == null || h == null || l == null || c == null) continue;
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (c <= 0 || h < l || h <= 0 || l <= 0) continue;
    bars.push({ date, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) && v > 0 ? v : 0 });
  }
  return bars;
}

// ── Supabase row helpers (mirrored from tradeSync.ts) ─────────────────────────

function safeNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function safeDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const date = v.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
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
    entryDate: safeDate(row.entry_date) ?? safeDate(base.entryDate) ?? '',
    paramSetKey: (row.param_set_key ?? base.paramSetKey) as string,
    sector: (row.sector ?? base.sector) as string,
    conviction: safeNum(row.conviction) ?? base.conviction ?? 0,
    candlePattern: (row.candle_pattern ?? base.candlePattern) as string | undefined,
    atrState: (row.atr_state ?? base.atrState) as string | undefined,
    volumeBadge: (row.volume_badge ?? base.volumeBadge) as string | undefined,
    regimeAtEntry: (row.regime_at_entry ?? base.regimeAtEntry) as string | undefined,
    closedPrice: safeNum(row.exit_price),
    // The normalized columns are authoritative. Legacy raw_json sometimes marked
    // T1/T2 milestones with a closedDate even though those trades remain active.
    closedDate: safeDate(row.exit_date),
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
    exit_date: safeDate(t.closedDate) ?? null,
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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getServiceClient();
  const startedAt = Date.now();
  const schedule = req.headers.get('x-vercel-cron-schedule');
  let runId: string | null = null;

  const finishRun = async (
    status: 'completed' | 'partial' | 'failed',
    values: Record<string, unknown>,
  ) => {
    if (!runId) return;
    const { error } = await db.from('nightly_update_runs').update({
      ...values,
      status,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    }).eq('id', runId);
    if (error) console.error('[nightly-update] audit update failed', error.message);
  };

  const { data: run, error: runErr } = await db.from('nightly_update_runs').insert({
    trigger_source: schedule ? 'vercel-cron' : 'manual',
    schedule,
  }).select('id').single();
  if (runErr) console.error('[nightly-update] audit insert failed', runErr.message);
  runId = run?.id ?? null;

  try {
    const [{ data: rows, error: loadErr }, { data: existingLogs, error: logsErr }] = await Promise.all([
      db.from('tracked_trades').select('*').eq('user_id', USER_ID),
      db.from('trade_daily_log').select('symbol,date').eq('user_id', USER_ID),
    ]);

    if (loadErr) throw new Error(`trade load failed: ${loadErr.message}`);
    if (logsErr) throw new Error(`daily-log load failed: ${logsErr.message}`);

    const latestLogBySymbol = new Map<string, string>();
    for (const row of existingLogs ?? []) {
      const symbol = String(row.symbol);
      const date = String(row.date);
      const current = latestLogBySymbol.get(symbol);
      if (!current || date > current) latestLogBySymbol.set(symbol, date);
    }

    const allTrades = (rows ?? []).map(fromRow);
    const trades = allTrades.filter(trade => {
      if (!isTerminalTrade(trade)) return true;
      const terminalDate = trade.closedDate?.slice(0, 10);
      if (!terminalDate) return false;
      const latestLogDate = latestLogBySymbol.get(trade.symbol);
      return !latestLogDate || latestLogDate < terminalDate;
    });

    const summary = {
      ok: true,
      runId,
      totalTrades: allTrades.length,
      candidates: trades.length,
      open: trades.filter(trade => !isTerminalTrade(trade)).length,
      reconciledTerminal: trades.filter(isTerminalTrade).length,
      processed: 0,
      updated: 0,
      logRows: 0,
      latestMarketDate: null as string | null,
      stopped: 0,
      hit_t1: 0,
      hit_t2: 0,
      hit_t3: 0,
      expired: 0,
      errors: [] as string[],
    };

    const processTrade_ = async (trade: TrackedTrade) => {
      try {
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

        const entryDate = trade.entryDate.slice(0, 10);
        const terminalDateBeforeReplay = trade.closedDate?.slice(0, 10);
        const postEntry = bars.filter(bar =>
          bar.date > entryDate &&
          (!terminalDateBeforeReplay || bar.date <= terminalDateBeforeReplay)
        );
        const preEntry = bars.filter(bar => bar.date <= entryDate).slice(-30);
        const lastBar = postEntry[postEntry.length - 1];
        const validation = isTerminalTrade(trade)
          ? null
          : validateTrade(trade, postEntry.map(bar => ({
              o: bar.open,
              h: bar.high,
              l: bar.low,
              c: bar.close,
              v: bar.volume,
              d: bar.date,
            })), {
              preEntryCandles: preEntry.map(bar => ({
                o: bar.open,
                h: bar.high,
                l: bar.low,
                c: bar.close,
                v: bar.volume,
                d: bar.date,
              })),
              maxHoldBars: trade.maxHoldBars,
            });
        const updated = lastBar
          ? {
              ...(validation ? applyValidation(trade, validation) : trade),
              currentPrice: lastBar.close,
              lastCheckDate: lastBar.date,
            }
          : trade;
        summary.processed++;

        const { error: upsertErr } = await db
          .from('tracked_trades')
          .upsert(toRow(updated), { onConflict: 'user_id,symbol' });
        if (upsertErr) {
          summary.errors.push(`${trade.symbol}: upsert failed: ${upsertErr.message}`);
          return;
        }

        summary.updated++;
        if (updated.status !== trade.status) {
          const key = updated.status as keyof typeof summary;
          if (typeof summary[key] === 'number') (summary[key] as number)++;
        }

        const terminalDate = updated.closedDate?.slice(0, 10) ?? null;
        let cumMfe = 0;
        let cumMae = 0;
        const priceRows: Array<{
          date: string;
          dayNum: number;
          open: number;
          high: number;
          low: number;
          close: number;
          mfePct: number;
          maePct: number;
        }> = [];

        for (let index = 0; index < postEntry.length; index++) {
          const bar = postEntry[index];
          const barMfe = ((bar.high - trade.entryPrice) / trade.entryPrice) * 100;
          const barMae = ((trade.entryPrice - bar.low) / trade.entryPrice) * 100;
          if (barMfe > cumMfe) cumMfe = barMfe;
          if (barMae > cumMae) cumMae = barMae;

          priceRows.push({
            date: bar.date,
            open: Math.round(bar.open * 100) / 100,
            high: Math.round(bar.high * 100) / 100,
            low: Math.round(bar.low * 100) / 100,
            close: Math.round(bar.close * 100) / 100,
            dayNum: index + 1,
            mfePct: Math.round(cumMfe * 100) / 100,
            maePct: Math.round(cumMae * 100) / 100,
          });
          if (terminalDate && bar.date >= terminalDate) break;
        }

        const derivedEvents = deriveTradeEventRows(updated, priceRows);
        const logRows: Record<string, unknown>[] = priceRows.map((row, index) => {
          const events = derivedEvents[index]?.events ?? [];
          return {
            user_id: USER_ID,
            symbol: trade.symbol,
            date: row.date,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            day_num: row.dayNum,
            mfe_pct: row.mfePct,
            mae_pct: row.maePct,
            event_type: primaryTradeEventType(events),
            event_detail: summarizeTradeEvents(events),
          };
        });

        if (logRows.length > 0) {
          const { error: logErr } = await db.from('trade_daily_log')
            .upsert(logRows, { onConflict: 'user_id,symbol,date' });
          if (logErr) {
            summary.errors.push(`${trade.symbol}: log upsert failed: ${logErr.message}`);
          } else {
            summary.logRows += logRows.length;
          }
        }

        if (lastBar && (!summary.latestMarketDate || lastBar.date > summary.latestMarketDate)) {
          summary.latestMarketDate = lastBar.date;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`${trade.symbol}: ${message}`);
      }
    };

    await runWithConcurrency(trades, 3, processTrade_);
    summary.ok = summary.errors.length === 0;
    const status = summary.ok ? 'completed' : 'partial';
    await finishRun(status, {
      total_trades: summary.totalTrades,
      candidates: summary.candidates,
      processed: summary.processed,
      updated: summary.updated,
      log_rows: summary.logRows,
      latest_market_date: summary.latestMarketDate,
      errors: summary.errors,
    });
    console.info('[nightly-update]', JSON.stringify(summary));
    return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { errors: [message] });
    console.error('[nightly-update] failed', message);
    return NextResponse.json({ ok: false, runId, error: message }, { status: 500 });
  }
}
