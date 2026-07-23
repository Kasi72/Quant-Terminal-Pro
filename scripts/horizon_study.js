'use strict';
/**
 * horizon_study.js — Exit Horizon Walk-Forward Study
 * ===================================================
 * Finds optimal holding horizon (bars after entry) per archetype/stage/bucket.
 *
 * Current: HORIZON=20 bars fixed for all archetypes.
 * This study scans HORIZONS = [12, 15, 18, 20, 25, 30].
 *
 * Fixed per-archetype params (from MFE + W2W3 studies, 2026-07-23):
 *   VolumeFootprint: T1=1.0×ATR, W1=70%, W2_FRAC=0.6
 *   MomentumPocket:  T1=3.0×ATR, W1=20%, W2_FRAC=0.6
 *   All others:      T1=1.5×ATR, W1=50%, W2_FRAC=0.6
 *
 * Efficiency: pre-computes phase event bars once per signal across
 * MAX_HORIZON window, then derives O(1) outcomes per horizon h.
 * All horizons evaluated on identical trade samples (requires
 * MAX_HORIZON bars of forward data, ensuring apples-to-apples).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR   = path.join(__dirname, 'results');
const WINDOW    = 300;
const N_WORKERS = Math.min(os.cpus().length, 8);
const N_BOOT    = 500;

const HORIZONS    = [12, 15, 18, 20, 25, 30];
const CUR_HORIZON = 20;
const MAX_HORIZON = 30;
const MIN_BARS    = WINDOW + MAX_HORIZON + 5;
const COMBO_KEYS  = HORIZONS.map(String);
const CUR_KEY     = String(CUR_HORIZON);

const T2_SCALE = 5 / 3;
const T3_SCALE = 10 / 3;

// Fixed T1/W1/W2_FRAC per archetype (MFE study, 2026-07-23)
const ARCH_PARAMS = {
  'VolumeFootprint': { t1m: 1.0, w1: 0.70, w2f: 0.6 },
  'MomentumPocket':  { t1m: 3.0, w1: 0.20, w2f: 0.6 },
};
const DEFAULT_T1M = 1.5;
const DEFAULT_W1  = 0.50;
const DEFAULT_W2F = 0.6;

// Hyper-optimal stops (MAE study, 2026-07-23)
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

// ── Stats ────────────────────────────────────────────────────────────────────
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
          const combos = {}, t1h = {};
          for (const k of COMBO_KEYS) combos[k] = { n: 0, sumEV: 0 };
          for (const h of HORIZONS) t1h[h] = 0;
          return { n: 0, combos, t1hits: t1h };
        };
        const cCombos = {}, ct1 = {};
        for (const k of COMBO_KEYS) cCombos[k] = { evs: [] };
        for (const h of HORIZONS) ct1[h] = 0;
        acc[arch][stage][bkt] = {
          wins: Array.from({ length: NW }, mkWin),
          combined: { n: 0, combos: cCombos, t1hits: ct1 },
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
          for (const h of HORIZONS) d.wins[wi].t1hits[h] += s.wins[wi].t1hits[h];
        }
        d.combined.n += s.combined.n;
        for (const k of COMBO_KEYS)
          for (const v of s.combined.combos[k].evs) d.combined.combos[k].evs.push(v);
        for (const h of HORIZONS) d.combined.t1hits[h] += s.combined.t1hits[h];
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

    // Require MAX_HORIZON bars of forward data for apples-to-apples comparison
    for (let i = WINDOW - 1; i < c.length - MAX_HORIZON - 1; i++) {
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
      const maxEnd   = entryIdx + MAX_HORIZON;  // guaranteed < c.length

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

        // Fixed T1/W1/W2_FRAC per archetype
        const ap  = ARCH_PARAMS[arch] || { t1m: DEFAULT_T1M, w1: DEFAULT_W1, w2f: DEFAULT_W2F };
        const t1m = ap.t1m;
        const w1  = ap.w1;
        const w2f = ap.w2f;
        const w2  = (1 - w1) * w2f;
        const w3  = (1 - w1) * (1 - w2f);

        const t1Px = entry * (1 + t1m * atrPct / 100);
        const t2Px = entry * (1 + t1m * T2_SCALE * atrPct / 100);
        const t3Px = entry * (1 + t1m * T3_SCALE * atrPct / 100);
        const g1   = t1m * atrPct;
        const g2   = t1m * T2_SCALE * atrPct;
        const g3   = t1m * T3_SCALE * atrPct;

        // ── Pre-compute all phase event bars in full MAX_HORIZON window ──
        // Phase 1: first stop and first T1 from entry
        let stopBar1 = -1, t1Bar = -1;
        for (let j = entryIdx; j <= maxEnd; j++) {
          if (stopBar1 < 0 && (c[j].o <= stopPx || c[j].l <= stopPx)) stopBar1 = j;
          if (t1Bar < 0 && c[j].h >= t1Px) t1Bar = j;
          if (stopBar1 >= 0 && t1Bar >= 0) break;
        }

        // Phase 2: first T2 and first stop after t1Bar
        let t2Bar = -1, s2Bar = -1;
        if (t1Bar >= 0) {
          for (let j = t1Bar + 1; j <= maxEnd; j++) {
            if (t2Bar < 0 && c[j].h >= t2Px) t2Bar = j;
            if (s2Bar < 0 && (c[j].o <= stopPx || c[j].l <= stopPx)) s2Bar = j;
            if (t2Bar >= 0 && s2Bar >= 0) break;
          }
        }

        // Phase 3: first T3 and first stop after t2Bar
        let t3Bar = -1, s3Bar = -1;
        if (t2Bar >= 0) {
          for (let j = t2Bar + 1; j <= maxEnd; j++) {
            if (t3Bar < 0 && c[j].h >= t3Px) t3Bar = j;
            if (s3Bar < 0 && (c[j].o <= stopPx || c[j].l <= stopPx)) s3Bar = j;
            if (t3Bar >= 0 && s3Bar >= 0) break;
          }
        }

        const cell = acc[arch][stageName][bkt];
        cell.wins[winIdx].n++;
        cell.combined.n++;

        // ── Derive outcomes per horizon in O(1) ──────────────────────────
        for (const h of HORIZONS) {
          const endH = entryIdx + h;
          const hPct = (c[endH].c - entry) / entry * 100;

          // Phase 1 outcomes capped at endH
          const p1_s  = stopBar1 >= 0 && stopBar1 <= endH &&
                        (t1Bar < 0 || t1Bar > endH || stopBar1 < t1Bar);
          const p1_t1 = t1Bar >= 0 && t1Bar <= endH && !p1_s;

          // Phase 2 outcomes capped at endH (only if T1 fired)
          const p2_s  = p1_t1 && s2Bar >= 0 && s2Bar <= endH &&
                        (t2Bar < 0 || t2Bar > endH || s2Bar < t2Bar);
          const p2_t2 = p1_t1 && t2Bar >= 0 && t2Bar <= endH && !p2_s;

          // Phase 3 outcomes capped at endH (only if T2 fired)
          const p3_s  = p2_t2 && s3Bar >= 0 && s3Bar <= endH &&
                        (t3Bar < 0 || t3Bar > endH || s3Bar < t3Bar);
          const p3_t3 = p2_t2 && t3Bar >= 0 && t3Bar <= endH && !p3_s;

          // T1 hit rate tracking (clean hit: T1 before stop, within horizon)
          if (p1_t1) {
            cell.wins[winIdx].t1hits[h]++;
            cell.combined.t1hits[h]++;
          }

          // Cascade EV
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

          const kk = String(h);
          cell.wins[winIdx].combos[kk].n++;
          cell.wins[winIdx].combos[kk].sumEV += ev;
          cell.combined.combos[kk].evs.push(ev);
        } // horizons
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

console.log(`\nHorizon Study  |  ${files.length} files  |  ${N_WORKERS} workers`);
console.log(`Horizon scan: [${HORIZONS.join(', ')}] bars  (current: ${CUR_HORIZON})`);
console.log(`Fixed params: VF T1=1.0×/W1=70%, MP T1=3.0×/W1=20%, others T1=1.5×/W1=50%`);
console.log(`All horizons evaluated on identical trade samples (MAX_HORIZON=${MAX_HORIZON} bars)`);
console.log(`OOS windows: ${OOS_WINDOWS.map(w => w.name).join(' | ')}\n`);

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

// ── Formatting ────────────────────────────────────────────────────────────────
function fmtEV(v) {
  if (v == null) return '   N/A ';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtPct(n, d) { return d > 0 ? (n / d * 100).toFixed(0) + '%' : 'N/A'; }
function padL(s, n) { return String(s).padStart(n); }
function padR(s, n) { return String(s).padEnd(n); }

// ── Print results ─────────────────────────────────────────────────────────────
function printResults(acc) {
  const SEP = '═'.repeat(80);
  const json = {
    generated: new Date().toISOString(),
    windows: OOS_WINDOWS.map(w => w.name),
    current_horizon: CUR_HORIZON,
    arch_params: {
      VolumeFootprint: { ...ARCH_PARAMS.VolumeFootprint },
      MomentumPocket:  { ...ARCH_PARAMS.MomentumPocket  },
      default: { t1m: DEFAULT_T1M, w1: DEFAULT_W1, w2f: DEFAULT_W2F },
    },
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
        const ap      = ARCH_PARAMS[arch] || { t1m: DEFAULT_T1M, w1: DEFAULT_W1, w2f: DEFAULT_W2F };

        // Walk-forward mean per horizon
        const wfMean   = {};
        const wfWinPos = {};
        for (const k of COMBO_KEYS) {
          const vals  = wins.map(wn => wn.combos[k].n >= 5 ? wn.combos[k].sumEV / wn.combos[k].n : null);
          const valid = vals.filter(v => v != null);
          wfMean[k]   = valid.length >= 2 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
          wfWinPos[k] = valid.filter(v => v > 0).length;
        }

        const curCI = bootstrap(combined.combos[CUR_KEY].evs);
        const curWF = wfMean[CUR_KEY];

        // Best: highest wfMean with ≥2 valid windows
        // Prefer shorter horizon as tie-breaker (less capital tied up)
        let bestKey = null, bestMean = -Infinity;
        for (const k of [...COMBO_KEYS].reverse()) {  // reverse → shorter wins ties
          const wm = wfMean[k];
          if (wm == null) continue;
          if (wm > bestMean + 1e-6) { bestMean = wm; bestKey = k; }
        }
        if (!bestKey) continue;

        const bestH  = parseInt(bestKey);
        const bestCI = bootstrap(combined.combos[bestKey].evs);
        const delta  = curWF != null ? bestMean - curWF : null;

        // Print header
        console.log(SEP);
        const wCounts = wins.map((wn, i) => `${OOS_WINDOWS[i].name}:${wn.n}`).join('  ');
        console.log(`${padR(cellKey, 38)}  n=${padL(combined.n, 4)}  stop=${stopPct}%  |  ${wCounts}`);
        console.log(`Fixed: T1=${ap.t1m}×ATR  W1=${(ap.w1*100).toFixed(0)}%  T2=${(ap.t1m*T2_SCALE).toFixed(2)}×ATR  T3=${(ap.t1m*T3_SCALE).toFixed(2)}×ATR`);
        console.log('');

        // T1 hit rate per horizon (shows why longer horizon helps for MP)
        const t1Row = HORIZONS.map(h => {
          const rate = fmtPct(combined.t1hits[h], combined.n);
          return padL(rate, 8);
        }).join('');
        const hHdr  = HORIZONS.map(h => padL(h + 'b', 8)).join('');
        console.log(`  Horizons: ${hHdr}`);
        console.log(`  T1 hit%:  ${t1Row}`);

        // WF mean EV per horizon
        const evRow = COMBO_KEYS.map(k => {
          const ev  = wfMean[k];
          const tag = bestKey === k ? '★' : (k === CUR_KEY ? '●' : ' ');
          return padL(ev != null ? fmtEV(ev) : '  N/A ', 7) + tag;
        }).join('');
        console.log(`  WF mean:  ${evRow}`);
        console.log('');

        // Recommendation
        if (bestKey !== CUR_KEY) {
          const robust = bestCI && bestCI.p5 > 0 ? ' [CI ROBUST p5>0]' : '';
          console.log(`  ★ OPTIMAL: horizon=${bestH} bars`);
          if (bestCI) console.log(`    WF-mean ${fmtEV(bestMean)}  CI 90% [${fmtEV(bestCI.p5)} → ${fmtEV(bestCI.p95)}]  n=${combined.combos[bestKey].evs.length}${robust}`);
          console.log(`  ● CURRENT: horizon=${CUR_HORIZON} bars`);
          if (curCI) console.log(`    WF-mean ${fmtEV(curWF)}  CI 90% [${fmtEV(curCI.p5)} → ${fmtEV(curCI.p95)}]`);
          if (delta != null) {
            const label = Math.abs(delta) < 0.05 ? 'within noise' :
                          Math.abs(delta) < 0.20 ? 'marginal'     : 'MEANINGFUL';
            console.log(`    Δ EV ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}%/trade  (${label})`);
          }
        } else {
          const robust = curCI && curCI.p5 > 0 ? ' [CI ROBUST p5>0]' : '';
          console.log(`  ● CURRENT horizon=${CUR_HORIZON} bars is ALREADY OPTIMAL`);
          if (curCI) console.log(`    WF-mean ${fmtEV(curWF)}  CI 90% [${fmtEV(curCI.p5)} → ${fmtEV(curCI.p95)}]${robust}`);
        }
        console.log('');

        json.cells[cellKey] = {
          n: combined.n,
          stop_pct: stopPct,
          arch_t1m: ap.t1m,
          arch_w1: ap.w1,
          t1_hit_by_horizon: Object.fromEntries(HORIZONS.map(h => [h + 'b', +(combined.t1hits[h] / combined.n * 100).toFixed(1)])),
          current: {
            horizon: CUR_HORIZON,
            ev_mean: curCI ? +curCI.mean.toFixed(3) : null,
            ci_p5:   curCI ? +curCI.p5.toFixed(3)   : null,
            ci_p95:  curCI ? +curCI.p95.toFixed(3)  : null,
          },
          optimal: {
            horizon: bestH,
            ev_mean: bestCI ? +bestCI.mean.toFixed(3) : null,
            ci_p5:   bestCI ? +bestCI.p5.toFixed(3)   : null,
            ci_p95:  bestCI ? +bestCI.p95.toFixed(3)  : null,
            wf_windows_positive: wfWinPos[bestKey],
          },
          delta: delta != null ? +delta.toFixed(3) : null,
        };
      }
    }
  }

  // Grand summary
  console.log(SEP);
  console.log('\nHORIZON GRAND SUMMARY\n');
  console.log(padR('Cell', 38) + padL('n', 5) + padL('T1×', 6) +
              padL('CurrEV', 9) + padL('OptH', 6) + padL('OptEV', 9) + padL('Delta', 9));
  console.log('─'.repeat(84));
  for (const [k, d] of Object.entries(json.cells)) {
    const cur = d.current.ev_mean != null ? fmtEV(d.current.ev_mean) : '  N/A ';
    const opt = d.optimal.ev_mean != null ? fmtEV(d.optimal.ev_mean) : '  N/A ';
    const dlt = d.delta != null ? (d.delta >= 0 ? '+' : '') + d.delta.toFixed(2) + '%' : 'N/A';
    console.log(
      padR(k, 38) +
      padL(d.n, 5) +
      padL(d.arch_t1m + '×', 6) +
      padL(cur, 9) +
      padL(d.optimal.horizon + 'b', 6) +
      padL(opt, 9) +
      padL(dlt, 9)
    );
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(OUT_DIR, `horizon_study_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`\nResults → ${outPath}`);
}
