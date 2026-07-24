'use strict';
/**
 * deep_backtest.js  —  Phase 1: Master signal dataset + aggregate stats
 * ======================================================================
 * Scans 1617 OHLCV files × 6 archetypes × full history.
 * Outputs TWO files:
 *   1. deep_extract_TIMESTAMP.json  — per-trade records for Phases 2-4
 *   2. deep_summary_TIMESTAMP.json  — aggregate table (same as comprehensive_backtest)
 *
 * Per-trade record (compact):
 *   ai  archetype index (0-5)
 *   di  date unix-timestamp of signal bar
 *   gi  stage index (BUY=0, STRONG=1, ULTRA=2)
 *   bi  ATR-band index (TIGHT=0, NORMAL=1, VOLATILE=2, HIGH=3)
 *   o   isOOS (bool)
 *   rp  riskPct  (entry-stop)/entry*100
 *   ap  atrPct   atr14/entry*100
 *   mh  maxHold  bars
 *   p1  t1Pct   (t1-entry)/entry*100
 *   p2  t2Pct
 *   p3  t3Pct
 *   bt  bit-field per bar [length=maxHold]: bit0=stopHit, bit1=t1Hit,
 *       bit2=t2Hit, bit3=t3Hit, bit4=beHit(low<=entry)
 *   cp  closePL per bar [length=maxHold]: (close-entry)/entry*100 rounded 2dp
 *   ma  MAE cumulative per bar [length=maxHold]
 *   mf  MFE cumulative per bar [length=maxHold]
 *
 * Runtime: ~35-50 min with 8 workers
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR   = path.join(__dirname, 'results');
const OOS_CUT   = new Date('2024-01-01T00:00:00Z').getTime() / 1000;
const WINDOW    = 300;
const MIN_BARS  = WINDOW + 30;
const N_WORKERS = Math.min(os.cpus().length, 8);

const ARCH_KEYS = [
  ['ORS',             'ors_prime_reversal'],
  ['VolumeFootprint', 'optimized_deployable_20plus'],
  ['CompressionCoil', 'optimized_highprecision_15plus'],
  ['MomentumPocket',  'optimized_elite_10plus'],
  ['EMAStack',        'optimized_ultraselective_8plus'],
  ['CircuitBreaker',  'circuit_breaker_v2'],
];
const ARCH_NAMES  = ARCH_KEYS.map(([n]) => n);
const STAGES      = ['BUY', 'STRONG', 'ULTRA'];
const BUCKETS     = ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH'];
const W1 = 0.50, W2 = 0.30, W3 = 0.20;

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

function atrBucket(p) {
  if (p < 1.5) return 'TIGHT';
  if (p < 2.5) return 'NORMAL';
  if (p < 3.5) return 'VOLATILE';
  return 'HIGH';
}

function r2(n) { return Math.round(n * 100) / 100; }
function r3(n) { return Math.round(n * 1000) / 1000; }

// ── Aggregate cell ───────────────────────────────────────────────────────────
function newCell() {
  return {
    n:0, ns:0, nt1:0, nt2:0, nt3:0, nto:0,
    spl:0, swpl:0, slpl:0, sr:0, sr2:0,
    mae:[], mfe:[], hold:[],
  };
}
function mergeCell(d, s) {
  d.n+=s.n; d.ns+=s.ns; d.nt1+=s.nt1; d.nt2+=s.nt2; d.nt3+=s.nt3; d.nto+=s.nto;
  d.spl+=s.spl; d.swpl+=s.swpl; d.slpl+=s.slpl; d.sr+=s.sr; d.sr2+=s.sr2;
  for (const v of s.mae) d.mae.push(v);
  for (const v of s.mfe) d.mfe.push(v);
  for (const v of s.hold) d.hold.push(v);
}
function newAcc() {
  const acc = {};
  for (const [arch] of ARCH_KEYS) {
    acc[arch] = {};
    for (const st of STAGES)
      for (const bk of BUCKETS)
        (acc[arch][st] = acc[arch][st] || {})[bk] = { is: newCell(), oos: newCell() };
  }
  return acc;
}
function mergeAcc(dst, src) {
  for (const [arch] of ARCH_KEYS)
    for (const st of STAGES)
      for (const bk of BUCKETS) {
        mergeCell(dst[arch][st][bk].is,  src[arch][st][bk].is);
        mergeCell(dst[arch][st][bk].oos, src[arch][st][bk].oos);
      }
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const idx = (p/100)*(s.length-1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo]+(s[hi]-s[lo])*(idx-lo);
}

// ════════════════════════════════════════════════════════════════════════════
// WORKER
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const engine = require(ENGINE_JS);
  const acc    = newAcc();
  const trades = [];

  for (const fp of workerData.files) {
    let candles;
    try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < MIN_BARS) continue;

    for (let i = WINDOW - 1; i < candles.length - 2; i++) {
      const bar = candles[i];
      if (!bar || bar.c <= 0) continue;
      const w = candles.slice(i - WINDOW + 1, i + 1);

      for (let ai = 0; ai < ARCH_KEYS.length; ai++) {
        const [arch, key] = ARCH_KEYS[ai];
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r) continue;
        const stg = r.stage;
        if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid || pe.tacticalStop <= 0 || pe.target5 <= pe.plannedEntry) continue;

        const gi = stg === 'ULTRA_STRONG_BUY' ? 2 : stg === 'STRONG_BUY' ? 1 : 0;
        const stageName = STAGES[gi];

        const entry   = pe.plannedEntry;
        const stop    = pe.tacticalStop;
        const t1      = pe.target5;
        const t2      = pe.target7;
        const t3      = pe.target10;
        const riskAbs = entry - stop;
        if (riskAbs <= 0) continue;

        const riskPct = r2(riskAbs / entry * 100);
        const atrPct  = pe.atr14AtEntry > 0 ? r2(pe.atr14AtEntry / entry * 100) : r2(r.atrPct || 2);
        const bkt     = atrBucket(atrPct);
        const bi      = BUCKETS.indexOf(bkt);
        const isOOS   = bar.ts >= OOS_CUT;
        const maxHold = pe.maxHoldBars || 20;

        const t1Pct = r3((t1 - entry) / entry * 100);
        const t2Pct = r3((t2 - entry) / entry * 100);
        const t3Pct = r3((t3 - entry) / entry * 100);

        // ── Scan all forward bars (always up to maxHold for re-simulation) ──
        const entryIdx = i + 1;
        const endIdx   = Math.min(candles.length - 1, entryIdx + maxHold - 1);

        const btArr = [];   // bit-fields per bar
        const cpArr = [];   // close PL per bar
        const maArr = [];   // cumulative MAE per bar
        const mfArr = [];   // cumulative MFE per bar

        let cumMAE = 0, cumMFE = 0;

        // ── Original cascade sim (for aggregate stats) ────────────────────
        let phase = 1, wLeft = 1.0, weightedPL = 0;
        let stopHit = false, t1Hit = false, t2Hit = false, t3Hit = false, tOut = false;
        let holdBars = 0;
        let cascadeDone = false;
        let exitR = null;

        // Handle gap-down stop on entry bar
        const eBar = candles[entryIdx];
        if (!eBar) continue;

        if (eBar.o < stop) {
          // Gap-down: exit at open, record one bar of data
          const gapLoss = (eBar.o - entry) / entry * 100;
          weightedPL = -gapLoss;  // negative
          exitR = -(entry - eBar.o) / riskAbs;
          stopHit = true; cascadeDone = true; holdBars = 1;
        }

        for (let j = entryIdx; j <= endIdx; j++) {
          const b = candles[j];
          if (!b) break;

          const adv = (entry - b.l) / entry * 100;
          const fav = (b.h - entry) / entry * 100;
          if (adv > cumMAE) cumMAE = adv;
          if (fav > cumMFE) cumMFE = fav;

          const sb  = b.l <= stop;
          const t1b = b.h >= t1;
          const t2b = b.h >= t2;
          const t3b = b.h >= t3;
          const beb = b.l <= entry;
          const bits = (sb?1:0)|(t1b?2:0)|(t2b?4:0)|(t3b?8:0)|(beb?16:0);
          const cpl  = r2((b.c - entry) / entry * 100);

          btArr.push(bits);
          cpArr.push(cpl);
          maArr.push(r2(cumMAE));
          mfArr.push(r2(cumMFE));

          if (!cascadeDone) {
            holdBars = j - entryIdx + 1;

            if (j === entryIdx && b.o < stop) {
              const gapLoss = (entry - b.o) / entry * 100;
              weightedPL = -gapLoss;
              exitR = -(entry - b.o) / riskAbs;
              stopHit = true; cascadeDone = true; continue;
            }

            if (phase === 1) {
              if (b.l <= stop) {
                weightedPL -= (entry - stop) / entry * 100;
                exitR = -1.0; stopHit = true; cascadeDone = true; continue;
              }
              if (b.h >= t1) {
                weightedPL += W1 * t1Pct;
                wLeft = W2 + W3; t1Hit = true; phase = 2;
              }
            }
            if (phase === 2) {
              if (b.l <= stop) {
                weightedPL -= wLeft * (entry - stop) / entry * 100;
                cascadeDone = true; continue;
              }
              if (b.h >= t2) {
                weightedPL += W2 * t2Pct;
                wLeft = W3; t2Hit = true; phase = 3;
              }
            }
            if (phase === 3) {
              if (b.l <= stop) {
                weightedPL -= wLeft * (entry - stop) / entry * 100;
                cascadeDone = true; continue;
              }
              if (b.h >= t3) {
                weightedPL += W3 * t3Pct;
                wLeft = 0; t3Hit = true; cascadeDone = true; continue;
              }
            }
            if (j === endIdx && wLeft > 0) {
              weightedPL += wLeft * cpl;
              tOut = !t1Hit; cascadeDone = true;
            }
          }
        }

        if (exitR === null) exitR = weightedPL / riskPct;

        // ── Aggregate ────────────────────────────────────────────────────
        const cell = acc[arch][stageName][bkt][isOOS ? 'oos' : 'is'];
        cell.n++;
        if (stopHit && !t1Hit) cell.ns++;
        if (t1Hit)  cell.nt1++;
        if (t2Hit)  cell.nt2++;
        if (t3Hit)  cell.nt3++;
        if (tOut)   cell.nto++;
        cell.spl  += weightedPL;
        if (weightedPL >= 0) cell.swpl += weightedPL;
        else cell.slpl += Math.abs(weightedPL);
        cell.sr  += exitR;
        cell.sr2 += exitR * exitR;
        cell.mae.push(r2(cumMAE));
        cell.mfe.push(r2(cumMFE));
        cell.hold.push(holdBars);

        // ── Per-trade record ─────────────────────────────────────────────
        trades.push({ ai, di: bar.ts, gi, bi, o: isOOS?1:0,
          rp: riskPct, ap: atrPct, mh: maxHold,
          p1: t1Pct, p2: t2Pct, p3: t3Pct,
          bt: btArr, cp: cpArr, ma: maArr, mf: mfArr });
      }
    }
  }

  parentPort.postMessage({ acc, trades });
  return;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const ts0 = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const extractFile = path.join(OUT_DIR, `deep_extract_${stamp}.json`);
const summaryFile = path.join(OUT_DIR, `deep_summary_${stamp}.json`);

console.log(`\n📊 Deep Backtest (Phase 1) — ${files.length} symbols, ${N_WORKERS} workers`);
console.log(`   Engine : ${ENGINE_JS}`);
console.log(`   OOS    : 2024-01-01+`);
console.log(`   Output : ${extractFile}\n`);

const acc    = newAcc();
const allTrades = [];
let done = 0;
const chunkSize = Math.ceil(files.length / N_WORKERS);

const workers = Array.from({ length: N_WORKERS }, (_, idx) => {
  const slice = files.slice(idx * chunkSize, (idx + 1) * chunkSize);
  const w = new Worker(__filename, { workerData: { files: slice } });
  w.on('message', ({ acc: pa, trades: pt }) => {
    mergeAcc(acc, pa);
    for (const t of pt) allTrades.push(t);
    done++;
    process.stdout.write(`\r   Workers done: ${done}/${N_WORKERS}  (trades so far: ${allTrades.length.toLocaleString()})   `);
    if (done === N_WORKERS) finish();
  });
  w.on('error', e => console.error('\nWorker error:', e));
  return w;
});

function fmtCell(c) {
  if (c.n < 3) return null;
  const wr    = c.nt1 / c.n * 100;
  const sr    = c.ns  / c.n * 100;
  const t2r   = c.nt1 > 0 ? c.nt2 / c.nt1 * 100 : 0;
  const t3r   = c.nt2 > 0 ? c.nt3 / c.nt2 * 100 : 0;
  const avgPL = c.spl / c.n;
  const pf    = c.slpl > 0 ? c.swpl / c.slpl : Infinity;
  const avgR  = c.sr / c.n;
  const sdR   = c.n > 1 ? Math.sqrt(Math.max(0, c.sr2/c.n - avgR*avgR)) : 0;
  const kelly = sdR > 0 ? Math.max(0, avgR / (sdR*sdR)) * 100 : 0;
  const maeP50 = pct(c.mae, 50); const maeP90 = pct(c.mae, 90);
  const mfeP50 = pct(c.mfe, 50); const mfeP90 = pct(c.mfe, 90);
  const avgHold = c.hold.length ? c.hold.reduce((a,b)=>a+b,0)/c.hold.length : 0;
  return { n:c.n, wr, sr, t2r, t3r, avgPL, pf, avgR, kelly,
           maeP50, maeP90, mfeP50, mfeP90, avgHold,
           t1:c.nt1, t2:c.nt2, t3:c.nt3 };
}

function finish() {
  const elapsed = ((Date.now() - ts0) / 1000 / 60).toFixed(1);
  console.log(`\n\n   Elapsed: ${elapsed} min  |  Total trades: ${allTrades.length.toLocaleString()}`);

  // ── Build summary ─────────────────────────────────────────────────────────
  const summary = [];
  const BAND_ORDER = ['TIGHT','NORMAL','VOLATILE','HIGH'];

  console.log('\n\n' + '═'.repeat(120));
  console.log('  DEEP BACKTEST — Phase 1 Results (OOS 2024+)');
  console.log('═'.repeat(120));

  for (const [arch] of ARCH_KEYS) {
    // Aggregate OOS row
    const totOOS = newCell();
    for (const st of STAGES)
      for (const bk of BUCKETS)
        mergeCell(totOOS, acc[arch][st][bk].oos);
    const f = fmtCell(totOOS);
    if (f) {
      console.log(`\n  ${arch.padEnd(18)} OOS  n=${f.n.toLocaleString().padStart(7)}  ` +
        `WR=${f.wr.toFixed(1).padStart(5)}%  SR=${f.sr.toFixed(1).padStart(5)}%  ` +
        `T2=${f.t2r.toFixed(0).padStart(3)}%  T3=${f.t3r.toFixed(0).padStart(3)}%  ` +
        `AvgPL=${(f.avgPL>=0?'+':'')}${f.avgPL.toFixed(2).padStart(6)}%  ` +
        `PF=${f.pf===Infinity?'∞   ':f.pf.toFixed(2).padStart(5)}  ` +
        `AvgR=${(f.avgR>=0?'+':'')}${f.avgR.toFixed(2).padStart(5)}  ` +
        `Kelly=${f.kelly.toFixed(1).padStart(5)}%  ` +
        `MAEp90=${f.maeP90.toFixed(1).padStart(4)}%  MFEp90=${f.mfeP90.toFixed(1).padStart(4)}%  ` +
        `Hold=${f.avgHold.toFixed(1).padStart(4)}d`);
    } else {
      console.log(`\n  ${arch.padEnd(18)} OOS  n=${totOOS.n.toLocaleString().padStart(7)}  (insufficient data)`);
    }

    // Detail by stage × band (OOS)
    for (const st of STAGES) {
      for (const bk of BAND_ORDER) {
        const c = acc[arch][st][bk].oos;
        const cf = fmtCell(c);
        if (!cf || cf.n < 5) continue;
        summary.push({ arch, stage: st, band: bk, period: 'OOS', ...cf });
        console.log(
          `    ${st.padEnd(6)} ${bk.padEnd(8)}  n=${String(cf.n).padStart(6)}  ` +
          `WR=${cf.wr.toFixed(1).padStart(5)}%  SR=${cf.sr.toFixed(1).padStart(5)}%  ` +
          `AvgPL=${(cf.avgPL>=0?'+':'')}${cf.avgPL.toFixed(2).padStart(6)}%  ` +
          `PF=${cf.pf===Infinity?'∞   ':cf.pf.toFixed(2).padStart(5)}  ` +
          `MAEp50=${cf.maeP50.toFixed(1).padStart(4)}% p90=${cf.maeP90.toFixed(1).padStart(4)}%  ` +
          `MFEp50=${cf.mfeP50.toFixed(1).padStart(4)}% p90=${cf.mfeP90.toFixed(1).padStart(4)}%  ` +
          `Hold=${cf.avgHold.toFixed(1).padStart(4)}d`
        );
      }
    }
  }

  // ── Save files ────────────────────────────────────────────────────────────
  console.log(`\n\n  Saving per-trade extract → ${extractFile}`);
  fs.writeFileSync(extractFile, JSON.stringify({
    meta: { stamp, archNames: ARCH_NAMES, stages: STAGES, buckets: BUCKETS,
            oosCut: '2024-01-01', window: WINDOW, w1: W1, w2: W2, w3: W3,
            totalTrades: allTrades.length },
    trades: allTrades,
  }));

  console.log(`  Saving summary → ${summaryFile}`);
  fs.writeFileSync(summaryFile, JSON.stringify({ meta: { stamp }, rows: summary }, null, 2));

  const mb = (fs.statSync(extractFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n  Extract file size: ${mb} MB`);
  console.log(`  Stamp: ${stamp}`);
  console.log('\n  ✅ Phase 1 complete. Use stamp above for Phases 2-4.\n');
}
