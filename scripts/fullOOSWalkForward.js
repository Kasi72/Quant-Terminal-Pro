// ══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE OOS + WALK-FORWARD ROBUSTNESS TEST  —  All 5 Param Sets
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   1.  60/40 Chronological IS/OOS split — detects overfitting to historical data
//   2.  Anchored walk-forward (expanding window, 5 folds) — simulates live deployment
//   3.  Per-calendar-year breakdown — detects regime dependency
//   4.  Bootstrap 95% confidence interval on WR (1 000 resamples)
//   5.  Two-proportion z-test for IS vs OOS WR significance
//
// Collapse flags:
//   🔴  OOS WR drops >15pp vs IS     → overfitting
//   🔴  Year-to-year WR range  >35pp → regime fragile
//   🔴  Bootstrap CI lower    <50%   → not reliably profitable
//   🟡  OOS WR drops 8–15pp          → moderate concern
//   ✅  OOS WR within 8pp of IS      → robust
//
// Uses EXACT param sets from lib/stockEngine.ts and FIXED T2/T3 formula.
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DATA_DIRS = [
  'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV',
  'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX',
];

// ─── EXACT PARAM SETS (mirrored from lib/stockEngine.ts) ─────────────────────
const PARAM_SETS = {
  D20: {
    label: 'Deploy 20+   (D20)',
    minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 0.75, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.90,
    maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 0.7, minExactVolVsPre5: 3.0,
    minCloseLoc: 55, maxUpperWickPct: 22, minBodyPct: 70, maxCandleRisk: 6.0,
    minUltraPrecisionScore: 45, minRSI2: 50,
    minVolatilityExpansionRatio: 2.0, minCandleQualityScore: 2, maxCloseAboveZonePct: null,
  },
  HP15: {
    label: 'HiPrec 15+   (HP15)',
    minAvgTurnover20: 10e6, maxATRPct14Pctl120: 85,
    maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 8.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.5, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.5, minExactVolVsPre5: 2.5,
    minCloseLoc: 55, maxUpperWickPct: 40, minBodyPct: 20, maxCandleRisk: 10.0,
    minUltraPrecisionScore: 50, minRSI2: 50,
    minVolatilityExpansionRatio: 0.75, minCandleQualityScore: null, maxCloseAboveZonePct: 6.0,
  },
  E10: {
    label: 'Elite 10+    (E10)',
    minAvgTurnover20: 20e6, maxATRPct14Pctl120: 60,
    maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 3, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 20.0,
    maxPre10AvgVolRatio: 1.00, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 1.8, minExactVolVsPre5: 2.0,
    minCloseLoc: 35, maxUpperWickPct: 20, minBodyPct: 10, maxCandleRisk: 5.0,
    minUltraPrecisionScore: 0, minRSI2: 50,
    minVolatilityExpansionRatio: 0.6, minCandleQualityScore: 2, maxCloseAboveZonePct: null,
  },
  US8: {
    label: 'UltraSel 8+  (US8)',
    minAvgTurnover20: 10e6, maxATRPct14Pctl120: 30,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 0, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 0.95, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 6.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 0.4, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 1.1, minExactVolVsPre5: 1.0,
    minCloseLoc: 30, maxUpperWickPct: 25, minBodyPct: 5, maxCandleRisk: 8.5,
    minUltraPrecisionScore: 0, minRSI2: 50,
    minVolatilityExpansionRatio: 2.4, minCandleQualityScore: 4, maxCloseAboveZonePct: null,
  },
  SNP: {
    label: 'Sniper 95+   (SNP)',
    minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.8, minExactVolVsPre5: 1.0,
    minCloseLoc: 55, maxUpperWickPct: 50, minBodyPct: 50, maxCandleRisk: 6.0,
    minUltraPrecisionScore: 5, minRSI2: 50,
    minVolatilityExpansionRatio: 0.7, minCandleQualityScore: 2, maxCloseAboveZonePct: null,
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ d: p[0].trim(), o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}

function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++)
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
    a[i] = (a[i-1] * 13 + tr) / 14;
  }
  return a;
}

function atrPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++)
    if (c[j].c > 0 && atr[j] / c[j].c * 100 < cur) below++;
  return below / 120 * 100;
}

function volAvg(c, idx, period) {
  let s = 0, n = 0;
  for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; }
  return n > 0 ? s / n : 1;
}

function findZone(c, atr, idx, p) {
  const zC = [];
  for (let j = idx - 1; j >= Math.max(0, idx - p.maxZoneLen); j--) {
    if (atr[j] <= 0) break;
    if ((c[j].h - c[j].l) / atr[j] > p.zoneRangeATRThreshold) break;
    zC.unshift(j);
  }
  if (zC.length < p.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > p.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zt };
}

function calcUPS(cL, uW, bP, evp5, zt, zLen) {
  let s = 0;
  s += cL >= 80 ? 20 : cL >= 65 ? 12 : 0;
  s += uW <= 20 ? 20 : uW <= 35 ? 12 : 0;
  s += bP >= 55 ? 15 : bP >= 35 ? 9 : 0;
  s += evp5 >= 4 ? 20 : evp5 >= 2 ? 12 : 0;
  s += zt <= 5 ? 15 : zt <= 15 ? 9 : 0;
  s += zLen >= 12 ? 10 : zLen >= 6 ? 6 : 0;
  return s;
}

function calcCQS(cL, uW, bP, evp5, ver) {
  let s = 0;
  if (cL >= 65) s++; if (uW <= 30) s++; if (bP >= 40) s++;
  if (evp5 >= 2.5) s++; if (ver >= 1.5) s++;
  return s;
}

function rsi2(c, idx) {
  if (idx < 2) return 50;
  const ch1 = c[idx].c - c[idx-1].c, ch2 = c[idx-1].c - c[idx-2].c;
  const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
  const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
  return l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
}

function screenSignal(c, atr, idx, p) {
  const s = c[idx];
  if (!s || s.c <= 0 || atr[idx] <= 0) return null;
  // Turnover filter
  let to = 0;
  for (let j = idx - 20; j < idx; j++) if (j >= 0) to += c[j].c * c[j].v;
  if (to / 20 < p.minAvgTurnover20) return null;
  // ATR percentile
  if (atrPctl120(c, atr, idx) > p.maxATRPct14Pctl120) return null;
  // Pre-10 range
  let p10RS = 0, p10N = 0, expC = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0 || atr[j] <= 0) continue;
    const ra = (c[j].h - c[j].l) / atr[j];
    p10RS += ra; p10N++;
    if (ra > p.expansionATRMultiplier) expC++;
  }
  const p10A = p10N > 0 ? p10RS / p10N : 999;
  if (p10A > p.maxPre10AvgRangeATR) return null;
  if (expC > p.maxPre10ExpansionCount) return null;
  // Zone
  const zone = findZone(c, atr, idx, p);
  if (!zone) return null;
  // Volume
  const v20 = volAvg(c, idx, 20);
  let p10VRS = 0, p10VRN = 0, p5VRS = 0, p5VRN = 0, hvC = 0, redVol = 0, greenVol = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0) continue;
    const vr = v20 > 0 ? c[j].v / v20 : 0;
    p10VRS += vr; p10VRN++;
    if (j >= idx - 6) { p5VRS += vr; p5VRN++; }
    if (vr > p.highVolMultiplier) hvC++;
    if (c[j].c < c[j].o) redVol += c[j].v; else greenVol += c[j].v;
  }
  if (p10VRN > 0 && p10VRS / p10VRN > p.maxPre10AvgVolRatio) return null;
  if (p5VRN > 0 && p5VRS / p5VRN > p.maxPre5AvgVolRatio) return null;
  if (hvC > p.maxPre10HighVolCount) return null;
  const rvb = greenVol > 0 ? redVol / greenVol : (redVol > 0 ? 10 : 1);
  if (rvb > p.maxPre10RedVolBias) return null;
  // Signal candle
  const rng = s.h - s.l;
  if (rng <= 0) return null;
  const eRA = rng / atr[idx];
  const evr20 = v20 > 0 ? s.v / v20 : 0;
  const v5 = volAvg(c, idx, 5);
  const evp5 = v5 > 0 ? s.v / v5 : 0;
  const cL = (s.c - s.l) / rng * 100;
  const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
  const bP = Math.abs(s.c - s.o) / rng * 100;
  if (s.c <= zone.zoneHigh * 1.001) return null;
  if (eRA < p.minExactRangeATR14 || eRA > p.maxExactRangeATR14) return null;
  if (evr20 < p.minExactVolRatio20) return null;
  if (evp5 < p.minExactVolVsPre5) return null;
  if (cL < p.minCloseLoc) return null;
  if (uW > p.maxUpperWickPct) return null;
  if (bP < p.minBodyPct) return null;
  if (rng / s.c * 100 > p.maxCandleRisk) return null;
  const ver = p10A > 0 ? eRA / p10A : 0;
  if (ver < p.minVolatilityExpansionRatio) return null;
  const ups = calcUPS(cL, uW, bP, evp5, zone.zt, zone.zoneLen);
  if (ups < p.minUltraPrecisionScore) return null;
  if (rsi2(c, idx) < p.minRSI2) return null;
  if (p.minCandleQualityScore != null && calcCQS(cL, uW, bP, evp5, ver) < p.minCandleQualityScore) return null;
  if (p.maxCloseAboveZonePct != null && (s.c - zone.zoneHigh) / zone.zoneHigh * 100 > p.maxCloseAboveZonePct) return null;
  return { zone };
}

