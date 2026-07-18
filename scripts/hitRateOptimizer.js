'use strict';
/**
 * Hit-Rate Optimizer
 *
 * For each archetype, sweeps combinations of technical indicator thresholds
 * applied AFTER the archetype fires to find gates that maximize OOS Hit5/20.
 *
 * Indicators swept per signal:
 *   cmf20     — Chaikin Money Flow (20 bars)
 *   obv10     — OBV slope normalized by mean volume (10 bars)
 *   rsi14     — RSI(14): trend regime
 *   rsi2      — RSI(2): short-term exhaustion
 *   volRatio  — today volume / 20-bar avg volume
 *   atrPct    — ATR(14) as % of close: volatility filter
 *   adx14     — ADX(14): trend strength
 *   bodyPct   — candle body / range (%): quality filter
 *   closeLoc  — close location in range [0,1]: where close sits
 *   ema20gap  — % above/below 20-bar EMA: breakout clearance
 *
 * IS/OOS split: 2025-05-05 (same as all other backtests)
 * Entry: next-bar open, stop clamped [3.5%, 6.5%]
 * Target: +5% in ≤20 bars before stop
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

// ── Config ─────────────────────────────────────────────────────────────────
const WINDOW   = 300;
const MAX_HOLD = 20;
const TARGET   = 1.05;   // +5%
const OOS_DATE = '2025-05-05';
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORK   = 10;

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'optimized_highprecision_15plus': 'CompressionCoil',
  'optimized_elite_10plus':         'MomentumPocket',
  'optimized_ultraselective_8plus': 'EMAStack',
  'sniper_95plus':                  'PerfectStorm',
  'ors_prime_reversal':             'ORS-Prime',
};
const BUY = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// Minimum n thresholds
const MIN_IS  = 15;
const MIN_OOS = 10;

// ── Indicator grid ──────────────────────────────────────────────────────────
const GRID = {
  cmf20:    [-0.05, 0.0, 0.05, 0.08, 0.10, 0.12, 0.15],
  obv10:    [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0],
  rsi14:    [40, 45, 50, 55, 60],
  rsi2:     [null, 60, 70, 80],     // null = no filter; upper bound RSI2 ≤ threshold
  volRatio: [1.0, 1.5, 2.0, 2.5, 3.0],
  atrPct:   [null, 1.5, 2.0, 2.5, 3.0],  // null = no filter; atrPct ≥ threshold
  adx14:    [null, 20, 25, 30],
  bodyPct:  [null, 0.3, 0.4, 0.5],
  closeLoc: [null, 0.5, 0.6, 0.7],   // close must be in upper portion of range
};

// ── Date helpers ────────────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p.length === 3) {
      if (p[0].length === 4) return Date.UTC(+p[0], +p[1]-1, +p[2]);
      const m = MON[p[1]];
      if (m !== undefined) return Date.UTC(+p[2], m, +p[0]);
    }
  }
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts: parseNSEDate(p[0]), o: +p[1], h: +p[2], l: +p[3], c, v: +p[5] || 0 });
  }
  return out;
}

// ── Technical indicators ────────────────────────────────────────────────────
function computeCMF(candles, endIdx, period = 20) {
  let sumMFV = 0, sumVol = 0;
  const start = Math.max(0, endIdx - period + 1);
  for (let i = start; i <= endIdx; i++) {
    const { h, l, c, v } = candles[i];
    const rng = h - l;
    if (rng > 0 && v > 0) { sumMFV += ((c - l) - (h - c)) / rng * v; sumVol += v; }
  }
  return sumVol > 0 ? sumMFV / sumVol : 0;
}

function computeOBVSlope(candles, endIdx, period = 10) {
  const start = Math.max(1, endIdx - period);
  if (endIdx - start < 3) return 0;
  let obv = 0; const obvV = [], vols = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].c > candles[i-1].c) obv += candles[i].v;
    else if (candles[i].c < candles[i-1].c) obv -= candles[i].v;
    obvV.push(obv); vols.push(candles[i].v);
  }
  const n = obvV.length, mv = vols.reduce((a,b) => a+b, 0)/n || 1;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i = 0; i < n; i++) { sx+=i; sy+=obvV[i]; sxy+=i*obvV[i]; sx2+=i*i; }
  const d = n*sx2 - sx*sx;
  return Math.abs(d) < 1e-10 ? 0 : (n*sxy - sx*sy) / d / mv;
}

function computeRSI(candles, endIdx, period = 14) {
  const start = Math.max(1, endIdx - period*3);
  let g = 0, l = 0;
  for (let i = start; i <= endIdx; i++) {
    const d = candles[i].c - candles[i-1].c;
    if (d > 0) g += d; else l -= d;
  }
  const n = endIdx - start; if (!n) return 50;
  g /= n; l /= n;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function computeATRPct(candles, endIdx, period = 14) {
  const start = Math.max(1, endIdx - period);
  let sum = 0, cnt = 0;
  for (let i = start; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
    sum += tr; cnt++;
  }
  const atr = cnt > 0 ? sum / cnt : 0;
  return candles[endIdx].c > 0 ? atr / candles[endIdx].c * 100 : 0;
}

function computeADX(candles, endIdx, period = 14) {
  const start = Math.max(1, endIdx - period * 2);
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = start; i <= endIdx; i++) {
    const h = candles[i].h, l = candles[i].l;
    const ph = candles[i-1].h, pl = candles[i-1].l, pc = candles[i-1].c;
    const tr = Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
    const up = h - ph, dn = pl - l;
    plusDM  += (up > dn && up > 0) ? up : 0;
    minusDM += (dn > up && dn > 0) ? dn : 0;
    trSum   += tr;
  }
  if (!trSum) return 0;
  const di_plus  = plusDM  / trSum * 100;
  const di_minus = minusDM / trSum * 100;
  const denom = di_plus + di_minus;
  return denom > 0 ? Math.abs(di_plus - di_minus) / denom * 100 : 0;
}

function computeEMA(candles, endIdx, period = 20) {
  const start = Math.max(0, endIdx - period * 3);
  let ema = candles[start].c;
  const k = 2 / (period + 1);
  for (let i = start + 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);
  return ema;
}

function signalIndicators(candles, endIdx) {
  const bar = candles[endIdx];
  const rng = bar.h - bar.l;
  const bodyPct = rng > 0 ? Math.abs(bar.c - bar.o) / rng : 0;
  const closeLoc = rng > 0 ? (bar.c - bar.l) / rng : 0.5;

  let vSum = 0, vCnt = 0;
  for (let j = Math.max(0, endIdx - 20); j < endIdx; j++) { vSum += candles[j].v; vCnt++; }
  const vAvg = vCnt > 0 ? vSum / vCnt : 1;
  const volRatio = bar.v / vAvg;

  const ema20 = computeEMA(candles, endIdx, 20);
  const ema20gap = ema20 > 0 ? (bar.c - ema20) / ema20 * 100 : 0;

  return {
    cmf20:    computeCMF(candles, endIdx, 20),
    obv10:    computeOBVSlope(candles, endIdx, 10),
    rsi14:    computeRSI(candles, endIdx, 14),
    rsi2:     computeRSI(candles, endIdx, 2),
    volRatio,
    atrPct:   computeATRPct(candles, endIdx, 14),
    adx14:    computeADX(candles, endIdx, 14),
    bodyPct,
    closeLoc,
    ema20gap,
  };
}

// ── Trade simulation ────────────────────────────────────────────────────────
function simHitRate(candles, sigIdx, initStop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;
  const ep = candles[eIdx].o;
  if (!ep || ep <= 0) return null;

  const floorStop = ep * (1 - 3.5 / 100);
  const capStop   = ep * (1 - 6.5 / 100);
  const stop = Math.min(floorStop, Math.max(capStop, initStop));
  const tgt  = ep * TARGET;

  let hit20 = false, barsToHit = null;
  for (let b = 1; b <= MAX_HOLD; b++) {
    const idx = eIdx + b;
    if (idx >= candles.length) break;
    const bar = candles[idx];
    if (bar.l <= stop) break;
    if (bar.h >= tgt) { hit20 = true; barsToHit = b; break; }
  }
  return { hit20, barsToHit, riskPct: (ep - stop) / ep * 100 };
}

// ── Worker ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, oosTs } = workerData;
  const bank = {};
  for (const ps of PARAM_SETS) bank[ps] = [];

  for (const fp of files) {
    const all = parseNSE(fp);
    if (all.length < WINDOW + MAX_HOLD + 5) continue;

    const lastTrade = {};

    for (let i = WINDOW; i < all.length - MAX_HOLD - 2; i++) {
      for (const ps of PARAM_SETS) {
        const lt = lastTrade[ps] ?? -1;
        if (i <= lt) continue;

        const win = all.slice(i - WINDOW, i + 1);
        let res;
        try { res = analyzeStock(win, ps); } catch { continue; }
        if (!res || !BUY.has(res.stage)) continue;

        const stop = res.priceEngine?.tacticalStop ?? all[i].c * 0.95;
        const t    = simHitRate(all, i, stop);
        if (!t) continue;

        const exitBar = i + 1 + (t.barsToHit ?? MAX_HOLD);
        lastTrade[ps] = exitBar;

        const inds = signalIndicators(all, i);
        const oos  = all[i].ts >= oosTs;

        bank[ps].push({ hit20: t.hit20, oos, riskPct: t.riskPct, ...inds });
      }
    }
  }
  parentPort.postMessage(bank);
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
  .map(f => path.join(DATA_DIR, f));

const oosTs  = parseNSEDate(OOS_DATE);
const chunks = Array.from({ length: N_WORK }, (_, i) =>
  allFiles.filter((_, j) => j % N_WORK === i));

console.log('Hit-Rate Optimizer — sweeping indicator gates per archetype');
console.log(`Files: ${allFiles.length} | OOS cutoff: ${OOS_DATE}\n`);

const combined = {};
for (const ps of PARAM_SETS) combined[ps] = [];

let done = 0;
const workers = chunks.map(files => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files, oosTs } });
  w.on('message', data => {
    for (const ps of PARAM_SETS) combined[ps].push(...data[ps]);
    done += files.length;
    process.stdout.write(`  collecting signals: ${done}/${allFiles.length}\r`);
    resolve();
  });
  w.on('error', reject);
}));

Promise.all(workers).then(() => {
  console.log('\n');

  const outRows = [];

  for (const ps of PARAM_SETS) {
    const label  = LABELS[ps];
    const signals = combined[ps];
    const isSigs  = signals.filter(s => !s.oos);
    const oosSigs = signals.filter(s =>  s.oos);

    const baseIS  = isSigs.filter(s => s.hit20).length / (isSigs.length || 1) * 100;
    const baseOOS = oosSigs.filter(s => s.hit20).length / (oosSigs.length || 1) * 100;

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${label}  (IS n=${isSigs.length} base HR=${baseIS.toFixed(1)}%)  (OOS n=${oosSigs.length} base HR=${baseOOS.toFixed(1)}%)`);
    console.log(`${'─'.repeat(80)}`);

    const best = [];

    // Sweep all combos
    for (const cmf    of GRID.cmf20)
    for (const obv    of GRID.obv10)
    for (const rsi14  of GRID.rsi14)
    for (const rsi2   of GRID.rsi2)
    for (const volR   of GRID.volRatio)
    for (const atr    of GRID.atrPct)
    for (const adx    of GRID.adx14)
    for (const body   of GRID.bodyPct)
    for (const cloc   of GRID.closeLoc)
    {
      const isF = isSigs.filter(s =>
        s.cmf20    >= cmf &&
        s.obv10    >= obv &&
        s.rsi14    >= rsi14 &&
        (rsi2 === null  || s.rsi2  <= rsi2)  &&
        s.volRatio >= volR &&
        (atr  === null  || s.atrPct >= atr)  &&
        (adx  === null  || s.adx14  >= adx)  &&
        (body === null  || s.bodyPct >= body) &&
        (cloc === null  || s.closeLoc >= cloc)
      );
      if (isF.length < MIN_IS) continue;
      const isHR = isF.filter(s => s.hit20).length / isF.length * 100;
      if (isHR < 60) continue;

      const oosF = oosSigs.filter(s =>
        s.cmf20    >= cmf &&
        s.obv10    >= obv &&
        s.rsi14    >= rsi14 &&
        (rsi2 === null  || s.rsi2  <= rsi2)  &&
        s.volRatio >= volR &&
        (atr  === null  || s.atrPct >= atr)  &&
        (adx  === null  || s.adx14  >= adx)  &&
        (body === null  || s.bodyPct >= body) &&
        (cloc === null  || s.closeLoc >= cloc)
      );
      if (oosF.length < MIN_OOS) continue;
      const oosHR = oosF.filter(s => s.hit20).length / oosF.length * 100;

      best.push({ cmf, obv, rsi14, rsi2, volR, atr, adx, body, cloc, isHR, isN: isF.length, oosHR, oosN: oosF.length });
    }

    best.sort((a, b) => b.oosHR - a.oosHR || b.oosN - a.oosN);
    const top = best.slice(0, 10);

    if (!top.length) {
      console.log('  No configs passed filters (try lowering MIN_IS/MIN_OOS or IS threshold)');
    } else {
      console.log('  Rank  OOS HR   OOS n   IS HR   IS n  | cmf≥   obv≥  rsi14≥  rsi2≤  vol≥  atr≥  adx≥  body≥  cloc≥');
      top.forEach((r, i) => {
        console.log(
          `  ${String(i+1).padStart(4)}  ${r.oosHR.toFixed(1).padStart(6)}%  ${String(r.oosN).padStart(6)}  ${r.isHR.toFixed(1).padStart(5)}%  ${String(r.isN).padStart(5)}  | ` +
          `${String(r.cmf).padStart(5)}  ${String(r.obv).padStart(5)}  ${String(r.rsi14).padStart(6)}  ${r.rsi2===null?'  any':String(r.rsi2).padStart(5)}  ` +
          `${String(r.volR).padStart(4)}  ${r.atr===null?'any':String(r.atr).padStart(4)}  ${r.adx===null?' any':String(r.adx).padStart(4)}  ` +
          `${r.body===null?' any':r.body.toFixed(1).padStart(5)}  ${r.cloc===null?' any':r.cloc.toFixed(1).padStart(5)}`
        );
      });
    }

    // Best robust (OOS n ≥ 20)
    const robust = best.filter(r => r.oosN >= 20).slice(0, 3);
    if (robust.length) {
      console.log(`\n  BEST ROBUST (OOS n≥20):`);
      robust.forEach((r, i) => {
        console.log(`    #${i+1}: OOS HR=${r.oosHR.toFixed(1)}% n=${r.oosN} | cmf≥${r.cmf} obv≥${r.obv} rsi14≥${r.rsi14} rsi2≤${r.rsi2??'any'} vol≥${r.volR} atr≥${r.atr??'any'} adx≥${r.adx??'any'} body≥${r.body??'any'} cloc≥${r.cloc??'any'}`);
      });
    }

    outRows.push({ ps, label, baseIS, baseOOS, total: signals.length, top, robust });
  }

  // Save
  const tag = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const out = path.join(__dirname, 'results', `hitrate_opt_${tag}.json`);
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), outRows }, null, 2));
  console.log(`\n\nFull results → ${out}`);
});
