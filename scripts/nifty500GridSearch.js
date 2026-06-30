// ═══════════════════════════════════════════════════════════════════════════════
// NIFTY 500 GRID SEARCH — Hyper-tune all 5 param sets
// 465 stocks × full bar-by-bar simulation × exhaustive threshold search
// Objective: Maximize (WR × PF × AvgPnl) with ≥15 signals
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

// ─── LOAD ───
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  NIFTY 500 GRID SEARCH — Hyper-tune all 5 param sets');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 150) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ─── PRECOMPUTE: structural-pass candidates (independent of grid-searched leaf params) ───
// Structural filters (turnover, ATR pctl, pre10 range, zone shape, pre10/pre5 vol, high-vol count,
// red-vol bias) are FIXED per param-set base — only leaf candle/volume thresholds vary in the grid.
// Computing structural pass once avoids re-scanning all 465 stocks x ~3000 candles per combo.
function precomputeCandidates(base) {
  const candidates = [];
  for (const { sym, c, atr } of stockData) {
    for (let i = 130; i < c.length - 21; i++) {
      const s = c[i]; if (s.c <= 0 || atr[i] <= 0) continue;
      let to = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) to += c[j].c * c[j].v; } to /= 20;
      if (to < base.minAvgTurnover20) continue;
      if (atrPctl120(c, atr, i) > base.maxATRPct14Pctl120) continue;
      let p10S = 0, p10N = 0, expC = 0;
      for (let j = i - 11; j < i - 1; j++) { if (j < 0 || atr[j] <= 0) continue; const ra = (c[j].h - c[j].l) / atr[j]; p10S += ra; p10N++; if (ra > base.expansionATRMultiplier) expC++; }
      const p10A = p10N > 0 ? p10S / p10N : 999;
      if (p10A > base.maxPre10AvgRangeATR) continue;
      if (expC > base.maxPre10ExpansionCount) continue;
      const zone = findZone(c, atr, i, base); if (!zone) continue;
      const v20 = volAvg(c, i, 20);
      let p10VRS = 0, p10VRN = 0, p5VRS = 0, p5VRN = 0, hvC = 0, redVol = 0, greenVol = 0;
      for (let j = i - 11; j < i - 1; j++) {
        if (j < 0) continue; const vr = v20 > 0 ? c[j].v / v20 : 0; p10VRS += vr; p10VRN++;
        if (j >= i - 6) { p5VRS += vr; p5VRN++; }
        if (vr > base.highVolMultiplier) hvC++;
        if (c[j].c < c[j].o) redVol += c[j].v; else greenVol += c[j].v;
      }
      if ((p10VRN > 0 ? p10VRS / p10VRN : 999) > base.maxPre10AvgVolRatio) continue;
      if ((p5VRN > 0 ? p5VRS / p5VRN : 999) > base.maxPre5AvgVolRatio) continue;
      if (hvC > base.maxPre10HighVolCount) continue;
      const rvb = greenVol > 0 ? redVol / greenVol : (redVol > 0 ? 10 : 1);
      if (rvb > base.maxPre10RedVolBias) continue;
      const rng = s.h - s.l; if (rng <= 0) continue;
      if (s.c <= zone.zoneHigh * 1.001) continue;
      const eRA = rng / atr[i];
      const evr20 = v20 > 0 ? s.v / v20 : 0;
      const v5 = volAvg(c, i, 5); const evp5 = v5 > 0 ? s.v / v5 : 0;
      const cL = (s.c - s.l) / rng * 100;
      const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
      const bP = Math.abs(s.c - s.o) / rng * 100;
      const candleRiskPct = rng / s.c * 100;
      const ver = p10A > 0 ? eRA / p10A : 0;
      const ups = calcUPS(cL, uW, bP, evp5, zone.zoneTightnessPct, zone.zoneLen);
      const r2 = rsi2(c, i);
      const cqs = calcCQS(cL, uW, bP, evp5, ver);
      const cazp = (s.c - zone.zoneHigh) / zone.zoneHigh * 100;
      candidates.push({ sym, c, atr, idx: i, zone, eRA, evr20, evp5, cL, uW, bP, candleRiskPct, ver, ups, r2, cqs, cazp });
    }
  }
  return candidates;
}

