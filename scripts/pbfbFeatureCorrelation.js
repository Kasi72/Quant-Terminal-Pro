// ═══════════════════════════════════════════════════════════════════════════════
// PBFB DEEP-DIVE — Feature correlation analysis on the Post-Breakout Forensic
// Backtest's three buckets (ON_RADAR / MISSED). Tests whether ATR%, candle
// DNA (body/wick/closeLoc), momentum (mom5), volume, RSI2, or distance-from-
// high features — independent of the zone-breakout engine — carry any signal
// the zone engine doesn't, by comparing event-day-before snapshots against a
// CONTROL sample of ordinary (non-event) days on the same stocks.
//
// Requires scripts/_compiled (run postBreakoutForensicBacktest.js's compile
// step first if not already done).
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled');
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

const PARAM_SETS = ['optimized_deployable_20plus', 'optimized_highprecision_15plus', 'optimized_elite_10plus', 'optimized_ultraselective_8plus', 'sniper_95plus'];
const ON_RADAR = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH']);
const stageRank = { ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4, EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1 };

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ ts: 0, date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
function computeATR14Array(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)); a[i] = (a[i-1] * 13 + tr) / 14; }
  return a;
}

// Computes the alternative-signal feature set at index i (the LAST candle
// included before the breakout — i.e. "the day before").
function computeFeatures(c, atr, i) {
  const s = c[i], rng = s.h - s.l;
  if (rng <= 0 || atr[i] <= 0 || s.c <= 0) return null;
  const closeLoc = (s.c - s.l) / rng * 100;
  const upperWickPct = (s.h - Math.max(s.c, s.o)) / rng * 100;
  const lowerWickPct = (Math.min(s.c, s.o) - s.l) / rng * 100;
  const bodyPct = Math.abs(s.c - s.o) / rng * 100;
  const eRA = rng / atr[i];
  const atrPctVal = atr[i] / s.c * 100;

  let v20 = 0, n20 = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) { v20 += c[j].v; n20++; }
  v20 = n20 > 0 ? v20 / n20 : 1;
  const volRatio20 = v20 > 0 ? s.v / v20 : 0;

  let pre10VR = 0, p10n = 0;
  for (let j = i - 10; j < i; j++) { if (j >= 0 && v20 > 0) { pre10VR += c[j].v / v20; p10n++; } }
  pre10VR = p10n > 0 ? pre10VR / p10n : 1;

  const mom5 = i >= 5 ? (s.c - c[i-5].c) / c[i-5].c * 100 : 0;

  let sma50 = 0;
  if (i >= 49) { let s50 = 0; for (let j = i - 49; j <= i; j++) s50 += c[j].c; sma50 = s50 / 50; }
  const aboveSMA50 = sma50 > 0 && s.c > sma50;

  let high50 = 0;
  for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].h > high50) high50 = c[j].h; }
  const swingDist = high50 > 0 ? (s.c - high50) / high50 * 100 : 0;

  let rsi2 = 50;
  if (i >= 2) {
    const ch1 = s.c - c[i-1].c, ch2 = c[i-1].c - c[i-2].c;
    const g = ((ch1>0?ch1:0)+(ch2>0?ch2:0))/2, l = ((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
    rsi2 = l < 0.001 ? 100 : 100 - 100/(1+g/l);
  }

  // ATR percentile vs prior 120 days
  let atrPctl = 50;
  if (i >= 120) {
    let below = 0, cnt = 0;
    for (let j = i - 120; j < i; j++) { if (atr[j] > 0) { cnt++; if (atr[j]/c[j].c*100 <= atrPctVal) below++; } }
    atrPctl = cnt > 0 ? below / cnt * 100 : 50;
  }

  return { closeLoc, upperWickPct, lowerWickPct, bodyPct, eRA, atrPctVal, atrPctl, volRatio20, pre10VR, mom5, aboveSMA50, swingDist, rsi2 };
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  PBFB DEEP-DIVE — feature correlation: what predicts monster moves the zone engine misses?');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'));
console.log(`Scanning ${files.length} stocks...\n`);

const eventRows = [];   // 1 row per monster-move event, features at day-before
const controlRows = []; // 1 row per random non-event day, same feature set

