// ═══════════════════════════════════════════════════════════════════════════════
// RISK% / R:R / VERDICT BACKTEST — Ultra-fine tuning on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// For every completed trade (full bar-by-bar simulation), bucket by:
//   1. Risk% (stop distance) — find the sweet spot range
//   2. Realized R:R (actual P&L / risk taken) — find which R:R bands predict wins
// Then re-derive optimal Verdict tier boundaries (Elite/Good/Fair/Weak)
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
  const plannedRR = riskPct > 0 ? (t1 - entry) / (entry - stop) : 0; // PLANNED R:R using T1 (this is what the Verdict column shows pre-trade)
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
  const realizedRR = riskPct > 0 ? pnl / riskPct : 0;
  return {pnl, realizedRR, plannedRR, riskPct, status, exitDay, mfe, mae, shields};
}

const BASE = { minAvgTurnover20:10e6, maxATRPct14Pctl120:70, maxPre10AvgRangeATR:1.0, maxPre10ExpansionCount:2, expansionATRMultiplier:1.1, zoneRangeATRThreshold:1.0, minZoneLen:4, maxZoneLen:25, maxZoneTightnessPct:25.0, maxPre10AvgVolRatio:1.5, maxPre5AvgVolRatio:1.5, maxPre10HighVolCount:8, highVolMultiplier:1.5, maxPre10RedVolBias:3.0, minExactRangeATR14:1.0, maxExactRangeATR14:8.0, minExactVolRatio20:0.5, minExactVolVsPre5:0.5, minCloseLoc:30, maxUpperWickPct:70, minBodyPct:10, maxCandleRisk:12, minUltraPrecisionScore:0, minRSI2:0, minVolatilityExpansionRatio:0, minCandleQualityScore:0, maxCloseAboveZonePct:null };

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
  if (rsi2(c, idx) < p.minRSI2) return null;
  return { zone };
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  RISK% / R:R / VERDICT BACKTEST — Ultra-fine tuning on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

