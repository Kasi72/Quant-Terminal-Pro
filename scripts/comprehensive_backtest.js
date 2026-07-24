'use strict';
/**
 * comprehensive_backtest.js — Full system backtest (current production params)
 * ============================================================================
 * Uses the EXACT archetypePriceEngine params deployed as of 2026-07-24:
 *   • Per-archetype stop caps (hyper_mae 2026-07-23 bootstrap-CI)
 *   • MP NORMAL floor = 3.0%, MP VOLATILE floor = 3.5%
 *   • CircuitBreaker: sw5Low structural anchor + 'CB' hint
 *   • maxHoldBars per-archetype time stop
 *
 * Archetypes: ORS, VolumeFootprint, CompressionCoil, MomentumPocket, EMAStack, CircuitBreaker
 *
 * Simulation (close-of-signal entry):
 *   Entry  = pe.plannedEntry (signal bar close/open from archetypePriceEngine)
 *   Stop   = pe.tacticalStop
 *   T1/T2/T3 = pe.target5 / pe.target7 / pe.target10
 *   Time stop = pe.maxHoldBars bars after entry
 *
 * Exit cascade (50/30/20):
 *   Phase 1: 0→T1  (stop = original).  T1 hit → 50% exits at T1.
 *   Phase 2: T1→T2 (stop = original).  T2 hit → 30% exits at T2.
 *   Phase 3: T2→T3 (stop = original).  T3 hit → 20% exits at T3.
 *   Time stop:   exit at bar close (any phase).
 *   Gap-down stop: next-bar open < stop → exit at open.
 *
 * OOS split: pre-2024 = in-sample; 2024+ = out-of-sample.
 *
 * Output: per-archetype × stage × ATR-band table + aggregate P&L.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS  = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR    = path.join(__dirname, 'results');
const OOS_CUT    = new Date('2024-01-01T00:00:00Z').getTime() / 1000;
const WINDOW     = 300;
const MIN_BARS   = WINDOW + 30;
const N_WORKERS  = Math.min(os.cpus().length, 8);

const ARCH_KEYS = [
  ['ORS',              'ors_prime_reversal'],
  ['VolumeFootprint',  'optimized_deployable_20plus'],
  ['CompressionCoil',  'optimized_highprecision_15plus'],
  ['MomentumPocket',   'optimized_elite_10plus'],
  ['EMAStack',         'optimized_ultraselective_8plus'],
  ['CircuitBreaker',   'circuit_breaker_v2'],
];
const STAGES  = ['BUY', 'STRONG', 'ULTRA'];
const BUCKETS = ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH'];

const W1 = 0.50, W2 = 0.30, W3 = 0.20;   // exit cascade weights

// ── CSV parser (identical to mae_study.js) ───────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const [o, h, l, c, v] = [+p[1], +p[2], +p[3], +p[4], +p[5]];
    if (!isFinite(ts) || !isFinite(o) || o <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
    else d.push(x);
  }
  return d;
}

// ── ATR bucket ───────────────────────────────────────────────────────────────
function atrBucket(p) {
  if (p < 1.5) return 'TIGHT';
  if (p < 2.5) return 'NORMAL';
  if (p < 3.5) return 'VOLATILE';
  return 'HIGH';
}

// ── Empty per-cell accumulator ───────────────────────────────────────────────
function newAcc() {
  const acc = {};
  for (const [arch] of ARCH_KEYS) {
    acc[arch] = {};
    for (const stage of STAGES) {
      acc[arch][stage] = {};
      for (const bkt of BUCKETS) {
        acc[arch][stage][bkt] = {
          is:  newCell(),   // in-sample (pre-2024)
          oos: newCell(),   // out-of-sample (2024+)
        };
      }
    }
  }
  return acc;
}
function newCell() {
  return {
    n: 0, n_stop: 0, n_t1: 0, n_t2: 0, n_t3: 0, n_timeout: 0,
    sum_pl: 0, sum_win_pl: 0, sum_loss_pl: 0,
    sum_r: 0, sum_r2: 0,
    mae: [], mfe: [], hold: [],
    rr_at_entry: [],      // planned RR from engine
  };
}

function mergeCell(dst, src) {
  dst.n         += src.n;
  dst.n_stop    += src.n_stop;
  dst.n_t1      += src.n_t1;
  dst.n_t2      += src.n_t2;
  dst.n_t3      += src.n_t3;
  dst.n_timeout += src.n_timeout;
  dst.sum_pl    += src.sum_pl;
  dst.sum_win_pl += src.sum_win_pl;
  dst.sum_loss_pl += src.sum_loss_pl;
  dst.sum_r     += src.sum_r;
  dst.sum_r2    += src.sum_r2;
  for (const v of src.mae) dst.mae.push(v);
  for (const v of src.mfe) dst.mfe.push(v);
  for (const v of src.hold) dst.hold.push(v);
  for (const v of src.rr_at_entry) dst.rr_at_entry.push(v);
}

function mergeAcc(dst, src) {
  for (const [arch] of ARCH_KEYS)
    for (const stage of STAGES)
      for (const bkt of BUCKETS) {
        mergeCell(dst[arch][stage][bkt].is,  src[arch][stage][bkt].is);
        mergeCell(dst[arch][stage][bkt].oos, src[arch][stage][bkt].oos);
      }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ════════════════════════════════════════════════════════════════════════════
// WORKER
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const engine = require(ENGINE_JS);

  const acc = newAcc();

  for (const fp of workerData.files) {
    let candles;
    try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < MIN_BARS) continue;

    for (let i = WINDOW - 1; i < candles.length - 2; i++) {
      const bar = candles[i];
      if (!bar || bar.c <= 0) continue;

      const w = candles.slice(i - WINDOW + 1, i + 1);

      for (const [arch, key] of ARCH_KEYS) {
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r) continue;
        const stg = r.stage;
        if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid || pe.tacticalStop <= 0 || pe.target5 <= pe.plannedEntry) continue;

        const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA'
                        : stg === 'STRONG_BUY'       ? 'STRONG' : 'BUY';

        const atrPct  = pe.atr14AtEntry > 0 ? pe.atr14AtEntry / pe.plannedEntry * 100 : r.atrPct || 2;
        const bkt     = atrBucket(atrPct);
        const isOOS   = bar.ts >= OOS_CUT;

        // ── Price levels from engine ─────────────────────────────────────
        const entry   = pe.plannedEntry;
        const stop    = pe.tacticalStop;
        const t1      = pe.target5;
        const t2      = pe.target7;
        const t3      = pe.target10;
        const riskAbs = entry - stop;
        if (riskAbs <= 0) continue;
        const maxHold = pe.maxHoldBars || 20;
        const plannedRR = pe.rewardRisk || 0;

        // ── Forward simulation ───────────────────────────────────────────
        const entryIdx = i + 1;
        const endIdx   = Math.min(candles.length - 1, entryIdx + maxHold);
        if (entryIdx >= candles.length) continue;

        let tradeMAE  = 0, tradeMFE = 0;
        let exitPL    = null;    // final P&L in % from entry
        let exitR     = null;    // R-multiple
        let stopHit   = false, t1Hit = false, t2Hit = false, t3Hit = false, timeoutHit = false;
        let holdBars  = 0;

        // Track cascade state
        let phase = 1;           // 1=pre-T1, 2=pre-T2, 3=pre-T3
        let weightLeft = 1.0;    // remaining position weight
        let weightedPL = 0;

        for (let j = entryIdx; j <= endIdx; j++) {
          const b = candles[j];
          if (!b) break;
          holdBars = j - entryIdx + 1;

          const adv = (entry - b.l) / entry * 100;
          const fav = (b.h - entry) / entry * 100;
          if (adv > tradeMAE) tradeMAE = adv;
          if (fav > tradeMFE) tradeMFE = fav;

          // Check gap-down at open (first priority each bar)
          if (j === entryIdx && b.o < stop) {
            // Gap-down stop: exit at open
            const gapLoss = (entry - b.o) / entry * 100;
            exitR = -(entry - b.o) / riskAbs;
            weightedPL = -gapLoss;
            stopHit = true;
            break;
          }

          // Phase 1 checks (pre-T1)
          if (phase === 1) {
            if (b.l <= stop) {
              // Stopped before T1
              const stopLossPL = (entry - stop) / entry * 100;
              weightedPL -= stopLossPL; // 100% position lost
              exitR = -1.0;
              stopHit = true;
              break;
            }
            if (b.h >= t1) {
              // T1 hit — exit 50% at T1
              const t1PL = (t1 - entry) / entry * 100;
              weightedPL += W1 * t1PL;
              weightLeft = W2 + W3;
              t1Hit = true;
              phase = 2;
              // Continue in same bar to check T2
            }
          }

          // Phase 2 checks (T1 reached, tracking T2)
          if (phase === 2) {
            if (b.l <= stop) {
              // Stopped after T1, before T2 (using original stop)
              const stopLossPL = (entry - stop) / entry * 100;
              weightedPL -= weightLeft * stopLossPL;
              break;
            }
            if (b.h >= t2) {
              const t2PL = (t2 - entry) / entry * 100;
              weightedPL += W2 * t2PL;
              weightLeft = W3;
              t2Hit = true;
              phase = 3;
            }
          }

          // Phase 3 checks (T2 reached, tracking T3)
          if (phase === 3) {
            if (b.l <= stop) {
              const stopLossPL = (entry - stop) / entry * 100;
              weightedPL -= weightLeft * stopLossPL;
              break;
            }
            if (b.h >= t3) {
              const t3PL = (t3 - entry) / entry * 100;
              weightedPL += W3 * t3PL;
              weightLeft = 0;
              t3Hit = true;
              break;
            }
          }

          // Time stop — exit remaining at close
          if (j === endIdx) {
            const closePL = (b.c - entry) / entry * 100;
            weightedPL += weightLeft * closePL;
            timeoutHit = !t1Hit; // only a "true timeout" if T1 never hit
            break;
          }
        }

        // R-multiple for the full trade
        if (exitR === null) {
          exitR = weightedPL / ((entry - stop) / entry * 100);
        }

        const cell = acc[arch][stageName][bkt][isOOS ? 'oos' : 'is'];
        cell.n++;
        if (stopHit && !t1Hit) cell.n_stop++;
        if (t1Hit) cell.n_t1++;
        if (t2Hit) cell.n_t2++;
        if (t3Hit) cell.n_t3++;
        if (timeoutHit) cell.n_timeout++;
        cell.sum_pl += weightedPL;
        if (weightedPL >= 0) cell.sum_win_pl += weightedPL;
        else cell.sum_loss_pl += Math.abs(weightedPL);
        cell.sum_r  += exitR;
        cell.sum_r2 += exitR * exitR;
        cell.mae.push(tradeMAE);
        cell.mfe.push(tradeMFE);
        cell.hold.push(holdBars);
        cell.rr_at_entry.push(plannedRR);
      }
    }
  }

  parentPort.postMessage(acc);
  return;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

console.log(`\n📊 Comprehensive Backtest — ${files.length} symbols, ${N_WORKERS} workers`);
console.log(`   Engine: ${ENGINE_JS}`);
console.log(`   OOS cutoff: 2024-01-01\n`);

const acc = newAcc();
let done = 0;
const chunkSize = Math.ceil(files.length / N_WORKERS);

const workers = Array.from({ length: N_WORKERS }, (_, i) => {
  const slice = files.slice(i * chunkSize, (i + 1) * chunkSize);
  const w = new Worker(__filename, { workerData: { files: slice } });
  w.on('message', partial => {
    mergeAcc(acc, partial);
    done++;
    process.stdout.write(`\r   Workers done: ${done}/${N_WORKERS}   `);
    if (done === N_WORKERS) report(acc);
  });
  w.on('error', e => console.error('Worker error:', e));
  return w;
});

// ── Report ──────────────────────────────────────────────────────────────────
function fmtCell(c, forOOS = false) {
  if (c.n < 5) return null;
  const wr    = c.n_t1 / c.n * 100;
  const sr    = c.n_stop / c.n * 100;
  const tr    = c.n_timeout / c.n * 100;
  const t2r   = c.n_t1 > 0 ? c.n_t2 / c.n_t1 * 100 : 0;
  const t3r   = c.n_t2 > 0 ? c.n_t3 / c.n_t2 * 100 : 0;
  const avgPL = c.sum_pl / c.n;
  const pf    = c.sum_loss_pl > 0 ? c.sum_win_pl / c.sum_loss_pl : Infinity;
  const avgR  = c.sum_r / c.n;
  const sdR   = c.n > 1 ? Math.sqrt((c.sum_r2 / c.n) - avgR * avgR) : 0;
  const kelly = sdR > 0 ? Math.max(0, avgR / (sdR * sdR)) * 100 : 0;
  const maeP50 = pct(c.mae, 50);
  const maeP75 = pct(c.mae, 75);
  const mfeP50 = pct(c.mfe, 50);
  const mfeP75 = pct(c.mfe, 75);
  const avgHold = c.hold.reduce((a, b) => a + b, 0) / c.hold.length;
  const avgRR   = c.rr_at_entry.reduce((a, b) => a + b, 0) / c.rr_at_entry.length;

  return {
    n: c.n, wr, sr, tr, t2r, t3r, avgPL, pf, avgR, kelly,
    maeP50, maeP75, mfeP50, mfeP75, avgHold, avgRR,
    t1: c.n_t1, t2: c.n_t2, t3: c.n_t3,
  };
}

function report(acc) {
  console.log('\n\n' + '═'.repeat(110));
  console.log('  COMPREHENSIVE BACKTEST — Quant Terminal Pro (archetypePriceEngine, 2026-07-24 params)');
  console.log('═'.repeat(110));

  const archSummaryOOS = {};
  const archSummaryIS  = {};

  for (const [arch, _key] of ARCH_KEYS) {
    const totOOS = newCell();
    const totIS  = newCell();

    for (const stage of STAGES)
      for (const bkt of BUCKETS) {
        mergeCell(totOOS, acc[arch][stage][bkt].oos);
        mergeCell(totIS,  acc[arch][stage][bkt].is);
      }

    archSummaryOOS[arch] = totOOS;
    archSummaryIS[arch]  = totIS;
  }

  // ── OOS Summary table ────────────────────────────────────────────────────
  console.log('\n┌─ OUT-OF-SAMPLE (2024-01-01 → present) ───────────────────────────────────────────────────────────────────┐');
  console.log('│ Archetype       │   N    │ WinRate │ StopRt │ T2 cond │ T3 cond │ AvgPL%  │  PF   │ AvgR  │ Kelly │ MAEp50│');
  console.log('├─────────────────┼────────┼─────────┼────────┼─────────┼─────────┼─────────┼───────┼───────┼───────┼───────┤');
  for (const [arch] of ARCH_KEYS) {
    const c = archSummaryOOS[arch];
    const f = fmtCell(c);
    if (!f) { console.log(`│ ${arch.padEnd(15)} │ ${String(c.n).padStart(6)} │   n/a   │  n/a   │  n/a    │  n/a    │  n/a    │  n/a  │  n/a  │  n/a  │  n/a  │`); continue; }
    console.log(
      `│ ${arch.padEnd(15)} │ ${String(f.n).padStart(6)} │ ${f.wr.toFixed(1).padStart(6)}% │ ${f.sr.toFixed(1).padStart(5)}% │  ${f.t2r.toFixed(1).padStart(5)}%  │  ${f.t3r.toFixed(1).padStart(5)}%  │ ${(f.avgPL>=0?'+':'')}${f.avgPL.toFixed(2).padStart(6)}% │ ${(f.pf===Infinity?'∞    ':f.pf.toFixed(2)).padStart(5)} │ ${(f.avgR>=0?'+':'')}${f.avgR.toFixed(2).padStart(4)} │ ${f.kelly.toFixed(1).padStart(4)}% │ ${f.maeP50.toFixed(1).padStart(4)}% │`
    );
  }
  console.log('└─────────────────┴────────┴─────────┴────────┴─────────┴─────────┴─────────┴───────┴───────┴───────┴───────┘');

  // ── Per-archetype detail (OOS) ───────────────────────────────────────────
  for (const [arch, _key] of ARCH_KEYS) {
    const archRows = [];
    for (const stage of STAGES)
      for (const bkt of BUCKETS) {
        const c = acc[arch][stage][bkt].oos;
        if (c.n < 5) continue;
        const f = fmtCell(c);
        if (!f) continue;
        archRows.push({ stage, bkt, f, c });
      }
    if (!archRows.length) continue;

    console.log(`\n  ◆ ${arch} — OOS detail (Stage × ATR-band)`);
    console.log(`  ${'Stage'.padEnd(8)} ${'Band'.padEnd(9)} ${'N'.padStart(5)} ${'WinR%'.padStart(6)} ${'StopR%'.padStart(7)} ${'T2cond%'.padStart(8)} ${'T3cond%'.padStart(8)} ${'AvgPL%'.padStart(8)} ${'PF'.padStart(6)} ${'AvgR'.padStart(6)} ${'MFEp50'.padStart(7)} ${'MAEp50'.padStart(7)} ${'HoldB'.padStart(6)} ${'RRplan'.padStart(7)}`);
    console.log('  ' + '─'.repeat(108));
    for (const { stage, bkt, f, c } of archRows) {
      console.log(
        `  ${stage.padEnd(8)} ${bkt.padEnd(9)} ${String(f.n).padStart(5)} ${f.wr.toFixed(1).padStart(6)} ${f.sr.toFixed(1).padStart(7)} ${f.t2r.toFixed(1).padStart(8)} ${f.t3r.toFixed(1).padStart(8)} ${((f.avgPL>=0?'+':'')+f.avgPL.toFixed(2)).padStart(8)} ${(f.pf===Infinity?'∞':f.pf.toFixed(2)).padStart(6)} ${((f.avgR>=0?'+':'')+f.avgR.toFixed(2)).padStart(6)} ${f.mfeP50.toFixed(1).padStart(7)} ${f.maeP50.toFixed(1).padStart(7)} ${f.avgHold.toFixed(1).padStart(6)} ${f.avgRR.toFixed(2).padStart(7)}`
      );
    }
  }

  // ── IS vs OOS comparison ─────────────────────────────────────────────────
  console.log('\n\n┌─ IN-SAMPLE vs OOS — Win Rate comparison ──────────────────────────────────────────┐');
  console.log('│ Archetype       │  IS N  │ IS WR%  │ IS PF  │ OOS N  │ OOS WR% │ OOS PF │ OOS AvgR │');
  console.log('├─────────────────┼────────┼─────────┼────────┼────────┼─────────┼────────┼──────────┤');
  for (const [arch] of ARCH_KEYS) {
    const ci = archSummaryIS[arch];
    const co = archSummaryOOS[arch];
    const fi = fmtCell(ci);
    const fo = fmtCell(co);
    const isWR  = fi ? fi.wr.toFixed(1)+'%' : 'n/a';
    const isPF  = fi ? (fi.pf===Infinity?'∞':fi.pf.toFixed(2)) : 'n/a';
    const oosWR = fo ? fo.wr.toFixed(1)+'%' : 'n/a';
    const oosPF = fo ? (fo.pf===Infinity?'∞':fo.pf.toFixed(2)) : 'n/a';
    const oosR  = fo ? ((fo.avgR>=0?'+':'')+fo.avgR.toFixed(3)) : 'n/a';
    console.log(`│ ${arch.padEnd(15)} │ ${String(ci.n).padStart(6)} │ ${isWR.padStart(7)} │ ${isPF.padStart(6)} │ ${String(co.n).padStart(6)} │ ${oosWR.padStart(7)} │ ${oosPF.padStart(6)} │ ${oosR.padStart(8)} │`);
  }
  console.log('└─────────────────┴────────┴─────────┴────────┴────────┴─────────┴────────┴──────────┘');

  // ── Overall system metrics ───────────────────────────────────────────────
  const allOOS = newCell();
  for (const [arch] of ARCH_KEYS) mergeCell(allOOS, archSummaryOOS[arch]);
  const fall = fmtCell(allOOS);
  if (fall) {
    console.log('\n┌─ SYSTEM AGGREGATE (OOS, all archetypes combined) ─────────────────────────────────────────────────┐');
    console.log(`│  Total signals : ${String(allOOS.n).padStart(6)}   │  Win rate (T1)   : ${fall.wr.toFixed(2)}%        │  Stop rate    : ${fall.sr.toFixed(2)}%           │`);
    console.log(`│  T2 cond hit   : ${fall.t2r.toFixed(2)}%   │  T3 cond hit     : ${fall.t3r.toFixed(2)}%        │  Time stop    : ${fall.tr.toFixed(2)}%           │`);
    console.log(`│  Avg P&L %     : ${((fall.avgPL>=0?'+':'')+fall.avgPL.toFixed(3)).padStart(7)}%  │  Profit Factor   : ${fall.pf===Infinity?'∞     ':fall.pf.toFixed(3)}        │  Avg R-mult   : ${((fall.avgR>=0?'+':'')+fall.avgR.toFixed(3)).padStart(7)}         │`);
    console.log(`│  Kelly frac    : ${fall.kelly.toFixed(2)}%  │  MAE p50         : ${fall.maeP50.toFixed(2)}%        │  MFE p50      : ${fall.mfeP50.toFixed(2)}%           │`);
    console.log(`│  MAE p75       : ${fall.maeP75.toFixed(2)}%  │  MFE p75         : ${fall.mfeP75.toFixed(2)}%        │  Avg hold bars: ${fall.avgHold.toFixed(1).padStart(5)} bars         │`);
    console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  }

  // ── Save JSON ────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(OUT_DIR, `comprehensive_backtest_${ts}.json`);
  const summary = {};
  for (const [arch] of ARCH_KEYS) {
    summary[arch] = {};
    for (const stage of STAGES) {
      summary[arch][stage] = {};
      for (const bkt of BUCKETS) {
        const co = acc[arch][stage][bkt].oos;
        const fo = fmtCell(co);
        if (fo) summary[arch][stage][bkt] = { n: fo.n, wr: fo.wr, sr: fo.sr, t2r: fo.t2r, t3r: fo.t3r, avgPL: fo.avgPL, pf: fo.pf === Infinity ? 999 : fo.pf, avgR: fo.avgR, kelly: fo.kelly, maeP50: fo.maeP50, mfeP50: fo.mfeP50, avgHold: fo.avgHold };
      }
    }
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), oos_from: '2024-01-01', summary, system: fall ? { n: allOOS.n, wr: fall.wr, sr: fall.sr, t2r: fall.t2r, t3r: fall.t3r, avgPL: fall.avgPL, pf: fall.pf === Infinity ? 999 : fall.pf, avgR: fall.avgR, kelly: fall.kelly, maeP50: fall.maeP50, mfeP50: fall.mfeP50, avgHold: fall.avgHold } : null }, null, 2));

  console.log(`\n  ✓ Results saved: ${outFile}\n`);
}
