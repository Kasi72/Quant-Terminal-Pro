// ═══════════════════════════════════════════════════════════════════════════════
// SQUEEZE SCORE BACKTEST — Scientific Calibration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Goal: Find the optimal Bollinger Band Width percentile, ATR percentile,
//       and Zone Tightness thresholds that maximize forward 20-day returns.
//
// Method:
//   1. Compute BB Width (20,2) and its 120-day percentile for every candle
//   2. Compute ATR Pctl 120 (already have this)
//   3. Compute Zone Tightness where a zone exists
//   4. Measure forward 5d, 10d, 20d returns from each candle
//   5. Grid search: which combo of BB Width Pctl + ATR Pctl + Zone Tightness
//      produces the best forward returns?
//   6. Then: optimal weighting for the Squeeze Score composite
//
// This runs on ALL 76+ OHLCV stocks — no cherry-picking.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');

const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

// ─── Parsers ───
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 11 || isNaN(+p[8]) || +p[8] <= 0) continue;
    c.push({ o: +p[4], h: +p[5], l: +p[6], c: +p[8], v: +p[10] || 0 });
  }
  return c;
}

// ─── ATR-14 EMA ───
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
    a[i] = (a[i-1] * 13 + tr) / 14;
  }
  return a;
}

// ─── Bollinger Band Width (20, 2) ───
function computeBBWidth(c) {
  const bbw = new Array(c.length).fill(0);
  for (let i = 19; i < c.length; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += c[j].c;
    const sma = sum / 20;
    let sqSum = 0;
    for (let j = i - 19; j <= i; j++) sqSum += (c[j].c - sma) ** 2;
    const std = Math.sqrt(sqSum / 20);
    bbw[i] = sma > 0 ? (4 * std) / sma * 100 : 0; // (upper - lower) / middle as %
  }
  return bbw;
}

// ─── Percentile rank over lookback ───
function percentileRank(arr, idx, lookback) {
  if (idx < lookback) return 50;
  const cur = arr[idx];
  let below = 0;
  for (let j = idx - lookback; j < idx; j++) {
    if (arr[j] < cur) below++;
  }
  return below / lookback * 100;
}

// ─── ATR Pctl ───
function atrPctl(c, atr, idx, lookback) {
  if (idx < lookback) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - lookback; j < idx; j++) {
    const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0;
    if (v < cur) below++;
  }
  return below / lookback * 100;
}

// ─── Simple Zone Tightness (looking back up to 25 bars) ───
function zoneTightness(c, atr, idx) {
  const zoneCandles = [];
  for (let j = idx - 1; j >= Math.max(0, idx - 25); j--) {
    if (atr[j] <= 0) break;
    if ((c[j].h - c[j].l) / atr[j] > 1.0) break;
    zoneCandles.unshift(j);
  }
  if (zoneCandles.length < 3) return { zt: 999, zLen: 0 };
  let zH = -Infinity, zL = Infinity;
  for (const j of zoneCandles) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  return { zt: zL > 0 ? (zH - zL) / zL * 100 : 999, zLen: zoneCandles.length };
}

// ─── Volume compression (vol ratio < 1 = quiet) ───
function volCompression(c, idx) {
  if (idx < 20) return 1;
  let v20 = 0;
  for (let j = idx - 20; j < idx; j++) v20 += c[j].v;
  v20 /= 20;
  if (v20 <= 0) return 1;
  // Avg vol ratio of last 5 bars
  let v5r = 0;
  for (let j = idx - 5; j < idx; j++) v5r += c[j].v / v20;
  return v5r / 5;
}