for (const f of files) {
  const candles = parseYahoo(path.join(DATA_DIR, f));
  if (candles.length < 150) continue;
  const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');
  const atr = computeATR14Array(candles);

  // Find event indices first (reuse same definition as PBFB)
  const eventIdx = new Set();
  for (let i = 60; i < candles.length - 1; i++) {
    const prev = candles[i - 1], cur = candles[i];
    if (prev.c <= 0) continue;
    const chgPct = (cur.c - prev.c) / prev.c * 100;
    if (chgPct < 7 || chgPct > 80) continue;
    let v20 = 0, n = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0) { v20 += candles[j].v; n++; } }
    v20 = n > 0 ? v20 / n : 0;
    if (v20 <= 0 || cur.v < v20 * 3) continue;
    eventIdx.add(i);
  }

  for (const i of eventIdx) {
    const dayBefore = i - 1;
    if (dayBefore < 60) continue;
    const feat = computeFeatures(candles, atr, dayBefore);
    if (!feat) continue;
    const truncated = candles.slice(0, dayBefore + 1);

    let bestStage = 'NO_SIGNAL';
    for (const key of PARAM_SETS) {
      let r;
      try { r = analyzeStock(truncated, key); } catch { continue; }
      if (stageRank[r.stage] > stageRank[bestStage]) bestStage = r.stage;
    }
    const chgPct = (candles[i].c - candles[i-1].c) / candles[i-1].c * 100;
    eventRows.push({ sym, ...feat, bestStage, onRadar: ON_RADAR.has(bestStage), chgPct });
  }

  // Control sample: random non-event days, spaced out, requiring no >=5%
  // move in the NEXT 3 days (so it's genuinely an "ordinary" day, not just
  // a day that missed the 7% cutoff by a hair)
  for (let i = 60; i < candles.length - 4; i += 17) {
    if (eventIdx.has(i) || eventIdx.has(i+1) || eventIdx.has(i+2)) continue;
    let movesNext3 = false;
    for (let j = i + 1; j <= Math.min(i + 3, candles.length - 1); j++) {
      if (candles[j-1].c > 0 && (candles[j].c - candles[j-1].c) / candles[j-1].c * 100 >= 5) { movesNext3 = true; break; }
    }
    if (movesNext3) continue;
    const feat = computeFeatures(candles, atr, i);
    if (!feat) continue;
    controlRows.push({ sym, ...feat });
  }
}

console.log(`Event rows (day-before snapshots): ${eventRows.length}`);
console.log(`Control rows (ordinary days):       ${controlRows.length}\n`);

const onRadarRows = eventRows.filter(r => r.onRadar);
const missedRows = eventRows.filter(r => !r.onRadar);
console.log(`On-radar events: ${onRadarRows.length}  |  Missed events: ${missedRows.length}\n`);

