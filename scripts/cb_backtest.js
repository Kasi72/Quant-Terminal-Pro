'use strict';
/**
 * cb_backtest.js — Circuit Breaker Classification Backtest
 * ─────────────────────────────────────────────────────────
 * For every bar in every stock, runs CB at bar D, then checks if bar D+1 is
 * an upper circuit event. Reports Precision / Recall / F1 by tier and IS/OOS.
 *
 * Circuit definition: single-day gain ≥9% and ≤25%, with H≈C ≤0.5%
 *   (same criteria as circuit_deep_dive.js case-control study)
 *
 * Key metrics:
 *   Recall    = TP / (TP + FN)   — of ALL circuits, what % did CB catch at D-1?
 *   Precision = TP / (TP + FP)   — of CB signals, what % had a circuit next day?
 *   F1        = 2·P·R / (P+R)
 *   Signal%   = signals / totalBars × 100
 *
 * Tiers:  ULTRA (≥72) · STRONG (≥62) · BUY (≥43)
 * Split:  IS ≤ 2025-05-05  ·  OOS > 2025-05-05
 *
 * Usage:  node scripts/cb_backtest.js
 *         node scripts/cb_backtest.js --workers 12
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const OUT_DIR    = path.join(__dirname, 'results');

const PARAM_KEY  = 'circuit_breaker_v2';
const ARCH_TYPE  = 'CircuitBreaker';
const WINDOW     = 300;
const OOS_CUT    = '2025-05-05';
const BOOT_N     = 2000;

const argv = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };
const N_WORKERS = Math.min(parseInt(getArg('--workers', String(os.cpus().length)), 10), 16);

// Circuit event thresholds (mirror circuit_deep_dive.js)
const CIRCUIT_PCT_MIN = 9.0;
const CIRCUIT_PCT_MAX = 25.0;
const CIRCUIT_HC_GAP  = 0.5;   // H ≈ C means stock is locked at upper limit

// Tier score thresholds
const TIERS = [
  { label: 'ULTRA',  minScore: 72,  stage: 'ULTRA_STRONG_BUY' },
  { label: 'STRONG', minScore: 62,  stage: 'STRONG_BUY' },
  { label: 'BUY',    minScore: 43,  stage: 'BUY' },
];

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(s => s.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || !o || !h || !l || !c || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  // dedup same-timestamp rows
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
    else d.push(x);
  }
  return d;
}

// ─── Circuit event detector ───────────────────────────────────────────────────

function isCircuitBar(bars, idx) {
  if (idx < 1 || idx >= bars.length) return false;
  const b = bars[idx], prev = bars[idx - 1];
  if (prev.c <= 0 || b.c <= 0) return false;
  const chgPct = (b.c / prev.c - 1) * 100;
  if (chgPct < CIRCUIT_PCT_MIN || chgPct > CIRCUIT_PCT_MAX) return false;
  const hcGap = b.h > 0 ? (b.h - b.c) / b.c * 100 : 99;
  return hcGap <= CIRCUIT_HC_GAP;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function confMatrix(rows) {
  let tp = 0, fp = 0, fn = 0, totalCircuits = 0, totalSignals = 0, totalBars = 0;
  for (const r of rows) {
    totalBars++;
    if (r.isCircuit) totalCircuits++;
    if (r.fired)     totalSignals++;
    if (r.fired &&  r.isCircuit) tp++;
    if (r.fired && !r.isCircuit) fp++;
    if (!r.fired && r.isCircuit) fn++;
  }
  const tn = totalBars - tp - fp - fn;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) * 100 : 0;
  const recall    = (tp + fn) > 0 ? tp / (tp + fn) * 100 : 0;
  const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const signalRate = totalBars > 0 ? totalSignals / totalBars * 100 : 0;
  const circuitRate = totalBars > 0 ? totalCircuits / totalBars * 100 : 0;
  return { tp, fp, fn, tn, totalBars, totalCircuits, totalSignals, precision, recall, f1, signalRate, circuitRate };
}

// Bootstrap CI on precision using the fired rows
function bootstrapPrecision(rows, nBoots = BOOT_N) {
  const fired = rows.filter(r => r.fired);
  const n = fired.length;
  if (n < 5) return { lo: 0, hi: 0, mean: 0 };
  const samples = [];
  for (let b = 0; b < nBoots; b++) {
    let tp = 0;
    for (let i = 0; i < n; i++) {
      if (fired[Math.floor(Math.random() * n)].isCircuit) tp++;
    }
    samples.push(tp / n * 100);
  }
  samples.sort((a, b) => a - b);
  return {
    lo:   samples[Math.floor(nBoots * 0.025)],
    hi:   samples[Math.floor(nBoots * 0.975)],
    mean: samples.reduce((a, x) => a + x, 0) / nBoots,
  };
}

// Bootstrap CI on recall using the circuit rows
function bootstrapRecall(rows, nBoots = BOOT_N) {
  const circuits = rows.filter(r => r.isCircuit);
  const n = circuits.length;
  if (n < 5) return { lo: 0, hi: 0, mean: 0 };
  const samples = [];
  for (let b = 0; b < nBoots; b++) {
    let tp = 0;
    for (let i = 0; i < n; i++) {
      if (circuits[Math.floor(Math.random() * n)].fired) tp++;
    }
    samples.push(tp / n * 100);
  }
  samples.sort((a, b) => a - b);
  return {
    lo:   samples[Math.floor(nBoots * 0.025)],
    hi:   samples[Math.floor(nBoots * 0.975)],
    mean: samples.reduce((a, x) => a + x, 0) / nBoots,
  };
}

// ─══════════════════════════════════════════════════════════════════════════════
// WORKER THREAD
// ═══════════════════════════════════════════════════════════════════════════════

function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));

  // Each row: { symbol, date, isCircuit, fired, stage, score, isOOS }
  // We only store rows where fired || isCircuit (TN rows not needed for stats,
  // but we track totalBars for signal rate denominator)
  const results   = [];
  let   totalBars = 0;

  for (const { name, fp } of workerData.files) {
    let bars;
    try { bars = parseCSV(fp); } catch { continue; }
    if (bars.length < WINDOW + 2) continue;

    const symbol = name.replace(/_OHLCV\.csv$/i, '').replace(/_NS$/, '');

    for (let i = WINDOW - 1; i < bars.length - 1; i++) {
      totalBars++;

      const nextIsCircuit = isCircuitBar(bars, i + 1);
      const date = new Date(bars[i].ts * 1000).toISOString().slice(0, 10);
      const isOOS = date > OOS_CUT;

      // Run CB on window ending at bars[i]
      const w = bars.slice(Math.max(0, i - WINDOW + 1), i + 1);
      let r;
      try { r = engine.analyzeStock(w, PARAM_KEY, false); } catch { continue; }

      const fired = !!(r && r.archetypeType === ARCH_TYPE && r.stage && r.stage !== 'NO_SIGNAL');
      const score = fired ? (r.inflectionScore ?? 0) : 0;
      const stage = fired ? (r.stage ?? 'NO_SIGNAL') : 'NO_SIGNAL';

      // Record if either fired or next bar is a circuit (skip TN rows)
      if (fired || nextIsCircuit) {
        results.push({ symbol, date, isCircuit: nextIsCircuit, fired, score, stage, isOOS });
      }
    }

    parentPort.postMessage({ type: 'progress', n: 1 });
  }

  parentPort.postMessage({ type: 'done', results, totalBars });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN THREAD
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`); process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(DATA_DIR)
    .filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(N_WORKERS, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║     CIRCUIT BREAKER — CLASSIFICATION BACKTEST (Precision / Recall)    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════╝`);
  console.log(`  Stocks: ${files.length} | Workers: ${nWorkers} | OOS cutoff: ${OOS_CUT} | Bootstrap: ${BOOT_N}`);
  console.log(`  Circuit gate: ≥${CIRCUIT_PCT_MIN}% and ≤${CIRCUIT_PCT_MAX}% single-day move, H–C gap ≤${CIRCUIT_HC_GAP}%\n`);

  let allResults  = [];
  let totalBarsGlobal = 0;
  let stocksDone  = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        stocksDone++;
        if (stocksDone % 50 === 0) process.stdout.write(`  Scanning ${stocksDone}/${files.length}…\r`);
      } else if (m.type === 'done') {
        allResults   = allResults.concat(m.results);
        totalBarsGlobal += m.totalBars;
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`Worker exit ${c}`)); });
  })));

  process.stdout.write(' '.repeat(50) + '\r');

  // ── Partition into IS and OOS ─────────────────────────────────────────────
  const isRows  = allResults.filter(r => !r.isOOS);
  const oosRows = allResults.filter(r =>  r.isOOS);

  const totalBarsIS  = allResults.filter(r => !r.isOOS).length;  // approximate
  const totalBarsOOS = allResults.filter(r =>  r.isOOS).length;

  // Total circuits found
  const totalCircuitsAll = allResults.filter(r => r.isCircuit).length;
  const totalCircuitsIS  = isRows.filter(r => r.isCircuit).length;
  const totalCircuitsOOS = oosRows.filter(r => r.isCircuit).length;

  console.log(`  Total bars evaluated:  ${totalBarsGlobal.toLocaleString()}`);
  console.log(`  Circuit events found:  ${totalCircuitsAll.toLocaleString()} (IS: ${totalCircuitsIS} | OOS: ${totalCircuitsOOS})`);
  console.log(`  Circuit rate (base):   ${(totalCircuitsAll / totalBarsGlobal * 100).toFixed(3)}% of all evaluated bars\n`);

  // ── Per-tier analysis ─────────────────────────────────────────────────────
  const F = (v, d = 1) => v != null && isFinite(v) ? v.toFixed(d) : '—';
  const N = (s, w) => String(s).padStart(w);
  const L = (s, w) => String(s).padEnd(w);

  const SEP   = '─'.repeat(120);
  const SEP80 = '─'.repeat(80);

  console.log(SEP);
  console.log(
    L('Tier', 10) +
    N('n_sig', 7) + N('n_circ', 8) +
    N('Prec%', 7) + N('Rec%', 7) + N('F1', 7) + N('Sig%', 7) +
    '  ║  IS  ' +
    N('IS_sig', 8) + N('IS_P%', 7) + N('IS_R%', 7) + N('IS_F1', 7) +
    '  ║  OOS ' +
    N('OOS_sig', 8) + N('OOS_P%', 7) + N('OOS_R%', 7) + N('OOS_F1', 7) +
    N('CI_lo', 8) + N('CI_hi', 7)
  );
  console.log(SEP);

  const report = {
    generated: new Date().toISOString(),
    paramKey: PARAM_KEY,
    oosCut: OOS_CUT,
    totalStocks: files.length,
    totalBarsEvaluated: totalBarsGlobal,
    totalCircuitsFound: totalCircuitsAll,
    circuitRatePct: totalCircuitsAll / totalBarsGlobal * 100,
    tiers: {},
  };

  // Also compute ALL-signals tier (any stage fired)
  const tierDefs = [
    { label: 'ALL fired', minScore: 0,  stages: new Set(['ULTRA_STRONG_BUY','STRONG_BUY','BUY','PRE_BREAKOUT']) },
    { label: 'BUY+ (≥43)', minScore: 43, stages: new Set(['ULTRA_STRONG_BUY','STRONG_BUY','BUY']) },
    { label: 'STRONG+(≥62)',minScore: 62, stages: new Set(['ULTRA_STRONG_BUY','STRONG_BUY']) },
    { label: 'ULTRA (≥72)', minScore: 72, stages: new Set(['ULTRA_STRONG_BUY']) },
  ];

  for (const tier of tierDefs) {
    // Filter to rows where either: CB didn't fire (but circuit is known), or fired at/above this tier
    const filterFired = r => r.fired && r.score >= tier.minScore && tier.stages.has(r.stage);

    // Build "augmented" row list: all circuit events + all tier-matching signals
    // (circuit events where CB didn't fire are FN, signals without circuit are FP)
    const circuitRows = allResults.filter(r => r.isCircuit);
    const signalRows  = allResults.filter(r => filterFired(r));

    // Merge into unified set (dedup by symbol+date)
    const byKey = new Map();
    for (const r of circuitRows) byKey.set(`${r.symbol}|${r.date}`, { ...r, firedAtTier: false });
    for (const r of signalRows) {
      const key = `${r.symbol}|${r.date}`;
      if (byKey.has(key)) byKey.get(key).firedAtTier = true;
      else byKey.set(key, { ...r, firedAtTier: true });
    }
    const mergedRows = [...byKey.values()];

    // Compute confusion matrix properly
    let tp = 0, fp = 0, fn = 0;
    let tpIS = 0, fpIS = 0, fnIS = 0;
    let tpOOS = 0, fpOOS = 0, fnOOS = 0;

    for (const r of mergedRows) {
      const fired = r.firedAtTier;
      if (fired &&  r.isCircuit) { tp++;  r.isOOS ? tpOOS++ : tpIS++; }
      if (fired && !r.isCircuit) { fp++;  r.isOOS ? fpOOS++ : fpIS++; }
      if (!fired && r.isCircuit) { fn++;  r.isOOS ? fnOOS++ : fnIS++; }
    }

    const prec   = (tp+fp) > 0 ? tp/(tp+fp)*100 : 0;
    const rec    = (tp+fn) > 0 ? tp/(tp+fn)*100  : 0;
    const f1     = (prec+rec) > 0 ? 2*prec*rec/(prec+rec) : 0;

    const precIS = (tpIS+fpIS) > 0 ? tpIS/(tpIS+fpIS)*100 : 0;
    const recIS  = (tpIS+fnIS) > 0 ? tpIS/(tpIS+fnIS)*100  : 0;
    const f1IS   = (precIS+recIS) > 0 ? 2*precIS*recIS/(precIS+recIS) : 0;

    const precOOS = (tpOOS+fpOOS) > 0 ? tpOOS/(tpOOS+fpOOS)*100 : 0;
    const recOOS  = (tpOOS+fnOOS) > 0 ? tpOOS/(tpOOS+fnOOS)*100  : 0;
    const f1OOS   = (precOOS+recOOS) > 0 ? 2*precOOS*recOOS/(precOOS+recOOS) : 0;

    const sigTotal  = tp + fp;
    const sigRate   = totalBarsGlobal > 0 ? sigTotal / totalBarsGlobal * 100 : 0;

    // Bootstrap CI on OOS precision
    const oosSignalRows = mergedRows.filter(r => r.firedAtTier && r.isOOS);
    const ci = bootstrapPrecision(oosSignalRows.map(r => ({ fired: true, isCircuit: r.isCircuit })));

    console.log(
      L(tier.label, 10) +
      N(sigTotal, 7) + N(tp, 8) +
      N(F(prec,2), 7) + N(F(rec,2), 7) + N(F(f1,2), 7) + N(F(sigRate,3), 7) +
      '  ║     ' +
      N(tpIS+fpIS, 8) + N(F(precIS,2), 7) + N(F(recIS,2), 7) + N(F(f1IS,2), 7) +
      '  ║     ' +
      N(tpOOS+fpOOS, 8) + N(F(precOOS,2), 7) + N(F(recOOS,2), 7) + N(F(f1OOS,2), 7) +
      N(`[${F(ci.lo,1)},${F(ci.hi,1)}]`, 15)
    );

    report.tiers[tier.label] = {
      tp, fp, fn,
      precision: prec, recall: rec, f1,
      signalRate: sigRate,
      IS:  { tp: tpIS,  fp: fpIS,  fn: fnIS,  precision: precIS,  recall: recIS,  f1: f1IS },
      OOS: { tp: tpOOS, fp: fpOOS, fn: fnOOS, precision: precOOS, recall: recOOS, f1: f1OOS,
             bootstrapCI: ci },
    };
  }

  console.log(SEP);

  // ── Detailed OOS ULTRA analysis ──────────────────────────────────────────
  const oosUltra = allResults.filter(r => r.isOOS && r.fired &&
    r.score >= 72 && r.stage === 'ULTRA_STRONG_BUY');
  const oosUltraCircuits = oosUltra.filter(r => r.isCircuit);

  console.log(`\n  ┌─ OOS ULTRA_STRONG_BUY deep-dive`);
  console.log(`  │  OOS ULTRA signals: ${oosUltra.length}  →  ${oosUltraCircuits.length} had circuit next day`);
  if (oosUltra.length > 0) {
    console.log(`  │  OOS ULTRA precision: ${F(oosUltraCircuits.length / oosUltra.length * 100, 2)}%`);
    // Score distribution of TP vs FP
    const tpScores = oosUltraCircuits.map(r => r.score);
    const fpScores = oosUltra.filter(r => !r.isCircuit).map(r => r.score);
    const avg = arr => arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : 0;
    console.log(`  │  Avg score  TP: ${F(avg(tpScores), 1)}  FP: ${F(avg(fpScores), 1)}`);
  }

  // ── Recall breakdown by year ─────────────────────────────────────────────
  console.log(`\n  ┌─ RECALL BY YEAR (BUY+ tier, any signal ≥43) [OOS = after ${OOS_CUT}]`);
  const circuitRowsAll = allResults.filter(r => r.isCircuit);
  const byYear = {};
  for (const r of circuitRowsAll) {
    const yr = r.date.slice(0, 4);
    if (!byYear[yr]) byYear[yr] = { total: 0, caught: 0 };
    byYear[yr].total++;
    if (r.fired && r.score >= 43) byYear[yr].caught++;
  }
  for (const [yr, d] of Object.entries(byYear).sort()) {
    const tag = yr > OOS_CUT.slice(0, 4) ? ' [OOS]' : yr === OOS_CUT.slice(0, 4) ? ' [mix]' : ' [IS] ';
    console.log(`  │  ${yr}${tag}  circuits: ${String(d.total).padStart(5)}  caught: ${String(d.caught).padStart(5)}  recall: ${F(d.caught / d.total * 100, 1)}%`);
  }
  console.log(`  └─`);

  // ── Top-10 missed circuits (FN) in OOS ──────────────────────────────────
  const oosFN = allResults.filter(r => r.isOOS && r.isCircuit && !r.fired)
    .sort((a, b) => a.date.localeCompare(b.date));
  console.log(`\n  ┌─ OOS FALSE NEGATIVES — circuits missed by CB (showing first 15)`);
  console.log(`  │  ${'SYMBOL'.padEnd(14)} ${'DATE'.padEnd(12)} SCORE  STAGE`);
  for (const r of oosFN.slice(0, 15)) {
    console.log(`  │  ${r.symbol.padEnd(14)} ${r.date.padEnd(12)} ${String(r.score).padStart(5)}  ${r.stage}`);
  }
  console.log(`  │  ... and ${Math.max(0, oosFN.length - 15)} more`);
  console.log(`  └─`);

  // ── Baseline comparison ──────────────────────────────────────────────────
  const baseCircuitRate = totalCircuitsAll / totalBarsGlobal * 100;
  const ultraTier = report.tiers['ULTRA (≥72)'];
  const lift = ultraTier ? ultraTier.OOS.precision / baseCircuitRate : 0;
  console.log(`\n  ┌─ LIFT vs BASE RATE`);
  console.log(`  │  Base circuit rate (random bar):      ${F(baseCircuitRate, 3)}%`);
  console.log(`  │  ULTRA OOS precision:                 ${F(ultraTier?.OOS.precision, 2)}%`);
  console.log(`  │  Lift (ULTRA / base):                 ${F(lift, 1)}×`);
  console.log(`  └─  (lift > 1 = model beats random; lift > 3 = operationally useful)`);

  // ── Save JSON ────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jp = path.join(OUT_DIR, `cb_backtest_${stamp}.json`);
  fs.writeFileSync(jp, JSON.stringify(report, null, 2));
  console.log(`\n  Saved → ${jp}\n`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  runWorker().catch(e => {
    parentPort.postMessage({ type: 'error', error: e.stack || String(e) });
    process.exitCode = 1;
  });
}
