// ═══════════════════════════════════════════════════════════════════════════════
// MONSTER MOVE REVERSE-ENGINEERING
// ═══════════════════════════════════════════════════════════════════════════════
// Find EVERY >10% move in 20 days, then look BACKWARD at what was present
// on Day 0. What candle, volume, ATR, zone, and price characteristics
// predict these moves? Is it mean-reversion, breakout, or something else?
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');

const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

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
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 11 || isNaN(+p[8]) || +p[8] <= 0) continue;
    c.push({ d: p[0], o: +p[4], h: +p[5], l: +p[6], c: +p[8], v: +p[10] || 0 });
  }
  return c;
}

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

function sma(c, idx, period) {
  if (idx < period - 1) return c[idx].c;
  let s = 0;
  for (let j = idx - period + 1; j <= idx; j++) s += c[j].c;
  return s / period;
}

function volAvg(c, idx, period) {
  let s = 0, n = 0;
  for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; }
  return n > 0 ? s / n : 1;
}

function atrPctl(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) { const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0; if (v < cur) below++; }
  return below / 120 * 100;
}

// BB Width
function bbWidth(c, idx) {
  if (idx < 19) return 0;
  let sum = 0;
  for (let j = idx - 19; j <= idx; j++) sum += c[j].c;
  const mean = sum / 20;
  let sqSum = 0;
  for (let j = idx - 19; j <= idx; j++) sqSum += (c[j].c - mean) ** 2;
  return mean > 0 ? Math.sqrt(sqSum / 20) * 4 / mean * 100 : 0;
}

function bbWidthPctl(c, idx) {
  if (idx < 140) return 50;
  const cur = bbWidth(c, idx);
  let below = 0;
  for (let j = idx - 120; j < idx; j++) {
    if (bbWidth(c, j) < cur) below++;
  }
  return below / 120 * 100;
}

// ─── Load data ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  MONSTER MOVE (>10%) REVERSE ENGINEERING');
console.log('  What candle/volume/price DNA was present BEFORE every >10% run?');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS') || f.includes('_all')) continue;
    const c = format === 'nse' ? parseNSE(path.join(dir, f)) : parseYahoo(path.join(dir, f));
    if (c.length < 200) continue;
    stockData.push({ sym: f.replace('_NS_OHLCV.csv', '').replace('.csv', ''), c, atr: computeATR14(c) });
  }
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Find ALL >10% forward 20-day moves
// ═══════════════════════════════════════════════════════════════════════════════

const monsters = [];  // >10% in 20d
const normals = [];   // 0-5% in 20d (control group)
const negatives = []; // <0% (losers)

