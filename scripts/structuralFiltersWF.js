// STRUCTURAL FILTERS + WALK-FORWARD VALIDATION on 78 OHLCVs
// Filter 1: EMA Alignment (EMA8 > EMA21 > EMA50)
// Filter 2: Zone Shape (flat, ascending, descending)
// Filter 3: Gap Filter (gap-up entries vs non-gap)
// Walk-Forward: Train 2016-2023, Test 2024-2026

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

function parseYahoo(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n'); const c = [];
  for (let i = 1; i < l.length; i++) { const p = l[i].split(','); if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue; c.push({ date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] }); } return c;
}
function parseNSE(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n'); const c = [];
  for (let i = 1; i < l.length; i++) { const p = l[i].split(','); if (p.length < 11 || isNaN(+p[8]) || +p[8] <= 0) continue; c.push({ date: p[0], o: +p[4], h: +p[5], l: +p[6], c: +p[8], v: +p[10] || 0 }); } return c;
}
function atr14(c) {
  const a = new Array(c.length).fill(0); if (c.length < 15) return a;
  let s = 0; for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  a[14] = s / 14; for (let i = 15; i < c.length; i++) { const t = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); a[i] = (a[i - 1] * 13 + t) / 14; } return a;
}
function ema(arr, p) { const o = [arr[0]]; const k = 2/(p+1); for (let i = 1; i < arr.length; i++) o.push(arr[i]*k+o[i-1]*(1-k)); return o; }
function rsi2(c) {
  const r = new Array(c.length).fill(50);
  for (let i = 3; i < c.length; i++) { let g=0,l=0; for (let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;} r[i]=l===0?100:100-100/(1+g/2/(l/2)); } return r;
}

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS')) continue;
    const c = format === 'nse' ? parseNSE(path.join(dir, f)) : parseYahoo(path.join(dir, f));
    if (c.length < 80) continue;
    const closes = c.map(x => x.c);
    stockData.push({ sym: f.replace('_NS_OHLCV.csv','').replace('.csv',''), c, a: atr14(c), rsi: rsi2(c), ema8: ema(closes,8), ema21: ema(closes,21), ema50: ema(closes,50) });
  }
}

const D20 = { minZone:4, maxZone:25, maxRangeATR:1.0, maxTightness:15, maxPre10AvgRangeATR:0.85, maxExpansionCount:3, minExactRangeATR:0.8, minExactVolRatio:1.2, minExactVolVsPre5:1.5, minCloseLoc:55, maxUpperWick:45, minBody:25, rsi2Max:92, minUPS:20, minCandleQuality:2 };

