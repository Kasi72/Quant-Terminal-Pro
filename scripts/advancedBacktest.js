// Advanced Features Backtest
// Runs all 8 advanced features on 1,617 NSE stocks, stratifies by tier/range,
// computes 5d/10d/20d forward return win rates and average returns.
//
// Usage: node scripts/advancedBacktest.js

const fs = require('fs');
const path = require('path');

const CSV_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_CANDLES = 100;
const HORIZONS = [5, 10, 20]; // forward return days

// ── CSV Parser ───────────────────────────────────────────────────────────────

function parseDate(s) {
  // "02-Jul-2021" → Date
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const [d, m, y] = s.split('-');
  return new Date(+y, months[m], +d);
}

function loadCSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    const open = parseFloat(o), high = parseFloat(h), low = parseFloat(l);
    const close = parseFloat(c), volume = parseFloat(v);
    if (!isFinite(close) || close <= 0 || !isFinite(high) || !isFinite(low) || !isFinite(open) || !isFinite(volume)) continue;
    if (high < low || high < close || low > close) continue;
    candles.push({ ts: parseDate(date).getTime() / 1000, o: open, h: high, l: low, c: close, v: volume });
  }
  return candles;
}

// ── Math Helpers ─────────────────────────────────────────────────────────────

function safe(v, fb = 0) { return isFinite(v) ? v : fb; }
function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr, m) {
  if (arr.length < 2) return 0;
  const mu = m ?? mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1));
}
function olsBeta(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}
function pctRank(sorted, v) {
  if (sorted.length === 0) return 0.5;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  return lo / sorted.length;
}

// ── ATR14 ────────────────────────────────────────────────────────────────────

function computeATR14(candles) {
  const atr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    atr[i] = i === 1 ? tr : (atr[i - 1] * 13 + tr) / 14;
  }
  return atr;
}

// ── Feature Computations ─────────────────────────────────────────────────────

function computeFER(candles, endIdx) {
  const period = 20;
  if (endIdx < period) return null;
  const start = endIdx - period;
  const netMove = Math.abs(candles[endIdx].c - candles[start].c);
  let pathLen = 0;
  for (let i = start + 1; i <= endIdx; i++) pathLen += Math.abs(candles[i].c - candles[i - 1].c);
  return pathLen > 0 ? safe(netMove / pathLen) : 0;
}

function computeCUSUMPos(candles, endIdx, atr14) {
  if (endIdx < 20) return null;
  const close = candles[endIdx].c;
  const atrPct = close > 0 ? atr14 / close : 0;
  const threshold = 0.5 * atrPct;
  const signalLevel = 2.0 * atrPct;
  let sPos = 0;
  const startIdx = Math.max(1, endIdx - 60);
  for (let i = startIdx; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    sPos = Math.max(0, sPos + ret - threshold);
  }
  return { cusumPos: safe(sPos), cusumSignal: sPos > signalLevel };
}

function computeMWC(candles, endIdx) {
  if (endIdx < 8) return null;
  const c = candles[endIdx].c;
  const roc5  = endIdx >= 5  && candles[endIdx - 5].c  > 0 ? (c / candles[endIdx - 5].c  - 1) * 100 : 0;
  const roc20 = endIdx >= 20 && candles[endIdx - 20].c > 0 ? (c / candles[endIdx - 20].c - 1) * 100 : 0;
  const roc60 = endIdx >= 60 && candles[endIdx - 60].c > 0 ? (c / candles[endIdx - 60].c - 1) * 100 : 0;
  let slopePosCount = 0;
  if (endIdx >= 8) {
    const prev5Base = candles[endIdx - 8].c;
    const prev5End  = candles[endIdx - 3].c;
    const roc5_prev = prev5Base > 0 ? (prev5End / prev5Base - 1) * 100 : 0;
    if (roc5 > roc5_prev) slopePosCount = 1;
  }
  const score = (roc5 > roc20 ? 1 : 0) + (roc20 > roc60 ? 1 : 0) + (roc5 > 0 ? 1 : 0) + slopePosCount;
  return score;
}

