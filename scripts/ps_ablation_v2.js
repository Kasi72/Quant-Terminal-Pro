'use strict';
/**
 * PS (PerfectStorm / sniper_95plus) Ablation Study — v2 CORRECTED
 *
 * analyzePerfectStorm is a META-ARCHETYPE (runs VF+CC+MP+EMA sub-archetypes).
 * Real PS gates are in ARCHETYPE_TUNING via tuned(), NOT PARAM_SETS.
 * All gate values are hardcoded fallbacks since ARCHETYPE_TUNING['sniper_95plus'] is empty.
 *
 * Gates to ablate (field : hardcoded_default → permissive):
 *   minADXGate      30  → 0     (remove trending-regime requirement)
 *   minAtrPct14      4  → 0     \  ATR% 4-5% band is very tight — primary suspect
 *   maxAtrPct14      5  → 100   /
 *   minCMF20       0.1  → -999  (remove money-flow gate)
 *   minOBVSlope10    0  → -999  (remove OBV slope gate)
 *   minCloseVsEMA20  0  → -999  (remove close-vs-EMA20 gate)
 *   minQualityTier   2  → 0     (remove candle quality gate)
 *   maxCandleRisk   10  → 100   (remove candle risk gate)
 *   minFires         1  → 1 (already min); test raising to 2
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

// Each ablation sets ARCHETYPE_TUNING['sniper_95plus'] = overrides
// Multiple fields can be set in one ablation (e.g., the ATR% band is two fields)
const ABLATIONS = [
  { id: 'BASE',      label: 'Base PS (no change)',                           overrides: null },
  { id: 'ADX',       label: 'Remove ADX gate  30 → 0',                       overrides: { minADXGate: 0 } },
  { id: 'ATRBAND',   label: 'Widen ATR% band  4-5% → 0-100%',               overrides: { minAtrPct14: 0, maxAtrPct14: 100 } },
  { id: 'CMF',       label: 'Remove CMF20 gate  0.1 → -999',                 overrides: { minCMF20: -999 } },
  { id: 'OBV',       label: 'Remove OBV slope gate  0 → -999',               overrides: { minOBVSlope10: -999 } },
  { id: 'EMA20',     label: 'Remove close>EMA20 gate  0 → -999',             overrides: { minCloseVsEMA20: -999 } },
  { id: 'QUALITY',   label: 'Remove candle quality gate  2 → 0',             overrides: { minQualityTier: 0 } },
  { id: 'CANDRISK',  label: 'Remove candle risk gate  10% → 100%',           overrides: { maxCandleRisk: 100 } },
  { id: 'FIRES2',    label: 'Raise minFires gate  1 → 2 (stricter)',         overrides: { minFires: 2 } },
  { id: 'NOFLOW',    label: 'Remove all flow gates (CMF+OBV+EMA20)',         overrides: { minCMF20: -999, minOBVSlope10: -999, minCloseVsEMA20: -999 } },
  { id: 'NOTECHGATE',label: 'Remove ADX+ATRband (no regime gates)',          overrides: { minADXGate: 0, minAtrPct14: 0, maxAtrPct14: 100 } },
  { id: 'OPENFLOOD', label: 'Remove ALL PS gates (raw sub-archetype union)', overrides: { minADXGate: 0, minAtrPct14: 0, maxAtrPct14: 100, minCMF20: -999, minOBVSlope10: -999, minCloseVsEMA20: -999, minQualityTier: 0, maxCandleRisk: 100 } },
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

  // Apply ARCHETYPE_TUNING overrides for this ablation
  const { overrides } = workerData;
  if (overrides) {
    engine.ARCHETYPE_TUNING[PARAM_KEY] = { ...overrides };
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

  // Clean up override
  if (overrides) delete engine.ARCHETYPE_TUNING[PARAM_KEY];

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

function runAblation(files, oosCutTs, abl) {
  return new Promise((resolve, reject) => {
    const nWorkers = Math.min(WORKERS, files.length);
    const chunks = Array.from({ length: nWorkers }, () => []);
    files.forEach((f, i) => chunks[i % nWorkers].push(f));

    const allTrades = [];
    let progressCount = 0;

    const workerPromises = chunks.map(chunk => {
      const w = new Worker(__filename, {
        workerData: { files: chunk, oosCutTs, overrides: abl.overrides },
      });
      w.on('message', m => {
        if (m.type === 'progress') {
          progressCount += m.n;
          process.stdout.write(`  [${abl.id.padEnd(12)}] ${progressCount}/${files.length}\r`);
        } else if (m.type === 'done') {
          allTrades.push(...m.trades);
        }
      });
      w.on('error', reject);
      return new Promise((res, rej) => {
        w.on('exit', c => { if (c && c !== 0) rej(new Error(`worker exit ${c}`)); else res(); });
      });
    });

    Promise.all(workerPromises).then(() => {
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

  console.log(`\nPS ABLATION STUDY v2 — ${files.length} stocks · ${WORKERS} workers`);
  console.log(`Param: ${PARAM_KEY} · TP=${TP_PCT}% · SL=${SL_ATR}×ATR · HOLD=${MAX_HOLD}bars · OOS_CUT=${OOS_CUT}`);
  console.log(`Gates via ARCHETYPE_TUNING — ${ABLATIONS.length} ablations\n`);

  const results = [];
  for (const abl of ABLATIONS) {
    process.stdout.write(`\nRunning [${abl.id}]: ${abl.label}\n`);
    const res = await runAblation(files, oosCutTs, abl);
    results.push({ abl, ...res });
    process.stdout.write(`  Done. OOS: n=${res.oos.n}  WR=${res.oos.wr.toFixed(1)}%  Avg=${res.oos.avg >= 0 ? '+' : ''}${res.oos.avg.toFixed(2)}%  PF=${res.oos.pf === 999 ? '∞' : res.oos.pf.toFixed(2)}\n`);
  }

  const baseOOS = results[0].oos;

  console.log('\n\n' + '='.repeat(105));
  console.log('ABLATION RESULTS — OOS (2025-01-01 onwards)');
  console.log('='.repeat(105));
  console.log(`  ΔN>0 = gate was filtering OOS signals. ↑WR/↑Avg = removing gate helps OOS = gate is noise-fit.`);
  console.log('='.repeat(105));
  console.log(`${'Ablation'.padEnd(45)}  ${'N'.padStart(5)}  ${'ΔN'.padStart(5)}  ${'WR%'.padStart(6)}  ${'ΔWR'.padStart(6)}  ${'AvgP&L%'.padStart(8)}  ${'ΔAvg'.padStart(6)}  ${'PF'.padStart(5)}  Verdict`);
  console.log('-'.repeat(115));

  for (const { abl, oos } of results) {
    const isBase = abl.overrides === null;
    const dn   = isBase ? '' : (oos.n - baseOOS.n >= 0 ? '+' : '') + (oos.n - baseOOS.n);
    const dwr  = isBase ? '' : (oos.wr - baseOOS.wr >= 0 ? '+' : '') + (oos.wr - baseOOS.wr).toFixed(1);
    const davg = isBase ? '' : (oos.avg - baseOOS.avg >= 0 ? '+' : '') + (oos.avg - baseOOS.avg).toFixed(2);
    const pf   = oos.pf === 999 ? '∞' : oos.pf.toFixed(2);
    const avg  = (oos.avg >= 0 ? '+' : '') + oos.avg.toFixed(2) + '%';

    let verdict = '';
    if (!isBase) {
      const nUp  = oos.n > baseOOS.n;
      const avgUp = oos.avg > baseOOS.avg;
      const wrUp  = oos.wr  > baseOOS.wr;
      if (avgUp && wrUp && nUp)        verdict = '✅ NOISE-FIT — remove this gate';
      else if (avgUp && wrUp && !nUp)  verdict = '✅ NOISE-FIT (fewer but better signals)';
      else if (avgUp && !wrUp)         verdict = '~ Avg↑ WR↓ (mixed)';
      else if (!avgUp && !wrUp && nUp) verdict = '⚠ More signals but worse quality';
      else if (!avgUp && !wrUp && !nUp && oos.n === baseOOS.n) verdict = '○ Gate inactive on this dataset';
      else                             verdict = '🔒 Keep — gate adds OOS edge';
    } else {
      verdict = '◄ BASELINE';
    }

    console.log(
      `${abl.label.padEnd(45)}  ${String(oos.n).padStart(5)}  ${String(dn).padStart(5)}  ` +
      `${oos.wr.toFixed(1).padStart(5)}%  ${String(dwr).padStart(6)}  ${avg.padStart(8)}  ` +
      `${String(davg).padStart(6)}  ${pf.padStart(5)}  ${verdict}`
    );
  }

  // IS reference
  console.log('\n' + '='.repeat(105));
  console.log('IS REFERENCE');
  console.log('='.repeat(105));
  console.log(`${'Ablation'.padEnd(45)}  ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'AvgP&L%'.padStart(8)}  ${'PF'.padStart(5)}`);
  console.log('-'.repeat(75));
  for (const { abl, is } of results) {
    const pf  = is.pf === 999 ? '∞' : is.pf.toFixed(2);
    const avg = (is.avg >= 0 ? '+' : '') + is.avg.toFixed(2) + '%';
    console.log(`${abl.label.padEnd(45)}  ${String(is.n).padStart(5)}  ${is.wr.toFixed(1).padStart(5)}%  ${avg.padStart(8)}  ${pf.padStart(5)}`);
  }

  // Summary
  console.log('\n' + '='.repeat(105));
  console.log('DIAGNOSIS:');
  const noiseFit = results.filter(r => r.abl.overrides !== null && r.oos.avg > baseOOS.avg && r.oos.wr > baseOOS.wr);
  if (noiseFit.length === 0) {
    console.log('  No single gate removal improves OOS. Overfitting is in sub-archetype combination logic,');
    console.log('  not in PS-level gates. Consider ablating sub-archetype PARAM_SETS next.');
  } else {
    for (const { abl, oos } of noiseFit) {
      const avgDelta = (oos.avg - baseOOS.avg).toFixed(2);
      const nDelta   = oos.n - baseOOS.n;
      console.log(`  • ${abl.label}`);
      console.log(`    ΔAvg=${avgDelta >= 0 ? '+' : ''}${avgDelta}%  ΔN=${nDelta >= 0 ? '+' : ''}${nDelta}  OOS WR=${oos.wr.toFixed(1)}%`);
    }
  }
  console.log('\nDone.\n');
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  runWorker();
}
