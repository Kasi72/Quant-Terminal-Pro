'use strict';
/**
 * ideaBacktest.js — Tests 5 new signal ideas from scratch
 *
 * A1: 52-Week High Proximity Breakout
 *     — stock within 5% of 252-day high, breaks 5-day high, vol≥2×, above EMA50
 *
 * A2: Volatility Squeeze → Expansion
 *     — prior 5-day avg range < 70% of 20-day avg (compression)
 *       current bar range > 1.5× prior 5-day avg + closeLoc≥0.70 + above EMA20
 *
 * A3: Trend Pullback + RSI2 ≤ 10
 *     — ADX14≥25 + close>EMA50 + RSI2 drops ≤10 (deep oversold in uptrend)
 *
 * A4: Multi-Archetype Confluence (≥2 of 6 archetypes agree on same bar)
 *
 * A5: Gap-Confirmation on any engine signal (next open ≥0.5% gap-up from signal close)
 *
 * All: non-overlapping trades per approach per symbol
 *      entry = next-bar open, stop clamped [3.5%,6.5%] off entry,
 *      target +5%, max-hold 20 bars, MIN_TURN 5M
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW     = 300;
const MAX_HOLD   = 20;
const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const APPROACHES = ['A1_52wk','A2_squeeze','A3_pullback','A4_confluence','A5_gap'];

// ── Date helpers ──────────────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p[0].length === 4) return Date.UTC(+p[0],+p[1]-1,+p[2]);
    const m = MON[p[1]];
    if (m !== undefined) return Date.UTC(+p[2],m,+p[0]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseNSE(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4];
    if (!c || c <= 0) continue;
    out.push({ ts:parseNSEDate(p[0]), o:+p[1], h:+p[2], l:+p[3], c, v:+p[5]||0 });
  }
  return out;
}

// ── Indicator precompute ──────────────────────────────────────────────────────
function buildEMA(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i-1] * (1 - k);
  }
  return out;
}

function buildATR(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
  }
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
    out[i] = (out[i-1] * (period - 1) + tr) / period;
  }
  return out;
}

function buildADX(candles, period = 14) {
  const n = candles.length;
  const adxOut = new Array(n).fill(null);
  if (n < period * 2 + 2) return adxOut;

  // init Wilder sums over first `period` bars (starting at bar 1)
  let smTR = 0, smPDM = 0, smNDM = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c));
    const up   = candles[i].h - candles[i-1].h;
    const down = candles[i-1].l - candles[i].l;
    smTR  += tr;
    smPDM += (up > down && up > 0)     ? up   : 0;
    smNDM += (down > up && down > 0)   ? down : 0;
  }

  // DX at bar `period`
  const dxArr = new Array(n).fill(null);
  const di = (smTR > 0)
    ? { p: 100*smPDM/smTR, n: 100*smNDM/smTR }
    : { p: 0, n: 0 };
  dxArr[period] = (di.p + di.n) > 0 ? 100*Math.abs(di.p - di.n)/(di.p + di.n) : 0;

  for (let i = period + 1; i < n; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c));
    const up   = candles[i].h - candles[i-1].h;
    const down = candles[i-1].l - candles[i].l;
    smTR  = smTR  - smTR/period  + tr;
    smPDM = smPDM - smPDM/period + ((up > down && up > 0)   ? up   : 0);
    smNDM = smNDM - smNDM/period + ((down > up && down > 0) ? down : 0);
    const p = smTR > 0 ? 100*smPDM/smTR : 0;
    const nd = smTR > 0 ? 100*smNDM/smTR : 0;
    dxArr[i] = (p + nd) > 0 ? 100*Math.abs(p - nd)/(p + nd) : 0;
  }

  // smooth DX → ADX (Wilder, seed = simple avg of first `period` DX values)
  let dxSum = 0, dxCount = 0;
  for (let i = period; i < n && dxCount < period; i++) {
    if (dxArr[i] !== null) { dxSum += dxArr[i]; dxCount++; }
  }
  const adxSeedIdx = period + period - 1; // ~27 for period=14
  if (adxSeedIdx >= n) return adxOut;
  adxOut[adxSeedIdx] = dxSum / period;
  for (let i = adxSeedIdx + 1; i < n; i++) {
    if (dxArr[i] === null) { adxOut[i] = adxOut[i-1]; continue; }
    adxOut[i] = (adxOut[i-1] * (period - 1) + dxArr[i]) / period;
  }
  return adxOut;
}

function rsi2(candles, i) {
  if (i < 2) return null;
  const g1 = Math.max(candles[i].c   - candles[i-1].c, 0);
  const g2 = Math.max(candles[i-1].c - candles[i-2].c, 0);
  const l1 = Math.max(candles[i-1].c - candles[i].c,   0);
  const l2 = Math.max(candles[i-2].c - candles[i-1].c, 0);
  const avgG = (g1 + g2) / 2;
  const avgL = (l1 + l2) / 2;
  if (avgG + avgL < 1e-10) return 50;
  return 100 - 100 / (1 + avgG / (avgL + 1e-10));
}

function avgVol(candles, i, period = 20) {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - period); j < i; j++) { s += candles[j].v; n++; }
  return n > 0 ? s/n : 0;
}

function avgTurn(candles, i) {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) { s += candles[j].c * candles[j].v; n++; }
  return n > 0 ? s/n : 0;
}

// ── Trade simulator ───────────────────────────────────────────────────────────
function simulate(candles, sigIdx, rawStop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;
  const ep = candles[eIdx].o;
  if (!ep || ep <= 0) return null;
  const floorStop = ep * (1 - 3.5/100);
  const capStop   = ep * (1 - 6.5/100);
  const stop      = Math.min(floorStop, Math.max(capStop, rawStop));
  const target    = ep * (1 + TARGET_PCT/100);
  let hitTarget = false, hitStop = false, barsToTarget = null, mfe = 0, mae = 0;
  for (let b = 1; b <= MAX_HOLD; b++) {
    const idx = eIdx + b;
    if (idx >= candles.length) break;
    const bar = candles[idx];
    const barH = (bar.h - ep) / ep * 100;
    if (barH > mfe) mfe = barH;
    if (!hitTarget) {
      const barL = (ep - bar.l) / ep * 100;
      if (barL > mae) mae = barL;
    }
    if (bar.l <= stop) { hitStop = true; break; }
    if (bar.h >= target) { hitTarget = true; barsToTarget = b; break; }
  }
  const riskPct = (ep - stop) / ep * 100;
  return {
    hitTarget, hitStop, barsToTarget, riskPct,
    pnl: hitTarget ? TARGET_PCT : (hitStop ? -riskPct : 0),
    mfe, mae: hitTarget ? mae : null
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function aggregate(trades) {
  if (!trades.length) return null;
  const n = trades.length;
  const W = trades.filter(t => t.hitTarget);
  const L = trades.filter(t => t.hitStop && !t.hitTarget);
  const gW = W.length * TARGET_PCT;
  const gL = L.reduce((s,t) => s + t.riskPct, 0);
  const pf = gL > 0 ? gW/gL : (gW > 0 ? 999 : 0);
  const mfes = trades.map(t => t.mfe).sort((a,b)=>a-b);
  const medMFE = mfes[Math.floor(mfes.length/2)] ?? 0;
  const maesW = W.filter(t => t.mae !== null).map(t => t.mae);
  const avgMAE = maesW.length ? maesW.reduce((a,b)=>a+b,0)/maesW.length : 0;
  const days = W.filter(t => t.barsToTarget !== null).map(t => t.barsToTarget);
  const avgDays = days.length ? days.reduce((a,b)=>a+b,0)/days.length : 0;
  return {
    n,
    hit5: (W.length/n*100).toFixed(1),
    pf: pf.toFixed(2),
    avgPnl: (trades.reduce((s,t)=>s+t.pnl,0)/n).toFixed(2),
    medMFE: medMFE.toFixed(2),
    avgMAE: avgMAE.toFixed(2),
    avgDays: avgDays.toFixed(1),
    avgRisk: (trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2),
  };
}

// ── Worker ────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, oosTs } = workerData;
  const buckets = {};
  for (const ap of APPROACHES) buckets[ap] = { all: [], oos: [] };

  for (const fp of files) {
    const candles = parseNSE(fp);
    if (candles.length < WINDOW + MAX_HOLD + 5) continue;

    // Precompute indicators
    const closes  = candles.map(c => c.c);
    const ema20   = buildEMA(closes, 20);
    const ema50   = buildEMA(closes, 50);
    const atr14   = buildATR(candles, 14);
    const adx14   = buildADX(candles, 14);

    // Per-approach non-overlapping trackers
    const lastTrade = {};
    for (const ap of APPROACHES) lastTrade[ap] = -1;

    for (let i = WINDOW; i < candles.length - MAX_HOLD - 2; i++) {
      if (avgTurn(candles, i) < MIN_TURN) continue;
      const c = candles[i];
      const isOOS = c.ts >= oosTs;

      // ── A1: 52-week high proximity breakout ──────────────────────────────
      if (i > lastTrade['A1_52wk'] && i >= 252) {
        let h52 = 0;
        for (let j = i - 252; j <= i; j++) h52 = Math.max(h52, candles[j].h);

        let local5Hi = 0;
        for (let j = i - 5; j < i; j++) local5Hi = Math.max(local5Hi, candles[j].h);

        const av = avgVol(candles, i, 20);
        const e50 = ema50[i];

        if (
          h52 > 0 && c.c >= h52 * 0.95 &&        // within 5% of 52wk high
          c.c > local5Hi &&                          // breaking 5-day resistance
          av > 0 && c.v >= 2.0 * av &&              // volume surge ≥2×
          e50 && c.c > e50                           // above EMA50
        ) {
          const rawStop = candles[i + 1] ? candles[i + 1].o * 0.95 : c.c * 0.95;
          const trade = simulate(candles, i, rawStop);
          if (trade) {
            lastTrade['A1_52wk'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
            buckets['A1_52wk'].all.push(trade);
            if (isOOS) buckets['A1_52wk'].oos.push(trade);
          }
        }
      }

      // ── A2: Volatility squeeze → expansion ───────────────────────────────
      if (i > lastTrade['A2_squeeze'] && i >= 20) {
        const curr_range = c.h - c.l;
        // avg of last 5 bars' range (compression window)
        let sum5 = 0;
        for (let j = i - 5; j < i; j++) sum5 += candles[j].h - candles[j].l;
        const avg5 = sum5 / 5;
        // avg of last 20 bars' range (baseline)
        let sum20 = 0;
        for (let j = i - 20; j < i; j++) sum20 += candles[j].h - candles[j].l;
        const avg20 = sum20 / 20;
        // close location
        const rng = c.h - c.l;
        const cloc = rng > 0 ? (c.c - c.l) / rng : 0;
        const e20 = ema20[i];

        if (
          avg5 > 0 && avg20 > 0 &&
          avg5 < avg20 * 0.70 &&            // prior 5 days compressed vs 20-day norm
          curr_range > 1.5 * avg5 &&         // today is expanding ≥1.5× compressed avg
          cloc >= 0.70 &&                    // closed in upper 30% of today's bar
          e20 && c.c > e20                   // above EMA20
        ) {
          const rawStop = candles[i + 1] ? candles[i + 1].o * 0.95 : c.c * 0.95;
          const trade = simulate(candles, i, rawStop);
          if (trade) {
            lastTrade['A2_squeeze'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
            buckets['A2_squeeze'].all.push(trade);
            if (isOOS) buckets['A2_squeeze'].oos.push(trade);
          }
        }
      }

      // ── A3: Trend pullback + RSI2 ≤ 10 ──────────────────────────────────
      if (i > lastTrade['A3_pullback'] && i >= 30) {
        const r2  = rsi2(candles, i);
        const adx = adx14[i];
        const e50 = ema50[i];

        if (
          r2 !== null && r2 <= 10 &&          // extreme short-term oversold
          adx !== null && adx >= 25 &&         // strong underlying trend
          e50 && c.c > e50                     // price above EMA50 (uptrend context)
        ) {
          const rawStop = candles[i + 1] ? candles[i + 1].o * 0.95 : c.c * 0.95;
          const trade = simulate(candles, i, rawStop);
          if (trade) {
            lastTrade['A3_pullback'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
            buckets['A3_pullback'].all.push(trade);
            if (isOOS) buckets['A3_pullback'].oos.push(trade);
          }
        }
      }

      // ── A4: Multi-archetype confluence (≥2 archetypes) ───────────────────
      if (i > lastTrade['A4_confluence']) {
        const slice = candles.slice(0, i + 1);
        let count = 0;
        let firstStop = null;
        for (const ps of PARAM_SETS) {
          try {
            const r = analyzeStock(slice, ps);
            if (r && BUY_STAGES.has(r.stage)) {
              count++;
              if (firstStop === null) {
                firstStop = r.tacticalPlan?.stop ?? r.priceEngine?.stop ?? null;
              }
            }
          } catch {}
        }
        if (count >= 2) {
          const epEst = candles[i + 1]?.o ?? c.c;
          const rawStop = firstStop ?? epEst * 0.95;
          const trade = simulate(candles, i, rawStop);
          if (trade) {
            lastTrade['A4_confluence'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
            buckets['A4_confluence'].all.push(trade);
            if (isOOS) buckets['A4_confluence'].oos.push(trade);
          }
        }
      }

      // ── A5: Gap-confirmation on any engine signal ─────────────────────────
      if (i > lastTrade['A5_gap'] && i + 1 < candles.length) {
        const nextOpen = candles[i + 1].o;
        if (nextOpen > c.c * 1.005) {          // ≥0.5% gap-up at next open
          const slice = candles.slice(0, i + 1);
          let fired = false, gapStop = null;
          for (const ps of PARAM_SETS) {
            try {
              const r = analyzeStock(slice, ps);
              if (r && BUY_STAGES.has(r.stage)) {
                fired = true;
                gapStop = r.tacticalPlan?.stop ?? r.priceEngine?.stop ?? null;
                break;
              }
            } catch {}
          }
          if (fired) {
            const rawStop = gapStop ?? nextOpen * 0.95;
            const trade = simulate(candles, i, rawStop);
            if (trade) {
              lastTrade['A5_gap'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
              buckets['A5_gap'].all.push(trade);
              if (isOOS) buckets['A5_gap'].oos.push(trade);
            }
          }
        }
      }
    }
  }

  parentPort.postMessage(buckets);
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
  .map(f => path.join(DATA_DIR, f));
const oosTs = parseNSEDate(OOS_DATE);
const chunks = Array.from({ length: N_WORKERS }, (_, i) => allFiles.filter((_, j) => j % N_WORKERS === i));
const combined = {};
for (const ap of APPROACHES) combined[ap] = { all: [], oos: [] };
let done = 0;

Promise.all(chunks.map(files => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files, oosTs } });
  w.on('message', data => {
    for (const ap of APPROACHES) {
      combined[ap].all.push(...data[ap].all);
      combined[ap].oos.push(...data[ap].oos);
    }
    done += files.length;
    process.stdout.write(`  ${done}/${allFiles.length}\r`);
    resolve();
  });
  w.on('error', reject);
}))).then(() => {
  const ts = new Date().toISOString();
  const lines = [];
  const pr = s => { lines.push(s); process.stdout.write(s + '\n'); };

  pr(`\n${'═'.repeat(110)}`);
  pr(`Idea Backtest Results   ${ts}`);
  pr(`Universe: ${allFiles.length} NIFTY ALL symbols | OOS cutoff: ${OOS_DATE} | Target: +5% | MaxHold: ${MAX_HOLD} bars | MinTurn: ${(MIN_TURN/1e6).toFixed(0)}M`);
  pr(`${'═'.repeat(110)}`);

  // Baseline reference (from prior fivePctHitRateBacktest)
  pr(`\nBaseline reference (existing archetypes, OOS):`);
  pr(`  VF 47.9% PF=0.85 | CC 44.3% PF=0.84 | MP 43.8% PF=0.77 | EMA 40.9% PF=0.62 | PS 52.6% PF=1.12 | ORS 66.7% PF=1.62`);
  pr(`${'─'.repeat(110)}`);

  const FMT = {
    A1_52wk:      '52-Wk High Breakout     (within5% + break5d + vol≥2× + EMA50)',
    A2_squeeze:   'Volatility Squeeze→Exp  (avg5<70%avg20 + range>1.5× + cloc≥70% + EMA20)',
    A3_pullback:  'Trend Pullback+RSI2≤10  (ADX≥25 + EMA50 + RSI2≤10)',
    A4_confluence:'Multi-Archetype ≥2      (≥2 of 6 archetypes fire same bar)',
    A5_gap:       'Gap-Confirm Entry       (any engine signal + next-open gap≥0.5%)',
  };

  for (const ap of APPROACHES) {
    const full = aggregate(combined[ap].all);
    const oos  = aggregate(combined[ap].oos);
    pr(`\n${FMT[ap]}`);
    pr(`  Full: ${full ? `n=${full.n}  Hit5=${full.hit5}%  PF=${full.pf}  AvgP&L=${full.avgPnl>0?'+':''}${full.avgPnl}%  MedMFE=${full.medMFE}%  AvgMAE=-${full.avgMAE}%  AvgDays=${full.avgDays}  AvgRisk=${full.avgRisk}%` : 'no signals'}`);
    pr(`  OOS:  ${oos  ? `n=${oos.n}   Hit5=${oos.hit5}%  PF=${oos.pf}  AvgP&L=${oos.avgPnl>0?'+':''}${oos.avgPnl}%  MedMFE=${oos.medMFE}%  AvgMAE=-${oos.avgMAE}%  AvgDays=${oos.avgDays}  AvgRisk=${oos.avgRisk}%` : 'no signals'}`);
    if (full && oos) {
      const overfit = (parseFloat(full.hit5) - parseFloat(oos.hit5)).toFixed(1);
      pr(`  IS→OOS decay: ${overfit}pp  (Full ${full.hit5}% → OOS ${oos.hit5}%)`);
    }
  }

  pr(`\n${'═'.repeat(110)}`);

  // Save
  const outPath = path.join(__dirname, 'results', `idea_backtest_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  pr(`Saved → ${outPath}`);
});
