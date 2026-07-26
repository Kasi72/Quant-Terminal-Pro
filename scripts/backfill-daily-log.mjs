// One-time backfill: populates trade_daily_log for ALL tracked trades (open + closed)
// Run: node scripts/backfill-daily-log.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Load env from .env.local
const envPath = resolve(__dir, '..', '.env.local');
const envVars = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SUPABASE_URL  = 'https://cmkfqlppbwyrhjmooqbq.supabase.co';
const SUPABASE_KEY  = envVars.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID       = 'drkkr';
const YF_HOSTS      = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YF_HEADERS    = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local'); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchYahoo(sym) {
  for (const host of YF_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&includePrePost=false`;
      const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      return await r.json();
    } catch {}
  }
  return null;
}

function parseCandles(json) {
  const r0 = json?.chart?.result?.[0];
  if (!r0) return [];
  const ts = r0.timestamp;
  const q  = r0.indicators?.quote?.[0];
  if (!ts || !q) return [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (!o || !h || !l || !c || !isFinite(c) || c <= 0 || h < l || h <= 0) continue;
    const date = new Date((ts[i] + 19800) * 1000).toISOString().slice(0, 10);
    bars.push({ date, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2) });
  }
  return bars;
}

function eventDetail(status, pnl, target1, target2, target3, closedPrice) {
  const p = pnl != null ? ` → ${parseFloat(pnl).toFixed(1)}%` : '';
  if (status === 'stopped')  return `Stop hit ₹${parseFloat(closedPrice || 0).toFixed(2)}${p}`;
  if (status === 'hit_t1')   return `T1 ₹${parseFloat(target1 || 0).toFixed(2)} hit${p}`;
  if (status === 'hit_t2')   return `T2 ₹${parseFloat(target2 || 0).toFixed(2)} hit${p}`;
  if (status === 'hit_t3')   return `T3 ₹${parseFloat(target3 || 0).toFixed(2)} hit${p}`;
  if (status === 'expired')  return `Expired ₹${parseFloat(closedPrice || 0).toFixed(2)}${p}`;
  return '';
}

async function main() {
  console.log('Loading all tracked trades…');
  const { data: rows, error } = await db.from('tracked_trades').select('*').eq('user_id', USER_ID);
  if (error) { console.error('Load error:', error.message); process.exit(1); }
  console.log(`  ${rows.length} trades found\n`);

  let totalInserted = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const sym        = row.symbol;
    const entryDate  = row.entry_date?.slice(0, 10);
    const entryPrice = parseFloat(row.entry_price ?? 0);
    const closedDate = row.exit_date ? row.exit_date.slice(0, 10) : null;

    if (!entryDate || entryPrice <= 0) { console.log(`  ${sym}: missing entry — skip`); skipped++; continue; }

    // Check for existing rows
    const { count } = await db.from('trade_daily_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', USER_ID).eq('symbol', sym);
    if (count > 0) { console.log(`  ${sym}: ${count} rows exist — skip`); skipped++; continue; }

    process.stdout.write(`  ${sym} (${row.status}) … `);
    const json = await fetchYahoo(sym);
    if (!json) { console.log('FETCH FAILED'); failed++; continue; }

    const allBars   = parseCandles(json);
    const postEntry = allBars.filter(b => b.date > entryDate);
    const relevant  = closedDate ? postEntry.filter(b => b.date <= closedDate) : postEntry;

    if (relevant.length === 0) { console.log('no bars after entry — skip'); skipped++; continue; }

    let cumMfe = 0, cumMae = 0;
    const logRows = [];

    for (let d = 0; d < relevant.length; d++) {
      const bar    = relevant[d];
      const barMfe = ((bar.high - entryPrice) / entryPrice) * 100;
      const barMae = ((entryPrice - bar.low) / entryPrice) * 100;
      if (barMfe > cumMfe) cumMfe = barMfe;
      if (barMae > cumMae) cumMae = barMae;

      const isTerminal = !!closedDate && bar.date === closedDate;
      logRows.push({
        user_id:      USER_ID,
        symbol:       sym,
        date:         bar.date,
        open:         bar.open,
        high:         bar.high,
        low:          bar.low,
        close:        bar.close,
        day_num:      d + 1,
        mfe_pct:      +cumMfe.toFixed(2),
        mae_pct:      +cumMae.toFixed(2),
        event_type:   isTerminal ? row.status : null,
        event_detail: isTerminal ? eventDetail(row.status, row.pnl_pct, row.target1, row.target2, row.target3, row.exit_price) : null,
      });
      if (isTerminal) break; // closed trades stop at terminal bar
    }

    const { error: upsertErr } = await db.from('trade_daily_log')
      .upsert(logRows, { onConflict: 'user_id,symbol,date' });

    if (upsertErr) {
      console.log(`ERROR — ${upsertErr.message}`);
      failed++;
    } else {
      console.log(`✓ ${logRows.length} rows`);
      totalInserted += logRows.length;
    }

    await new Promise(r => setTimeout(r, 350)); // rate-limit Yahoo
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Inserted: ${totalInserted}  |  Skipped: ${skipped}  |  Failed: ${failed}`);
}

main().catch(console.error);
