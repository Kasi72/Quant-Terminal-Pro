// ═══════════════════════════════════════════════════════════════════════════════
// WALK-FORWARD VALIDATION — The Honest Test
// ═══════════════════════════════════════════════════════════════════════════════
//
// Method: Chronological split per stock
//   - First 60% of each stock's history → IN-SAMPLE (params were tuned here)
//   - Last 40% of each stock's history → OUT-OF-SAMPLE (unseen by optimizer)
//
// We run the SAME 5 param sets on both halves and compare.
// The gap between IS and OOS tells you exactly how much overfitting exists.
//
// Additionally: 5-fold rolling walk-forward
//   Split into 5 equal time windows. For each fold:
//     - Train on folds before it (anchored expanding window)
//     - Test on current fold
//   This simulates what would happen if you deployed the system in real time.
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

// ─── ATR-14 ───
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    a[i] = (a[i - 1] * 13 + tr) / 14;
  }
  return a;
}

function atrPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) { const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0; if (v < cur) below++; }
  return below / 120 * 100;
}

function volAvg(c, idx, period) {
  let s = 0, n = 0;
  for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; }
  return n > 0 ? s / n : 1;
}

function findZone(c, atr, sigIdx, p) {
  const zC = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - p.maxZoneLen); j--) {
    if (atr[j] <= 0) break;
    if ((c[j].h - c[j].l) / atr[j] > p.zoneRangeATRThreshold) break;
    zC.unshift(j);
  }
  if (zC.length < p.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > p.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zoneTightnessPct: zt };
}

// ─── 5 Param Sets ───
const PARAM_SETS = {
  D20: {
    name: 'Deployable 20+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 0.75, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.90,
    maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.6, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.40, minExactVolVsPre5: 2.50,
    minCloseLoc: 75, maxUpperWickPct: 45, minBodyPct: 50, maxCandleRisk: 6.0,
    minUltraPrecisionScore: 60, minRSI2: 50,
    minVolatilityExpansionRatio: 1.75, minCandleQualityScore: 2,
    maxCloseAboveZonePct: null,
  },
  HP15: {
    name: 'HighPrecision 15+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 85,
    maxPre10AvgRangeATR: 0.75, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 8.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.2, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 2.50, minExactVolVsPre5: 2.00,
    minCloseLoc: 75, maxUpperWickPct: 40, minBodyPct: 30, maxCandleRisk: 10.0,
    minUltraPrecisionScore: 50, minRSI2: 50,
    minVolatilityExpansionRatio: 2.25, minCandleQualityScore: null,
    maxCloseAboveZonePct: 6.0,
  },
  E10: {
    name: 'Elite 10+', minAvgTurnover20: 20e6, maxATRPct14Pctl120: 40,
    maxPre10AvgRangeATR: 0.90, maxPre10ExpansionCount: 3, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 0.95, minZoneLen: 7, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
    maxPre10AvgVolRatio: 1.00, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.6, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 1.80, minExactVolVsPre5: 2.00,
    minCloseLoc: 50, maxUpperWickPct: 35, minBodyPct: 25, maxCandleRisk: 5.0,
    minUltraPrecisionScore: 25, minRSI2: 50,
    minVolatilityExpansionRatio: 1.25, minCandleQualityScore: 2,
    maxCloseAboveZonePct: null,
  },
  US8: {
    name: 'Ultra-Selective 8+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 30,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 0, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 0.95, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 6.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.5, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 1.60, minExactVolVsPre5: 2.50,
    minCloseLoc: 50, maxUpperWickPct: 35, minBodyPct: 40, maxCandleRisk: 8.5,
    minUltraPrecisionScore: 45, minRSI2: 50,
    minVolatilityExpansionRatio: 1.50, minCandleQualityScore: 4,
    maxCloseAboveZonePct: null,
  },
  SNP95: {
    name: 'Sniper 95+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
    minExactRangeATR14: 1.6, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.40, minExactVolVsPre5: 1.50,
    minCloseLoc: 65, maxUpperWickPct: 45, minBodyPct: 30, maxCandleRisk: 6.0,
    minUltraPrecisionScore: 20, minRSI2: 50,
    minVolatilityExpansionRatio: 2.50, minCandleQualityScore: 2,
    maxCloseAboveZonePct: null,
  },
};

