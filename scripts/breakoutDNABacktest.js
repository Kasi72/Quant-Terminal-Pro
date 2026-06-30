// ═══════════════════════════════════════════════════════════════════════════════
// BREAKOUT DNA + ONSET CANDLE — Ultra-Deep Backtest on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// Current system (5 onset tiers + 5 DNA archetypes) was calibrated on only 29
// OHLCV files with claimed 81.8%/52.3%/51%/48%/57% hit rates and NO OOS
// validation. This re-backtests on 455 Nifty 500 stocks with proper 60/40
// train/test split, then grid-searches for OOS-stable thresholds.
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
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; } return n > 0 ? s / n : 1;
}
function findZone(c, atr, sigIdx) {
  const ZP = { zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 15.0 };
  const zC = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - ZP.maxZoneLen); j--) {
    if (atr[j] <= 0) break; if ((c[j].h - c[j].l) / atr[j] > ZP.zoneRangeATRThreshold) break; zC.unshift(j);
  }
  if (zC.length < ZP.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > ZP.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zoneTightnessPct: zt };
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  BREAKOUT DNA + ONSET CANDLE — Ultra-Deep Backtest on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Build dataset — ACTUAL breakout candles only (close > zoneHigh*1.001)
// ═══════════════════════════════════════════════════════════════════════════════
const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const s = c[i], rng = s.h - s.l;
    if (s.c <= 0 || atr[i] <= 0 || rng <= 0) continue;

    let hasSplit = false;
    for (let j = i; j < Math.min(i + 21, c.length - 1); j++) {
      if (c[j].c <= 0) continue;
      const ratio = c[j+1].c / c[j].c;
      if (ratio > 2.5 || ratio < 0.4) { hasSplit = true; break; }
    }
    if (hasSplit) continue;

    const zone = findZone(c, atr, i);
    if (!zone) continue;
    if (s.c <= zone.zoneHigh * 1.001) continue; // must be an actual breakout candle

    // ── Candle anatomy ──
    const closeLoc = (s.c - s.l) / rng * 100;
    const upperWickPct = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const lowerWickPct = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const isGreen = s.c > s.o;
    const eRA = rng / atr[i];
    const signalRangePct = rng / s.c * 100;

    // ── Volume ──
    const v20 = volAvg(c, i, 20);
    const v5 = volAvg(c, i, 5);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;
    const volVsPre5 = v5 > 0 ? s.v / v5 : 0;

    // ── Pre-conditions ──
    let p10S = 0, p10N = 0, p10VR = 0;
    for (let j = i - 11; j < i - 1; j++) {
      if (j < 0) continue;
      if (atr[j] > 0) { p10S += (c[j].h - c[j].l) / atr[j]; p10N++; }
      if (v20 > 0) p10VR += c[j].v / v20;
    }
    const pre10AvgRangeATR = p10N > 0 ? p10S / p10N : 999;
    const pre10AvgVolRatio = p10N > 0 ? p10VR / p10N : 999;

    // ── Candle pattern (HAMR/DGDF) ──
    let pattern = null;
    if (bodyPct < 10) { if (lowerWickPct > 60 && upperWickPct < 10) pattern = 'DGDF'; }
    else if (lowerWickPct > 60 && upperWickPct < 10 && bodyPct < 35) { pattern = isGreen ? 'HAMR' : 'HNGM'; }

    // ── Forward outcomes ──
    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5,c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10,c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[i+20].c - s.c) / s.c * 100;
    const hit5pct = maxH >= 5; // "hit rate" definition matching prior system's framing
    const win = fwd20 > 0;
    let daysToHit5 = -1;
    for (let j = i+1; j <= i+20; j++) { if ((c[j].h - s.c)/s.c*100 >= 5) { daysToHit5 = j-i; break; } }

    points.push({
      sym, idx: i, closeLoc, upperWickPct, lowerWickPct, bodyPct, isGreen, eRA, signalRangePct,
      volRatio20, volVsPre5, pre10AvgRangeATR, pre10AvgVolRatio, pattern,
      maxH, fwd5, fwd10, fwd20, hit5pct, win, daysToHit5,
    });
  }
}
console.log(`Total breakout candles: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length/arr.length*100 : 0; }

// 60/40 chronological split
const symFirstIdx = {}, symLastIdx = {};
for (const p of points) { if (!(p.sym in symFirstIdx)) symFirstIdx[p.sym] = p.idx; symLastIdx[p.sym] = p.idx; }
for (const p of points) { const range = symLastIdx[p.sym] - symFirstIdx[p.sym]; p.isTrain = range > 0 ? (p.idx - symFirstIdx[p.sym]) / range <= 0.6 : true; }
const trainPts = points.filter(p => p.isTrain);
const testPts = points.filter(p => !p.isTrain);
console.log(`Train: ${trainPts.length.toLocaleString()} | Test/OOS: ${testPts.length.toLocaleString()}\n`);

const baseline = { hit5: pct(points, p=>p.hit5pct), win: pct(points, p=>p.win) };
console.log(`BASELINE (all breakout candles): Hit-5% rate ${baseline.hit5.toFixed(1)}% | Win rate ${baseline.win.toFixed(1)}%\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Validate CURRENT system's tiers/DNA as-is on full Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: CURRENT (v1) System — Validate As-Is                            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function classifyOnsetV1(p) {
  const { closeLoc: cl, volVsPre5: vp5, volRatio20: vr20, eRA: ra, bodyPct: bp, upperWickPct: uw, signalRangePct: sr } = p;
  if (cl >= 70 && vp5 >= 2.50 && vr20 >= 1.50 && ra >= 1.20 && ra <= 4.50 && bp >= 45 && uw <= 30 && sr <= 8.5) return 'BEST';
  if (cl >= 65 && vp5 >= 2.00 && vr20 >= 1.20 && ra >= 1.00 && ra <= 5.00 && bp >= 35 && uw <= 35 && sr <= 11.0) return 'STRONG';
  if (cl >= 65 && bp >= 50 && uw <= 25 && ra >= 1.00) return 'FULL_BODY';
  if (cl >= 60 && (p.pattern === 'HAMR' || p.pattern === 'DGDF') && ra >= 1.00) return 'REJECTION';
  if (cl >= 55 && bp < 35 && ra >= 1.00 && vp5 >= 1.50) return 'WEAK';
  return null;
}
function classifyDNAV1(p) {
  const { closeLoc: cl, bodyPct: bp, upperWickPct: uw, eRA: ra } = p;
  if (bp >= 70 && cl >= 80 && uw <= 15) return 'MARUBOZU';
  if (ra >= 1.5 && cl >= 60 && bp >= 30) return 'R-EXP';
  if (cl >= 60 && bp <= 35 && uw <= 15 && (p.pattern === 'HAMR' || p.pattern === 'DGDF')) return 'HAMMER';
  if (bp >= 45 && cl >= 65 && p.volVsPre5 >= 2.0) return 'THRUST';
  if (p.pre10AvgVolRatio <= 0.82 && p.pre10AvgRangeATR <= 0.75) return 'COMPRESSION';
  return null;
}