for (const { sym, c, atr } of stockData) {
  for (let i = 150; i < c.length - 21; i++) {
    if (atr[i] <= 0 || c[i].c <= 0) continue;

    // Forward max high in 20 days
    let maxFwdHigh = 0;
    for (let j = i + 1; j <= i + 20; j++) {
      const hPct = (c[j].h - c[i].c) / c[i].c * 100;
      if (hPct > maxFwdHigh) maxFwdHigh = hPct;
    }
    const fwd20 = (c[i + 20].c - c[i].c) / c[i].c * 100;

    // ── Compute Day-0 characteristics ──
    const s = c[i];
    const rng = s.h - s.l;
    if (rng <= 0) continue;

    // Candle shape
    const closeLoc = (s.c - s.l) / rng * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const lowerWick = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const isGreen = s.c > s.o;
    const candleRangePct = rng / s.c * 100;
    const eRA = rng / atr[i]; // exact range / ATR

    // ATR state
    const atrPctVal = atr[i] / s.c * 100;
    const atrP = atrPctl(c, atr, i);

    // Volume
    const v20 = volAvg(c, i, 20);
    const v5 = volAvg(c, i, 5);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;
    const volVsPre5 = v5 > 0 ? s.v / v5 : 0;

    // Pre-10 volume compression
    let pre10VR = 0, p10n = 0;
    for (let j = i - 10; j < i; j++) {
      if (j >= 0 && v20 > 0) { pre10VR += c[j].v / v20; p10n++; }
    }
    pre10VR = p10n > 0 ? pre10VR / p10n : 1;

    // BB Width percentile
    const bbwP = bbWidthPctl(c, i);

    // Moving averages — position relative to SMA
    const sma20 = sma(c, i, 20);
    const sma50 = sma(c, i, 50);
    const sma200 = i >= 200 ? sma(c, i, 200) : sma50;
    const aboveSMA20 = s.c > sma20;
    const aboveSMA50 = s.c > sma50;
    const aboveSMA200 = s.c > sma200;
    const distFromSMA20 = (s.c - sma20) / sma20 * 100;
    const distFromSMA50 = (s.c - sma50) / sma50 * 100;

    // Swing high distance — how far below recent 50-day high?
    let high50 = 0;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].h > high50) high50 = c[j].h; }
    const distFromSwingHigh = (s.c - high50) / high50 * 100;

    // Swing low distance — how far above recent 50-day low?
    let low50 = Infinity;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].l < low50) low50 = c[j].l; }
    const distFromSwingLow = low50 > 0 ? (s.c - low50) / low50 * 100 : 0;

    // Consecutive red/green days before
    let consRed = 0, consGreen = 0;
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      if (c[j].c < c[j].o) consRed++; else break;
    }
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      if (c[j].c >= c[j].o) consGreen++; else break;
    }

    // Prior 5-day momentum
    const mom5 = i >= 5 ? (s.c - c[i - 5].c) / c[i - 5].c * 100 : 0;
    const mom10 = i >= 10 ? (s.c - c[i - 10].c) / c[i - 10].c * 100 : 0;
    const mom20 = i >= 20 ? (s.c - c[i - 20].c) / c[i - 20].c * 100 : 0;

    // RSI-2
    let rsi2 = 50;
    if (i >= 2) {
      const ch1 = s.c - c[i-1].c, ch2 = c[i-1].c - c[i-2].c;
      const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
      const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
      rsi2 = l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
    }

    // Zone detection
    let zoneLen = 0, zoneTight = 999;
    const zC = [];
    for (let j = i - 1; j >= Math.max(0, i - 25); j--) {
      if (atr[j] <= 0) break;
      if ((c[j].h - c[j].l) / atr[j] > 1.0) break;
      zC.unshift(j);
    }
    if (zC.length >= 3) {
      zoneLen = zC.length;
      let zH = -Infinity, zL = Infinity;
      for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
      zoneTight = zL > 0 ? (zH - zL) / zL * 100 : 999;
    }

    // Gap from previous close
    const gap = i > 0 ? (s.o - c[i-1].c) / c[i-1].c * 100 : 0;

    const point = {
      sym, idx: i, fwd20, maxFwdHigh,
      closeLoc, upperWick, lowerWick, bodyPct, isGreen, candleRangePct, eRA,
      atrPctVal, atrP, bbwP,
      volRatio20, volVsPre5, pre10VR,
      aboveSMA20, aboveSMA50, aboveSMA200, distFromSMA20, distFromSMA50,
      distFromSwingHigh, distFromSwingLow,
      consRed, consGreen, mom5, mom10, mom20, rsi2,
      zoneLen, zoneTight, gap,
    };

    if (maxFwdHigh >= 10) monsters.push(point);
    else if (fwd20 >= 0 && fwd20 < 5) normals.push(point);
    else if (fwd20 < 0) negatives.push(point);

    i += 5; // avoid overlap
  }
}

