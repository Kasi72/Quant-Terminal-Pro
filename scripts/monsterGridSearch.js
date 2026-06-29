// ═══════════════════════════════════════════════════════════════════════════════
// MONSTER MOVE GRID SEARCH — Sweetest of the Sweet Spot
// ═══════════════════════════════════════════════════════════════════════════════
// Exhaustive grid search across ALL 3 approaches:
//   A. Mean Reversion (swing depth × RSI × vol compression × candle shape)
//   B. Momentum Continuation (momentum × trend × expansion × volume)
//   C. Breakout (eRA × volRatio × closeLoc × bodyPct × pre-vol)
// Plus D. Combined multi-factor fusion
//
// Objective: Maximize monster rate (>10% MFE in 20d) with ≥30 signals
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
  let s = 0; for (let j = idx - period + 1; j <= idx; j++) s += c[j].c;
  return s / period;
}
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; }
  return n > 0 ? s / n : 1;
}

// ─── Load ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  MONSTER MOVE GRID SEARCH — Sweetest of the Sweet Spot');
console.log('  Exhaustive search across Mean Reversion + Momentum + Breakout + Fusion');
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

// ─── Collect all data points with features ───
const allPts = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 150; i < c.length - 21; i++) {
    if (atr[i] <= 0 || c[i].c <= 0) continue;
    const s = c[i], rng = s.h - s.l;
    if (rng <= 0) continue;

    // Forward MFE
    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) {
      const hPct = (c[j].h - s.c) / s.c * 100;
      if (hPct > maxH) maxH = hPct;
    }
    const fwd20 = (c[i + 20].c - s.c) / s.c * 100;
    const isMonster = maxH >= 10;

    // Features
    const closeLoc = (s.c - s.l) / rng * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const lowerWick = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const isGreen = s.c > s.o;
    const candleRangePct = rng / s.c * 100;
    const eRA = rng / atr[i];
    const atrPctVal = atr[i] / s.c * 100;

    const v20 = volAvg(c, i, 20);
    const v5 = volAvg(c, i, 5);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;
    const volVsPre5 = v5 > 0 ? s.v / v5 : 0;

    let pre10VR = 0, p10n = 0;
    for (let j = i - 10; j < i; j++) { if (j >= 0 && v20 > 0) { pre10VR += c[j].v / v20; p10n++; } }
    pre10VR = p10n > 0 ? pre10VR / p10n : 1;

    // Pre-5 vol ratio
    let pre5VR = 0, p5n = 0;
    for (let j = i - 5; j < i; j++) { if (j >= 0 && v20 > 0) { pre5VR += c[j].v / v20; p5n++; } }
    pre5VR = p5n > 0 ? pre5VR / p5n : 1;

    const sma20 = sma(c, i, 20);
    const sma50 = sma(c, i, 50);
    const aboveSMA20 = s.c > sma20;
    const aboveSMA50 = s.c > sma50;
    const distSMA20 = (s.c - sma20) / sma20 * 100;
    const distSMA50 = (s.c - sma50) / sma50 * 100;

    let high50 = 0;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].h > high50) high50 = c[j].h; }
    const swingDist = (s.c - high50) / high50 * 100;

    let low50 = Infinity;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].l < low50) low50 = c[j].l; }
    const lowDist = low50 > 0 ? (s.c - low50) / low50 * 100 : 0;

    const mom5 = i >= 5 ? (s.c - c[i-5].c) / c[i-5].c * 100 : 0;
    const mom10 = i >= 10 ? (s.c - c[i-10].c) / c[i-10].c * 100 : 0;
    const mom20 = i >= 20 ? (s.c - c[i-20].c) / c[i-20].c * 100 : 0;

    let rsi2 = 50;
    if (i >= 2) {
      const ch1 = s.c - c[i-1].c, ch2 = c[i-1].c - c[i-2].c;
      const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
      const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
      rsi2 = l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
    }

    const gap = i > 0 ? (s.o - c[i-1].c) / c[i-1].c * 100 : 0;

    // Consecutive reds before
    let consRed = 0;
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) { if (c[j].c < c[j].o) consRed++; else break; }

    allPts.push({
      isMonster, maxH, fwd20,
      closeLoc, upperWick, lowerWick, bodyPct, isGreen, candleRangePct, eRA,
      atrPctVal, volRatio20, volVsPre5, pre10VR, pre5VR,
      aboveSMA20, aboveSMA50, distSMA20, distSMA50,
      swingDist, lowDist, mom5, mom10, mom20, rsi2, gap, consRed,
    });

    i += 2; // slight overlap reduction
  }
}

