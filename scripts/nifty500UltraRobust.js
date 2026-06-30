// ═══════════════════════════════════════════════════════════════════════════════
// ULTRA-ROBUST GRID SEARCH — Wilson-score fold confidence + structural variation
// Fixes E10+/HP15+ remaining flags by:
//   1. Wilson lower-bound scoring per fold (properly discounts small samples,
//      instead of a brittle hard floor that rejects everything)
//   2. ALSO varies structural params (zone tightness, zone length, ATR pctl)
//      not just leaf candle/volume thresholds — previous round held these fixed
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

// Wilson lower-bound for win rate — properly discounts small samples
function wilsonLB(wins, n, z = 1.0) {
  if (n === 0) return 0;
  const phat = wins / n;
  const denom = 1 + z * z / n;
  const center = phat + z * z / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom) * 100;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  ULTRA-ROBUST SEARCH — Wilson-Score Fold Confidence + Structural Variation');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  const foldSize = Math.floor(c.length / 5);
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c), foldSize });
}
console.log(`Loaded ${stockData.length} stocks\n`);

function precomputeCandidates(base) {
  const candidates = [];
  for (const { sym, c, atr, foldSize } of stockData) {
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
      const fold = Math.min(4, Math.floor(i / foldSize));
      candidates.push({ sym, c, atr, idx: i, zone, eRA, evr20, evp5, cL, uW, bP, candleRiskPct, ver, ups, r2, cqs, cazp, fold });
    }
  }
  return candidates;
}
function passesLeaf(cand, p) {
  if (cand.eRA < p.minExactRangeATR14 || cand.eRA > p.maxExactRangeATR14) return false;
  if (cand.evr20 < p.minExactVolRatio20) return false;
  if (cand.evp5 < p.minExactVolVsPre5) return false;
  if (cand.cL < p.minCloseLoc) return false;
  if (cand.uW > p.maxUpperWickPct) return false;
  if (cand.bP < p.minBodyPct) return false;
  if (cand.candleRiskPct > p.maxCandleRisk) return false;
  if (cand.ver < p.minVolatilityExpansionRatio) return false;
  if (cand.ups < p.minUltraPrecisionScore) return false;
  if (cand.r2 < p.minRSI2) return false;
  if (p.minCandleQualityScore != null && cand.cqs < p.minCandleQualityScore) return false;
  if (p.maxCloseAboveZonePct != null && cand.cazp > p.maxCloseAboveZonePct) return false;
  return true;
}
function evaluateRobust(candidates, p) {
  const lastAllowed = {};
  const foldTrades = [[], [], [], [], []];
  for (const cand of candidates) {
    const allowed = lastAllowed[cand.sym] ?? -1;
    if (cand.idx <= allowed) continue;
    if (!passesLeaf(cand, p)) continue;
    const result = simulateTrade(cand.c, cand.atr, cand.idx, cand.zone);
    foldTrades[cand.fold].push(result);
    lastAllowed[cand.sym] = cand.idx + Math.max(result.exitDay, 5);
  }
  const allTrades = foldTrades.flat();
  const n = allTrades.length;
  if (n === 0) return null;
  const wins = allTrades.filter(t => t.pnl > 0);
  const wr = wins.length / n * 100;
  const avgPnl = allTrades.reduce((s, t) => s + t.pnl, 0) / n;
  const gW = wins.reduce((s, t) => s + t.pnl, 0);
  const gL = Math.abs(allTrades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const pf = gL > 0 ? gW / gL : (gW > 0 ? 999 : 0);
  let peak = 0, maxDD = 0, eq = 0;
  for (const t of allTrades) { eq += t.pnl; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }

  const foldStats = foldTrades.map(ft => {
    if (ft.length === 0) return null;
    const w = ft.filter(t => t.pnl > 0).length;
    return { n: ft.length, wr: w / ft.length * 100, wilson: wilsonLB(w, ft.length) };
  });
  const activeFolds = foldStats.filter(f => f !== null);
  const foldsWithSignal = activeFolds.length;
  const avgWilson = activeFolds.length > 0 ? activeFolds.reduce((s, f) => s + f.wilson, 0) / activeFolds.length : 0;
  const minWilson = activeFolds.length > 0 ? Math.min(...activeFolds.map(f => f.wilson)) : 0;
  const rawWRs = activeFolds.map(f => f.wr);
  const wrVariance = rawWRs.length > 1 ? Math.max(...rawWRs) - Math.min(...rawWRs) : 0;

  return { n, wr, avgPnl, pf, maxDD, foldsWithSignal, avgWilson, minWilson, wrVariance, foldStats };
}

// ─── BASE (structural params held constant from production, EXCEPT now we vary some) ───
const BASES = {
  E10: { name:'E10+', minAvgTurnover20:20e6, expansionATRMultiplier:1.1, maxPre10ExpansionCount:3, maxPre10AvgVolRatio:1.00, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:2, highVolMultiplier:1.2, maxPre10RedVolBias:2.0, maxExactRangeATR14:6.0, maxUpperWickPct:35, maxCandleRisk:5, minRSI2:50, minCandleQualityScore:2, maxCloseAboveZonePct:null },
  HP15: { name:'HP15+', minAvgTurnover20:10e6, expansionATRMultiplier:1.1, maxPre10ExpansionCount:1, maxPre10AvgVolRatio:0.90, maxPre5AvgVolRatio:1.10, maxPre10HighVolCount:4, highVolMultiplier:1.35, maxPre10RedVolBias:2.0, maxExactRangeATR14:5.0, maxUpperWickPct:40, maxCandleRisk:10, minRSI2:50, minCandleQualityScore:null, maxCloseAboveZonePct:6.0 },
};

// Structural variants to test (zone shape, ATR pctl regime)
const structVariants = {
  E10: [
    { maxATRPct14Pctl120:40, maxPre10AvgRangeATR:0.90, zoneRangeATRThreshold:0.95, minZoneLen:7, maxZoneLen:25, maxZoneTightnessPct:15 },
    { maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.90, zoneRangeATRThreshold:1.00, minZoneLen:6, maxZoneLen:25, maxZoneTightnessPct:18 },
    { maxATRPct14Pctl120:60, maxPre10AvgRangeATR:1.00, zoneRangeATRThreshold:1.00, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:20 },
    { maxATRPct14Pctl120:50, maxPre10AvgRangeATR:0.85, zoneRangeATRThreshold:0.95, minZoneLen:7, maxZoneLen:28, maxZoneTightnessPct:15 },
  ],
  HP15: [
    { maxATRPct14Pctl120:85, maxPre10AvgRangeATR:0.75, zoneRangeATRThreshold:1.00, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:8 },
    { maxATRPct14Pctl120:90, maxPre10AvgRangeATR:0.85, zoneRangeATRThreshold:1.00, minZoneLen:4, maxZoneLen:28, maxZoneTightnessPct:12 },
    { maxATRPct14Pctl120:85, maxPre10AvgRangeATR:0.80, zoneRangeATRThreshold:1.05, minZoneLen:5, maxZoneLen:25, maxZoneTightnessPct:10 },
    { maxATRPct14Pctl120:95, maxPre10AvgRangeATR:0.90, zoneRangeATRThreshold:1.05, minZoneLen:4, maxZoneLen:30, maxZoneTightnessPct:14 },
  ],
};

const eRAvals = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2];
const vrVals = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
const clVals = [35, 40, 45, 50, 55, 60, 65];
const verVals = [0.6, 0.8, 1.0, 1.25, 1.5, 1.75];
const bpVals = [10, 15, 20, 25, 30];