function computeTRAM(candles, endIdx) {
  if (endIdx < 60) return null;
  const returns = [];
  for (let i = endIdx - 59; i <= endIdx; i++) {
    if (i >= 1 && candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c * 100);
  }
  if (returns.length < 10) return null;
  returns.sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(returns.length * 0.05));
  const cvar95 = mean(returns.slice(0, cutoff));
  const roc20 = candles[endIdx - 20].c > 0 ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;
  return Math.abs(cvar95) > 0.001 ? safe(roc20 / Math.abs(cvar95)) : 0;
}

function computeCleanMom(candles, endIdx) {
  if (endIdx < 20) return null;
  const startClose = candles[endIdx - 20].c;
  const endClose = candles[endIdx].c;
  const roc20 = startClose > 0 ? (endClose / startClose - 1) * 100 : 0;
  let peak = candles[endIdx - 20].h;
  let maxDD = 0;
  for (let i = endIdx - 19; i <= endIdx; i++) {
    if (candles[i].h > peak) peak = candles[i].h;
    const dd = peak > 0 ? (candles[i].l - peak) / peak * 100 : 0;
    if (dd < maxDD) maxDD = dd;
  }
  return safe(roc20 + maxDD);
}

function computeRegimeDurationRatio(candles, endIdx, atr14) {
  if (endIdx < 30) return null;
  const close = candles[endIdx].c;
  const threshold = close > 0 ? atr14 / close : 0.015;
  const runs = [];
  let inRun = false, runLen = 0;
  for (let i = 5; i <= endIdx; i++) {
    const ret = candles[i - 5].c > 0 ? (candles[i].c / candles[i - 5].c - 1) : 0;
    if (ret > threshold) { if (!inRun) { inRun = true; runLen = 1; } else runLen++; }
    else { if (inRun && runLen >= 3) runs.push(runLen); inRun = false; runLen = 0; }
  }
  const regimeDays = inRun ? runLen : 0;
  const avgRunLen = runs.length >= 3 ? mean(runs) : 10;
  return { regimeDays, durationRatio: avgRunLen > 0 ? safe(regimeDays / avgRunLen) : 0, inRun };
}

function computeVRAM(candles, endIdx) {
  if (endIdx < 80) return null;
  const atrPcts = [];
  let prevC = candles[0].c;
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prevC), Math.abs(candles[i].l - prevC));
    atrPcts.push(candles[i].c > 0 ? tr / candles[i].c * 100 : 0);
    prevC = candles[i].c;
  }
  const window = atrPcts.slice(Math.max(0, endIdx - 120), endIdx);
  const sorted = [...window].sort((a, b) => a - b);
  const currentATRPct = atrPcts[endIdx - 1];
  const rank = pctRank(sorted, currentATRPct);
  const volRegime = rank < 0.33 ? 'LOW' : rank < 0.67 ? 'MID' : 'HIGH';
  const regimeROCs = [];
  for (let i = 20; i < endIdx; i++) {
    const hr = pctRank(sorted, atrPcts[i - 1]);
    const hReg = hr < 0.33 ? 'LOW' : hr < 0.67 ? 'MID' : 'HIGH';
    if (hReg === volRegime && candles[i - 20].c > 0) regimeROCs.push((candles[i].c / candles[i - 20].c - 1) * 100);
  }
  if (regimeROCs.length < 10) return null;
  const currentROC20 = candles[endIdx - 20].c > 0 ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;
  const mu = mean(regimeROCs), sigma = std(regimeROCs, mu);
  return sigma > 0 ? safe((currentROC20 - mu) / sigma) : 0;
}

function computePIC(candles, endIdx) {
  const period = 20;
  if (endIdx < period + 1) return null;
  const signedVols = [], dailyReturns = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    signedVols.push(candles[i].v * (ret > 0 ? 1 : ret < 0 ? -1 : 0));
    dailyReturns.push(ret);
  }
  const meanAbsVol = mean(signedVols.map(Math.abs)) || 1;
  const normVols = signedVols.map(v => v / meanAbsVol);
  return safe(olsBeta(normVols, dailyReturns) * 1000);
}

// ── Binning helpers ──────────────────────────────────────────────────────────

function bin(v, edges) {
  // edges = [e0, e1, e2, ...] — returns label string
  for (let i = 0; i < edges.length; i++) {
    if (v < edges[i].max) return edges[i].label;
  }
  return edges[edges.length - 1].label;
}

