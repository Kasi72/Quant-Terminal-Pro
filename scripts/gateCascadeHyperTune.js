// ═══════════════════════════════════════════════════════════════════════════════
// 10-GATE CASCADE HYPER-TUNE — Backtest on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// For every trade that dips to/below its stop, replay the EXACT gate cascade
// logic from autoValidator.ts with configurable thresholds. Measure:
//   - Shield Quality: of trades SHIELDED, what % eventually closed profitably?
//   - Stop Precision: of trades that pass all gates (STOPPED), what % would
//     have lost MORE if not stopped (i.e. stop was correct)?
//   - Net P&L impact: total P&L with gates ON vs OFF (raw stop, no shielding)
// Grid search: G0 dip%, G1 RSI threshold, G2 volume multiplier, G5 closeLoc%
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
function findZone(c, atr, sigIdx, p) {
  const zC = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - p.maxZoneLen); j--) {
    if (atr[j] <= 0) break; if ((c[j].h - c[j].l) / atr[j] > p.zoneRangeATRThreshold) break; zC.unshift(j);
  }
  if (zC.length < p.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > p.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zoneTightnessPct: zt };
}
function calcUPS(cL, uW, bP, evp5, zt, zLen) {
  let s = 0;
  s += cL >= 80 ? 20 : cL >= 65 ? 12 : 0; s += uW <= 20 ? 20 : uW <= 35 ? 12 : 0;
  s += bP >= 55 ? 15 : bP >= 35 ? 9 : 0; s += evp5 >= 4 ? 20 : evp5 >= 2 ? 12 : 0;
  s += zt <= 5 ? 15 : zt <= 15 ? 9 : 0; s += zLen >= 12 ? 10 : zLen >= 6 ? 6 : 0;
  return s;
}
function calcCQS(cL, uW, bP, evp5, ver) {
  let s = 0; if (cL >= 65) s++; if (uW <= 30) s++; if (bP >= 40) s++; if (evp5 >= 2.5) s++; if (ver >= 1.5) s++; return s;
}
function rsi2_screen(c, idx) {
  if (idx < 2) return 50;
  const ch1 = c[idx].c - c[idx-1].c, ch2 = c[idx-1].c - c[idx-2].c;
  const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
  const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
  return l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
}
// Use the validated D20+ param set to generate realistic signals
const D20 = { minAvgTurnover20:10e6, maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.75, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:15, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:0.90, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:1.6, maxExactRangeATR14:5.0, minExactVolRatio20:0.7, minExactVolVsPre5:3.0, minCloseLoc:60, maxUpperWickPct:45, minBodyPct:60, maxCandleRisk:6.0, minUltraPrecisionScore:45, minRSI2:50, minVolatilityExpansionRatio:2.4, minCandleQualityScore:2, maxCloseAboveZonePct:null };
// Looser base too, to get more stop-test events for gate analysis
const LOOSE = { minAvgTurnover20:10e6, maxATRPct14Pctl120:70, maxPre10AvgRangeATR:1.0, maxPre10ExpansionCount:2, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:4, maxZoneLen:25, maxZoneTightnessPct:25, maxPre10AvgVolRatio:1.5, maxPre5AvgVolRatio:1.5, maxPre10HighVolCount:8, highVolMultiplier:1.5, maxPre10RedVolBias:3.0, minExactRangeATR14:1.0, maxExactRangeATR14:8.0, minExactVolRatio20:0.5, minExactVolVsPre5:0.5, minCloseLoc:30, maxUpperWickPct:70, minBodyPct:10, maxCandleRisk:12, minUltraPrecisionScore:0, minRSI2:0, minVolatilityExpansionRatio:0, minCandleQualityScore:0, maxCloseAboveZonePct:null };

