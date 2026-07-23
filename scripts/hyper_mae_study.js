'use strict';
/**
 * hyper_mae_study.js — Walk-Forward MAE Study with Bootstrap CI
 * ==============================================================
 * Three non-overlapping OOS windows + 500-sample bootstrap confidence intervals
 * give stop-level recommendations that hold across market regimes.
 *
 * STOP LEVELS : 2.0% → 14.0% in 0.5% steps  (25 levels)
 * OOS WINDOWS :
 *   W1: 2024-01-01 → 2024-07-01  (pre-election consolidation)
 *   W2: 2024-07-01 → 2025-01-01  (election rally + budget correction)
 *   W3: 2025-01-01 → 2026-01-01  (recent period, includes current OOS)
 * BOOTSTRAP   : 500 resamples → 90% CI on per-cell mean EV (combined pool)
 *
 * A stop is "hyper-optimal" if:
 *   • Mean EV > 0 in ≥2 of 3 windows        (walk-forward robust)
 *   • Bootstrap CI lower bound (p5) > 0      (statistically positive)
 *   • Is the tightest such stop              (minimises loss when wrong)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS  = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR    = path.join(__dirname, 'results');
const HORIZON    = 20;
const WINDOW     = 300;
const MIN_BARS   = WINDOW + HORIZON + 5;
const WIDE_STOP  = 14;    // wide reference stop — defines "true winners"
const N_WORKERS  = Math.min(os.cpus().length, 8);
const N_BOOT     = 500;   // bootstrap resamples

// 25 stop levels: 2.0, 2.5, 3.0 … 14.0
const STOP_LEVELS = [];
for (let sl = 2.0; sl <= 14.01; sl += 0.5) STOP_LEVELS.push(+sl.toFixed(1));

// Three non-overlapping OOS windows
const OOS_WINDOWS = [
  { name: 'W1 2024-H1', from: '2024-01-01', to: '2024-07-01' },
  { name: 'W2 2024-H2', from: '2024-07-01', to: '2025-01-01' },
  { name: 'W3 2025+',   from: '2025-01-01', to: '2026-01-01' },
];
const W_FROM = OOS_WINDOWS.map(w => new Date(w.from + 'T00:00:00Z').getTime() / 1000);
const W_TO   = OOS_WINDOWS.map(w => new Date(w.to   + 'T00:00:00Z').getTime() / 1000);
const NW     = OOS_WINDOWS.length;

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

const T1_M = 1.5, T2_M = 2.5, T3_M = 5.0;
const W1c = 0.50, W2c = 0.30, W3c = 0.20;  // cascade exit weights

function atrBucket(p) {
  if (p < 1.5) return 'TIGHT';
  if (p < 2.5) return 'NORMAL';
  if (p < 3.5) return 'VOLATILE';
  return 'HIGH';
}

// ── CSV parser ───────────────────────────────────────────────────────────────
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

// ── ATR14 ────────────────────────────────────────────────────────────────────
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
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ── Bootstrap: 90% CI on mean EV ─────────────────────────────────────────────
function bootstrap(evs) {
  const n = evs.length;
  if (n < 5) return null;
  const means = new Float64Array(N_BOOT);
  for (let r = 0; r < N_BOOT; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += evs[Math.floor(Math.random() * n)];
    means[r] = sum / n;
  }
  means.sort();
  return {
    mean: evs.reduce((a, b) => a + b, 0) / n,
    p5:  means[Math.floor(0.05 * N_BOOT)],
    p95: means[Math.floor(0.95 * N_BOOT)],
  };
}

// ── Accumulator ──────────────────────────────────────────────────────────────
function newAcc() {
  const acc = {};
  for (const [arch] of ARCHETYPES) {
    acc[arch] = {};
    for (const stage of STAGES) {
      acc[arch][stage] = {};
      for (const bkt of BUCKETS) {
        // Per-window aggregates (for walk-forward EV curve)
        const wins = Array.from({ length: NW }, () => {
          const sd = {};
          for (const sl of STOP_LEVELS) sd[sl] = { n: 0, sumEV: 0, n_hit: 0 };
          return { n: 0, sd };
        });
        // Combined pool (for bootstrap CI and MAE distributions)
        const csd = {};
        for (const sl of STOP_LEVELS) csd[sl] = { evs: [] };
        acc[arch][stage][bkt] = {
          wins,
          combined: { n: 0, mae_all: [], mae_winners: [], sd: csd },
        };
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
        for (let wi = 0; wi < NW; wi++) {
          d.wins[wi].n += s.wins[wi].n;
          for (const sl of STOP_LEVELS) {
            d.wins[wi].sd[sl].n    += s.wins[wi].sd[sl].n;
            d.wins[wi].sd[sl].sumEV += s.wins[wi].sd[sl].sumEV;
            d.wins[wi].sd[sl].n_hit += s.wins[wi].sd[sl].n_hit;
          }
        }
        d.combined.n += s.combined.n;
        for (const v of s.combined.mae_all)     d.combined.mae_all.push(v);
        for (const v of s.combined.mae_winners) d.combined.mae_winners.push(v);
        for (const sl of STOP_LEVELS)
          for (const v of s.combined.sd[sl].evs) d.combined.sd[sl].evs.push(v);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKER
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const engine = require(ENGINE_JS);
  for (const [, key] of ARCHETYPES) { try { engine.setArchetypeTuning(key, null); } catch {} }

  const acc = newAcc();
  let processed = 0;

  for (const fp of workerData.files) {
    let c;
    try { c = parseCSV(fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }

    const atr14Arr = computeATR14(c);

    for (let i = WINDOW - 1; i < c.length - HORIZON - 1; i++) {
      const bar = c[i];
      const ts  = bar.ts;

      // Which window does this signal bar fall in?
      let winIdx = -1;
      for (let wi = 0; wi < NW; wi++) {
        if (ts >= W_FROM[wi] && ts < W_TO[wi]) { winIdx = wi; break; }
      }
      if (winIdx < 0) continue;

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

      // ── Forward pass: raw MAE/MFE + target hit bars ──────────────────────
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
        const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA' : stg === 'STRONG_BUY' ? 'STRONG' : 'BUY';

        const cell = acc[arch][stageName][bkt];
        cell.wins[winIdx].n++;
        cell.combined.n++;
        cell.combined.mae_all.push(rawMAE);

        // Wide-stop winner: T1 before WIDE_STOP% stop
        const widePx = entry * (1 - WIDE_STOP / 100);
        let wideSBar = -1;
        for (let j = entryIdx; j <= end; j++) {
          const jRel = j - entryIdx;
          const b = c[j];
          if (t1Bar >= 0 && jRel >= t1Bar) break;
          if (b.o <= widePx || b.l <= widePx) { wideSBar = jRel; break; }
        }
        const isWinner = t1Bar >= 0 && (wideSBar < 0 || wideSBar >= t1Bar);
        if (isWinner) {
          let maeToT1 = 0;
          for (let j = entryIdx; j <= entryIdx + t1Bar; j++) {
            const adv = (entry - c[j].l) / entry * 100;
            if (adv > maeToT1) maeToT1 = adv;
          }
          cell.combined.mae_winners.push(maeToT1);
        }

        // ── Per stop-level: cascade EV ──────────────────────────────────────
        for (const sl of STOP_LEVELS) {
          const stopPx = entry * (1 - sl / 100);

          // Phase 1: entry → T1 or stop
          let stopBar = -1;
          for (let j = entryIdx; j <= end; j++) {
            const jRel = j - entryIdx;
            const b = c[j];
            if (t1Bar >= 0 && jRel >= t1Bar) break;
            if (b.o <= stopPx || b.l <= stopPx) { stopBar = jRel; break; }
          }
          const stopHit    = stopBar >= 0 && (t1Bar < 0 || stopBar < t1Bar);
          const t1HitFirst = t1Bar >= 0 && !stopHit;
          let ev;

          if (stopHit) {
            ev = -sl;
          } else if (t1HitFirst) {
            ev = W1c * ((t1 - entry) / entry * 100);
            // Phase 2: T1 → T2 or stop
            let s2 = -1;
            for (let j = entryIdx + t1Bar + 1; j <= end; j++) {
              const jRel = j - entryIdx;
              const b = c[j];
              if (t2Bar >= 0 && jRel >= t2Bar) break;
              if (b.o <= stopPx || b.l <= stopPx) { s2 = jRel; break; }
            }
            if (s2 >= 0 && (t2Bar < 0 || s2 < t2Bar)) {
              ev += (W2c + W3c) * (-sl);
            } else if (t2Bar >= 0) {
              ev += W2c * ((t2 - entry) / entry * 100);
              // Phase 3: T2 → T3 or stop
              let s3 = -1;
              for (let j = entryIdx + t2Bar + 1; j <= end; j++) {
                const jRel = j - entryIdx;
                const b = c[j];
                if (t3Bar >= 0 && jRel >= t3Bar) break;
                if (b.o <= stopPx || b.l <= stopPx) { s3 = jRel; break; }
              }
              if (s3 >= 0 && (t3Bar < 0 || s3 < t3Bar)) ev += W3c * (-sl);
              else if (t3Bar >= 0) ev += W3c * ((t3 - entry) / entry * 100);
              else                 ev += W3c * ((horizonClose - entry) / entry * 100);
            } else {
              ev += (W2c + W3c) * ((horizonClose - entry) / entry * 100);
            }
          } else {
            ev = (horizonClose - entry) / entry * 100;
          }

          // Accumulate
          cell.wins[winIdx].sd[sl].n++;
          cell.wins[winIdx].sd[sl].sumEV += ev;
          if (t1HitFirst) cell.wins[winIdx].sd[sl].n_hit++;
          cell.combined.sd[sl].evs.push(ev);
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
if (!files.length) { console.error('No CSV in', DATA_DIR); process.exit(1); }

console.log(`\nHyper MAE Study  |  ${files.length} files  |  ${N_WORKERS} workers`);
console.log(`Stop levels: ${STOP_LEVELS.length} (${STOP_LEVELS[0]}–${STOP_LEVELS[STOP_LEVELS.length-1]}%, 0.5% step)`);
console.log(`Windows: ${OOS_WINDOWS.map(w => w.name).join(' | ')}`);
console.log(`Bootstrap: ${N_BOOT} resamples → 90% CI\n`);
const t0 = Date.now();

const chunks = Array.from({ length: N_WORKERS }, () => []);
files.forEach((f, i) => chunks[i % N_WORKERS].push(f));
const acc = newAcc();

const workers = chunks.map(chunk => new Promise((res, rej) => {
  const wk = new Worker(__filename, { workerData: { files: chunk } });
  wk.on('message', msg => {
    if (msg.type === 'progress') process.stdout.write(`\r  Processed ~${msg.n}…`);
    else if (msg.type === 'done') { mergeAcc(acc, msg.acc); res(); }
  });
  wk.on('error', rej);
  wk.on('exit', code => { if (code !== 0) rej(new Error(`Worker exit ${code}`)); });
}));

Promise.all(workers).then(() => {
  console.log(`\n  Done in ${((Date.now()-t0)/1000).toFixed(1)}s\n`);
  printResults(acc);
}).catch(e => { console.error(e); process.exit(1); });

// ── Output ────────────────────────────────────────────────────────────────────
function f2(v) { return v == null ? '  N/A' : (v >= 0 ? ' +' : ' ') + v.toFixed(2) + '%'; }
function f1(v) { return v == null ? 'N/A' : v.toFixed(1) + '%'; }

function printResults(acc) {
  const SEP = '═'.repeat(78);
  const json = { generated: new Date().toISOString(), windows: OOS_WINDOWS.map(w => w.name), cells: {} };

  // ── Signal count table ────────────────────────────────────────────────────
  console.log('SIGNAL COUNTS PER WINDOW × ARCHETYPE × STAGE × BUCKET\n');
  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      const totals = BUCKETS.map(bkt => {
        const cell = acc[arch][stage][bkt];
        return cell.combined.n;
      });
      if (totals.every(t => t === 0)) continue;
      const wTotals = Array.from({ length: NW }, (_, wi) =>
        BUCKETS.reduce((s, bkt) => s + acc[arch][stage][bkt].wins[wi].n, 0)
      );
      console.log(`  ${arch}/${stage}  buckets=${totals.join('/')}  windows=${wTotals.join('/')} total=${totals.reduce((a,b)=>a+b,0)}`);
    }
  }
  console.log('');

  // ── Per cell: walk-forward + bootstrap ────────────────────────────────────
  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      for (const bkt of BUCKETS) {
        const cell = acc[arch][stage][bkt];
        if (cell.combined.n < 10) continue;

        const { combined, wins } = cell;
        const nWin  = combined.mae_winners.length;
        const p90w  = pct(combined.mae_winners, 90);
        const p75w  = pct(combined.mae_winners, 75);
        const p50w  = pct(combined.mae_winners, 50);

        // Bootstrap CI at each stop level (combined pool)
        const ci = {};
        for (const sl of STOP_LEVELS) {
          ci[sl] = bootstrap(combined.sd[sl].evs);
        }

        // Walk-forward: mean EV per window per stop level
        const wEV = {};
        for (const sl of STOP_LEVELS) {
          wEV[sl] = wins.map(wn => {
            const { n, sumEV } = wn.sd[sl];
            return n >= 5 ? sumEV / n : null;
          });
        }

        // Find hyper-optimal stop
        // Rule: ≥2/3 windows positive AND CI p5 > 0, choose the TIGHTEST such stop
        let hyperOptSL = null;
        let hyperOptCI = null;
        let maxEV_SL   = null;
        let maxEV_val  = -Infinity;

        for (const sl of STOP_LEVELS) {
          const c = ci[sl];
          if (!c) continue;
          const wPos = wEV[sl].filter(v => v != null && v > 0).length;
          const wCount = wEV[sl].filter(v => v != null).length;
          if (wPos >= 2 && wCount >= 2 && c.p5 > 0 && hyperOptSL === null) {
            hyperOptSL = sl;
            hyperOptCI = c;
          }
          if (c.mean > maxEV_val) { maxEV_val = c.mean; maxEV_SL = sl; }
        }

        // Print header
        console.log(SEP);
        const wCounts = wins.map((w, i) => `${OOS_WINDOWS[i].name.slice(0,7)}:${w.n}`).join('  ');
        console.log(`${arch} / ${stage} / ${bkt}   Combined n=${combined.n}  |  ${wCounts}`);
        console.log(`Winners: ${nWin}/${combined.n} (${(nWin/combined.n*100).toFixed(0)}%)  |  Winner MAE: p50=${f1(p50w)} p75=${f1(p75w)} p90=${f1(p90w)}`);
        console.log('');

        // Walk-forward EV table (show every stop level with ≥1 window having data)
        // But only show key stops to keep output manageable
        const showStops = STOP_LEVELS.filter((sl, idx) => {
          const hasData = wins.some(wn => wn.sd[sl].n >= 3);
          const isHyper = sl === hyperOptSL;
          const isPeak  = sl === maxEV_SL;
          const isP90   = p90w !== null && Math.abs(sl - p90w) < 0.4;
          // Show all stops where ANY window has EV > 0, plus key stops
          const anyPos = wEV[sl].some(v => v != null && v > 0);
          return hasData && (isHyper || isPeak || isP90 || anyPos);
        });

        // Header row
        const wHdr = OOS_WINDOWS.map(w => w.name.padStart(10)).join('');
        console.log(`  Stop  ${wHdr}   CI_low   Mean    CI_hi   Robust`);
        console.log('  ' + '─'.repeat(70));

        for (const sl of showStops) {
          const wVals = wEV[sl].map(v => v == null ? '       N/A' : (v >= 0 ? '     +' : '      ') + v.toFixed(2) + '%');
          const c     = ci[sl];
          const ciStr = c ? `${f2(c.p5)}  ${f2(c.mean)}  ${f2(c.p95)}` : '  N/A         N/A        N/A';
          const wPos  = wEV[sl].filter(v => v != null && v > 0).length;
          const wHas  = wEV[sl].filter(v => v != null).length;
          const robStr = c && c.p5 > 0 ? (wPos >= 2 ? '★ robust' : '○ weak  ') : '× neg CI';
          const isOpt  = sl === hyperOptSL ? ' ◄ HYPER-OPT' : sl === maxEV_SL ? ' ◄ EV-PEAK' : '';
          console.log(`  ${String(sl).padStart(4)}%${wVals.join('')}   ${ciStr}  ${robStr}${isOpt}`);
        }

        console.log('');
        if (hyperOptSL) {
          console.log(`  ◄ HYPER-OPTIMAL: ${hyperOptSL}%`);
          console.log(`    CI 90%: [${f2(hyperOptCI.p5)} → ${f2(hyperOptCI.p95)}]  (mean ${f2(hyperOptCI.mean)})`);
          if (p90w !== null) console.log(`    p90-safe stop: ${f1(p90w)}%  |  Winner MAE headroom: ${(p90w - hyperOptSL).toFixed(1)}pp`);
        } else {
          console.log(`  ◄ No stop level satisfies walk-forward + CI criteria (n too small or EV negative)`);
          console.log(`    Best available: ${maxEV_SL}% (mean ${f2(maxEV_val)}) — use with caution`);
        }
        console.log('');

        // JSON
        json.cells[`${arch}/${stage}/${bkt}`] = {
          n: combined.n,
          nWin,
          win_pct: +(nWin / combined.n * 100).toFixed(1),
          mae_p50: p50w !== null ? +p50w.toFixed(2) : null,
          mae_p75: p75w !== null ? +p75w.toFixed(2) : null,
          mae_p90: p90w !== null ? +p90w.toFixed(2) : null,
          window_n: wins.map(wn => wn.n),
          hyper_optimal_sl: hyperOptSL,
          ev_peak_sl: maxEV_SL,
          bootstrap_at_opt: hyperOptSL ? { mean: +hyperOptCI.mean.toFixed(3), p5: +hyperOptCI.p5.toFixed(3), p95: +hyperOptCI.p95.toFixed(3) } : null,
        };
      }
    }
  }

  console.log(SEP);

  // ── Grand summary ─────────────────────────────────────────────────────────
  console.log('\nHYPER-OPTIMAL STOP SUMMARY\n');
  console.log('Cell                               n    WinRate  p90-MAE  Hyper-Opt  EV-Peak  CI_low→hi');
  console.log('─'.repeat(90));
  for (const [key, d] of Object.entries(json.cells)) {
    const ci = d.bootstrap_at_opt;
    const ciStr = ci ? `${ci.p5.toFixed(2)}%→${ci.p95.toFixed(2)}%` : 'N/A';
    console.log(
      `${key.padEnd(34)} ${String(d.n).padStart(4)} `+
      `${(d.win_pct+'%').padStart(8)} `+
      `${(d.mae_p90 != null ? d.mae_p90.toFixed(1)+'%' : 'N/A').padStart(8)} `+
      `${(d.hyper_optimal_sl != null ? d.hyper_optimal_sl+'%' : 'none').padStart(9)} `+
      `${String(d.ev_peak_sl+'%').padStart(8)}  ${ciStr}`
    );
  }

  // Save JSON
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(OUT_DIR, `hyper_mae_${ts}.json`);
  fs.writeFileSync(out, JSON.stringify(json, null, 2));
  console.log(`\nResults → ${out}`);
}