console.log(`Monster moves (MFE ≥10% in 20d): ${monsters.length}`);
console.log(`Normal moves (0-5% in 20d):       ${normals.length}`);
console.log(`Negative moves (<0% in 20d):      ${negatives.length}\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Compare Monster DNA vs Normal DNA
// ═══════════════════════════════════════════════════════════════════════════════

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  MONSTER vs NORMAL — Day-0 DNA Comparison                                ║');
console.log('║  What was DIFFERENT about the candle that started a >10% run?             ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const factors = [
  ['CANDLE SHAPE', null],
  ['  Close Location %', p => p.closeLoc],
  ['  Upper Wick %', p => p.upperWick],
  ['  Lower Wick %', p => p.lowerWick],
  ['  Body %', p => p.bodyPct],
  ['  Green candle %', null, p => p.isGreen],
  ['  Candle Range %', p => p.candleRangePct],
  ['  Range/ATR (eRA)', p => p.eRA],
  ['', null],
  ['VOLATILITY', null],
  ['  ATR % of price', p => p.atrPctVal],
  ['  ATR Percentile', p => p.atrP],
  ['  BB Width Pctl', p => p.bbwP],
  ['', null],
  ['VOLUME', null],
  ['  Vol / 20d avg', p => p.volRatio20],
  ['  Vol / Pre-5 avg', p => p.volVsPre5],
  ['  Pre-10 avg vol ratio', p => p.pre10VR],
  ['', null],
  ['TREND POSITION', null],
  ['  Above SMA20 %', null, p => p.aboveSMA20],
  ['  Above SMA50 %', null, p => p.aboveSMA50],
  ['  Above SMA200 %', null, p => p.aboveSMA200],
  ['  Dist from SMA20 %', p => p.distFromSMA20],
  ['  Dist from SMA50 %', p => p.distFromSMA50],
  ['  Dist from 50d High %', p => p.distFromSwingHigh],
  ['  Dist from 50d Low %', p => p.distFromSwingLow],
  ['', null],
  ['MOMENTUM / PATTERN', null],
  ['  Consecutive Reds', p => p.consRed],
  ['  Consecutive Greens', p => p.consGreen],
  ['  5-day momentum %', p => p.mom5],
  ['  10-day momentum %', p => p.mom10],
  ['  20-day momentum %', p => p.mom20],
  ['  RSI-2', p => p.rsi2],
  ['  Gap from prev close %', p => p.gap],
  ['', null],
  ['ZONE', null],
  ['  Zone Length', p => p.zoneLen],
  ['  Zone Tightness %', p => p.zoneTight < 900 ? p.zoneTight : null],
  ['  Has zone (≥3 bars) %', null, p => p.zoneLen >= 3],
];

console.log('  Factor                    │ MONSTER (>10%)    │ NORMAL (0-5%)     │ Delta    │ Signal');
console.log('  ──────────────────────────┼───────────────────┼───────────────────┼──────────┼───────');

for (const [label, numFn, boolFn] of factors) {
  if (!numFn && !boolFn) {
    if (label) console.log(`  ${label}`);
    else console.log('');
    continue;
  }
  if (boolFn) {
    const mPct = pct(monsters, boolFn);
    const nPct = pct(normals, boolFn);
    const delta = mPct - nPct;
    const signal = Math.abs(delta) > 10 ? (delta > 0 ? '★★★' : '▼▼▼') : Math.abs(delta) > 5 ? (delta > 0 ? '★★' : '▼▼') : '';
    console.log(`  ${label.padEnd(26)}│ ${mPct.toFixed(1).padStart(6)}%           │ ${nPct.toFixed(1).padStart(6)}%           │ ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(5)}pp │ ${signal}`);
  } else {
    const mVals = monsters.map(numFn).filter(v => v != null);
    const nVals = normals.map(numFn).filter(v => v != null);
    const mAvg = avg(mVals);
    const nAvg = avg(nVals);
    const delta = mAvg - nAvg;
    const relDelta = nAvg !== 0 ? (delta / Math.abs(nAvg)) * 100 : 0;
    const signal = Math.abs(relDelta) > 30 ? (delta > 0 ? '★★★' : '▼▼▼') : Math.abs(relDelta) > 15 ? (delta > 0 ? '★★' : '▼▼') : Math.abs(relDelta) > 8 ? (delta > 0 ? '★' : '▼') : '';
    console.log(`  ${label.padEnd(26)}│ ${mAvg.toFixed(2).padStart(8)}          │ ${nAvg.toFixed(2).padStart(8)}          │ ${(delta >= 0 ? '+' : '') + delta.toFixed(2).padStart(7)} │ ${signal}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: ORIGIN TYPE — Where do monsters come from?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  MONSTER MOVE ORIGIN — What TYPE of setup produces >10% moves?           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Classify each monster by its origin
let meanRevCount = 0, breakoutCount = 0, momentumCount = 0, gapCount = 0, bounceCount = 0, otherCount = 0;

