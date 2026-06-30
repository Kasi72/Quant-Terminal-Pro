// ═══════════════════════════════════════════════════════════════════════════════
// NIFTY 500 BACKTEST — 470 stocks × 5 param sets
// Full bar-by-bar: entry, stop (ZoneLow-0.5×ATR [4%,6.5%] CLOSE-ONLY),
// T1/T2/T3 partial exits (50/30/20), 20-day expiry, 10-gate cascade
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

const PARAM_SETS = {
  D20: { name: 'Deployable 20+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50, maxPre10AvgRangeATR: 0.75, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1, zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 15.0, maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.90, maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00, minExactRangeATR14: 1.6, maxExactRangeATR14: 5.0, minExactVolRatio20: 1.40, minExactVolVsPre5: 2.50, minCloseLoc: 75, maxUpperWickPct: 45, minBodyPct: 50, maxCandleRisk: 6.0, minUltraPrecisionScore: 60, minRSI2: 50, minVolatilityExpansionRatio: 1.75, minCandleQualityScore: 2, maxCloseAboveZonePct: null },
  HP15: { name: 'HighPrecision 15+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 85, maxPre10AvgRangeATR: 0.75, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1, zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 8.0, maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10, maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00, minExactRangeATR14: 1.2, maxExactRangeATR14: 5.0, minExactVolRatio20: 2.50, minExactVolVsPre5: 2.00, minCloseLoc: 75, maxUpperWickPct: 40, minBodyPct: 30, maxCandleRisk: 10.0, minUltraPrecisionScore: 50, minRSI2: 50, minVolatilityExpansionRatio: 2.25, minCandleQualityScore: null, maxCloseAboveZonePct: 6.0 },
  E10: { name: 'Elite 10+', minAvgTurnover20: 20e6, maxATRPct14Pctl120: 40, maxPre10AvgRangeATR: 0.90, maxPre10ExpansionCount: 3, expansionATRMultiplier: 1.1, zoneRangeATRThreshold: 0.95, minZoneLen: 7, maxZoneLen: 25, maxZoneTightnessPct: 15.0, maxPre10AvgVolRatio: 1.00, maxPre5AvgVolRatio: 1.10, maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 2.00, minExactRangeATR14: 1.6, maxExactRangeATR14: 6.0, minExactVolRatio20: 1.80, minExactVolVsPre5: 2.00, minCloseLoc: 50, maxUpperWickPct: 35, minBodyPct: 25, maxCandleRisk: 5.0, minUltraPrecisionScore: 25, minRSI2: 50, minVolatilityExpansionRatio: 1.25, minCandleQualityScore: 2, maxCloseAboveZonePct: null },
  US8: { name: 'Ultra-Selective 8+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 30, maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 0, expansionATRMultiplier: 1.1, zoneRangeATRThreshold: 0.95, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 6.0, maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95, maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 2.00, minExactRangeATR14: 1.5, maxExactRangeATR14: 6.0, minExactVolRatio20: 1.60, minExactVolVsPre5: 2.50, minCloseLoc: 50, maxUpperWickPct: 35, minBodyPct: 40, maxCandleRisk: 8.5, minUltraPrecisionScore: 45, minRSI2: 50, minVolatilityExpansionRatio: 1.50, minCandleQualityScore: 4, maxCloseAboveZonePct: null },
  SNP95: { name: 'Sniper 95+', minAvgTurnover20: 10e6, maxATRPct14Pctl120: 50, maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1, zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0, maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10, maxPre10HighVolCount: 0, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00, minExactRangeATR14: 1.6, maxExactRangeATR14: 5.0, minExactVolRatio20: 1.40, minExactVolVsPre5: 1.50, minCloseLoc: 65, maxUpperWickPct: 45, minBodyPct: 30, maxCandleRisk: 6.0, minUltraPrecisionScore: 20, minRSI2: 50, minVolatilityExpansionRatio: 2.50, minCandleQualityScore: 2, maxCloseAboveZonePct: null },
};

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
  let s = 0; if (cL >= 65) s++; if (uW <= 30) s++; if (bP >= 40) s++; if (evp5 >= 2.5) s++; if (ver >= 1.5) s++; return s;
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
  if (s.c <= 0 || atr[idx] <= 0) return null;
  let to = 0; for (let j = idx - 20; j < idx; j++) { if (j >= 0) to += c[j].c * c[j].v; } to /= 20;
  if (to < p.minAvgTurnover20) return null;
  const pctl = atrPctl120(c, atr, idx);
  if (pctl > p.maxATRPct14Pctl120) return null;
  let p10S = 0, p10N = 0, expC = 0;
  for (let j = idx - 11; j < idx - 1; j++) { if (j < 0 || atr[j] <= 0) continue; const ra = (c[j].h - c[j].l) / atr[j]; p10S += ra; p10N++; if (ra > p.expansionATRMultiplier) expC++; }
  const p10A = p10N > 0 ? p10S / p10N : 999;
  if (p10A > p.maxPre10AvgRangeATR) return null;
  if (expC > p.maxPre10ExpansionCount) return null;
  const zone = findZone(c, atr, idx, p);
  if (!zone) return null;
  const v20 = volAvg(c, idx, 20);
  let p10VRS = 0, p10VRN = 0, p5VRS = 0, p5VRN = 0, hvC = 0, redVol = 0, greenVol = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0) continue; const vr = v20 > 0 ? c[j].v / v20 : 0; p10VRS += vr; p10VRN++;
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
  if (p.minCandleQualityScore != null) { if (calcCQS(cL, uW, bP, evp5, ver) < p.minCandleQualityScore) return null; }
  if (p.maxCloseAboveZonePct != null) { if ((s.c - zone.zoneHigh) / zone.zoneHigh * 100 > p.maxCloseAboveZonePct) return null; }
  return { zone };
}

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
    const ci = entryIdx + d; if (ci >= c.length) break;
    const candle = c[ci], prev = c[ci - 1], pprev = ci >= 2 ? c[ci - 2] : null;
    const hPct = (candle.h - entry) / entry * 100;
    const lPct = (candle.l - entry) / entry * 100;
    if (hPct > mfe) mfe = hPct; if (lPct < mae) mae = lPct;
    if (!t1Hit && candle.h >= t1 && position > 0) { realizedPnl += 0.50 * (t1 - entry) / entry * 100; position -= 0.50; t1Hit = true; trailingStop = entry; }
    if (t1Hit && !t2Hit && candle.h >= t2 && position > 0) { realizedPnl += 0.30 * (t2 - entry) / entry * 100; position -= 0.30; t2Hit = true; trailingStop = t1; }
    if (t2Hit && candle.h >= t3 && position > 0) { realizedPnl += position * (t3 - entry) / entry * 100; status = 'hit_t3'; exitDay = d; position = 0; break; }
    if (candle.c <= trailingStop && position > 0) {
      const gate = gateCheck(trailingStop, candle, prev, pprev, c.slice(entryIdx), d);
      if (gate === 'STOPPED') { realizedPnl += position * (candle.c - entry) / entry * 100; status = 'stopped'; exitDay = d; position = 0; break; }
      else if (gate === 'SHIELDED') shieldCount++;
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

// ─── LOAD ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  NIFTY 500 BACKTEST — 470 stocks × 5 Param Sets');
console.log('  COMPLETELY UNSEEN DATA (params were tuned on 77 different stocks)');
console.log('  This is the TRUE out-of-sample test');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
for (const f of files) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 150) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks (${files.length} files, ${files.length - stockData.length} skipped <150 candles)\n`);

// ─── RUN ───
for (const [key, params] of Object.entries(PARAM_SETS)) {
  const trades = [];
  let stocksWithSignals = 0;

  for (const { sym, c, atr } of stockData) {
    let hadSignal = false;
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      hadSignal = true;
      const result = simulateTrade(c, atr, i, sig.zone);
      trades.push({ sym, date: c[i].d, ...result });
      i += Math.max(result.exitDay, 5);
    }
    if (hadSignal) stocksWithSignals++;
  }

  const n = trades.length;
  if (n === 0) { console.log(`\n${params.name}: 0 signals\n`); continue; }

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
  const hitT1 = trades.filter(t => t.status === 'hit_t1').length;
  const hitT2 = trades.filter(t => t.status === 'hit_t2').length;
  const hitT3 = trades.filter(t => t.status === 'hit_t3').length;
  const stopped = trades.filter(t => t.status === 'stopped').length;
  const expired = trades.filter(t => t.status === 'expired').length;

  let peak = 0, maxDD = 0, eq = 0;
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }

  const variance = n > 1 ? trades.reduce((s, t) => s + (t.pnl - avgPnl) ** 2, 0) / (n - 1) : 0;
  const sharpe = Math.sqrt(variance) > 0 ? (avgPnl / Math.sqrt(variance)) * Math.sqrt(252 / (avgDays || 10)) : 0;

  const best = trades.reduce((b, t) => t.pnl > b.pnl ? t : b, trades[0]);
  const worst = trades.reduce((w, t) => t.pnl < w.pnl ? t : w, trades[0]);

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${params.name.padEnd(40)}  Signals: ${String(n).padStart(5)}  ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Stocks with signals: ${stocksWithSignals}/${stockData.length}`);
  console.log(`║  WIN RATE:        ${wr.toFixed(1)}%  (${wins.length} wins / ${losses.length} losses)`);
  console.log(`║  Avg P&L:         ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(3)}%`);
  console.log(`║  Total P&L:       ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`);
  console.log(`║  Avg Win:         +${avgWin.toFixed(3)}%    Avg Loss: ${avgLoss.toFixed(3)}%`);
  console.log(`║  Profit Factor:   ${pf >= 100 ? '∞' : pf.toFixed(2)}`);
  console.log(`║  Avg R:R:         ${avgRR.toFixed(3)}     Avg Risk: ${avgRisk.toFixed(2)}%`);
  console.log(`║  Sharpe Ratio:    ${sharpe.toFixed(2)}`);
  console.log(`║  Max Drawdown:    ${maxDD.toFixed(2)}%`);
  console.log(`║  EXIT: T1=${hitT1}(${(hitT1/n*100).toFixed(0)}%) T2=${hitT2}(${(hitT2/n*100).toFixed(0)}%) T3=${hitT3}(${(hitT3/n*100).toFixed(0)}%) SL=${stopped}(${(stopped/n*100).toFixed(0)}%) EXP=${expired}(${(expired/n*100).toFixed(0)}%)`);
  console.log(`║  MFE: +${avgMFE.toFixed(2)}%  MAE: ${avgMAE.toFixed(2)}%  Avg Days: ${avgDays.toFixed(1)}d`);
  console.log(`║  10-Gate: ${totalShields} shields (${(totalShields/n).toFixed(1)} avg/trade)`);
  console.log(`║  BEST:  ${best.sym} ${best.date} +${best.pnl.toFixed(2)}%`);
  console.log(`║  WORST: ${worst.sym} ${worst.date} ${worst.pnl.toFixed(2)}%`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

  // Top/bottom stocks
  const byStock = {};
  for (const t of trades) { if (!byStock[t.sym]) byStock[t.sym] = { w: 0, n: 0, pnl: 0 }; byStock[t.sym].n++; if (t.pnl > 0) byStock[t.sym].w++; byStock[t.sym].pnl += t.pnl; }
  const sorted = Object.entries(byStock).sort((a, b) => b[1].pnl - a[1].pnl);
  console.log(`  Top 10 stocks:`);
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const [sym, s] = sorted[i];
    console.log(`    ${sym.padEnd(18)} ${String(s.n).padStart(3)} sigs  ${(s.w/s.n*100).toFixed(0).padStart(4)}% WR  ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}%`);
  }
  if (sorted.length > 10) {
    console.log(`  Bottom 5 stocks:`);
    for (let i = sorted.length - 5; i < sorted.length; i++) {
      if (i < 0) continue;
      const [sym, s] = sorted[i];
      console.log(`    ${sym.padEnd(18)} ${String(s.n).padStart(3)} sigs  ${(s.w/s.n*100).toFixed(0).padStart(4)}% WR  ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}%`);
    }
  }
  console.log('');
}