const FER_BINS   = [{max:0.20,label:'0.00-0.20'},{max:0.35,label:'0.20-0.35'},{max:0.50,label:'0.35-0.50'},{max:0.65,label:'0.50-0.65'},{max:Infinity,label:'0.65-1.00'}];
const CUSUM_BINS = [{max:0,label:'≤0 (Neg)'},{max:0.005,label:'0-0.5%'},{max:0.015,label:'0.5-1.5%'},{max:0.03,label:'1.5-3%'},{max:Infinity,label:'>3% (Signal)'}];
const MWC_BINS   = [{max:1,label:'0'},{max:2,label:'1'},{max:3,label:'2'},{max:4,label:'3'},{max:Infinity,label:'4 (Full)'}];
const TRAM_BINS  = [{max:0,label:'<0 (Neg)'},{max:0.5,label:'0-0.5'},{max:1.5,label:'0.5-1.5'},{max:3.0,label:'1.5-3.0'},{max:Infinity,label:'>3.0 (Exc.)'}];
const CMOM_BINS  = [{max:-10,label:'<-10%'},{max:-3,label:'-10 to -3%'},{max:3,label:'-3 to 3%'},{max:10,label:'3-10%'},{max:Infinity,label:'>10%'}];
const DURR_BINS  = [{max:0.01,label:'0 (No run)'},{max:0.30,label:'0-0.30'},{max:0.60,label:'0.30-0.60'},{max:1.00,label:'0.60-1.00'},{max:Infinity,label:'>1.0 (Ext)'}];
const VRAM_BINS  = [{max:-1.5,label:'<-1.5z'},{max:-0.5,label:'-1.5 to -0.5z'},{max:0.5,label:'-0.5 to 0.5z'},{max:1.5,label:'0.5-1.5z'},{max:Infinity,label:'>1.5z (Strong)'}];
const PIC_BINS   = [{max:-5,label:'<-5 (React-)'},{max:-2,label:'-5 to -2'},{max:2,label:'-2 to 2 (Latent)'},{max:5,label:'2-5 (Normal)'},{max:Infinity,label:'>5 (Reactive)'}];

// ── Accumulator ──────────────────────────────────────────────────────────────

function makeAccum() { return {}; }
function record(acc, key, fwdReturns) {
  if (!acc[key]) acc[key] = { n: 0, wins5: 0, wins10: 0, wins20: 0, sum5: 0, sum10: 0, sum20: 0 };
  const slot = acc[key];
  slot.n++;
  if (fwdReturns[5]  !== null) { slot.sum5  += fwdReturns[5];  if (fwdReturns[5]  > 0) slot.wins5++; }
  if (fwdReturns[10] !== null) { slot.sum10 += fwdReturns[10]; if (fwdReturns[10] > 0) slot.wins10++; }
  if (fwdReturns[20] !== null) { slot.sum20 += fwdReturns[20]; if (fwdReturns[20] > 0) slot.wins20++; }
}

// ── Main Backtest ─────────────────────────────────────────────────────────────

const accum = {
  fer:   makeAccum(),
  cusum: makeAccum(),
  mwc:   makeAccum(),
  tram:  makeAccum(),
  cleanmom: makeAccum(),
  durr:  makeAccum(),
  vram:  makeAccum(),
  pic:   makeAccum(),
};

const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
let totalObs = 0, totalStocks = 0;

process.stdout.write(`Processing ${files.length} stocks...\n`);

