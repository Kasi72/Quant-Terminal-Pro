// ULTRA THOROUGH BACKTEST — All 5 Param Sets × All OHLCV files
// Full bar-by-bar simulation: entry, stop (ZoneLow-0.5×ATR, clamp [4%,6.5%]),
// T1/T2/T3 partial exits (50%/30%/20%), 20-day expiry, 10-gate cascade
// Metrics: WR, Avg P&L%, Expectancy, Profit Factor, Max Drawdown, Sharpe

const fs = require('fs'), path = require('path');

const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

// ─── Data parsers ───
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 7 || isNaN(+p[1]) || +p[4] <= 0) continue;
    candles.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[6] || +p[5] || 0 });
  }
  return candles;
}
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 11 || isNaN(+p[8]) || +p[8] <= 0) continue;
    candles.push({ d: p[0] || '', o: +p[4], h: +p[5], l: +p[6], c: +p[8], v: +p[10] || 0 });
  }
  return candles;
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

// ─── ATR Pctl 120 ───
function atrPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) {
    const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0;
    if (v < cur) below++;
  }
  return below / 120 * 100;
}

// ─── Volume averages ───
function volAvg(c, idx, period) {
  let s = 0, cnt = 0;
  for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; cnt++; }
  return cnt > 0 ? s / cnt : 1;
}

// ─── Compression Zone Detection ───
function findZone(c, atr, sigIdx, p) {
  const zoneCandles = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - p.maxZoneLen); j--) {
    if (atr[j] <= 0) break;
    const ra = (c[j].h - c[j].l) / atr[j];
    if (ra > p.zoneRangeATRThreshold) break;
    zoneCandles.unshift(j);
  }
  if (zoneCandles.length < p.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zoneCandles) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > p.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zoneCandles.length, zoneTightnessPct: zt, start: zoneCandles[0] };
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

// ─── UltraPrecisionScore ───
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

// ─── CandleQualityScore ───
function calcCQS(cL, uW, bP, evp5, ver) {
  let s = 0;
  if (cL >= 65) s++;
  if (uW <= 30) s++;
  if (bP >= 40) s++;
  if (evp5 >= 2.5) s++;
  if (ver >= 1.5) s++;
  return s;
}

// ─── RSI-2 ───
function rsi2(c, idx) {
  if (idx < 2) return 50;
  const ch1 = c[idx].c - c[idx-1].c;
  const ch2 = c[idx-1].c - c[idx-2].c;
  const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
  const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
  return l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
}