const totalPts = allPts.length;
const totalMonsters = allPts.filter(p => p.isMonster).length;
const baseMonsterRate = totalMonsters / totalPts * 100;
console.log(`Total data points: ${totalPts.toLocaleString()}`);
console.log(`Baseline monster rate: ${baseMonsterRate.toFixed(1)}% (${totalMonsters.toLocaleString()} monsters)\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// GRID A: MEAN REVERSION — Ultra-fine grid
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID A: MEAN REVERSION — Ultra-fine 7,200 combos                       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const mrResults = [];
const swingVals = [-10, -12, -15, -17, -20, -22, -25, -28, -30, -35];
const rsiVals = [10, 15, 20, 25, 30, 35, 40, 50, 60, 70];
const preVRVals = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1];
const consRedVals = [0, 1, 2, 3];
const greenFilter = [true, false]; // require green candle on day 0?
const lowerWickVals = [0, 15, 25, 40]; // min lower wick %

for (const sw of swingVals) {
  for (const rsi of rsiVals) {
    for (const pv of preVRVals) {
      for (const cr of consRedVals) {
        for (const lw of lowerWickVals) {
          const filtered = allPts.filter(p =>
            p.swingDist <= sw && p.rsi2 <= rsi && p.pre10VR <= pv &&
            p.consRed >= cr && p.lowerWick >= lw
          );
          if (filtered.length < 20) continue;
          const monsters = filtered.filter(p => p.isMonster).length;
          const rate = monsters / filtered.length * 100;
          const avgMFE = avg(filtered.map(p => p.maxH));
          const avgFwd = avg(filtered.map(p => p.fwd20));
          mrResults.push({ sw, rsi, pv, cr, lw, n: filtered.length, rate, avgMFE, avgFwd });
        }
      }
    }
  }
}

mrResults.sort((a, b) => b.rate - a.rate);
console.log(`Tested ${mrResults.length.toLocaleString()} combos\n`);
console.log('Top 25 (highest monster rate, min 20 signals):');
console.log('  Rank │ Swing≤ │ RSI≤ │ PVR≤ │ Reds≥│ LW≥  │ Count │ Monster% │ AvgMFE% │ Avg20d%');
console.log('  ─────┼────────┼──────┼──────┼──────┼──────┼───────┼──────────┼─────────┼────────');
for (let i = 0; i < Math.min(25, mrResults.length); i++) {
  const r = mrResults[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${String(r.sw).padStart(5)}% │ ${String(r.rsi).padStart(3)}  │ ${r.pv.toFixed(1).padStart(4)} │ ${String(r.cr).padStart(3)}  │ ${String(r.lw).padStart(3)}% │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

console.log('\nTop 15 BALANCED (≥50 signals):');
const mrBal = mrResults.filter(r => r.n >= 50);
for (let i = 0; i < Math.min(15, mrBal.length); i++) {
  const r = mrBal[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${String(r.sw).padStart(5)}% │ ${String(r.rsi).padStart(3)}  │ ${r.pv.toFixed(1).padStart(4)} │ ${String(r.cr).padStart(3)}  │ ${String(r.lw).padStart(3)}% │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

console.log('\nTop 15 HIGH-VOLUME (≥200 signals):');
const mrHV = mrResults.filter(r => r.n >= 200);
for (let i = 0; i < Math.min(15, mrHV.length); i++) {
  const r = mrHV[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${String(r.sw).padStart(5)}% │ ${String(r.rsi).padStart(3)}  │ ${r.pv.toFixed(1).padStart(4)} │ ${String(r.cr).padStart(3)}  │ ${String(r.lw).padStart(3)}% │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRID B: MOMENTUM CONTINUATION — Ultra-fine grid
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID B: MOMENTUM CONTINUATION — Ultra-fine grid                         ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const momResults = [];
const mom5Vals = [3, 5, 6, 7, 8, 10, 12, 15];
const eraVals2 = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
const vrVals2 = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5];
const atrPctVals = [2, 3, 4, 5, 6, 8];

for (const m5 of mom5Vals) {
  for (const era of eraVals2) {
    for (const vr of vrVals2) {
      for (const abv of [true, false]) {
        for (const atrMin of atrPctVals) {
          const filtered = allPts.filter(p =>
            p.mom5 >= m5 && p.eRA >= era && p.volRatio20 >= vr &&
            (abv ? p.aboveSMA50 : true) && p.atrPctVal >= atrMin
          );
          if (filtered.length < 20) continue;
          const monsters = filtered.filter(p => p.isMonster).length;
          const rate = monsters / filtered.length * 100;
          const avgMFE = avg(filtered.map(p => p.maxH));
          const avgFwd = avg(filtered.map(p => p.fwd20));
          momResults.push({ m5, era, vr, abv, atrMin, n: filtered.length, rate, avgMFE, avgFwd });
        }
      }
    }
  }
}

momResults.sort((a, b) => b.rate - a.rate);
console.log(`Tested ${momResults.length.toLocaleString()} combos\n`);
console.log('Top 25 (highest monster rate, min 20 signals):');
console.log('  Rank │ Mom5≥│ eRA≥ │ VR≥  │ >50MA│ ATR≥ │ Count │ Monster% │ AvgMFE% │ Avg20d%');
console.log('  ─────┼──────┼──────┼──────┼──────┼──────┼───────┼──────────┼─────────┼────────');
for (let i = 0; i < Math.min(25, momResults.length); i++) {
  const r = momResults[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${String(r.m5).padStart(3)}% │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${(r.abv?'YES':'ANY').padStart(4)} │ ${String(r.atrMin).padStart(3)}% │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

console.log('\nTop 10 BALANCED (≥100 signals):');
const momBal = momResults.filter(r => r.n >= 100);
for (let i = 0; i < Math.min(10, momBal.length); i++) {
  const r = momBal[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${String(r.m5).padStart(3)}% │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${(r.abv?'YES':'ANY').padStart(4)} │ ${String(r.atrMin).padStart(3)}% │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRID C: BREAKOUT — Ultra-fine grid with more factors
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID C: BREAKOUT — Ultra-fine grid with candle quality                  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const brkResults = [];
const eraVals3 = [1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
const vrVals3 = [1.0, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0];
const clVals = [40, 50, 60, 65, 70, 75, 80];
const bpVals = [30, 40, 50, 60, 70];
const pvVals3 = [0.5, 0.7, 0.8, 0.9, 1.0, 1.2];

for (const era of eraVals3) {
  for (const vr of vrVals3) {
    for (const cl of clVals) {
      for (const bp of bpVals) {
        for (const pv of pvVals3) {
          const filtered = allPts.filter(p =>
            p.eRA >= era && p.volRatio20 >= vr && p.closeLoc >= cl &&
            p.bodyPct >= bp && p.pre10VR <= pv
          );
          if (filtered.length < 15) continue;
          const monsters = filtered.filter(p => p.isMonster).length;
          const rate = monsters / filtered.length * 100;
          const avgMFE = avg(filtered.map(p => p.maxH));
          const avgFwd = avg(filtered.map(p => p.fwd20));
          brkResults.push({ era, vr, cl, bp, pv, n: filtered.length, rate, avgMFE, avgFwd });
        }
      }
    }
  }
}

brkResults.sort((a, b) => b.rate - a.rate);
console.log(`Tested ${brkResults.length.toLocaleString()} combos\n`);
console.log('Top 25 (highest monster rate, min 15 signals):');
console.log('  Rank │ eRA≥ │ VR≥  │ CL≥ │ BP≥ │ PVR≤ │ Count │ Monster% │ AvgMFE% │ Avg20d%');
console.log('  ─────┼──────┼──────┼─────┼─────┼──────┼───────┼──────────┼─────────┼────────');
for (let i = 0; i < Math.min(25, brkResults.length); i++) {
  const r = brkResults[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${String(r.bp).padStart(3)} │ ${r.pv.toFixed(1).padStart(4)} │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

console.log('\nTop 10 BALANCED (≥30 signals):');
const brkBal = brkResults.filter(r => r.n >= 30);
for (let i = 0; i < Math.min(10, brkBal.length); i++) {
  const r = brkBal[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${String(r.bp).padStart(3)} │ ${r.pv.toFixed(1).padStart(4)} │ ${String(r.n).padStart(5)} │ ${r.rate.toFixed(1).padStart(6)}%  │ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}% │ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1).padStart(6)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL: COMPARE ALL 3 APPROACHES — BEST OF EACH
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL COMPARISON — Best of Each Approach (≥30 signals)                              ║');
console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');

const bestMR = mrResults.filter(r => r.n >= 30)[0];
const bestMom = momResults.filter(r => r.n >= 30)[0];
const bestBrk = brkResults.filter(r => r.n >= 30)[0];

if (bestMR) {
  console.log(`║  🏆 MEAN REVERSION:   ${bestMR.rate.toFixed(1)}% monster rate │ ${bestMR.n} signals │ +${bestMR.avgMFE.toFixed(1)}% MFE │ ${bestMR.avgFwd>=0?'+':''}${bestMR.avgFwd.toFixed(1)}% 20d`);
  console.log(`║     Params: Swing≤${bestMR.sw}% RSI≤${bestMR.rsi} PreVR≤${bestMR.pv} ConsRed≥${bestMR.cr} LowerWick≥${bestMR.lw}%`);
}
if (bestMom) {
  console.log(`║  🚀 MOMENTUM:        ${bestMom.rate.toFixed(1)}% monster rate │ ${bestMom.n} signals │ +${bestMom.avgMFE.toFixed(1)}% MFE │ ${bestMom.avgFwd>=0?'+':''}${bestMom.avgFwd.toFixed(1)}% 20d`);
  console.log(`║     Params: Mom5≥${bestMom.m5}% eRA≥${bestMom.era} VR≥${bestMom.vr} ${bestMom.abv?'>SMA50':'AnySMA'} ATR≥${bestMom.atrMin}%`);
}
if (bestBrk) {
  console.log(`║  💥 BREAKOUT:         ${bestBrk.rate.toFixed(1)}% monster rate │ ${bestBrk.n} signals │ +${bestBrk.avgMFE.toFixed(1)}% MFE │ ${bestBrk.avgFwd>=0?'+':''}${bestBrk.avgFwd.toFixed(1)}% 20d`);
  console.log(`║     Params: eRA≥${bestBrk.era} VR≥${bestBrk.vr} CL≥${bestBrk.cl} BP≥${bestBrk.bp} PreVR≤${bestBrk.pv}`);
}
console.log(`║`);
console.log(`║  Baseline: ${baseMonsterRate.toFixed(1)}% monster rate (any random candle)`);
console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');

// ═══════════════════════════════════════════════════════════════════════════════
// SWEET SPOT SUMMARY — Implementation-ready params
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  IMPLEMENTATION-READY PARAMETERS                                                     ║');
console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');

// Best balanced for each
const mrSweet = mrResults.filter(r => r.n >= 50 && r.rate >= 60)[0] || mrResults.filter(r => r.n >= 50)[0];
const momSweet = momResults.filter(r => r.n >= 100 && r.rate >= 50)[0] || momResults.filter(r => r.n >= 100)[0];
const brkSweet = brkResults.filter(r => r.n >= 30 && r.rate >= 45)[0] || brkResults.filter(r => r.n >= 30)[0];

if (mrSweet) {
  console.log(`║`);
  console.log(`║  🏆 MEAN REVERSION SWEET SPOT:`);
  console.log(`║     Swing from 50d high: ≤ ${mrSweet.sw}%`);
  console.log(`║     RSI-2:               ≤ ${mrSweet.rsi}`);
  console.log(`║     Pre-10 Vol Ratio:    ≤ ${mrSweet.pv}`);
  console.log(`║     Consecutive Reds:    ≥ ${mrSweet.cr}`);
  console.log(`║     Lower Wick:          ≥ ${mrSweet.lw}%`);
  console.log(`║     → ${mrSweet.rate.toFixed(1)}% monster rate on ${mrSweet.n} signals (${(mrSweet.rate/baseMonsterRate).toFixed(1)}× baseline)`);
}
if (momSweet) {
  console.log(`║`);
  console.log(`║  🚀 MOMENTUM SWEET SPOT:`);
  console.log(`║     5-day momentum:      ≥ ${momSweet.m5}%`);
  console.log(`║     Range/ATR (eRA):     ≥ ${momSweet.era}`);
  console.log(`║     Volume Ratio:        ≥ ${momSweet.vr}`);
  console.log(`║     Above SMA50:         ${momSweet.abv ? 'YES' : 'ANY'}`);
  console.log(`║     ATR % of price:      ≥ ${momSweet.atrMin}%`);
  console.log(`║     → ${momSweet.rate.toFixed(1)}% monster rate on ${momSweet.n} signals (${(momSweet.rate/baseMonsterRate).toFixed(1)}× baseline)`);
}
if (brkSweet) {
  console.log(`║`);
  console.log(`║  💥 BREAKOUT SWEET SPOT:`);
  console.log(`║     Range/ATR (eRA):     ≥ ${brkSweet.era}`);
  console.log(`║     Volume Ratio 20d:    ≥ ${brkSweet.vr}`);
  console.log(`║     Close Location:      ≥ ${brkSweet.cl}%`);
  console.log(`║     Body %:              ≥ ${brkSweet.bp}%`);
  console.log(`║     Pre-10 Vol Ratio:    ≤ ${brkSweet.pv}`);
  console.log(`║     → ${brkSweet.rate.toFixed(1)}% monster rate on ${brkSweet.n} signals (${(brkSweet.rate/baseMonsterRate).toFixed(1)}× baseline)`);
}

console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');

console.log('\n═══ MONSTER MOVE GRID SEARCH COMPLETE ═══');
