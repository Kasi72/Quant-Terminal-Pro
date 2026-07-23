'use strict';
/**
 * mfe_study.js — Maximum Favorable Excursion Walk-Forward Study
 * =============================================================
 * Finds optimal T1 multiplier and cascade exit-weight split by:
 *   1. Scanning 9 T1 multiples × 6 exit weights = 54 combinations
 *   2. Using hyper-optimal stops from hyper_mae_study (2026-07-23)
 *   3. Validating across 3 non-overlapping OOS windows
 *   4. Bootstrap 90% CI on the best combination
 *
 * T2 = T1 × (2.5/1.5) = T1 × 5/3   (preserves current T1:T2 ratio)
 * T3 = T1 × (5.0/1.5) = T1 × 10/3  (preserves current T1:T3 ratio)
 * After T1 exit: remaining weight splits 60% → T2, 40% → T3
 *
 * CURRENT params: T1=1.5×ATR, W1=50%, W2=30%, W3=20%
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR   = path.join(__dirname, 'results');
const HORIZON   = 20;
const WINDOW    = 300;
const MIN_BARS  = WINDOW + HORIZON + 5;
const N_WORKERS = Math.min(os.cpus().length, 8);
const N_BOOT    = 500;

// Scan space
const T1_MULTS   = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];  // 9 levels
const W1_WEIGHTS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];                      // 6 levels
const T2_SCALE   = 5 / 3;   // T2 = T1 × (2.5/1.5)
const T3_SCALE   = 10 / 3;  // T3 = T1 × (5.0/1.5)

// Current params (baseline for delta comparison)
const CUR_T1M = 1.5;
const CUR_W1  = 0.5;
const CUR_KEY = `${CUR_T1M}_${CUR_W1}`;

// Combo keys: all T1_mult × W1_weight combinations
const COMBO_KEYS = [];
for (const t of T1_MULTS) for (const w of W1_WEIGHTS) COMBO_KEYS.push(`${t}_${w}`);

// Hyper-optimal stops from hyper_mae_study (2026-07-23)
const MAE_STOPS = {
  'VolumeFootprint/BUY/VOLATILE':    8.0,
  'VolumeFootprint/BUY/HIGH':        4.0,
  'MomentumPocket/BUY/NORMAL':       4.0,
  'MomentumPocket/BUY/VOLATILE':     5.5,
  'MomentumPocket/BUY/HIGH':        12.5,
  'MomentumPocket/STRONG/VOLATILE':  8.0,
  'MomentumPocket/STRONG/HIGH':      8.0,
  'ORS/STRONG/HIGH':                 4.0,
  'ORS/ULTRA/HIGH':                  4.0,
};
const DEFAULT_STOP = 6.0;

// OOS windows
const OOS_WINDOWS = [
  { name: 'W1 2024H1', from: '2024-01-01', to: '2024-07-01' },
  { name: 'W2 2024H2', from: '2024-07-01', to: '2025-01-01' },
  { name: 'W3 2025+',  from: '2025-01-01', to: '2026-01-01' },
];
const W_FROM = OOS_WINDOWS.map(w => new Date(w.from + 'T00:00:00Z').getTime() / 1000);
const W_TO   = OOS_WINDOWS.map(w => new Date(w.to   + 'T00:00:00Z').getTime() / 1000);
const NW = OOS_WINDOWS.length;

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

function atrBucket(p) {
  return p < 1.5 ? 'TIGHT' : p < 2.5 ? 'NORMAL' : p < 3.5 ? 'VOLATILE' : 'HIGH';
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

// ── ATR14 ───────────────────────────────────────────────────────────────────
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

// ── Stats helpers ────────────────────────────────────────────────────────────
function pctile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function bootstrap(evs) {
  const n = evs.length;
  if (n < 5) return null;
  const m = new Float64Array(N_BOOT);
  for (let r = 0; r < N_BOOT; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += evs[Math.floor(Math.random() * n)];
    m[r] = sum / n;
  }
  m.sort();
  return { mean: evs.reduce((a, b) => a + b, 0) / n, p5: m[Math.floor(0.05 * N_BOOT)], p95: m[Math.floor(0.95 * N_BOOT)] };
}

// ── Accumulator ──────────────────────────────────────────────────────────────
function newAcc() {
  const acc = {};
  for (const [arch] of ARCHETYPES) {
    acc[arch] = {};
    for (const stage of STAGES) {
      acc[arch][stage] = {};
      for (const bkt of BUCKETS) {
        const mkWin = () => {
          const combos = {};
          for (const k of COMBO_KEYS) combos[k] = { n: 0, sumEV: 0 };
          const th = {}, t2h = {}, t3h = {};
          for (const t of T1_MULTS) { th[t] = 0; t2h[t] = 0; t3h[t] = 0; }
          return { n: 0, combos, t1hits: th, t2hits: t2h, t3hits: t3h };
        };
        const wins = Array.from({ length: NW }, mkWin);
        const cCombos = {};
        for (const k of COMBO_KEYS) cCombos[k] = { evs: [] };
        const ct1 = {}, ct2 = {}, ct3 = {};
        for (const t of T1_MULTS) { ct1[t] = 0; ct2[t] = 0; ct3[t] = 0; }
        acc[arch][stage][bkt] = {
          wins,
          combined: { n: 0, mfe_all: [], combos: cCombos, t1hits: ct1, t2hits: ct2, t3hits: ct3 },
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
        const d = dst[arch][stage][bkt], s = src[arch][stage][bkt];
        for (let wi = 0; wi < NW; wi++) {
          d.wins[wi].n += s.wins[wi].n;
          for (const k of COMBO_KEYS) {
            d.wins[wi].combos[k].n     += s.wins[wi].combos[k].n;
            d.wins[wi].combos[k].sumEV += s.wins[wi].combos[k].sumEV;
          }
          for (const t of T1_MULTS) {
            d.wins[wi].t1hits[t] += s.wins[wi].t1hits[t];
            d.wins[wi].t2hits[t] += s.wins[wi].t2hits[t];
            d.wins[wi].t3hits[t] += s.wins[wi].t3hits[t];
          }
        }
        d.combined.n += s.combined.n;
        for (const v of s.combined.mfe_all) d.combined.mfe_all.push(v);
        for (const k of COMBO_KEYS)
          for (const v of s.combined.combos[k].evs) d.combined.combos[k].evs.push(v);
        for (const t of T1_MULTS) {
          d.combined.t1hits[t] += s.combined.t1hits[t];
          d.combined.t2hits[t] += s.combined.t2hits[t];
          d.combined.t3hits[t] += s.combined.t3hits[t];
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

      const end  = Math.min(c.length - 1, entryIdx + HORIZON);
      const hPct = (c[end].c - entry) / entry * 100;

      // Raw MFE across full horizon
      let rawMFE = 0;
      for (let j = entryIdx; j <= end; j++) {
        const fav = (c[j].h - entry) / entry * 100;
        if (fav > rawMFE) rawMFE = fav;
      }

      for (const [arch, key] of ARCHETYPES) {
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r) continue;
        const stg = r.stage;
        if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;
        const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA' : stg === 'STRONG_BUY' ? 'STRONG' : 'BUY';

        const cellKey = `${arch}/${stageName}/${bkt}`;
        const stopPct = MAE_STOPS[cellKey] ?? DEFAULT_STOP;
        const stopPx  = entry * (1 - stopPct / 100);

        // Pre-compute phase-1 stop bar (first stop fire across full horizon)
        let stopBar1 = -1;
        for (let j = entryIdx; j <= end; j++) {
          if (c[j].o <= stopPx || c[j].l <= stopPx) { stopBar1 = j; break; }
        }

        const cell = acc[arch][stageName][bkt];
        cell.wins[winIdx].n++;
        cell.combined.n++;
        cell.combined.mfe_all.push(rawMFE);

        // Scan each T1 multiplier
        for (const t1m of T1_MULTS) {
          const t1Px = entry * (1 + t1m * atrPct / 100);
          const t2Px = entry * (1 + t1m * T2_SCALE * atrPct / 100);
          const t3Px = entry * (1 + t1m * T3_SCALE * atrPct / 100);

          // Phase 1: find T1 hit bar
          let t1Bar = -1;
          for (let j = entryIdx; j <= end; j++) {
            if (c[j].h >= t1Px) { t1Bar = j; break; }
          }
          const p1_s  = stopBar1 >= 0 && (t1Bar < 0 || stopBar1 < t1Bar);
          const p1_t1 = t1Bar >= 0 && !p1_s;

          // Phase 2: T2 vs stop (only after T1)
          let t2Bar = -1, s2Bar = -1;
          if (p1_t1) {
            for (let j = t1Bar + 1; j <= end; j++) {
              if (c[j].h >= t2Px && t2Bar < 0) t2Bar = j;
              if ((c[j].o <= stopPx || c[j].l <= stopPx) && s2Bar < 0) s2Bar = j;
              if (t2Bar >= 0 && s2Bar >= 0) break;
            }
          }
          const p2_s  = p1_t1 && s2Bar >= 0 && (t2Bar < 0 || s2Bar < t2Bar);
          const p2_t2 = p1_t1 && t2Bar >= 0 && !p2_s;

          // Phase 3: T3 vs stop (only after T2)
          let t3Bar = -1, s3Bar = -1;
          if (p2_t2) {
            for (let j = t2Bar + 1; j <= end; j++) {
              if (c[j].h >= t3Px && t3Bar < 0) t3Bar = j;
              if ((c[j].o <= stopPx || c[j].l <= stopPx) && s3Bar < 0) s3Bar = j;
              if (t3Bar >= 0 && s3Bar >= 0) break;
            }
          }
          const p3_s  = p2_t2 && s3Bar >= 0 && (t3Bar < 0 || s3Bar < t3Bar);
          const p3_t3 = p2_t2 && t3Bar >= 0 && !p3_s;

          // % gains at each target
          const g1 = t1m * atrPct;
          const g2 = t1m * T2_SCALE * atrPct;
          const g3 = t1m * T3_SCALE * atrPct;

          // Record target hit counts
          if (p1_t1) { cell.wins[winIdx].t1hits[t1m]++; cell.combined.t1hits[t1m]++; }
          if (p2_t2) { cell.wins[winIdx].t2hits[t1m]++; cell.combined.t2hits[t1m]++; }
          if (p3_t3) { cell.wins[winIdx].t3hits[t1m]++; cell.combined.t3hits[t1m]++; }

          // Cascade EV for each exit weight
          for (const w1 of W1_WEIGHTS) {
            const w2 = (1 - w1) * 0.6;
            const w3 = (1 - w1) * 0.4;
            let ev;

            if (p1_s) {
              ev = -stopPct;
            } else if (!p1_t1) {
              ev = hPct;
            } else {
              ev = w1 * g1;
              if (p2_s) {
                ev += (w2 + w3) * (-stopPct);
              } else if (!p2_t2) {
                ev += (w2 + w3) * hPct;
              } else {
                ev += w2 * g2;
                if (p3_s)        ev += w3 * (-stopPct);
                else if (!p3_t3) ev += w3 * hPct;
                else             ev += w3 * g3;
              }
            }

            const k = `${t1m}_${w1}`;
            cell.wins[winIdx].combos[k].n++;
            cell.wins[winIdx].combos[k].sumEV += ev;
            cell.combined.combos[k].evs.push(ev);
          }
        } // T1_MULTS
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
if (!files.length) { console.error('No CSVs in', DATA_DIR); process.exit(1); }

const chunks = Array.from({ length: N_WORKERS }, () => []);
files.forEach((f, i) => chunks[i % N_WORKERS].push(f));

console.log(`\nMFE Study  |  ${files.length} files  |  ${N_WORKERS} workers`);
console.log(`T1 scan: [${T1_MULTS.join(', ')}] ×ATR`);
console.log(`W1 scan: [${W1_WEIGHTS.map(w => (w * 100).toFixed(0) + '%').join(', ')}]`);
console.log(`Windows: ${OOS_WINDOWS.map(w => w.name).join(' | ')}`);
console.log(`Current: T1=${CUR_T1M}×ATR, W1=${CUR_W1 * 100}%  T2=${(CUR_T1M * T2_SCALE).toFixed(2)}×ATR  T3=${(CUR_T1M * T3_SCALE).toFixed(2)}×ATR\n`);

const t0 = Date.now();
const acc = newAcc();

const workers = chunks.map(chunk => new Promise((res, rej) => {
  const wk = new Worker(__filename, { workerData: { files: chunk } });
  wk.on('message', msg => {
    if (msg.type === 'progress') process.stdout.write(`\r  ~${msg.n} files…`);
    else if (msg.type === 'done') { mergeAcc(acc, msg.acc); res(); }
  });
  wk.on('error', rej);
  wk.on('exit', code => { if (code !== 0) rej(new Error(`Worker exit ${code}`)); });
}));

Promise.all(workers).then(() => {
  process.stdout.write('\n');
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  printResults(acc);
}).catch(e => { console.error(e); process.exit(1); });

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtEV(v) {
  if (v == null) return '   N/A ';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtPct(n, d) {
  return d > 0 ? (n / d * 100).toFixed(0) + '%' : 'N/A';
}
function padL(s, n) { return String(s).padStart(n); }
function padR(s, n) { return String(s).padEnd(n); }

// ── Print results ─────────────────────────────────────────────────────────────
function printResults(acc) {
  const SEP = '═'.repeat(86);
  const json = {
    generated: new Date().toISOString(),
    windows: OOS_WINDOWS.map(w => w.name),
    current: { t1m: CUR_T1M, w1: CUR_W1 },
    cells: {},
  };

  for (const [arch] of ARCHETYPES) {
    for (const stage of STAGES) {
      for (const bkt of BUCKETS) {
        const cell = acc[arch][stage][bkt];
        if (cell.combined.n < 10) continue;

        const { combined, wins } = cell;
        const cellKey = `${arch}/${stage}/${bkt}`;
        const stopPct = MAE_STOPS[cellKey] ?? DEFAULT_STOP;

        // Raw MFE stats
        const mfeP50 = pctile(combined.mfe_all, 50);
        const mfeP75 = pctile(combined.mfe_all, 75);
        const mfeP90 = pctile(combined.mfe_all, 90);

        // Walk-forward mean EV per combo (mean of windows with n≥5)
        const wfMean = {};
        const wfWinPos = {};  // count of windows with positive EV
        for (const k of COMBO_KEYS) {
          const vals = wins.map(wn => wn.combos[k].n >= 5 ? wn.combos[k].sumEV / wn.combos[k].n : null);
          const valid = vals.filter(v => v != null);
          wfMean[k]   = valid.length >= 2 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
          wfWinPos[k] = valid.filter(v => v > 0).length;
        }

        // Current combo stats
        const curCI = bootstrap(combined.combos[CUR_KEY].evs);
        const curWF = wfMean[CUR_KEY];

        // Find optimal: highest wfMean with ≥2 valid windows
        // Prefer lower T1_mult as tie-breaker (conservative)
        let bestKey = null, bestMean = -Infinity;
        for (const t1m of T1_MULTS) {
          for (const w1 of W1_WEIGHTS) {
            const k = `${t1m}_${w1}`;
            const wm = wfMean[k];
            if (wm == null) continue;
            if (wm > bestMean + 1e-6) { bestMean = wm; bestKey = k; }
          }
        }
        if (!bestKey) continue;

        const [bestT1m, bestW1] = bestKey.split('_').map(Number);
        const bestCI = bootstrap(combined.combos[bestKey].evs);
        const delta  = curWF != null ? bestMean - curWF : null;

        // ── Print header ──────────────────────────────────────────────────
        console.log(SEP);
        const wCounts = wins.map((wn, i) => `${OOS_WINDOWS[i].name}:${wn.n}`).join('  ');
        console.log(`${padR(cellKey, 38)}  n=${padL(combined.n, 4)}  stop=${stopPct}%  |  ${wCounts}`);
        console.log(`Raw MFE  p50=${mfeP50 != null ? mfeP50.toFixed(1) + '%' : 'N/A'}  ` +
                    `p75=${mfeP75 != null ? mfeP75.toFixed(1) + '%' : 'N/A'}  ` +
                    `p90=${mfeP90 != null ? mfeP90.toFixed(1) + '%' : 'N/A'}`);

        // T1 hit rates by mult
        const hitRates = T1_MULTS.map(t =>
          `${(t + '×').padStart(5)} ${fmtPct(combined.t1hits[t], combined.n).padStart(4)}`
        ).join('  ');
        console.log(`T1 hit rates: ${hitRates}`);

        // T1→T2 and T2→T3 conversions at current T1=1.5×
        const t1n = combined.t1hits[CUR_T1M];
        const t2n = combined.t2hits[CUR_T1M];
        const t3n = combined.t3hits[CUR_T1M];
        console.log(`At current T1=1.5×: hit ${t1n}/${combined.n}=${fmtPct(t1n, combined.n)}  ` +
                    `T1→T2 ${fmtPct(t2n, t1n)}  T2→T3 ${fmtPct(t3n, t2n)}`);
        console.log('');

        // ── EV grid ───────────────────────────────────────────────────────
        const wHdr = W1_WEIGHTS.map(w => padL((w * 100) + '%', 9)).join('');
        console.log(`  Walk-forward EV (mean ≥2 of 3 OOS windows)    ${wHdr}`);
        console.log('  ' + '─'.repeat(80));
        for (const t1m of T1_MULTS) {
          const isCurrentT1 = Math.abs(t1m - CUR_T1M) < 0.01;
          const cells = W1_WEIGHTS.map(w1 => {
            const k = `${t1m}_${w1}`;
            const ev = wfMean[k];
            const tag = bestKey === k ? '★' : (isCurrentT1 && Math.abs(w1 - CUR_W1) < 0.01 ? '●' : ' ');
            return padL(ev != null ? fmtEV(ev) : '  N/A ', 8) + tag;
          }).join('');
          const prefix = isCurrentT1 ? '●' : ' ';
          console.log(`  ${prefix} ${padR(t1m + '×ATR', 9)}  ${cells}`);
        }
        console.log('');

        // ── Recommendation ────────────────────────────────────────────────
        const optW1pct = (bestW1 * 100).toFixed(0) + '%';
        const optT2m   = (bestT1m * T2_SCALE).toFixed(2);
        const optT3m   = (bestT1m * T3_SCALE).toFixed(2);
        console.log(`  ★ OPTIMAL: T1=${bestT1m}×ATR  T2=${optT2m}×ATR  T3=${optT3m}×ATR  exit ${optW1pct} at T1`);
        if (bestCI) {
          const robust = bestCI.p5 > 0 ? ' [CI ROBUST p5>0]' : '';
          console.log(`    WF-mean ${fmtEV(bestMean)}  CI 90% [${fmtEV(bestCI.p5)} → ${fmtEV(bestCI.p95)}]  n=${combined.combos[bestKey].evs.length}${robust}`);
        }

        console.log(`  ● CURRENT: T1=1.5×ATR  T2=2.50×ATR  T3=5.00×ATR  exit 50% at T1`);
        if (curCI) console.log(`    WF-mean ${fmtEV(curWF)}  CI 90% [${fmtEV(curCI.p5)} → ${fmtEV(curCI.p95)}]`);

        if (delta != null) {
          const label = Math.abs(delta) < 0.05 ? 'within noise' :
                        Math.abs(delta) < 0.20  ? 'marginal'     : 'MEANINGFUL';
          console.log(`  Δ EV delta: ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}%/trade  (${label})`);
        }

        // Conversion rates at optimal T1
        if (Math.abs(bestT1m - CUR_T1M) > 0.01) {
          const ot1 = combined.t1hits[bestT1m];
          const ot2 = combined.t2hits[bestT1m];
          const ot3 = combined.t3hits[bestT1m];
          console.log(`  At optimal T1=${bestT1m}×: hit ${ot1}/${combined.n}=${fmtPct(ot1, combined.n)}  T1→T2 ${fmtPct(ot2, ot1)}  T2→T3 ${fmtPct(ot3, ot2)}`);
        }
        console.log('');

        // JSON record
        json.cells[cellKey] = {
          n: combined.n,
          stop_pct: stopPct,
          mfe_p50: mfeP50 != null ? +mfeP50.toFixed(2) : null,
          mfe_p75: mfeP75 != null ? +mfeP75.toFixed(2) : null,
          mfe_p90: mfeP90 != null ? +mfeP90.toFixed(2) : null,
          t1_hit_rates: Object.fromEntries(T1_MULTS.map(t => [`${t}x`, +(combined.t1hits[t] / combined.n * 100).toFixed(1)])),
          current: {
            t1m: CUR_T1M, w1: CUR_W1,
            ev_mean: curCI ? +curCI.mean.toFixed(3) : null,
            ci_p5: curCI ? +curCI.p5.toFixed(3) : null,
            ci_p95: curCI ? +curCI.p95.toFixed(3) : null,
          },
          optimal: {
            t1m: bestT1m, w1: bestW1,
            t2m: +(bestT1m * T2_SCALE).toFixed(4),
            t3m: +(bestT1m * T3_SCALE).toFixed(4),
            ev_mean: bestCI ? +bestCI.mean.toFixed(3) : null,
            ci_p5: bestCI ? +bestCI.p5.toFixed(3) : null,
            ci_p95: bestCI ? +bestCI.p95.toFixed(3) : null,
            wf_windows_positive: wfWinPos[bestKey],
          },
          delta: delta != null ? +delta.toFixed(3) : null,
        };
      }
    }
  }

  // ── Grand summary ─────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('\nMFE GRAND SUMMARY\n');
  console.log(padR('Cell', 38) + padL('n', 5) + padL('MFE-p90', 9) + padL('Stop', 6) +
              padL('CurrEV', 9) + padL('OptT1×', 8) + padL('OptW1', 6) +
              padL('OptEV', 9) + padL('Delta', 9));
  console.log('─'.repeat(98));
  for (const [k, d] of Object.entries(json.cells)) {
    const cur = d.current.ev_mean != null ? fmtEV(d.current.ev_mean) : '  N/A ';
    const opt = d.optimal.ev_mean != null ? fmtEV(d.optimal.ev_mean) : '  N/A ';
    const dlt = d.delta != null ? (d.delta >= 0 ? '+' : '') + d.delta.toFixed(2) + '%' : 'N/A';
    console.log(
      padR(k, 38) +
      padL(d.n, 5) +
      padL(d.mfe_p90 != null ? d.mfe_p90.toFixed(1) + '%' : 'N/A', 9) +
      padL(d.stop_pct + '%', 6) +
      padL(cur, 9) +
      padL(d.optimal.t1m + '×', 8) +
      padL((d.optimal.w1 * 100).toFixed(0) + '%', 6) +
      padL(opt, 9) +
      padL(dlt, 9)
    );
  }

  console.log('\nSCAN PARAMETERS');
  console.log(`T2 ratio: T1 × ${T2_SCALE.toFixed(4)} (current T2=${(CUR_T1M*T2_SCALE).toFixed(2)}×ATR)`);
  console.log(`T3 ratio: T1 × ${T3_SCALE.toFixed(4)} (current T3=${(CUR_T1M*T3_SCALE).toFixed(2)}×ATR)`);
  console.log(`Remaining after T1 exit: 60% to T2, 40% to T3 (fixed split)`);

  // Save JSON
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(OUT_DIR, `mfe_study_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`\nResults → ${outPath}`);
}