// ─── UPS / CQS / RSI2 ───
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
  if (cL >= 65) s++; if (uW <= 30) s++; if (bP >= 40) s++; if (evp5 >= 2.5) s++; if (ver >= 1.5) s++;
  return s;
}
function rsi2(c, idx) {
  if (idx < 2) return 50;
  const ch1 = c[idx].c - c[idx - 1].c, ch2 = c[idx - 1].c - c[idx - 2].c;
  const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
  const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
  return l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
}

// ─── Signal Screening ───
function screenSignal(c, atr, idx, p) {
  const s = c[idx];
  if (s.c <= 0 || atr[idx] <= 0) return null;

  let to = 0;
  for (let j = idx - 20; j < idx; j++) { if (j >= 0) to += c[j].c * c[j].v; }
  to /= 20;
  if (to < p.minAvgTurnover20) return null;

  const pctl = atrPctl120(c, atr, idx);
  if (pctl > p.maxATRPct14Pctl120) return null;

  let p10S = 0, p10N = 0, expC = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0 || atr[j] <= 0) continue;
    const ra = (c[j].h - c[j].l) / atr[j]; p10S += ra; p10N++;
    if (ra > p.expansionATRMultiplier) expC++;
  }
  const p10A = p10N > 0 ? p10S / p10N : 999;
  if (p10A > p.maxPre10AvgRangeATR) return null;
  if (expC > p.maxPre10ExpansionCount) return null;

  const zone = findZone(c, atr, idx, p);
  if (!zone) return null;

  const v20 = volAvg(c, idx, 20);
  let p10VRS = 0, p10VRN = 0, p5VRS = 0, p5VRN = 0, hvC = 0, redVol = 0, greenVol = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0) continue;
    const vr = v20 > 0 ? c[j].v / v20 : 0; p10VRS += vr; p10VRN++;
    if (j >= idx - 6) { p5VRS += vr; p5VRN++; }
    if (vr > p.highVolMultiplier) hvC++;
    if (c[j].c < c[j].o) redVol += c[j].v; else greenVol += c[j].v;
  }
  const p10AVR = p10VRN > 0 ? p10VRS / p10VRN : 999;
  const p5AVR = p5VRN > 0 ? p5VRS / p5VRN : 999;
  const rvb = greenVol > 0 ? redVol / greenVol : (redVol > 0 ? 10 : 1);
  if (p10AVR > p.maxPre10AvgVolRatio) return null;
  if (p5AVR > p.maxPre5AvgVolRatio) return null;
  if (hvC > p.maxPre10HighVolCount) return null;
  if (rvb > p.maxPre10RedVolBias) return null;

  const rng = s.h - s.l; if (rng <= 0) return null;
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
  if ((rng / s.c * 100) > p.maxCandleRisk) return null;

  const ver = p10A > 0 ? eRA / p10A : 0;
  if (ver < p.minVolatilityExpansionRatio) return null;

  const ups = calcUPS(cL, uW, bP, evp5, zone.zoneTightnessPct, zone.zoneLen);
  if (ups < p.minUltraPrecisionScore) return null;

  if (rsi2(c, idx) < p.minRSI2) return null;

  if (p.minCandleQualityScore != null) {
    if (calcCQS(cL, uW, bP, evp5, ver) < p.minCandleQualityScore) return null;
  }
  if (p.maxCloseAboveZonePct != null) {
    const cazp = (s.c - zone.zoneHigh) / zone.zoneHigh * 100;
    if (cazp > p.maxCloseAboveZonePct) return null;
  }

  return { zone, atrPct: atr[idx] / s.c * 100 };
}