// ─── LOAD DATA ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  SQUEEZE SCORE BACKTEST — Scientific Parameter Calibration');
console.log('  BB Width Pctl + ATR Pctl + Zone Tightness + Volume Compression');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS') || f.includes('_all')) continue;
    const c = format === 'nse' ? parseNSE(path.join(dir, f)) : parseYahoo(path.join(dir, f));
    if (c.length < 200) continue;
    stockData.push({ sym: f.replace('_NS_OHLCV.csv', '').replace('.csv', ''), c, atr: computeATR14(c), bbw: computeBBWidth(c) });
  }
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Individual Factor Analysis
// For each factor independently, bucket by percentile and measure forward returns
// ═══════════════════════════════════════════════════════════════════════════════

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 1: Individual Factor Power — Which matters most?                  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Collect all data points
const allPoints = [];
for (const { sym, c, atr, bbw } of stockData) {
  for (let i = 140; i < c.length - 21; i++) {
    if (atr[i] <= 0 || c[i].c <= 0 || bbw[i] <= 0) continue;

    const bbwPctl = percentileRank(bbw, i, 120);
    const atrP = atrPctl(c, atr, i, 120);
    const { zt, zLen } = zoneTightness(c, atr, i);
    const volComp = volCompression(c, i);

    // Forward returns
    const fwd5 = (c[Math.min(i + 5, c.length - 1)].c - c[i].c) / c[i].c * 100;
    const fwd10 = (c[Math.min(i + 10, c.length - 1)].c - c[i].c) / c[i].c * 100;
    const fwd20 = (c[Math.min(i + 20, c.length - 1)].c - c[i].c) / c[i].c * 100;

    // Max forward high (MFE proxy)
    let maxH = 0;
    for (let j = i + 1; j <= Math.min(i + 20, c.length - 1); j++) {
      const hPct = (c[j].h - c[i].c) / c[i].c * 100;
      if (hPct > maxH) maxH = hPct;
    }

    allPoints.push({ sym, idx: i, bbwPctl, atrP, zt, zLen, volComp, fwd5, fwd10, fwd20, maxH });
  }
}
console.log(`Total data points: ${allPoints.length.toLocaleString()}\n`);

// ─── Factor 1: BB Width Percentile buckets ───
console.log('── BB Width Percentile (lower = more compressed) ──');
console.log('  Bucket        │ Count    │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% in 20d');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────');
const bbBuckets = [[0,5,'BBW 0-5'],[5,10,'BBW 5-10'],[10,15,'BBW 10-15'],[15,20,'BBW 15-20'],[20,30,'BBW 20-30'],[30,50,'BBW 30-50'],[50,100,'BBW 50-100']];
for (const [lo, hi, label] of bbBuckets) {
  const pts = allPoints.filter(p => p.bbwPctl >= lo && p.bbwPctl < hi);
  if (pts.length < 10) continue;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(5)}%`);
}

// ─── Factor 2: ATR Percentile buckets ───
console.log('\n── ATR Percentile (lower = more compressed volatility) ──');
console.log('  Bucket        │ Count    │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% in 20d');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────');
const atrBuckets = [[0,5,'ATR 0-5'],[5,10,'ATR 5-10'],[10,15,'ATR 10-15'],[15,20,'ATR 15-20'],[20,30,'ATR 20-30'],[30,50,'ATR 30-50'],[50,100,'ATR 50-100']];
for (const [lo, hi, label] of atrBuckets) {
  const pts = allPoints.filter(p => p.atrP >= lo && p.atrP < hi);
  if (pts.length < 10) continue;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(5)}%`);
}

