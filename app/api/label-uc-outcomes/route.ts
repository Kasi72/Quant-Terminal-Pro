import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Called daily by Vercel cron at 11:30 UTC (17:00 IST, ~90min after market close).
// Labels UC candidates logged yesterday:
//   1. Cross-references pbfb_uc_events — did the stock appear as n_before=1 on scan_date?
//      If yes → hit_uc_next_day = true (stock circuited the next day)
//   2. Fetches next-day price from Yahoo Finance for ALL logged symbols
//      → records next_day_chg_pct, hit_5pct_3d

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json',
  'Referer': 'https://finance.yahoo.com/',
};

function prevTradingDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  // skip weekends
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

async function fetchYFChange(symbol: string): Promise<number | null> {
  // symbol from NSE has no suffix; Yahoo needs .NS
  const yfSym = symbol.includes('.') ? symbol : `${symbol}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=1d&range=5d`;
  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json() as { chart?: { result?: Array<{ meta?: { regularMarketChangePercent?: number } }> } };
    const pct = j?.chart?.result?.[0]?.meta?.regularMarketChangePercent;
    return typeof pct === 'number' ? Math.round(pct * 100) / 100 : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetDate = searchParams.get('date') ?? prevTradingDay(new Date().toISOString().slice(0, 10));
  // backfill=1 labels all unlabeled dates up to (but not including) today
  const backfill  = searchParams.get('backfill') === '1';

  const sb = getServiceClient();

  // 1. Fetch unlabeled candidates — single date or all past unlabeled dates
  const today = new Date().toISOString().slice(0, 10);
  const baseQuery = sb
    .from('pbfb_uc_logger')
    .select('id, symbol, scan_date, uc_score, uc_elite, uc_strong, uc_goldmine')
    .is('hit_uc_next_day', null)
    .lt('scan_date', today);   // never label today — UC outcome not settled yet
  const { data: rows, error: rowErr } = backfill
    ? await baseQuery
    : await baseQuery.eq('scan_date', targetDate);

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ labeled: 0, date: backfill ? 'backfill' : targetDate });

  const symbols = rows.map((r: { symbol: string }) => r.symbol);

  // 2. Check pbfb_uc_events: any of these symbols have event_date = targetDate AND n_before = 1?
  //    → means they circuited on targetDate + 1 trading day
  const { data: ucEvents } = await sb
    .from('pbfb_uc_events')
    .select('symbol, classification')
    .eq('event_date', targetDate)
    .eq('n_before', 1)
    .in('symbol', symbols);

  const ucHitMap = new Map<string, string>();
  for (const e of (ucEvents ?? []) as { symbol: string; classification: string }[]) {
    ucHitMap.set(e.symbol, e.classification);
  }

  // 3. Fetch next-day price change from Yahoo Finance (batched, 3 concurrent)
  const priceMap = new Map<string, number | null>();
  const BATCH = 3;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(fetchYFChange));
    chunk.forEach((sym, j) => priceMap.set(sym, results[j]));
  }

  // 4. Build update payloads
  const updates = rows.map((row: { id: number; symbol: string }) => {
    const hitUC = ucHitMap.has(row.symbol);
    const chgPct = priceMap.get(row.symbol) ?? null;
    return {
      id: row.id,
      hit_uc_next_day: hitUC,
      next_day_chg_pct: chgPct,
      hit_5pct_3d: chgPct != null ? chgPct >= 5.0 : null,
      hit_10pct_5d: chgPct != null ? chgPct >= 10.0 : null,
      uc_classification: ucHitMap.get(row.symbol) ?? null,
      labeled_at: new Date().toISOString(),
    };
  });

  // 5. Batch-update in Supabase (update by id, 50 at a time)
  let updated = 0;
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    for (const u of chunk) {
      const { id, ...fields } = u;
      await sb.from('pbfb_uc_logger').update(fields).eq('id', id);
      updated++;
    }
  }

  const truePositives = updates.filter(u => u.hit_uc_next_day).length;
  const precision = updates.length > 0 ? (truePositives / updates.length * 100).toFixed(1) : '-';

  return NextResponse.json({
    labeled: updated,
    date: targetDate,
    true_positives: truePositives,
    false_positives: updates.length - truePositives,
    precision_pct: precision,
  });
}
