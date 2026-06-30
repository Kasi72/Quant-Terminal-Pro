// ═══════════════════════════════════════════════════════════════════════════════
// PCA SUPER-SCORE BACKTEST — Finer Stratification on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// Current formula uses 6 features (zoneTight, eRA, eVR, eVP5, p10R, upperWick)
// with weights [1.26, 0.56, 0.55, 0.44, -0.36, 0.26] derived from a 78-stock,
// 13,314-signal backtest. This script:
//   1. Recomputes the same 6 features on 456 Nifty 500 stocks (much larger, OOS)
//   2. Validates/recalibrates feature weights via fresh correlation analysis
//   3. Tests decile (not just quartile) stratification for finer granularity
//   4. Validates the 3-factor species classification (candle/compression/volume)
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
function atrPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) { if (c[j].c > 0 && atr[j] / c[j].c * 100 < cur) below++; }
  return below / 120 * 100;
}
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; } return n > 0 ? s / n : 1;
}
function findZone(c, atr, sigIdx, maxZoneLen, zoneRangeATRThreshold, minZoneLen, maxZoneTightnessPct) {
  const zC = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - maxZoneLen); j--) {
    if (atr[j] <= 0) break; if ((c[j].h - c[j].l) / atr[j] > zoneRangeATRThreshold) break; zC.unshift(j);
  }
  if (zC.length < minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zoneTightnessPct: zt };
}
function calcUPS(cL, uW, bP, evp5, zt, zLen) {
  let s = 0;
  s += cL >= 80 ? 20 : cL >= 65 ? 12 : 0; s += uW <= 20 ? 20 : uW <= 35 ? 12 : 0;
  s += bP >= 55 ? 15 : bP >= 35 ? 9 : 0; s += evp5 >= 4 ? 20 : evp5 >= 2 ? 12 : 0;
  s += zt <= 5 ? 15 : zt <= 15 ? 9 : 0; s += zLen >= 12 ? 10 : zLen >= 6 ? 6 : 0;
  return s;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  PCA SUPER-SCORE BACKTEST — Finer Stratification on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Generate a BROAD signal universe — loose breakout filter (mirrors the
// "Deployable-ish" base structural conditions) so PCA score has signals to rank
// ═══════════════════════════════════════════════════════════════════════════════
const BASE = {
  minAvgTurnover20: 10e6, maxATRPct14Pctl120: 70,
  maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
  zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 25.0,
};

const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const s = c[i];
    if (s.c <= 0 || atr[i] <= 0) continue;
    let to = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) to += c[j].c * c[j].v; } to /= 20;
    if (to < BASE.minAvgTurnover20) continue;
    if (atrPctl120(c, atr, i) > BASE.maxATRPct14Pctl120) continue;

    let p10S = 0, p10N = 0, expC = 0;
    for (let j = i - 11; j < i - 1; j++) { if (j < 0 || atr[j] <= 0) continue; const ra = (c[j].h - c[j].l) / atr[j]; p10S += ra; p10N++; if (ra > BASE.expansionATRMultiplier) expC++; }
    const p10A = p10N > 0 ? p10S / p10N : 999;
    if (p10A > BASE.maxPre10AvgRangeATR) continue;
    if (expC > BASE.maxPre10ExpansionCount) continue;

    const zone = findZone(c, atr, i, BASE.maxZoneLen, BASE.zoneRangeATRThreshold, BASE.minZoneLen, BASE.maxZoneTightnessPct);
    if (!zone) continue;

    const rng = s.h - s.l; if (rng <= 0) continue;
    if (s.c <= zone.zoneHigh * 1.001) continue; // must break out

    const eRA = rng / atr[i];
    const v20 = volAvg(c, i, 20);
    const evr20 = v20 > 0 ? s.v / v20 : 0;
    const v5 = volAvg(c, i, 5);
    const evp5 = v5 > 0 ? s.v / v5 : 0;
    const cL = (s.c - s.l) / rng * 100;
    const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const bP = Math.abs(s.c - s.o) / rng * 100;
    const ups = calcUPS(cL, uW, bP, evp5, zone.zoneTightnessPct, zone.zoneLen);

    // Forward outcomes
    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5, c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10, c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[Math.min(i+20, c.length-1)].c - s.c) / s.c * 100;
    const win = fwd20 > 0;

    points.push({
      sym, idx: i, fwd5, fwd10, fwd20, maxH, win,
      zoneTightnessPct: zone.zoneTightnessPct, eRA, evr20, evp5,
      pre10AvgRangeATR: p10A, upperWickPct: uW, closeLoc: cL, bodyPct: bP,
      ultraPrecisionScore: ups, zoneLen: zone.zoneLen,
    });

    i += 5; // light overlap reduction
  }
}
console.log(`Total breakout signals collected: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function std(arr) { const m = avg(arr); return Math.sqrt(avg(arr.map(v => (v - m) ** 2))); }
function pearsonR(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx*dy) : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Recalibrate weights — correlation of each raw feature vs WIN (binary)
// and vs forward 20d return, on this fresh 456-stock dataset
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: Feature Correlation — OLD weights vs FRESH Nifty 500 data        ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const featureDefs = [
  ['zoneTightnessPct', p => p.zoneTightnessPct],
  ['eRA', p => p.eRA],
  ['evr20', p => p.evr20],
  ['evp5', p => p.evp5],
  ['pre10AvgRangeATR', p => p.pre10AvgRangeATR],
  ['upperWickPct', p => p.upperWickPct],
];
const winArr = points.map(p => p.win ? 1 : 0);
const fwd20Arr = points.map(p => p.fwd20);

const oldWeights = [1.26, 0.56, 0.55, 0.44, -0.36, 0.26];
console.log('  Feature             │ OLD Weight │ r vs Win │ r vs Fwd20d │ Fresh-derived weight*');
console.log('  ─────────────────────┼────────────┼──────────┼─────────────┼──────────────────────');
const freshWeights = [];
for (let i = 0; i < featureDefs.length; i++) {
  const [name, fn] = featureDefs[i];
  const vals = points.map(fn);
  const rWin = pearsonR(vals, winArr);
  const rFwd = pearsonR(vals, fwd20Arr);
  // Fresh weight: scale by win-correlation magnitude, preserve sign, normalize roughly to old scale
  const freshW = rWin * 3; // simple linear scaling for interpretability
  freshWeights.push(freshW);
  console.log(`  ${name.padEnd(21)}│ ${oldWeights[i].toFixed(2).padStart(10)} │ ${(rWin>=0?'+':'')+rWin.toFixed(3).padStart(7)} │ ${(rFwd>=0?'+':'')+rFwd.toFixed(3).padStart(10)}  │ ${(freshW>=0?'+':'')+freshW.toFixed(2)}`);
}
console.log('  *Fresh weight = r(feature, win) × 3 — directly backtested on this dataset\n');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Compute BOTH old-weight and fresh-weight PCA scores, test decile power
// ═══════════════════════════════════════════════════════════════════════════════
const means = featureDefs.map(([, fn]) => avg(points.map(fn)));
const stds = featureDefs.map(([, fn]) => std(points.map(fn)) || 1);

function computeScore(p, weights) {
  const raw = [p.zoneTightnessPct, p.eRA, p.evr20, p.evp5, p.pre10AvgRangeATR, p.upperWickPct];
  let score = 0;
  for (let i = 0; i < 6; i++) score += weights[i] * ((raw[i] - means[i]) / stds[i]);
  return score;
}
for (const p of points) {
  p.scoreOld = computeScore(p, oldWeights);
  p.scoreFresh = computeScore(p, freshWeights);
}

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: DECILE STRATIFICATION — OLD weights (quartiles → deciles)       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function decileAnalysis(scoreKey, label) {
  const sorted = [...points].sort((a, b) => b[scoreKey] - a[scoreKey]);
  const n = sorted.length;
  console.log(`── ${label} ──`);
  console.log('  Decile      │ Count │ WR%    │ Avg5d% │ Avg10d%│ Avg20d%│ AvgMFE%│ >5%Rate│ Score Range');
  console.log('  ────────────┼───────┼────────┼────────┼────────┼────────┼────────┼────────┼─────────────');
  const deciles = [];
  for (let d = 0; d < 10; d++) {
    const lo = Math.floor(n * d / 10), hi = Math.floor(n * (d + 1) / 10);
    const bucket = sorted.slice(lo, hi);
    if (bucket.length === 0) continue;
    const wr = bucket.filter(p => p.win).length / bucket.length * 100;
    const a5 = avg(bucket.map(p => p.fwd5)), a10 = avg(bucket.map(p => p.fwd10)), a20 = avg(bucket.map(p => p.fwd20));
    const aMFE = avg(bucket.map(p => p.maxH));
    const gt5 = bucket.filter(p => p.fwd20 > 5).length / bucket.length * 100;
    const label10 = `D${10-d} (top ${(d+1)*10}%)`.padEnd(12);
    const scoreLo = bucket[bucket.length-1][scoreKey], scoreHi = bucket[0][scoreKey];
    console.log(`  ${label10}│ ${String(bucket.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}│ ${(a5>=0?'+':'')+a5.toFixed(2).padStart(5)}%│ ${(a10>=0?'+':'')+a10.toFixed(2).padStart(5)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${gt5.toFixed(1).padStart(6)}%│ [${scoreLo.toFixed(2)}, ${scoreHi.toFixed(2)}]`);
    deciles.push({ decile: 10-d, n: bucket.length, wr, a20, aMFE, gt5 });
  }
  const top = deciles[0], bottom = deciles[deciles.length-1];
  console.log(`\n  TOP DECILE vs BOTTOM DECILE SPREAD: WR ${(top.wr-bottom.wr).toFixed(1)}pp | Avg20d ${(top.a20-bottom.a20).toFixed(2)}pp | MFE ${(top.aMFE-bottom.aMFE).toFixed(1)}pp\n`);
  return deciles;
}

const oldDeciles = decileAnalysis('scoreOld', 'OLD WEIGHTS [1.26, 0.56, 0.55, 0.44, -0.36, 0.26]');
const freshDeciles = decileAnalysis('scoreFresh', 'FRESH WEIGHTS (re-derived on Nifty 500)');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Quintile + finer stratification — find optimal number of bands
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Comparing Stratification Granularity (Quartile vs Quintile vs Decile)║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function nTileSpread(scoreKey, nTiles) {
  const sorted = [...points].sort((a, b) => b[scoreKey] - a[scoreKey]);
  const n = sorted.length;
  const top = sorted.slice(0, Math.floor(n / nTiles));
  const bottom = sorted.slice(n - Math.floor(n / nTiles));
  const topWR = top.filter(p => p.win).length / top.length * 100;
  const bottomWR = bottom.filter(p => p.win).length / bottom.length * 100;
  return { topWR, bottomWR, spread: topWR - bottomWR, topN: top.length };
}

for (const nt of [4, 5, 10, 20]) {
  const r = nTileSpread('scoreFresh', nt);
  console.log(`  ${nt}-tile (top/bottom 1/${nt}): Top WR ${r.topWR.toFixed(1)}% | Bottom WR ${r.bottomWR.toFixed(1)}% | Spread ${r.spread.toFixed(1)}pp | N=${r.topN}/tile`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: New finer-grained Rank system — propose 6-tier instead of 4-tier (A-F)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5: PROPOSED 6-TIER RANK SYSTEM (vs current A/B/C/D quartiles)       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const sortedFresh = [...points].sort((a, b) => b.scoreFresh - a.scoreFresh);
const N = sortedFresh.length;
const tierBounds = [
  [0, 0.10, 'S (top 10%)'],
  [0.10, 0.25, 'A (10-25%)'],
  [0.25, 0.45, 'B (25-45%)'],
  [0.45, 0.65, 'C (45-65%)'],
  [0.65, 0.85, 'D (65-85%)'],
  [0.85, 1.00, 'F (bottom 15%)'],
];
console.log('  Tier             │ Count │ WR%    │ Avg20d%│ AvgMFE%│ >5%Rate│ >10%Rate');
console.log('  ─────────────────┼───────┼────────┼────────┼────────┼────────┼─────────');
for (const [lo, hi, label] of tierBounds) {
  const bucket = sortedFresh.slice(Math.floor(N*lo), Math.floor(N*hi));
  if (bucket.length === 0) continue;
  const wr = bucket.filter(p => p.win).length / bucket.length * 100;
  const a20 = avg(bucket.map(p => p.fwd20));
  const aMFE = avg(bucket.map(p => p.maxH));
  const gt5 = bucket.filter(p => p.fwd20 > 5).length / bucket.length * 100;
  const gt10 = bucket.filter(p => p.maxH > 10).length / bucket.length * 100;
  console.log(`  ${label.padEnd(17)}│ ${String(bucket.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${gt5.toFixed(1).padStart(6)}%│ ${gt10.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Validate the 3-Factor Species Classification
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 6: 3-FACTOR SPECIES CLASSIFICATION — Validate on Nifty 500          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const p of points) {
  p.candleSub = Math.min(10, Math.max(0, (p.closeLoc / 10 + (100 - p.upperWickPct) / 15 + (p.ultraPrecisionScore || 0) / 10) / 3 * 10));
  p.compressionSub = Math.min(10, Math.max(0, ((1 - p.pre10AvgRangeATR) * 10 + (p.zoneTightnessPct < 5 ? 10 : p.zoneTightnessPct < 8 ? 7 : p.zoneTightnessPct < 12 ? 4 : 1)) / 2));
  p.volumeSub = Math.min(10, Math.max(0, (p.evr20 || 0) * 3 + (p.evp5 || 0) * 1.5));

  if (p.candleSub >= 7 && p.compressionSub >= 6 && p.volumeSub >= 6) p.species = 'TRIPLE THREAT';
  else if (p.volumeSub >= 7 && p.compressionSub < 5) p.species = 'VOL EXPLOSION';
  else if (p.compressionSub >= 7 && p.volumeSub < 5) p.species = 'COMPRESSION';
  else if (p.candleSub >= 7) p.species = 'STRONG CANDLE';
  else if (p.compressionSub >= 5) p.species = 'BUILDING';
  else p.species = 'DEVELOPING';
}

const speciesGroups = {};
for (const p of points) { if (!speciesGroups[p.species]) speciesGroups[p.species] = []; speciesGroups[p.species].push(p); }
console.log('  Species          │ Count │   %    │ WR%    │ Avg20d%│ AvgMFE%│ >5%Rate│ >10%Rate');
console.log('  ──────────────────┼───────┼────────┼────────┼────────┼────────┼────────┼─────────');
const speciesOrder = ['TRIPLE THREAT', 'VOL EXPLOSION', 'COMPRESSION', 'STRONG CANDLE', 'BUILDING', 'DEVELOPING'];
for (const sp of speciesOrder) {
  const g = speciesGroups[sp] || [];
  if (g.length === 0) { console.log(`  ${sp.padEnd(18)}│     0 │   0.0% │   —    │   —    │   —    │   —    │    —`); continue; }
  const wr = g.filter(p => p.win).length / g.length * 100;
  const a20 = avg(g.map(p => p.fwd20));
  const aMFE = avg(g.map(p => p.maxH));
  const gt5 = g.filter(p => p.fwd20 > 5).length / g.length * 100;
  const gt10 = g.filter(p => p.maxH > 10).length / g.length * 100;
  console.log(`  ${sp.padEnd(18)}│ ${String(g.length).padStart(5)} │ ${(g.length/N*100).toFixed(1).padStart(5)}% │ ${wr.toFixed(1).padStart(6)}│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${gt5.toFixed(1).padStart(6)}%│ ${gt10.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: Grid search — best species classification thresholds
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 7: Grid Search — Optimal TRIPLE THREAT thresholds                   ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

let ttResults = [];
for (const cTh of [5, 6, 7, 8]) {
  for (const compTh of [4, 5, 6, 7]) {
    for (const volTh of [4, 5, 6, 7]) {
      const g = points.filter(p => p.candleSub >= cTh && p.compressionSub >= compTh && p.volumeSub >= volTh);
      if (g.length < 20) continue;
      const wr = g.filter(p => p.win).length / g.length * 100;
      const a20 = avg(g.map(p => p.fwd20));
      ttResults.push({ cTh, compTh, volTh, n: g.length, wr, a20 });
    }
  }
}
ttResults.sort((a, b) => b.wr - a.wr);
console.log('Top 10 TRIPLE THREAT threshold combos (by WR, min 20 signals):');
console.log('  Candle≥│Comp≥│Vol≥│ Count │ WR%    │ Avg20d%');
console.log('  ───────┼─────┼────┼───────┼────────┼────────');
for (let i = 0; i < Math.min(10, ttResults.length); i++) {
  const r = ttResults[i];
  console.log(`  ${String(r.cTh).padStart(6)} │${String(r.compTh).padStart(4)} │${String(r.volTh).padStart(3)} │ ${String(r.n).padStart(5)} │ ${r.wr.toFixed(1).padStart(6)}│ ${(r.a20>=0?'+':'')+r.a20.toFixed(2)}%`);
}

console.log('\n═══ PCA SUPER-SCORE BACKTEST COMPLETE ═══');
