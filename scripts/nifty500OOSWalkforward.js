// ═══════════════════════════════════════════════════════════════════════════════
// OOS + WALK-FORWARD VALIDATION — Newly Optimized Param Sets
// Tests the grid-searched optimal params (found ON Nifty 500) for overfitting
// using: (1) 60/40 chronological split, (2) 5-fold rolling walk-forward
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
function rsi2(c, idx) {
  if (idx < 2) return 50;
  const ch1 = c[idx].c - c[idx-1].c, ch2 = c[idx-1].c - c[idx-2].c;
  const g = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
  const l = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
  return l < 0.001 ? 100 : 100 - 100 / (1 + g / l);
}
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
  const eRA = rng / atr[idx];
  const evr20 = v20 > 0 ? s.v / v20 : 0;
  const v5 = volAvg(c, idx, 5); const evp5 = v5 > 0 ? s.v / v5 : 0;
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
  if (i >= 2) { const ch1 = candle.c - prevCandle.c, ch2 = prevCandle.c - (prevPrevCandle ? prevPrevCandle.c : prevCandle.c); const g = ((ch1>0?ch1:0)+(ch2>0?ch2:0))/2; const l = ((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2; if ((l<0.001?100:100-100/(1+g/l)) < 5) return 'SHIELDED'; }
  if (prevCandle && prevCandle.c > stopLoss) return 'SHIELDED';
  if (prevCandle && candle.c >= prevCandle.c) return 'SHIELDED';
  let avgV=0,vc=0; for(let vi=Math.max(0,i-20);vi<i;vi++){if(candles[vi]&&candles[vi].v>0){avgV+=candles[vi].v;vc++;}} avgV=vc>0?avgV/vc:0;
  if (candle.v!=null&&avgV>0&&candle.v<avgV*0.6) return 'SHIELDED';
  const rng=candle.h-candle.l;
  if(rng>0&&(Math.min(candle.o,candle.c)-candle.l)/rng*100>=60) return 'SHIELDED';
  if(candle.c>candle.o&&rng>0&&(candle.c-candle.o)/rng*100>=50) return 'SHIELDED';
  if(rng>0&&(candle.c-candle.l)/rng*100>=45) return 'SHIELDED';
  if(prevCandle&&candle.c>prevCandle.c&&candle.v>(prevCandle.v||0)) return 'SHIELDED';
  if(prevCandle&&prevPrevCandle){if(!(candle.c<candle.o&&prevCandle.c<prevCandle.o&&prevPrevCandle.c<prevPrevCandle.o)) return 'SHIELDED';}else return 'SHIELDED';
  return 'STOPPED';
}
function simulateTrade(c, atr, entryIdx, zone) {
  const entry=c[entryIdx].c;
  const stopRaw=zone.zoneLow-0.50*atr[entryIdx];
  const floorStop=entry*(1-4.0/100); const capStop=entry*(1-6.5/100);
  let stop=Math.min(Math.max(stopRaw,capStop),floorStop);
  const atrPctE=atr[entryIdx]/entry*100;
  const t1=entry*(1+Math.max(4,Math.min(12,2.15*atrPctE))/100);
  const t2Pct=Math.min(5.65,2.80*atrPctE); const t2=Math.max(entry*(1+t2Pct/100),t1+0.05);
  const t3Pct=atrPctE<1.5?5:atrPctE<=3?7:10; const t3=Math.max(entry*(1+t3Pct/100),t2+0.05);
  const riskPct=(entry-stop)/entry*100;
  let pos=1,pnl=0,mfe=0,mae=0,status='open',exitDay=0,trail=stop,t1H=false,t2H=false,shields=0;
  for(let d=1;d<=Math.min(20,c.length-entryIdx-1);d++){
    const ci=entryIdx+d;if(ci>=c.length)break;
    const cd=c[ci],prev=c[ci-1],pp=ci>=2?c[ci-2]:null;
    const hP=(cd.h-entry)/entry*100,lP=(cd.l-entry)/entry*100;
    if(hP>mfe)mfe=hP;if(lP<mae)mae=lP;
    if(!t1H&&cd.h>=t1&&pos>0){pnl+=0.50*(t1-entry)/entry*100;pos-=0.50;t1H=true;trail=entry;}
    if(t1H&&!t2H&&cd.h>=t2&&pos>0){pnl+=0.30*(t2-entry)/entry*100;pos-=0.30;t2H=true;trail=t1;}
    if(t2H&&cd.h>=t3&&pos>0){pnl+=pos*(t3-entry)/entry*100;status='hit_t3';exitDay=d;pos=0;break;}
    if(cd.c<=trail&&pos>0){const g=gateCheck(trail,cd,prev,pp,c.slice(entryIdx),d);if(g==='STOPPED'){pnl+=pos*(cd.c-entry)/entry*100;status='stopped';exitDay=d;pos=0;break;}else if(g==='SHIELDED')shields++;}
  }
  if(pos>0){const li=Math.min(entryIdx+20,c.length-1);pnl+=pos*(c[li].c-entry)/entry*100;status=t1H?(t2H?'hit_t2':'hit_t1'):'expired';exitDay=li-entryIdx;}
  return {pnl,rr:riskPct>0?pnl/riskPct:0,status,exitDay,riskPct,mfe,mae};
}

function computeStats(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, wr: 0, avgPnl: 0, pf: 0, maxDD: 0, stopped: 0 };
  const wins = trades.filter(t => t.pnl > 0);
  const wr = wins.length / n * 100;
  const avgPnl = trades.reduce((s, t) => s + t.pnl, 0) / n;
  const gW = wins.reduce((s, t) => s + t.pnl, 0);
  const gL = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const pf = gL > 0 ? gW / gL : (gW > 0 ? 999 : 0);
  let peak = 0, maxDD = 0, eq = 0;
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }
  return { n, wr, avgPnl, pf, maxDD, stopped: trades.filter(t => t.status === 'stopped').length };
}