const tick = p => Math.round(p / 0.05) * 0.05;

function gateCheck(stop, cd, prev, pp, candles, i) {
  if (cd.c > stop) return 'ABOVE';
  const dipPct = (stop - cd.c) / stop * 100;
  if (dipPct < 1.5) return 'SHIELDED';
  // RSI2 shakeout
  if (i >= 2) {
    const ch1 = cd.c - prev.c, ch2 = prev.c - (pp ? pp.c : prev.c);
    const g = ((ch1>0?ch1:0)+(ch2>0?ch2:0))/2;
    const l = ((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
    if ((l<0.001?100:100-100/(1+g/l)) < 5) return 'SHIELDED';
  }
  if (prev && prev.c > stop) return 'SHIELDED';
  if (prev && cd.c >= prev.c) return 'SHIELDED';
  // Volume shakeout
  let avgV = 0, vc = 0;
  for (let vi = Math.max(0, i-20); vi < i; vi++) { if (candles[vi] && candles[vi].v > 0) { avgV += candles[vi].v; vc++; } }
  avgV = vc > 0 ? avgV / vc : 0;
  if (cd.v != null && avgV > 0 && cd.v < avgV * 0.6) return 'SHIELDED';
  const rng = cd.h - cd.l;
  if (rng > 0 && (Math.min(cd.o, cd.c) - cd.l) / rng * 100 >= 60) return 'SHIELDED';
  if (cd.c > cd.o && rng > 0 && (cd.c - cd.o) / rng * 100 >= 50) return 'SHIELDED';
  if (rng > 0 && (cd.c - cd.l) / rng * 100 >= 45) return 'SHIELDED';
  if (prev && cd.c > prev.c && cd.v > (prev.v || 0)) return 'SHIELDED';
  if (prev && pp) {
    if (!(cd.c < cd.o && prev.c < prev.o && pp.c < pp.o)) return 'SHIELDED';
  } else return 'SHIELDED';
  return 'STOPPED';
}

function simulateTrade(c, atr, entryIdx, zone) {
  const entry = c[entryIdx].c;
  const stopRaw = zone.zoneLow - 0.50 * atr[entryIdx];
  const floorStop = entry * (1 - 4.0/100);
  const capStop   = entry * (1 - 6.5/100);
  const stop = Math.min(Math.max(stopRaw, capStop), floorStop);

  // FIXED T2/T3 formula (ATR-relative, no 5.65% cap)
  const atrPct = atr[entryIdx] / entry * 100;
  const t1Pct  = Math.max(4.0, Math.min(12.0, 2.15 * atrPct));
  const t1 = tick(entry * (1 + t1Pct / 100));
  const t2Pct  = t1Pct + atrPct;                            // T1 + 1 ATR
  const t2 = tick(entry * (1 + t2Pct / 100));
  const t3BucketPct = atrPct < 1.5 ? 5.0 : atrPct <= 3.0 ? 7.0 : 10.0;
  const t3Pct  = Math.max(t3BucketPct, t2Pct + 1.5 * atrPct);
  const t3 = tick(Math.max(entry * (1 + t3Pct / 100), t2 + 0.05));

  let pos = 1, pnl = 0, mfe = 0, mae = 0;
  let status = 'expired', exitDay = 0, trail = stop;
  let t1H = false, t2H = false;

  for (let d = 1; d <= Math.min(20, c.length - entryIdx - 1); d++) {
    const ci = entryIdx + d; if (ci >= c.length) break;
    const cd = c[ci], prev = c[ci-1], pp = ci >= 2 ? c[ci-2] : null;
    const hP = (cd.h - entry) / entry * 100, lP = (cd.l - entry) / entry * 100;
    if (hP > mfe) mfe = hP; if (lP < mae) mae = lP;
    if (!t1H && cd.h >= t1 && pos > 0) { pnl += 0.50 * (t1-entry)/entry*100; pos -= 0.50; t1H = true; trail = entry; }
    if (t1H && !t2H && cd.h >= t2 && pos > 0) { pnl += 0.30 * (t2-entry)/entry*100; pos -= 0.30; t2H = true; trail = t1; }
    if (t2H && cd.h >= t3 && pos > 0) { pnl += pos*(t3-entry)/entry*100; status='hit_t3'; exitDay=d; pos=0; break; }
    if (cd.c <= trail && pos > 0) {
      const g = gateCheck(trail, cd, prev, pp, c.slice(entryIdx), d);
      if (g === 'STOPPED') { pnl += pos*(cd.c-entry)/entry*100; status='stopped'; exitDay=d; pos=0; break; }
    }
  }
  if (pos > 0) {
    const li = Math.min(entryIdx+20, c.length-1);
    pnl += pos*(c[li].c-entry)/entry*100;
    status = t1H ? (t2H ? 'hit_t2' : 'hit_t1') : 'expired';
    exitDay = li - entryIdx;
  }
  const riskPct = (entry - stop) / entry * 100;
  return { pnl, riskPct, status, exitDay, mfe, mae, year: c[entryIdx].d.slice(0,4) };
}

function stats(trades) {
  const n = trades.length;
  if (n === 0) return { n:0, wr:0, avgPnl:0, pf:0, maxDD:0, medPnl:0, sharpe:0 };
  const wins = trades.filter(t => t.pnl > 0);
  const wr = wins.length / n * 100;
  const avgPnl = trades.reduce((s,t) => s+t.pnl, 0) / n;
  const sorted = [...trades].map(t=>t.pnl).sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length/2);
  const medPnl = sorted.length % 2 === 0 ? (sorted[mid-1]+sorted[mid])/2 : sorted[mid];
  const gW = wins.reduce((s,t) => s+t.pnl, 0);
  const gL = Math.abs(trades.filter(t=>t.pnl<=0).reduce((s,t) => s+t.pnl, 0));
  const pf = gL > 0 ? gW/gL : (gW > 0 ? 999 : 0);
  let peak=0, maxDD=0, eq=0;
  for (const t of trades) { eq+=t.pnl; if(eq>peak)peak=eq; if(peak-eq>maxDD)maxDD=peak-eq; }
  const mean = avgPnl;
  const stdv = Math.sqrt(trades.reduce((s,t) => s+(t.pnl-mean)**2, 0)/n);
  const sharpe = stdv > 0 ? mean/stdv : 0;
  return { n, wr, avgPnl, medPnl, pf, maxDD, sharpe };
}

// Bootstrap 95% CI on WR
function bootstrapWR(trades, B=1000) {
  if (trades.length < 10) return { lo: 0, hi: 100, mean: 0 };
  const wrs = [];
  for (let b = 0; b < B; b++) {
    let wins = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[Math.floor(Math.random() * trades.length)];
      if (t.pnl > 0) wins++;
    }
    wrs.push(wins / trades.length * 100);
  }
  wrs.sort((a,b) => a-b);
  return { lo: wrs[25], hi: wrs[974], mean: wrs[499] };
}

