'use strict';
/**
 * ultra_stop_optimizer.js — Grid-search for optimal stop parameters
 * =================================================================
 * Problem: Current system SR=21.78%, target SR≤19.2% (pre-G3/G8 hardening level).
 * Focus: CircuitBreaker dominates (98.5% of OOS signals).
 *
 * Key insight:
 *   VOLATILE (2.5-3.5%) stocks: cap=5.5% is binding (ATR-stop at ~9% → capped to 5.5%)
 *   HIGH (>3.5%) stocks: rawStop (atrMult×ATR or sw5Low) is typically binding
 *
 * Grid search:
 *   capPct_VOLATILE  ∈ {5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0, 10.0}
 *   capPct_HIGH      ∈ {10.0, 11.0, 12.5, 14.0, 15.0, 16.0, 17.5, 20.0}
 *   atrMult_VOLATILE ∈ {2.5, 3.0, 3.5, 4.0}
 *   atrMult_HIGH     ∈ {1.5, 2.0, 2.5, 3.0}
 *
 * Pass 1: Extract all CB OOS signals with forward bars (from compiled engine)
 * Pass 2: Re-simulate each signal under every grid combination
 * Output: Pareto table + CSV export, sorted by SR ascending
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, workerData, parentPort, isMainThread } = require('worker_threads');

// ── Config ─────────────────────────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OUT_DIR   = path.join(__dirname, 'results');
const OOS_CUT   = new Date('2024-01-01T00:00:00Z').getTime() / 1000;
const WINDOW    = 300;
const MIN_BARS  = WINDOW + 30;
const N_WORKERS = Math.min(os.cpus().length, 8);
const CB_KEY    = 'circuit_breaker_v2';
const W1 = 0.50, W2 = 0.30, W3 = 0.20;

// ── Grid ────────────────────────────────────────────────────────────────────
const GRID_CAP_V  = [5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0, 10.0];
const GRID_CAP_H  = [10.0, 11.0, 12.5, 14.0, 15.0, 16.0, 17.5, 20.0];
const GRID_AMULT_V = [2.5, 3.0, 3.5, 4.0];
const GRID_AMULT_H = [1.5, 2.0, 2.5, 3.0];

// ── Helpers ─────────────────────────────────────────────────────────────────
function tick(p) { return Math.round(p * 20) / 20; }  // 0.05 NSE tick

function atrBand(p) {
  return p < 1.5 ? 'TIGHT' : p < 2.5 ? 'NORMAL' : p < 3.5 ? 'VOLATILE' : 'HIGH';
}

function computeStop(entry, atr14, sw5Low, atrPct, capV, capH, amultV, amultH) {
  const isHigh = atrPct >= 3.5;
  const atrMult  = isHigh ? amultH : amultV;
  const capPct   = atrPct < 1.5 ? 6.0
      : atrPct < 2.5 ? 4.0
      : atrPct < 3.5 ? capV
      : capH;                        // CB has no ORS/VF override for HIGH
  const floorPct = 2.0;              // CB is not MP
  const atrStop  = entry - atrMult * atr14;
  const structStop = sw5Low > 0 ? sw5Low * 0.997 : atrStop;
  const rawStop  = tick(Math.max(0, Math.min(atrStop, structStop)));
  const floorStop = tick(entry * (1 - floorPct / 100));
  const capStop   = tick(entry * (1 - capPct  / 100));
  return Math.min(floorStop, Math.max(capStop, rawStop));
}

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

// ════════════════════════════════════════════════════════════════════════════
// WORKER — Pass 1: Extract CB OOS signals with forward bars
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const engine = require(ENGINE_JS);
  const signals = [];

  for (const fp of workerData.files) {
    let candles;
    try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < MIN_BARS) continue;

    for (let i = WINDOW - 1; i < candles.length - 2; i++) {
      const bar = candles[i];
      if (!bar || bar.c <= 0) continue;
      if (bar.ts < OOS_CUT) continue;  // OOS only

      const w = candles.slice(i - WINDOW + 1, i + 1);
      let r;
      try { r = engine.analyzeStock(w, CB_KEY, false); } catch { continue; }
      if (!r) continue;

      const stg = r.stage;
      if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;

      const pe = r.priceEngine;
      if (!pe || !pe.tradeValid || pe.tacticalStop <= 0 || pe.target5 <= pe.plannedEntry) continue;

      const entry    = pe.plannedEntry;
      const atr14    = pe.atr14AtEntry || 0;
      const sw5Low   = pe.sw5LowAtEntry || 0;
      const atrPct   = atr14 > 0 ? atr14 / entry * 100 : r.atrPct || 2;
      const band     = atrBand(atrPct);

      // T1/T2/T3 are fixed (don't change with stop)
      const t1 = pe.target5, t2 = pe.target7, t3 = pe.target10;
      const maxHold  = pe.maxHoldBars || 20;
      const stageName = stg === 'ULTRA_STRONG_BUY' ? 'ULTRA' : stg === 'STRONG_BUY' ? 'STRONG' : 'BUY';

      // Store forward bars
      const entryIdx = i + 1;
      const endIdx   = Math.min(candles.length - 1, entryIdx + maxHold);
      if (entryIdx >= candles.length) continue;

      const fwdBars = [];
      for (let j = entryIdx; j <= endIdx; j++) {
        if (!candles[j]) break;
        fwdBars.push({ o: candles[j].o, h: candles[j].h, l: candles[j].l, c: candles[j].c });
      }
      if (!fwdBars.length) continue;

      signals.push({
        stage: stageName,
        band,
        entry,
        atr14,
        sw5Low,
        atrPct,
        t1, t2, t3,
        maxHold,
        fwdBars,
      });
    }
  }

  parentPort.postMessage({ signals });
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN — Orchestration
// ════════════════════════════════════════════════════════════════════════════

// ── Simulation (single signal, given a stop price) ──────────────────────────
function simulateTrade(sig, stop) {
  const { entry, t1, t2, t3, fwdBars } = sig;
  const riskAbs = Math.max(entry * 0.01, entry - stop);
  if (riskAbs <= 0) return null;

  let phase = 1, weightLeft = 1.0, weightedPL = 0;
  let stopHit = false, t1Hit = false, t2Hit = false, t3Hit = false;

  for (let j = 0; j < fwdBars.length; j++) {
    const b = fwdBars[j];

    // Gap-down at open
    if (j === 0 && b.o < stop) {
      weightedPL = -((entry - b.o) / entry * 100);
      stopHit = true;
      break;
    }

    if (phase === 1) {
      if (b.l <= stop) {
        weightedPL -= (entry - stop) / entry * 100;
        stopHit = true;
        break;
      }
      if (b.h >= t1) {
        weightedPL += W1 * (t1 - entry) / entry * 100;
        weightLeft = W2 + W3;
        t1Hit = true;
        phase = 2;
      }
    }
    if (phase === 2) {
      if (b.l <= stop) {
        weightedPL -= weightLeft * (entry - stop) / entry * 100;
        break;
      }
      if (b.h >= t2) {
        weightedPL += W2 * (t2 - entry) / entry * 100;
        weightLeft = W3;
        t2Hit = true;
        phase = 3;
      }
    }
    if (phase === 3) {
      if (b.l <= stop) {
        weightedPL -= weightLeft * (entry - stop) / entry * 100;
        break;
      }
      if (b.h >= t3) {
        weightedPL += W3 * (t3 - entry) / entry * 100;
        weightLeft = 0;
        t3Hit = true;
        break;
      }
    }

    // Time stop
    if (j === fwdBars.length - 1 && weightLeft > 0) {
      weightedPL += weightLeft * (b.c - entry) / entry * 100;
    }
  }

  const exitR = weightedPL / ((entry - stop) / entry * 100);
  return {
    pl: weightedPL,
    r: exitR,
    win: weightedPL > 0,
    stop: stopHit && !t1Hit,
    t1: t1Hit,
    t2: t2Hit,
    t3: t3Hit,
  };
}

// ── Cell accumulator ──────────────────────────────────────────────────────
function newCell() { return { n:0, nStop:0, nWin:0, nT1:0, nT2:0, nT3:0, sumR:0, sumPL:0 }; }
function addResult(cell, res) {
  if (!res) return;
  cell.n++;
  if (res.stop) cell.nStop++;
  if (res.win)  cell.nWin++;
  if (res.t1)   cell.nT1++;
  if (res.t2)   cell.nT2++;
  if (res.t3)   cell.nT3++;
  cell.sumR  += res.r;
  cell.sumPL += res.pl;
}
function cellStats(c) {
  if (!c.n) return null;
  return {
    n:    c.n,
    wr:   +(c.nWin / c.n * 100).toFixed(2),
    sr:   +(c.nStop / c.n * 100).toFixed(2),
    t1r:  +(c.nT1  / c.n * 100).toFixed(2),
    t2r:  +(c.nT2  / c.n * 100).toFixed(2),
    t3r:  +(c.nT3  / c.n * 100).toFixed(2),
    avgR: +(c.sumR  / c.n).toFixed(4),
    avgPL:+(c.sumPL / c.n).toFixed(4),
  };
}

// ── Candidate key ────────────────────────────────────────────────────────
function candKey(capV, capH, amV, amH) {
  return `v${capV}_h${capH}_mv${amV}_mh${amH}`;
}

// ── Run grid search on collected signals ─────────────────────────────────
function runGridSearch(allSignals) {
  // For each (capV, capH, amV, amH) combination, simulate all signals
  // Accumulate per-stage×band metrics

  const STAGES = ['BUY', 'STRONG', 'ULTRA'];
  const BANDS  = ['TIGHT', 'NORMAL', 'VOLATILE', 'HIGH'];

  const totalCombos = GRID_CAP_V.length * GRID_CAP_H.length * GRID_AMULT_V.length * GRID_AMULT_H.length;
  console.log(`Grid search: ${totalCombos} combinations × ${allSignals.length} signals`);

  // Baseline: use current production params  (capV=5.5, capH=12.5, amV=3.0, amH=2.0)
  const BASELINE = { capV: 5.5, capH: 12.5, amV: 3.0, amH: 2.0 };

  // Results map: key → per-stage×band cells
  const results = new Map();

  let done = 0;
  for (const capV of GRID_CAP_V) {
    for (const capH of GRID_CAP_H) {
      for (const amV of GRID_AMULT_V) {
        for (const amH of GRID_AMULT_H) {
          const key = candKey(capV, capH, amV, amH);
          const cells = {};
          for (const st of STAGES) {
            cells[st] = {};
            for (const bd of BANDS) cells[st][bd] = newCell();
          }

          for (const sig of allSignals) {
            const stop = computeStop(
              sig.entry, sig.atr14, sig.sw5Low, sig.atrPct,
              capV, capH, amV, amH
            );
            if (stop <= 0 || stop >= sig.entry) continue;
            const res = simulateTrade(sig, stop);
            addResult(cells[sig.stage][sig.band], res);
          }

          results.set(key, { capV, capH, amV, amH, cells });
          done++;
          if (done % 50 === 0) process.stdout.write(`\r  progress: ${done}/${totalCombos}`);
        }
      }
    }
  }
  console.log(`\r  done: ${totalCombos}/${totalCombos}            `);
  return results;
}

// ── Build summary row for a result ──────────────────────────────────────
function buildRow(params, cells) {
  const { capV, capH, amV, amH } = params;
  // Overall weighted aggregation
  let tn=0, tStop=0, tWin=0, tT1=0, tT2=0, tR=0, tPL=0;
  const byCell = {};

  for (const [st, bands] of Object.entries(cells)) {
    byCell[st] = {};
    for (const [bd, c] of Object.entries(bands)) {
      const s = cellStats(c);
      byCell[st][bd] = s;
      if (s) {
        tn    += s.n;
        tStop += c.nStop;
        tWin  += c.nWin;
        tT1   += c.nT1;
        tT2   += c.nT2;
        tR    += c.sumR;
        tPL   += c.sumPL;
      }
    }
  }

  const row = {
    capV, capH, amV, amH,
    n:    tn,
    wr:   tn ? +(tWin  / tn * 100).toFixed(2) : 0,
    sr:   tn ? +(tStop / tn * 100).toFixed(2) : 0,
    t1r:  tn ? +(tT1   / tn * 100).toFixed(2) : 0,
    t2r:  tn ? +(tT2   / tn * 100).toFixed(2) : 0,
    avgR: tn ? +(tR    / tn).toFixed(4) : 0,
    avgPL:tn ? +(tPL   / tn).toFixed(4) : 0,
    cells: byCell,
  };
  return row;
}

// ── Find sweet spot ──────────────────────────────────────────────────────
function findSweetSpot(rows, targetSR = 19.2, minWR = 68.0) {
  const candidates = rows
    .filter(r => r.sr <= targetSR && r.wr >= minWR)
    .sort((a, b) => b.avgR - a.avgR);  // sort by AvgR descending
  return candidates.slice(0, 20);
}

// ── Pareto frontier ──────────────────────────────────────────────────────
function paretoFrontier(rows) {
  // Sort by SR ascending, keep only rows that improve WR as SR increases
  const sorted = [...rows].sort((a, b) => a.sr - b.sr);
  const frontier = [];
  let bestWR = -Infinity;
  for (const r of sorted) {
    if (r.wr > bestWR) {
      bestWR = r.wr;
      frontier.push(r);
    }
  }
  return frontier;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const csvFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(f => path.join(DATA_DIR, f));

  console.log(`Ultra Stop Optimizer — ${csvFiles.length} symbols, ${N_WORKERS} workers`);
  console.log(`OOS cut: 2024-01-01 | Grid: ${GRID_CAP_V.length}×${GRID_CAP_H.length}×${GRID_AMULT_V.length}×${GRID_AMULT_H.length} = ${GRID_CAP_V.length*GRID_CAP_H.length*GRID_AMULT_V.length*GRID_AMULT_H.length} combos`);

  // ── Pass 1: Extract CB OOS signals ─────────────────────────────────────
  console.log('\nPass 1: Extracting CB OOS signals...');
  const chunks = Array.from({ length: N_WORKERS }, (_, i) =>
    csvFiles.filter((_, j) => j % N_WORKERS === i));

  const allSignals = await new Promise((resolve, reject) => {
    let done = 0;
    let merged = [];
    for (const chunk of chunks) {
      const w = new Worker(__filename, { workerData: { files: chunk } });
      w.on('message', ({ signals }) => {
        merged = merged.concat(signals);
        done++;
        process.stdout.write(`\r  workers done: ${done}/${N_WORKERS}`);
        if (done === N_WORKERS) { console.log(''); resolve(merged); }
      });
      w.on('error', reject);
    }
  });

  // OOS only (workers already filtered, but double-check)
  const oosSigs = allSignals; // all from workers are OOS
  console.log(`  CB OOS signals: ${oosSigs.length}`);

  // Band distribution
  const bandCounts = {};
  for (const s of oosSigs) bandCounts[s.band] = (bandCounts[s.band] || 0) + 1;
  console.log('  Band counts:', bandCounts);
  const stageCounts = {};
  for (const s of oosSigs) stageCounts[s.stage] = (stageCounts[s.stage] || 0) + 1;
  console.log('  Stage counts:', stageCounts);

  if (!oosSigs.length) {
    console.error('No OOS signals found. Check OOS_CUT and data path.');
    process.exit(1);
  }

  // ── Pass 2: Grid search ─────────────────────────────────────────────────
  console.log('\nPass 2: Grid search...');
  const resultsMap = runGridSearch(oosSigs);

  // Build rows array
  const rows = [];
  for (const [, entry] of resultsMap) {
    rows.push(buildRow(entry, entry.cells));
  }

  // ── Analysis ────────────────────────────────────────────────────────────
  const baseline = rows.find(r => r.capV === 5.5 && r.capH === 12.5 && r.amV === 3.0 && r.amH === 2.0);
  if (baseline) {
    console.log(`\nBaseline (current): WR=${baseline.wr}%  SR=${baseline.sr}%  AvgR=${baseline.avgR}  N=${baseline.n}`);
  }

  const sweetSpots = findSweetSpot(rows, 19.2, 68.0);
  console.log(`\nSweet spots (SR≤19.2%, WR≥68%, ranked by AvgR): ${sweetSpots.length} found`);
  console.log('  capV  capH  amV  amH  |  N     WR     SR     T1r    T2r    AvgR    AvgPL');
  console.log('  ' + '-'.repeat(75));
  for (const r of sweetSpots.slice(0, 15)) {
    console.log(`  ${r.capV.toString().padStart(5)} ${r.capH.toString().padStart(5)} ${r.amV.toString().padStart(4)} ${r.amH.toString().padStart(4)}  | ` +
      `${r.n.toString().padStart(6)} ${r.wr.toFixed(1).padStart(6)}% ${r.sr.toFixed(1).padStart(5)}% ${r.t1r.toFixed(1).padStart(6)}% ${r.t2r.toFixed(1).padStart(6)}%  ${r.avgR.toFixed(3).padStart(6)}  ${r.avgPL.toFixed(3).padStart(7)}`);
  }

  const pareto = paretoFrontier(rows);
  console.log(`\nPareto frontier (best WR at each SR level): ${pareto.length} points`);
  console.log('  capV  capH  amV  amH  |  SR     WR     AvgR');
  for (const r of pareto.slice(0, 20)) {
    const marker = r.sr <= 19.2 ? ' ◄ TARGET' : '';
    console.log(`  ${r.capV.toString().padStart(5)} ${r.capH.toString().padStart(5)} ${r.amV.toString().padStart(4)} ${r.amH.toString().padStart(4)}  | ` +
      `${r.sr.toFixed(1).padStart(5)}%  ${r.wr.toFixed(1).padStart(6)}%  ${r.avgR.toFixed(3).padStart(6)}${marker}`);
  }

  // ── Detailed breakdown for best sweet spot ───────────────────────────
  if (sweetSpots.length > 0) {
    const best = sweetSpots[0];
    console.log(`\n═══ Best sweet spot detail: capV=${best.capV}% capH=${best.capH}% amV=${best.amV}× amH=${best.amH}× ═══`);
    console.log('  Stage  | Band     |   N  |  WR%  | SR%   | T1r%  | T2r%  | AvgR');
    console.log('  ' + '-'.repeat(75));
    for (const [st, bands] of Object.entries(best.cells)) {
      for (const [bd, s] of Object.entries(bands)) {
        if (s && s.n >= 10) {
          console.log(`  ${st.padEnd(6)} | ${bd.padEnd(8)} | ${s.n.toString().padStart(5)} | ${s.wr.toFixed(1).padStart(5)}% | ${s.sr.toFixed(1).padStart(5)}% | ${s.t1r.toFixed(1).padStart(5)}% | ${s.t2r.toFixed(1).padStart(5)}% | ${s.avgR.toFixed(3).padStart(6)}`);
        }
      }
    }
  }

  // ── Save full results ────────────────────────────────────────────────────
  const ts = new Date().toISOString().slice(0, 19).replace('T', 'T').replace(/:/g, '-');
  const outPath = path.join(OUT_DIR, `ultra_stop_optimizer_${ts}.json`);

  // Truncate cells in rows to save space (keep only summary)
  const rowsSummary = rows.map(r => ({
    capV: r.capV, capH: r.capH, amV: r.amV, amH: r.amH,
    n: r.n, wr: r.wr, sr: r.sr, t1r: r.t1r, t2r: r.t2r,
    avgR: r.avgR, avgPL: r.avgPL,
    // Per-cell breakdown only for the top 20 by AvgR
  }));

  // Full detail for sweet spots
  const fullOutput = {
    generated:   new Date().toISOString(),
    baseline:    baseline ? { wr: baseline.wr, sr: baseline.sr, avgR: baseline.avgR, n: baseline.n } : null,
    targetSR:    19.2,
    nSignals:    oosSigs.length,
    bandCounts,
    stageCounts,
    sweetSpots:  sweetSpots.slice(0, 20).map(r => ({
      params: { capV: r.capV, capH: r.capH, amV: r.amV, amH: r.amH },
      overall: { n: r.n, wr: r.wr, sr: r.sr, t1r: r.t1r, t2r: r.t2r, avgR: r.avgR, avgPL: r.avgPL },
      byStageAndBand: r.cells,
    })),
    paretoFrontier: pareto.map(r => ({
      params: { capV: r.capV, capH: r.capH, amV: r.amV, amH: r.amH },
      n: r.n, wr: r.wr, sr: r.sr, avgR: r.avgR,
    })),
    allRows: rowsSummary.sort((a, b) => a.sr - b.sr),
  };

  fs.writeFileSync(outPath, JSON.stringify(fullOutput, null, 2));
  console.log(`\n✓ Results saved → ${outPath}`);

  // ── CSV for spreadsheet analysis ─────────────────────────────────────
  const csvPath = outPath.replace('.json', '.csv');
  const csvLines = ['capV,capH,amV,amH,n,wr,sr,t1r,t2r,avgR,avgPL'];
  for (const r of rowsSummary.sort((a, b) => a.sr - b.sr)) {
    csvLines.push(`${r.capV},${r.capH},${r.amV},${r.amH},${r.n},${r.wr},${r.sr},${r.t1r},${r.t2r},${r.avgR},${r.avgPL}`);
  }
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`✓ CSV saved    → ${csvPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
