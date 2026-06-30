// ═══════════════════════════════════════════════════════════════════════════════
// GUPPY GMMA SPREAD BACKTEST — Hyper-tune for max win rate on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// Current implementation: 12 EMAs (short 3,5,8,10,12,15 + long 30,35,40,45,50,60)
// Spread = (max-min)/CMP×100. Compressed<1%, UltraCompressed<0.5% (UNVALIDATED).
// This backtest:
//   1. Computes full spread + short-group spread + long-group spread + bullish
//      alignment (short EMAs above long EMAs = trending up) for breakout candles
//   2. Bucket-tests each metric against forward returns
//   3. Grid searches for optimal compression thresholds + alignment combo
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)); a[i] = (a[i-1] * 13 + tr) / 14; }
  return a;
}
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; } return n > 0 ? s / n : 1;
}

// ─── Precompute full EMA series for all 12 Guppy periods (fast, O(n) per period) ───
function computeEMASeries(c, period) {
  const ema = new Array(c.length).fill(0);
  const k = 2 / (period + 1);
  let seeded = false, sum = 0;
  for (let i = 0; i < c.length; i++) {
    if (i < period - 1) { sum += c[i].c; continue; }
    if (!seeded) { sum += c[i].c; ema[i] = sum / period; seeded = true; continue; }
    ema[i] = c[i].c * k + ema[i - 1] * (1 - k);
  }
  // Backfill the warmup region with the first valid value to avoid 0s
  let firstValid = 0;
  for (let i = 0; i < ema.length; i++) { if (ema[i] !== 0) { firstValid = ema[i]; break; } }
  for (let i = 0; i < ema.length; i++) { if (ema[i] === 0) ema[i] = firstValid || c[i].c; else break; }
  return ema;
}

const SHORT_PERIODS = [3, 5, 8, 10, 12, 15];
const LONG_PERIODS = [30, 35, 40, 45, 50, 60];

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  GUPPY GMMA SPREAD BACKTEST — Hyper-tune on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  const atr = computeATR14(c);
  const emas = {};
  for (const p of [...SHORT_PERIODS, ...LONG_PERIODS]) emas[p] = computeEMASeries(c, p);
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr, emas });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Build dataset — breakout-context candles with Guppy metrics
// ═══════════════════════════════════════════════════════════════════════════════
function volAtrPctl(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) { if (c[j].c > 0 && atr[j] / c[j].c * 100 < cur) below++; }
  return below / 120 * 100;
}

