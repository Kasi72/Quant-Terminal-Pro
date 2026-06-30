// ═══════════════════════════════════════════════════════════════════════════════
// ATR-14 % OF PRICE — Ultra-Deep Backtest & Re-Stratification on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// Current column just shows raw ATR% with UNVALIDATED intuitive color tiers
// (orange>=5%, amber>=4%, cyan 2-4%, grey<2%). This backtests ATR% against
// forward returns on breakout-context candles, finds the true win-rate-optimal
// stratification at fine granularity, and grid searches combined filters.
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

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  ATR-14 % OF PRICE — Ultra-Deep Backtest & Re-Stratification on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Build dataset on breakout-context candles (consistent with prior
// backtests — close above prior 20-bar high + volume confirmation)
// ═══════════════════════════════════════════════════════════════════════════════
const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 150; i < c.length - 21; i++) {
    const s = c[i], rng = s.h - s.l;
    if (s.c <= 0 || atr[i] <= 0 || rng <= 0) continue;

    // Split-guard
    let hasSplit = false;
    for (let j = i; j < Math.min(i + 21, c.length - 1); j++) {
      if (c[j].c <= 0) continue;
      const ratio = c[j+1].c / c[j].c;
      if (ratio > 2.5 || ratio < 0.4) { hasSplit = true; break; }
    }
    if (hasSplit) continue;

    let prior20High = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0 && c[j].h > prior20High) prior20High = c[j].h; }
    if (s.c <= prior20High * 1.001) continue;

    const v20 = volAvg(c, i, 20);
    const evr20 = v20 > 0 ? s.v / v20 : 0;
    if (evr20 < 1.0) continue;

    const atrPct = atr[i] / s.c * 100;

    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5,c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10,c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[i+20].c - s.c) / s.c * 100;
    const win = fwd20 > 0;
    const isMonster = maxH >= 10;

    // MAE (worst drawdown in 20d) for risk-adjusted analysis
    let maxL = 0;
    for (let j = i + 1; j <= i + 20; j++) { const lPct = (c[j].l - s.c) / s.c * 100; if (lPct < maxL) maxL = lPct; }

    points.push({ sym, idx: i, atrPct, fwd5, fwd10, fwd20, maxH, win, isMonster, maxL });
    i += 2;
  }
}
console.log(`Total breakout-context candles: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length/arr.length*100 : 0; }
function pearsonR(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num=0,dx=0,dy=0;
  for (let i=0;i<xs.length;i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx>0&&dy>0 ? num/Math.sqrt(dx*dy) : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Coarse bucket pass — get the lay of the land
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: Coarse Bucket Analysis (1% steps)                                ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const coarseBuckets = [];
for (let lo = 0; lo < 12; lo++) coarseBuckets.push([lo, lo+1, `${lo}-${lo+1}%`]);
coarseBuckets.push([12, 999, '>12%']);

console.log('  ATR%      │ Count  │ WR%    │ Avg5d% │ Avg10d%│ Avg20d%│ AvgMFE%│ AvgMAE%│ >5%Rate│ Monster%');
console.log('  ──────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┼─────────');
for (const [lo, hi, label] of coarseBuckets) {
  const bucket = points.filter(p => p.atrPct >= lo && p.atrPct < hi);
  if (bucket.length < 30) continue;
  const wr = pct(bucket, p => p.win);
  const a5 = avg(bucket.map(p=>p.fwd5)), a10 = avg(bucket.map(p=>p.fwd10)), a20 = avg(bucket.map(p=>p.fwd20));
  const aMFE = avg(bucket.map(p=>p.maxH)), aMAE = avg(bucket.map(p=>p.maxL));
  const gt5 = pct(bucket, p=>p.fwd20>5);
  const monRate = pct(bucket, p=>p.isMonster);
  console.log(`  ${label.padEnd(10)}│ ${String(bucket.length).padStart(6)} │ ${wr.toFixed(1).padStart(6)}│ ${(a5>=0?'+':'')+a5.toFixed(2).padStart(5)}%│ ${(a10>=0?'+':'')+a10.toFixed(2).padStart(5)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${aMAE.toFixed(1).padStart(6)}%│ ${gt5.toFixed(1).padStart(6)}%│ ${monRate.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Correlation check
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: Correlation — ATR% vs Forward Outcomes                          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const atrArr = points.map(p=>p.atrPct);
console.log(`  ATR% vs Fwd5d:   r = ${pearsonR(atrArr, points.map(p=>p.fwd5)).toFixed(4)}`);
console.log(`  ATR% vs Fwd10d:  r = ${pearsonR(atrArr, points.map(p=>p.fwd10)).toFixed(4)}`);
console.log(`  ATR% vs Fwd20d:  r = ${pearsonR(atrArr, points.map(p=>p.fwd20)).toFixed(4)}`);
console.log(`  ATR% vs MaxMFE:  r = ${pearsonR(atrArr, points.map(p=>p.maxH)).toFixed(4)}`);
console.log(`  ATR% vs MaxMAE:  r = ${pearsonR(atrArr, points.map(p=>p.maxL)).toFixed(4)}`);
console.log(`  ATR% vs Win(0/1):r = ${pearsonR(atrArr, points.map(p=>p.win?1:0)).toFixed(4)}`);
console.log(`  ATR% vs Monster: r = ${pearsonR(atrArr, points.map(p=>p.isMonster?1:0)).toFixed(4)}`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: FINE-GRAINED 0.25% step scan — find true breakpoints by win rate
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Fine-Grained Scan (0.25% steps) — locate true WR breakpoints     ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const fineBuckets = [];
for (let lo = 0; lo < 10; lo += 0.25) fineBuckets.push([lo, lo+0.25, `${lo.toFixed(2)}-${(lo+0.25).toFixed(2)}%`]);
fineBuckets.push([10, 999, '>10%']);

console.log('  ATR%        │ Count  │ WR%    │ Avg20d%│ AvgMFE%│ Monster%');
console.log('  ────────────┼────────┼────────┼────────┼────────┼─────────');
const fineResults = [];
for (const [lo, hi, label] of fineBuckets) {
  const bucket = points.filter(p => p.atrPct >= lo && p.atrPct < hi);
  if (bucket.length < 30) continue;
  const wr = pct(bucket, p => p.win);
  const a20 = avg(bucket.map(p=>p.fwd20));
  const aMFE = avg(bucket.map(p=>p.maxH));
  const monRate = pct(bucket, p=>p.isMonster);
  fineResults.push({ lo, hi, label, n: bucket.length, wr, a20, aMFE, monRate });
  console.log(`  ${label.padEnd(12)}│ ${String(bucket.length).padStart(6)} │ ${wr.toFixed(1).padStart(6)}│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${monRate.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Grid search — best cumulative threshold (>= X%) for max WR, with N≥200
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5: Cumulative Threshold Search — best ATR%≥X for max win rate       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const cumResults = [];
for (let x = 0; x <= 10; x += 0.25) {
  const above = points.filter(p => p.atrPct >= x);
  if (above.length < 200) continue;
  const wr = pct(above, p=>p.win);
  const a20 = avg(above.map(p=>p.fwd20));
  const monRate = pct(above, p=>p.isMonster);
  cumResults.push({ x, n: above.length, wr, a20, monRate });
}
cumResults.sort((a,b)=>b.wr-a.wr);
console.log('Top 15 thresholds (ATR%≥X) by WR, min N=200:');
console.log('  ATR%≥  │ Count  │ WR%    │ Avg20d%│ Monster%');
console.log('  ───────┼────────┼────────┼────────┼─────────');
for (let i=0;i<Math.min(15,cumResults.length);i++) {
  const r = cumResults[i];
  console.log(`  ${r.x.toFixed(2).padStart(5)}% │ ${String(r.n).padStart(6)} │ ${r.wr.toFixed(1).padStart(6)}│ ${(r.a20>=0?'+':'')+r.a20.toFixed(2).padStart(5)}%│ ${r.monRate.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Build optimal N-tier stratification (test 4, 5, 6 tiers)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 6: Optimal Tier Construction                                        ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Use percentile-based cuts on the sorted ATR% distribution to ensure roughly
// equal-sized validated tiers, then report actual WR per tier
const sortedAtr = [...points].sort((a,b) => a.atrPct - b.atrPct);
const N = sortedAtr.length;

function tierReport(nTiers) {
  console.log(`\n── ${nTiers}-Tier Stratification (percentile-based) ──`);
  console.log('  Tier │ ATR% Range      │ Count  │ WR%    │ Avg20d%│ AvgMFE%│ Monster%');
  console.log('  ─────┼─────────────────┼────────┼────────┼────────┼────────┼─────────');
  for (let t = 0; t < nTiers; t++) {
    const lo = Math.floor(N * t / nTiers), hi = Math.floor(N * (t+1) / nTiers);
    const bucket = sortedAtr.slice(lo, hi);
    if (bucket.length === 0) continue;
    const atrLo = bucket[0].atrPct, atrHi = bucket[bucket.length-1].atrPct;
    const wr = pct(bucket, p=>p.win);
    const a20 = avg(bucket.map(p=>p.fwd20));
    const aMFE = avg(bucket.map(p=>p.maxH));
    const monRate = pct(bucket, p=>p.isMonster);
    console.log(`  T${t+1}   │ [${atrLo.toFixed(2)},${atrHi.toFixed(2)}]%`.padEnd(19) + `│ ${String(bucket.length).padStart(6)} │ ${wr.toFixed(1).padStart(6)}│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${monRate.toFixed(1).padStart(7)}%`);
  }
}
tierReport(4);
tierReport(5);
tierReport(6);
tierReport(8);

console.log('\n═══ ATR% BACKTEST COMPLETE ═══');