// ─── Factor 3: Zone Tightness buckets ───
console.log('\n── Zone Tightness (lower = tighter consolidation) ──');
console.log('  Bucket        │ Count    │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% in 20d');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────');
const ztBuckets = [[0,2,'ZT 0-2%'],[2,4,'ZT 2-4%'],[4,6,'ZT 4-6%'],[6,8,'ZT 6-8%'],[8,10,'ZT 8-10%'],[10,15,'ZT 10-15%'],[15,999,'ZT >15%/none']];
for (const [lo, hi, label] of ztBuckets) {
  const pts = allPoints.filter(p => p.zt >= lo && p.zt < hi);
  if (pts.length < 10) continue;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(5)}%`);
}

// ─── Factor 4: Volume Compression buckets ───
console.log('\n── Volume Compression (pre-5 avg vol ratio — lower = quieter) ──');
console.log('  Bucket        │ Count    │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% in 20d');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────');
const volBuckets = [[0,0.3,'Vol <0.3x'],[0.3,0.5,'Vol 0.3-0.5'],[0.5,0.7,'Vol 0.5-0.7'],[0.7,0.9,'Vol 0.7-0.9'],[0.9,1.1,'Vol 0.9-1.1'],[1.1,2,'Vol 1.1-2x'],[2,999,'Vol >2x']];
for (const [lo, hi, label] of volBuckets) {
  const pts = allPoints.filter(p => p.volComp >= lo && p.volComp < hi);
  if (pts.length < 10) continue;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(5)}%`);
}