// ─── Signal screening ───
function screenSignal(c, atr, idx, p) {
  const s = c[idx];
  if (s.c <= 0 || atr[idx] <= 0) return null;

  // Turnover
  let to = 0;
  for (let j = idx - 20; j < idx; j++) { if (j >= 0) to += c[j].c * c[j].v; }
  to /= 20;
  if (to < p.minAvgTurnover20) return null;

  // ATR pctl
  const pctl = atrPctl120(c, atr, idx);
  if (pctl > p.maxATRPct14Pctl120) return null;

  // Pre-10 range ATR
  let pre10Sum = 0, pre10Cnt = 0, expCnt = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0 || atr[j] <= 0) continue;
    const ra = (c[j].h - c[j].l) / atr[j];
    pre10Sum += ra; pre10Cnt++;
    if (ra > p.expansionATRMultiplier) expCnt++;
  }
  const pre10AvgRA = pre10Cnt > 0 ? pre10Sum / pre10Cnt : 999;
  if (pre10AvgRA > p.maxPre10AvgRangeATR) return null;
  if (expCnt > p.maxPre10ExpansionCount) return null;

  // Zone
  const zone = findZone(c, atr, idx, p);
  if (!zone) return null;

  // Pre-10 volume
  const v20 = volAvg(c, idx, 20);
  let pre10VRSum = 0, pre10VRCnt = 0, pre5VRSum = 0, pre5VRCnt = 0, hvCnt = 0, redVol = 0, greenVol = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0) continue;
    const vr = v20 > 0 ? c[j].v / v20 : 0;
    pre10VRSum += vr; pre10VRCnt++;
    if (j >= idx - 6) { pre5VRSum += vr; pre5VRCnt++; }
    if (vr > p.highVolMultiplier) hvCnt++;
    if (c[j].c < c[j].o) redVol += c[j].v;
    else greenVol += c[j].v;
  }
  const pre10AVR = pre10VRCnt > 0 ? pre10VRSum / pre10VRCnt : 999;
  const pre5AVR = pre5VRCnt > 0 ? pre5VRSum / pre5VRCnt : 999;
  const redVolBias = greenVol > 0 ? redVol / greenVol : (redVol > 0 ? 10 : 1);
  if (pre10AVR > p.maxPre10AvgVolRatio) return null;
  if (pre5AVR > p.maxPre5AvgVolRatio) return null;
  if (hvCnt > p.maxPre10HighVolCount) return null;
  if (redVolBias > p.maxPre10RedVolBias) return null;

  // Signal candle metrics
  const rng = s.h - s.l;
  if (rng <= 0) return null;
  const eRA = rng / atr[idx];
  const evr20 = v20 > 0 ? s.v / v20 : 0;
  const v5 = volAvg(c, idx, 5);
  const evp5 = v5 > 0 ? s.v / v5 : 0;
  const cL = (s.c - s.l) / rng * 100;
  const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
  const bP = Math.abs(s.c - s.o) / rng * 100;

  // Breakout check
  if (s.c <= zone.zoneHigh * 1.001) return null;

  // Signal candle filters
  if (eRA < p.minExactRangeATR14 || eRA > p.maxExactRangeATR14) return null;
  if (evr20 < p.minExactVolRatio20) return null;
  if (evp5 < p.minExactVolVsPre5) return null;
  if (cL < p.minCloseLoc) return null;
  if (uW > p.maxUpperWickPct) return null;
  if (bP < p.minBodyPct) return null;

  const atrPct = atr[idx] / s.c * 100;
  const candleRisk = rng / s.c * 100;
  if (candleRisk > p.maxCandleRisk) return null;

  const ver = pre10AvgRA > 0 ? eRA / pre10AvgRA : 0;
  if (ver < p.minVolatilityExpansionRatio) return null;

  const ups = calcUPS(cL, uW, bP, evp5, zone.zoneTightnessPct, zone.zoneLen);
  if (ups < p.minUltraPrecisionScore) return null;

  const r2 = rsi2(c, idx);
  if (r2 < p.minRSI2) return null;

  if (p.minCandleQualityScore != null) {
    const cqs = calcCQS(cL, uW, bP, evp5, ver);
    if (cqs < p.minCandleQualityScore) return null;
  }

  if (p.maxCloseAboveZonePct != null) {
    const cazp = (s.c - zone.zoneHigh) / zone.zoneHigh * 100;
    if (cazp > p.maxCloseAboveZonePct) return null;
  }

  return { zone, atrPct, eRA };
}

// ─── 10-Gate Cascade Stop Check ───
function gateCheck(trade, candle, prevCandle, prevPrevCandle, dayIdx, candles, i) {
  if (candle.c > trade.stopLoss) return 'ABOVE_STOP';

  const dipPct = (trade.stopLoss - candle.c) / trade.stopLoss * 100;

  // G0: Spring Shield — shallow dip < 1.5%
  if (dipPct < 1.5) return 'SHIELDED';

  // G1: RSI-2 oversold
  if (i >= 2) {
    const ch1 = candle.c - prevCandle.c, ch2 = prevCandle.c - (prevPrevCandle ? prevPrevCandle.c : prevCandle.c);
    const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
    const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
    const r = l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
    if (r < 5) return 'SHIELDED';
  }

  // G2: 2-Day Confirmation
  if (prevCandle && prevCandle.c > trade.stopLoss) return 'SHIELDED'; // first day below
  if (prevCandle && candle.c >= prevCandle.c) return 'SHIELDED'; // stabilizing
  // Volume check: 20-bar avg
  let avgVol = 0, vCnt = 0;
  for (let vi = Math.max(0, i - 20); vi < i; vi++) {
    if (candles[vi] && candles[vi].v > 0) { avgVol += candles[vi].v; vCnt++; }
  }
  avgVol = vCnt > 0 ? avgVol / vCnt : 0;
  if (candle.v != null && avgVol > 0 && candle.v < avgVol * 0.6) return 'SHIELDED';

  // G3: Hammer / recovery wick
  const rng = candle.h - candle.l;
  if (rng > 0) {
    const lowerWick = (Math.min(candle.o, candle.c) - candle.l) / rng * 100;
    if (lowerWick >= 60) return 'SHIELDED';
  }

  // G4: Green recovery candle
  if (candle.c > candle.o && rng > 0) {
    const body = (candle.c - candle.o) / rng * 100;
    if (body >= 50) return 'SHIELDED';
  }

  // G5: Close position >= 45%
  if (rng > 0) {
    const closeLoc = (candle.c - candle.l) / rng * 100;
    if (closeLoc >= 45) return 'SHIELDED';
  }

  // G6: OBV rising
  if (prevCandle && candle.c > prevCandle.c && candle.v > (prevCandle.v || 0)) return 'SHIELDED';

  // G7: Not 3 consecutive reds
  if (prevCandle && prevPrevCandle) {
    const threeRed = candle.c < candle.o && prevCandle.c < prevCandle.o && prevPrevCandle.c < prevPrevCandle.o;
    if (!threeRed) return 'SHIELDED';
  } else {
    return 'SHIELDED';
  }

  return 'STOPPED';
}