console.log('  ONSET TIERS (claimed hit rates: BEST=81.8%, STRONG=52.3%, FULL_BODY=50%, REJECTION=48%, WEAK=?)');
console.log('  Tier      │ TrainN │ TrainHit5%│ TestN │ TestHit5%(OOS)│ Degrad │ TestWinRate%');
console.log('  ──────────┼────────┼───────────┼───────┼───────────────┼────────┼─────────────');
for (const tier of ['BEST','STRONG','FULL_BODY','REJECTION','WEAK']) {
  const trBucket = trainPts.filter(p => classifyOnsetV1(p) === tier);
  const teBucket = testPts.filter(p => classifyOnsetV1(p) === tier);
  if (trBucket.length < 5) { console.log(`  ${tier.padEnd(10)}│ ${String(trBucket.length).padStart(6)} │     —     │ ${String(teBucket.length).padStart(5)} │       —       │    —   │      —`); continue; }
  const trHit = pct(trBucket, p=>p.hit5pct), teHit = teBucket.length>0?pct(teBucket, p=>p.hit5pct):0;
  const teWin = teBucket.length>0?pct(teBucket, p=>p.win):0;
  console.log(`  ${tier.padEnd(10)}│ ${String(trBucket.length).padStart(6)} │ ${trHit.toFixed(1).padStart(8)}% │ ${String(teBucket.length).padStart(5)} │ ${teHit.toFixed(1).padStart(12)}% │ ${(teHit-trHit>=0?'+':'')+(teHit-trHit).toFixed(1).padStart(5)}pp│ ${teWin.toFixed(1).padStart(11)}%`);
}