function avg(arr, fn) { return arr.length > 0 ? arr.reduce((s,r)=>s+fn(r),0)/arr.length : 0; }
function median(arr, fn) { const v = arr.map(fn).sort((a,b)=>a-b); return v.length ? v[Math.floor(v.length/2)] : 0; }
function pearsonR(xs, ys) {
  const mx = xs.reduce((s,v)=>s+v,0)/xs.length, my = ys.reduce((s,v)=>s+v,0)/ys.length;
  let num=0,dx=0,dy=0;
  for (let i=0;i<xs.length;i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx>0&&dy>0 ? num/Math.sqrt(dx*dy) : 0;
}

// ═══ STEP 1: Feature means — ON_RADAR vs MISSED vs CONTROL ═══
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 1: Feature averages — ON_RADAR vs MISSED vs CONTROL (ordinary days) ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const feats = [
  ['mom5 (5d momentum %)', r => r.mom5],
  ['eRA (range/ATR)', r => r.eRA],
  ['atrPctVal (ATR14%)', r => r.atrPctVal],
  ['atrPctl (ATR percentile)', r => r.atrPctl],
  ['volRatio20 (vol vs 20d avg)', r => r.volRatio20],
  ['pre10VR (pre-10d vol ratio)', r => r.pre10VR],
  ['rsi2', r => r.rsi2],
  ['swingDist (% off 50d high)', r => r.swingDist],
  ['closeLoc %', r => r.closeLoc],
  ['bodyPct %', r => r.bodyPct],
  ['upperWickPct %', r => r.upperWickPct],
  ['lowerWickPct %', r => r.lowerWickPct],
];
console.log('  Feature                      │ ON_RADAR avg │ MISSED avg   │ CONTROL avg  │ Missed-vs-Control Δ');
console.log('  ──────────────────────────────┼──────────────┼──────────────┼──────────────┼─────────────────────');
for (const [name, fn] of feats) {
  const oa = avg(onRadarRows, fn), ma = avg(missedRows, fn), ca = avg(controlRows, fn);
  const delta = ma - ca;
  console.log(`  ${name.padEnd(30)}│ ${oa.toFixed(2).padStart(12)} │ ${ma.toFixed(2).padStart(12)} │ ${ca.toFixed(2).padStart(12)} │ ${(delta>=0?'+':'')+delta.toFixed(2)}`);
}
console.log(`\n  aboveSMA50 rate: ON_RADAR=${(onRadarRows.filter(r=>r.aboveSMA50).length/Math.max(1,onRadarRows.length)*100).toFixed(1)}%  MISSED=${(missedRows.filter(r=>r.aboveSMA50).length/Math.max(1,missedRows.length)*100).toFixed(1)}%  CONTROL=${(controlRows.filter(r=>r.aboveSMA50).length/Math.max(1,controlRows.length)*100).toFixed(1)}%`);

// ═══ STEP 2: Does ANY feature discriminate MISSED-events from CONTROL? ═══
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: Correlation — feature vs "is this a monster-move event" (MISSED only vs CONTROL)║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const combined = [...missedRows.map(r => ({...r, isEvent: 1})), ...controlRows.map(r => ({...r, isEvent: 0}))];
const corrResults = feats.map(([name, fn]) => ({ name, r: pearsonR(combined.map(fn), combined.map(c => c.isEvent)) }));
corrResults.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
console.log('  Feature                      │ r vs (this becomes a monster move tomorrow)');
console.log('  ──────────────────────────────┼─────────────────────────────────────────────');
for (const c of corrResults) console.log(`  ${c.name.padEnd(30)}│ ${(c.r>=0?'+':'')+c.r.toFixed(4)}`);

// ═══ STEP 3: Elevated-rate test — for the strongest features, what % of MISSED events show an "elevated" reading vs control baseline rate? ═══
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: Elevated-rate test on top correlated features                    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const top3 = corrResults.slice(0, 4);
for (const { name } of top3) {
  const fn = feats.find(f => f[0] === name)[1];
  const ctrlVals = controlRows.map(fn).sort((a,b)=>a-b);
  const p80 = ctrlVals[Math.floor(ctrlVals.length * 0.8)];
  const missedAbove = missedRows.filter(r => fn(r) >= p80).length;
  const ctrlAbove = controlRows.filter(r => fn(r) >= p80).length;
  console.log(`  ${name}: control 80th-pctile=${p80.toFixed(2)}`);
  console.log(`    MISSED events above this level: ${missedAbove}/${missedRows.length} (${(missedAbove/missedRows.length*100).toFixed(1)}%)`);
  console.log(`    CONTROL days above this level:  ${ctrlAbove}/${controlRows.length} (${(ctrlAbove/controlRows.length*100).toFixed(1)}%, expected ~20.0% by construction)\n`);
}

// ═══ STEP 4: Composite alternative-signal test on MISSED events ═══
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Composite alternative-signal — would a non-zone-based filter catch MISSED events?║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
// Build a simple composite: mom5 strong + volRatio elevated + above SMA50 (momentum-continuation style, NOT zone-based)
function altSignal(r) { return r.mom5 >= 5 && r.volRatio20 >= 1.3 && r.aboveSMA50; }
const missedCaught = missedRows.filter(altSignal).length;
const controlFlagged = controlRows.filter(altSignal).length;
console.log(`  Alt filter: mom5>=5% AND volRatio20>=1.3x AND aboveSMA50`);
console.log(`  MISSED events this WOULD catch: ${missedCaught}/${missedRows.length} (${(missedCaught/missedRows.length*100).toFixed(1)}%)`);
console.log(`  CONTROL days falsely flagged:    ${controlFlagged}/${controlRows.length} (${(controlFlagged/controlRows.length*100).toFixed(1)}%) — false positive rate`);

console.log('\n═══ PBFB DEEP-DIVE COMPLETE ═══');