// ─── Trade simulation with partial exits ───
function simulateTrade(c, atr, entryIdx, zone, atrPct) {
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
  const riskPerShare = entry - stop;

  let position = 1.0; // fraction remaining
  let realizedPnl = 0;
  let mfe = 0, mae = 0;
  let status = 'open';
  let exitDay = 0;
  let trailingStop = stop;
  let t1Hit = false, t2Hit = false;
  let shieldCount = 0;

  const maxDays = Math.min(20, c.length - entryIdx - 1);

  for (let d = 1; d <= maxDays; d++) {
    const ci = entryIdx + d;
    if (ci >= c.length) break;
    const candle = c[ci];
    const prevCandle = c[ci - 1];
    const prevPrevCandle = ci >= 2 ? c[ci - 2] : null;

    // MFE/MAE
    const highPct = (candle.h - entry) / entry * 100;
    const lowPct = (candle.l - entry) / entry * 100;
    if (highPct > mfe) mfe = highPct;
    if (lowPct < mae) mae = lowPct;

    // Check targets first (intraday highs)
    if (!t1Hit && candle.h >= t1 && position > 0) {
      realizedPnl += 0.50 * (t1 - entry) / entry * 100;
      position -= 0.50;
      t1Hit = true;
      trailingStop = entry; // move to breakeven
    }
    if (t1Hit && !t2Hit && candle.h >= t2 && position > 0) {
      realizedPnl += 0.30 * (t2 - entry) / entry * 100;
      position -= 0.30;
      t2Hit = true;
      trailingStop = t1; // move to T1
    }
    if (t2Hit && candle.h >= t3 && position > 0) {
      realizedPnl += position * (t3 - entry) / entry * 100;
      status = 'hit_t3'; exitDay = d;
      position = 0; break;
    }

    // CLOSE-ONLY stop check with 10-gate cascade
    if (candle.c <= trailingStop && position > 0) {
      const gate = gateCheck({ stopLoss: trailingStop }, candle, prevCandle, prevPrevCandle, d, c.slice(entryIdx), d);
      if (gate === 'STOPPED') {
        realizedPnl += position * (candle.c - entry) / entry * 100;
        status = 'stopped'; exitDay = d;
        position = 0; break;
      } else if (gate === 'SHIELDED') {
        shieldCount++;
      }
    }
  }

  // Expiry
  if (position > 0) {
    const lastIdx = Math.min(entryIdx + 20, c.length - 1);
    realizedPnl += position * (c[lastIdx].c - entry) / entry * 100;
    status = t1Hit ? (t2Hit ? 'hit_t2' : 'hit_t1') : 'expired';
    exitDay = lastIdx - entryIdx;
  }

  const rr = riskPct > 0 ? realizedPnl / riskPct : 0;

  return { entry, stop, t1, t2, t3, riskPct, pnl: realizedPnl, rr, mfe, mae, status, exitDay, shieldCount };
}

// ─── LOAD DATA ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  DR KKR QUANT TERMINAL PRO v9.0 — ULTRA THOROUGH BACKTEST');
console.log('  All 5 Param Sets × All OHLCV Files × Full Bar-by-Bar Simulation');
console.log('  Stop: ZoneLow - 0.5×ATR [4%, 6.5%] CLOSE-ONLY + 10-Gate Cascade');
console.log('  Targets: T1 2.15×ATR [4%,12%], Partial Exit 50/30/20, Hold 20d');
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('');

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS') || f.includes('NIFTY50_all') || f.includes('_all')) continue;
    const fp = path.join(dir, f);
    const candles = format === 'nse' ? parseNSE(fp) : parseYahoo(fp);
    if (candles.length < 150) continue;
    const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');
    stockData.push({ sym, c: candles, atr: computeATR14(candles) });
  }
}
console.log(`Loaded ${stockData.length} stocks`);
console.log('');

