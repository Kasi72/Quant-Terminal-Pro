// ═══════════════════════════════════════════════════════════════════════════════
// DEEP WICK/BODY/VOLUME/ATR ANALYSIS — Designing a new Candle DNA Score
// ═══════════════════════════════════════════════════════════════════════════════
// Goal: Go far beyond closeLoc/upperWick/bodyPct. Test granular candle anatomy
// features (wick ratios, wick-to-ATR, multi-candle wick trends, volume-weighted
// rejection, body momentum) against forward returns, then design an intuitive
// composite score.
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

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  DEEP WICK/BODY/VOLUME/ATR ANALYSIS — Designing Candle DNA Score');
console.log('  Testing 20+ granular candle anatomy features on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Build a rich candle-feature dataset (only on breakout-context candles
// — i.e. candle closes above a recent N-bar high, since that's when traders use
// candle quality to decide entry; testing on ALL candles would dilute signal)
// ═══════════════════════════════════════════════════════════════════════════════

const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 21; i++) {
    const s = c[i];
    if (s.c <= 0 || atr[i] <= 0) continue;
    const rng = s.h - s.l;
    if (rng <= 0) continue;

    // Only candles breaking above prior 20-bar high (the "decision moment")
    let prior20High = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0 && c[j].h > prior20High) prior20High = c[j].h; }
    if (s.c <= prior20High * 1.001) continue; // must be a fresh breakout candle

    const v20 = volAvg(c, i, 20);
    const evr20 = v20 > 0 ? s.v / v20 : 0;
    if (evr20 < 1.0) continue; // baseline: needs at least average volume to matter

    // ── BASIC (existing) ──
    const closeLoc = (s.c - s.l) / rng * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const lowerWick = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const isGreen = s.c > s.o;

    // ── DEEP WICK RATIOS ──
    const bodySize = Math.abs(s.c - s.o);
    const upperWickAbs = s.h - Math.max(s.c, s.o);
    const lowerWickAbs = Math.min(s.c, s.o) - s.l;
    const wickToBodyRatio = bodySize > 0.001 ? (upperWickAbs + lowerWickAbs) / bodySize : 99;
    const upperToLowerWickRatio = lowerWickAbs > 0.001 ? upperWickAbs / lowerWickAbs : (upperWickAbs > 0.001 ? 99 : 1);
    const wickAsymmetry = (upperWickAbs - lowerWickAbs) / (rng || 1) * 100; // positive = top-heavy (bad), negative = bottom-heavy (good)

    // ── WICK RELATIVE TO ATR (not just candle range) ──
    const upperWickATR = upperWickAbs / atr[i];
    const lowerWickATR = lowerWickAbs / atr[i];
    const bodyATR = bodySize / atr[i];

    // ── MULTI-CANDLE WICK TREND (last 3 candles upper wick trend) ──
    let wickTrend3 = 0; // negative = shrinking upper wicks (bullish), positive = growing (bearish)
    if (i >= 3) {
      const uw1 = c[i-1].h - Math.max(c[i-1].c, c[i-1].o);
      const uw2 = c[i-2].h - Math.max(c[i-2].c, c[i-2].o);
      const r1 = c[i-1].h - c[i-1].l, r2 = c[i-2].h - c[i-2].l;
      const uwPct1 = r1 > 0 ? uw1 / r1 * 100 : 0, uwPct2 = r2 > 0 ? uw2 / r2 * 100 : 0;
      wickTrend3 = uwPct1 - uwPct2; // change in upper wick % over last 2 candles before signal
    }

    // ── VOLUME-WEIGHTED REJECTION (did high volume reject the highs?) ──
    // High upper wick + high volume = strong rejection (BAD for breakout)
    // Low upper wick + high volume = strong acceptance (GOOD for breakout)
    const volRejectionScore = evr20 * (upperWick / 100); // higher = more volume-confirmed rejection

    // ── BODY MOMENTUM (is body growing vs prior candle?) ──
    let bodyMomentum = 0;
    if (i >= 1) {
      const prevBody = Math.abs(c[i-1].c - c[i-1].o);
      bodyMomentum = prevBody > 0.001 ? (bodySize - prevBody) / prevBody * 100 : 0;
    }

    // ── DOJI-NESS (how indecisive is the candle) ──
    const dojiScore = rng > 0 ? 100 - (bodySize / rng * 100) : 100; // high = doji-like (bad)

    // ── MARUBOZU-NESS (no wicks at all = max conviction) ──
    const marubozuScore = 100 - ((upperWick + lowerWick)); // high = marubozu (good)

    // ── GAP CONTEXT ──
    const gap = i > 0 ? (s.o - c[i-1].c) / c[i-1].c * 100 : 0;

    // ── CLOSE-TO-HIGH GAP (how far is close from the high — inverse of upperWick basically but raw %) ──
    const closeToHighPct = (s.h - s.c) / s.c * 100;

    // ── 3-candle average closeLoc (consistency of strong closes) ──
    let avgCloseLoc3 = closeLoc;
    if (i >= 2) {
      const cl1 = (c[i-1].h - c[i-1].l) > 0 ? (c[i-1].c - c[i-1].l) / (c[i-1].h - c[i-1].l) * 100 : 50;
      const cl2 = (c[i-2].h - c[i-2].l) > 0 ? (c[i-2].c - c[i-2].l) / (c[i-2].h - c[i-2].l) * 100 : 50;
      avgCloseLoc3 = (closeLoc + cl1 + cl2) / 3;
    }

    // ── ATR EXPANSION (today's range vs ATR) ──
    const eRA = rng / atr[i];

    // ── Forward outcomes ──
    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5, c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10, c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[Math.min(i+20, c.length-1)].c - s.c) / s.c * 100;

    points.push({
      sym, idx: i, fwd5, fwd10, fwd20, maxH,
      closeLoc, upperWick, lowerWick, bodyPct, isGreen,
      wickToBodyRatio, upperToLowerWickRatio, wickAsymmetry,
      upperWickATR, lowerWickATR, bodyATR,
      wickTrend3, volRejectionScore, bodyMomentum,
      dojiScore, marubozuScore, gap, closeToHighPct, avgCloseLoc3,
      eRA, evr20,
    });
  }
}
console.log(`Total breakout-context candles analyzed: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Bucket each NEW feature and measure forward-return predictive power
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  FEATURE POWER RANKING — New Deep Wick/Body/Volume/ATR Metrics            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

function bucketAnalysis(label, fn, buckets) {
  console.log(`── ${label} ──`);
  console.log('  Bucket            │ Count   │ Avg5d% │ Avg10d%│ Avg20d%│ AvgMFE%│ Win%(>0)│ >5%Rate');
  console.log('  ──────────────────┼─────────┼────────┼────────┼────────┼────────┼─────────┼────────');
  for (const [lo, hi, bl] of buckets) {
    const pts = points.filter(p => { const v = fn(p); return v != null && v >= lo && v < hi; });
    if (pts.length < 30) continue;
    const a5 = avg(pts.map(p => p.fwd5)), a10 = avg(pts.map(p => p.fwd10)), a20 = avg(pts.map(p => p.fwd20));
    const aMFE = avg(pts.map(p => p.maxH));
    const winRate = pct(pts, p => p.fwd20 > 0);
    const gt5 = pct(pts, p => p.fwd20 > 5);
    console.log(`  ${bl.padEnd(18)}│ ${String(pts.length).padStart(7)} │ ${(a5>=0?'+':'')+a5.toFixed(2).padStart(5)}%│ ${(a10>=0?'+':'')+a10.toFixed(2).padStart(5)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${winRate.toFixed(1).padStart(6)}% │ ${gt5.toFixed(1).padStart(5)}%`);
  }
  console.log('');
}

bucketAnalysis('Wick-to-Body Ratio (lower=more body-dominant)', p => p.wickToBodyRatio, [[0,0.3,'<0.3'],[0.3,0.6,'0.3-0.6'],[0.6,1.0,'0.6-1.0'],[1.0,1.5,'1.0-1.5'],[1.5,3.0,'1.5-3.0'],[3.0,999,'>3.0']]);
bucketAnalysis('Upper:Lower Wick Ratio (lower=less top wick)', p => p.upperToLowerWickRatio, [[0,0.3,'<0.3'],[0.3,0.6,'0.3-0.6'],[0.6,1.0,'0.6-1.0'],[1.0,2.0,'1.0-2.0'],[2.0,5.0,'2.0-5.0'],[5.0,999,'>5.0']]);
bucketAnalysis('Wick Asymmetry % (negative=bottom-heavy)', p => p.wickAsymmetry, [[-100,-20,'<-20'],[-20,-10,'-20to-10'],[-10,0,'-10to0'],[0,10,'0to10'],[10,20,'10to20'],[20,100,'>20']]);
bucketAnalysis('Upper Wick / ATR (lower=tighter rejection)', p => p.upperWickATR, [[0,0.1,'<0.1'],[0.1,0.2,'0.1-0.2'],[0.2,0.3,'0.2-0.3'],[0.3,0.5,'0.3-0.5'],[0.5,1.0,'0.5-1.0'],[1.0,999,'>1.0']]);
bucketAnalysis('Body / ATR (higher=bigger conviction move)', p => p.bodyATR, [[0,0.3,'<0.3'],[0.3,0.6,'0.3-0.6'],[0.6,1.0,'0.6-1.0'],[1.0,1.5,'1.0-1.5'],[1.5,2.5,'1.5-2.5'],[2.5,999,'>2.5']]);
bucketAnalysis('3-Candle Wick Trend (negative=shrinking wicks)', p => p.wickTrend3, [[-100,-10,'<-10'],[-10,-3,'-10to-3'],[-3,3,'-3to3'],[3,10,'3to10'],[10,100,'>10']]);
bucketAnalysis('Volume Rejection Score (lower=less reject)', p => p.volRejectionScore, [[0,0.3,'<0.3'],[0.3,0.6,'0.3-0.6'],[0.6,1.0,'0.6-1.0'],[1.0,2.0,'1.0-2.0'],[2.0,999,'>2.0']]);
bucketAnalysis('Body Momentum % (vs prior candle)', p => p.bodyMomentum, [[-100,-50,'<-50'],[-50,0,'-50to0'],[0,50,'0to50'],[50,150,'50to150'],[150,9999,'>150']]);
bucketAnalysis('Doji Score (lower=more decisive)', p => p.dojiScore, [[0,20,'<20'],[20,40,'20-40'],[40,60,'40-60'],[60,80,'60-80'],[80,100,'>80']]);
bucketAnalysis('Marubozu Score (higher=fewer wicks)', p => p.marubozuScore, [[0,40,'<40'],[40,60,'40-60'],[60,75,'60-75'],[75,90,'75-90'],[90,100,'>90']]);
bucketAnalysis('Close-to-High Gap % (lower=closer to high)', p => p.closeToHighPct, [[0,0.5,'<0.5%'],[0.5,1.0,'0.5-1%'],[1.0,2.0,'1-2%'],[2.0,4.0,'2-4%'],[4.0,999,'>4%']]);
bucketAnalysis('3-Candle Avg CloseLoc (consistency)', p => p.avgCloseLoc3, [[0,40,'<40'],[40,55,'40-55'],[55,70,'55-70'],[70,85,'70-85'],[85,100,'>85']]);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Correlation matrix — is the new metric independent or redundant?
// ═══════════════════════════════════════════════════════════════════════════════
function pearsonR(xs, ys) {
  const n = xs.length; const mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx*dy) : 0;
}

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PREDICTIVE CORRELATION — Each feature vs Forward 20d Return              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const features = [
  ['closeLoc', p => p.closeLoc], ['upperWick', p => p.upperWick], ['bodyPct', p => p.bodyPct],
  ['wickToBodyRatio', p => p.wickToBodyRatio], ['upperToLowerWickRatio', p => p.upperToLowerWickRatio],
  ['wickAsymmetry', p => p.wickAsymmetry], ['upperWickATR', p => p.upperWickATR], ['bodyATR', p => p.bodyATR],
  ['wickTrend3', p => p.wickTrend3], ['volRejectionScore', p => p.volRejectionScore],
  ['bodyMomentum', p => p.bodyMomentum], ['dojiScore', p => p.dojiScore], ['marubozuScore', p => p.marubozuScore],
  ['closeToHighPct', p => p.closeToHighPct], ['avgCloseLoc3', p => p.avgCloseLoc3], ['eRA', p => p.eRA], ['evr20', p => p.evr20],
];
const fwd20Arr = points.map(p => p.fwd20);
const corrResults = features.map(([name, fn]) => ({ name, r: pearsonR(points.map(fn), fwd20Arr) }));
corrResults.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
console.log('  Feature                  │ Pearson r vs Fwd20d │ Strength');
console.log('  ──────────────────────────┼─────────────────────┼─────────');
for (const r of corrResults) {
  const strength = Math.abs(r.r) > 0.05 ? '★★★' : Math.abs(r.r) > 0.03 ? '★★' : Math.abs(r.r) > 0.015 ? '★' : '';
  console.log(`  ${r.name.padEnd(26)}│ ${(r.r>=0?'+':'')+r.r.toFixed(4).padStart(7)}            │ ${strength}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Grid search — best COMBINED Candle DNA filter
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID SEARCH — Best Combined Candle DNA Filter                            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const wbVals = [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 999];
const ulVals = [0.5, 1.0, 2.0, 999];
const uwAtrVals = [0.15, 0.25, 0.4, 999];
const bodyAtrVals = [0, 0.4, 0.6, 0.8, 1.0];
const mbVals = [0, 50, 60, 70, 80];
const volRejVals = [0.3, 0.6, 1.0, 999];

let combos = [];
for (const wb of wbVals) {
  for (const ul of ulVals) {
    for (const uwAtr of uwAtrVals) {
      for (const ba of bodyAtrVals) {
        for (const mb of mbVals) {
          const filtered = points.filter(p => p.wickToBodyRatio <= wb && p.upperToLowerWickRatio <= ul && p.upperWickATR <= uwAtr && p.bodyATR >= ba && p.marubozuScore >= mb);
          if (filtered.length < 30) continue;
          const a20 = avg(filtered.map(p => p.fwd20));
          const aMFE = avg(filtered.map(p => p.maxH));
          const winRate = pct(filtered, p => p.fwd20 > 0);
          const gt5 = pct(filtered, p => p.fwd20 > 5);
          combos.push({ wb, ul, uwAtr, ba, mb, n: filtered.length, a20, aMFE, winRate, gt5 });
        }
      }
    }
  }
}
combos.sort((a, b) => b.a20 - a.a20);
console.log(`Tested ${combos.length} combos\n`);
console.log('Top 15 by Avg 20d Return:');
console.log('  Rank│WB≤ │UL≤ │UWATR≤│BodyATR≥│MB≥ │ Count │Avg20d% │AvgMFE%│Win%  │>5%');
console.log('  ────┼────┼────┼──────┼────────┼────┼───────┼────────┼───────┼──────┼─────');
for (let i = 0; i < Math.min(15, combos.length); i++) {
  const c = combos[i];
  console.log(`  ${String(i+1).padStart(3)} │${c.wb.toFixed(1).padStart(3)} │${c.ul.toFixed(1).padStart(3)} │${c.uwAtr.toFixed(2).padStart(5)} │${c.ba.toFixed(1).padStart(7)} │${String(c.mb).padStart(3)} │${String(c.n).padStart(6)} │${(c.a20>=0?'+':'')+c.a20.toFixed(2).padStart(6)}% │${('+'+c.aMFE.toFixed(1)).padStart(5)}% │${c.winRate.toFixed(0).padStart(4)}% │${c.gt5.toFixed(0).padStart(3)}%`);
}

const balanced = combos.filter(c => c.n >= 100).sort((a,b) => b.a20-a.a20);
console.log('\nTop 10 BALANCED (≥100 signals):');
console.log('  Rank│WB≤ │UL≤ │UWATR≤│BodyATR≥│MB≥ │ Count │Avg20d% │AvgMFE%│Win%  │>5%');
console.log('  ────┼────┼────┼──────┼────────┼────┼───────┼────────┼───────┼──────┼─────');
for (let i = 0; i < Math.min(10, balanced.length); i++) {
  const c = balanced[i];
  console.log(`  ${String(i+1).padStart(3)} │${c.wb.toFixed(1).padStart(3)} │${c.ul.toFixed(1).padStart(3)} │${c.uwAtr.toFixed(2).padStart(5)} │${c.ba.toFixed(1).padStart(7)} │${String(c.mb).padStart(3)} │${String(c.n).padStart(6)} │${(c.a20>=0?'+':'')+c.a20.toFixed(2).padStart(6)}% │${('+'+c.aMFE.toFixed(1)).padStart(5)}% │${c.winRate.toFixed(0).padStart(4)}% │${c.gt5.toFixed(0).padStart(3)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Baseline comparison
// ═══════════════════════════════════════════════════════════════════════════════
const baseline = { a20: avg(points.map(p => p.fwd20)), winRate: pct(points, p => p.fwd20 > 0), gt5: pct(points, p => p.fwd20 > 5) };
console.log(`\nBASELINE (all breakout candles, no DNA filter): Avg20d ${baseline.a20>=0?'+':''}${baseline.a20.toFixed(2)}%, Win% ${baseline.winRate.toFixed(1)}%, >5% rate ${baseline.gt5.toFixed(1)}%`);

if (balanced.length > 0) {
  const best = balanced[0];
  console.log(`\nBEST BALANCED EDGE vs BASELINE: +${(best.a20 - baseline.a20).toFixed(2)}% per trade, +${(best.winRate - baseline.winRate).toFixed(1)}pp win rate`);
}

console.log('\n═══ DEEP WICK/BODY ANALYSIS COMPLETE ═══');