for (let fi = 0; fi < files.length; fi++) {
  if (fi % 100 === 0) process.stdout.write(`  ${fi}/${files.length}\r`);

  const candles = loadCSV(path.join(CSV_DIR, files[fi]));
  if (candles.length < MIN_CANDLES) continue;
  totalStocks++;

  const atr14arr = computeATR14(candles);

  // Sample every 5th bar from bar 80 onwards (avoid look-ahead, keep sample size manageable)
  for (let idx = 80; idx < candles.length - 20; idx += 5) {
    const atr14 = atr14arr[idx] || 0.0001;

    // Forward returns
    const fwd = {};
    for (const h of HORIZONS) {
      const futIdx = idx + h;
      if (futIdx < candles.length) {
        fwd[h] = candles[idx].c > 0 ? (candles[futIdx].c / candles[idx].c - 1) * 100 : null;
      } else {
        fwd[h] = null;
      }
    }

    totalObs++;

    // 1. FER
    const fer = computeFER(candles, idx);
    if (fer !== null) record(accum.fer, bin(fer, FER_BINS), fwd);

    // 2. CUSUM
    const cusum = computeCUSUMPos(candles, idx, atr14);
    if (cusum !== null) record(accum.cusum, bin(cusum.cusumPos, CUSUM_BINS), fwd);

    // 3. MWC
    const mwc = computeMWC(candles, idx);
    if (mwc !== null) record(accum.mwc, bin(mwc, MWC_BINS), fwd);

    // 4. TRAM
    const tram = computeTRAM(candles, idx);
    if (tram !== null) record(accum.tram, bin(tram, TRAM_BINS), fwd);

    // 5. Clean Momentum
    const cm = computeCleanMom(candles, idx);
    if (cm !== null) record(accum.cleanmom, bin(cm, CMOM_BINS), fwd);

    // 6. Regime Duration Ratio
    const dur = computeRegimeDurationRatio(candles, idx, atr14);
    if (dur !== null) record(accum.durr, bin(dur.durationRatio, DURR_BINS), fwd);

    // 7. VRAM
    const vram = computeVRAM(candles, idx);
    if (vram !== null) record(accum.vram, bin(vram, VRAM_BINS), fwd);

    // 8. PIC
    const pic = computePIC(candles, idx);
    if (pic !== null) record(accum.pic, bin(pic, PIC_BINS), fwd);
  }
}

process.stdout.write(`\nDone. ${totalStocks} stocks, ${totalObs} observations.\n\n`);

// ── Reporter ─────────────────────────────────────────────────────────────────

function printTable(name, acc, bins) {
  const labels = bins.map(b => b.label);
  console.log(`\n${'═'.repeat(105)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(105)}`);
  console.log(`  ${'Bin'.padEnd(22)} ${'N'.padStart(7)} ${'WR5%'.padStart(7)} ${'Avg5%'.padStart(7)} ${'WR10%'.padStart(7)} ${'Avg10%'.padStart(8)} ${'WR20%'.padStart(7)} ${'Avg20%'.padStart(8)}  Edge20`);
  console.log(`  ${'-'.repeat(101)}`);

  let baseWR20 = null;
  const rows = labels.map(lbl => {
    const d = acc[lbl];
    if (!d || d.n < 20) return null;
    return {
      lbl,
      n: d.n,
      wr5:  d.n > 0 ? (d.wins5  / d.n * 100) : 0,
      avg5: d.n > 0 ? (d.sum5   / d.n)        : 0,
      wr10: d.n > 0 ? (d.wins10 / d.n * 100)  : 0,
      avg10:d.n > 0 ? (d.sum10  / d.n)        : 0,
      wr20: d.n > 0 ? (d.wins20 / d.n * 100)  : 0,
      avg20:d.n > 0 ? (d.sum20  / d.n)        : 0,
    };
  }).filter(Boolean);

  // Baseline: mean WR20 across all bins
  if (rows.length > 0) {
    const totN   = rows.reduce((s, r) => s + r.n, 0);
    const totW20 = rows.reduce((s, r) => s + r.wr20 * r.n, 0);
    baseWR20 = totN > 0 ? totW20 / totN : 50;
  }

  for (const r of rows) {
    const edge = baseWR20 !== null ? (r.wr20 - baseWR20) : 0;
    const edgeFmt = (edge >= 0 ? '+' : '') + edge.toFixed(1) + 'pp';
    const mark = Math.abs(edge) >= 5 ? (edge > 0 ? ' ▲' : ' ▼') : '  ';
    console.log(
      `  ${r.lbl.padEnd(22)} ${String(r.n).padStart(7)} ${r.wr5.toFixed(1).padStart(7)} ${r.avg5.toFixed(2).padStart(7)} ` +
      `${r.wr10.toFixed(1).padStart(7)} ${r.avg10.toFixed(2).padStart(8)} ` +
      `${r.wr20.toFixed(1).padStart(7)} ${r.avg20.toFixed(2).padStart(8)}  ${edgeFmt.padStart(7)}${mark}`
    );
  }
  console.log(`  (Baseline WR20: ${baseWR20 !== null ? baseWR20.toFixed(1) : '?'}%)`);
}