// ─── NEWLY OPTIMIZED PARAM SETS (from grid search) ───
const OPTIMIZED = {
  D20: { name: 'D20+ OPTIMIZED', minAvgTurnover20:10e6, maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.75, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:15, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:0.90, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:1.6, maxExactRangeATR14:5.0, minExactVolRatio20:0.7, minExactVolVsPre5:3.0, minCloseLoc:60, maxUpperWickPct:45, minBodyPct:60, maxCandleRisk:6.0, minUltraPrecisionScore:45, minRSI2:50, minVolatilityExpansionRatio:2.4, minCandleQualityScore:2, maxCloseAboveZonePct:null },
  HP15: { name: 'HP15+ ULTRA-ROBUST', minAvgTurnover20:10000000, expansionATRMultiplier:1.1, maxPre10ExpansionCount:1, maxPre10AvgVolRatio:0.9, maxPre5AvgVolRatio:1.1, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2, maxExactRangeATR14:5, maxUpperWickPct:40, maxCandleRisk:10, minRSI2:50, minCandleQualityScore:null, maxCloseAboveZonePct:6, maxATRPct14Pctl120:85, maxPre10AvgRangeATR:0.75, zoneRangeATRThreshold:1, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:8, minExactRangeATR14:2, minExactVolRatio20:1.4, minCloseLoc:35, minVolatilityExpansionRatio:0.6, minBodyPct:15, minUltraPrecisionScore:0, minExactVolVsPre5:2 },
  E10: { name: 'E10+ ULTRA-ROBUST', minAvgTurnover20:20e6, expansionATRMultiplier:1.1, maxPre10ExpansionCount:3, maxPre10AvgVolRatio:1, maxPre5AvgVolRatio:1.1, maxPre10HighVolCount:2, highVolMultiplier:1.2, maxPre10RedVolBias:2, maxExactRangeATR14:6, maxUpperWickPct:35, maxCandleRisk:5, minRSI2:50, minCandleQualityScore:2, maxCloseAboveZonePct:null, maxATRPct14Pctl120:60, maxPre10AvgRangeATR:1, zoneRangeATRThreshold:1, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:20, minExactRangeATR14:1.8, minExactVolRatio20:1.8, minCloseLoc:35, minVolatilityExpansionRatio:0.6, minBodyPct:10, minUltraPrecisionScore:0, minExactVolVsPre5:2 },
  US8: { name: 'US8+ ROBUST', minAvgTurnover20:10e6, maxATRPct14Pctl120:30, maxPre10AvgRangeATR:0.80, maxPre10ExpansionCount:0, expansionATRMultiplier:1.1, zoneRangeATRThreshold:0.95, minZoneLen:8, maxZoneLen:25, maxZoneTightnessPct:6, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:0.95, maxPre10HighVolCount:0, highVolMultiplier:1.5, maxPre10RedVolBias:2.0, minExactRangeATR14:0.6, maxExactRangeATR14:6.0, minExactVolRatio20:0.6, minExactVolVsPre5:1.0, minCloseLoc:35, maxUpperWickPct:35, minBodyPct:10, maxCandleRisk:8.5, minUltraPrecisionScore:0, minRSI2:50, minVolatilityExpansionRatio:2.0, minCandleQualityScore:4, maxCloseAboveZonePct:null },
  SNP95: { name: 'SNP95+ OPTIMIZED', minAvgTurnover20:10e6, maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.80, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:4, maxZoneLen:25, maxZoneTightnessPct:12, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:0, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:2.1, maxExactRangeATR14:5.0, minExactVolRatio20:1.5, minExactVolVsPre5:1.0, minCloseLoc:60, maxUpperWickPct:45, minBodyPct:30, maxCandleRisk:6, minUltraPrecisionScore:5, minRSI2:50, minVolatilityExpansionRatio:0.9, minCandleQualityScore:2, maxCloseAboveZonePct:null },
};