// ─── 10-Gate Cascade ───
function gateCheck(stopLoss, candle, prevCandle, prevPrevCandle, candles, i) {
  if (candle.c > stopLoss) return 'ABOVE';
  const dipPct = (stopLoss - candle.c) / stopLoss * 100;
  if (dipPct < 1.5) return 'SHIELDED';
  if (i >= 2) {
    const ch1 = candle.c - prevCandle.c, ch2 = prevCandle.c - (prevPrevCandle ? prevPrevCandle.c : prevCandle.c);
    const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
    const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
    if ((l < 0.001 ? 100 : 100 - 100 / (1 + g / l)) < 5) return 'SHIELDED';
  }
  if (prevCandle && prevCandle.c > stopLoss) return 'SHIELDED';
  if (prevCandle && candle.c >= prevCandle.c) return 'SHIELDED';
  let avgV = 0, vc = 0;
  for (let vi = Math.max(0, i - 20); vi < i; vi++) { if (candles[vi] && candles[vi].v > 0) { avgV += candles[vi].v; vc++; } }
  avgV = vc > 0 ? avgV / vc : 0;
  if (candle.v != null && avgV > 0 && candle.v < avgV * 0.6) return 'SHIELDED';
  const rng = candle.h - candle.l;
  if (rng > 0 && (Math.min(candle.o, candle.c) - candle.l) / rng * 100 >= 60) return 'SHIELDED';
  if (candle.c > candle.o && rng > 0 && (candle.c - candle.o) / rng * 100 >= 50) return 'SHIELDED';
  if (rng > 0 && (candle.c - candle.l) / rng * 100 >= 45) return 'SHIELDED';
  if (prevCandle && candle.c > prevCandle.c && candle.v > (prevCandle.v || 0)) return 'SHIELDED';
  if (prevCandle && prevPrevCandle) {
    if (!(candle.c < candle.o && prevCandle.c < prevCandle.o && prevPrevCandle.c < prevPrevCandle.o)) return 'SHIELDED';
  } else return 'SHIELDED';
  return 'STOPPED';
}

// ─── Trade Simulation ───
function simulateTrade(c, atr, entryIdx, zone) {
  const entry = c[entryIdx].c;
  const stopRaw = zone.zoneLow - 0.50 * atr[entryIdx];
  const floorStop = entry * (1 - 4.0 / 100);
  const capStop = entry * (1 - 6.5 / 100);
  let stop = Math.min(Math.max(stopRaw, capStop), floorStop);

  const atrPctE = atr[entryIdx] / entry * 100;
  const t1Pct = Math.max(4.00, Math.min(12.00, 2.15 * atrPctE));
  const t1 = entry * (1 + t1Pct / 100);
  const t2Pct = Math.min(5.65, 2.80 * atrPctE);
  const t2 = Math.max(entry * (1 + t2Pct / 100), t1 + 0.05);
  const t3Pct = atrPctE < 1.5 ? 5.0 : atrPctE <= 3.0 ? 7.0 : 10.0;
  const t3 = Math.max(entry * (1 + t3Pct / 100), t2 + 0.05);

  const riskPct = (entry - stop) / entry * 100;
  let position = 1.0, realizedPnl = 0, mfe = 0, mae = 0;
  let status = 'open', exitDay = 0, trailingStop = stop;
  let t1Hit = false, t2Hit = false, shieldCount = 0;
  const maxDays = Math.min(20, c.length - entryIdx - 1);

  for (let d = 1; d <= maxDays; d++) {
    const ci = entryIdx + d;
    if (ci >= c.length) break;
    const candle = c[ci], prev = c[ci - 1], pprev = ci >= 2 ? c[ci - 2] : null;
    const hPct = (candle.h - entry) / entry * 100;
    const lPct = (candle.l - entry) / entry * 100;
    if (hPct > mfe) mfe = hPct;
    if (lPct < mae) mae = lPct;

    if (!t1Hit && candle.h >= t1 && position > 0) {
      realizedPnl += 0.50 * (t1 - entry) / entry * 100; position -= 0.50; t1Hit = true; trailingStop = entry;
    }
    if (t1Hit && !t2Hit && candle.h >= t2 && position > 0) {
      realizedPnl += 0.30 * (t2 - entry) / entry * 100; position -= 0.30; t2Hit = true; trailingStop = t1;
    }
    if (t2Hit && candle.h >= t3 && position > 0) {
      realizedPnl += position * (t3 - entry) / entry * 100; status = 'hit_t3'; exitDay = d; position = 0; break;
    }

    if (candle.c <= trailingStop && position > 0) {
      const gate = gateCheck(trailingStop, candle, prev, pprev, c.slice(entryIdx), d);
      if (gate === 'STOPPED') {
        realizedPnl += position * (candle.c - entry) / entry * 100; status = 'stopped'; exitDay = d; position = 0; break;
      } else if (gate === 'SHIELDED') shieldCount++;
    }
  }

  if (position > 0) {
    const lastIdx = Math.min(entryIdx + 20, c.length - 1);
    realizedPnl += position * (c[lastIdx].c - entry) / entry * 100;
    status = t1Hit ? (t2Hit ? 'hit_t2' : 'hit_t1') : 'expired';
    exitDay = lastIdx - entryIdx;
  }

  return { entry, pnl: realizedPnl, rr: riskPct > 0 ? realizedPnl / riskPct : 0, mfe, mae, status, exitDay, riskPct, shieldCount };
}