printTable('1. FRACTAL EFFICIENCY RATIO (FER_20) — 0=random walk, 1=perfect trend', accum.fer, FER_BINS);
printTable('2. CUSUM FILTER — cumulative positive return drift (S+ as % return)', accum.cusum, CUSUM_BINS);
printTable('3. MOMENTUM WAVE CONVERGENCE (MWC) — 0-4 timeframes aligned', accum.mwc, MWC_BINS);
printTable('4. TAIL-RISK ADJUSTED MOMENTUM (TRAM) — ROC20 / |CVaR_95%|', accum.tram, TRAM_BINS);
printTable('5. CLEAN MOMENTUM SCORE — ROC20 minus MaxDD20 (%)', accum.cleanmom, CMOM_BINS);
printTable('6. REGIME DURATION RATIO — current run / avg run length', accum.durr, DURR_BINS);
printTable('7. VOL-REGIME ADJUSTED MOMENTUM (VRAM) — z-score within vol regime', accum.vram, VRAM_BINS);
printTable('8. PRICE IMPACT COEFFICIENT (PIC) — OLS beta × 1000 (low=latent demand)', accum.pic, PIC_BINS);

// Summary table: best tier per feature
console.log(`\n${'═'.repeat(105)}`);
console.log('  PREDICTIVE POWER RANKING — Best tier edge over baseline (20d forward WR)');
console.log(`${'═'.repeat(105)}`);

const features = [
  { name: 'FER', acc: accum.fer, bins: FER_BINS },
  { name: 'CUSUM', acc: accum.cusum, bins: CUSUM_BINS },
  { name: 'MWC', acc: accum.mwc, bins: MWC_BINS },
  { name: 'TRAM', acc: accum.tram, bins: TRAM_BINS },
  { name: 'CleanMom', acc: accum.cleanmom, bins: CMOM_BINS },
  { name: 'DurRatio', acc: accum.durr, bins: DURR_BINS },
  { name: 'VRAM', acc: accum.vram, bins: VRAM_BINS },
  { name: 'PIC', acc: accum.pic, bins: PIC_BINS },
];

const summary = [];
for (const f of features) {
  const rows = f.bins.map(b => f.acc[b.label]).filter(d => d && d.n >= 20);
  if (rows.length === 0) { summary.push({ name: f.name, maxEdge: 0, bestBin: '—', wr20: 0, n: 0 }); continue; }
  const totN = rows.reduce((s, d) => s + d.n, 0);
  const base = rows.reduce((s, d) => s + (d.wins20 / d.n * 100) * d.n, 0) / totN;
  let best = null;
  for (let i = 0; i < f.bins.length; i++) {
    const d = f.acc[f.bins[i].label];
    if (!d || d.n < 20) continue;
    const wr = d.wins20 / d.n * 100;
    const edge = wr - base;
    if (!best || edge > best.edge) best = { label: f.bins[i].label, edge, wr, n: d.n };
  }
  summary.push({ name: f.name, maxEdge: best ? best.edge : 0, bestBin: best ? best.label : '—', wr20: best ? best.wr : 0, n: best ? best.n : 0 });
}

summary.sort((a, b) => b.maxEdge - a.maxEdge);
console.log(`  ${'Feature'.padEnd(12)} ${'Best Tier'.padEnd(22)} ${'N'.padStart(7)} ${'WR20%'.padStart(7)} ${'Edge'.padStart(9)}  Verdict`);
console.log(`  ${'-'.repeat(95)}`);
for (const s of summary) {
  const verdict = s.maxEdge >= 8 ? '★★★ STRONG PREDICTOR' : s.maxEdge >= 4 ? '★★  MODERATE PREDICTOR' : s.maxEdge >= 1 ? '★   WEAK PREDICTOR' : '    NO EDGE';
  console.log(`  ${s.name.padEnd(12)} ${s.bestBin.padEnd(22)} ${String(s.n).padStart(7)} ${s.wr20.toFixed(1).padStart(7)} ${((s.maxEdge >= 0 ? '+' : '') + s.maxEdge.toFixed(1) + 'pp').padStart(9)}  ${verdict}`);
}
console.log('');
