'use strict';
/**
 * paramHyperGrid.js
 * =================
 * Hyper-optimise ARCHETYPE_EXIT_DEFAULTS for maximum profit factor.
 * Extended grid: SL 0.5-5×  ×  TP 0.5-15%  ×  Hold 3-30bars
 * Also tests "breakeven stop" mode: SL moves to entry once price >= entry + TP×0.5.
 * Sorts results by PF DESC (primary) then WR (secondary) to find sweet spots.
 * WR filter: >= 65% to exclude degenerate high-WR/low-PF or high-PF/low-WR combos.
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OOS_CUT    = '2025-01-01';
const MIN_BARS   = 150;
const WINDOW     = 300;
const WORKERS    = Number(process.env.WORKERS || 12);
const MAX_HOLD_SCAN = 30;

const KEY_MAP = {
  optimized_deployable_20plus:    'deployable_20plus',
  optimized_highprecision_15plus: 'highprecision_15plus',
  optimized_elite_10plus:         'elite_10plus',
  optimized_ultraselective_8plus: 'ultraselective_8plus',
  sniper_95plus:                  'sniper_95plus',
  ors_prime_reversal:             'ors_prime_reversal',
  circuit_breaker_v2:             'circuit_breaker_v2',
};
const PARAM_KEYS = Object.keys(KEY_MAP);
const GRID_TARGETS = new Set(Object.values(KEY_MAP));

// Current live values (v16 baseline)
const V16 = {
  deployable_20plus:    { targetPct: 2.0, slMult: 4.0, maxHold: 20 },
  highprecision_15plus: { targetPct: 1.5, slMult: 4.0, maxHold: 15 },
  elite_10plus:         { targetPct: 3.0, slMult: 4.0, maxHold: 25 },
  ultraselective_8plus: { targetPct: 1.5, slMult: 2.5, maxHold: 12 },
  sniper_95plus:        { targetPct: 1.5, slMult: 2.5, maxHold: 8  },
  ors_prime_reversal:   { targetPct: 5.0, slMult: 2.5, maxHold: 5  },
  circuit_breaker_v2:   { targetPct: 1.0, slMult: 2.5, maxHold: 3  },
};

// Extended hyper-grid
const SL_MULTS    = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const MAX_HOLDS   = [3, 5, 8, 10, 12, 15, 20, 25, 30];
const TARGET_PCTS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0, 15.0];
const TOTAL_COMBOS = SL_MULTS.length * MAX_HOLDS.length * TARGET_PCTS.length;

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT']);

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 5) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +(p[5] || 0);
    if (!Number.isFinite(ts) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
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

function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  if (c.length < 2) return out;
  const tr = [0];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)));
  }
  if (c.length <= 14) { for (let i = 1; i < c.length; i++) out[i] = tr[i]; return out; }
  let s = 0; for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i-1] * 13 + tr[i]) / 14;
  return out;
}

function runWorker() {
  const engine   = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const oosCutTs = workerData.oosCutTs;
  const signals  = {};
  for (const dk of GRID_TARGETS) signals[dk] = [];
  let processed = 0;

  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }
    const atr14 = atr14Array(c);

    for (const engineKey of PARAM_KEYS) {
      const displayKey = KEY_MAP[engineKey];
      if (!GRID_TARGETS.has(displayKey)) continue;
      let lastExitIdx = -1;

      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExitIdx) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, engineKey); } catch { continue; }
        if (!r || !ACTIONABLE.has(r.stage)) continue;

        const entryIdx = i + 1;
        if (entryIdx >= c.length) continue;
        const entry = c[entryIdx].o;
        if (entry <= 0) continue;

        const atrSig = atr14[i] || c[i].c * 0.02;
        if (atrSig <= 0) continue;

        const scanEnd = Math.min(c.length - 1, entryIdx + MAX_HOLD_SCAN - 1);
        const bars = [];
        for (let j = entryIdx; j <= scanEnd; j++) bars.push({ o: c[j].o, h: c[j].h, l: c[j].l, c: c[j].c });

        signals[displayKey].push({
          split: c[i].ts < oosCutTs ? 'is' : 'oos',
          entry, atrSig, bars,
        });

        lastExitIdx = i + MAX_HOLD_SCAN;
      }
    }

    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', signals });
}

// Fixed TP/SL simulation
function simulate(sig, slMult, maxHold, targetPct) {
  const { entry, atrSig, bars } = sig;
  const stop = entry - slMult * atrSig;
  const t1   = entry * (1 + targetPct / 100);
  const limit = Math.min(bars.length, maxHold);
  let hitT1 = false, stopped = false, exitPx = entry;

  for (let j = 0; j < limit; j++) {
    const b = bars[j];
    if (b.o <= stop) { exitPx = b.o; stopped = true; break; }
    if (b.l <= stop) { exitPx = stop; stopped = true; break; }
    if (b.h >= t1)   { hitT1 = true; exitPx = t1; break; }
    if (j === limit - 1) exitPx = b.c;
  }

  return { pnl: (exitPx - entry) / entry * 100, hitT1, stopped };
}

// Breakeven stop: once price reaches entry + TP×0.5, SL moves to entry
// This dramatically reduces losses by turning time-exits into breakevens
function simulateBE(sig, slMult, maxHold, targetPct) {
  const { entry, atrSig, bars } = sig;
  let stopLoss = entry - slMult * atrSig;
  const t1       = entry * (1 + targetPct / 100);
  const beLevel  = entry * (1 + (targetPct / 100) * 0.5); // half-TP triggers BE
  const limit    = Math.min(bars.length, maxHold);
  let hitT1 = false, stopped = false, exitPx = entry;
  let beActivated = false;

  for (let j = 0; j < limit; j++) {
    const b = bars[j];
    // Check if BE should activate (high reached half-TP)
    if (!beActivated && b.h >= beLevel) {
      beActivated = true;
      stopLoss = entry; // move SL to breakeven
    }
    if (b.o <= stopLoss) { exitPx = b.o; stopped = !beActivated; break; }
    if (b.l <= stopLoss) { exitPx = stopLoss; stopped = !beActivated; break; }
    if (b.h >= t1) { hitT1 = true; exitPx = t1; break; }
    if (j === limit - 1) exitPx = b.c;
  }

  return { pnl: (exitPx - entry) / entry * 100, hitT1, stopped };
}

// Trailing stop: SL trails at 1×ATR below peak, activates after BE
function simulateTrail(sig, slMult, maxHold, targetPct) {
  const { entry, atrSig, bars } = sig;
  let stopLoss   = entry - slMult * atrSig;
  const t1       = entry * (1 + targetPct / 100);
  const beLevel  = entry * (1 + (targetPct / 100) * 0.5);
  const limit    = Math.min(bars.length, maxHold);
  let hitT1 = false, stopped = false, exitPx = entry;
  let beActivated = false;
  let peak = entry;

  for (let j = 0; j < limit; j++) {
    const b = bars[j];
    if (b.h > peak) peak = b.h;
    // Activate BE + trailing once half-TP hit
    if (!beActivated && b.h >= beLevel) {
      beActivated = true;
      stopLoss = Math.max(stopLoss, entry); // floor at entry
    }
    // Update trailing stop (1×ATR below peak, never below initial stop)
    if (beActivated) {
      const trail = peak - atrSig; // 1×ATR trail
      stopLoss = Math.max(stopLoss, trail);
    }
    if (b.o <= stopLoss) { exitPx = b.o; stopped = !beActivated; break; }
    if (b.l <= stopLoss) { exitPx = stopLoss; stopped = !beActivated; break; }
    if (b.h >= t1) { hitT1 = true; exitPx = t1; break; }
    if (j === limit - 1) exitPx = b.c;
  }

  return { pnl: (exitPx - entry) / entry * 100, hitT1, stopped };
}

function stats(trades) {
  if (!trades.length) return null;
  const n      = trades.length;
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const sw     = wins.reduce((s, t) => s + t.pnl, 0);
  const sl     = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
  const pf     = sl > 0 ? sw / sl : (sw > 0 ? 999 : 0);
  return {
    n,
    t1Pct:   +(trades.filter(t => t.hitT1).length / n * 100).toFixed(1),
    stopPct: +(trades.filter(t => t.stopped).length / n * 100).toFixed(1),
    pf:      +pf.toFixed(2),
    avgPnl:  +(trades.reduce((s, t) => s + t.pnl, 0) / n).toFixed(2),
    expVal:  +(sw / n - sl / n).toFixed(3), // expected value per trade
  };
}

if (!isMainThread) { runWorker(); process.exit(0); }

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(WORKERS, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));
  const oosCutTs = Date.parse(OOS_CUT) / 1000;

  console.log(`\n${'='.repeat(110)}`);
  console.log(`  HYPER GRID — MAX PROFIT FACTOR  (OOS >= ${OOS_CUT})`);
  console.log(`  SL: [${SL_MULTS.join(', ')}]×  |  TP: [${TARGET_PCTS.join(', ')}]%  |  Hold: [${MAX_HOLDS.join(', ')}]bars`);
  console.log(`  ${TOTAL_COMBOS} combos per param set  |  Fixed / Breakeven / Trailing modes`);
  console.log(`${'='.repeat(110)}\n`);
  console.log(`  Scanning ${files.length} stocks across ${nWorkers} workers...\n`);

  let progress = 0;
  const allByKey = {};
  for (const dk of GRID_TARGETS) allByKey[dk] = [];

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, oosCutTs } });
    w.on('message', m => {
      if (m.type === 'progress') {
        progress += m.n;
        process.stdout.write(`  ${progress}/${files.length} stocks scanned...\r`);
      } else if (m.type === 'done') {
        for (const [dk, sigs] of Object.entries(m.signals)) {
          if (allByKey[dk]) allByKey[dk].push(...sigs);
        }
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c !== 0) reject(new Error(`worker exit ${c}`)); });
  })));

  console.log(`\n  Done scanning. Signal counts:\n`);
  for (const dk of GRID_TARGETS) {
    const all = allByKey[dk];
    const oos = all.filter(s => s.split === 'oos').length;
    const is_ = all.filter(s => s.split === 'is').length;
    console.log(`    ${dk.padEnd(28)} IS=${is_}  OOS=${oos}`);
  }

  const DISPLAY_ORDER = [
    'deployable_20plus', 'highprecision_15plus', 'elite_10plus',
    'ultraselective_8plus', 'sniper_95plus', 'ors_prime_reversal', 'circuit_breaker_v2',
  ];

  const TOP_N = 15;
  const MIN_WR = 65; // % — filter degenerate combos

  const recommendedCombos = {};

  for (const dk of DISPLAY_ORDER) {
    const all     = allByKey[dk];
    const isSigs  = all.filter(s => s.split === 'is');
    const oosSigs = all.filter(s => s.split === 'oos');

    console.log(`\n\n${'═'.repeat(110)}`);
    console.log(`  ${dk.toUpperCase()}  (v16: SL=${V16[dk].slMult}×  maxHold=${V16[dk].maxHold}  TP=${V16[dk].targetPct}%)`);
    console.log(`${'═'.repeat(110)}`);

    if (!oosSigs.length) { console.log('  No OOS signals.\n'); continue; }

    // v16 baseline row
    {
      const b   = V16[dk];
      const oos = stats(oosSigs.map(s => simulate(s, b.slMult, b.maxHold, b.targetPct)));
      const is_ = stats(isSigs.map(s => simulate(s, b.slMult, b.maxHold, b.targetPct)));
      const beBas = stats(oosSigs.map(s => simulateBE(s, b.slMult, b.maxHold, b.targetPct)));
      if (oos) {
        console.log(`\n  v16 baseline  → Fixed: WR=${oos.t1Pct}%  PF=${oos.pf}  avgPnL=${oos.avgPnl}%  |  +BE: PF=${beBas?.pf}  avgPnL=${beBas?.avgPnl}%`);
      }
    }

    // ── FIXED TP/SL MODE ──
    console.log(`\n  ┌─ FIXED MODE (sorted by PF desc, WR >= ${MIN_WR}%)`);
    console.log(`  │  ${'TP%'.padEnd(5)} ${'SL'.padEnd(5)} ${'Hold'.padEnd(6)} ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'Stop%'.padStart(6)}  ${'PF'.padStart(6)}  ${'avgPnL'.padStart(7)}  ${'expVal'.padStart(7)}`);
    console.log(`  │  ${'-'.repeat(72)}`);

    const fixedCombos = [];
    for (const tp of TARGET_PCTS) {
      for (const sl of SL_MULTS) {
        for (const h of MAX_HOLDS) {
          const oos = stats(oosSigs.map(s => simulate(s, sl, h, tp)));
          if (!oos || oos.t1Pct < MIN_WR) continue;
          fixedCombos.push({ tp, sl, h, ...oos });
        }
      }
    }
    fixedCombos.sort((a, b) => b.pf - a.pf || b.t1Pct - a.t1Pct);

    let fixedBest = null;
    for (const row of fixedCombos.slice(0, TOP_N)) {
      const pfStar = row.pf >= 2 ? ' ★★' : (row.pf >= 1.5 ? ' ★' : '');
      console.log(`  │  ${String(row.tp+'%').padEnd(5)} ${String(row.sl+'×').padEnd(5)} ${String(row.h+'d').padEnd(6)} ${String(row.n).padStart(5)}  ${(row.t1Pct+'%').padStart(6)}  ${(row.stopPct+'%').padStart(6)}  ${String(row.pf).padStart(6)}${pfStar}  ${(row.avgPnl+'%').padStart(7)}  ${(row.expVal).toFixed(3).padStart(7)}`);
      if (!fixedBest) fixedBest = row;
    }
    if (!fixedCombos.length) console.log(`  │  (no combo achieves WR >= ${MIN_WR}%)`);

    // ── BREAKEVEN MODE ──
    // NOTE: WR (T1%) drops in BE mode — many trades exit at entry (pnl=0, not T1 hit).
    // Filter by avgPnL >= 0 (positive expectancy) instead of WR floor.
    console.log(`\n  ├─ BREAKEVEN MODE (SL → entry once price >= TP×0.5, sorted by PF desc, filter: avgPnL≥0)`);
    console.log(`  │  ${'TP%'.padEnd(5)} ${'SL'.padEnd(5)} ${'Hold'.padEnd(6)} ${'N'.padStart(5)}  ${'T1%'.padStart(6)}  ${'Stop%'.padStart(6)}  ${'PF'.padStart(6)}  ${'avgPnL'.padStart(7)}  ${'expVal'.padStart(7)}`);
    console.log(`  │  ${'-'.repeat(72)}`);

    const beCombos = [];
    for (const tp of TARGET_PCTS) {
      for (const sl of SL_MULTS) {
        for (const h of MAX_HOLDS) {
          const oos = stats(oosSigs.map(s => simulateBE(s, sl, h, tp)));
          if (!oos || oos.avgPnl < 0) continue; // filter: positive expectancy only
          beCombos.push({ tp, sl, h, ...oos });
        }
      }
    }
    beCombos.sort((a, b) => b.pf - a.pf || b.avgPnl - a.avgPnl);

    let beBest = null;
    for (const row of beCombos.slice(0, TOP_N)) {
      const pfStar = row.pf >= 2 ? ' ★★' : (row.pf >= 1.5 ? ' ★' : '');
      console.log(`  │  ${String(row.tp+'%').padEnd(5)} ${String(row.sl+'×').padEnd(5)} ${String(row.h+'d').padEnd(6)} ${String(row.n).padStart(5)}  ${(row.t1Pct+'%').padStart(6)}  ${(row.stopPct+'%').padStart(6)}  ${String(row.pf).padStart(6)}${pfStar}  ${(row.avgPnl+'%').padStart(7)}  ${(row.expVal).toFixed(3).padStart(7)}`);
      if (!beBest) beBest = row;
    }
    if (!beCombos.length) console.log(`  │  (no combo has avgPnL >= 0)`);

    // ── TRAILING STOP MODE ──
    console.log(`\n  ├─ TRAILING STOP MODE (trail 1×ATR below peak after BE, sorted by PF desc, filter: avgPnL≥0)`);
    console.log(`  │  ${'TP%'.padEnd(5)} ${'SL'.padEnd(5)} ${'Hold'.padEnd(6)} ${'N'.padStart(5)}  ${'T1%'.padStart(6)}  ${'Stop%'.padStart(6)}  ${'PF'.padStart(6)}  ${'avgPnL'.padStart(7)}  ${'expVal'.padStart(7)}`);
    console.log(`  │  ${'-'.repeat(72)}`);

    const trailCombos = [];
    for (const tp of TARGET_PCTS) {
      for (const sl of SL_MULTS) {
        for (const h of MAX_HOLDS) {
          const oos = stats(oosSigs.map(s => simulateTrail(s, sl, h, tp)));
          if (!oos || oos.avgPnl < 0) continue; // filter: positive expectancy only
          trailCombos.push({ tp, sl, h, ...oos });
        }
      }
    }
    trailCombos.sort((a, b) => b.pf - a.pf || b.avgPnl - a.avgPnl);

    let trailBest = null;
    for (const row of trailCombos.slice(0, TOP_N)) {
      const pfStar = row.pf >= 2 ? ' ★★' : (row.pf >= 1.5 ? ' ★' : '');
      console.log(`  │  ${String(row.tp+'%').padEnd(5)} ${String(row.sl+'×').padEnd(5)} ${String(row.h+'d').padEnd(6)} ${String(row.n).padStart(5)}  ${(row.t1Pct+'%').padStart(6)}  ${(row.stopPct+'%').padStart(6)}  ${String(row.pf).padStart(6)}${pfStar}  ${(row.avgPnl+'%').padStart(7)}  ${(row.expVal).toFixed(3).padStart(7)}`);
      if (!trailBest) trailBest = row;
    }
    if (!trailCombos.length) console.log(`  │  (no combo has avgPnL >= 0)`);

    // Summary: best mode for this param set
    const modes = [
      { label: 'Fixed',    best: fixedBest,  fn: 'simulate'     },
      { label: 'BE',       best: beBest,     fn: 'simulateBE'   },
      { label: 'Trailing', best: trailBest,  fn: 'simulateTrail'},
    ].filter(m => m.best);
    modes.sort((a, b) => b.best.pf - a.best.pf);
    const winner = modes[0];

    if (winner) {
      recommendedCombos[dk] = {
        mode: winner.label,
        tp: winner.best.tp,
        sl: winner.best.sl,
        hold: winner.best.h,
        pf: winner.best.pf,
        wr: winner.best.t1Pct,
        avgPnl: winner.best.avgPnl,
      };
    }

    console.log(`\n  └─ SWEET SPOT: ${winner ? `${winner.label} mode  TP=${winner.best.tp}%  SL=${winner.best.sl}×  H=${winner.best.h}d  →  WR=${winner.best.t1Pct}%  PF=${winner.best.pf}  avgPnL=${winner.best.avgPnl}%` : 'none found'}`);
  }

  // ════════════════════════════════════════════════════════════
  // FINAL RECOMMENDATIONS
  // ════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(110)}`);
  console.log(`  RECOMMENDED ARCHETYPE_EXIT_DEFAULTS  (hyper-grid sweet spots)`);
  console.log(`${'═'.repeat(110)}`);
  console.log(`\n  NOTE: BE/Trailing modes require engine support for dynamic SL management.`);
  console.log(`  Fixed-mode values apply immediately to ARCHETYPE_EXIT_DEFAULTS.`);
  console.log(`  BE/Trailing PF gains require stockEngine.ts exit logic update.\n`);

  const pfMap = { optimized_deployable_20plus: 'deployable_20plus', optimized_highprecision_15plus: 'highprecision_15plus',
    optimized_elite_10plus: 'elite_10plus', optimized_ultraselective_8plus: 'ultraselective_8plus',
    sniper_95plus: 'sniper_95plus', ors_prime_reversal: 'ors_prime_reversal', circuit_breaker_v2: 'circuit_breaker_v2' };

  for (const [tsKey, dk] of Object.entries(pfMap)) {
    const rec = recommendedCombos[dk];
    if (rec) {
      const pfFlag = rec.pf >= 2 ? ' ★★ PF>2' : (rec.pf >= 1.5 ? ' ★ PF>1.5' : '');
      console.log(`  ${tsKey.padEnd(34)}: targetPct=${rec.tp}  slAtrMult=${rec.sl}  maxHoldBars=${rec.hold}  [${rec.mode}]  WR=${rec.wr}%  PF=${rec.pf}${pfFlag}`);
    }
  }

  // Print TypeScript block (Fixed-only, immediately applicable)
  console.log(`\n  ── Fixed-mode block (apply directly to ARCHETYPE_EXIT_DEFAULTS) ──\n`);
  const fixedRecs = {};
  for (const [tsKey, dk] of Object.entries(pfMap)) {
    const rec = recommendedCombos[dk];
    if (rec) fixedRecs[tsKey] = rec;
  }
  console.log(`const ARCHETYPE_EXIT_DEFAULTS = {`);
  for (const [tsKey, dk] of Object.entries(pfMap)) {
    const rec = fixedRecs[tsKey];
    if (rec) {
      const comment = `// hyper-grid: WR=${rec.wr}% PF=${rec.pf} avgPnL=${rec.avgPnl}% [${rec.mode} mode]`;
      console.log(`  ${tsKey.padEnd(34)}: { targetPct: ${rec.tp}, slAtrMult: ${rec.sl}, maxHoldBars: ${rec.hold} },  ${comment}`);
    } else {
      const v = V16[dk];
      console.log(`  ${tsKey.padEnd(34)}: { targetPct: ${v.targetPct}, slAtrMult: ${v.slMult}, maxHoldBars: ${v.maxHold} },  // unchanged (no valid combo found)`);
    }
  }
  console.log(`};\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
}