function robustScore(r) {
  if (!r) return -9999;
  if (r.n < 18) return -9999;
  if (r.foldsWithSignal < 4) return -9999;
  // Wilson-based: properly discounts small-N folds instead of hard-rejecting them
  const score = r.wr * 0.25 + Math.min(r.pf, 10) * 5 * 0.20 + Math.max(0, r.avgPnl) * 10 * 0.20 + r.avgWilson * 0.20 + r.minWilson * 0.15;
  return score;
}

for (const [key, structs] of Object.entries(structVariants)) {
  const base0 = BASES[key];
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log(`║  ULTRA-ROBUST SEARCH: ${base0.name.padEnd(46)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  let globalBest = null;
  for (let sv = 0; sv < structs.length; sv++) {
    const base = { ...base0, ...structs[sv] };
    const candidates = precomputeCandidates(base);
    let svBest = null;
    for (const era of eRAvals) {
      for (const vr of vrVals) {
        for (const cl of clVals) {
          for (const ver of verVals) {
            for (const bp of bpVals) {
              const p = { ...base, minExactRangeATR14: era, minExactVolRatio20: vr, minCloseLoc: cl, minVolatilityExpansionRatio: ver, minBodyPct: bp, minUltraPrecisionScore: 0, minExactVolVsPre5: 2.0 };
              const r = evaluateRobust(candidates, p);
              const score = robustScore(r);
              if (score > -9999 && (!svBest || score > svBest.score)) {
                svBest = { era, vr, cl, ver, bp, structIdx: sv, struct: structs[sv], ...r, score };
              }
            }
          }
        }
      }
    }
    console.log(`  Struct variant ${sv+1}/${structs.length} (ZT≤${structs[sv].maxZoneTightnessPct}, ZLen≥${structs[sv].minZoneLen}, ATRpctl≤${structs[sv].maxATRPct14Pctl120}): ${candidates.length} candidates, best score ${svBest ? svBest.score.toFixed(1) : 'none'}`);
    if (svBest && (!globalBest || svBest.score > globalBest.score)) globalBest = svBest;
  }

  if (globalBest) {
    console.log(`\n  ★ ULTRA-ROBUST OPTIMAL ${base0.name}:`);
    console.log(`    Structural: ZoneTight≤${globalBest.struct.maxZoneTightnessPct}%, ZoneLen≥${globalBest.struct.minZoneLen}, ATRPctl≤${globalBest.struct.maxATRPct14Pctl120}, Pre10RangeATR≤${globalBest.struct.maxPre10AvgRangeATR}`);
    console.log(`    minExactRangeATR14:     ${globalBest.era}`);
    console.log(`    minExactVolRatio20:     ${globalBest.vr}`);
    console.log(`    minCloseLoc:            ${globalBest.cl}`);
    console.log(`    minVolatilityExpRatio:  ${globalBest.ver}`);
    console.log(`    minBodyPct:             ${globalBest.bp}`);
    console.log(`    → ${globalBest.n} sigs | WR ${globalBest.wr.toFixed(1)}% | AvgPnl +${globalBest.avgPnl.toFixed(3)}% | PF ${globalBest.pf>=100?'∞':globalBest.pf.toFixed(2)}`);
    console.log(`    Fold coverage: ${globalBest.foldsWithSignal}/5 | Avg Wilson LB: ${globalBest.avgWilson.toFixed(0)}% | Min Wilson LB: ${globalBest.minWilson.toFixed(0)}% | WR variance: ${globalBest.wrVariance.toFixed(0)}pp`);
    console.log(`    Per-fold:`);
    globalBest.foldStats.forEach((f, idx) => {
      if (f) console.log(`      F${idx+1}: ${f.n} sigs, ${f.wr.toFixed(0)}% WR (Wilson LB ${f.wilson.toFixed(0)}%)`);
      else console.log(`      F${idx+1}: no signals`);
    });

    // Output full param object for direct use
    const finalP = { ...base0, ...globalBest.struct, minExactRangeATR14: globalBest.era, minExactVolRatio20: globalBest.vr, minCloseLoc: globalBest.cl, minVolatilityExpansionRatio: globalBest.ver, minBodyPct: globalBest.bp, minUltraPrecisionScore: 0, minExactVolVsPre5: 2.0 };
    console.log(`\n  FULL PARAM OBJECT:`);
    console.log('   ', JSON.stringify(finalP));
  } else {
    console.log('  ⚠ No combo found even with structural variation + Wilson scoring');
  }
  console.log('\n');
}

console.log('═══ ULTRA-ROBUST SEARCH COMPLETE ═══');