for (const m of monsters) {
  if (m.distFromSwingHigh < -15 && m.rsi2 < 30) { meanRevCount++; m.origin = 'MEAN_REVERSION'; }
  else if (m.eRA >= 1.5 && m.volRatio20 >= 1.5 && m.closeLoc >= 60) { breakoutCount++; m.origin = 'BREAKOUT'; }
  else if (m.mom5 > 3 && m.aboveSMA20 && m.aboveSMA50) { momentumCount++; m.origin = 'MOMENTUM_CONT'; }
  else if (m.gap >= 2) { gapCount++; m.origin = 'GAP_UP'; }
  else if (m.distFromSwingLow < 5 && m.lowerWick >= 30) { bounceCount++; m.origin = 'BOUNCE'; }
  else { otherCount++; m.origin = 'OTHER'; }
}

const total = monsters.length;
console.log('  Origin Type         │ Count │   %    │ Avg MFE%  │ Avg 20d%  │ Description');
console.log('  ────────────────────┼───────┼────────┼───────────┼───────────┼─────────────────────────────');

const origins = ['MEAN_REVERSION', 'BREAKOUT', 'MOMENTUM_CONT', 'GAP_UP', 'BOUNCE', 'OTHER'];
const originLabels = {
  MEAN_REVERSION: 'Deep pullback from swing high + oversold RSI',
  BREAKOUT: 'Range expansion + volume surge + strong close',
  MOMENTUM_CONT: 'Already trending up + above MAs + momentum',
  GAP_UP: 'Gapped up ≥2% from previous close (news/catalyst)',
  BOUNCE: 'Near swing low + hammer/recovery candle',
  OTHER: 'No clear single classification',
};