function screenSignal(c, atr, idx, p) {
  const s = c[idx]; if (s.c <= 0 || atr[idx] <= 0) return null;
  let to = 0; for (let j = idx - 20; j < idx; j++) { if (j >= 0) to += c[j].c * c[j].v; } to /= 20;
  if (to < p.minAvgTurnover20) return null;
  if (atrPctl120(c, atr, idx) > p.maxATRPct14Pctl120) return null;
  let p10S = 0, p10N = 0, expC = 0;
  for (let j = idx - 11; j < idx - 1; j++) { if (j < 0 || atr[j] <= 0) continue; const ra = (c[j].h - c[j].l) / atr[j]; p10S += ra; p10N++; if (ra > p.expansionATRMultiplier) expC++; }
  const p10A = p10N > 0 ? p10S / p10N : 999;
  if (p10A > p.maxPre10AvgRangeATR) return null;
  if (expC > p.maxPre10ExpansionCount) return null;
  const zone = findZone(c, atr, idx, p); if (!zone) return null;
  const v20 = volAvg(c, idx, 20);
  let p10VRS = 0, p10VRN = 0, p5VRS = 0, p5VRN = 0, hvC = 0, redVol = 0, greenVol = 0;
  for (let j = idx - 11; j < idx - 1; j++) {
    if (j < 0) continue; const vr = v20 > 0 ? c[j].v / v20 : 0; p10VRS += vr; p10VRN++;
    if (j >= idx - 6) { p5VRS += vr; p5VRN++; }
    if (vr > p.highVolMultiplier) hvC++;
    if (c[j].c < c[j].o) redVol += c[j].v; else greenVol += c[j].v;
  }
  if ((p10VRN > 0 ? p10VRS / p10VRN : 999) > p.maxPre10AvgVolRatio) return null;
  if ((p5VRN > 0 ? p5VRS / p5VRN : 999) > p.maxPre5AvgVolRatio) return null;
  if (hvC > p.maxPre10HighVolCount) return null;
  const rvb = greenVol > 0 ? redVol / greenVol : (redVol > 0 ? 10 : 1);
  if (rvb > p.maxPre10RedVolBias) return null;
  const rng = s.h - s.l; if (rng <= 0) return null;
  if (s.c <= zone.zoneHigh * 1.001) return null;
  const eRA = rng / atr[idx];
  const evr20 = v20 > 0 ? s.v / v20 : 0;
  const v5 = volAvg(c, idx, 5); const evp5 = v5 > 0 ? s.v / v5 : 0;
  const cL = (s.c - s.l) / rng * 100;
  const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
  const bP = Math.abs(s.c - s.o) / rng * 100;
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
  if (rsi2_screen(c, idx) < p.minRSI2) return null;
  if (p.minCandleQualityScore != null && calcCQS(cL, uW, bP, evp5, ver) < p.minCandleQualityScore) return null;
  return { zone };
}

