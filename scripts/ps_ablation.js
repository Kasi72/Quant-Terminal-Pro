'use strict';
/**
 * PS (PerfectStorm / sniper_95plus) Ablation Study
 *
 * Removes one condition at a time (relaxes to pass-all) and measures
 * OOS impact. A condition that improves OOS WR/avgPnL when removed
 * is noise-fit and should be redesigned or dropped.
 *
 * Conditions tested (from sniper_95plus param set):
 *   minExactVolVsPre5: 3.5   — signal vol ≥ 3.5× pre-5 avg (defining filter)
 *   maxPre10HighVolCount: 0  — zero high-vol bars allowed in pre-10
 *   maxATRPct14Pctl120: 40   — ATR pctl ≤ 40% (tight compression)
 *   maxPre10AvgVolRatio: 0.9 — pre-10 vol ≤ 90% of 20d avg (vol quiet)
 *   maxUpperWickPct: 15      — upper wick ≤ 15%
 *   minCloseLoc: 65          — close in top 35% of range
 *   maxPre5AvgVolRatio: 1.1  — pre-5 vol ≤ 1.1× (recent quiet)
 *   maxZoneTightnessPct: 12  — zone tightness ≤ 12%
 *   maxPre10ExpansionCount:1 — max 1 expansion bar in pre-10
 *   minRSI2: 50              — RSI2 ≥ 50 (not deeply oversold)
 *   maxCloseAboveZonePct:5.0 — close ≤ 5% above zone high
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OOS_CUT    = '2025-01-01';
const PARAM_KEY  = 'sniper_95plus';
const TP_PCT     = 5;
const SL_ATR     = 4.0;
const MAX_HOLD   = 20;
const MIN_BARS   = 150;
const WINDOW     = 300;
const WORKERS    = Number(process.env.WORKERS || 10);
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// Each ablation relaxes exactly one condition to pass-all
// field=null = base (no change)
const ABLATIONS = [
  { id: 'BASE',         label: 'Base PS (no change)',                      field: null,                     value: null  },
  { id: 'ABL_VOLPRE5',  label: 'Relax minExactVolVsPre5  3.5 → 1.0',      field: 'minExactVolVsPre5',      value: 1.0   },
  { id: 'ABL_HIGHVOL',  label: 'Relax maxPre10HighVolCount  0 → 3',        field: 'maxPre10HighVolCount',   value: 3     },
  { id: 'ABL_ATRPCTL',  label: 'Relax maxATRPct14Pctl120  40 → 100',       field: 'maxATRPct14Pctl120',     value: 100   },
  { id: 'ABL_VOLRATIO', label: 'Relax maxPre10AvgVolRatio  0.9 → 2.0',     field: 'maxPre10AvgVolRatio',    value: 2.0   },
  { id: 'ABL_WICK',     label: 'Relax maxUpperWickPct  15 → 50',           field: 'maxUpperWickPct',        value: 50    },
  { id: 'ABL_CLOSELOC', label: 'Relax minCloseLoc  65 → 0',                field: 'minCloseLoc',            value: 0     },
  { id: 'ABL_PRE5VOL',  label: 'Relax maxPre5AvgVolRatio  1.1 → 2.0',     field: 'maxPre5AvgVolRatio',     value: 2.0   },
  { id: 'ABL_ZONE',     label: 'Relax maxZoneTightnessPct  12 → 30',       field: 'maxZoneTightnessPct',    value: 30    },
  { id: 'ABL_EXPCOUNT', label: 'Relax maxPre10ExpansionCount  1 → 5',      field: 'maxPre10ExpansionCount', value: 5     },
  { id: 'ABL_RSI2',     label: 'Relax minRSI2  50 → 0',                    field: 'minRSI2',                value: 0     },
  { id: 'ABL_ZONE2',    label: 'Relax maxCloseAboveZonePct  5 → 15',       field: 'maxCloseAboveZonePct',   value: 15    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
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
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i-1] * 13 + tr[i]) / 14;
  return out;
}

function simTrade(entry, bars, atrAtSig) {
  const tp   = entry * (1 + TP_PCT / 100);
  const stop = entry - SL_ATR * atrAtSig;
  for (let j = 0; j < bars.length; j++) {
    const b = bars[j];
    if (b.o <= stop) return { pnl: (b.o - entry) / entry * 100, hit: false };
    if (b.l <= stop) return { pnl: (stop - entry) / entry * 100, hit: false };
    if (b.h >= tp)   return { pnl: TP_PCT, hit: true };
    if (j === bars.length - 1) return { pnl: (b.c - entry) / entry * 100, hit: false };
  }
  return { pnl: (bars[bars.length - 1].c - entry) / entry * 100, hit: false };
}

// ── Worker ───────────────────────────────────────────────────────────────────

function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));

  // Apply the ablation override to the engine's PARAM_SETS
  const { override } = workerData;
  const originalValue = override.field != null
    ? engine.PARAM_SETS[PARAM_KEY][override.field]
    : null;
  if (override.field != null) {
    engine.PARAM_SETS[PARAM_KEY][override.field] = override.value;
  }

  const oosCutTs = workerData.oosCutTs;
  const trades = [];
  let processed = 0;

  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }

    const atr14 = atr14Array(c);
    let lastExitIdx = -1;

    for (let i = WINDOW - 1; i < c.length - 1; i++) {
      if (i <= lastExitIdx) continue;
      const w = c.slice(i - WINDOW + 1, i + 1);
      let r;
      try { r = engine.analyzeStock(w, PARAM_KEY); } catch { continue; }
      if (!r || !ACTIONABLE.has(r.stage)) continue;

      const entryIdx = i + 1;
      if (entryIdx >= c.length || c[entryIdx].o <= 0) continue;

      const entry   = c[entryIdx].o;
      const atrSig  = atr14[i] || c[i].c * 0.02;
      const maxEnd  = Math.min(c.length - 1, entryIdx + MAX_HOLD - 1);
      const bars    = [];
      for (let j = entryIdx; j <= maxEnd; j++) bars.push(c[j]);

      const split  = c[i].ts < oosCutTs ? 'is' : 'oos';
      const result = simTrade(entry, bars, atrSig);

      trades.push({ split, pnl: result.pnl, hit: result.hit });
      lastExitIdx = entryIdx + bars.length - 1;
    }

    processed++;
    if (processed % 50 === 0) parentPort.postMessage({ type: 'progress', n: 50 });
  }

  // Restore original (just good practice even though workers exit)
  if (override.field != null) engine.PARAM_SETS[PARAM_KEY][override.field] = originalValue;

  parentPort.postMessage({ type: 'done', trades });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function wilsonLower(wins, n, z = 1.96) {
  if (n === 0) return 0;
  const p = wins / n;
  const denom = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return ((centre - spread) / denom) * 100;
}

function mkAcc() { return { n: 0, wins: 0, sumPnl: 0, sumWin: 0, sumLoss: 0 }; }

function addTrade(acc, pnl, hit) {
  acc.n++;
  acc.sumPnl += pnl;
  if (hit) { acc.wins++; acc.sumWin += pnl; }
  else      { acc.sumLoss += Math.abs(pnl); }
}

function summarize(acc) {
  const { n, wins, sumPnl, sumWin, sumLoss } = acc;
  if (n === 0) return { n: 0, wr: 0, avg: 0, pf: 0, wils: 0 };
  return {
    n,
    wr:   wins / n * 100,
    avg:  sumPnl / n,
    pf:   sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? 999 : 0,
    wils: wilsonLower(wins, n),
  };
}

// ── Run one ablation ──────────────────────────────────────────────────────────

function runAblation(files, oosCutTs, ablation) {
  return new Promise((resolve, reject) => {
    const nWorkers = Math.min(WORKERS, files.length);
    const chunks = Array.from({ length: nWorkers }, () => []);
    files.forEach((f, i) => chunks[i % nWorkers].push(f));

    const allTrades = [];
    let done = 0;

    const workers = chunks.map(chunk => {
      const w = new Worker(__filename, {
        workerData: {
          files: chunk,
          oosCutTs,
          override: { field: ablation.field, value: ablation.value },
        },
      });
      w.on('message', m => {
        if (m.type === 'progress') {
          done += m.n;
          process.stdout.write(`  [${ablation.id.padEnd(12)}] ${done}/${files.length}\r`);
        } else if (m.type === 'done') {
          allTrades.push(...m.trades);
        }
      });
      w.on('error', reject);
      return new Promise((res, rej) => {
        w.on('exit', c => { if (c && c !== 0) rej(new Error(`worker exited ${c}`)); else res(); });
      });
    });

    Promise.all(workers).then(() => {
      const isAcc  = mkAcc();
      const oosAcc = mkAcc();
      for (const t of allTrades) {
        if (t.split === 'is')  addTrade(isAcc,  t.pnl, t.hit);
        else                   addTrade(oosAcc, t.pnl, t.hit);
      }
      resolve({ is: summarize(isAcc), oos: summarize(oosAcc) });
    }).catch(reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const oosCutTs = Date.parse(OOS_CUT) / 1000;

  console.log(`\nPS ABLATION STUDY — ${files.length} stocks · ${WORKERS} workers`);
  console.log(`Param: ${PARAM_KEY} · TP=${TP_PCT}% · SL=${SL_ATR}×ATR · HOLD=${MAX_HOLD}bars · OOS_CUT=${OOS_CUT}`);
  console.log(`Ablations: ${ABLATIONS.length} variants (base + ${ABLATIONS.length - 1} condition removals)\n`);

  const results = [];
  for (const abl of ABLATIONS) {
    process.stdout.write(`\nRunning [${abl.id}]: ${abl.label}\n`);
    const res = await runAblation(files, oosCutTs, abl);
    results.push({ abl, ...res });
    process.stdout.write(`  Done. OOS: n=${res.oos.n}  WR=${res.oos.wr.toFixed(1)}%  Avg=${res.oos.avg >= 0 ? '+' : ''}${res.oos.avg.toFixed(2)}%  PF=${res.oos.pf === 999 ? '∞' : res.oos.pf.toFixed(2)}\n`);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const baseOOS = results[0].oos;
  const baseIS  = results[0].is;

  console.log('\n\n' + '='.repeat(90));
  console.log('ABLATION RESULTS — OOS (2025-01-01 onwards)');
  console.log('='.repeat(90));
  console.log(`  Δ columns show change vs BASE. ↑ = improvement (more signals or better P&L)`);
  console.log(`  "GOOD REMOVE" = removing this condition helps OOS → condition is noise-fit`);
  console.log('='.repeat(90));
  console.log(`${'Variant'.padEnd(42)}  ${'N'.padStart(5)}  ${'ΔN'.padStart(5)}  ${'WR%'.padStart(6)}  ${'ΔWR'.padStart(6)}  ${'AvgP&L%'.padStart(8)}  ${'ΔAvg'.padStart(6)}  ${'PF'.padStart(5)}  ${'Verdict'}`);
  console.log('-'.repeat(110));

  for (const { abl, oos } of results) {
    const isBase = abl.field === null;
    const dn     = isBase ? '' : (oos.n - baseOOS.n >= 0 ? '+' : '') + (oos.n - baseOOS.n);
    const dwr    = isBase ? '' : (oos.wr - baseOOS.wr >= 0 ? '+' : '') + (oos.wr - baseOOS.wr).toFixed(1);
    const davg   = isBase ? '' : (oos.avg - baseOOS.avg >= 0 ? '+' : '') + (oos.avg - baseOOS.avg).toFixed(2);
    const pfStr  = oos.pf === 999 ? '∞' : oos.pf.toFixed(2);
    const avgStr = (oos.avg >= 0 ? '+' : '') + oos.avg.toFixed(2) + '%';

    let verdict = '';
    if (!isBase) {
      const nGrow      = oos.n > baseOOS.n;
      const avgImprove = oos.avg > baseOOS.avg;
      const wrImprove  = oos.wr  > baseOOS.wr;
      if (avgImprove && wrImprove)      verdict = '✅ GOOD REMOVE — condition is noise-fit';
      else if (avgImprove && !wrImprove) verdict = '~ Avg improves, WR drops (fewer/dirtier stops)';
      else if (!avgImprove && nGrow)     verdict = '⚠ More signals but worse quality';
      else                               verdict = '🔒 Keep — condition adds OOS edge';
    } else {
      verdict = '◄ BASELINE';
    }

    console.log(
      `${abl.label.padEnd(42)}  ${String(oos.n).padStart(5)}  ${String(dn).padStart(5)}  ` +
      `${oos.wr.toFixed(1).padStart(5)}%  ${String(dwr).padStart(6)}  ${avgStr.padStart(8)}  ` +
      `${String(davg).padStart(6)}  ${pfStr.padStart(5)}  ${verdict}`
    );
  }

  console.log('\n' + '='.repeat(90));
  console.log('IS REFERENCE (for overfitting check)');
  console.log('='.repeat(90));
  console.log(`${'Variant'.padEnd(42)}  ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'AvgP&L%'.padStart(8)}  ${'PF'.padStart(5)}`);
  console.log('-'.repeat(75));

  for (const { abl, is } of results) {
    const pfStr  = is.pf === 999 ? '∞' : is.pf.toFixed(2);
    const avgStr = (is.avg >= 0 ? '+' : '') + is.avg.toFixed(2) + '%';
    console.log(
      `${abl.label.padEnd(42)}  ${String(is.n).padStart(5)}  ${is.wr.toFixed(1).padStart(5)}%  ${avgStr.padStart(8)}  ${pfStr.padStart(5)}`
    );
  }

  // Summary: which conditions to drop
  console.log('\n' + '='.repeat(90));
  console.log('NOISE-FIT CONDITIONS (candidates to remove or redesign):');
  console.log('='.repeat(90));
  const goodRemoves = results.filter(r => r.abl.field !== null && r.oos.avg > baseOOS.avg && r.oos.wr > baseOOS.wr);
  if (goodRemoves.length === 0) {
    console.log('  None — every condition either maintains or hurts OOS when removed.');
    console.log('  Signal architecture itself may need redesign (not condition tuning).');
  } else {
    for (const { abl, oos } of goodRemoves) {
      console.log(`  • ${abl.label}`);
      console.log(`    OOS: n=${oos.n} (+${oos.n - baseOOS.n})  WR=${oos.wr.toFixed(1)}% (${(oos.wr - baseOOS.wr) >= 0 ? '+' : ''}${(oos.wr - baseOOS.wr).toFixed(1)})  Avg=${oos.avg >= 0 ? '+' : ''}${oos.avg.toFixed(2)}% (${(oos.avg - baseOOS.avg) >= 0 ? '+' : ''}${(oos.avg - baseOOS.avg).toFixed(2)})`);
    }
  }

  console.log('\nDone.\n');
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  runWorker();
}
