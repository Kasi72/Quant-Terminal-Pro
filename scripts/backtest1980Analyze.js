// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST ANALYSIS TOOL — reads backtest1980_results.json
// Run AFTER fullBacktest1980.js has completed.
//
//   node scripts/backtest1980Analyze.js
//
// Adds deeper cuts the main backtest doesn't produce:
//   · Top-10 / bottom-10 stocks per param set
//   · Sector / bucket hit rate (if CSV filenames encode sector)
//   · Month-of-year seasonality
//   · Walk-forward: rolling 6-month OOS windows
//   · P&L distribution histogram
//   · Correlation: does bigger signal score → better trade?
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'backtest1980_results.json');

if (!fs.existsSync(RESULTS_FILE)) {
  console.error(`❌  Results file not found: ${RESULTS_FILE}`);
  console.error('    Run fullBacktest1980.js first.\n');
  process.exit(1);
}

const { meta, trades: tradesByKey } = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

const PARAM_SET_LABELS = {
  optimized_deployable_20plus:    'Deployable',
  optimized_highprecision_15plus: 'HiPrec',
  optimized_elite_10plus:         'Elite',
  optimized_ultraselective_8plus: 'Ultra',
  sniper_95plus:                  'Sniper',
};

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function avg(arr)  { return arr.length > 0 ? arr.reduce((s,x)=>s+x,0)/arr.length : 0; }
function sep(char = '─', n = 80) { return char.repeat(n); }

console.log(sep('═'));
console.log('  BACKTEST DEEP-DIVE ANALYSIS');
console.log(sep('═'));
console.log(`  Source: ${RESULTS_FILE}`);
console.log(`  Stocks: ${meta.stockCount}  ·  Period: ${meta.dateFrom} → today`);
console.log(`  Stop: −${meta.stopPct}%  T1: +${meta.t1Pct}%  T2: +${meta.t2Pct}%  T3: +${meta.t3Pct}%  Time: day ${meta.maxHold}`);
console.log();