// Two-proportion z-test (IS vs OOS WR)
function zTestWR(n1, k1, n2, k2) {
  if (n1 < 5 || n2 < 5) return { z: 0, p: 1 };
  const p1 = k1/n1, p2 = k2/n2;
  const p = (k1+k2)/(n1+n2);
  const se = Math.sqrt(p*(1-p)*(1/n1+1/n2));
  if (se < 1e-9) return { z: 0, p: 0.5 };
  const z = (p1-p2)/se;
  // Approximate p-value from |z|
  const absZ = Math.abs(z);
  const p_approx = absZ > 3.29 ? '<0.001' : absZ > 2.58 ? '<0.010' : absZ > 1.96 ? '<0.050' : absZ > 1.64 ? '<0.100' : '≥0.100';
  return { z: z.toFixed(2), p: p_approx };
}

function bar(v, max=30) {
  const n = max > 0 ? Math.round(v/max*20) : 0;
  return '█'.repeat(Math.max(0,n)) + '░'.repeat(Math.max(0,20-n));
}

function pad(s, n, right=false) {
  s = String(s); return right ? s.padStart(n) : s.padEnd(n);
}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  FULL OOS + WALK-FORWARD ROBUSTNESS TEST  —  All 5 Param Sets');
console.log('  Engine: Fixed T2/T3 formula | Exact production param sets');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const allStocks = [];
for (const dir of DATA_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv')) continue;
    try {
      const c = parseCSV(path.join(dir, f));
      if (c.length < 200) continue;
      const atr = computeATR14(c);
      const sym = f.replace(/_NS_OHLCV\.csv$|_NSE_OHLCV\.csv$|\.csv$/i,'');
      allStocks.push({ sym, c, atr });
    } catch { /* skip bad files */ }
  }
}
// Deduplicate by sym
const seen = new Set();
const stocks = allStocks.filter(s => { if (seen.has(s.sym)) return false; seen.add(s.sym); return true; });
console.log(`Loaded ${stocks.length} stocks (min 200 candles)\n`);