const points = [];
for (const { sym, c, atr, emas } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const s = c[i];
    if (s.c <= 0 || atr[i] <= 0) continue;
    const rng = s.h - s.l;
    if (rng <= 0) continue;

    // Breakout context: close above prior 20-bar high + decent volume
    let prior20High = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0 && c[j].h > prior20High) prior20High = c[j].h; }
    if (s.c <= prior20High * 1.001) continue;
    const v20 = volAvg(c, i, 20);
    const evr20 = v20 > 0 ? s.v / v20 : 0;
    if (evr20 < 1.0) continue;

    // Guppy metrics at this candle
    const shortVals = SHORT_PERIODS.map(p => emas[p][i]);
    const longVals = LONG_PERIODS.map(p => emas[p][i]);
    const allVals = [...shortVals, ...longVals];
    const maxAll = Math.max(...allVals), minAll = Math.min(...allVals);
    const fullSpreadPct = s.c > 0 ? (maxAll - minAll) / s.c * 100 : 99;

    const maxShort = Math.max(...shortVals), minShort = Math.min(...shortVals);
    const shortSpreadPct = s.c > 0 ? (maxShort - minShort) / s.c * 100 : 99;

    const maxLong = Math.max(...longVals), minLong = Math.min(...longVals);
    const longSpreadPct = s.c > 0 ? (maxLong - minLong) / s.c * 100 : 99;

    const avgShort = shortVals.reduce((a, b) => a + b, 0) / shortVals.length;
    const avgLong = longVals.reduce((a, b) => a + b, 0) / longVals.length;
    const groupGapPct = avgLong > 0 ? (avgShort - avgLong) / avgLong * 100 : 0; // bullish alignment strength

    // Is short group ENTIRELY above long group (clean bullish GMMA fan)?
    const cleanBullishFan = minShort > maxLong;

    // Compression DURATION: how many of the last 10 days had spread < threshold?
    let compressDays5 = 0, compressDays10 = 0;
    for (let j = Math.max(0, i - 10); j < i; j++) {
      const sv = SHORT_PERIODS.map(p => emas[p][j]);
      const lv = LONG_PERIODS.map(p => emas[p][j]);
      const av = [...sv, ...lv];
      const sp = c[j].c > 0 ? (Math.max(...av) - Math.min(...av)) / c[j].c * 100 : 99;
      if (sp < 2.0) { compressDays10++; if (j >= i - 5) compressDays5++; }
    }

    // Forward outcomes
    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5, c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10, c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[Math.min(i+20, c.length-1)].c - s.c) / s.c * 100;
    const win = fwd20 > 0;

    points.push({
      sym, idx: i, fwd5, fwd10, fwd20, maxH, win,
      fullSpreadPct, shortSpreadPct, longSpreadPct, groupGapPct, cleanBullishFan,
      compressDays5, compressDays10, atrPctl: volAtrPctl(c, atr, i),
    });
  }
}
console.log(`Total breakout-context candles: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }
function pearsonR(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx*dy) : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Bucket analysis — current full spread metric
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: FULL SPREAD (current implementation) Bucket Analysis            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function bucketReport(label, fn, buckets) {
  console.log(`── ${label} ──`);
  console.log('  Bucket          │ Count  │ WR%    │ Avg5d% │ Avg10d%│ Avg20d%│ AvgMFE%│ >5%Rate');
  console.log('  ────────────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────');
  for (const [lo, hi, bl] of buckets) {
    const bucket = points.filter(p => { const v = fn(p); return v != null && v >= lo && v < hi; });
    if (bucket.length < 20) continue;
    const wr = pct(bucket, p => p.win);
    const a5 = avg(bucket.map(p => p.fwd5)), a10 = avg(bucket.map(p => p.fwd10)), a20 = avg(bucket.map(p => p.fwd20));
    const aMFE = avg(bucket.map(p => p.maxH));
    const gt5 = pct(bucket, p => p.fwd20 > 5);
    console.log(`  ${bl.padEnd(16)}│ ${String(bucket.length).padStart(6)} │ ${wr.toFixed(1).padStart(6)}│ ${(a5>=0?'+':'')+a5.toFixed(2).padStart(5)}%│ ${(a10>=0?'+':'')+a10.toFixed(2).padStart(5)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${gt5.toFixed(1).padStart(6)}%`);
  }
  console.log('');
}

bucketReport('Full Spread % (current Guppy metric — lower=more compressed)', p => p.fullSpreadPct, [
  [0, 0.5, '<0.5% (ultra)'], [0.5, 1.0, '0.5-1% (compr)'], [1.0, 1.5, '1-1.5%'], [1.5, 2.0, '1.5-2%'],
  [2.0, 3.0, '2-3%'], [3.0, 5.0, '3-5%'], [5.0, 8.0, '5-8%'], [8.0, 999, '>8%'],
]);

bucketReport('Short-Group Spread % (just the 6 fast EMAs)', p => p.shortSpreadPct, [
  [0, 0.3, '<0.3%'], [0.3, 0.6, '0.3-0.6%'], [0.6, 1.0, '0.6-1%'], [1.0, 1.5, '1-1.5%'],
  [1.5, 2.5, '1.5-2.5%'], [2.5, 999, '>2.5%'],
]);

bucketReport('Long-Group Spread % (just the 6 slow EMAs)', p => p.longSpreadPct, [
  [0, 1.0, '<1%'], [1.0, 2.0, '1-2%'], [2.0, 3.0, '2-3%'], [3.0, 5.0, '3-5%'],
  [5.0, 8.0, '5-8%'], [8.0, 999, '>8%'],
]);

bucketReport('Group Gap % (short EMAs avg vs long EMAs avg — bullish alignment strength)', p => p.groupGapPct, [
  [-999, -2, '<-2% (bearish)'], [-2, 0, '-2-0%'], [0, 1, '0-1%'], [1, 2, '1-2%'],
  [2, 4, '2-4%'], [4, 8, '4-8%'], [8, 999, '>8% (extended)'],
]);

bucketReport('Compression Days (last 10, spread<2%)', p => p.compressDays10, [
  [0, 1, '0 days'], [1, 3, '1-2 days'], [3, 5, '3-4 days'], [5, 8, '5-7 days'], [8, 11, '8-10 days'],
]);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Clean Bullish Fan (short entirely above long) test
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: Clean Bullish Fan Test (all short EMAs > all long EMAs)         ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const fanYes = points.filter(p => p.cleanBullishFan);
const fanNo = points.filter(p => !p.cleanBullishFan);
console.log(`  Clean Fan = YES: n=${fanYes.length} | WR=${pct(fanYes,p=>p.win).toFixed(1)}% | Avg20d=${avg(fanYes.map(p=>p.fwd20)).toFixed(2)}% | MFE=${avg(fanYes.map(p=>p.maxH)).toFixed(1)}%`);
console.log(`  Clean Fan = NO:  n=${fanNo.length} | WR=${pct(fanNo,p=>p.win).toFixed(1)}% | Avg20d=${avg(fanNo.map(p=>p.fwd20)).toFixed(2)}% | MFE=${avg(fanNo.map(p=>p.maxH)).toFixed(1)}%\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Correlation summary
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Correlation vs Forward 20d Return                               ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const fwd20Arr = points.map(p => p.fwd20);
const feats = [
  ['fullSpreadPct', p => p.fullSpreadPct], ['shortSpreadPct', p => p.shortSpreadPct],
  ['longSpreadPct', p => p.longSpreadPct], ['groupGapPct', p => p.groupGapPct],
  ['compressDays10', p => p.compressDays10], ['atrPctl', p => p.atrPctl],
];
const corrs = feats.map(([name, fn]) => ({ name, r: pearsonR(points.map(fn), fwd20Arr) }));
corrs.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of corrs) {
  const strength = Math.abs(c.r) > 0.05 ? '★★★' : Math.abs(c.r) > 0.03 ? '★★' : Math.abs(c.r) > 0.015 ? '★' : '';
  console.log(`  ${c.name.padEnd(20)}│ r = ${(c.r>=0?'+':'')+c.r.toFixed(4)}  ${strength}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: GRID SEARCH — Optimal combined Guppy filter for max win rate
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5: Grid Search — Optimal Guppy Compression + Alignment Filter      ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const spreadVals = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 999];
const gapVals = [-999, 0, 1, 2, 4];
const compressDaysVals = [0, 1, 3, 5, 8];
const fanVals = [false, true];

let combos = [];
for (const sp of spreadVals) {
  for (const gap of gapVals) {
    for (const cd of compressDaysVals) {
      for (const fan of fanVals) {
        const filtered = points.filter(p => p.fullSpreadPct <= sp && p.groupGapPct >= gap && p.compressDays10 >= cd && (!fan || p.cleanBullishFan));
        if (filtered.length < 30) continue;
        const wr = pct(filtered, p => p.win);
        const a20 = avg(filtered.map(p => p.fwd20));
        const aMFE = avg(filtered.map(p => p.maxH));
        const gt5 = pct(filtered, p => p.fwd20 > 5);
        combos.push({ sp, gap, cd, fan, n: filtered.length, wr, a20, aMFE, gt5 });
      }
    }
  }
}
combos.sort((a,b) => b.wr - a.wr);
console.log(`Tested ${combos.length} combos (min 30 signals)\n`);
console.log('Top 15 by WIN RATE:');
console.log('  Spread≤│Gap≥ │CDays≥│Fan│ Count │ WR%    │ Avg20d% │ AvgMFE% │ >5%Rate');
console.log('  ───────┼─────┼──────┼───┼───────┼────────┼─────────┼─────────┼────────');
for (let i = 0; i < Math.min(15, combos.length); i++) {
  const c = combos[i];
  console.log(`  ${(c.sp>=999?'  ∞ ':c.sp.toFixed(1).padStart(5))}  │${String(c.gap===-999?'any':c.gap).padStart(4)} │${String(c.cd).padStart(5)} │${c.fan?'Y':'N'}  │ ${String(c.n).padStart(5)} │ ${c.wr.toFixed(1).padStart(6)}│ ${(c.a20>=0?'+':'')+c.a20.toFixed(2).padStart(6)}% │ ${('+'+c.aMFE.toFixed(1)).padStart(6)}% │ ${c.gt5.toFixed(1).padStart(6)}%`);
}

const balanced = combos.filter(c => c.n >= 80).sort((a,b) => b.wr - a.wr);
console.log('\nTop 10 BALANCED (≥80 signals):');
console.log('  Spread≤│Gap≥ │CDays≥│Fan│ Count │ WR%    │ Avg20d% │ AvgMFE% │ >5%Rate');
console.log('  ───────┼─────┼──────┼───┼───────┼────────┼─────────┼─────────┼────────');
for (let i = 0; i < Math.min(10, balanced.length); i++) {
  const c = balanced[i];
  console.log(`  ${(c.sp>=999?'  ∞ ':c.sp.toFixed(1).padStart(5))}  │${String(c.gap===-999?'any':c.gap).padStart(4)} │${String(c.cd).padStart(5)} │${c.fan?'Y':'N'}  │ ${String(c.n).padStart(5)} │ ${c.wr.toFixed(1).padStart(6)}│ ${(c.a20>=0?'+':'')+c.a20.toFixed(2).padStart(6)}% │ ${('+'+c.aMFE.toFixed(1)).padStart(6)}% │ ${c.gt5.toFixed(1).padStart(6)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Baseline comparison + tier proposal
// ═══════════════════════════════════════════════════════════════════════════════
const baseline = { wr: pct(points, p=>p.win), a20: avg(points.map(p=>p.fwd20)) };
console.log(`\nBASELINE (all breakout candles, no Guppy filter): WR ${baseline.wr.toFixed(1)}%, Avg20d ${baseline.a20.toFixed(2)}%`);
if (balanced.length > 0) {
  const best = balanced[0];
  console.log(`BEST BALANCED EDGE: +${(best.wr - baseline.wr).toFixed(1)}pp WR, +${(best.a20 - baseline.a20).toFixed(2)}pp avg20d vs baseline`);
}

// Re-derive new compressed/ultraCompressed thresholds from spread bucket data
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PROPOSED NEW THRESHOLDS                                                  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
if (combos.length > 0) {
  const top = combos[0];
  console.log(`  Optimal single combo: FullSpread≤${top.sp}%, GroupGap≥${top.gap===-999?'any':top.gap+'%'}, CompressDays≥${top.cd}, CleanFan=${top.fan}`);
  console.log(`  → ${top.wr.toFixed(1)}% WR on ${top.n} signals`);
}
if (balanced.length > 0) {
  const topBal = balanced[0];
  console.log(`  Balanced (≥80 sig) combo: FullSpread≤${topBal.sp}%, GroupGap≥${topBal.gap===-999?'any':topBal.gap+'%'}, CompressDays≥${topBal.cd}, CleanFan=${topBal.fan}`);
  console.log(`  → ${topBal.wr.toFixed(1)}% WR on ${topBal.n} signals`);
}

console.log('\n═══ GUPPY GMMA BACKTEST COMPLETE ═══');