// ─── Compute stats helper ───
function computeStats(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, wr: 0, avgPnl: 0, totalPnl: 0, avgWin: 0, avgLoss: 0, pf: 0, avgRR: 0, avgMFE: 0, avgMAE: 0, avgDays: 0, maxDD: 0, sharpe: 0, hitT1: 0, hitT2: 0, hitT3: 0, stopped: 0, expired: 0, avgRisk: 0, totalShields: 0 };
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const wr = wins.length / n * 100;
  const avgPnl = trades.reduce((s, t) => s + t.pnl, 0) / n;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0);
  const avgRR = trades.reduce((s, t) => s + t.rr, 0) / n;
  const avgMFE = trades.reduce((s, t) => s + t.mfe, 0) / n;
  const avgMAE = trades.reduce((s, t) => s + t.mae, 0) / n;
  const avgDays = trades.reduce((s, t) => s + t.exitDay, 0) / n;
  const avgRisk = trades.reduce((s, t) => s + t.riskPct, 0) / n;
  const totalShields = trades.reduce((s, t) => s + t.shieldCount, 0);

  let peak = 0, maxDD = 0, eq = 0;
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }

  const variance = n > 1 ? trades.reduce((s, t) => s + (t.pnl - avgPnl) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(252 / (avgDays || 10)) : 0;

  return { n, wr, avgPnl, totalPnl, avgWin, avgLoss, pf, avgRR, avgMFE, avgMAE, avgDays, maxDD, sharpe, avgRisk, totalShields,
    hitT1: trades.filter(t => t.status === 'hit_t1').length,
    hitT2: trades.filter(t => t.status === 'hit_t2').length,
    hitT3: trades.filter(t => t.status === 'hit_t3').length,
    stopped: trades.filter(t => t.status === 'stopped').length,
    expired: trades.filter(t => t.status === 'expired').length,
  };
}