// ─── RUN BACKTEST ───
const allResults = {};

for (const [key, params] of Object.entries(PARAM_SETS)) {
  const trades = [];
  let stocksWithSignals = 0;

  for (const { sym, c, atr } of stockData) {
    let hadSignal = false;
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      hadSignal = true;

      const result = simulateTrade(c, atr, i, sig.zone, sig.atrPct);
      trades.push({ sym, date: c[i].d || `bar${i}`, ...result });

      // Skip ahead to avoid overlapping trades from same stock
      i += Math.max(result.exitDay, 5);
    }
    if (hadSignal) stocksWithSignals++;
  }

  // ─── Compute stats ───
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const wr = n > 0 ? wins.length / n * 100 : 0;
  const avgPnl = n > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / n : 0;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const pf = losses.length > 0 && avgLoss !== 0 ?
    (wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) : 999;
  const avgRR = n > 0 ? trades.reduce((s, t) => s + t.rr, 0) / n : 0;
  const avgMFE = n > 0 ? trades.reduce((s, t) => s + t.mfe, 0) / n : 0;
  const avgMAE = n > 0 ? trades.reduce((s, t) => s + t.mae, 0) / n : 0;
  const avgDays = n > 0 ? trades.reduce((s, t) => s + t.exitDay, 0) / n : 0;
  const avgRisk = n > 0 ? trades.reduce((s, t) => s + t.riskPct, 0) / n : 0;
  const avgShields = n > 0 ? trades.reduce((s, t) => s + t.shieldCount, 0) / n : 0;
  const totalShields = trades.reduce((s, t) => s + t.shieldCount, 0);

  // Status breakdown
  const hitT1 = trades.filter(t => t.status === 'hit_t1').length;
  const hitT2 = trades.filter(t => t.status === 'hit_t2').length;
  const hitT3 = trades.filter(t => t.status === 'hit_t3').length;
  const stopped = trades.filter(t => t.status === 'stopped').length;
  const expired = trades.filter(t => t.status === 'expired').length;

  // Max drawdown (sequential)
  let peak = 0, maxDD = 0, equity = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (annualized, using trade returns)
  const mean = avgPnl;
  const variance = n > 1 ? trades.reduce((s, t) => s + (t.pnl - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252 / (avgDays || 10)) : 0;

  // Best/Worst trades
  const best = n > 0 ? trades.reduce((b, t) => t.pnl > b.pnl ? t : b, trades[0]) : null;
  const worst = n > 0 ? trades.reduce((w, t) => t.pnl < w.pnl ? t : w, trades[0]) : null;

  allResults[key] = { name: params.name, n, wr, avgPnl, totalPnl, avgWin, avgLoss, pf, avgRR, avgMFE, avgMAE,
    avgDays, avgRisk, hitT1, hitT2, hitT3, stopped, expired, maxDD, sharpe, stocksWithSignals,
    avgShields, totalShields, best, worst, trades };
}