// ─── LOAD ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  OOS + WALK-FORWARD VALIDATION — Newly Optimized Param Sets');
console.log('  Testing for overfitting: 60/40 chronological split + 5-fold rolling window');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: 60/40 CHRONOLOGICAL SPLIT
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  TEST 1: 60/40 CHRONOLOGICAL SPLIT                                       ║');
console.log('║  First 60% = IN-SAMPLE (what optimizer effectively saw)                  ║');
console.log('║  Last 40% = OUT-OF-SAMPLE (later time period, unseen pattern combos)     ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const [key, params] of Object.entries(OPTIMIZED)) {
  const isTrades = [], oosTrades = [];
  for (const { sym, c, atr } of stockData) {
    const splitIdx = Math.floor(c.length * 0.60);
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);
      if (i < splitIdx) isTrades.push(result); else oosTrades.push(result);
      i += Math.max(result.exitDay, 5);
    }
  }
  const isS = computeStats(isTrades), oosS = computeStats(oosTrades);
  console.log(`┌─── ${params.name} ────────────────────────────────────┐`);
  console.log(`│                  IN-SAMPLE (60%)     OUT-OF-SAMPLE (40%) │`);
  console.log(`│  Signals:        ${String(isS.n).padStart(6)}                 ${String(oosS.n).padStart(6)}             │`);
  console.log(`│  Win Rate:       ${isS.wr.toFixed(1).padStart(6)}%                ${oosS.wr.toFixed(1).padStart(6)}%            │`);
  console.log(`│  Avg P&L:     ${(isS.avgPnl>=0?'+':'')+isS.avgPnl.toFixed(3).padStart(7)}%             ${(oosS.avgPnl>=0?'+':'')+oosS.avgPnl.toFixed(3).padStart(7)}%          │`);
  console.log(`│  Profit Factor:  ${(isS.pf>=100?'  ∞  ':isS.pf.toFixed(2).padStart(5))}                ${(oosS.pf>=100?'  ∞  ':oosS.pf.toFixed(2).padStart(5))}              │`);
  console.log(`│  Max Drawdown:   ${isS.maxDD.toFixed(1).padStart(5)}%                ${oosS.maxDD.toFixed(1).padStart(5)}%             │`);
  console.log(`│  Stopped:        ${String(isS.stopped).padStart(6)}                 ${String(oosS.stopped).padStart(6)}             │`);
  if (isS.n > 0 && oosS.n > 0) {
    const wrDrop = oosS.wr - isS.wr, pnlDrop = oosS.avgPnl - isS.avgPnl;
    console.log(`│  DEGRADATION: WR ${wrDrop>=0?'+':''}${wrDrop.toFixed(1)}pp  P&L ${pnlDrop>=0?'+':''}${pnlDrop.toFixed(3)}%                          │`);
    const verdict = Math.abs(wrDrop) <= 10 && pnlDrop >= -1 ? '✅ ROBUST' : Math.abs(wrDrop) <= 20 && pnlDrop >= -2 ? '🟡 MODERATE OVERFIT' : '🔴 SIGNIFICANT OVERFIT';
    console.log(`│  VERDICT: ${verdict.padEnd(48)}│`);
  } else if (oosS.n === 0) {
    console.log(`│  ⚠ NO OOS SIGNALS — param too tight, cannot assess                       │`);
  }
  console.log(`└────────────────────────────────────────────────────────────────────┘\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: 5-FOLD ROLLING WALK-FORWARD
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  TEST 2: 5-FOLD ROLLING WALK-FORWARD                                     ║');
console.log('║  Each stock split into 5 equal time windows — checks consistency          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

for (const [key, params] of Object.entries(OPTIMIZED)) {
  const foldTrades = [[], [], [], [], []];
  for (const { sym, c, atr } of stockData) {
    const foldSize = Math.floor(c.length / 5);
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);
      const foldIdx = Math.min(4, Math.floor(i / foldSize));
      foldTrades[foldIdx].push(result);
      i += Math.max(result.exitDay, 5);
    }
  }
  console.log(`┌─── ${params.name} ─── 5-Fold Walk-Forward ────────────────┐`);
  console.log(`│  Fold │ Period   │ Sigs │ WR%    │ AvgP&L% │ PF     │ MaxDD% │`);
  console.log(`│───────┼──────────┼──────┼────────┼─────────┼────────┼────────│`);
  const allLater = [];
  for (let f = 0; f < 5; f++) {
    const s = computeStats(foldTrades[f]);
    const period = ['Earliest','Early','Mid','Recent','Latest'][f];
    const pfStr = s.pf >= 100 ? '  ∞  ' : s.pf.toFixed(2).padStart(5);
    console.log(`│  F${f+1}   │ ${period.padEnd(8)} │ ${String(s.n).padStart(4)} │ ${s.wr.toFixed(1).padStart(6)}│ ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2).padStart(6)}% │ ${pfStr}  │ ${s.maxDD.toFixed(1).padStart(5)}% │`);
    if (f >= 1) allLater.push(...foldTrades[f]);
  }
  const combined = computeStats(allLater);
  console.log(`│───────┼──────────┼──────┼────────┼─────────┼────────┼────────│`);
  const cpf = combined.pf >= 100 ? '  ∞  ' : combined.pf.toFixed(2).padStart(5);
  console.log(`│ F2-F5 │ Combined │ ${String(combined.n).padStart(4)} │ ${combined.wr.toFixed(1).padStart(6)}│ ${(combined.avgPnl>=0?'+':'')+combined.avgPnl.toFixed(2).padStart(6)}% │ ${cpf}  │ ${combined.maxDD.toFixed(1).padStart(5)}% │`);
  const foldWRs = foldTrades.map(ft => computeStats(ft)).filter(s => s.n > 0).map(s => s.wr);
  if (foldWRs.length >= 3) {
    const range = Math.max(...foldWRs) - Math.min(...foldWRs);
    const consistency = range <= 30 ? '✅ CONSISTENT' : range <= 50 ? '🟡 MODERATE VARIANCE' : '🔴 HIGH VARIANCE';
    console.log(`│  WR range: ${range.toFixed(0)}pp → ${consistency.padEnd(40)}│`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────┘\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY TABLE
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  HONEST OOS ESTIMATE — Optimized Params, Last 40% Unseen Data                      ║');
console.log('╠══════════════════╦════════╦════════╦══════════╦═════════╦════════╦══════════════════╣');
console.log('║ Param Set        ║ Signals║ WR%    ║ Avg P&L% ║ PF      ║ MaxDD% ║ Verdict          ║');
console.log('╠══════════════════╬════════╬════════╬══════════╬═════════╬════════╬══════════════════╣');

for (const [key, params] of Object.entries(OPTIMIZED)) {
  const oosTrades = [];
  for (const { sym, c, atr } of stockData) {
    const splitIdx = Math.floor(c.length * 0.60);
    for (let i = Math.max(130, splitIdx); i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      const result = simulateTrade(c, atr, i, sig.zone);
      oosTrades.push(result);
      i += Math.max(result.exitDay, 5);
    }
  }
  const s = computeStats(oosTrades);
  const nm = params.name.slice(0, 16).padEnd(16);
  const verdict = s.n === 0 ? 'NO OOS DATA' : s.wr >= 70 ? 'STRONG' : s.wr >= 55 ? 'MODERATE' : 'WEAK';
  console.log(`║ ${nm} ║ ${String(s.n).padStart(6)}║ ${s.wr.toFixed(1).padStart(6)}║ ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(3).padStart(7)}% ║ ${(s.pf>=100?'  ∞  ':s.pf.toFixed(2).padStart(5))} ║ ${s.maxDD.toFixed(1).padStart(5)}% ║ ${verdict.padEnd(16)} ║`);
}
console.log('╚══════════════════╩════════╩════════╩══════════╩═════════╩════════╩══════════════════╝');
console.log('\n═══ OOS + WALK-FORWARD VALIDATION COMPLETE ═══');