for (const origin of origins) {
  const pts = monsters.filter(m => m.origin === origin);
  if (pts.length === 0) continue;
  const avgMFE = avg(pts.map(p => p.maxFwdHigh));
  const avgFwd = avg(pts.map(p => p.fwd20));
  console.log(`  ${origin.padEnd(20)}│ ${String(pts.length).padStart(5)} │ ${(pts.length / total * 100).toFixed(1).padStart(5)}% │ ${('+' + avgMFE.toFixed(1)).padStart(8)}% │ ${(avgFwd >= 0 ? '+' : '') + avgFwd.toFixed(1).padStart(7)}% │ ${originLabels[origin]}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Grid Search — Best predictor combos for >10% MFE
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID SEARCH — Best filter combos to CATCH monsters and REJECT normals   ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Combine monsters + normals + negatives for grid search
const allPts = [...monsters, ...normals.slice(0, 20000), ...negatives.slice(0, 20000)];

const configs = [];

// Test: distFromSwingHigh (mean reversion depth)
const swingThresholds = [-5, -10, -15, -20, -25, -30];
// eRA (range expansion)
const eraThresholds = [0.5, 1.0, 1.5, 2.0, 2.5];
// volRatio20
const vrThresholds = [0.5, 1.0, 1.5, 2.0, 3.0];
// closeLoc
const clThresholds = [40, 50, 60, 70, 80];
// mom5
const momThresholds = [-10, -5, 0, 2, 5];
// pre10VR (volume compression)
const pvThresholds = [0.3, 0.5, 0.7, 0.9, 1.1];

// APPROACH A: Breakout-type filters
console.log('── Approach A: BREAKOUT Filters (eRA × volRatio × closeLoc) ──');
console.log('  eRA≥  │ VR≥   │ CL≥  │ Signals │ Monster% │ Avg MFE% │ Avg 20d%  │ Precision');
console.log('  ──────┼───────┼──────┼─────────┼──────────┼──────────┼───────────┼──────────');

const breakoutResults = [];
for (const era of [1.0, 1.3, 1.5, 1.8, 2.0, 2.5]) {
  for (const vr of [1.0, 1.3, 1.5, 2.0, 2.5, 3.0]) {
    for (const cl of [50, 60, 70, 75, 80]) {
      const filtered = allPts.filter(p => p.eRA >= era && p.volRatio20 >= vr && p.closeLoc >= cl);
      if (filtered.length < 20) continue;
      const monsterRate = filtered.filter(p => p.maxFwdHigh >= 10).length / filtered.length * 100;
      const avgMFE = avg(filtered.map(p => p.maxFwdHigh));
      const avgFwd = avg(filtered.map(p => p.fwd20));
      breakoutResults.push({ era, vr, cl, n: filtered.length, monsterRate, avgMFE, avgFwd });
    }
  }
}
breakoutResults.sort((a, b) => b.monsterRate - a.monsterRate);
for (let i = 0; i < Math.min(15, breakoutResults.length); i++) {
  const r = breakoutResults[i];
  console.log(`  ${r.era.toFixed(1).padStart(4)}  │ ${r.vr.toFixed(1).padStart(4)}  │ ${String(r.cl).padStart(3)}  │ ${String(r.n).padStart(7)} │ ${r.monsterRate.toFixed(1).padStart(6)}%  │ ${('+' + r.avgMFE.toFixed(1)).padStart(7)}%  │ ${(r.avgFwd >= 0 ? '+' : '') + r.avgFwd.toFixed(1).padStart(7)}%  │ ${r.monsterRate >= 50 ? '🔥' : r.monsterRate >= 35 ? '★' : ''}`);
}

// APPROACH B: Mean Reversion filters
console.log('\n── Approach B: MEAN REVERSION Filters (pullback × RSI × volume) ──');
console.log('  Swing≤  │ RSI≤ │ PreVR≤ │ Signals │ Monster% │ Avg MFE% │ Avg 20d%  │ Precision');
console.log('  ────────┼──────┼────────┼─────────┼──────────┼──────────┼───────────┼──────────');

const mrResults = [];
for (const sw of [-5, -10, -15, -20, -25, -30]) {
  for (const rsi of [20, 30, 40, 50, 70]) {
    for (const pv of [0.5, 0.7, 0.9, 1.1]) {
      const filtered = allPts.filter(p => p.distFromSwingHigh <= sw && p.rsi2 <= rsi && p.pre10VR <= pv);
      if (filtered.length < 20) continue;
      const monsterRate = filtered.filter(p => p.maxFwdHigh >= 10).length / filtered.length * 100;
      const avgMFE = avg(filtered.map(p => p.maxFwdHigh));
      const avgFwd = avg(filtered.map(p => p.fwd20));
      mrResults.push({ sw, rsi, pv, n: filtered.length, monsterRate, avgMFE, avgFwd });
    }
  }
}
mrResults.sort((a, b) => b.monsterRate - a.monsterRate);
for (let i = 0; i < Math.min(15, mrResults.length); i++) {
  const r = mrResults[i];
  console.log(`  ${String(r.sw).padStart(5)}%  │ ${String(r.rsi).padStart(3)}  │ ${r.pv.toFixed(1).padStart(4)}   │ ${String(r.n).padStart(7)} │ ${r.monsterRate.toFixed(1).padStart(6)}%  │ ${('+' + r.avgMFE.toFixed(1)).padStart(7)}%  │ ${(r.avgFwd >= 0 ? '+' : '') + r.avgFwd.toFixed(1).padStart(7)}%  │ ${r.monsterRate >= 50 ? '🔥' : r.monsterRate >= 35 ? '★' : ''}`);
}

// APPROACH C: Momentum Continuation
console.log('\n── Approach C: MOMENTUM CONTINUATION (trend + expansion) ──');
console.log('  Mom5≥ │ >SMA50│ eRA≥  │ VR≥   │ Signals │ Monster% │ Avg MFE% │ Avg 20d%');
console.log('  ──────┼───────┼───────┼───────┼─────────┼──────────┼──────────┼──────────');

const momResults = [];
for (const m5 of [0, 2, 3, 5, 8]) {
  for (const abv of [true, false]) {
    for (const era of [0.5, 1.0, 1.5, 2.0]) {
      for (const vr of [0.5, 1.0, 1.5, 2.0]) {
        const filtered = allPts.filter(p => p.mom5 >= m5 && (abv ? p.aboveSMA50 : true) && p.eRA >= era && p.volRatio20 >= vr);
        if (filtered.length < 20) continue;
        const monsterRate = filtered.filter(p => p.maxFwdHigh >= 10).length / filtered.length * 100;
        const avgMFE = avg(filtered.map(p => p.maxFwdHigh));
        const avgFwd = avg(filtered.map(p => p.fwd20));
        momResults.push({ m5, abv, era, vr, n: filtered.length, monsterRate, avgMFE, avgFwd });
      }
    }
  }
}
momResults.sort((a, b) => b.monsterRate - a.monsterRate);
for (let i = 0; i < Math.min(15, momResults.length); i++) {
  const r = momResults[i];
  console.log(`  ${String(r.m5).padStart(4)}% │ ${(r.abv ? 'YES' : 'ANY').padStart(5)} │ ${r.era.toFixed(1).padStart(4)}  │ ${r.vr.toFixed(1).padStart(4)}  │ ${String(r.n).padStart(7)} │ ${r.monsterRate.toFixed(1).padStart(6)}%  │ ${('+' + r.avgMFE.toFixed(1)).padStart(7)}%  │ ${(r.avgFwd >= 0 ? '+' : '') + r.avgFwd.toFixed(1).padStart(7)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: COMBINED BEST — The single best predictor combo
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  BEST COMBINED PREDICTOR — All approaches together                       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Multi-factor grid: combine the best from each approach
const combResults = [];
for (const era of [1.0, 1.5, 2.0, 2.5]) {
  for (const vr of [1.0, 1.5, 2.0, 3.0]) {
    for (const cl of [50, 60, 70, 80]) {
      for (const pv of [0.5, 0.7, 0.9, 1.2]) {
        for (const isG of [true, false]) {
          const filtered = allPts.filter(p =>
            p.eRA >= era && p.volRatio20 >= vr && p.closeLoc >= cl &&
            p.pre10VR <= pv && (isG ? p.isGreen : true)
          );
          if (filtered.length < 15) continue;
          const monsterRate = filtered.filter(p => p.maxFwdHigh >= 10).length / filtered.length * 100;
          const avgMFE = avg(filtered.map(p => p.maxFwdHigh));
          const avgFwd = avg(filtered.map(p => p.fwd20));
          combResults.push({ era, vr, cl, pv, isG, n: filtered.length, monsterRate, avgMFE, avgFwd });
        }
      }
    }
  }
}

combResults.sort((a, b) => b.monsterRate - a.monsterRate);
console.log('Top 20 Combined Filters (highest monster-catch rate):');
console.log('  Rank │ eRA≥ │ VR≥  │ CL≥ │ PVR≤ │ Green│ Count │ Monster% │ AvgMFE% │ Avg20d%');
console.log('  ─────┼──────┼──────┼─────┼──────┼──────┼───────┼──────────┼─────────┼────────');
for (let i = 0; i < Math.min(20, combResults.length); i++) {
  const r = combResults[i];
  console.log(`  ${String(i + 1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${r.pv.toFixed(1).padStart(4)} │ ${(r.isG ? 'YES' : 'ANY').padStart(4)} │ ${String(r.n).padStart(5)} │ ${r.monsterRate.toFixed(1).padStart(6)}%  │ ${('+' + r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd >= 0 ? '+' : '') + r.avgFwd.toFixed(1).padStart(6)}%`);
}

// Also balanced (≥ 30 signals)
const combBalanced = combResults.filter(r => r.n >= 30).sort((a, b) => b.monsterRate - a.monsterRate);
console.log('\nTop 10 BALANCED (≥30 signals):');
console.log('  Rank │ eRA≥ │ VR≥  │ CL≥ │ PVR≤ │ Green│ Count │ Monster% │ AvgMFE% │ Avg20d%');
console.log('  ─────┼──────┼──────┼─────┼──────┼──────┼───────┼──────────┼─────────┼────────');
for (let i = 0; i < Math.min(10, combBalanced.length); i++) {
  const r = combBalanced[i];
  console.log(`  ${String(i + 1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${r.pv.toFixed(1).padStart(4)} │ ${(r.isG ? 'YES' : 'ANY').padStart(4)} │ ${String(r.n).padStart(5)} │ ${r.monsterRate.toFixed(1).padStart(6)}%  │ ${('+' + r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd >= 0 ? '+' : '') + r.avgFwd.toFixed(1).padStart(6)}%`);
}

console.log('\n═══ MONSTER MOVE ANALYSIS COMPLETE ═══');