// ─── FAST evaluate using precomputed candidates — only leaf thresholds checked ───
function evaluateFast(candidates, p) {
  const lastAllowed = {}; // per-stock skip tracking
  const trades = [];
  for (const cand of candidates) {
    const allowed = lastAllowed[cand.sym] ?? -1;
    if (cand.idx <= allowed) continue;
    if (cand.eRA < p.minExactRangeATR14 || cand.eRA > p.maxExactRangeATR14) continue;
    if (cand.evr20 < p.minExactVolRatio20) continue;
    if (cand.evp5 < p.minExactVolVsPre5) continue;
    if (cand.cL < p.minCloseLoc) continue;
    if (cand.uW > p.maxUpperWickPct) continue;
    if (cand.bP < p.minBodyPct) continue;
    if (cand.candleRiskPct > p.maxCandleRisk) continue;
    if (cand.ver < p.minVolatilityExpansionRatio) continue;
    if (cand.ups < p.minUltraPrecisionScore) continue;
    if (cand.r2 < p.minRSI2) continue;
    if (p.minCandleQualityScore != null && cand.cqs < p.minCandleQualityScore) continue;
    if (p.maxCloseAboveZonePct != null && cand.cazp > p.maxCloseAboveZonePct) continue;
    const result = simulateTrade(cand.c, cand.atr, cand.idx, cand.zone);
    trades.push(result);
    lastAllowed[cand.sym] = cand.idx + Math.max(result.exitDay, 5);
  }
  const n = trades.length; if (n === 0) return null;
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

// ─── Slow evaluate (kept for baseline verification only) ───
function evaluate(params) {
  const trades = [];
  for (const { c, atr } of stockData) {
    for (let i = 130; i < c.length - 21; i++) {
      const sig = screenSignal(c, atr, i, params);
      if (!sig) continue;
      trades.push(simulateTrade(c, atr, i, sig.zone));
      i += Math.max(trades[trades.length-1].exitDay, 5);
    }
  }
  const n = trades.length; if (n === 0) return null;
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

// ─── BASE PARAMS (current production) ───
const BASE = {
  D20: { name:'D20+', minAvgTurnover20:10e6, maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.75, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:15, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:0.90, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:1.6, maxExactRangeATR14:5.0, minExactVolRatio20:1.40, minExactVolVsPre5:2.50, minCloseLoc:75, maxUpperWickPct:45, minBodyPct:50, maxCandleRisk:6.0, minUltraPrecisionScore:60, minRSI2:50, minVolatilityExpansionRatio:1.75, minCandleQualityScore:2, maxCloseAboveZonePct:null },
  HP15: { name:'HP15+', minAvgTurnover20:10e6, maxATRPct14Pctl120:85, maxPre10AvgRangeATR:0.75, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:8, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:1.2, maxExactRangeATR14:5.0, minExactVolRatio20:2.50, minExactVolVsPre5:2.00, minCloseLoc:75, maxUpperWickPct:40, minBodyPct:30, maxCandleRisk:10, minUltraPrecisionScore:50, minRSI2:50, minVolatilityExpansionRatio:2.25, minCandleQualityScore:null, maxCloseAboveZonePct:6.0 },
  E10: { name:'E10+', minAvgTurnover20:20e6, maxATRPct14Pctl120:40, maxPre10AvgRangeATR:0.90, maxPre10ExpansionCount:3, expansionATRMultiplier:1.1, zoneRangeATRThreshold:0.95, minZoneLen:7, maxZoneLen:25, maxZoneTightnessPct:15, maxPre10AvgVolRatio:1.00, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:2, highVolMultiplier:1.2, maxPre10RedVolBias:2.0, minExactRangeATR14:1.6, maxExactRangeATR14:6.0, minExactVolRatio20:1.80, minExactVolVsPre5:2.00, minCloseLoc:50, maxUpperWickPct:35, minBodyPct:25, maxCandleRisk:5, minUltraPrecisionScore:25, minRSI2:50, minVolatilityExpansionRatio:1.25, minCandleQualityScore:2, maxCloseAboveZonePct:null },
  US8: { name:'US8+', minAvgTurnover20:10e6, maxATRPct14Pctl120:30, maxPre10AvgRangeATR:0.80, maxPre10ExpansionCount:0, expansionATRMultiplier:1.1, zoneRangeATRThreshold:0.95, minZoneLen:8, maxZoneLen:25, maxZoneTightnessPct:6, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:0.95, maxPre10HighVolCount:0, highVolMultiplier:1.5, maxPre10RedVolBias:2.0, minExactRangeATR14:1.5, maxExactRangeATR14:6.0, minExactVolRatio20:1.60, minExactVolVsPre5:2.50, minCloseLoc:50, maxUpperWickPct:35, minBodyPct:40, maxCandleRisk:8.5, minUltraPrecisionScore:45, minRSI2:50, minVolatilityExpansionRatio:1.50, minCandleQualityScore:4, maxCloseAboveZonePct:null },
  SNP95: { name:'SNP95+', minAvgTurnover20:10e6, maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.80, maxPre10ExpansionCount:1, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:4, maxZoneLen:25, maxZoneTightnessPct:12, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:0, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, minExactRangeATR14:1.6, maxExactRangeATR14:5.0, minExactVolRatio20:1.40, minExactVolVsPre5:1.50, minCloseLoc:65, maxUpperWickPct:45, minBodyPct:30, maxCandleRisk:6, minUltraPrecisionScore:20, minRSI2:50, minVolatilityExpansionRatio:2.50, minCandleQualityScore:2, maxCloseAboveZonePct:null },
};

// ─── GRID SEARCH PER PARAM SET ───
// Key tunable params (most impactful based on prior analysis):
//   eRA, VR20, VRPre5, closeLoc, bodyPct, upperWick, VER, UPS, zoneTight, zoneLen, ATRPctl

for (const [setKey, base] of Object.entries(BASE)) {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log(`║  GRID SEARCH: ${base.name.padEnd(50)}      ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  // Precompute structural-pass candidates ONCE — reused for every combo in Phase 1 & 2
  const precomputeStart = Date.now();
  const candidates = precomputeCandidates(base);
  console.log(`  Precomputed ${candidates.length} structural candidates in ${((Date.now()-precomputeStart)/1000).toFixed(1)}s`);

  // Current baseline
  const baseline = evaluateFast(candidates, base);
  if (baseline) {
    console.log(`  CURRENT: ${baseline.n} sigs | WR ${baseline.wr.toFixed(1)}% | AvgPnl ${baseline.avgPnl >= 0 ? '+' : ''}${baseline.avgPnl.toFixed(3)}% | PF ${baseline.pf >= 100 ? '∞' : baseline.pf.toFixed(2)} | MaxDD ${baseline.maxDD.toFixed(1)}% | SL ${baseline.stopped}\n`);
  } else {
    console.log(`  CURRENT: 0 signals\n`);
  }

  // Define search space per param set (centered around current with ±steps)
  const eRAvals = [1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0];
  const vrVals = [1.0, 1.2, 1.3, 1.4, 1.5, 1.8, 2.0, 2.5];
  const vp5Vals = [1.0, 1.5, 2.0, 2.5, 3.0];
  const clVals = [50, 55, 60, 65, 70, 75, 80];
  const bpVals = [20, 25, 30, 35, 40, 45, 50];
  const uwVals = [30, 35, 40, 45, 50];
  const verVals = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5];
  const upsVals = [15, 20, 25, 30, 40, 50, 60];

  // Phase 1: Coarse sweep of 4 most impactful params
  const totalCombos = eRAvals.length * vrVals.length * clVals.length * verVals.length;
  console.log(`  Phase 1: Coarse sweep (eRA × VR20 × CL × VER) — ${totalCombos} combos...`);
  let results = [];
  let tested = 0;
  const phase1Start = Date.now();

  for (const era of eRAvals) {
    for (const vr of vrVals) {
      for (const cl of clVals) {
        for (const ver of verVals) {
          const p = { ...base, minExactRangeATR14: era, minExactVolRatio20: vr, minCloseLoc: cl, minVolatilityExpansionRatio: ver };
          const r = evaluateFast(candidates, p);
          tested++;
          if (tested % 500 === 0) console.log(`    ... ${tested}/${totalCombos} tested (${((Date.now()-phase1Start)/1000).toFixed(0)}s elapsed)`);
          if (!r || r.n < 10) continue;
          // Score: weighted composite (WR most important, then PF, then avgPnl)
          const score = r.wr * 0.4 + Math.min(r.pf, 10) * 5 * 0.3 + Math.max(0, r.avgPnl) * 10 * 0.3;
          results.push({ era, vr, cl, ver, ...r, score });
        }
      }
    }
  }
  console.log(`  Tested ${tested} combos, ${results.length} with ≥10 signals (${((Date.now()-phase1Start)/1000).toFixed(0)}s)`);

  results.sort((a, b) => b.score - a.score);

  console.log('\n  Top 15 (scored by 40%WR + 30%PF + 30%AvgPnl):');
  console.log('  Rank │ eRA≥ │ VR≥  │ CL≥ │ VER≥ │ Sigs │ WR%    │ AvgP&L% │ PF    │ MaxDD% │ Score');
  console.log('  ─────┼──────┼──────┼─────┼──────┼──────┼────────┼─────────┼───────┼────────┼──────');
  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i];
    console.log(`  ${String(i+1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${r.ver.toFixed(2).padStart(4)} │ ${String(r.n).padStart(4)} │ ${r.wr.toFixed(1).padStart(6)}│ ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(2).padStart(6)}% │ ${(r.pf>=100?'  ∞  ':r.pf.toFixed(2).padStart(5))} │ ${r.maxDD.toFixed(1).padStart(5)}% │ ${r.score.toFixed(1).padStart(5)}`);
  }

  // Phase 2: Fine-tune around the best from Phase 1 — RANDOMIZED sampling (fast)
  if (results.length > 0) {
    const best1 = results[0];
    console.log(`\n  Phase 2: Fine-tune around best (eRA=${best1.era}, VR=${best1.vr}, CL=${best1.cl}, VER=${best1.ver}) — 800 random samples...`);

    const fineResults = [];
    const fERA = [best1.era - 0.2, best1.era - 0.1, best1.era, best1.era + 0.1, best1.era + 0.2].filter(v => v >= 0.5);
    const fVR = [best1.vr - 0.3, best1.vr - 0.15, best1.vr, best1.vr + 0.15, best1.vr + 0.3].filter(v => v >= 0.5);
    const fCL = [best1.cl - 10, best1.cl - 5, best1.cl, best1.cl + 5, best1.cl + 10].filter(v => v >= 30 && v <= 90);
    const fVER = [best1.ver - 0.25, best1.ver - 0.1, best1.ver, best1.ver + 0.1, best1.ver + 0.25].filter(v => v >= 0.5);
    const fBP = [base.minBodyPct - 10, base.minBodyPct, base.minBodyPct + 10].filter(v => v >= 15 && v <= 70);
    const fUPS = [base.minUltraPrecisionScore - 15, base.minUltraPrecisionScore, base.minUltraPrecisionScore + 15].filter(v => v >= 0);
    const fVP5 = [base.minExactVolVsPre5 - 0.5, base.minExactVolVsPre5, base.minExactVolVsPre5 + 0.5].filter(v => v >= 0.5);

    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const seen = new Set();
    const SAMPLES = 800;
    for (let s = 0; s < SAMPLES; s++) {
      const era = pick(fERA), vr = pick(fVR), cl = pick(fCL), ver = pick(fVER), bp = pick(fBP), ups = pick(fUPS), vp5 = pick(fVP5);
      const sig = `${era}|${vr}|${cl}|${ver}|${bp}|${ups}|${vp5}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const p = { ...base, minExactRangeATR14: era, minExactVolRatio20: vr, minCloseLoc: cl, minVolatilityExpansionRatio: ver, minBodyPct: bp, minUltraPrecisionScore: ups, minExactVolVsPre5: vp5 };
      const r = evaluateFast(candidates, p);
      if (!r || r.n < 10) continue;
      const score = r.wr * 0.4 + Math.min(r.pf, 10) * 5 * 0.3 + Math.max(0, r.avgPnl) * 10 * 0.3;
      fineResults.push({ era, vr, cl, ver, bp, ups, vp5, ...r, score });
    }

    fineResults.sort((a, b) => b.score - a.score);
    console.log(`  Fine-tested ${fineResults.length} unique combos (of ${SAMPLES} sampled)`);

    if (fineResults.length > 0) {
      console.log('\n  Top 10 FINE-TUNED:');
      console.log('  Rank │ eRA  │ VR   │ CL  │ VER  │ BP  │ UPS │ VP5  │ Sigs│ WR%   │ AvgP&L%│ PF    │ MaxDD%│ Score');
      console.log('  ─────┼──────┼──────┼─────┼──────┼─────┼─────┼──────┼─────┼───────┼────────┼───────┼───────┼──────');
      for (let i = 0; i < Math.min(10, fineResults.length); i++) {
        const r = fineResults[i];
        console.log(`  ${String(i+1).padStart(4)} │ ${r.era.toFixed(1).padStart(4)} │ ${r.vr.toFixed(1).padStart(4)} │ ${String(r.cl).padStart(3)} │ ${r.ver.toFixed(2).padStart(4)} │ ${String(r.bp).padStart(3)} │ ${String(r.ups).padStart(3)} │ ${r.vp5.toFixed(1).padStart(4)} │ ${String(r.n).padStart(4)}│ ${r.wr.toFixed(1).padStart(5)} │ ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(2).padStart(6)}%│ ${(r.pf>=100?'  ∞  ':r.pf.toFixed(2).padStart(5))} │ ${r.maxDD.toFixed(1).padStart(5)}%│ ${r.score.toFixed(1).padStart(5)}`);
      }

      // Best config
      const best = fineResults[0];
      console.log(`\n  ★ OPTIMAL ${base.name}:`);
      console.log(`    minExactRangeATR14:       ${best.era} (was ${base.minExactRangeATR14})`);
      console.log(`    minExactVolRatio20:       ${best.vr} (was ${base.minExactVolRatio20})`);
      console.log(`    minCloseLoc:              ${best.cl} (was ${base.minCloseLoc})`);
      console.log(`    minVolatilityExpRatio:    ${best.ver} (was ${base.minVolatilityExpansionRatio})`);
      console.log(`    minBodyPct:               ${best.bp} (was ${base.minBodyPct})`);
      console.log(`    minUltraPrecisionScore:   ${best.ups} (was ${base.minUltraPrecisionScore})`);
      console.log(`    minExactVolVsPre5:        ${best.vp5} (was ${base.minExactVolVsPre5})`);
      console.log(`    → ${best.n} sigs | WR ${best.wr.toFixed(1)}% | AvgPnl ${best.avgPnl>=0?'+':''}${best.avgPnl.toFixed(3)}% | PF ${best.pf>=100?'∞':best.pf.toFixed(2)} | MaxDD ${best.maxDD.toFixed(1)}%`);
      if (baseline) {
        console.log(`    Δ WR: ${(best.wr - baseline.wr) >= 0 ? '+' : ''}${(best.wr - baseline.wr).toFixed(1)}pp | Δ PF: ${(best.pf - baseline.pf) >= 0 ? '+' : ''}${(best.pf - baseline.pf).toFixed(2)} | Δ AvgPnl: ${(best.avgPnl - baseline.avgPnl) >= 0 ? '+' : ''}${(best.avgPnl - baseline.avgPnl).toFixed(3)}%`);
      }
    }
  }
  console.log('\n');
}

console.log('═══ NIFTY 500 GRID SEARCH COMPLETE ═══');
