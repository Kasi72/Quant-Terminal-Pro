'use strict';
/**
 * mae_study.js — Maximum Adverse Excursion: empirical stop distance study
 * =========================================================================
 * For each OOS signal (post-2025-05-05), forward-tracks 20 bars to answer:
 *
 *  Q1. "How much adverse movement do WINNING trades experience before T1?"
 *      Winner MAE distribution = the minimum room trades empirically need.
 *      (No grid search, no assumptions — direct price evidence.)
 *
 *  Q2. "At stop X%, what % of winners survive and what is the EV?"
 *      Stop survival curve = cost of tightening vs benefit of smaller losses.
 *
 * "Winner" = trade that reaches T1=1.5×ATR before the 12% wide reference stop.
 * Survival at X% = % of winners whose MAE (entry→T1) was < X%.
 *
 * Outputs per [archetype × stage × ATR bucket]:
 *   • Raw MAE/MFE percentiles (all signals, 20-bar worst drawdown)
 *   • Winner MAE percentiles (trades that reached T1 — empirical room needed)
 *   • Stop survival curve at 3–12% (% of winners NOT prematurely stopped)
 *   • Cascade EV curve at 3–12% (50%@T1 + 30%@T2 + 20%@T3)
 *   • Dual recommendation: EV-peak stop & p90-safe stop (winner MAE p90)
 *
 * Same infrastructure as sl_bucket_backtest.js (parseCSV, computeATR14, engine,
 * workers). OOS cutoff: 2025-05-05. Horizon: 20 bars. Workers: 8.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR    = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS   = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR     = path.join(__dirname, 'results');
const OOS_CUT     = new Date('2025-05-05T00:00:00Z').getTime() / 1000;
const HORIZON     = 20;
const WINDOW      = 300;
const MIN_BARS    = WINDOW + HORIZON + 5;
const WIDE_STOP   = 12;   // % — wide reference stop that defines "true winners"
const STOP_LEVELS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const N_WORKERS   = Math.min(os.cpus().length, 8);

const ARCHETYPES = [
  ['VolumeFootprint', 'optimized_deployable_20plus'],
  ['CompressionCoil', 'optimized_highprecision_15plus'],
  ['MomentumPocket',  'optimized_elite_10plus'],
  ['EMAStack',        'optimized_ultraselective_8plus'],
  ['PerfectStorm',    'sniper_95plus'],
  ['ORS',             'ors_prime_reversal'],
];
const STAGES  = ['BUY', 'STRONG', 'ULTRA'];
const BUCKETS = ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH'];

// Cascade weights (same as sl_bucket_backtest.js)
const T1_M = 1.5, T2_M = 2.5, T3_M = 5.0;
const W1 = 0.50, W2 = 0.30, W3 = 0.20;

function atrBucket(p) {
  if (p < 1.5) return 'TIGHT';
  if (p < 2.5) return 'NORMAL';
  if (p < 3.5) return 'VOLATILE';
  return 'HIGH';
}

// ── CSV parser (identical to sl_bucket_backtest.js) ─────────────────────────
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

// ── ATR14 (identical to sl_bucket_backtest.js) ──────────────────────────────
function computeATR14(c) {
  const a = new Float64Array(c.length);
  if (c.length <= 14) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++)
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
    a[i] = (a[i-1] * 13 + tr) / 14;
  }
  return a;
}

// ── Percentile ───────────────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ── Accumulator ──────────────────────────────────────────────────────────────
function newAcc() {
  const acc = {};
  for (const [arch] of ARCHETYPES) {
    acc[arch] = {};
    for (const stage of STAGES) {
      acc[arch][stage] = {};
      for (const bkt of BUCKETS) {
        const stopData = {};
        for (const sl of STOP_LEVELS)
          stopData[sl] = { n_hit: 0, n_stop: 0, n_timeout: 0, sumEV: 0 };
        acc[arch][stage][bkt] = { n: 0, mae_all: [], mfe_all: [], mae_winners: [], stopData };
      }
    }
  }
  return acc;
}

function mergeAcc(dst, src) {
  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      for (const bkt of BUCKETS) {
        const d = dst[arch][stage][bkt];
        const s = src[arch][stage][bkt];
        d.n += s.n;
        for (const v of s.mae_all)     d.mae_all.push(v);
        for (const v of s.mfe_all)     d.mfe_all.push(v);
        for (const v of s.mae_winners) d.mae_winners.push(v);
        for (const sl of STOP_LEVELS) {
          d.stopData[sl].n_hit     += s.stopData[sl].n_hit;
          d.stopData[sl].n_stop    += s.stopData[sl].n_stop;
          d.stopData[sl].n_timeout += s.stopData[sl].n_timeout;
          d.stopData[sl].sumEV     += s.stopData[sl].sumEV;
        }
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKER
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const engine = require(ENGINE_JS);
  for (const [, key] of ARCHETYPES) {
    try { engine.setArchetypeTuning(key, null); } catch {}
  }

  const acc = newAcc();
  let processed = 0;

  for (const fp of workerData.files) {
    let c;
    try { c = parseCSV(fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }

    const atr14Arr = computeATR14(c);

    for (let i = WINDOW - 1; i < c.length - HORIZON - 1; i++) {
      const bar = c[i];
      if (bar.ts < OOS_CUT) continue;

      const atr14Val = atr14Arr[i] || bar.c * 0.02;
      const atrPct   = atr14Val / bar.c * 100;
      const bkt      = atrBucket(atrPct);
      const w        = c.slice(i - WINDOW + 1, i + 1);
      const entry    = bar.c;
      const entryIdx = i + 1;
      if (entryIdx >= c.length - 1) continue;

      const t1  = entry * (1 + T1_M * atrPct / 100);
      const t2  = entry * (1 + T2_M * atrPct / 100);
      const t3  = entry * (1 + T3_M * atrPct / 100);
      const end = Math.min(c.length - 1, entryIdx + HORIZON);
      const horizonClose = c[end].c;

      // ── Forward pass: raw MAE/MFE + unconstrained T1/T2/T3 hit bars ────
      let rawMAE = 0, rawMFE = 0;
      let t1Bar = -1, t2Bar = -1, t3Bar = -1;
      for (let j = entryIdx; j <= end; j++) {
        const b = c[j];
        const adv = (entry - b.l) / entry * 100;
        const fav = (b.h - entry) / entry * 100;
        if (adv > rawMAE) rawMAE = adv;
        if (fav > rawMFE) rawMFE = fav;
        if (t1Bar < 0 && b.h >= t1) t1Bar = j - entryIdx;
        if (t2Bar < 0 && b.h >= t2) t2Bar = j - entryIdx;
        if (t3Bar < 0 && b.h >= t3) t3Bar = j - entryIdx;
      }

      for (const [arch, key] of ARCHETYPES) {
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r) continue;
        const stg = r.stage;
        if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;
        const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA'
                        : stg === 'STRONG_BUY'       ? 'STRONG' : 'BUY';

        const cell = acc[arch][stageName][bkt];
        cell.n++;
        cell.mae_all.push(rawMAE);
        cell.mfe_all.push(rawMFE);

        // ── Wide-stop winner: T1 reached before 12% stop ────────────────
        const widePx = entry * (1 - WIDE_STOP / 100);
        let wideSBar = -1;
        for (let j = entryIdx; j <= end; j++) {
          const jRel = j - entryIdx;
          const b = c[j];
          if (t1Bar >= 0 && jRel >= t1Bar) break;         // T1 first → exit loop
          if (b.o <= widePx || b.l <= widePx) { wideSBar = jRel; break; }
        }
        const isWinner = t1Bar >= 0 && (wideSBar < 0 || wideSBar >= t1Bar);
        if (isWinner) {
          // MAE from entry up to (and including) the bar T1 was hit
          let maeToT1 = 0;
          for (let j = entryIdx; j <= entryIdx + t1Bar; j++) {
            const adv = (entry - c[j].l) / entry * 100;
            if (adv > maeToT1) maeToT1 = adv;
          }
          cell.mae_winners.push(maeToT1);
        }

        // ── Per stop-level: outcome + cascade EV ────────────────────────
        for (const sl of STOP_LEVELS) {
          const stopPx = entry * (1 - sl / 100);

          // Phase 1: entry → T1 (or stop)
          let stopBar = -1;
          for (let j = entryIdx; j <= end; j++) {
            const jRel = j - entryIdx;
            const b = c[j];
            if (t1Bar >= 0 && jRel >= t1Bar) break;
            if (b.o <= stopPx || b.l <= stopPx) { stopBar = jRel; break; }
          }
          const stopHit    = stopBar >= 0 && (t1Bar < 0 || stopBar < t1Bar);
          const t1HitFirst = t1Bar >= 0 && !stopHit;
          const sd = cell.stopData[sl];
          let ev;

          if (stopHit) {
            sd.n_stop++;
            ev = -sl;
          } else if (t1HitFirst) {
            sd.n_hit++;
            ev = W1 * ((t1 - entry) / entry * 100);

            // Phase 2: T1 → T2 (or stop again)
            let s2 = -1;
            for (let j = entryIdx + t1Bar + 1; j <= end; j++) {
              const jRel = j - entryIdx;
              const b = c[j];
              if (t2Bar >= 0 && jRel >= t2Bar) break;
              if (b.o <= stopPx || b.l <= stopPx) { s2 = jRel; break; }
            }
            const stop2 = s2 >= 0 && (t2Bar < 0 || s2 < t2Bar);

            if (stop2) {
              ev += (W2 + W3) * (-sl);
            } else if (t2Bar >= 0) {
              ev += W2 * ((t2 - entry) / entry * 100);

              // Phase 3: T2 → T3 (or stop again)
              let s3 = -1;
              for (let j = entryIdx + t2Bar + 1; j <= end; j++) {
                const jRel = j - entryIdx;
                const b = c[j];
                if (t3Bar >= 0 && jRel >= t3Bar) break;
                if (b.o <= stopPx || b.l <= stopPx) { s3 = jRel; break; }
              }
              const stop3 = s3 >= 0 && (t3Bar < 0 || s3 < t3Bar);
              if (stop3)           ev += W3 * (-sl);
              else if (t3Bar >= 0) ev += W3 * ((t3 - entry) / entry * 100);
              else                 ev += W3 * ((horizonClose - entry) / entry * 100);
            } else {
              ev += (W2 + W3) * ((horizonClose - entry) / entry * 100);
            }
          } else {
            sd.n_timeout++;
            ev = (horizonClose - entry) / entry * 100;
          }

          sd.sumEV += ev;
        } // stop levels
      } // archetypes
    } // bars

    processed++;
    if (processed % 20 === 0) parentPort.postMessage({ type: 'progress', n: processed });
  }

  parentPort.postMessage({ type: 'done', acc });
  return;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN THREAD
// ════════════════════════════════════════════════════════════════════════════
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.toLowerCase().endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

if (!files.length) { console.error('No CSV files in', DATA_DIR); process.exit(1); }

console.log(`\nMAE Study  |  ${files.length} files  |  ${N_WORKERS} workers  |  OOS ≥ 2025-05-05`);
console.log(`Stop levels: ${STOP_LEVELS.join(', ')}%   |  Wide reference stop: ${WIDE_STOP}%\n`);
const t0 = Date.now();

const chunks = Array.from({ length: N_WORKERS }, () => []);
files.forEach((f, i) => chunks[i % N_WORKERS].push(f));

const acc = newAcc();
let lastProgress = 0;

const workers = chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      lastProgress = msg.n;
      process.stdout.write(`\r  Processed: ~${lastProgress} files…`);
    } else if (msg.type === 'done') {
      mergeAcc(acc, msg.acc);
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
}));

Promise.all(workers).then(() => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  Completed in ${elapsed}s\n`);
  printSummary(acc);
}).catch(err => { console.error(err); process.exit(1); });

// ── Print summary ────────────────────────────────────────────────────────────
function fmt(v, d = 1) { return v === null || v === undefined ? ' N/A' : (+v).toFixed(d); }

function printSummary(acc) {
  const SEP  = '─'.repeat(72);
  const json = { generated: new Date().toISOString(), cells: {} };

  // ── Grand summary: total signal counts ──────────────────────────────────
  console.log('SIGNAL COUNTS BY ARCHETYPE × STAGE × BUCKET (OOS)\n');
  console.log('Archetype        Stage   TIGHT  NORMAL  VOLATILE  HIGH   TOTAL');
  console.log('─'.repeat(65));
  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      const row = BUCKETS.map(bkt => acc[arch][stage][bkt].n);
      const total = row.reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      const pad = s => String(s).padStart(7);
      console.log(`${arch.padEnd(16)} ${stage.padEnd(6)}  ${row.map(pad).join('')}  ${String(total).padStart(6)}`);
    }
  }
  console.log('');

  // ── Detailed MAE tables ──────────────────────────────────────────────────
  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      for (const bkt of BUCKETS) {
        const cell = acc[arch][stage][bkt];
        if (cell.n < 10) continue;

        const { n, mae_all, mfe_all, mae_winners, stopData } = cell;
        const nWin   = mae_winners.length;
        const winPct = (nWin / n * 100).toFixed(0);

        // Percentiles
        const maeP = [25, 50, 75, 90, 95].map(p => pct(mae_all, p).toFixed(1));
        const mfeP = [50, 75, 90].map(p => pct(mfe_all, p).toFixed(1));
        const winP = nWin >= 5
          ? [50, 75, 90, 95].map(p => pct(mae_winners, p).toFixed(1))
          : null;

        // Survival rates: % of wide-stop winners with MAE-to-T1 < stopLevel
        const survival = STOP_LEVELS.map(sl => {
          if (nWin < 5) return 'N/A';
          const survived = mae_winners.filter(m => m < sl).length;
          return (survived / nWin * 100).toFixed(0) + '%';
        });

        // EV curve + peak
        let evPeakSL = 0, evPeakVal = -Infinity;
        const evCurve = STOP_LEVELS.map(sl => {
          const sd = stopData[sl];
          const tot = sd.n_hit + sd.n_stop + sd.n_timeout;
          const avg = tot > 0 ? sd.sumEV / tot : 0;
          if (avg > evPeakVal) { evPeakVal = avg; evPeakSL = sl; }
          return avg.toFixed(2);
        });

        // T1 win rate at each stop
        const winRateCurve = STOP_LEVELS.map(sl => {
          const sd = stopData[sl];
          const tot = sd.n_hit + sd.n_stop + sd.n_timeout;
          return tot > 0 ? (sd.n_hit / tot * 100).toFixed(0) + '%' : 'N/A';
        });

        const safeStop = winP ? winP[2] : null; // p90 of winner MAE

        console.log(SEP);
        console.log(`${arch} / ${stage} / ${bkt}   (n=${n}  winners=${nWin}/${n} = ${winPct}%)`);
        console.log('');
        console.log(`  RAW MAE (all, 20-bar worst drawdown):`);
        console.log(`    p25=${maeP[0]}%  p50=${maeP[1]}%  p75=${maeP[2]}%  p90=${maeP[3]}%  p95=${maeP[4]}%`);
        console.log(`  RAW MFE (all, 20-bar best gain):      p50=${mfeP[0]}%  p75=${mfeP[1]}%  p90=${mfeP[2]}%`);
        console.log('');

        if (winP) {
          console.log(`  WINNER MAE (entry→T1 adverse movement):`);
          console.log(`    p50=${winP[0]}%  p75=${winP[1]}%  p90=${winP[2]}%  p95=${winP[3]}%`);
          console.log(`    → 90% of winners needed < ${winP[2]}% room  ← p90-SAFE STOP`);
          console.log('');
          console.log(`  STOP SURVIVAL (% of ${nWin} winners NOT prematurely stopped):`);
          console.log(`    ${STOP_LEVELS.map((sl, i) => `${sl}%→${survival[i]}`).join('  ')}`);
          console.log('');
        } else {
          console.log(`  WINNER MAE: too few winners (${nWin}) for reliable percentiles\n`);
        }

        console.log(`  T1 WIN RATE by stop level:`);
        console.log(`    ${STOP_LEVELS.map((sl, i) => `${sl}%→${winRateCurve[i]}`).join('  ')}`);
        console.log('');
        console.log(`  CASCADE EV by stop level (50%@T1 + 30%@T2 + 20%@T3):`);
        console.log(`    ${STOP_LEVELS.map((sl, i) => `${sl}%→${evCurve[i]}%`).join('  ')}`);
        console.log(`    ★ EV PEAK at ${evPeakSL}% (${evPeakVal.toFixed(2)}%)  |  p90-safe stop: ${safeStop ?? 'N/A'}%`);
        console.log('');

        // JSON accumulation
        json.cells[`${arch}/${stage}/${bkt}`] = {
          n, nWin,
          mae_all_pct: { p25: maeP[0], p50: maeP[1], p75: maeP[2], p90: maeP[3], p95: maeP[4] },
          mfe_all_pct: { p50: mfeP[0], p75: mfeP[1], p90: mfeP[2] },
          mae_winner_pct: winP ? { p50: winP[0], p75: winP[1], p90: winP[2], p95: winP[3] } : null,
          stop_survival:  Object.fromEntries(STOP_LEVELS.map((sl, i) => [sl, survival[i]])),
          ev_curve:       Object.fromEntries(STOP_LEVELS.map((sl, i) => [sl, evCurve[i]])),
          win_rate_curve: Object.fromEntries(STOP_LEVELS.map((sl, i) => [sl, winRateCurve[i]])),
          ev_peak_sl: evPeakSL,
          p90_safe_stop: safeStop,
        };
      }
    }
  }
  console.log(SEP);

  // ── Cross-archetype summary ─────────────────────────────────────────────
  console.log('\nCROSS-ARCHETYPE SUMMARY — EV PEAK vs p90-SAFE STOP\n');
  console.log('Key                                   n   Win%  EV-peak stop  p90-safe stop');
  console.log('─'.repeat(72));
  for (const [key, d] of Object.entries(json.cells)) {
    const winPct = d.n > 0 ? (d.nWin / d.n * 100).toFixed(0) + '%' : ' N/A';
    const row = `${key.padEnd(36)} ${String(d.n).padStart(5)}  ${winPct.padStart(4)}      ${String(d.ev_peak_sl+'%').padStart(8)}       ${d.p90_safe_stop ? d.p90_safe_stop+'%' : 'N/A'}`;
    console.log(row);
  }

  // ── Save JSON ────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(OUT_DIR, `mae_study_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`\nResults saved → ${outPath}`);
}