// ─── Gate cascade with configurable thresholds (mirrors autoValidator.ts logic) ───
function gateCascade(candles, entryIdx, entry, stopLoss, t1, t2, t3, cfg) {
  let pos = 1, pnl = 0, t1H = false, t2H = false, trail = stopLoss;
  let status = 'open', exitDay = 0, shields = 0, stoppedAtGate = false;
  const events = []; // log of {day, action: 'SHIELDED'|'STOPPED', priceAtEvent, futureOutcome filled later}

  for (let d = 1; d <= Math.min(20, candles.length - entryIdx - 1); d++) {
    const ci = entryIdx + d; if (ci >= candles.length) break;
    const candle = candles[ci], prevCandle = candles[ci-1], prevPrevCandle = ci >= 2 ? candles[ci-2] : null;

    if (!t1H && candle.h >= t1 && pos > 0) { pnl += 0.50 * (t1 - entry) / entry * 100; pos -= 0.50; t1H = true; trail = entry; }
    if (t1H && !t2H && candle.h >= t2 && pos > 0) { pnl += 0.30 * (t2 - entry) / entry * 100; pos -= 0.30; t2H = true; trail = t1; }
    if (t2H && candle.h >= t3 && pos > 0) { pnl += pos * (t3 - entry) / entry * 100; status = 'hit_t3'; exitDay = d; pos = 0; break; }

    if (candle.c <= trail && pos > 0) {
      const dipBelowStop = trail > 0 ? (trail - candle.c) / trail * 100 : 0;
      const openP = candle.o ?? candle.c;
      const isGreen = openP < candle.c;
      const range = candle.h - candle.l;
      const closeLoc = range > 0 ? (candle.c - candle.l) / range * 100 : 50;
      const lwPct = range > 0 ? (Math.min(openP, candle.c) - candle.l) / range * 100 : 0;
      const ch1 = prevCandle ? candle.c - prevCandle.c : 0;
      const ch2 = prevCandle && prevPrevCandle ? prevCandle.c - prevPrevCandle.c : 0;
      const rsiG = ((ch2 > 0 ? ch2 : 0) + (ch1 > 0 ? ch1 : 0)) / 2;
      const rsiL = ((ch2 < 0 ? -ch2 : 0) + (ch1 < 0 ? -ch1 : 0)) / 2;
      const rsi2v = rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);

      let blocked = false;
      // G0
      if (dipBelowStop < cfg.g0Dip) blocked = true;
      // G1
      if (!blocked && rsi2v < cfg.g1Rsi) blocked = true;
      // G2
      if (!blocked) {
        const prevAbove = !prevCandle || prevCandle.c > trail;
        const stabilizing = prevCandle ? candle.c >= prevCandle.c : false;
        let avgVol = 0, volCount = 0;
        for (let vi = Math.max(0, ci - 20); vi < ci; vi++) { if (candles[vi]?.v) { avgVol += candles[vi].v; volCount++; } }
        avgVol = volCount > 0 ? avgVol / volCount : 0;
        const lowVol = candle.v != null && avgVol > 0 && candle.v < avgVol * cfg.g2VolMult;
        if (prevAbove || stabilizing || lowVol) blocked = true;
      }
      // G3
      if (!blocked) { const isHammer = lwPct >= cfg.g3LwPct && closeLoc >= 50; if (isHammer) blocked = true; }
      // G4
      if (!blocked) { const greenRecov = isGreen && closeLoc >= 50; if (greenRecov) blocked = true; }
      // G5
      if (!blocked && closeLoc >= cfg.g5CloseLoc) blocked = true;
      // G6
      if (!blocked) { const obvRising = prevCandle && candle.c > (prevPrevCandle?.c ?? entry); if (obvRising) blocked = true; }
      // G7
      if (!blocked) { const prevGreen = !prevCandle || (prevCandle.o ?? prevCandle.c) <= prevCandle.c; if (prevGreen) blocked = true; }

      if (!blocked) {
        pnl += pos * (candle.c - entry) / entry * 100;
        status = 'stopped'; exitDay = d; pos = 0; stoppedAtGate = true;
        events.push({ day: d, action: 'STOPPED', candleClose: candle.c });
        break;
      } else {
        shields++;
        events.push({ day: d, action: 'SHIELDED', candleClose: candle.c });
      }
    }
  }
  if (pos > 0) {
    const li = Math.min(entryIdx + 20, candles.length - 1);
    pnl += pos * (candles[li].c - entry) / entry * 100;
    status = t1H ? (t2H ? 'hit_t2' : 'hit_t1') : 'expired';
    exitDay = li - entryIdx;
  }
  return { pnl, status, exitDay, shields, events, finalProfitable: pnl > 0 };
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  10-GATE CASCADE HYPER-TUNE — Backtest on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ─── Generate trade candidates (entry/stop/targets) using LOOSE filter for volume ───
const trades = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const sig = screenSignal(c, atr, i, LOOSE);
    if (!sig) continue;
    const entry = c[i].c;
    const stopRaw = sig.zone.zoneLow - 0.50 * atr[i];
    const floorStop = entry * (1 - 4.0 / 100), capStop = entry * (1 - 6.5 / 100);
    const stop = Math.min(Math.max(stopRaw, capStop), floorStop);
    const atrPctE = atr[i] / entry * 100;
    const t1 = entry * (1 + Math.max(4, Math.min(12, 2.15 * atrPctE)) / 100);
    const t2Pct = Math.min(5.65, 2.80 * atrPctE); const t2 = Math.max(entry * (1 + t2Pct / 100), t1 + 0.05);
    const t3Pct = atrPctE < 1.5 ? 5 : atrPctE <= 3 ? 7 : 10; const t3 = Math.max(entry * (1 + t3Pct / 100), t2 + 0.05);
    trades.push({ sym, idx: i, c, entry, stop, t1, t2, t3 });
    i += 8; // reduce overlap
  }
}
console.log(`Generated ${trades.length} trade candidates for gate testing\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// Evaluate a gate config across all trades
// ═══════════════════════════════════════════════════════════════════════════════
function evaluateGateConfig(cfg) {
  let totalPnl = 0, n = 0, totalShields = 0, stoppedCount = 0;
  let shieldThenProfit = 0, shieldThenLoss = 0; // quality of shields
  const results = [];
  for (const t of trades) {
    const r = gateCascade(t.c, t.idx, t.entry, t.stop, t.t1, t.t2, t.t3, cfg);
    totalPnl += r.pnl; n++;
    totalShields += r.shields;
    if (r.status === 'stopped') stoppedCount++;
    if (r.shields > 0) {
      if (r.finalProfitable) shieldThenProfit++; else shieldThenLoss++;
    }
    results.push(r);
  }
  const avgPnl = n > 0 ? totalPnl / n : 0;
  const wins = results.filter(r => r.pnl > 0).length;
  const wr = n > 0 ? wins / n * 100 : 0;
  const shieldedTrades = results.filter(r => r.shields > 0).length;
  const shieldSaveRate = shieldedTrades > 0 ? shieldThenProfit / shieldedTrades * 100 : 0;
  return { n, avgPnl, wr, totalShields, stoppedCount, shieldedTrades, shieldSaveRate, shieldThenProfit, shieldThenLoss };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Baseline (current production thresholds)
// ═══════════════════════════════════════════════════════════════════════════════
const BASELINE_CFG = { g0Dip: 1.5, g1Rsi: 5, g2VolMult: 0.6, g3LwPct: 40, g5CloseLoc: 45 };
const baseline = evaluateGateConfig(BASELINE_CFG);
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  BASELINE (current production thresholds)                                ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
console.log(`  G0 Dip≥1.5% | G1 RSI<5 | G2 VolMult 0.6x | G3 LwPct≥40% | G5 CloseLoc≥45%`);
console.log(`  Trades: ${baseline.n} | Avg P&L: ${baseline.avgPnl >= 0 ? '+' : ''}${baseline.avgPnl.toFixed(3)}% | WR: ${baseline.wr.toFixed(1)}%`);
console.log(`  Total shields: ${baseline.totalShields} | Stopped: ${baseline.stoppedCount} | Shield-save rate: ${baseline.shieldSaveRate.toFixed(1)}% (${baseline.shieldThenProfit}/${baseline.shieldedTrades})\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Grid search — find optimal thresholds
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PHASE 2: Grid Search — G0/G1/G2/G5 thresholds                           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const g0Vals = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
const g1Vals = [3, 5, 8, 10, 15, 20];
const g2Vals = [0.4, 0.5, 0.6, 0.7, 0.8];
const g5Vals = [35, 40, 45, 50, 55, 60];

let gridResults = [];
let tested = 0;
for (const g0 of g0Vals) {
  for (const g1 of g1Vals) {
    for (const g2 of g2Vals) {
      for (const g5 of g5Vals) {
        const cfg = { g0Dip: g0, g1Rsi: g1, g2VolMult: g2, g3LwPct: 40, g5CloseLoc: g5 };
        const r = evaluateGateConfig(cfg);
        tested++;
        // Score: weighted composite — avg P&L most important, then shield-save rate, then WR
        const score = r.avgPnl * 10 + r.shieldSaveRate * 0.3 + r.wr * 0.2;
        gridResults.push({ g0, g1, g2, g5, ...r, score });
      }
    }
  }
}
console.log(`Tested ${tested} combos\n`);
gridResults.sort((a, b) => b.score - a.score);
console.log('Top 15 by composite score (AvgP&L×10 + ShieldSave×0.3 + WR×0.2):');
console.log('  Rank│G0Dip≥│G1RSI<│G2Vol≤│G5CL≥ │AvgP&L% │WR%   │Shields│ShieldSave%│Score');
console.log('  ────┼──────┼──────┼──────┼──────┼────────┼──────┼───────┼───────────┼──────');
for (let i = 0; i < Math.min(15, gridResults.length); i++) {
  const r = gridResults[i];
  console.log(`  ${String(i+1).padStart(3)} │${r.g0.toFixed(1).padStart(5)} │${String(r.g1).padStart(5)} │${r.g2.toFixed(1).padStart(5)} │${String(r.g5).padStart(5)} │${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3).padStart(6)}% │${r.wr.toFixed(1).padStart(5)}%│${String(r.totalShields).padStart(6)} │${r.shieldSaveRate.toFixed(1).padStart(9)}% │${r.score.toFixed(2)}`);
}

// Also rank purely by avg P&L (the most important real-world metric)
console.log('\nTop 10 by RAW Avg P&L (ignoring shield metrics):');
const byPnl = [...gridResults].sort((a, b) => b.avgPnl - a.avgPnl);
console.log('  Rank│G0Dip≥│G1RSI<│G2Vol≤│G5CL≥ │AvgP&L% │WR%   │Shields│ShieldSave%');
console.log('  ────┼──────┼──────┼──────┼──────┼────────┼──────┼───────┼───────────');
for (let i = 0; i < 10; i++) {
  const r = byPnl[i];
  console.log(`  ${String(i+1).padStart(3)} │${r.g0.toFixed(1).padStart(5)} │${String(r.g1).padStart(5)} │${r.g2.toFixed(1).padStart(5)} │${String(r.g5).padStart(5)} │${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3).padStart(6)}% │${r.wr.toFixed(1).padStart(5)}%│${String(r.totalShields).padStart(6)} │${r.shieldSaveRate.toFixed(1).padStart(9)}%`);
}

// And purely by shield-save rate (gate quality — did shields actually help?)
console.log('\nTop 10 by SHIELD-SAVE RATE (gate precision — min 50 shielded trades):');
const byShield = gridResults.filter(r => r.shieldedTrades >= 50).sort((a, b) => b.shieldSaveRate - a.shieldSaveRate);
console.log('  Rank│G0Dip≥│G1RSI<│G2Vol≤│G5CL≥ │AvgP&L% │WR%   │Shields│ShieldSave%');
console.log('  ────┼──────┼──────┼──────┼──────┼────────┼──────┼───────┼───────────');
for (let i = 0; i < Math.min(10, byShield.length); i++) {
  const r = byShield[i];
  console.log(`  ${String(i+1).padStart(3)} │${r.g0.toFixed(1).padStart(5)} │${String(r.g1).padStart(5)} │${r.g2.toFixed(1).padStart(5)} │${String(r.g5).padStart(5)} │${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3).padStart(6)}% │${r.wr.toFixed(1).padStart(5)}%│${String(r.totalShields).padStart(6)} │${r.shieldSaveRate.toFixed(1).padStart(9)}%`);
}

const best = gridResults[0];
console.log(`\n★ OPTIMAL GATE CONFIG:`);
console.log(`  G0 Spring Shield: dip ≥ ${best.g0}% (was 1.5%)`);
console.log(`  G1 RSI Oversold:  RSI-2 < ${best.g1} (was 5)`);
console.log(`  G2 Volume Mult:   < ${best.g2}x 20-bar avg (was 0.6x)`);
console.log(`  G5 Close Position: closeLoc ≥ ${best.g5}% (was 45%)`);
console.log(`  → ${best.n} trades | Avg P&L ${best.avgPnl>=0?'+':''}${best.avgPnl.toFixed(3)}% | WR ${best.wr.toFixed(1)}% | Shield-save ${best.shieldSaveRate.toFixed(1)}%`);
console.log(`  vs BASELINE: Avg P&L ${baseline.avgPnl>=0?'+':''}${baseline.avgPnl.toFixed(3)}% | WR ${baseline.wr.toFixed(1)}% | Shield-save ${baseline.shieldSaveRate.toFixed(1)}%`);
console.log(`  Δ Avg P&L: ${(best.avgPnl - baseline.avgPnl) >= 0 ? '+' : ''}${(best.avgPnl - baseline.avgPnl).toFixed(3)}pp | Δ WR: ${(best.wr - baseline.wr) >= 0 ? '+' : ''}${(best.wr - baseline.wr).toFixed(1)}pp`);

console.log('\n═══ GATE CASCADE HYPER-TUNE COMPLETE ═══');