// ─── COMPARISON TABLE ───
console.log('╔════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  NIFTY 500 — TRUE OUT-OF-SAMPLE COMPARISON (params tuned on different 77 stocks)        ║');
console.log('╠══════════════════╦════════╦════════╦══════════╦═════════╦══════╦══════════╦════════╦══════╣');
console.log('║ Param Set        ║ Signals║ WR%    ║ Avg P&L% ║ PF      ║ R:R  ║ Sharpe   ║ MaxDD% ║ SL%  ║');
console.log('╠══════════════════╬════════╬════════╬══════════╬═════════╬══════╬══════════╬════════╬══════╣');

for (const [key, params] of Object.entries(PARAM_SETS)) {
  const trades = [];
  for (const { sym, c, atr } of stockData) {
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);
      trades.push(result);
      i += Math.max(result.exitDay, 5);
    }
  }
  const n = trades.length;
  if (n === 0) { console.log(`║ ${params.name.slice(0,16).padEnd(16)} ║      0║    0.0║    0.000% ║  0.00 ║ 0.00 ║   0.00 ║   0.0% ║  0.0%║`); continue; }
  const wr = trades.filter(t => t.pnl > 0).length / n * 100;
  const avgPnl = trades.reduce((s, t) => s + t.pnl, 0) / n;
  const grossWin = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : 999;
  const avgRR = trades.reduce((s, t) => s + t.rr, 0) / n;
  const avgDays = trades.reduce((s, t) => s + t.exitDay, 0) / n;
  const variance = n > 1 ? trades.reduce((s, t) => s + (t.pnl - avgPnl) ** 2, 0) / (n - 1) : 0;
  const sharpe = Math.sqrt(variance) > 0 ? (avgPnl / Math.sqrt(variance)) * Math.sqrt(252 / (avgDays || 10)) : 0;
  let peak = 0, maxDD = 0, eq = 0;
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }
  const slPct = trades.filter(t => t.status === 'stopped').length / n * 100;
  const nm = params.name.slice(0, 16).padEnd(16);
  console.log(`║ ${nm} ║ ${String(n).padStart(6)}║ ${wr.toFixed(1).padStart(6)}║ ${(avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(3).padStart(7)}% ║ ${(pf >= 100 ? '  ∞  ' : pf.toFixed(2).padStart(5))} ║ ${avgRR.toFixed(2).padStart(4)} ║ ${sharpe.toFixed(2).padStart(6)} ║ ${maxDD.toFixed(1).padStart(5)}% ║ ${slPct.toFixed(0).padStart(3)}% ║`);
}
console.log('╚══════════════════╩════════╩════════╩══════════╩═════════╩══════╩══════════╩════════╩══════╝');
console.log('\n═══ NIFTY 500 BACKTEST COMPLETE ═══');