// ─── RUN ALL TESTS PER PARAM SET ─────────────────────────────────────────────
const SUMMARY_ROWS = [];

for (const [key, P] of Object.entries(PARAM_SETS)) {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${pad(P.label, 70)} ║`);
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');

  // ── Collect all trades with index for splitting ──
  const allTrades = [];  // { ...result, globalIdx: number }

  for (const { sym, c, atr } of stocks) {
    const splitIdx = Math.floor(c.length * 0.60);
    let lastExit = -1;
    for (let i = 130; i < c.length - 21; i++) {
      if (i <= lastExit) continue;
      const sig = screenSignal(c, atr, i, P);
      if (!sig) continue;
      const r = simulateTrade(c, atr, i, sig.zone);
      allTrades.push({ ...r, i, sym, splitIdx: i < splitIdx ? 'IS' : 'OOS' });
      lastExit = i + Math.max(r.exitDay, 5);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1: 60/40 IS/OOS SPLIT
  // ══════════════════════════════════════════════════════════════════════
  const isTrades  = allTrades.filter(t => t.splitIdx === 'IS');
  const oosTrades = allTrades.filter(t => t.splitIdx === 'OOS');
  const isS  = stats(isTrades);
  const oosS = stats(oosTrades);
  const wrDrop = oosS.wr - isS.wr;
  const pnlDrop = oosS.avgPnl - isS.avgPnl;
  const zt = zTestWR(isS.n, Math.round(isS.n*isS.wr/100), oosS.n, Math.round(oosS.n*oosS.wr/100));
  const oosBoot = bootstrapWR(oosTrades);

  console.log('║  TEST 1: 60 / 40 CHRONOLOGICAL SPLIT                                    ║');
  console.log('║──────────────────────────────────────────────────────────────────────────║');
  console.log(`║  Metric            ${pad('IN-SAMPLE  (60%)',20)}   ${pad('OUT-OF-SAMPLE  (40%)',20)}    ║`);
  console.log(`║  Signals           ${pad(isS.n,20,'r')}   ${pad(oosS.n,20,'r')}    ║`);
  console.log(`║  Win Rate          ${pad(isS.wr.toFixed(1)+'%',20,'r')}   ${pad(oosS.wr.toFixed(1)+'%',20,'r')}    ║`);
  console.log(`║  Avg P&L           ${pad((isS.avgPnl>=0?'+':'')+isS.avgPnl.toFixed(2)+'%',20,'r')}   ${pad((oosS.avgPnl>=0?'+':'')+oosS.avgPnl.toFixed(2)+'%',20,'r')}    ║`);
  console.log(`║  Median P&L        ${pad((isS.medPnl>=0?'+':'')+isS.medPnl.toFixed(2)+'%',20,'r')}   ${pad((oosS.medPnl>=0?'+':'')+oosS.medPnl.toFixed(2)+'%',20,'r')}    ║`);
  console.log(`║  Profit Factor     ${pad(isS.pf>=100?'∞':isS.pf.toFixed(2),20,'r')}   ${pad(oosS.pf>=100?'∞':oosS.pf.toFixed(2),20,'r')}    ║`);
  console.log(`║  Max Drawdown      ${pad(isS.maxDD.toFixed(1)+'%',20,'r')}   ${pad(oosS.maxDD.toFixed(1)+'%',20,'r')}    ║`);
  console.log(`║  Sharpe (rough)    ${pad(isS.sharpe.toFixed(3),20,'r')}   ${pad(oosS.sharpe.toFixed(3),20,'r')}    ║`);
  console.log('║──────────────────────────────────────────────────────────────────────────║');
  console.log(`║  WR degradation:  ${(wrDrop>=0?'+':'')+wrDrop.toFixed(1)}pp   P&L degradation: ${(pnlDrop>=0?'+':'')+pnlDrop.toFixed(2)}%${' '.repeat(23)} ║`);
  console.log(`║  OOS Bootstrap CI:  ${oosBoot.lo.toFixed(1)}% – ${oosBoot.hi.toFixed(1)}% (95%)${' '.repeat(37)} ║`);
  console.log(`║  Z-test IS vs OOS WR:  z=${zt.z}  p=${zt.p}${' '.repeat(35)} ║`);

  let verdict1;
  if (oosS.n === 0) verdict1 = '⚠  NO OOS SIGNALS — too few signals for assessment';
  else if (wrDrop >= -8 && pnlDrop >= -1.0 && oosBoot.lo > 50) verdict1 = '✅ ROBUST — OOS holds up well, no collapse detected';
  else if (wrDrop >= -15 && pnlDrop >= -2.0) verdict1 = '🟡 MODERATE — slight WR softening, monitor in live trading';
  else if (wrDrop < -15 || oosBoot.lo < 50) verdict1 = '🔴 COLLAPSE — significant WR drop, possible overfitting';
  else verdict1 = '🟡 MODERATE — marginal concern';
  console.log(`║  VERDICT: ${pad(verdict1, 62)} ║`);

  // ══════════════════════════════════════════════════════════════════════
  // TEST 2: ANCHORED WALK-FORWARD (5 folds, expanding window)
  // ══════════════════════════════════════════════════════════════════════
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log('║  TEST 2: ANCHORED WALK-FORWARD  (train→F1–Fn, test→Fn+1)               ║');
  console.log('║──────────────────────────────────────────────────────────────────────────║');
  console.log('║  Fold  │ Train window │ Test window │ Sigs │  WR%   │ AvgP&L │  PF     ║');
  console.log('║────────┼──────────────┼─────────────┼──────┼────────┼────────┼─────────║');

  const FOLD_N = 5;
  const wfWRs = [];
  for (let f = 0; f < FOLD_N; f++) {
    const testFoldStart = (f + 1) / (FOLD_N + 1);   // e.g. 1/6 = 16.7%, 2/6 = 33.3%, ...
    const testFoldEnd   = (f + 2) / (FOLD_N + 1);
    // collect per-stock — each stock uses own length for fold boundaries
    const testTrades = [];
    for (const { sym, c, atr } of stocks) {
      const tStart = Math.floor(c.length * testFoldStart);
      const tEnd   = Math.floor(c.length * testFoldEnd);
      let lastExit = -1;
      for (let i = Math.max(130, tStart); i < Math.min(tEnd, c.length - 21); i++) {
        if (i <= lastExit) continue;
        const sig = screenSignal(c, atr, i, P);
        if (!sig) continue;
        const r = simulateTrade(c, atr, i, sig.zone);
        testTrades.push(r);
        lastExit = i + Math.max(r.exitDay, 5);
      }
    }
    const s = stats(testTrades);
    const tStartYr = testFoldStart < 1 ? `F${f+1}:${Math.round(testFoldStart*100)}%` : '';
    const tEndYr   = `–${Math.round(testFoldEnd*100)}%`;
    const pfStr = s.pf >= 100 ? '∞' : s.pf.toFixed(2);
    const trainLabel = `0–${Math.round(testFoldStart*100)}%`;
    const testLabel  = `${Math.round(testFoldStart*100)}–${Math.round(testFoldEnd*100)}%`;
    console.log(`║  WF${f+1}   │ ${pad(trainLabel,12)} │ ${pad(testLabel,11)} │ ${pad(s.n,4,'r')} │ ${pad(s.wr.toFixed(1)+'%',6,'r')} │ ${pad((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%',6,'r')} │ ${pad(pfStr,7,'r')} ║`);
    if (s.n > 0) wfWRs.push(s.wr);
  }
  if (wfWRs.length >= 3) {
    const wrRange = Math.max(...wfWRs) - Math.min(...wfWRs);
    const wrMean  = wfWRs.reduce((s,v)=>s+v,0)/wfWRs.length;
    const wrStd   = Math.sqrt(wfWRs.reduce((s,v)=>s+(v-wrMean)**2,0)/wfWRs.length);
    console.log('║────────┴──────────────┴─────────────┴──────┴────────┴────────┴─────────║');
    console.log(`║  WF WR range: ${wrRange.toFixed(0)}pp  │  WF WR mean: ${wrMean.toFixed(1)}%  │  WF WR σ: ${wrStd.toFixed(1)}pp${' '.repeat(12)} ║`);
    const wfVerdict = wrRange <= 25 ? '✅ CONSISTENT across windows' : wrRange <= 40 ? '🟡 MODERATE variance across windows' : '🔴 HIGH variance — regime dependent';
    console.log(`║  ${pad(wfVerdict, 70)} ║`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: PER-CALENDAR-YEAR BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log('║  TEST 3: PER-CALENDAR-YEAR BREAKDOWN                                    ║');
  console.log('║──────────────────────────────────────────────────────────────────────────║');
  console.log('║  Year  │ Sigs │  WR%   │  AvgP&L   │  PF    │ WR Bar (0 → 100%)        ║');
  console.log('║────────┼──────┼────────┼───────────┼────────┼──────────────────────────║');

  const byYear = {};
  for (const t of allTrades) {
    if (!byYear[t.year]) byYear[t.year] = [];
    byYear[t.year].push(t);
  }
  const yearWRs = [];
  for (const yr of Object.keys(byYear).sort()) {
    const s = stats(byYear[yr]);
    const pfStr = s.pf >= 100 ? '∞' : s.pf.toFixed(2);
    const wrBarStr = bar(s.wr, 100);
    console.log(`║  ${yr}  │ ${pad(s.n,4,'r')} │ ${pad(s.wr.toFixed(1)+'%',6,'r')} │ ${pad((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%',9,'r')} │ ${pad(pfStr,6,'r')} │ ${wrBarStr}      ║`);
    if (s.n >= 5) yearWRs.push(s.wr);
  }
  if (yearWRs.length >= 2) {
    const yrRange = Math.max(...yearWRs) - Math.min(...yearWRs);
    const yrVerdict = yrRange <= 25 ? '✅ STABLE year-to-year' : yrRange <= 40 ? '🟡 SOME year-to-year variation' : '🔴 LARGE year-to-year swings — market-regime sensitive';
    console.log('║──────────────────────────────────────────────────────────────────────────║');
    console.log(`║  Year WR range: ${yrRange.toFixed(0)}pp — ${pad(yrVerdict,52)} ║`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: EXIT MODEL BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════
  const statuses = { hit_t3:0, hit_t2:0, hit_t1:0, stopped:0, expired:0 };
  for (const t of allTrades) statuses[t.status] = (statuses[t.status]||0)+1;
  const total = allTrades.length || 1;
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log('║  TEST 4: EXIT MODEL BREAKDOWN (all trades)                              ║');
  console.log(`║  T3 (jackpot): ${pad((statuses.hit_t3/total*100).toFixed(1)+'%',6,'r')}  │  T2: ${pad((statuses.hit_t2/total*100).toFixed(1)+'%',6,'r')}  │  T1: ${pad((statuses.hit_t1/total*100).toFixed(1)+'%',6,'r')}  │  Stopped: ${pad((statuses.stopped/total*100).toFixed(1)+'%',6,'r')}  │  Expired: ${pad((statuses.expired/total*100).toFixed(1)+'%',5,'r')} ║`);

  // ══════════════════════════════════════════════════════════════════════
  // SUMMARY ROW
  // ══════════════════════════════════════════════════════════════════════
  SUMMARY_ROWS.push({
    key, label: P.label, total: allTrades.length,
    isWR: isS.wr, oosWR: oosS.wr, wrDrop, isAvg: isS.avgPnl, oosAvg: oosS.avgPnl,
    oosCIlo: oosBoot.lo, oosCIhi: oosBoot.hi,
    wfRange: wfWRs.length >= 2 ? Math.max(...wfWRs)-Math.min(...wfWRs) : null,
    yearRange: yearWRs.length >= 2 ? Math.max(...yearWRs)-Math.min(...yearWRs) : null,
    verdict: verdict1,
  });

  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');
}

// ─── FINAL COMPARISON TABLE ───────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  ROBUSTNESS SUMMARY — All 5 Param Sets');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log(`  ${'Param Set'.padEnd(22)} │ ${'Total'.padStart(5)} │ ${'IS WR'.padStart(6)} │ ${'OOS WR'.padStart(6)} │ ${'ΔWR'.padStart(6)} │ ${'OOS CI lo'.padStart(9)} │ ${'WF rng'.padStart(7)} │ ${'Yr rng'.padStart(6)} │ Status`);
console.log('  ' + '─'.repeat(100));
for (const r of SUMMARY_ROWS) {
  const delta = r.wrDrop >= 0 ? `+${r.wrDrop.toFixed(0)}pp` : `${r.wrDrop.toFixed(0)}pp`;
  const wfR = r.wfRange != null ? `${r.wfRange.toFixed(0)}pp` : 'n/a';
  const yrR = r.yearRange != null ? `${r.yearRange.toFixed(0)}pp` : 'n/a';
  const flag = r.wrDrop < -15 || r.oosCIlo < 50 ? '🔴' : r.wrDrop < -8 ? '🟡' : '✅';
  console.log(`  ${r.label.padEnd(22)} │ ${String(r.total).padStart(5)} │ ${r.isWR.toFixed(1).padStart(5)}% │ ${r.oosWR.toFixed(1).padStart(5)}% │ ${delta.padStart(6)} │ ${r.oosCIlo.toFixed(1).padStart(8)}% │ ${wfR.padStart(7)} │ ${yrR.padStart(6)} │ ${flag}`);
}
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('\nKey:  ΔWR = OOS − IS WR  |  WF rng = walk-forward WR range  |  Yr rng = calendar-year WR range');
console.log('      🔴 >15pp drop or CI<50%  |  🟡 8–15pp drop  |  ✅ <8pp drop, CI>50%\n');