const trades = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const sig = screenSignal(c, atr, i, BASE);
    if (!sig) continue;
    const r = simulateTrade(c, atr, i, sig.zone);
    trades.push({ sym, idx: i, ...r });
    i += Math.max(r.exitDay, 5);
  }
}
console.log(`Total completed trades: ${trades.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Risk% bucket analysis — find the sweet spot
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 1: Risk% Bucket Analysis                                            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const riskBuckets = [[0,3,'0-3%'],[3,4,'3-4%'],[4,4.5,'4-4.5%'],[4.5,5,'4.5-5%'],[5,5.5,'5-5.5%'],[5.5,6,'5.5-6%'],[6,6.5,'6-6.5%'],[6.5,8,'6.5-8%'],[8,999,'>8%']];
console.log('  Risk%   │ Count │ WR%    │ AvgPnl% │ AvgRR │ PF    │ MaxDD%');
console.log('  ────────┼───────┼────────┼─────────┼───────┼───────┼───────');
for (const [lo, hi, label] of riskBuckets) {
  const bucket = trades.filter(t => t.riskPct >= lo && t.riskPct < hi);
  if (bucket.length < 20) continue;
  const wr = bucket.filter(t => t.pnl > 0).length / bucket.length * 100;
  const a = avg(bucket.map(t => t.pnl));
  const arr = avg(bucket.map(t => t.realizedRR));
  const gW = bucket.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gL = Math.abs(bucket.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf = gL>0?gW/gL:999;
  let peak=0,maxDD=0,eq=0; for(const t of bucket){eq+=t.pnl;if(eq>peak)peak=eq;if(peak-eq>maxDD)maxDD=peak-eq;}
  console.log(`  ${label.padEnd(8)}│ ${String(bucket.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}│ ${(a>=0?'+':'')+a.toFixed(2).padStart(6)}% │ ${arr.toFixed(2).padStart(5)} │ ${(pf>=100?'  ∞ ':pf.toFixed(2).padStart(5))} │ ${maxDD.toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: PLANNED R:R bucket analysis (what the Verdict column should predict)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: PLANNED R:R Bucket Analysis (pre-trade, T1-based)               ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const rrBuckets = [[0,0.3,'0-0.3'],[0.3,0.5,'0.3-0.5'],[0.5,0.6,'0.5-0.6'],[0.6,0.7,'0.6-0.7'],[0.7,0.8,'0.7-0.8'],[0.8,0.9,'0.8-0.9'],[0.9,1.0,'0.9-1.0'],[1.0,1.2,'1.0-1.2'],[1.2,1.5,'1.2-1.5'],[1.5,2.0,'1.5-2.0'],[2.0,999,'>2.0']];
console.log('  Planned RR │ Count │ WR%    │ AvgPnl% │ AvgRealRR │ PF    │ T3Hit%');
console.log('  ───────────┼───────┼────────┼─────────┼───────────┼───────┼───────');
for (const [lo, hi, label] of rrBuckets) {
  const bucket = trades.filter(t => t.plannedRR >= lo && t.plannedRR < hi);
  if (bucket.length < 15) continue;
  const wr = bucket.filter(t => t.pnl > 0).length / bucket.length * 100;
  const a = avg(bucket.map(t => t.pnl));
  const arr = avg(bucket.map(t => t.realizedRR));
  const gW = bucket.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gL = Math.abs(bucket.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf = gL>0?gW/gL:999;
  const t3 = bucket.filter(t=>t.status==='hit_t3').length/bucket.length*100;
  console.log(`  ${label.padEnd(11)}│ ${String(bucket.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}│ ${(a>=0?'+':'')+a.toFixed(2).padStart(6)}% │ ${arr.toFixed(2).padStart(9)} │ ${(pf>=100?'  ∞ ':pf.toFixed(2).padStart(5))} │ ${t3.toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: 2D grid — Risk% × Planned RR combined (find the TRUE sweet spot)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: 2D Grid Search — Risk% range × Planned R:R range                ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const riskRanges = [[3,5],[3.5,5.5],[4,6],[4,6.5],[4.5,6.5],[4.5,7],[5,7],[3,8],[0,99]];
const rrRanges = [[0.5,1.0],[0.6,1.2],[0.7,1.3],[0.8,1.3],[0.8,1.5],[0.6,2.0],[0.5,2.5],[0,99]];

let combos = [];
for (const [rLo, rHi] of riskRanges) {
  for (const [rrLo, rrHi] of rrRanges) {
    const bucket = trades.filter(t => t.riskPct >= rLo && t.riskPct <= rHi && t.plannedRR >= rrLo && t.plannedRR <= rrHi);
    if (bucket.length < 30) continue;
    const wr = bucket.filter(t => t.pnl > 0).length / bucket.length * 100;
    const a = avg(bucket.map(t => t.pnl));
    const gW = bucket.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gL = Math.abs(bucket.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
    const pf = gL>0?gW/gL:999;
    combos.push({ rLo, rHi, rrLo, rrHi, n: bucket.length, wr, avgPnl: a, pf });
  }
}
combos.sort((a,b) => b.wr - a.wr);
console.log('Top 15 by WR (min 30 trades):');
console.log('  Risk Range   │ RR Range    │ Count │ WR%    │ AvgPnl% │ PF');
console.log('  ─────────────┼─────────────┼───────┼────────┼─────────┼──────');
for (let i = 0; i < Math.min(15, combos.length); i++) {
  const c = combos[i];
  console.log(`  [${c.rLo.toFixed(1)},${c.rHi.toFixed(1)}]%`.padEnd(15) + `│ [${c.rrLo.toFixed(1)},${c.rrHi.toFixed(1)}]`.padEnd(14) + `│ ${String(c.n).padStart(5)} │ ${c.wr.toFixed(1).padStart(6)}│ ${(c.avgPnl>=0?'+':'')+c.avgPnl.toFixed(2).padStart(6)}% │ ${c.pf>=100?'∞':c.pf.toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Re-derive optimal Verdict tier boundaries
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Re-derived VERDICT Tier Boundaries                              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Find best single risk+RR combo for "Elite"
const best = combos[0];
console.log(`Best combo found: Risk [${best.rLo}-${best.rHi}]%, RR [${best.rrLo}-${best.rrHi}] → ${best.wr.toFixed(1)}% WR, ${best.avgPnl >= 0 ? '+' : ''}${best.avgPnl.toFixed(2)}% avg P&L, n=${best.n}\n`);

// Build cumulative tiers by planned RR alone (simpler, more intuitive for traders)
console.log('Proposed simplified Verdict tiers (by Planned R:R only, the column traders see pre-trade):');
const sorted = [...trades].sort((a, b) => {
  // Score by how "ideal" combo of risk+RR — use distance to best zone
  return 0;
});
// Quintile based on plannedRR
const byRR = [...trades].filter(t => t.plannedRR > 0).sort((a, b) => b.plannedRR - a.plannedRR);
const N = byRR.length;
const tiers = [[0,0.15,'Elite (top 15%)'],[0.15,0.40,'Good (15-40%)'],[0.40,0.70,'Fair (40-70%)'],[0.70,1.00,'Weak (bottom 30%)']];
console.log('  Tier               │ Count │ RR Range      │ WR%    │ AvgPnl% │ PF');
console.log('  ────────────────────┼───────┼───────────────┼────────┼─────────┼──────');
for (const [lo, hi, label] of tiers) {
  const bucket = byRR.slice(Math.floor(N*lo), Math.floor(N*hi));
  if (bucket.length === 0) continue;
  const wr = bucket.filter(t => t.pnl > 0).length / bucket.length * 100;
  const a = avg(bucket.map(t => t.pnl));
  const gW = bucket.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gL = Math.abs(bucket.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf = gL>0?gW/gL:999;
  const rrMin = Math.min(...bucket.map(t=>t.plannedRR)), rrMax = Math.max(...bucket.map(t=>t.plannedRR));
  console.log(`  ${label.padEnd(20)}│ ${String(bucket.length).padStart(5)} │ [${rrMin.toFixed(2)},${rrMax.toFixed(2)}]`.padEnd(16) + `│ ${wr.toFixed(1).padStart(6)}│ ${(a>=0?'+':'')+a.toFixed(2).padStart(6)}% │ ${pf>=100?'∞':pf.toFixed(2)}`);
}

console.log('\n═══ RISK% / R:R / VERDICT BACKTEST COMPLETE ═══');