// ─── PRINT RESULTS ───
for (const [key, r] of Object.entries(allResults)) {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${r.name.padEnd(40)}  Signals: ${String(r.n).padStart(5)}  ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Stocks with signals: ${r.stocksWithSignals}/${stockData.length}`);
  console.log(`║`);
  console.log(`║  WIN RATE:        ${r.wr.toFixed(1)}%  (${Math.round(r.wr * r.n / 100)} wins / ${r.n - Math.round(r.wr * r.n / 100)} losses)`);
  console.log(`║  Avg P&L:         ${r.avgPnl >= 0 ? '+' : ''}${r.avgPnl.toFixed(3)}%`);
  console.log(`║  Total P&L:       ${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(2)}%`);
  console.log(`║  Avg Win:         +${r.avgWin.toFixed(3)}%`);
  console.log(`║  Avg Loss:        ${r.avgLoss.toFixed(3)}%`);
  console.log(`║  Profit Factor:   ${r.pf >= 100 ? '∞' : r.pf.toFixed(2)}`);
  console.log(`║  Avg R:R:         ${r.avgRR.toFixed(3)}`);
  console.log(`║  Avg Risk%:       ${r.avgRisk.toFixed(2)}%`);
  console.log(`║  Sharpe Ratio:    ${r.sharpe.toFixed(2)}`);
  console.log(`║  Max Drawdown:    ${r.maxDD.toFixed(2)}%`);
  console.log(`║`);
  console.log(`║  EXIT BREAKDOWN:`);
  console.log(`║    T1 Hit:   ${String(r.hitT1).padStart(4)} (${(r.hitT1/r.n*100||0).toFixed(1)}%)  — 50% booked, SL→BE`);
  console.log(`║    T2 Hit:   ${String(r.hitT2).padStart(4)} (${(r.hitT2/r.n*100||0).toFixed(1)}%)  — 30% booked, SL→T1`);
  console.log(`║    T3 Hit:   ${String(r.hitT3).padStart(4)} (${(r.hitT3/r.n*100||0).toFixed(1)}%)  — 20% booked, fully closed`);
  console.log(`║    Stopped:  ${String(r.stopped).padStart(4)} (${(r.stopped/r.n*100||0).toFixed(1)}%)  — CLOSE-ONLY + 10-gate`);
  console.log(`║    Expired:  ${String(r.expired).padStart(4)} (${(r.expired/r.n*100||0).toFixed(1)}%)  — 20-day auto-close`);
  console.log(`║`);
  console.log(`║  MFE/MAE:`);
  console.log(`║    Avg MFE:  +${r.avgMFE.toFixed(2)}%   (max favorable run)`);
  console.log(`║    Avg MAE:  ${r.avgMAE.toFixed(2)}%   (max adverse run)`);
  console.log(`║    Avg Days: ${r.avgDays.toFixed(1)}d`);
  console.log(`║`);
  console.log(`║  10-GATE CASCADE:`);
  console.log(`║    Total shields: ${r.totalShields} (${r.avgShields.toFixed(1)} avg/trade)`);
  console.log(`║`);
  if (r.best) console.log(`║  BEST:  ${r.best.sym} ${r.best.date} +${r.best.pnl.toFixed(2)}%`);
  if (r.worst) console.log(`║  WORST: ${r.worst.sym} ${r.worst.date} ${r.worst.pnl.toFixed(2)}%`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
}

// ─── COMPARISON TABLE ───
console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                            COMPARISON — ALL 5 PARAM SETS                                        ║');
console.log('╠══════════════════╦════════╦════════╦══════════╦═════════╦══════╦══════════╦════════╦═════════════╣');
console.log('║ Param Set        ║ Signals║ WR%    ║ Avg P&L% ║ PF      ║ R:R  ║ Sharpe   ║ MaxDD% ║ Shields    ║');
console.log('╠══════════════════╬════════╬════════╬══════════╬═════════╬══════╬══════════╬════════╬═════════════╣');
for (const [key, r] of Object.entries(allResults)) {
  const nm = r.name.slice(0, 16).padEnd(16);
  console.log(`║ ${nm} ║ ${String(r.n).padStart(6)}║ ${r.wr.toFixed(1).padStart(6)}║ ${(r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(3).padStart(7)}% ║ ${(r.pf >= 100 ? '  ∞  ' : r.pf.toFixed(2).padStart(5))} ║ ${r.avgRR.toFixed(2).padStart(4)} ║ ${r.sharpe.toFixed(2).padStart(6)} ║ ${r.maxDD.toFixed(1).padStart(5)}% ║ ${String(r.totalShields).padStart(5)}/trade ║`);
}
console.log('╚══════════════════╩════════╩════════╩══════════╩═════════╩══════╩══════════╩════════╩═════════════╝');
console.log('');

// ─── PER-STOCK BREAKDOWN for each param set ───
for (const [key, r] of Object.entries(allResults)) {
  console.log(`\n── ${r.name} — Per-stock breakdown ──`);
  const byStock = {};
  for (const t of r.trades) {
    if (!byStock[t.sym]) byStock[t.sym] = { wins: 0, total: 0, pnl: 0 };
    byStock[t.sym].total++;
    if (t.pnl > 0) byStock[t.sym].wins++;
    byStock[t.sym].pnl += t.pnl;
  }
  const sorted = Object.entries(byStock).sort((a, b) => b[1].pnl - a[1].pnl);
  console.log('  Symbol         | Sigs | WR%    | Total P&L%');
  console.log('  ───────────────+──────+────────+──────────');
  for (const [sym, s] of sorted) {
    const wr = (s.wins / s.total * 100).toFixed(0);
    console.log(`  ${sym.padEnd(15)}| ${String(s.total).padStart(4)} | ${wr.padStart(5)}% | ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}%`);
  }
}

console.log('\n\n═══ BACKTEST COMPLETE ═══');