for (const [key, trades] of Object.entries(tradesByKey)) {
  if (!trades || trades.length === 0) continue;
  const label = PARAM_SET_LABELS[key] || key;

  console.log(sep('═'));
  console.log(`  ▶ ${label}  (n=${trades.length} trades)`);
  console.log(sep('─'));

  // ── Top / bottom stocks ──────────────────────────────────────────────────
  const bySym = {};
  for (const t of trades) {
    if (!bySym[t.sym]) bySym[t.sym] = [];
    bySym[t.sym].push(t);
  }
  const symStats = Object.entries(bySym).map(([sym, ts]) => ({
    sym,
    n:      ts.length,
    wr:     ts.filter(t=>t.pnl>0).length / ts.length * 100,
    avgPnl: avg(ts.map(t=>t.pnl)),
    total:  ts.reduce((s,t)=>s+t.pnl, 0),
  })).filter(s => s.n >= 3); // need at least 3 trades to be meaningful

  const top10 = [...symStats].sort((a,b)=>b.wr-a.wr).slice(0, 10);
  const bot10 = [...symStats].sort((a,b)=>a.wr-b.wr).slice(0, 10);

  console.log('  TOP 10 STOCKS (by win rate, min 3 trades):');
  console.log(`  ${'Symbol'.padEnd(14)} ${'n'.padStart(4)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(8)} ${'Total%'.padStart(8)}`);
  for (const s of top10) {
    console.log(`  ${s.sym.replace('.NS','').padEnd(14)} ${String(s.n).padStart(4)} ${s.wr.toFixed(1).padStart(6)} ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%'.padStart(8)} ${(s.total>=0?'+':'')+s.total.toFixed(1)+'%'.padStart(8)}`);
  }

  console.log();
  console.log('  BOTTOM 10 STOCKS (by win rate):');
  for (const s of bot10) {
    console.log(`  ${s.sym.replace('.NS','').padEnd(14)} ${String(s.n).padStart(4)} ${s.wr.toFixed(1).padStart(6)} ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%'.padStart(8)} ${(s.total>=0?'+':'')+s.total.toFixed(1)+'%'.padStart(8)}`);
  }

  // ── Month-of-year seasonality ─────────────────────────────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const byMonth = Array.from({length:12}, ()=>[]);
  for (const t of trades) {
    const m = parseInt((t.date||'').slice(5,7), 10) - 1;
    if (m >= 0 && m < 12) byMonth[m].push(t);
  }

  console.log();
  console.log('  SEASONALITY (month of entry):');
  console.log(`  ${'Month'.padEnd(6)} ${'n'.padStart(5)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(8)}`);
  for (let m = 0; m < 12; m++) {
    const ts = byMonth[m];
    if (ts.length === 0) continue;
    const wr  = ts.filter(t=>t.pnl>0).length/ts.length*100;
    const ap  = avg(ts.map(t=>t.pnl));
    const bar = '█'.repeat(Math.round(wr/5));
    console.log(`  ${MONTHS[m].padEnd(6)} ${String(ts.length).padStart(5)} ${wr.toFixed(1).padStart(6)} ${(ap>=0?'+':'')+ap.toFixed(2)+'%'.padStart(8)}  ${bar}`);
  }

  // ── Walk-forward: rolling 6-month windows ─────────────────────────────────
  // Sort trades by date, then compute WR in each non-overlapping 6-month window
  const sorted = [...trades].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const wfWindows = [];
  let wi = 0;
  while (wi < sorted.length) {
    const windowStart = (sorted[wi].date||'').slice(0,7); // YYYY-MM
    const [yr, mo] = windowStart.split('-').map(Number);
    const endMo = mo + 5 > 12 ? mo - 7 : mo + 5;
    const endYr = mo + 5 > 12 ? yr + 1 : yr;
    const endStr = `${endYr}-${String(endMo+1).padStart(2,'0')}`;
    const window = sorted.filter(t => (t.date||'') >= windowStart && (t.date||'') < endStr);
    if (window.length >= 5) {
      wfWindows.push({
        period: `${windowStart}→${endStr}`,
        n:      window.length,
        wr:     window.filter(t=>t.pnl>0).length/window.length*100,
        avg:    avg(window.map(t=>t.pnl)),
      });
    }
    // Advance by 3 months (overlapping walk-forward)
    const nextMo = mo + 3 > 12 ? mo - 9 : mo + 3;
    const nextYr = mo + 3 > 12 ? yr + 1 : yr;
    const nextStr = `${nextYr}-${String(nextMo).padStart(2,'0')}`;
    const nextIdx = sorted.findIndex(t => (t.date||'') >= nextStr);
    if (nextIdx < 0 || nextIdx <= wi) break;
    wi = nextIdx;
  }

  console.log();
  console.log('  WALK-FORWARD (rolling 6-month windows, 3-month step):');
  console.log(`  ${'Period'.padEnd(20)} ${'n'.padStart(5)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(8)}`);
  for (const w of wfWindows) {
    const bar = w.wr >= 60 ? '✓' : w.wr >= 50 ? '~' : '✗';
    console.log(`  ${w.period.padEnd(20)} ${String(w.n).padStart(5)} ${w.wr.toFixed(1).padStart(6)} ${(w.avg>=0?'+':'')+w.avg.toFixed(2)+'%'.padStart(8)}  ${bar}`);
  }

  // ── P&L distribution histogram ────────────────────────────────────────────
  const buckets = [
    [-99, -10, '<−10%'],
    [-10, -5,  '−10 to −5%'],
    [-5,  0,   '−5 to 0%'],
    [0,   2.5, '0 to +2.5%'],
    [2.5, 5,   '+2.5 to +5%'],
    [5,   8.5, '+5 to +8.5%'],
    [8.5, 99,  '>+8.5%'],
  ];
  console.log();
  console.log('  P&L DISTRIBUTION:');
  for (const [lo, hi, lbl] of buckets) {
    const n   = trades.filter(t=>t.pnl>=lo && t.pnl<hi).length;
    const bar = '█'.repeat(Math.round(n / trades.length * 40));
    console.log(`  ${lbl.padEnd(16)} ${String(n).padStart(5)} (${pct(n,trades.length).padStart(5)}%)  ${bar}`);
  }

  // ── Exit type analysis ────────────────────────────────────────────────────
  const byExit = {};
  for (const t of trades) { byExit[t.exitType] = (byExit[t.exitType]||[]); byExit[t.exitType].push(t); }
  console.log();
  console.log('  EXIT TYPE BREAKDOWN:');
  console.log(`  ${'Exit type'.padEnd(20)} ${'n'.padStart(5)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(9)}`);
  for (const [et, ts] of Object.entries(byExit).sort((a,b)=>b[1].length-a[1].length)) {
    const wr  = ts.filter(t=>t.pnl>0).length/ts.length*100;
    const ap  = avg(ts.map(t=>t.pnl));
    console.log(`  ${et.padEnd(20)} ${String(ts.length).padStart(5)} ${wr.toFixed(1).padStart(6)} ${(ap>=0?'+':'')+ap.toFixed(2)+'%'.padStart(9)}`);
  }

  console.log();
}

console.log(sep('═'));
console.log('  ANALYSIS COMPLETE');
console.log(sep('═'));
