'use strict';
/**
 * SL Bucket Backtest — ATR-Tiered Stop Loss Sweet Spot
 * =====================================================
 * Finds the optimal (ATR multiplier × cap%) per ATR-volatility bucket.
 *
 * Grid:
 *   mult  : 2.0 → 5.0, step 0.5  (7 values)
 *   cap % : 5, 6, 7, 8, 9, 10    (6 values)
 *   floor %: 2.0, 2.5, 3.0, 3.5  (4 values)
 *   = 168 combos per (archetype × stage × ATR bucket)
 *
 * ATR buckets (atrPct = ATR14/close × 100):
 *   TIGHT   : atrPct < 1.5%
 *   NORMAL  : 1.5 ≤ atrPct < 2.5%
 *   VOLATILE: 2.5 ≤ atrPct < 3.5%
 *   HIGH    : atrPct ≥ 3.5%
 *
 * For each signal bar found by the compiled engine:
 *   - Simulate 20-bar forward cascade: 50% exit @ T1, 30% @ T2, 20% @ T3
 *   - T1 = entry × (1 + 1.5×atrPct/100)
 *   - T2 = entry × (1 + 2.5×atrPct/100)
 *   - T3 = entry × (1 + 5.0×atrPct/100)
 *   - Stop = clamp(entry − mult×ATR14, floor%, cap%)
 *   - EV = cascade-weighted P&L (stop=full loss, T3=full gain on remainder)
 *   - MAE50/75 = median and 75th-pctile max adverse excursion (independent of stop)
 *
 * OOS split: 2025-05-05 (same as CB backtest)
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os   = require('os');

const DATA_DIR   = process.env.DATA_DIR  || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const OUT_DIR    = path.join(__dirname, 'results');
const OOS_CUT    = new Date('2025-05-05T00:00:00Z').getTime() / 1000;
const HORIZON    = 20;
const WINDOW     = 300;
const MIN_BARS   = WINDOW + HORIZON + 5;

const ARCHETYPES = [
  ['VolumeFootprint',  'optimized_deployable_20plus'],
  ['CompressionCoil',  'optimized_highprecision_15plus'],
  ['MomentumPocket',   'optimized_elite_10plus'],
  ['EMAStack',         'optimized_ultraselective_8plus'],
  ['PerfectStorm',     'sniper_95plus'],
  ['ORS',              'ors_prime_reversal'],
];

// Grid
const MULTS  = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
const CAPS   = [5, 6, 7, 8, 9, 10];
const FLOORS = [2.0, 2.5, 3.0, 3.5];
const N_COMBO = MULTS.length * CAPS.length * FLOORS.length; // 168

// Targets (fixed — we are only optimising the stop, not the targets)
const T1_MULT = 1.5;
const T2_MULT = 2.5;
const T3_MULT = 5.0;
// Exit sizing
const W1 = 0.50, W2 = 0.30, W3 = 0.20;

// ATR bucket labels
function atrBucket(atrPct) {
  if (atrPct < 1.5) return 'TIGHT';
  if (atrPct < 2.5) return 'NORMAL';
  if (atrPct < 3.5) return 'VOLATILE';
  return 'HIGH';
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── CSV parser ────────────────────────────────────────────────────────────────
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

// ── ATR14 ─────────────────────────────────────────────────────────────────────
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

// ── Cascade simulation for one signal, all combos at once ────────────────────
function simulateCascade(c, entryIdx, entry, atr14Val, atrPct) {
  const t1 = entry * (1 + T1_MULT * atrPct / 100);
  const t2 = entry * (1 + T2_MULT * atrPct / 100);
  const t3 = entry * (1 + T3_MULT * atrPct / 100);

  // Forward pass: record first T1/T2/T3 hit bar and MAE
  let t1Bar = -1, t2Bar = -1, t3Bar = -1;
  let mae = 0; // running max adverse excursion
  const maeArr = [];
  const end = Math.min(c.length - 1, entryIdx + HORIZON);
  for (let j = entryIdx; j <= end; j++) {
    const bar = c[j];
    const curMae = Math.min(0, (bar.l - entry) / entry * 100); // negative = adverse
    if (curMae < mae) mae = curMae;
    maeArr.push(-mae); // store as positive %
    if (t1Bar < 0 && bar.h >= t1) t1Bar = j - entryIdx;
    if (t2Bar < 0 && bar.h >= t2) t2Bar = j - entryIdx;
    if (t3Bar < 0 && bar.h >= t3) t3Bar = j - entryIdx;
  }
  // MAE = array of 0..HORIZON max adverse excursion (positive means adverse)
  const maeAtEnd = maeArr[maeArr.length - 1] || 0;

  // Per combo: compute EV, stopPct, winRate
  const results = new Float32Array(N_COMBO * 3); // [ev, stopPct, hitT1] per combo
  let ci = 0;
  for (const mult of MULTS) {
    for (const capPct of CAPS) {
      for (const floorPct of FLOORS) {
        const rawStop = entry - mult * atr14Val;
        const floorStop = entry * (1 - floorPct / 100);
        const capStop   = entry * (1 - capPct / 100);
        // clamp: stop = max(capStop, min(floorStop, rawStop))
        const stop = Math.max(capStop, Math.min(floorStop, rawStop));
        const stopPct = (entry - stop) / entry * 100;

        // Simulate cascade day by day
        let ev = 0;
        let hitT1 = 0;
        // Check if stop hit before T1
        let stopBar = -1;
        for (let j = entryIdx; j <= end; j++) {
          const bar = c[j];
          if (bar.o <= stop) { stopBar = j - entryIdx; break; }  // gap open below stop
          if (bar.l <= stop) { stopBar = j - entryIdx; break; }  // wick through stop
          if (t1Bar >= 0 && (j - entryIdx) >= t1Bar) break; // T1 hit first
        }

        const stopHit = stopBar >= 0 && (t1Bar < 0 || stopBar < t1Bar);
        const t1HitFirst = t1Bar >= 0 && !stopHit;

        if (stopHit) {
          ev = -stopPct;
          hitT1 = 0;
        } else if (t1HitFirst) {
          hitT1 = 1;
          const t1Gain = (t1 - entry) / entry * 100;
          // W1 (50%) exits at T1
          ev += W1 * t1Gain;
          // Check if stop hit between T1 and T2 (for remaining W2+W3)
          let stopAfterT1 = -1;
          for (let j = entryIdx + t1Bar + 1; j <= end; j++) {
            const bar = c[j];
            if (bar.o <= stop || bar.l <= stop) { stopAfterT1 = j - entryIdx; break; }
            if (t2Bar >= 0 && (j - entryIdx) >= t2Bar) break;
          }
          const stopBetweenT1T2 = stopAfterT1 >= 0 && (t2Bar < 0 || stopAfterT1 < t2Bar);
          if (stopBetweenT1T2) {
            ev += (W2 + W3) * (-stopPct); // remaining position stopped out
          } else if (t2Bar >= 0) {
            const t2Gain = (t2 - entry) / entry * 100;
            ev += W2 * t2Gain;
            // Check stop between T2 and T3
            let stopAfterT2 = -1;
            for (let j = entryIdx + t2Bar + 1; j <= end; j++) {
              const bar = c[j];
              if (bar.o <= stop || bar.l <= stop) { stopAfterT2 = j - entryIdx; break; }
              if (t3Bar >= 0 && (j - entryIdx) >= t3Bar) break;
            }
            const stopBetweenT2T3 = stopAfterT2 >= 0 && (t3Bar < 0 || stopAfterT2 < t3Bar);
            if (stopBetweenT2T3) {
              ev += W3 * (-stopPct);
            } else if (t3Bar >= 0) {
              const t3Gain = (t3 - entry) / entry * 100;
              ev += W3 * t3Gain;
            } else {
              // horizon exit on W3
              const exitPrice = c[Math.min(end, c.length-1)].c;
              ev += W3 * ((exitPrice - entry) / entry * 100);
            }
          } else {
            // No T2 hit — remaining (W2+W3) exits at horizon
            const exitPrice = c[Math.min(end, c.length-1)].c;
            ev += (W2 + W3) * ((exitPrice - entry) / entry * 100);
          }
        } else {
          // Horizon exit (neither T1 nor stop)
          const exitPrice = c[Math.min(end, c.length-1)].c;
          ev = ((exitPrice - entry) / entry * 100);
        }

        results[ci * 3]     = ev;
        results[ci * 3 + 1] = stopPct;
        results[ci * 3 + 2] = hitT1;
        ci++;
      }
    }
  }
  return { results, maeAtEnd, t1Hit: t1Bar >= 0, t2Hit: t2Bar >= 0, t3Hit: t3Bar >= 0 };
}

// ── Worker ────────────────────────────────────────────────────────────────────
function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  // Clear tuning overrides for clean baselines
  for (const [, key] of ARCHETYPES) {
    try { engine.setArchetypeTuning(key, null); } catch {}
  }

  // Accumulator: [archetype][stage][atrBucket][comboIdx] → { sumEV, sumStopPct, n, nT1, maeArr }
  const acc = {};
  for (const [arch] of ARCHETYPES) {
    acc[arch] = {};
    for (const stage of ['BUY', 'STRONG', 'ULTRA']) {
      acc[arch][stage] = {};
      for (const bkt of ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH']) {
        const cells = [];
        for (let ci = 0; ci < N_COMBO; ci++) cells.push({ sumEV: 0, sumStopPct: 0, n: 0, nT1: 0, maeArr: [] });
        acc[arch][stage][bkt] = cells;
      }
    }
  }

  let processed = 0;
  for (const fp of workerData.files) {
    let c;
    try { c = parseCSV(fp); } catch { processed++; continue; }
    processed++;
    if (c.length < MIN_BARS) continue;

    const atr14Arr = computeATR14(c);
    const name = path.basename(fp, '.csv').replace(/_OHLCV$/i, '');

    for (let i = WINDOW - 1; i < c.length - HORIZON - 1; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);
      const bar = c[i];
      const atr14Val = atr14Arr[i] || bar.c * 0.02;
      const atrPct   = atr14Val / bar.c * 100;
      const bkt      = atrBucket(atrPct);
      const isOOS    = bar.ts >= OOS_CUT;

      for (const [arch, key] of ARCHETYPES) {
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r) continue;
        const stg = r.stage;
        if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;
        const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA' : stg === 'STRONG_BUY' ? 'STRONG' : 'BUY';

        const entry = bar.c; // enter at signal bar close (next open approximation)
        const entryIdx = i + 1;
        if (entryIdx >= c.length - 1) continue;

        const { results, maeAtEnd } = simulateCascade(c, entryIdx, entry, atr14Val, atrPct);

        const cells = acc[arch][stageName][bkt];
        // Only use OOS signals for the final recommendation, track both
        if (isOOS) {
          for (let ci = 0; ci < N_COMBO; ci++) {
            cells[ci].sumEV      += results[ci * 3];
            cells[ci].sumStopPct += results[ci * 3 + 1];
            cells[ci].nT1        += results[ci * 3 + 2];
            cells[ci].n++;
            cells[ci].maeArr.push(maeAtEnd);
          }
        }
      }
    }

    if (processed % 20 === 0) parentPort.postMessage({ type: 'progress', n: 20 });
  }

  parentPort.postMessage({ type: 'done', acc });
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!isMainThread) { runWorker(); process.exit(0); }

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

if (files.length === 0) { console.error('No CSV files found in', DATA_DIR); process.exit(1); }
console.log(`SL Bucket Backtest — ${files.length} files · ${N_COMBO} combos · ${ARCHETYPES.length} archetypes`);
console.log(`OOS period: 2025-05-05 → present`);

const N_WORKERS = Math.min(os.cpus().length - 1 || 1, 6);
const chunkSize = Math.ceil(files.length / N_WORKERS);
const chunks = [];
for (let i = 0; i < files.length; i += chunkSize) chunks.push(files.slice(i, i + chunkSize));

// Master accumulator
const masterAcc = {};
for (const [arch] of ARCHETYPES) {
  masterAcc[arch] = {};
  for (const stage of ['BUY', 'STRONG', 'ULTRA']) {
    masterAcc[arch][stage] = {};
    for (const bkt of ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH']) {
      const cells = [];
      for (let ci = 0; ci < N_COMBO; ci++) cells.push({ sumEV: 0, sumStopPct: 0, n: 0, nT1: 0, maeArr: [] });
      masterAcc[arch][stage][bkt] = cells;
    }
  }
}

let done = 0, totalProg = 0;
const t0 = Date.now();

function mergeAcc(src) {
  for (const arch of Object.keys(src)) {
    for (const stage of Object.keys(src[arch])) {
      for (const bkt of Object.keys(src[arch][stage])) {
        const srcCells = src[arch][stage][bkt];
        const dstCells = masterAcc[arch][stage][bkt];
        for (let ci = 0; ci < N_COMBO; ci++) {
          dstCells[ci].sumEV      += srcCells[ci].sumEV;
          dstCells[ci].sumStopPct += srcCells[ci].sumStopPct;
          dstCells[ci].n          += srcCells[ci].n;
          dstCells[ci].nT1        += srcCells[ci].nT1;
          dstCells[ci].maeArr.push(...srcCells[ci].maeArr);
        }
      }
    }
  }
}

function buildResults() {
  const out = {};
  for (const [arch] of ARCHETYPES) {
    out[arch] = {};
    for (const stage of ['BUY', 'STRONG', 'ULTRA']) {
      out[arch][stage] = {};
      for (const bkt of ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH']) {
        const cells = masterAcc[arch][stage][bkt];
        // Find best combo by EV, separately for:
        //   A) unconstrained best
        //   B) best with avgStopPct ≤ 7%
        //   C) best with avgStopPct ≤ 8%
        let bestEV = { ev: -999, combo: null, stopPct: 0, wr: 0 };
        let best7 = { ev: -999, combo: null, stopPct: 0, wr: 0 };
        let best8 = { ev: -999, combo: null, stopPct: 0, wr: 0 };

        // Also build full grid for reporting
        const grid = [];
        let ci = 0;
        for (const mult of MULTS) {
          for (const capPct of CAPS) {
            for (const floorPct of FLOORS) {
              const cell = cells[ci];
              if (cell.n >= 10) {
                const ev = cell.sumEV / cell.n;
                const avgStop = cell.sumStopPct / cell.n;
                const wr = cell.nT1 / cell.n * 100;
                const maeArr = cell.maeArr.slice().sort((a, b) => a - b);
                const mae50 = maeArr[Math.floor(maeArr.length * 0.5)] || 0;
                const mae75 = maeArr[Math.floor(maeArr.length * 0.75)] || 0;
                grid.push({ mult, capPct, floorPct, ev, avgStop, wr, n: cell.n, mae50, mae75 });
                if (ev > bestEV.ev) bestEV = { ev, combo: { mult, capPct, floorPct }, stopPct: avgStop, wr };
                if (avgStop <= 7.0 && ev > best7.ev) best7 = { ev, combo: { mult, capPct, floorPct }, stopPct: avgStop, wr };
                if (avgStop <= 8.0 && ev > best8.ev) best8 = { ev, combo: { mult, capPct, floorPct }, stopPct: avgStop, wr };
              }
              ci++;
            }
          }
        }

        // Current config: mult=4.0, cap=10%, floor=3.5%
        const currIdx = MULTS.indexOf(4.0) * CAPS.length * FLOORS.length +
                        CAPS.indexOf(10) * FLOORS.length + FLOORS.indexOf(3.5);
        const currCell = cells[currIdx] || { n: 0, sumEV: 0, sumStopPct: 0, nT1: 0 };
        const currEV  = currCell.n > 0 ? currCell.sumEV / currCell.n : 0;
        const currStop = currCell.n > 0 ? currCell.sumStopPct / currCell.n : 0;
        const currWR  = currCell.n > 0 ? currCell.nT1 / currCell.n * 100 : 0;

        out[arch][stage][bkt] = {
          n: currCell.n,
          current: { ev: currEV, stopPct: currStop, wr: currWR, combo: { mult: 4.0, capPct: 10, floorPct: 3.5 } },
          bestEV,
          best7pct: best7.combo ? best7 : null,
          best8pct: best8.combo ? best8 : null,
          // Top 5 combos by EV for this bucket
          top5: grid.sort((a, b) => b.ev - a.ev).slice(0, 5),
        };
      }
    }
  }
  return out;
}

function printSummary(results) {
  console.log('\n' + '═'.repeat(100));
  console.log('SL BUCKET BACKTEST — RESULTS SUMMARY (OOS: 2025-05-05 → present)');
  console.log('═'.repeat(100));

  // Aggregate cross-archetype recommendation
  console.log('\n📊 RECOMMENDATION TABLE: Best ATR-tiered stops (constrained ≤ 8% & unconstrained)');
  console.log('─'.repeat(100));

  const bkts = ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH'];
  const stages = ['ULTRA', 'STRONG', 'BUY'];

  for (const bkt of bkts) {
    for (const stage of stages) {
      const evs = [], stops = [], best8s = [], evGains = [];
      let totalN = 0;
      for (const [arch] of ARCHETYPES) {
        const r = results[arch][stage][bkt];
        if (r.n < 10) continue;
        evs.push(r.current.ev);
        stops.push(r.current.stopPct);
        if (r.best8pct) { best8s.push(r.best8pct); evGains.push(r.best8pct.ev - r.current.ev); }
        totalN += r.n;
      }
      if (evs.length === 0) continue;
      const avgCurrEV   = evs.reduce((s,v) => s+v, 0) / evs.length;
      const avgCurrStop = stops.reduce((s,v) => s+v, 0) / stops.length;
      const avgGain     = evGains.length ? evGains.reduce((s,v) => s+v, 0) / evGains.length : 0;
      const best8Repr   = best8s.length ? best8s.sort((a,b) => b.ev - a.ev)[0] : null;
      console.log(`  ${bkt.padEnd(8)} | ${stage.padEnd(6)} | n=${String(totalN).padStart(4)} | curr: SL${avgCurrStop.toFixed(1)}% EV${avgCurrEV.toFixed(2)}% | best≤8%: ${best8Repr ? `mult=${best8Repr.combo.mult} cap=${best8Repr.combo.capPct}% EV${best8Repr.ev.toFixed(2)}% SL${best8Repr.stopPct.toFixed(1)}% Δ${avgGain >= 0 ? '+' : ''}${avgGain.toFixed(2)}%` : 'n/a'}`);
    }
    console.log('');
  }

  // Per-archetype detail
  for (const [arch] of ARCHETYPES) {
    console.log(`\n──── ${arch} ────`);
    for (const stage of stages) {
      for (const bkt of bkts) {
        const r = results[arch][stage][bkt];
        if (r.n < 15) continue;
        const t5 = r.top5[0];
        console.log(`  ${stage.padEnd(6)} ${bkt.padEnd(8)} n=${String(r.n).padStart(4)} | CURR: SL${r.current.stopPct.toFixed(1)}% EV${r.current.ev.toFixed(2)}% WR${r.current.wr.toFixed(0)}% | BEST_UNCAP: mult=${r.bestEV.combo?.mult} cap=${r.bestEV.combo?.capPct}% SL${r.bestEV.stopPct.toFixed(1)}% EV${r.bestEV.ev.toFixed(2)}% | BEST≤8%: ${r.best8pct ? `mult=${r.best8pct.combo.mult} cap=${r.best8pct.combo.capPct}% SL${r.best8pct.stopPct.toFixed(1)}% EV${r.best8pct.ev.toFixed(2)}% WR${r.best8pct.wr.toFixed(0)}% Δ${(r.best8pct.ev - r.current.ev) >= 0 ? '+' : ''}${(r.best8pct.ev - r.current.ev).toFixed(2)}%` : 'insufficient data'}`);
      }
    }
  }
}

// Run workers
const workers = chunks.map((files, wi) => new Worker(__filename, { workerData: { files } }));
workers.forEach((w, wi) => {
  w.on('message', msg => {
    if (msg.type === 'progress') { totalProg += msg.n; process.stdout.write(`\r  ${totalProg}/${files.length} files...`); }
    if (msg.type === 'done') {
      mergeAcc(msg.acc);
      done++;
      if (done === chunks.length) {
        console.log(`\n✓ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        const results = buildResults();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outPath = path.join(OUT_DIR, `sl_bucket_${ts}.json`);
        fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), grid: { MULTS, CAPS, FLOORS }, results }, null, 2));
        console.log(`Results → ${outPath}`);
        printSummary(results);
      }
    }
  });
  w.on('error', e => console.error(`Worker ${wi} error:`, e));
});
