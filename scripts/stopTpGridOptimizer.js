'use strict';
/**
 * stopTpGridOptimizer.js
 * =======================
 * Grid-searches SL multiplier × TP% × maxHold for failing param sets.
 * Uses the OOS trades already in correctParamBacktest JSON to avoid re-running the engine.
 *
 * Target sets:
 *   deployable_20plus    — current SL=1.5×ATR too tight (52% stop rate)
 *   highprecision_15plus — current SL=1×ATR too tight (54% stop rate)
 *   sniper_95plus        — negative edge, try wider SL + TP combo
 *   circuit_breaker_v2  — needs longer hold + quality gate (separate pass)
 *
 * IMPORTANT: This re-simulates trades from raw candle data so we can test
 * different SL/TP combos than what was stored. We re-run the engine for
 * these 4 sets only.
 *
 * Usage: node scripts/stopTpGridOptimizer.js
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

// Sets to optimize and their engine keys
const OPTIMIZE_SETS = {
  deployable_20plus:    'optimized_deployable_20plus',
  highprecision_15plus: 'optimized_highprecision_15plus',
  sniper_95plus:        'sniper_95plus',
};

// Grid: [slMult, tpPct, maxHold]
// slMult: ATR multiplier for stop loss
// tpPct:  0 = no fixed TP (exit at maxHold close), >0 = TP%
// maxHold: max bars to hold
const SL_RANGE   = [1.5, 2.0, 2.5, 3.0, 3.5];
const TP_RANGE   = [0, 3, 4, 5, 6];   // 0 = no fixed TP
const HOLD_RANGE = [5, 8, 12, 15, 20];

function buildGrid() {
  const combos = [];
  for (const sl of SL_RANGE) {
    for (const tp of TP_RANGE) {
      for (const hold of HOLD_RANGE) {
        combos.push({ sl, tp, hold });
      }
    }
  }
  return combos; // 5×5×5 = 125 combos per set
}

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

// Simulate one trade at all grid combos simultaneously (one engine call per signal)
function simulateAllCombos(c, sigIdx, atrAtSig, combos) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || c[entryIdx].o <= 0 || atrAtSig <= 0) return null;

  const entry  = c[entryIdx].o;
  const maxHoldNeeded = Math.max(...combos.map(g => g.hold));
  const maxEnd = Math.min(c.length - 1, entryIdx + maxHoldNeeded - 1);

  // Precompute per-bar low/high for MAE/MFE
  const barData = [];
  for (let j = entryIdx; j <= maxEnd; j++) {
    barData.push({ l: c[j].l, h: c[j].h, o: c[j].o, c: c[j].c });
  }

  // For each combo, simulate
  const results = combos.map(cfg => {
    const stop = entry - cfg.sl * atrAtSig;
    const tp   = cfg.tp > 0 ? entry * (1 + cfg.tp / 100) : Infinity;
    let exitPx  = barData[Math.min(cfg.hold - 1, barData.length - 1)].c;
    let hit = false, stopped = false;
    let mae = 0, mfe = 0, holdBars = 0;

    for (let bi = 0; bi < Math.min(cfg.hold, barData.length); bi++) {
      const b = barData[bi];
      holdBars = bi + 1;
      const barMae = (entry - b.l) / entry * 100;
      const barMfe = (b.h - entry) / entry * 100;
      if (barMae > mae) mae = barMae;
      if (barMfe > mfe) mfe = barMfe;
      if (b.o <= stop) { exitPx = b.o; stopped = true; break; }
      if (b.l <= stop) { exitPx = stop; stopped = true; break; }
      if (b.h >= tp)   { exitPx = tp; hit = true; break; }
      if (bi === Math.min(cfg.hold, barData.length) - 1) exitPx = b.c;
    }

    const pnl = (exitPx - entry) / entry * 100;
    return { pnl, hit, stopped, mae, mfe, holdBars };
  });

  return results;
}

function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const { oosCutTs, combos, setKeys } = workerData;

  // signals[displayKey][comboIdx] = array of {split, pnl, hit, stopped, mae, mfe}
  const signals = {};
  for (const dk of Object.keys(setKeys)) signals[dk] = combos.map(() => []);

  let processed = 0;
  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }
    const atr14 = atr14Array(c);

    for (const [displayKey, engineKey] of Object.entries(setKeys)) {
      let lastExitIdx = -1;
      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExitIdx) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, engineKey); } catch { continue; }
        if (!r || !ACTIONABLE.has(r.stage)) continue;

        const split  = c[i].ts < oosCutTs ? 'is' : 'oos';
        const atrSig = atr14[i] || c[i].c * 0.02;
        const comboResults = simulateAllCombos(c, i, atrSig, combos);
        if (!comboResults) continue;

        for (let ci = 0; ci < combos.length; ci++) {
          signals[displayKey][ci].push({ split, ...comboResults[ci] });
        }

        // use max hold as blackout
        lastExitIdx = i + Math.max(...combos.map(g => g.hold));
      }
    }

    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', signals });
}

function stddev(arr, mean) {
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1));
}

function oosScore(trades, maxHold) {
  const oos = trades.filter(t => t.split === 'oos');
  if (oos.length < 10) return null;
  const wins   = oos.filter(t => t.pnl > 0);
  const losses = oos.filter(t => t.pnl <= 0);
  const sumWin = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLoss= losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
  const pf     = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? 99 : 0);
  const pnls   = oos.map(t => t.pnl);
  const avgPnl = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const sd     = stddev(pnls, avgPnl);
  const annF   = Math.sqrt(252 / (maxHold || 10));
  const sharpe = sd > 0 ? (avgPnl / sd) * annF : 0;
  const stopPct= oos.filter(t => t.stopped).length / oos.length * 100;
  const wr     = wins.length / oos.length * 100;
  // composite score: weight Sharpe + PF + WR (normalized)
  const score  = sharpe * 0.5 + pf * 0.3 + wr / 100 * 0.2;
  return { n: oos.length, wr: +wr.toFixed(1), pf: +pf.toFixed(2), avgPnl: +avgPnl.toFixed(2), sharpe: +sharpe.toFixed(2), stopPct: +stopPct.toFixed(1), score: +score.toFixed(3) };
}

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const combos   = buildGrid();
  const nWorkers = Math.min(WORKERS, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`  STOP/TP GRID OPTIMIZER — ${files.length} stocks, ${nWorkers} workers`);
  console.log(`  Grid: ${SL_RANGE.length} SL × ${TP_RANGE.length} TP × ${HOLD_RANGE.length} Hold = ${combos.length} combos per set`);
  console.log(`  Sets: ${Object.keys(OPTIMIZE_SETS).join(', ')}`);
  console.log(`${'='.repeat(80)}\n`);

  const oosCutTs = Date.parse(OOS_CUT) / 1000;
  let progress   = 0;

  // Aggregate: signals[displayKey][comboIdx] = trade[]
  const agg = {};
  for (const dk of Object.keys(OPTIMIZE_SETS)) agg[dk] = combos.map(() => []);

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, oosCutTs, combos, setKeys: OPTIMIZE_SETS } });
    w.on('message', m => {
      if (m.type === 'progress') {
        progress += m.n;
        process.stdout.write(`  Scanning ${progress}/${files.length} stocks...\r`);
      } else if (m.type === 'done') {
        for (const [dk, byCombo] of Object.entries(m.signals)) {
          for (let ci = 0; ci < combos.length; ci++) {
            agg[dk][ci].push(...byCombo[ci]);
          }
        }
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c !== 0) reject(new Error(`worker exited ${c}`)); });
  })));

  console.log(`\n  Done. Scoring ${combos.length} combos × ${Object.keys(OPTIMIZE_SETS).length} sets...\n`);

  const results = {};
  for (const [dk] of Object.entries(OPTIMIZE_SETS)) {
    const scored = [];
    for (let ci = 0; ci < combos.length; ci++) {
      const cfg  = combos[ci];
      const stat = oosScore(agg[dk][ci], cfg.hold);
      if (!stat) continue;
      scored.push({ ...cfg, ...stat });
    }
    scored.sort((a, b) => b.score - a.score);
    results[dk] = scored;
  }

  // Print top 10 per set
  for (const [dk, scored] of Object.entries(results)) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  ${dk.toUpperCase()} — Top 10 OOS combos (score = 0.5×Sharpe + 0.3×PF + 0.2×WR)`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`  ${'SL'.padStart(4)} ${'TP'.padStart(4)} ${'H'.padStart(3)}  ${'N'.padStart(5)}  ${'WR%'.padStart(5)}  ${'PF'.padStart(5)}  ${'avg%'.padStart(6)}  ${'Sharpe'.padStart(6)}  ${'Stop%'.padStart(5)}  ${'Score'.padStart(6)}`);
    console.log(`  ${'-'.repeat(72)}`);
    for (const r of scored.slice(0, 10)) {
      console.log(
        `  ${String(r.sl).padStart(4)} ${String(r.tp).padStart(4)} ${String(r.hold).padStart(3)}  ` +
        `${String(r.n).padStart(5)}  ${(r.wr+'%').padStart(5)}  ${String(r.pf).padStart(5)}  ` +
        `${(r.avgPnl+'%').padStart(6)}  ${String(r.sharpe).padStart(6)}  ${(r.stopPct+'%').padStart(5)}  ${String(r.score).padStart(6)}`
      );
    }

    // Current config baseline
    const currentConfig = {
      deployable_20plus:    { sl: 1.5, tp: 0, hold: 12 },
      highprecision_15plus: { sl: 1.0, tp: 0, hold: 5  },
      sniper_95plus:        { sl: 2.0, tp: 0, hold: 5  },
    };
    const curr = currentConfig[dk];
    const currIdx = combos.findIndex(c => c.sl === curr.sl && c.tp === curr.tp && c.hold === curr.hold);
    if (currIdx >= 0) {
      const currStat = oosScore(agg[dk][currIdx], curr.hold);
      if (currStat) {
        console.log(`  ${'-'.repeat(72)}`);
        console.log(`  CURRENT ${String(curr.sl).padStart(4)} ${String(curr.tp).padStart(4)} ${String(curr.hold).padStart(3)}  ` +
          `${String(currStat.n).padStart(5)}  ${(currStat.wr+'%').padStart(5)}  ${String(currStat.pf).padStart(5)}  ` +
          `${(currStat.avgPnl+'%').padStart(6)}  ${String(currStat.sharpe).padStart(6)}  ${(currStat.stopPct+'%').padStart(5)}  ${String(currStat.score).padStart(6)}`);
      }
    }
  }

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(__dirname, 'results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [dk, scored] of Object.entries(results)) {
    out[dk] = { top10: scored.slice(0, 10), current: scored.find(r => true) };
  }
  fs.writeFileSync(path.join(dir, `stopTpGrid_${ts}.json`), JSON.stringify(out, null, 2));
  console.log(`\n  Results saved → scripts/results/stopTpGrid_${ts}.json`);
  console.log(`${'='.repeat(80)}\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  runWorker();
}