// ─── Factor 5: Zone Length buckets ───
console.log('\n── Zone Length (longer = more coiled energy) ──');
console.log('  Bucket        │ Count    │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% in 20d');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────');
const zlBuckets = [[0,3,'ZLen 0-2'],[3,5,'ZLen 3-4'],[5,8,'ZLen 5-7'],[8,12,'ZLen 8-11'],[12,16,'ZLen 12-15'],[16,25,'ZLen 16-25']];
for (const [lo, hi, label] of zlBuckets) {
  const pts = allPoints.filter(p => p.zLen >= lo && p.zLen < hi);
  if (pts.length < 10) continue;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(5)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Correlation Analysis — How independent are these factors?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 2: Factor Correlation (Pearson r)                                 ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function pearsonR(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

const bbwArr = allPoints.map(p => p.bbwPctl);
const atrArr = allPoints.map(p => p.atrP);
const ztArr = allPoints.filter(p => p.zt < 900).map(p => p.zt);
const ztPts = allPoints.filter(p => p.zt < 900);
const volArr = allPoints.map(p => p.volComp);
const fwd20Arr = allPoints.map(p => p.fwd20);

console.log(`  BBW Pctl  ↔  ATR Pctl:    r = ${pearsonR(bbwArr, atrArr).toFixed(3)}   (>0.7 = redundant)`);
console.log(`  BBW Pctl  ↔  Vol Comp:    r = ${pearsonR(bbwArr, volArr).toFixed(3)}`);
console.log(`  ATR Pctl  ↔  Vol Comp:    r = ${pearsonR(atrArr, volArr).toFixed(3)}`);
console.log(`  BBW Pctl  ↔  Fwd 20d:     r = ${pearsonR(bbwArr, fwd20Arr).toFixed(3)}   (predictive power)`);
console.log(`  ATR Pctl  ↔  Fwd 20d:     r = ${pearsonR(atrArr, fwd20Arr).toFixed(3)}`);
console.log(`  Vol Comp  ↔  Fwd 20d:     r = ${pearsonR(volArr, fwd20Arr).toFixed(3)}`);
if (ztPts.length > 100) {
  console.log(`  Zone Tight ↔ Fwd 20d:     r = ${pearsonR(ztPts.map(p => p.zt), ztPts.map(p => p.fwd20)).toFixed(3)}`);
  console.log(`  Zone Len   ↔ Fwd 20d:     r = ${pearsonR(ztPts.map(p => p.zLen), ztPts.map(p => p.fwd20)).toFixed(3)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Grid Search — Optimal Squeeze Thresholds
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 3: Grid Search — Best Squeeze Definition                          ║');
console.log('║  Testing all combos of BB Width Pctl + ATR Pctl + Zone Tightness          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const bbThresholds = [5, 10, 15, 20, 25, 30];
const atrThresholds = [10, 15, 20, 25, 30, 40, 50];
const ztThresholds = [3, 5, 7, 10, 15, 20];
const zlThresholds = [3, 5, 7, 10];

let results = [];

for (const bbTh of bbThresholds) {
  for (const atrTh of atrThresholds) {
    for (const ztTh of ztThresholds) {
      for (const zlTh of zlThresholds) {
        const squeezed = allPoints.filter(p => p.bbwPctl <= bbTh && p.atrP <= atrTh && p.zt <= ztTh && p.zLen >= zlTh);
        if (squeezed.length < 20) continue;

        const avgFwd20 = squeezed.reduce((s, p) => s + p.fwd20, 0) / squeezed.length;
        const avgMFE = squeezed.reduce((s, p) => s + p.maxH, 0) / squeezed.length;
        const gt5Rate = squeezed.filter(p => p.fwd20 > 5).length / squeezed.length * 100;
        const posRate = squeezed.filter(p => p.fwd20 > 0).length / squeezed.length * 100;

        results.push({ bbTh, atrTh, ztTh, zlTh, n: squeezed.length, avgFwd20, avgMFE, gt5Rate, posRate });
      }
    }
  }
}

// Sort by avgFwd20 descending
results.sort((a, b) => b.avgFwd20 - a.avgFwd20);

console.log('Top 20 Squeeze Definitions (by avg 20d forward return):');
console.log('  Rank │ BBW≤  │ ATR≤  │ ZT≤   │ ZL≥ │ Count │ Avg20d% │ AvgMFE% │ >5% Rate │ +ve Rate');
console.log('  ─────┼───────┼───────┼───────┼─────┼───────┼─────────┼─────────┼──────────┼────────');
for (let i = 0; i < Math.min(20, results.length); i++) {
  const r = results[i];
  console.log(`  ${String(i + 1).padStart(4)} │ ${String(r.bbTh).padStart(4)}% │ ${String(r.atrTh).padStart(4)}% │ ${String(r.ztTh).padStart(4)}% │ ${String(r.zlTh).padStart(3)} │ ${String(r.n).padStart(5)} │ ${(r.avgFwd20 >= 0 ? '+' : '') + r.avgFwd20.toFixed(2).padStart(6)}% │ ${('+' + r.avgMFE.toFixed(2)).padStart(7)}% │ ${r.gt5Rate.toFixed(1).padStart(6)}%  │ ${r.posRate.toFixed(1).padStart(5)}%`);
}

// Also show "sweet spot" — best balance of signal count ≥ 50 + return
const balanced = results.filter(r => r.n >= 50).sort((a, b) => b.avgFwd20 - a.avgFwd20);
console.log('\nTop 10 BALANCED (≥50 signals, sorted by avg return):');
console.log('  Rank │ BBW≤  │ ATR≤  │ ZT≤   │ ZL≥ │ Count │ Avg20d% │ AvgMFE% │ >5% Rate │ +ve Rate');
console.log('  ─────┼───────┼───────┼───────┼─────┼───────┼─────────┼─────────┼──────────┼────────');
for (let i = 0; i < Math.min(10, balanced.length); i++) {
  const r = balanced[i];
  console.log(`  ${String(i + 1).padStart(4)} │ ${String(r.bbTh).padStart(4)}% │ ${String(r.atrTh).padStart(4)}% │ ${String(r.ztTh).padStart(4)}% │ ${String(r.zlTh).padStart(3)} │ ${String(r.n).padStart(5)} │ ${(r.avgFwd20 >= 0 ? '+' : '') + r.avgFwd20.toFixed(2).padStart(6)}% │ ${('+' + r.avgMFE.toFixed(2)).padStart(7)}% │ ${r.gt5Rate.toFixed(1).padStart(6)}%  │ ${r.posRate.toFixed(1).padStart(5)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Optimal Weighting for Composite Squeeze Score
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 4: Optimal Weighting for Squeeze Score Composite                  ║');
console.log('║  Testing weight combos: w_BB + w_ATR + w_ZT + w_ZL + w_VOL = 100         ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Use the best threshold from Phase 3 to define "squeezed"
const bestConfig = results[0];
console.log(`Using best thresholds: BBW≤${bestConfig.bbTh}%, ATR≤${bestConfig.atrTh}%, ZT≤${bestConfig.ztTh}%, ZL≥${bestConfig.zlTh}`);
console.log('');

// For weighting, normalize each factor to 0-100 scale
function normalize(val, lo, hi, invert) {
  const clamped = Math.max(lo, Math.min(hi, val));
  const norm = (clamped - lo) / (hi - lo);
  return invert ? (1 - norm) * 100 : norm * 100;
}

// Grid search weights (step 10, sum = 100)
const weightResults = [];
const steps = [0, 10, 20, 30, 40, 50, 60];

for (const wBB of steps) {
  for (const wATR of steps) {
    for (const wZT of steps) {
      for (const wZL of steps) {
        const wVOL = 100 - wBB - wATR - wZT - wZL;
        if (wVOL < 0 || wVOL > 60) continue;
        if (wBB + wATR + wZT + wZL + wVOL !== 100) continue;

        // Score each point
        const scored = allPoints.map(p => {
          const sBB = normalize(p.bbwPctl, 0, 50, true);    // Lower BBW pctl = higher score
          const sATR = normalize(p.atrP, 0, 50, true);       // Lower ATR pctl = higher score
          const sZT = p.zt < 900 ? normalize(p.zt, 0, 20, true) : 0; // Lower tightness = higher score
          const sZL = normalize(p.zLen, 0, 25, false);       // Longer zone = higher score
          const sVOL = normalize(p.volComp, 0, 2, true);     // Lower vol = higher score

          const score = (wBB * sBB + wATR * sATR + wZT * sZT + wZL * sZL + wVOL * sVOL) / 100;
          return { ...p, score };
        });

        // Test: top 5% scored points
        scored.sort((a, b) => b.score - a.score);
        const top5pct = scored.slice(0, Math.floor(scored.length * 0.05));
        const top1pct = scored.slice(0, Math.floor(scored.length * 0.01));

        if (top5pct.length < 20) continue;

        const avg20_5 = top5pct.reduce((s, p) => s + p.fwd20, 0) / top5pct.length;
        const avg20_1 = top1pct.length > 10 ? top1pct.reduce((s, p) => s + p.fwd20, 0) / top1pct.length : 0;
        const posRate5 = top5pct.filter(p => p.fwd20 > 0).length / top5pct.length * 100;
        const gt5Rate5 = top5pct.filter(p => p.fwd20 > 5).length / top5pct.length * 100;

        weightResults.push({ wBB, wATR, wZT, wZL, wVOL, avg20_5, avg20_1, posRate5, gt5Rate5, n5: top5pct.length, n1: top1pct.length });
      }
    }
  }
}

weightResults.sort((a, b) => b.avg20_5 - a.avg20_5);

console.log('Top 15 Weight Combinations (by top-5% avg 20d return):');
console.log('  Rank │ wBB │ wATR│ wZT │ wZL │ wVOL│ Top5% Avg20d │ Top1% Avg20d │ PosRate │ >5%Rate │ N(5%)');
console.log('  ─────┼─────┼─────┼─────┼─────┼─────┼──────────────┼──────────────┼─────────┼─────────┼──────');
for (let i = 0; i < Math.min(15, weightResults.length); i++) {
  const r = weightResults[i];
  console.log(`  ${String(i + 1).padStart(4)} │ ${String(r.wBB).padStart(3)} │ ${String(r.wATR).padStart(3)} │ ${String(r.wZT).padStart(3)} │ ${String(r.wZL).padStart(3)} │ ${String(r.wVOL).padStart(3)} │ ${(r.avg20_5 >= 0 ? '+' : '') + r.avg20_5.toFixed(3).padStart(8)}%   │ ${(r.avg20_1 >= 0 ? '+' : '') + r.avg20_1.toFixed(3).padStart(8)}%   │ ${r.posRate5.toFixed(1).padStart(5)}%  │ ${r.gt5Rate5.toFixed(1).padStart(5)}%  │ ${String(r.n5).padStart(5)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: Tier Thresholds — What score = COILED vs TIGHT vs Normal?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 5: Score Tier Thresholds                                          ║');
console.log('║  Using optimal weights, what score cutoffs produce best tier separation?  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const bestW = weightResults[0];
console.log(`Optimal weights: BB=${bestW.wBB} ATR=${bestW.wATR} ZT=${bestW.wZT} ZL=${bestW.wZL} VOL=${bestW.wVOL}\n`);

// Score all points with best weights
const allScored = allPoints.map(p => {
  const sBB = normalize(p.bbwPctl, 0, 50, true);
  const sATR = normalize(p.atrP, 0, 50, true);
  const sZT = p.zt < 900 ? normalize(p.zt, 0, 20, true) : 0;
  const sZL = normalize(p.zLen, 0, 25, false);
  const sVOL = normalize(p.volComp, 0, 2, true);
  return { ...p, score: (bestW.wBB * sBB + bestW.wATR * sATR + bestW.wZT * sZT + bestW.wZL * sZL + bestW.wVOL * sVOL) / 100 };
});

// Test different tier cutoffs
console.log('Score Tier Analysis:');
console.log('  Score Range   │ Count    │ % of all │ Avg 5d%  │ Avg 10d% │ Avg 20d% │ Avg MFE% │ >5% Rate │ +ve Rate');
console.log('  ──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────');
const tierBuckets = [[90,100,'90-100'],[80,90,'80-90 '],[70,80,'70-80 '],[60,70,'60-70 '],[50,60,'50-60 '],[40,50,'40-50 '],[30,40,'30-40 '],[20,30,'20-30 '],[0,20,'0-20  ']];
for (const [lo, hi, label] of tierBuckets) {
  const pts = allScored.filter(p => p.score >= lo && p.score < hi);
  if (pts.length < 10) continue;
  const pctAll = pts.length / allScored.length * 100;
  const a5 = pts.reduce((s, p) => s + p.fwd5, 0) / pts.length;
  const a10 = pts.reduce((s, p) => s + p.fwd10, 0) / pts.length;
  const a20 = pts.reduce((s, p) => s + p.fwd20, 0) / pts.length;
  const aMFE = pts.reduce((s, p) => s + p.maxH, 0) / pts.length;
  const gt5 = pts.filter(p => p.fwd20 > 5).length / pts.length * 100;
  const pos = pts.filter(p => p.fwd20 > 0).length / pts.length * 100;
  console.log(`  ${label.padEnd(14)}│ ${String(pts.length).padStart(8)} │ ${pctAll.toFixed(1).padStart(6)}%  │ ${(a5 >= 0 ? '+' : '') + a5.toFixed(3).padStart(7)}% │ ${(a10 >= 0 ? '+' : '') + a10.toFixed(3).padStart(7)}% │ ${(a20 >= 0 ? '+' : '') + a20.toFixed(3).padStart(7)}% │ ${('+' + aMFE.toFixed(2)).padStart(7)}% │ ${gt5.toFixed(1).padStart(6)}%  │ ${pos.toFixed(1).padStart(5)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6: Baseline Comparison — Squeeze vs Random
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 6: Edge Verification — Squeeze vs Baseline                        ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const baselineAvg20 = allPoints.reduce((s, p) => s + p.fwd20, 0) / allPoints.length;
const baselineMFE = allPoints.reduce((s, p) => s + p.maxH, 0) / allPoints.length;
const baselineGt5 = allPoints.filter(p => p.fwd20 > 5).length / allPoints.length * 100;
const baselinePos = allPoints.filter(p => p.fwd20 > 0).length / allPoints.length * 100;

const top5 = allScored.sort((a, b) => b.score - a.score).slice(0, Math.floor(allScored.length * 0.05));
const top5Avg20 = top5.reduce((s, p) => s + p.fwd20, 0) / top5.length;
const top5MFE = top5.reduce((s, p) => s + p.maxH, 0) / top5.length;
const top5Gt5 = top5.filter(p => p.fwd20 > 5).length / top5.length * 100;
const top5Pos = top5.filter(p => p.fwd20 > 0).length / top5.length * 100;

console.log(`                  │ Baseline (all)     │ Squeeze Top 5%`);
console.log(`  ────────────────┼────────────────────┼──────────────────`);
console.log(`  Avg 20d Return  │ ${(baselineAvg20 >= 0 ? '+' : '') + baselineAvg20.toFixed(3)}%           │ ${(top5Avg20 >= 0 ? '+' : '') + top5Avg20.toFixed(3)}%`);
console.log(`  Avg MFE         │ +${baselineMFE.toFixed(2)}%             │ +${top5MFE.toFixed(2)}%`);
console.log(`  >5% in 20d      │ ${baselineGt5.toFixed(1)}%              │ ${top5Gt5.toFixed(1)}%`);
console.log(`  Positive Rate   │ ${baselinePos.toFixed(1)}%              │ ${top5Pos.toFixed(1)}%`);
console.log(`  Edge (vs base)  │ —                  │ ${(top5Avg20 - baselineAvg20 >= 0 ? '+' : '') + (top5Avg20 - baselineAvg20).toFixed(3)}% per trade`);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL RECOMMENDATION — Implementation Parameters                        ║');
console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
console.log(`║  Optimal Weights: BB=${bestW.wBB}  ATR=${bestW.wATR}  ZT=${bestW.wZT}  ZL=${bestW.wZL}  VOL=${bestW.wVOL}`);
if (results[0]) {
  console.log(`║  COILED threshold: BBW Pctl ≤ ${results[0].bbTh}%, ATR Pctl ≤ ${results[0].atrTh}%, ZT ≤ ${results[0].ztTh}%, ZL ≥ ${results[0].zlTh}`);
}
console.log('║');
console.log('║  Squeeze Score formula:');
console.log(`║    sBB  = (1 - BBW_Pctl/50) × 100   [lower BBW pctl = higher score]`);
console.log(`║    sATR = (1 - ATR_Pctl/50) × 100   [lower ATR pctl = higher score]`);
console.log(`║    sZT  = (1 - ZoneTight/20) × 100  [tighter zone = higher score]`);
console.log(`║    sZL  = (ZoneLen/25) × 100         [longer zone = higher score]`);
console.log(`║    sVOL = (1 - VolComp/2) × 100      [quieter volume = higher score]`);
console.log(`║    Score = (${bestW.wBB}×sBB + ${bestW.wATR}×sATR + ${bestW.wZT}×sZT + ${bestW.wZL}×sZL + ${bestW.wVOL}×sVOL) / 100`);
console.log('║');

// Determine tier thresholds from Phase 5 data
const scored80plus = allScored.filter(p => p.score >= 80);
const scored60to80 = allScored.filter(p => p.score >= 60 && p.score < 80);
const scored60minus = allScored.filter(p => p.score < 60);
console.log(`║  Tier thresholds:`);
console.log(`║    COILED (80+):  ${scored80plus.length} occurrences (${(scored80plus.length / allScored.length * 100).toFixed(2)}%)`);
console.log(`║    TIGHT (60-79): ${scored60to80.length} occurrences (${(scored60to80.length / allScored.length * 100).toFixed(2)}%)`);
console.log(`║    Normal (<60):  ${scored60minus.length} occurrences (${(scored60minus.length / allScored.length * 100).toFixed(2)}%)`);
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

console.log('\n═══ SQUEEZE BACKTEST COMPLETE ═══');