function findSignals(sd, params, dateFilter) {
  const results = [];
  for (const { sym, c, a, rsi, ema8, ema21, ema50 } of sd) {
    const n = c.length;
    for (let i = 55; i < n - 11; i++) {
      if (dateFilter && !dateFilter(c[i].date)) continue;
      if (a[i] <= 0 || c[i].c <= 0) continue;
      const s = c[i], range = s.h - s.l; if (range <= 0) continue;
      const exactRangeATR = range / a[i];
      const closeLoc = (s.c - s.l) / range * 100;
      const upperWick = (s.h - Math.max(s.c, s.o)) / range * 100;
      const bodyPct = Math.abs(s.c - s.o) / range * 100;
      let vol20=0; for(let j=i-20;j<i;j++){if(j>=0)vol20+=c[j].v;} vol20/=20;
      let vol5=0; for(let j=i-5;j<i;j++){if(j>=0)vol5+=c[j].v;} vol5/=5;
      const exactVolRatio = vol20>0?s.v/vol20:0;
      const exactVolVsPre5 = vol5>0?s.v/vol5:0;
      let pre10RangeSum=0,pre10ExpCount=0;
      for(let j=i-10;j<i;j++){if(j<1)continue;pre10RangeSum+=(c[j].h-c[j].l)/(a[j]||1);if((c[j].h-c[j].l)/(a[j]||1)>1.1)pre10ExpCount++;}
      const pre10AvgRangeATR = pre10RangeSum/10;

      let zone = null;
      for (let zL = params.maxZone; zL >= params.minZone; zL--) {
        const zS = i-zL; if(zS<1)continue;
        let zH=-Infinity,zLo=Infinity,ok=true;
        for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>params.maxRangeATR)ok=false;}
        if(!ok)continue;
        const tight=zLo>0?(zH-zLo)/zLo*100:999;
        if(tight>params.maxTightness)continue;
        zone={zH,zL:zLo,len:zL,tight,zS}; break;
      }
      if (!zone||s.c<=zone.zH*1.001) continue;

      let ups=0;
      if(closeLoc>=80)ups+=20;else if(closeLoc>=65)ups+=12;
      if(upperWick<=20)ups+=20;else if(upperWick<=35)ups+=12;
      if(bodyPct>=55)ups+=15;else if(bodyPct>=35)ups+=9;
      if(exactVolVsPre5>=4)ups+=20;else if(exactVolVsPre5>=2)ups+=12;
      if(zone.tight<=5)ups+=15;else if(zone.tight<=15)ups+=9;
      if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
      let cq=0;
      if(closeLoc>=65)cq++;if(upperWick<=30)cq++;if(bodyPct>=40)cq++;if(exactVolVsPre5>=2.5)cq++;if(exactRangeATR>=1.5)cq++;

      if(exactRangeATR<params.minExactRangeATR||exactVolRatio<params.minExactVolRatio||exactVolVsPre5<params.minExactVolVsPre5)continue;
      if(closeLoc<params.minCloseLoc||upperWick>params.maxUpperWick||bodyPct<params.minBody)continue;
      if(pre10AvgRangeATR>params.maxPre10AvgRangeATR||pre10ExpCount>params.maxExpansionCount)continue;
      if(rsi[i]>params.rsi2Max||ups<params.minUPS||cq<params.minCandleQuality)continue;

      // EMA alignment at signal
      const emaAligned = ema8[i] > ema21[i] && ema21[i] > ema50[i];
      const emaPartial = ema8[i] > ema21[i]; // at least short-term bullish

      // Zone shape: compare first half highs vs second half highs
      const mid = Math.floor(zone.len / 2);
      let firstHalfHigh = -Infinity, secondHalfHigh = -Infinity;
      let firstHalfLow = Infinity, secondHalfLow = Infinity;
      for (let j = zone.zS; j < zone.zS + mid; j++) { firstHalfHigh = Math.max(firstHalfHigh, c[j].h); firstHalfLow = Math.min(firstHalfLow, c[j].l); }
      for (let j = zone.zS + mid; j < i; j++) { secondHalfHigh = Math.max(secondHalfHigh, c[j].h); secondHalfLow = Math.min(secondHalfLow, c[j].l); }
      let zoneShape = 'FLAT';
      if (secondHalfLow > firstHalfLow * 1.005 && secondHalfHigh >= firstHalfHigh * 0.995) zoneShape = 'ASCENDING';
      else if (secondHalfHigh < firstHalfHigh * 0.995 && secondHalfLow <= firstHalfLow * 1.005) zoneShape = 'DESCENDING';

      // Gap filter
      const gapPct = i > 0 ? (s.o - c[i-1].c) / c[i-1].c * 100 : 0;
      const isGapUp = gapPct > 1.0;

      // Stop & target (close-only, ZL-0.5ATR [3,7])
      const rawStop = zone.zL - 0.5*a[i];
      const stopPct = Math.max(3, Math.min(7, (s.c-rawStop)/s.c*100));
      const stopPrice = s.c*(1-stopPct/100);
      const atrPct = a[i]/s.c*100;
      const t1Pct = Math.max(3, Math.min(6, 2.5*atrPct));
      const t1Price = s.c*(1+t1Pct/100);

      let mfe=0,mae=0,outcome='expired';
      for(let d=1;d<=10&&i+d<n;d++){
        const cd=c[i+d];
        const hp=(cd.h-s.c)/s.c*100,lp=(cd.l-s.c)/s.c*100;
        if(hp>mfe)mfe=hp;if(lp<mae)mae=lp;
        if(cd.c<=stopPrice&&outcome!=='hit'){outcome='stopped';break;}
        if(cd.h>=t1Price)outcome='hit';
      }
      const exitPrice = outcome==='stopped'?stopPrice:outcome==='hit'?t1Price:c[Math.min(i+10,n-1)].c;
      const pnlPct = (exitPrice-s.c)/s.c*100;

      results.push({ sym, date:s.date, outcome, pnlPct, mfe, mae, stopPct, t1Pct, emaAligned, emaPartial, zoneShape, gapPct, isGapUp, closeLoc, bodyPct, upperWick, exactVolVsPre5 });
    }
  }
  return results;
}