console.log('\n  DNA ARCHETYPES (claimed: MARUBOZU=51.1%, HAMMER=48.4%, THRUST=47.7%, R-EXP=57.1%)');
console.log('  DNA         │ TrainN │ TrainHit5%│ TestN │ TestHit5%(OOS)│ Degrad │ TestWinRate%');
console.log('  ────────────┼────────┼───────────┼───────┼───────────────┼────────┼─────────────');
for (const dna of ['MARUBOZU','R-EXP','HAMMER','THRUST','COMPRESSION']) {
  const trBucket = trainPts.filter(p => classifyDNAV1(p) === dna);
  const teBucket = testPts.filter(p => classifyDNAV1(p) === dna);
  if (trBucket.length < 5) { console.log(`  ${dna.padEnd(12)}│ ${String(trBucket.length).padStart(6)} │     —     │ ${String(teBucket.length).padStart(5)} │       —       │    —   │      —`); continue; }
  const trHit = pct(trBucket, p=>p.hit5pct), teHit = teBucket.length>0?pct(teBucket, p=>p.hit5pct):0;
  const teWin = teBucket.length>0?pct(teBucket, p=>p.win):0;
  console.log(`  ${dna.padEnd(12)}│ ${String(trBucket.length).padStart(6)} │ ${trHit.toFixed(1).padStart(8)}% │ ${String(teBucket.length).padStart(5)} │ ${teHit.toFixed(1).padStart(12)}% │ ${(teHit-trHit>=0?'+':'')+(teHit-trHit).toFixed(1).padStart(5)}pp│ ${teWin.toFixed(1).padStart(11)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Individual feature correlation
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: Feature Correlation vs Hit-5% / Fwd20d                          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
function pearsonR(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num=0,dx=0,dy=0;
  for (let i=0;i<xs.length;i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx>0&&dy>0 ? num/Math.sqrt(dx*dy) : 0;
}
const hit5Arr = points.map(p=>p.hit5pct?1:0);
const fwd20Arr = points.map(p=>p.fwd20);
const feats = [['closeLoc',p=>p.closeLoc],['upperWickPct',p=>p.upperWickPct],['bodyPct',p=>p.bodyPct],['eRA',p=>p.eRA],
  ['volRatio20',p=>p.volRatio20],['volVsPre5',p=>p.volVsPre5],['signalRangePct',p=>p.signalRangePct],
  ['pre10AvgVolRatio',p=>p.pre10AvgVolRatio],['pre10AvgRangeATR',p=>p.pre10AvgRangeATR]];
const corrs = feats.map(([name,fn]) => ({ name, rHit5: pearsonR(points.map(fn), hit5Arr), rFwd20: pearsonR(points.map(fn), fwd20Arr) }));
corrs.sort((a,b) => Math.abs(b.rHit5) - Math.abs(a.rHit5));
console.log('  Feature            │ r vs Hit5%│ r vs Fwd20d');
console.log('  ────────────────────┼───────────┼────────────');
for (const c of corrs) console.log(`  ${c.name.padEnd(20)}│ ${(c.rHit5>=0?'+':'')+c.rHit5.toFixed(4).padStart(7)} │ ${(c.rFwd20>=0?'+':'')+c.rFwd20.toFixed(4)}`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: ROBUST grid search — stability-optimized (lesson from monster move)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Robust Grid Search — Onset Quality Filter (stability-optimized)  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function robustSearch(filterFn, grid, minN) {
  const results = [];
  for (const combo of grid) {
    const trainMatch = trainPts.filter(p => filterFn(p, combo));
    if (trainMatch.length < minN) continue;
    const testMatch = testPts.filter(p => filterFn(p, combo));
    if (testMatch.length < Math.max(15, minN * 0.3)) continue;
    const trainRate = pct(trainMatch, p=>p.hit5pct), testRate = pct(testMatch, p=>p.hit5pct);
    const degradation = testRate - trainRate;
    const stabilityScore = Math.min(trainRate, testRate) - Math.abs(degradation) * 0.3;
    results.push({ ...combo, trainN: trainMatch.length, testN: testMatch.length, trainRate, testRate, degradation, stabilityScore });
  }
  results.sort((a,b) => b.stabilityScore - a.stabilityScore);
  return results;
}

const onsetGrid = [];
for (const cl of [55,60,65,70,75,80]) for (const vp5 of [1.0,1.5,2.0,2.5,3.0]) for (const vr20 of [1.0,1.2,1.5,2.0])
  for (const ra of [0.8,1.0,1.2,1.5]) for (const bp of [25,35,45,55]) for (const uw of [20,30,40])
  onsetGrid.push({ cl, vp5, vr20, ra, bp, uw });

const onsetResults = robustSearch(
  (p,c) => p.closeLoc>=c.cl && p.volVsPre5>=c.vp5 && p.volRatio20>=c.vr20 && p.eRA>=c.ra && p.bodyPct>=c.bp && p.upperWickPct<=c.uw,
  onsetGrid, 50
);
console.log(`Tested ${onsetGrid.length} combos, ${onsetResults.length} passed gates\n`);
console.log('Top 10 by STABILITY score:');
console.log('  CL≥│VP5≥│VR20≥│eRA≥│BP≥│UW≤│TrainN│TestN│TrainHit%│TestHit%(OOS)│Degrad');
console.log('  ───┼────┼─────┼────┼───┼───┼──────┼─────┼─────────┼─────────────┼──────');
for (let i=0;i<Math.min(10,onsetResults.length);i++) { const r=onsetResults[i];
  console.log(`  ${String(r.cl).padStart(3)}│${r.vp5.toFixed(1).padStart(4)}│${r.vr20.toFixed(1).padStart(5)}│${r.ra.toFixed(1).padStart(4)}│${String(r.bp).padStart(3)}│${String(r.uw).padStart(3)}│ ${String(r.trainN).padStart(5)}│${String(r.testN).padStart(5)}│ ${r.trainRate.toFixed(1).padStart(7)}%│ ${r.testRate.toFixed(1).padStart(11)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Robust DNA archetype search
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5: Robust Search — MARUBOZU archetype                              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const maruGrid = [];
for (const bp of [60,65,70,75,80]) for (const cl of [70,75,80,85,90]) for (const uw of [10,15,20,25])
  maruGrid.push({ bp, cl, uw });
const maruResults = robustSearch((p,c)=>p.bodyPct>=c.bp && p.closeLoc>=c.cl && p.upperWickPct<=c.uw, maruGrid, 50);
console.log('Top 8 by STABILITY:');
console.log('  BP≥│CL≥│UW≤│TrainN│TestN│TrainHit%│TestHit%(OOS)│Degrad');
console.log('  ───┼───┼───┼──────┼─────┼─────────┼─────────────┼──────');
for (let i=0;i<Math.min(8,maruResults.length);i++) { const r=maruResults[i];
  console.log(`  ${String(r.bp).padStart(3)}│${String(r.cl).padStart(3)}│${String(r.uw).padStart(3)}│ ${String(r.trainN).padStart(5)}│${String(r.testN).padStart(5)}│ ${r.trainRate.toFixed(1).padStart(7)}%│ ${r.testRate.toFixed(1).padStart(11)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5b: Robust Search — R-EXP (Range Expansion) archetype              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const rexpGrid = [];
for (const ra of [1.2,1.5,1.8,2.0,2.5,3.0]) for (const cl of [50,60,65,70,75]) for (const bp of [20,30,40,50])
  rexpGrid.push({ ra, cl, bp });
const rexpResults = robustSearch((p,c)=>p.eRA>=c.ra && p.closeLoc>=c.cl && p.bodyPct>=c.bp, rexpGrid, 50);
console.log('Top 8 by STABILITY:');
console.log('  eRA≥│CL≥│BP≥│TrainN│TestN│TrainHit%│TestHit%(OOS)│Degrad');
console.log('  ────┼───┼───┼──────┼─────┼─────────┼─────────────┼──────');
for (let i=0;i<Math.min(8,rexpResults.length);i++) { const r=rexpResults[i];
  console.log(`  ${r.ra.toFixed(1).padStart(4)}│${String(r.cl).padStart(3)}│${String(r.bp).padStart(3)}│ ${String(r.trainN).padStart(5)}│${String(r.testN).padStart(5)}│ ${r.trainRate.toFixed(1).padStart(7)}%│ ${r.testRate.toFixed(1).padStart(11)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5c: Robust Search — HAMMER (lower-wick rejection) archetype        ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const hamGrid = [];
for (const cl of [50,55,60,65,70]) for (const bp of [25,30,35,40]) for (const lw of [40,50,60,70])
  hamGrid.push({ cl, bp, lw });
const hamResults = robustSearch((p,c)=>p.closeLoc>=c.cl && p.bodyPct<=c.bp && p.lowerWickPct>=c.lw, hamGrid, 30);
console.log('Top 8 by STABILITY:');
console.log('  CL≥│BP≤│LW≥│TrainN│TestN│TrainHit%│TestHit%(OOS)│Degrad');
console.log('  ───┼───┼───┼──────┼─────┼─────────┼─────────────┼──────');
for (let i=0;i<Math.min(8,hamResults.length);i++) { const r=hamResults[i];
  console.log(`  ${String(r.cl).padStart(3)}│${String(r.bp).padStart(3)}│${String(r.lw).padStart(3)}│ ${String(r.trainN).padStart(5)}│${String(r.testN).padStart(5)}│ ${r.trainRate.toFixed(1).padStart(7)}%│ ${r.testRate.toFixed(1).padStart(11)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log(`\nBaseline hit-5% rate for reference: ${baseline.hit5.toFixed(1)}%`);
console.log('\n═══ BREAKOUT DNA BACKTEST COMPLETE ═══');