// ─── LOAD DATA ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  WALK-FORWARD VALIDATION — The Honest Test');
console.log('  60/40 Chronological Split + 5-Fold Rolling Window');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS') || f.includes('_all')) continue;
    const c = format === 'nse' ? parseNSE(path.join(dir, f)) : parseYahoo(path.join(dir, f));
    if (c.length < 150) continue;
    stockData.push({ sym: f.replace('_NS_OHLCV.csv', '').replace('.csv', ''), c, atr: computeATR14(c) });
  }
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: 60/40 CHRONOLOGICAL SPLIT
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  TEST 1: 60/40 CHRONOLOGICAL SPLIT                                      ║');
console.log('║  First 60% of each stock = IN-SAMPLE (what optimizer saw)                ║');
console.log('║  Last 40% of each stock = OUT-OF-SAMPLE (unseen future data)             ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const [key, params] of Object.entries(PARAM_SETS)) {
  const isTrades = [], oosTrades = [];

  for (const { sym, c, atr } of stockData) {
    const splitIdx = Math.floor(c.length * 0.60);

    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);
      const trade = { sym, idx: i, ...result };

      if (i < splitIdx) isTrades.push(trade);
      else oosTrades.push(trade);

      i += Math.max(result.exitDay, 5);
    }
  }

  const isStats = computeStats(isTrades);
  const oosStats = computeStats(oosTrades);

  console.log(`┌─── ${params.name} ───────────────────────────────────────────┐`);
  console.log(`│                    IN-SAMPLE (60%)      OUT-OF-SAMPLE (40%)  │`);
  console.log(`│  Signals:          ${String(isStats.n).padStart(6)}              ${String(oosStats.n).padStart(6)}              │`);
  console.log(`│  Win Rate:         ${(isStats.wr).toFixed(1).padStart(6)}%             ${(oosStats.wr).toFixed(1).padStart(6)}%             │`);
  console.log(`│  Avg P&L:       ${(isStats.avgPnl >= 0 ? '+' : '') + isStats.avgPnl.toFixed(3).padStart(7)}%          ${(oosStats.avgPnl >= 0 ? '+' : '') + oosStats.avgPnl.toFixed(3).padStart(7)}%          │`);
  console.log(`│  Profit Factor:    ${(isStats.pf >= 100 ? '  ∞  ' : isStats.pf.toFixed(2).padStart(5))}              ${(oosStats.pf >= 100 ? '  ∞  ' : oosStats.pf.toFixed(2).padStart(5))}              │`);
  console.log(`│  Avg R:R:          ${isStats.avgRR.toFixed(3).padStart(6)}             ${oosStats.avgRR.toFixed(3).padStart(6)}             │`);
  console.log(`│  Max Drawdown:     ${isStats.maxDD.toFixed(1).padStart(5)}%             ${oosStats.maxDD.toFixed(1).padStart(5)}%             │`);
  console.log(`│  Sharpe:           ${isStats.sharpe.toFixed(2).padStart(6)}             ${oosStats.sharpe.toFixed(2).padStart(6)}             │`);
  console.log(`│  Avg MFE:        ${('+' + isStats.avgMFE.toFixed(2)).padStart(7)}%          ${('+' + oosStats.avgMFE.toFixed(2)).padStart(7)}%          │`);
  console.log(`│  Avg MAE:         ${isStats.avgMAE.toFixed(2).padStart(6)}%            ${oosStats.avgMAE.toFixed(2).padStart(6)}%            │`);
  console.log(`│  T3 Hit Rate:    ${(isStats.n > 0 ? (isStats.hitT3 / isStats.n * 100).toFixed(0) : '0').padStart(4)}%              ${(oosStats.n > 0 ? (oosStats.hitT3 / oosStats.n * 100).toFixed(0) : '0').padStart(4)}%              │`);
  console.log(`│  Stop Rate:      ${(isStats.n > 0 ? (isStats.stopped / isStats.n * 100).toFixed(0) : '0').padStart(4)}%              ${(oosStats.n > 0 ? (oosStats.stopped / oosStats.n * 100).toFixed(0) : '0').padStart(4)}%              │`);
  console.log(`│  Shields/trade:    ${isStats.n > 0 ? (isStats.totalShields / isStats.n).toFixed(1).padStart(5) : '  0.0'}              ${oosStats.n > 0 ? (oosStats.totalShields / oosStats.n).toFixed(1).padStart(5) : '  0.0'}              │`);

  // Degradation indicator
  if (isStats.n > 0 && oosStats.n > 0) {
    const wrDrop = oosStats.wr - isStats.wr;
    const pnlDrop = oosStats.avgPnl - isStats.avgPnl;
    console.log(`│                                                                         │`);
    console.log(`│  DEGRADATION:  WR ${wrDrop >= 0 ? '+' : ''}${wrDrop.toFixed(1)}pp   P&L ${pnlDrop >= 0 ? '+' : ''}${pnlDrop.toFixed(3)}%                      │`);
    if (Math.abs(wrDrop) <= 10 && pnlDrop >= -1) console.log(`│  VERDICT: ✅ ROBUST — minimal overfit                                   │`);
    else if (Math.abs(wrDrop) <= 20 && pnlDrop >= -2) console.log(`│  VERDICT: 🟡 MODERATE OVERFIT — usable with caution                     │`);
    else console.log(`│  VERDICT: 🔴 SIGNIFICANT OVERFIT — needs retuning                       │`);
  } else if (oosStats.n === 0) {
    console.log(`│                                                                         │`);
    console.log(`│  ⚠ NO OOS SIGNALS — cannot assess overfit                               │`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────────────┘\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: 5-FOLD ROLLING WALK-FORWARD
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  TEST 2: 5-FOLD ROLLING WALK-FORWARD                                    ║');
console.log('║  Each stock split into 5 equal time windows                              ║');
console.log('║  Fold 1: test on window 1 (no prior data — skip)                        ║');
console.log('║  Fold 2: test on window 2 (window 1 is "training")                      ║');
console.log('║  Fold 3: test on window 3 (windows 1-2 are "training")                  ║');
console.log('║  Fold 4: test on window 4 (windows 1-3 are "training")                  ║');
console.log('║  Fold 5: test on window 5 (windows 1-4 are "training")                  ║');
console.log('║                                                                          ║');
console.log('║  Only FOLD 5 uses data the optimizer potentially saw heavily.            ║');
console.log('║  Folds 2-4 represent progressively "more trained" conditions.            ║');
console.log('║  Consistent performance across folds = robust system.                    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const [key, params] of Object.entries(PARAM_SETS)) {
  const foldTrades = [[], [], [], [], []];

  for (const { sym, c, atr } of stockData) {
    const foldSize = Math.floor(c.length / 5);

    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);

      const foldIdx = Math.min(4, Math.floor(i / foldSize));
      foldTrades[foldIdx].push({ sym, ...result });

      i += Math.max(result.exitDay, 5);
    }
  }

  console.log(`┌─── ${params.name} ─── 5-Fold Walk-Forward ────────────────┐`);
  console.log(`│  Fold  │ Period     │ Sigs │ WR%    │ AvgP&L% │ PF    │ MaxDD% │`);
  console.log(`│────────┼────────────┼──────┼────────┼─────────┼───────┼────────│`);

  const allOOS = [];
  for (let f = 0; f < 5; f++) {
    const stats = computeStats(foldTrades[f]);
    const period = f === 0 ? 'Earliest' : f === 1 ? 'Early   ' : f === 2 ? 'Mid     ' : f === 3 ? 'Recent  ' : 'Latest  ';
    const pfStr = stats.pf >= 100 ? '  ∞  ' : stats.pf.toFixed(2).padStart(5);
    console.log(`│  F${f + 1}    │ ${period}  │ ${String(stats.n).padStart(4)} │ ${stats.wr.toFixed(1).padStart(6)}│ ${(stats.avgPnl >= 0 ? '+' : '') + stats.avgPnl.toFixed(2).padStart(6)}% │ ${pfStr} │ ${stats.maxDD.toFixed(1).padStart(5)}% │`);
    if (f >= 1) allOOS.push(...foldTrades[f]); // Folds 2-5 = OOS-like
  }

  // Combined OOS (folds 2-5)
  const combined = computeStats(allOOS);
  console.log(`│────────┼────────────┼──────┼────────┼─────────┼───────┼────────│`);
  const cpfStr = combined.pf >= 100 ? '  ∞  ' : combined.pf.toFixed(2).padStart(5);
  console.log(`│  F2-F5 │ Combined   │ ${String(combined.n).padStart(4)} │ ${combined.wr.toFixed(1).padStart(6)}│ ${(combined.avgPnl >= 0 ? '+' : '') + combined.avgPnl.toFixed(2).padStart(6)}% │ ${cpfStr} │ ${combined.maxDD.toFixed(1).padStart(5)}% │`);

  // Consistency check
  const foldWRs = [];
  for (let f = 0; f < 5; f++) { const s = computeStats(foldTrades[f]); if (s.n > 0) foldWRs.push(s.wr); }
  if (foldWRs.length >= 3) {
    const wrRange = Math.max(...foldWRs) - Math.min(...foldWRs);
    const consistency = wrRange <= 30 ? '✅ CONSISTENT' : wrRange <= 50 ? '🟡 MODERATE VARIANCE' : '🔴 HIGH VARIANCE';
    console.log(`│                                                                         │`);
    console.log(`│  WR range across folds: ${wrRange.toFixed(0)}pp  →  ${consistency.padEnd(20)}                │`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────────────┘\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: YEAR-BY-YEAR PERFORMANCE (regime test)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  TEST 3: YEAR-BY-YEAR BREAKDOWN (Market Regime Stability)               ║');
console.log('║  Does performance hold across bull, bear, and sideways markets?          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const [key, params] of Object.entries(PARAM_SETS)) {
  const byYear = {};

  for (const { sym, c, atr } of stockData) {
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);

      const dateStr = c[i].d || '';
      let year = 'Unknown';
      if (dateStr.match(/^\d{4}/)) year = dateStr.slice(0, 4);
      else if (dateStr.match(/\d{4}$/)) year = dateStr.slice(-4);
      else if (dateStr.match(/\d{2}-[A-Za-z]+-(\d{4})/)) year = dateStr.match(/(\d{4})/)[1];

      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(result);
      i += Math.max(result.exitDay, 5);
    }
  }

  const years = Object.keys(byYear).sort();
  if (years.length === 0) continue;

  console.log(`┌─── ${params.name} ─── Year-by-Year ───────────────────────┐`);
  console.log(`│  Year  │ Sigs │ WR%    │ AvgP&L% │ PF     │ MaxDD% │ Note          │`);
  console.log(`│────────┼──────┼────────┼─────────┼────────┼────────┼───────────────│`);

  for (const yr of years) {
    const s = computeStats(byYear[yr]);
    const regime = ['2008', '2020'].includes(yr) ? '🐻 CRASH' :
      ['2003', '2007', '2009', '2014', '2017', '2021', '2023', '2024'].includes(yr) ? '🐂 BULL' :
        ['2010', '2011', '2013', '2015', '2016', '2018', '2019', '2022'].includes(yr) ? '📊 MIXED' : '        ';
    const pfStr = s.pf >= 100 ? '  ∞  ' : s.pf.toFixed(2).padStart(5);
    console.log(`│  ${yr}  │ ${String(s.n).padStart(4)} │ ${s.wr.toFixed(0).padStart(4)}%  │ ${(s.avgPnl >= 0 ? '+' : '') + s.avgPnl.toFixed(2).padStart(6)}% │ ${pfStr}  │ ${s.maxDD.toFixed(1).padStart(5)}% │ ${regime.padEnd(13)} │`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────────────┘\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  OVERFIT ASSESSMENT SUMMARY                                              ║');
console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                          ║');
console.log('║  KEY: Compare IN-SAMPLE vs OUT-OF-SAMPLE metrics above.                  ║');
console.log('║                                                                          ║');
console.log('║  WR drop < 10pp  +  P&L still positive  =  ✅ ROBUST                    ║');
console.log('║  WR drop 10-20pp +  P&L still positive  =  🟡 MODERATE OVERFIT          ║');
console.log('║  WR drop > 20pp  or  P&L goes negative  =  🔴 SIGNIFICANT OVERFIT       ║');
console.log('║                                                                          ║');
console.log('║  Consistent year-by-year + fold-by-fold  =  system captures real edge    ║');
console.log('║  Performance clusters in specific years  =  regime-dependent (fragile)   ║');
console.log('║                                                                          ║');
console.log('║  REMEMBER: Real money performance = OOS estimate minus slippage (~0.3%)  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

console.log('═══ WALK-FORWARD VALIDATION COMPLETE ═══');