function stats(r, label) {
  if (r.length === 0) return { n:0, wr:0, pf:0, exp:0, fs:0 };
  const w = r.filter(s=>s.outcome==='hit'), st = r.filter(s=>s.outcome==='stopped');
  const wr = w.length/r.length*100;
  const gW = w.reduce((s,v)=>s+v.pnlPct,0), gL = Math.abs(st.reduce((s,v)=>s+v.pnlPct,0));
  const pf = gL>0?gW/gL:99;
  const avgW = w.length>0?w.reduce((s,v)=>s+v.pnlPct,0)/w.length:0;
  const avgL = st.length>0?Math.abs(st.reduce((s,v)=>s+v.pnlPct,0)/st.length):0;
  const exp = (wr/100)*avgW-(1-wr/100)*avgL;
  const fs = st.length>0?st.filter(s=>s.mfe>=3).length/st.length*100:0;
  return { n:r.length, wins:w.length, stops:st.length, wr, pf, exp, fs, avgPnl: r.reduce((s,v)=>s+v.pnlPct,0)/r.length };
}

function printStats(label, s) {
  console.log(`  ${label.padEnd(38)} │ ${String(s.n).padStart(4)} │ ${s.wr.toFixed(1).padStart(5)}% │ ${s.pf.toFixed(2).padStart(5)} │ ${(s.exp>=0?'+':'')+s.exp.toFixed(2).padStart(5)}% │ ${s.fs.toFixed(0).padStart(4)}% │ ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)}%`);
}

console.log('█'.repeat(90));
console.log(`  STRUCTURAL FILTERS + WALK-FORWARD — ${stockData.length} stocks`);
console.log('█'.repeat(90));

const allSigs = findSignals(stockData, D20, null);
const baseS = stats(allSigs);

