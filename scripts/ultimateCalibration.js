// ═══════════════════════════════════════════════════════════════════════════════
// ULTIMATE CALIBRATION BACKTEST — 1617 NSE Stocks
// Features: CandleDNA · ATR Compression State · Volume Thrust Badge
//
// Methodology:
//   • Breakout-context only: bar closes above prior 20-bar high with compression
//   • All features computed with ZERO lookahead (data[0..i] only)
//   • Forward outcomes: 5d / 10d / 20d close return + 20d MFE + max drawdown 10d
//   • Pearson r, decile analysis, grid search → recommended thresholds
//
// Usage: node scripts/ultimateCalibration.js [section]
//   section: all | dna | atr | vol  (default: all)
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const SECTION  = process.argv[2] || 'all'; // all | dna | atr | vol

// ─── Parse Yahoo CSV ────────────────────────────────────────────────────────
function parseCSV(fp) {
  try {
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      if (p.length < 6) continue;
      const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
      if (!c || c <= 0 || isNaN(c)) continue;
      // Sanitize: h >= max(o,c), l <= min(o,c)
      const sh = Math.max(h, o, c);
      const sl = Math.min(l, o, c);
      out.push({ d: p[0], o: +o || c, h: sh, l: sl, c, v: v || 0 });
    }
    return out;
  } catch { return []; }
}

// ─── ATR14 (Wilder EMA) ─────────────────────────────────────────────────────
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) {
    s += Math.max(c[i].h - c[i].l,
                  Math.abs(c[i].h - c[i-1].c),
                  Math.abs(c[i].l - c[i-1].c));
  }
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l,
                        Math.abs(c[i].h - c[i-1].c),
                        Math.abs(c[i].l - c[i-1].c));
    a[i] = (a[i-1] * 13 + tr) / 14;
  }
  return a;
}

// ─── ATR Percentile-120 ─────────────────────────────────────────────────────
function atrPctl(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) {
    const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0;
    if (v < cur) below++;
  }
  return below / 120 * 100;
}

// ─── Volume helpers ─────────────────────────────────────────────────────────
function volAvg(c, idx, n) {
  let s = 0, cnt = 0;
  for (let j = Math.max(0, idx - n); j < idx; j++) { s += c[j].v; cnt++; }
  return cnt > 0 ? s / cnt : 1;
}
function prevolAvg(c, idx) { // pre-5: bars [idx-6..idx-2]
  let s = 0, cnt = 0;
  for (let j = Math.max(0, idx - 6); j < idx - 1; j++) { s += c[j].v; cnt++; }
  return cnt > 0 ? s / cnt : 1;
}
function redVolBias(c, idx) { // avg vol of red candles in prior 10 / mean vol
  let redVol = 0, redN = 0, totV = 0, totN = 0;
  for (let j = Math.max(0, idx - 11); j < idx - 1; j++) {
    totV += c[j].v; totN++;
    if (c[j].c < c[j].o) { redVol += c[j].v; redN++; }
  }
  const meanV = totN > 0 ? totV / totN : 1;
  return redN > 0 ? (redVol / redN) / meanV : 0;
}

// ─── Compression zone finder ─────────────────────────────────────────────────
function findZone(c, atr, sigIdx) {
  const MIN_LEN = 6, MAX_LEN = 30, RANGE_ATR_MAX = 1.0, MAX_TIGHT = 15;
  const zone = [];
  for (let j = sigIdx - 1; j >= Math.max(1, sigIdx - MAX_LEN); j--) {
    if (atr[j] <= 0) break;
    if ((c[j].h - c[j].l) / atr[j] > RANGE_ATR_MAX) break;
    zone.unshift(j);
  }
  if (zone.length < MIN_LEN) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zone) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > MAX_TIGHT) return null;
  return { zH, zL, len: zone.length, zt };
}

// ─── Load all stocks ─────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  ULTIMATE CALIBRATION BACKTEST — CandleDNA · ATR State · Volume Thrust');
console.log(`  Dataset: ${DATA_DIR}`);
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
console.log(`Loading ${files.length} CSV files...\n`);