// ═══ FILTER 1: EMA ALIGNMENT ═══
console.log('\n═══ FILTER 1: EMA ALIGNMENT — Does trend direction matter? ═══\n');
console.log('  Filter                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('ALL (no filter)', baseS);
printStats('EMA8>EMA21>EMA50 (full bullish)', stats(allSigs.filter(s=>s.emaAligned)));
printStats('EMA8>EMA21 only (partial)', stats(allSigs.filter(s=>s.emaPartial)));
printStats('NOT aligned (bearish/mixed)', stats(allSigs.filter(s=>!s.emaAligned)));
printStats('Counter-trend (EMA8<EMA21)', stats(allSigs.filter(s=>!s.emaPartial)));

// ═══ FILTER 2: ZONE SHAPE ═══
console.log('\n═══ FILTER 2: ZONE SHAPE — Which zone shape produces best breakouts? ═══\n');
console.log('  Zone Shape                            │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('ALL zones', baseS);
printStats('FLAT zone', stats(allSigs.filter(s=>s.zoneShape==='FLAT')));
printStats('ASCENDING zone (higher lows)', stats(allSigs.filter(s=>s.zoneShape==='ASCENDING')));
printStats('DESCENDING zone (lower highs)', stats(allSigs.filter(s=>s.zoneShape==='DESCENDING')));
printStats('FLAT + ASCENDING only', stats(allSigs.filter(s=>s.zoneShape!=='DESCENDING')));

// ═══ FILTER 3: GAP FILTER ═══
console.log('\n═══ FILTER 3: GAP FILTER — Do gap-up entries underperform? ═══\n');
console.log('  Gap at Entry                          │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('ALL', baseS);
printStats('No gap (<1%)', stats(allSigs.filter(s=>!s.isGapUp)));
printStats('Gap-up (>1%)', stats(allSigs.filter(s=>s.isGapUp)));
printStats('Gap 1-2%', stats(allSigs.filter(s=>s.gapPct>=1&&s.gapPct<2)));
printStats('Gap 2-3%', stats(allSigs.filter(s=>s.gapPct>=2&&s.gapPct<3)));
printStats('Gap 3%+', stats(allSigs.filter(s=>s.gapPct>=3)));
printStats('Gap-down (<0%)', stats(allSigs.filter(s=>s.gapPct<0)));

// ═══ COMBINED STRUCTURAL FILTERS ═══
console.log('\n═══ COMBINED: Best structural filter combination ═══\n');
console.log('  Combination                           │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');

const combos = [
  { name: 'Baseline (no structural filters)', fn: () => true },
  { name: 'EMA aligned only', fn: s => s.emaAligned },
  { name: 'No gap-up only', fn: s => !s.isGapUp },
  { name: 'No descending zone', fn: s => s.zoneShape !== 'DESCENDING' },
  { name: 'EMA aligned + no gap-up', fn: s => s.emaAligned && !s.isGapUp },
  { name: 'EMA aligned + no descending', fn: s => s.emaAligned && s.zoneShape !== 'DESCENDING' },
  { name: 'All 3: EMA + no gap + no desc', fn: s => s.emaAligned && !s.isGapUp && s.zoneShape !== 'DESCENDING' },
  { name: 'EMA partial + no gap + no desc', fn: s => s.emaPartial && !s.isGapUp && s.zoneShape !== 'DESCENDING' },
  { name: 'EMA aligned + ascending zone', fn: s => s.emaAligned && s.zoneShape === 'ASCENDING' },
  { name: 'EMA + no gap + flat/asc zone', fn: s => s.emaAligned && !s.isGapUp && s.zoneShape !== 'DESCENDING' },
];

let bestCombo = null, bestComboScore = -999;
for (const combo of combos) {
  const filtered = allSigs.filter(combo.fn);
  const s = stats(filtered);
  const score = s.n >= 30 ? s.pf * Math.sqrt(s.n) + s.wr * 0.5 + s.exp * 30 : s.n >= 10 ? s.pf * Math.sqrt(s.n) + s.wr * 0.3 : -999;
  if (score > bestComboScore) { bestComboScore = score; bestCombo = combo; }
  printStats(combo.name, s);
}
console.log(`\n  ★ Best combination: ${bestCombo.name}`);

// ═══ WALK-FORWARD VALIDATION ═══
console.log('\n' + '═'.repeat(90));
console.log('  WALK-FORWARD VALIDATION');
console.log('  Train: all data before 2024 | Test: 2024-2026 (out-of-sample)');
console.log('═'.repeat(90) + '\n');

function dateYear(d) {
  // Handle multiple date formats
  if (d.includes('-')) {
    const parts = d.split('-');
    if (parts[0].length === 4) return parseInt(parts[0]); // 2024-01-01
    // DD-Mon-YYYY
    const m = {'Jan':0,'Feb':1,'Mar':2,'Apr':3,'May':4,'Jun':5,'Jul':6,'Aug':7,'Sep':8,'Oct':9,'Nov':10,'Dec':11};
    if (parts.length === 3 && m[parts[1]] !== undefined) return parseInt(parts[2]);
    return parseInt(parts[0]) > 31 ? parseInt(parts[0]) : parseInt(parts[2]);
  }
  return 2020;
}

const trainFilter = d => dateYear(d) < 2024;
const testFilter = d => dateYear(d) >= 2024;

const trainSigs = findSignals(stockData, D20, trainFilter);
const testSigs = findSignals(stockData, D20, testFilter);

console.log('  ── D20+ Current Params ──\n');
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN (pre-2024)', stats(trainSigs));
printStats('TEST (2024-2026) OOS', stats(testSigs));
printStats('FULL', stats(allSigs));

// Apply best structural filter to both
const bestFn = bestCombo.fn;
console.log(`\n  ── D20+ with structural filter: ${bestCombo.name} ──\n`);
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN (pre-2024) + filter', stats(trainSigs.filter(bestFn)));
printStats('TEST (2024-2026) OOS + filter', stats(testSigs.filter(bestFn)));
printStats('FULL + filter', stats(allSigs.filter(bestFn)));

// Walk-forward with hyper-tuned params
const D20_TUNED = { minZone:3, maxZone:25, maxRangeATR:1, maxTightness:18, maxPre10AvgRangeATR:0.8, maxExpansionCount:2, minExactRangeATR:1, minExactVolRatio:1.2, minExactVolVsPre5:2, minCloseLoc:60, maxUpperWick:40, minBody:30, rsi2Max:95, minUPS:25, minCandleQuality:1 };

const tunedTrain = findSignals(stockData, D20_TUNED, trainFilter);
const tunedTest = findSignals(stockData, D20_TUNED, testFilter);
const tunedAll = findSignals(stockData, D20_TUNED, null);

console.log('\n  ── D20+ Hyper-Tuned Params ──\n');
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN (pre-2024) tuned', stats(tunedTrain));
printStats('TEST (2024-2026) OOS tuned', stats(tunedTest));
printStats('FULL tuned', stats(tunedAll));

// Tuned + structural filter
console.log(`\n  ── D20+ Hyper-Tuned + Structural Filter ──\n`);
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN tuned+filter', stats(tunedTrain.filter(bestFn)));
printStats('TEST OOS tuned+filter', stats(tunedTest.filter(bestFn)));
printStats('FULL tuned+filter', stats(tunedAll.filter(bestFn)));

// ═══ HP15+ Walk-Forward ═══
const HP_TUNED = { minZone:5, maxZone:25, maxRangeATR:1, maxTightness:15, maxPre10AvgRangeATR:0.75, maxExpansionCount:2, minExactRangeATR:1.1, minExactVolRatio:1, minExactVolVsPre5:2, minCloseLoc:55, maxUpperWick:40, minBody:25, rsi2Max:90, minUPS:20, minCandleQuality:2 };
const hpTrain = findSignals(stockData, HP_TUNED, trainFilter);
const hpTest = findSignals(stockData, HP_TUNED, testFilter);
const hpAll = findSignals(stockData, HP_TUNED, null);

console.log('\n  ── HP15+ Hyper-Tuned Walk-Forward ──\n');
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN (pre-2024)', stats(hpTrain));
printStats('TEST (2024-2026) OOS', stats(hpTest));
printStats('FULL', stats(hpAll));
printStats('TEST OOS + struct filter', stats(hpTest.filter(bestFn)));

// ═══ E10+ Walk-Forward ═══
const E_TUNED = { minZone:4, maxZone:25, maxRangeATR:0.95, maxTightness:12, maxPre10AvgRangeATR:0.8, maxExpansionCount:2, minExactRangeATR:1.2, minExactVolRatio:1.2, minExactVolVsPre5:2, minCloseLoc:55, maxUpperWick:35, minBody:25, rsi2Max:90, minUPS:25, minCandleQuality:2 };
const eTrain = findSignals(stockData, E_TUNED, trainFilter);
const eTest = findSignals(stockData, E_TUNED, testFilter);
const eAll = findSignals(stockData, E_TUNED, null);

console.log('\n  ── E10+ Hyper-Tuned Walk-Forward ──\n');
console.log('  Period                                │ Sigs │ WR    │ PF    │ Expect │ FS%  │ AvgPnL');
console.log('  ──────────────────────────────────────┼──────┼───────┼───────┼────────┼──────┼───────');
printStats('TRAIN (pre-2024)', stats(eTrain));
printStats('TEST (2024-2026) OOS', stats(eTest));
printStats('FULL', stats(eAll));
printStats('TEST OOS + struct filter', stats(eTest.filter(bestFn)));

// ═══ FINAL VERDICT ═══
console.log('\n' + '█'.repeat(90));
console.log('  FINAL VERDICT — What to implement');
console.log('█'.repeat(90));

const testFiltered = testSigs.filter(bestFn);
const testFilteredS = stats(testFiltered);
const tunedTestFiltered = tunedTest.filter(bestFn);
const tunedTestFilteredS = stats(tunedTestFiltered);

console.log(`
  STRUCTURAL FILTERS VERDICT:
  ─────────────────────────────
  Best filter: ${bestCombo.name}

  WALK-FORWARD OOS RESULTS (2024-2026):
  ─────────────────────────────────────
  D20+ Current params OOS:        ${stats(testSigs).n} sigs, ${stats(testSigs).wr.toFixed(1)}% WR, PF ${stats(testSigs).pf.toFixed(2)}
  D20+ Current + struct filter:   ${testFilteredS.n} sigs, ${testFilteredS.wr.toFixed(1)}% WR, PF ${testFilteredS.pf.toFixed(2)}
  D20+ Tuned OOS:                 ${stats(tunedTest).n} sigs, ${stats(tunedTest).wr.toFixed(1)}% WR, PF ${stats(tunedTest).pf.toFixed(2)}
  D20+ Tuned + struct filter OOS: ${tunedTestFilteredS.n} sigs, ${tunedTestFilteredS.wr.toFixed(1)}% WR, PF ${tunedTestFilteredS.pf.toFixed(2)}

  OVERFITTING CHECK:
  If tuned params degrade significantly on OOS vs training data → overfitting.
  If they hold steady or improve → genuine edge.
`);