const allStocks = [];
for (const f of files) {
  const c = parseCSV(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  const atr = computeATR14(c);
  const sym = f.replace('_NS_OHLCV.csv','').replace('.csv','');
  allStocks.push({ sym, c, atr });
}
console.log(`Usable stocks: ${allStocks.length}\n`);

// ─── Build signal dataset ────────────────────────────────────────────────────
// Signal context: bar closes above prior 20-bar high with a valid compression zone
// This exactly mirrors how the screener identifies BUY signals

console.log('Scanning bars for breakout-context signals (this takes ~30 seconds)...\n');

const points = [];

for (const { sym, c, atr } of allStocks) {
  for (let i = 135; i < c.length - 21; i++) {
    const s = c[i];
    if (!s || s.c <= 0 || atr[i] <= 0) continue;
    const rng = s.h - s.l;
    if (rng <= 0) continue;

    // Must have closed above prior 20-bar high (fresh breakout)
    let p20H = 0;
    for (let j = i - 20; j < i; j++) if (j >= 0 && c[j].h > p20H) p20H = c[j].h;
    if (s.c < p20H * 0.998) continue;

    // Must have a valid compression zone behind it
    const zone = findZone(c, atr, i);
    if (!zone) continue;

    // Must have adequate volume (at least 0.8x avg)
    const avgV20 = volAvg(c, i, 20);
    if (avgV20 <= 0 || s.v < avgV20 * 0.8) continue;

    // ── CandleDNA features ──────────────────────────────────────────────────
    const bodySize    = Math.abs(s.c - s.o);
    const upperWickAbs = s.h - Math.max(s.c, s.o);
    const lowerWickAbs = Math.min(s.c, s.o) - s.l;
    const upperWick   = upperWickAbs / rng * 100;
    const lowerWick   = lowerWickAbs / rng * 100;
    const closeLoc    = (s.c - s.l) / rng * 100;
    const bodyPct     = bodySize / rng * 100;
    const bodyATR     = bodySize / atr[i];
    const eRA         = rng / atr[i];
    const upperWickATR = upperWickAbs / atr[i];
    const lowerWickATR = lowerWickAbs / atr[i];
    const ULRatio     = lowerWickAbs > 0.001 ? upperWickAbs / lowerWickAbs : (upperWickAbs > 0.001 ? 99 : 1);
    const wickToBody  = bodySize > 0.001 ? (upperWickAbs + lowerWickAbs) / bodySize : 99;
    const marubozu    = Math.max(0, 100 - (upperWick + lowerWick));
    const volRejScore = (s.v / avgV20) * (upperWick / 100);
    // 3-candle avg close loc
    let avgCL3 = closeLoc;
    if (i >= 2) {
      const cl1 = (c[i-1].h - c[i-1].l) > 0 ? (c[i-1].c - c[i-1].l) / (c[i-1].h - c[i-1].l) * 100 : 50;
      const cl2 = (c[i-2].h - c[i-2].l) > 0 ? (c[i-2].c - c[i-2].l) / (c[i-2].h - c[i-2].l) * 100 : 50;
      avgCL3 = (closeLoc + cl1 + cl2) / 3;
    }
    // Body momentum vs prior candle
    const prevBody = i >= 1 ? Math.abs(c[i-1].c - c[i-1].o) : bodySize;
    const bodyMom  = prevBody > 0.001 ? (bodySize - prevBody) / prevBody * 100 : 0;
    // 3-candle wick trend (shrinking upper wicks = bullish)
    let wickTrend3 = 0;
    if (i >= 2) {
      const uw1 = (c[i-1].h - c[i-1].l) > 0 ? (c[i-1].h - Math.max(c[i-1].c, c[i-1].o)) / (c[i-1].h - c[i-1].l) * 100 : 0;
      const uw2 = (c[i-2].h - c[i-2].l) > 0 ? (c[i-2].h - Math.max(c[i-2].c, c[i-2].o)) / (c[i-2].h - c[i-2].l) * 100 : 0;
      wickTrend3 = uw1 - uw2;
    }

    // ── ATR State features ──────────────────────────────────────────────────
    const pctl      = atrPctl(c, atr, i);
    const adrPct    = s.c > 0 ? atr[i] / s.c * 100 : 0;
    const volExpRatio = eRA; // volatility expansion ratio on signal bar

    // ── Volume Badge features ───────────────────────────────────────────────
    const vr20      = s.v / avgV20;
    const pv5       = prevolAvg(c, i);
    const vp5       = pv5 > 0 ? s.v / pv5 : 0;
    const rvb       = redVolBias(c, i);

    // ── Forward outcomes (no lookahead) ─────────────────────────────────────
    let mfe20 = 0, mdd10 = 0, fwd5 = 0, fwd10 = 0, fwd20 = 0;
    for (let j = 1; j <= 20 && i + j < c.length; j++) {
      const ret = (c[i+j].h - s.c) / s.c * 100;
      if (ret > mfe20) mfe20 = ret;
      if (j <= 10) {
        const dd = (s.c - c[i+j].l) / s.c * 100;
        if (dd > mdd10) mdd10 = dd;
      }
      if (j === 5)  fwd5  = (c[i+5].c  - s.c) / s.c * 100;
      if (j === 10) fwd10 = (c[i+10].c - s.c) / s.c * 100;
      if (j === 20) fwd20 = (c[i+20].c - s.c) / s.c * 100;
    }

    points.push({
      sym, i, fwd5, fwd10, fwd20, mfe20, mdd10,
      // DNA
      bodyATR, eRA, ULRatio, marubozu, wickToBody, upperWickATR, lowerWickATR,
      closeLoc, bodyPct, upperWick, lowerWick, avgCL3, bodyMom, wickTrend3, volRejScore,
      // ATR State
      pctl, adrPct, volExpRatio,
      // Volume Badge
      vr20, vp5, rvb,
      // Zone
      zLen: zone.len, zTight: zone.zt,
    });
  }
}

console.log(`Total breakout-context signals: ${points.length.toLocaleString()}\n`);

// ─── Statistics helpers ──────────────────────────────────────────────────────
function avg(arr) { return arr.length > 0 ? arr.reduce((s,v) => s+v, 0) / arr.length : 0; }
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a,b) => a-b);
  return s[Math.floor(s.length/2)];
}
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }
function pearsonR(xs, ys) {
  const n = xs.length, mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx*dy) : 0;
}
function stars(r) { const a = Math.abs(r); return a>0.06?'★★★★':a>0.04?'★★★':a>0.025?'★★':a>0.012?'★':''; }
function fmtPct(v, w=7) { return ((v>=0?'+':'')+v.toFixed(2)+'%').padStart(w); }
function row(pts, label='') {
  if (pts.length < 15) return null;
  return {
    n: pts.length,
    a5: avg(pts.map(p => p.fwd5)),
    a10: avg(pts.map(p => p.fwd10)),
    a20: avg(pts.map(p => p.fwd20)),
    mfe: avg(pts.map(p => p.mfe20)),
    mdd: avg(pts.map(p => p.mdd10)),
    win: pct(pts, p => p.fwd20 > 0),
    gt3: pct(pts, p => p.fwd20 > 3),
    gt5: pct(pts, p => p.fwd20 > 5),
    gt10: pct(pts, p => p.fwd20 > 10),
  };
}
function printTable(rows, colLabel='Bucket') {
  const hdr = `  ${colLabel.padEnd(22)}│ Count  │ Avg5d  │ Avg10d │ Avg20d │ MFE20d │  MDD10d│ Win%  │ >3%  │ >5%  │ >10%`;
  const sep = '  ' + '─'.repeat(22) + '┼' + '───────┼'.repeat(9) + '──────';
  console.log(hdr);
  console.log(sep);
  for (const [label, r] of rows) {
    if (!r) continue;
    console.log(`  ${label.padEnd(22)}│${String(r.n).padStart(7)} │${fmtPct(r.a5)} │${fmtPct(r.a10)} │${fmtPct(r.a20)} │${fmtPct(r.mfe)} │${fmtPct(-r.mdd)} │${r.win.toFixed(1).padStart(5)}% │${r.gt3.toFixed(1).padStart(4)}% │${r.gt5.toFixed(1).padStart(4)}% │${r.gt10.toFixed(1).padStart(4)}%`);
  }
  console.log('');
}
function bucketBy(fn, buckets) {
  return buckets.map(([lo, hi, label]) => [label, row(points.filter(p => { const v = fn(p); return v >= lo && v < hi; }))]);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: CANDLE DNA CALIBRATION
// ════════════════════════════════════════════════════════════════════════════

if (SECTION === 'all' || SECTION === 'dna') {

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 1: CANDLE DNA CALIBRATION                                          ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

// ── 1A: Predictive correlation ─────────────────────────────────────────────
console.log('── 1A: Feature Predictive Correlation (Pearson r vs Fwd20d Return) ──\n');
const fwd20 = points.map(p => p.fwd20);
const dnaFeatures = [
  ['bodyATR',        p => p.bodyATR,        'Body size ÷ ATR14 (conviction)'],
  ['eRA',            p => p.eRA,            'Range expansion ÷ ATR14'],
  ['ULRatio',        p => Math.min(p.ULRatio, 10), 'Upper÷Lower wick (lower=cleaner)'],
  ['marubozu',       p => p.marubozu,       'Marubozu score (100-wick%)'],
  ['wickToBody',     p => Math.min(p.wickToBody, 10), 'Total wick ÷ Body (lower=dominant)'],
  ['upperWickATR',   p => p.upperWickATR,   'Upper wick ÷ ATR (rejection measure)'],
  ['lowerWickATR',   p => p.lowerWickATR,   'Lower wick ÷ ATR (support tail)'],
  ['closeLoc',       p => p.closeLoc,       'Close location in range (higher=better)'],
  ['bodyPct',        p => p.bodyPct,        'Body% of total range'],
  ['upperWick',      p => p.upperWick,      'Upper wick% (lower=bullish)'],
  ['avgCL3',         p => p.avgCL3,         '3-candle avg close location'],
  ['bodyMom',        p => Math.max(-200, Math.min(500, p.bodyMom)), 'Body growth vs prior candle'],
  ['wickTrend3',     p => p.wickTrend3,     'Upper wick trend (neg=shrinking=good)'],
  ['volRejScore',    p => p.volRejScore,    'Volume×upperWick rejection (lower=better)'],
];
const corrRows = dnaFeatures.map(([name, fn, desc]) => {
  const r = pearsonR(points.map(fn), fwd20);
  return { name, r, desc };
}).sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
console.log('  Feature            │ r vs fwd20 │ Stars │ Description');
console.log('  ───────────────────┼────────────┼───────┼──────────────────────────────');
for (const { name, r, desc } of corrRows) {
  const neg = r < 0 ? '(NEG)' : '';
  console.log(`  ${name.padEnd(19)}│  ${(r>=0?'+':'')+r.toFixed(4).padStart(7)}   │  ${stars(r).padEnd(4)} │ ${neg} ${desc}`);
}
console.log('');

// ── 1B: Bucket analysis for all DNA features ───────────────────────────────
console.log('── 1B: Body/ATR Buckets (current thresholds: 0.3/0.6/1.0/1.5) ──\n');
printTable(bucketBy(p => p.bodyATR, [
  [0, 0.2, '<0.2 (doji-like)'],
  [0.2, 0.4, '0.2–0.4'],
  [0.4, 0.6, '0.4–0.6'],
  [0.6, 0.8, '0.6–0.8'],
  [0.8, 1.0, '0.8–1.0'],
  [1.0, 1.3, '1.0–1.3'],
  [1.3, 1.6, '1.3–1.6'],
  [1.6, 2.0, '1.6–2.0'],
  [2.0, 2.5, '2.0–2.5'],
  [2.5, 99, '>2.5 (huge)'],
]), 'bodyATR bucket');

console.log('── 1C: Range Expansion/ATR (eRA) Buckets (current thresholds: 0.6/1.0/1.5/2.0) ──\n');
printTable(bucketBy(p => p.eRA, [
  [0, 0.5, '<0.5 (narrow)'],
  [0.5, 0.8, '0.5–0.8'],
  [0.8, 1.0, '0.8–1.0'],
  [1.0, 1.3, '1.0–1.3'],
  [1.3, 1.6, '1.3–1.6'],
  [1.6, 2.0, '1.6–2.0'],
  [2.0, 2.5, '2.0–2.5'],
  [2.5, 3.0, '2.5–3.0'],
  [3.0, 99, '>3.0 (runaway)'],
]), 'eRA (range÷ATR)');

console.log('── 1D: Upper:Lower Wick Ratio Buckets (current thresholds: 0.5/1.0/2.0) ──\n');
printTable(bucketBy(p => Math.min(p.ULRatio, 99), [
  [0, 0.2, '<0.2 (dominant lower)'],
  [0.2, 0.4, '0.2–0.4'],
  [0.4, 0.6, '0.4–0.6'],
  [0.6, 0.8, '0.6–0.8'],
  [0.8, 1.2, '0.8–1.2 (balanced)'],
  [1.2, 1.8, '1.2–1.8'],
  [1.8, 2.5, '1.8–2.5'],
  [2.5, 4.0, '2.5–4.0'],
  [4.0, 99, '>4.0 (dominant upper)'],
]), 'Upper÷Lower Wick');

console.log('── 1E: Marubozu Score (current thresholds: 55/70/80) ──\n');
printTable(bucketBy(p => p.marubozu, [
  [0, 30, '<30 (very wicky)'],
  [30, 45, '30–45'],
  [45, 55, '45–55'],
  [55, 65, '55–65'],
  [65, 75, '65–75'],
  [75, 85, '75–85'],
  [85, 95, '85–95'],
  [95, 101, '95–100 (near-marubozu)'],
]), 'Marubozu Score');

console.log('── 1F: Upper Wick / ATR (new metric — rejection quality) ──\n');
printTable(bucketBy(p => p.upperWickATR, [
  [0, 0.05, '<0.05 (no rejection)'],
  [0.05, 0.10, '0.05–0.10'],
  [0.10, 0.15, '0.10–0.15'],
  [0.15, 0.20, '0.15–0.20'],
  [0.20, 0.30, '0.20–0.30'],
  [0.30, 0.50, '0.30–0.50'],
  [0.50, 1.00, '0.50–1.00'],
  [1.00, 99, '>1.0 (strong rejection)'],
]), 'Upper Wick ÷ ATR');

console.log('── 1G: 3-Candle Avg Close Location ──\n');
printTable(bucketBy(p => p.avgCL3, [
  [0, 35, '<35 (consistently low)'],
  [35, 45, '35–45'],
  [45, 55, '45–55 (mid)'],
  [55, 65, '55–65'],
  [65, 75, '65–75'],
  [75, 85, '75–85'],
  [85, 101, '>85 (consistently high)'],
]), '3-Candle Avg CloseLoc');

console.log('── 1H: Volume Rejection Score ──\n');
printTable(bucketBy(p => p.volRejScore, [
  [0, 0.05, '<0.05 (clean)'],
  [0.05, 0.15, '0.05–0.15'],
  [0.15, 0.30, '0.15–0.30'],
  [0.30, 0.60, '0.30–0.60'],
  [0.60, 1.00, '0.60–1.00'],
  [1.00, 99, '>1.00 (heavy rejection)'],
]), 'Vol Rejection Score');

// ── 1I: Current tier thresholds ───────────────────────────────────────────
console.log('── 1I: Current Tier Thresholds vs Measured Performance ──\n');
function dnaScore(p) {
  let bs = 0;
  if (p.bodyATR >= 1.5) bs = 35;
  else if (p.bodyATR >= 1.0) bs = 26;
  else if (p.bodyATR >= 0.6) bs = 16;
  else if (p.bodyATR >= 0.3) bs = 6;
  let wc = 0;
  if (p.ULRatio <= 0.5) wc += 18;
  else if (p.ULRatio <= 1.0) wc += 11;
  else if (p.ULRatio <= 2.0) wc += 5;
  if (p.marubozu >= 80) wc += 17;
  else if (p.marubozu >= 70) wc += 11;
  else if (p.marubozu >= 55) wc += 5;
  let re = 0;
  if (p.eRA >= 2.0) re = 30;
  else if (p.eRA >= 1.5) re = 22;
  else if (p.eRA >= 1.0) re = 13;
  else if (p.eRA >= 0.6) re = 5;
  return Math.min(100, bs + wc + re);
}
printTable([
  ['WEAK (0–34)',   row(points.filter(p => dnaScore(p) <  35))],
  ['GOOD (35–54)',  row(points.filter(p => dnaScore(p) >= 35 && dnaScore(p) < 55))],
  ['STRONG (55–74)',row(points.filter(p => dnaScore(p) >= 55 && dnaScore(p) < 75))],
  ['ELITE (75+)',   row(points.filter(p => dnaScore(p) >= 75))],
], 'Current Tier');

// ── 1J: Grid search for optimal score weights ─────────────────────────────
console.log('── 1J: Grid Search — Optimal CandleDNA Component Weights ──\n');
console.log('  Testing 1,000+ weight combinations for bodyATR/eRA/wickQuality...\n');

const bodyMax  = [25, 30, 35, 40];
const eraMax   = [20, 25, 30, 35];
const wickMax  = [25, 30, 35, 40];
// Tier cutoffs for ELITE
const eliteCut = [65, 70, 75, 80];

let bestGrid = [];
for (const bm of bodyMax) {
  for (const em of eraMax) {
    for (const wm of wickMax) {
      if (bm + em + wm > 110 || bm + em + wm < 85) continue;
      for (const cut of eliteCut) {
        // Compute score with these weights proportionally
        const scale = 100 / (bm + em + wm);
        function scoreFn(p) {
          // bodyATR sub-score (proportional to bm)
          let b = 0;
          if (p.bodyATR >= 1.5) b = bm;
          else if (p.bodyATR >= 1.0) b = bm * 0.74;
          else if (p.bodyATR >= 0.6) b = bm * 0.46;
          else if (p.bodyATR >= 0.3) b = bm * 0.17;
          // eRA sub-score
          let e = 0;
          if (p.eRA >= 2.0) e = em;
          else if (p.eRA >= 1.5) e = em * 0.73;
          else if (p.eRA >= 1.0) e = em * 0.43;
          else if (p.eRA >= 0.6) e = em * 0.17;
          // wick quality sub-score
          let w = 0;
          if (p.ULRatio <= 0.5) w += wm * 0.51;
          else if (p.ULRatio <= 1.0) w += wm * 0.31;
          else if (p.ULRatio <= 2.0) w += wm * 0.14;
          if (p.marubozu >= 80) w += wm * 0.49;
          else if (p.marubozu >= 70) w += wm * 0.31;
          else if (p.marubozu >= 55) w += wm * 0.14;
          return Math.min(100, (b + e + w) * scale);
        }
        const elite = points.filter(p => scoreFn(p) >= cut);
        if (elite.length < 50 || elite.length > points.length * 0.35) continue;
        const r = row(elite);
        if (!r) continue;
        bestGrid.push({ bm, em, wm, cut, n: r.n, a20: r.a20, mfe: r.mfe, gt5: r.gt5, win: r.win });
      }
    }
  }
}
bestGrid.sort((a,b) => b.a20 - a.a20);
console.log('  Top 10 weight combos by Avg20d (≥50 signals, ≤35% of universe):');
console.log('  Rank│BodyMax│ eRAMax│WickMax│ Cut│ Count │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ────┼───────┼───────┼───────┼────┼───────┼────────┼───────┼──────┼────');
for (let i = 0; i < Math.min(10, bestGrid.length); i++) {
  const g = bestGrid[i];
  console.log(`   ${String(i+1).padStart(2)} │  ${String(g.bm).padStart(3)}  │  ${String(g.em).padStart(3)}  │  ${String(g.wm).padStart(3)}  │ ${String(g.cut).padStart(3)}│${String(g.n).padStart(7)}│${fmtPct(g.a20)} │${fmtPct(g.mfe,6)} │${g.win.toFixed(1).padStart(4)}% │${g.gt5.toFixed(0).padStart(3)}%`);
}
console.log('');

} // end DNA section

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: ATR COMPRESSION STATE CALIBRATION
// ════════════════════════════════════════════════════════════════════════════

if (SECTION === 'all' || SECTION === 'atr') {

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 2: ATR COMPRESSION STATE CALIBRATION                               ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

// ── 2A: ATR Percentile buckets (fine-grained) ─────────────────────────────
console.log('── 2A: ATR Percentile-120 — Fine-Grained Buckets (current: <25/25-30/30-70/>70) ──\n');
printTable(bucketBy(p => p.pctl, [
  [0, 10, '<10 (deep sleep)'],
  [10, 20, '10–20'],
  [20, 25, '20–25 (DEEP COMP)'],
  [25, 30, '25–30 (BUILDING)'],
  [30, 35, '30–35'],
  [35, 40, '35–40'],
  [40, 50, '40–50 (SWEET MID)'],
  [50, 60, '50–60'],
  [60, 70, '60–70 (SWEET TOP)'],
  [70, 80, '70–80'],
  [80, 90, '80–90'],
  [90, 101, '90–100 (HIGH VOL)'],
]), 'ATR Percentile-120');

// ── 2B: ADR% (ATR as % of price) ─────────────────────────────────────────
console.log('── 2B: ADR% — Stock Volatility Regime (current EXPLODE requires 4–7%) ──\n');
printTable(bucketBy(p => p.adrPct, [
  [0, 1.5, '<1.5% (low ADR)'],
  [1.5, 2.5, '1.5–2.5%'],
  [2.5, 3.5, '2.5–3.5%'],
  [3.5, 4.5, '3.5–4.5%'],
  [4.5, 5.5, '4.5–5.5%'],
  [5.5, 7.0, '5.5–7.0%'],
  [7.0, 10.0, '7.0–10.0%'],
  [10.0, 99, '>10% (hyper-vol)'],
]), 'ADR% (ATR÷Price)');

// ── 2C: Volatility Expansion Ratio on signal bar ──────────────────────────
console.log('── 2C: eRA on Signal Bar (current EXPLODE requires 1.80–5.00) ──\n');
printTable(bucketBy(p => p.eRA, [
  [0, 0.7, '<0.7 (contract)'],
  [0.7, 1.0, '0.7–1.0 (flat)'],
  [1.0, 1.3, '1.0–1.3 (mild)'],
  [1.3, 1.6, '1.3–1.6'],
  [1.6, 2.0, '1.6–2.0'],
  [2.0, 2.5, '2.0–2.5'],
  [2.5, 3.0, '2.5–3.0'],
  [3.0, 99, '>3.0 (explosion)'],
]), 'Volatility Expansion Ratio');

// ── 2D: Combined ATR state classification — find optimal bands ────────────
console.log('── 2D: Optimal ATR State Band Grid Search ──\n');
console.log('  Testing all combinations of pctl band boundaries...\n');

const pctlBreaks = [10, 15, 20, 25, 30, 35, 40, 45, 50];
const topBreaks  = [65, 70, 75, 80, 85];
let atrBands = [];
for (const lo of pctlBreaks) {
  for (const hi of topBreaks) {
    if (hi <= lo + 20) continue;
    // SWEET_SPOT = lo..hi
    const sweet = points.filter(p => p.pctl >= lo && p.pctl <= hi);
    const deep  = points.filter(p => p.pctl < lo);
    const hVol  = points.filter(p => p.pctl > hi);
    if (sweet.length < 50) continue;
    const rs = row(sweet), rd = row(deep), rh = row(hVol);
    if (!rs) continue;
    const edge = rs.a20 - (rd ? rd.a20 : 0); // how much better than deep
    atrBands.push({ lo, hi, sweetN: rs.n, sweetA20: rs.a20, sweetMFE: rs.mfe, sweetWin: rs.win, edge });
  }
}
atrBands.sort((a,b) => b.edge - a.edge);
console.log('  Top 10 Sweet-Spot bands by edge vs DEEP_COMPRESSION:');
console.log('  Rank│ lo  │ hi  │  Sweet N │ Sweet20d │ SweetMFE │ Win% │  Edge');
console.log('  ────┼─────┼─────┼──────────┼──────────┼──────────┼──────┼──────');
for (let i = 0; i < Math.min(10, atrBands.length); i++) {
  const b = atrBands[i];
  console.log(`   ${String(i+1).padStart(2)} │ ${String(b.lo).padStart(3)} │ ${String(b.hi).padStart(3)} │ ${String(b.sweetN).padStart(8)} │${fmtPct(b.sweetA20)} │${fmtPct(b.sweetMFE,9)} │${b.sweetWin.toFixed(1).padStart(4)}% │${fmtPct(b.edge,6)}`);
}
console.log('');

// ── 2E: EXPLODE filter optimization ──────────────────────────────────────
console.log('── 2E: EXPLODE Condition Grid Search ──\n');
console.log('  Current: pctl 45–90, eRA 1.8–5.0, adr 4–7%, vr20≥1.8, vp5≥2.25, rvb≤1.2, cl≥70, bp≥35, uw≤40\n');
console.log('  Scanning threshold combinations (top 15 by Avg20d with ≥20 signals)...\n');

const pctlLoBounds  = [30, 35, 40, 45, 50];
const pctlHiBounds  = [75, 80, 85, 90];
const eraLoBounds   = [1.4, 1.6, 1.8, 2.0];
const adrLoBounds   = [2.5, 3.0, 3.5, 4.0];
const clLoBounds    = [55, 60, 65, 70];
const vr20LoBounds  = [1.4, 1.6, 1.8, 2.0];

let explodeCombos = [];
for (const pl of pctlLoBounds) {
  for (const ph of pctlHiBounds) {
    for (const eraLo of eraLoBounds) {
      for (const adrLo of adrLoBounds) {
        for (const cl of clLoBounds) {
          for (const vr of vr20LoBounds) {
            const filtered = points.filter(p =>
              p.pctl >= pl && p.pctl <= ph &&
              p.eRA  >= eraLo &&
              p.adrPct >= adrLo &&
              p.closeLoc >= cl &&
              p.vr20 >= vr
            );
            if (filtered.length < 20 || filtered.length > 500) continue;
            const r = row(filtered);
            if (!r) continue;
            explodeCombos.push({ pl, ph, eraLo, adrLo, cl, vr, n: r.n, a20: r.a20, mfe: r.mfe, gt5: r.gt5, win: r.win });
          }
        }
      }
    }
  }
}
explodeCombos.sort((a,b) => b.a20 - a.a20);
console.log('  Rank│ pLo│ pHi│eRA≥│adr≥│ cl≥│ vr≥│  N  │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ────┼────┼────┼────┼────┼────┼────┼─────┼────────┼───────┼──────┼─────');
for (let i = 0; i < Math.min(15, explodeCombos.length); i++) {
  const e = explodeCombos[i];
  console.log(`   ${String(i+1).padStart(2)} │ ${String(e.pl).padStart(3)}│ ${String(e.ph).padStart(3)}│${e.eraLo.toFixed(1).padStart(3)} │${e.adrLo.toFixed(1).padStart(3)} │ ${String(e.cl).padStart(3)}│${e.vr.toFixed(1).padStart(3)} │${String(e.n).padStart(5)}│${fmtPct(e.a20)} │${fmtPct(e.mfe,6)} │${e.win.toFixed(1).padStart(4)}% │${e.gt5.toFixed(1).padStart(4)}%`);
}
console.log('');

} // end ATR section

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: VOLUME THRUST BADGE CALIBRATION
// ════════════════════════════════════════════════════════════════════════════

if (SECTION === 'all' || SECTION === 'vol') {

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 3: VOLUME THRUST BADGE CALIBRATION                                 ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

// ── 3A: Baseline — no volume filter ──────────────────────────────────────
const baseline = row(points);
console.log(`── 3A: Baseline (no volume filter) ──`);
console.log(`  N=${baseline.n} | Avg20d=${fmtPct(baseline.a20)} | MFE=${fmtPct(baseline.mfe)} | Win=${baseline.win.toFixed(1)}% | >5%=${baseline.gt5.toFixed(1)}%\n`);

// ── 3B: vr20 (volume÷20d avg) ────────────────────────────────────────────
console.log('── 3B: vr20 Buckets (current HIGH_CONVICTION requires ≥3.0, CONFIRMED ≥1.2) ──\n');
printTable(bucketBy(p => p.vr20, [
  [0, 0.7, '<0.7x (low vol)'],
  [0.7, 1.0, '0.7–1.0x'],
  [1.0, 1.3, '1.0–1.3x'],
  [1.3, 1.6, '1.3–1.6x'],
  [1.6, 2.0, '1.6–2.0x'],
  [2.0, 2.5, '2.0–2.5x'],
  [2.5, 3.0, '2.5–3.0x'],
  [3.0, 4.0, '3.0–4.0x'],
  [4.0, 6.0, '4.0–6.0x'],
  [6.0, 99, '>6.0x (blow-off?)'],
]), 'vr20 (vol÷20avg)');

// ── 3C: vPre5 (vol vs prior 5-day) ───────────────────────────────────────
console.log('── 3C: vPre5 Buckets (current HIGH_CONVICTION requires ≥4.0, CONFIRMED ≥2.0) ──\n');
printTable(bucketBy(p => p.vp5, [
  [0, 1.0, '<1.0x (below pre5)'],
  [1.0, 1.5, '1.0–1.5x'],
  [1.5, 2.0, '1.5–2.0x'],
  [2.0, 2.5, '2.0–2.5x'],
  [2.5, 3.0, '2.5–3.0x'],
  [3.0, 4.0, '3.0–4.0x'],
  [4.0, 5.0, '4.0–5.0x'],
  [5.0, 7.0, '5.0–7.0x'],
  [7.0, 99, '>7.0x (blow-off?)'],
]), 'vPre5 (vol÷pre5avg)');

// ── 3D: Red Vol Bias (red candle volume dominance) ────────────────────────
console.log('── 3D: Red Vol Bias (current HIGH_CONVICTION requires ≤0.60, CONFIRMED ≤1.10) ──\n');
printTable(bucketBy(p => p.rvb, [
  [0, 0.3, '<0.3 (sellers absent)'],
  [0.3, 0.5, '0.3–0.5'],
  [0.5, 0.7, '0.5–0.7'],
  [0.7, 0.9, '0.7–0.9'],
  [0.9, 1.1, '0.9–1.1 (neutral)'],
  [1.1, 1.5, '1.1–1.5 (some selling)'],
  [1.5, 2.0, '1.5–2.0'],
  [2.0, 99, '>2.0 (sellers dominant)'],
]), 'Red Vol Bias');

// ── 3E: Full grid search — HIGH_CONVICTION parameters ─────────────────────
console.log('── 3E: HIGH_CONVICTION Grid Search ──\n');
console.log('  Current: vr20≥3.0, vp5≥4.0, rvb≤0.60, cl≥55, bp≥40, uw≤25\n');
console.log('  Scanning 2000+ combinations... (optimizing Avg20d and MFE)\n');

const vr20Bounds = [2.0, 2.5, 3.0, 3.5, 4.0];
const vp5Bounds  = [2.5, 3.0, 3.5, 4.0, 5.0];
const rvbBounds  = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const clBounds   = [45, 50, 55, 60, 65, 70];
const bpBounds   = [30, 35, 40, 45, 50];
const uwBounds   = [15, 20, 25, 30, 35, 40];

let hcCombos = [];
for (const vr of vr20Bounds) {
  for (const vp of vp5Bounds) {
    for (const rv of rvbBounds) {
      for (const cl of clBounds) {
        for (const bp of bpBounds) {
          for (const uw of uwBounds) {
            const filt = points.filter(p =>
              p.vr20 >= vr && p.vp5 >= vp && p.rvb <= rv &&
              p.closeLoc >= cl && p.bodyPct >= bp && p.upperWick <= uw
            );
            if (filt.length < 30 || filt.length > 3000) continue;
            const r = row(filt);
            if (!r) continue;
            const score = r.a20 * 0.5 + r.mfe * 0.3 + r.gt5 * 0.2;
            hcCombos.push({ vr, vp, rv, cl, bp, uw, n: r.n, a20: r.a20, mfe: r.mfe, gt5: r.gt5, win: r.win, score });
          }
        }
      }
    }
  }
}
hcCombos.sort((a,b) => b.a20 - a.a20);
console.log('  Top 15 HIGH_CONVICTION combos (by Avg20d, ≥30 signals):');
console.log('  Rk│vr20≥│vp5≥│rvb≤│ cl≥│ bp≥│ uw≤│  N  │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ──┼─────┼────┼────┼────┼────┼────┼─────┼────────┼───────┼──────┼────');
for (let i = 0; i < Math.min(15, hcCombos.length); i++) {
  const h = hcCombos[i];
  console.log(`  ${String(i+1).padStart(2)}│ ${h.vr.toFixed(1).padStart(3)} │${h.vp.toFixed(1).padStart(4)}│${h.rv.toFixed(2).padStart(4)}│ ${String(h.cl).padStart(3)}│ ${String(h.bp).padStart(3)}│ ${String(h.uw).padStart(3)}│${String(h.n).padStart(5)}│${fmtPct(h.a20)} │${fmtPct(h.mfe,6)} │${h.win.toFixed(1).padStart(4)}% │${h.gt5.toFixed(0).padStart(3)}%`);
}
console.log('');

// ── 3F: CONFIRMED badge grid search ──────────────────────────────────────
console.log('── 3F: CONFIRMED Badge Grid Search ──\n');
console.log('  Current: vp5≥2.0, vr20≥1.2, rvb≤1.10\n');

const confVp5  = [1.5, 2.0, 2.5, 3.0];
const confVr20 = [1.0, 1.2, 1.5, 1.8];
const confRvb  = [0.8, 1.0, 1.1, 1.2, 1.5];

let confCombos = [];
for (const vp of confVp5) {
  for (const vr of confVr20) {
    for (const rv of confRvb) {
      // Exclude HIGH_CONVICTION to get pure CONFIRMED tier
      const filt = points.filter(p =>
        p.vp5 >= vp && p.vr20 >= vr && p.rvb <= rv &&
        !(p.vr20 >= 3.0 && p.vp5 >= 4.0 && p.rvb <= 0.6)
      );
      if (filt.length < 30) continue;
      const r = row(filt);
      if (!r) continue;
      confCombos.push({ vp, vr, rv, n: r.n, a20: r.a20, mfe: r.mfe, gt5: r.gt5, win: r.win });
    }
  }
}
confCombos.sort((a,b) => b.a20 - a.a20);
console.log('  Top 10 CONFIRMED combos:');
console.log('  Rk│ vp5≥ │vr20≥│rvb≤│  N   │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ──┼──────┼─────┼────┼──────┼────────┼───────┼──────┼────');
for (let i = 0; i < Math.min(10, confCombos.length); i++) {
  const c = confCombos[i];
  console.log(`  ${String(i+1).padStart(2)}│  ${c.vp.toFixed(1).padStart(3)} │ ${c.vr.toFixed(1).padStart(3)} │${c.rv.toFixed(2).padStart(4)}│${String(c.n).padStart(6)}│${fmtPct(c.a20)} │${fmtPct(c.mfe,6)} │${c.win.toFixed(1).padStart(4)}% │${c.gt5.toFixed(0).padStart(3)}%`);
}
console.log('');

// ── 3G: Volume percentile deciles (are our thresholds in the right place?) ──
console.log('── 3G: Volume Ratio Decile Analysis (each decile = 10% of signals) ──\n');
const sortedVR20 = [...points].sort((a,b) => a.vr20 - b.vr20);
const sortedVP5  = [...points].sort((a,b) => a.vp5 - b.vp5);
for (const [label, sorted, prop] of [['vr20', sortedVR20, 'vr20'], ['vp5', sortedVP5, 'vp5']]) {
  console.log(`  ${label} deciles:`);
  console.log(`  Dec │ Threshold │ Count │ Avg20d │ Win%  │ >5%`);
  for (let d = 0; d < 10; d++) {
    const lo = Math.floor(d * sorted.length / 10);
    const hi = Math.floor((d+1) * sorted.length / 10);
    const slice = sorted.slice(lo, hi);
    const threshold = sorted[hi - 1]?.[prop] ?? 0;
    const r = row(slice);
    if (!r) continue;
    console.log(`   D${d+1} │ ≤${threshold.toFixed(2).padStart(7)} │${String(r.n).padStart(6)} │${fmtPct(r.a20)} │${r.win.toFixed(1).padStart(4)}% │${r.gt5.toFixed(1).padStart(4)}%`);
  }
  console.log('');
}

} // end VOL section

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: COMBINED INTERACTION ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

if (SECTION === 'all') {

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 4: COMBINED BADGE INTERACTION ANALYSIS                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

// Current badge detectors applied
function isHC(p)   { return p.vr20 >= 3.0 && p.vp5 >= 4.0 && p.rvb <= 0.6 && p.closeLoc >= 55 && p.bodyPct >= 40 && p.upperWick <= 25; }
function isCONF(p) { return p.vp5 >= 2.0 && p.vr20 >= 1.2 && p.rvb <= 1.1; }
function isExplode(p) { return p.pctl >= 45 && p.pctl <= 90 && p.eRA >= 1.8 && p.eRA <= 5.0 && p.volExpRatio >= 1.2 && p.adrPct >= 4.0 && p.adrPct <= 7.0 && p.vr20 >= 1.8 && p.vp5 >= 2.25 && p.rvb <= 1.2 && p.closeLoc >= 70 && p.bodyPct >= 35 && p.upperWick <= 40; }
function isElite(p) { return dnaScoreForSection4(p) >= 75; }
function dnaScoreForSection4(p) {
  let bs = p.bodyATR >= 1.5 ? 35 : p.bodyATR >= 1.0 ? 26 : p.bodyATR >= 0.6 ? 16 : p.bodyATR >= 0.3 ? 6 : 0;
  let wc = (p.ULRatio <= 0.5 ? 18 : p.ULRatio <= 1.0 ? 11 : p.ULRatio <= 2.0 ? 5 : 0) + (p.marubozu >= 80 ? 17 : p.marubozu >= 70 ? 11 : p.marubozu >= 55 ? 5 : 0);
  let re = p.eRA >= 2.0 ? 30 : p.eRA >= 1.5 ? 22 : p.eRA >= 1.0 ? 13 : p.eRA >= 0.6 ? 5 : 0;
  return Math.min(100, bs + wc + re);
}

const combLabels = [
  ['No badges',                pts => pts.filter(p => !isHC(p) && !isCONF(p) && !isExplode(p) && !isElite(p))],
  ['CONFIRMED only',           pts => pts.filter(p => isCONF(p) && !isHC(p) && !isExplode(p) && !isElite(p))],
  ['ELITE DNA only',           pts => pts.filter(p => isElite(p) && !isHC(p) && !isExplode(p))],
  ['HIGH_CONVICTION only',     pts => pts.filter(p => isHC(p) && !isExplode(p) && !isElite(p))],
  ['EXPLODE ATR only',         pts => pts.filter(p => isExplode(p) && !isHC(p) && !isElite(p))],
  ['HC + ELITE DNA',           pts => pts.filter(p => isHC(p) && isElite(p) && !isExplode(p))],
  ['HC + EXPLODE',             pts => pts.filter(p => isHC(p) && isExplode(p) && !isElite(p))],
  ['EXPLODE + ELITE DNA',      pts => pts.filter(p => isExplode(p) && isElite(p) && !isHC(p))],
  ['HC + EXPLODE + ELITE DNA', pts => pts.filter(p => isHC(p) && isExplode(p) && isElite(p))],
];
printTable(combLabels.map(([label, fn]) => [label, row(fn(points))]), 'Badge Combination');

// ── 4B: Score the current vs recommended parameters ───────────────────────
console.log('── Summary: Current Detection Rates ──\n');
console.log(`  Dataset: ${points.length.toLocaleString()} breakout-context signals across ${allStocks.length} stocks`);
console.log(`  HIGH_CONVICTION: ${points.filter(isHC).length} signals (${(points.filter(isHC).length/points.length*100).toFixed(1)}%)`);
console.log(`  CONFIRMED:       ${points.filter(p=>isCONF(p)&&!isHC(p)).length} signals (${(points.filter(p=>isCONF(p)&&!isHC(p)).length/points.length*100).toFixed(1)}%)`);
console.log(`  EXPLODE:         ${points.filter(isExplode).length} signals (${(points.filter(isExplode).length/points.length*100).toFixed(1)}%)`);
console.log(`  ELITE DNA:       ${points.filter(isElite).length} signals (${(points.filter(isElite).length/points.length*100).toFixed(1)}%)`);
console.log(`  ALL THREE:       ${points.filter(p=>isHC(p)&&isExplode(p)&&isElite(p)).length} signals (${(points.filter(p=>isHC(p)&&isExplode(p)&&isElite(p)).length/points.length*100).toFixed(1)}%)\n`);

} // end combined section

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  CALIBRATION COMPLETE');
console.log('  Apply findings to:');
console.log('    • detectCandleDNA() in lib/stockEngine.ts');
console.log('    • detectATRState()  in app/page.tsx');
console.log('    • detectVolumeBadge() in app/page.tsx');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');
