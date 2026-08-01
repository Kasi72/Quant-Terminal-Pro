'use strict';
/**
 * PS (PerfectStorm / sniper_95plus) Stop-Loss Sweep
 * Sweeps SL multiplier 1.5×–4.0×ATR in 0.25 steps.
 * Uses the compiled engine — same signal source as thoroughWinRateBacktest.
 * OOS split at 2025-01-01. Reports WR, avgP&L, PF, Wilson LB per SL value.
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OOS_CUT    = '2025-01-01';
const PARAM_KEY  = 'sniper_95plus';
const TP_PCT     = 5;
const MAX_HOLD   = 20;
const MIN_BARS   = 150;
const WINDOW     = 300;
const WORKERS    = Number(process.env.WORKERS || 10);
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// SL sweep: 1.5× to 4.0×ATR in 0.25 steps
const SL_RANGE = [];
for (let m = 1.5; m <= 4.0; m += 0.25) SL_RANGE.push(parseFloat(m.toFixed(2)));

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

// Simulate a single trade at a specific SL multiplier.
// Returns {pnl, hit} where pnl is % P&L and hit=true if TP reached.
function simTrade(entry, bars, slMult, atrAtSig) {
  const tp   = entry * (1 + TP_PCT / 100);
  const stop = entry - slMult * atrAtSig;
  for (let j = 0; j < bars.length; j++) {
    const b = bars[j];
    // Check open gap below stop first
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

  const oosCutTs = workerData.oosCutTs;
  // trades: {split, slResults: {slMult -> {pnl, hit}}}
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

      const entry = c[entryIdx].o;
      const atrSig = atr14[i] || c[i].c * 0.02;
      const maxEnd = Math.min(c.length - 1, entryIdx + MAX_HOLD - 1);

      // Collect forward bars once
      const bars = [];
      for (let j = entryIdx; j <= maxEnd; j++) bars.push(c[j]);

      const split = c[i].ts < oosCutTs ? 'is' : 'oos';

      // Simulate at every SL multiplier
      const slResults = {};
      let maxDur = 0;
      for (const slMult of SL_RANGE) {
        const res = simTrade(entry, bars, slMult, atrSig);
        slResults[slMult] = res;
        // Track max hold for exit prevention at reference SL=4
        if (slMult === 4.0 && !res.hit) maxDur = bars.length;
      }

      trades.push({ split, slResults });
      // Use 4×ATR exit index as reference to avoid overlapping signals
      lastExitIdx = entryIdx + bars.length - 1;
    }

    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', trades });
}

// ── Main ─────────────────────────────────────────────────────────────────────

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
  if (n === 0) return null;
  return {
    n,
    wr:    wins / n * 100,
    avg:   sumPnl / n,
    pf:    sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? Infinity : 0,
    wils:  wilsonLower(wins, n),
  };
}

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(WORKERS, files.length);
  const chunks = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\nPS STOP-LOSS SWEEP — ${files.length} stocks · ${nWorkers} workers`);
  console.log(`Param: ${PARAM_KEY} · TP=${TP_PCT}% · HOLD=${MAX_HOLD}bars · OOS_CUT=${OOS_CUT}`);
  console.log(`SL range: ${SL_RANGE[0]}×–${SL_RANGE[SL_RANGE.length-1]}×ATR (${SL_RANGE.length} steps)\n`);

  const oosCutTs = Date.parse(OOS_CUT) / 1000;
  let done = 0;
  const allTrades = [];

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, oosCutTs } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 100 === 0) process.stdout.write(`  Processed ${done}/${files.length} stocks\r`);
      } else if (m.type === 'done') {
        allTrades.push(...m.trades);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`worker exited ${c}`)); });
  })));

  const isTrades  = allTrades.filter(t => t.split === 'is');
  const oosTrades = allTrades.filter(t => t.split === 'oos');

  console.log(`\n\nTotal signals: IS=${isTrades.length}  OOS=${oosTrades.length}\n`);

  // Aggregate per SL per split
  const isAcc  = {};
  const oosAcc = {};
  for (const slMult of SL_RANGE) {
    isAcc[slMult]  = mkAcc();
    oosAcc[slMult] = mkAcc();
  }

  for (const t of isTrades)  for (const sl of SL_RANGE) addTrade(isAcc[sl],  t.slResults[sl].pnl, t.slResults[sl].hit);
  for (const t of oosTrades) for (const sl of SL_RANGE) addTrade(oosAcc[sl], t.slResults[sl].pnl, t.slResults[sl].hit);

  const W = 10;
  const fmt = (v, d=1) => v === null ? '—' : (typeof v === 'number' ? v.toFixed(d) : v);

  console.log('='.repeat(80));
  console.log('PerfectStorm (sniper_95plus) — OOS STOP-LOSS SWEEP');
  console.log('='.repeat(80));
  console.log(`${'SL×ATR'.padStart(8)}  ${'N'.padStart(5)}  ${'WR%'.padStart(7)}  ${'AvgP&L%'.padStart(9)}  ${'PF'.padStart(6)}  ${'Wilson%'.padStart(8)}`);
  console.log('-'.repeat(60));

  let bestE = -Infinity, bestSL = null;
  const oosRows = [];

  for (const sl of SL_RANGE) {
    const s = summarize(oosAcc[sl]);
    if (!s) continue;
    oosRows.push({ sl, ...s });
    if (s.avg > bestE) { bestE = s.avg; bestSL = sl; }
  }

  for (const row of oosRows) {
    const star = row.sl === bestSL ? ' ◄ OPTIMAL' : '';
    const pfStr = row.pf === Infinity ? '∞' : row.pf.toFixed(2);
    console.log(
      `${String(row.sl + '×').padStart(8)}  ${String(row.n).padStart(5)}  ${fmt(row.wr).padStart(6)}%  ` +
      `${(row.avg >= 0 ? '+' : '') + fmt(row.avg).padStart(8)}%  ${pfStr.padStart(6)}  ${fmt(row.wils).padStart(7)}%${star}`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('PerfectStorm (sniper_95plus) — IS STOP-LOSS SWEEP (reference)');
  console.log('='.repeat(80));
  console.log(`${'SL×ATR'.padStart(8)}  ${'N'.padStart(5)}  ${'WR%'.padStart(7)}  ${'AvgP&L%'.padStart(9)}  ${'PF'.padStart(6)}  ${'Wilson%'.padStart(8)}`);
  console.log('-'.repeat(60));

  let bestEis = -Infinity, bestSLis = null;
  for (const sl of SL_RANGE) {
    const s = summarize(isAcc[sl]);
    if (!s && s?.avg > bestEis) { bestEis = s.avg; bestSLis = sl; }
    if (s && s.avg > bestEis) { bestEis = s.avg; bestSLis = sl; }
  }

  for (const sl of SL_RANGE) {
    const s = summarize(isAcc[sl]);
    if (!s) continue;
    const star = sl === bestSLis ? ' ◄ OPTIMAL' : '';
    const pfStr = s.pf === Infinity ? '∞' : s.pf.toFixed(2);
    console.log(
      `${String(sl + '×').padStart(8)}  ${String(s.n).padStart(5)}  ${fmt(s.wr).padStart(6)}%  ` +
      `${(s.avg >= 0 ? '+' : '') + fmt(s.avg).padStart(8)}%  ${pfStr.padStart(6)}  ${fmt(s.wils).padStart(7)}%${star}`
    );
  }

  console.log('\n' + '='.repeat(80));
  if (bestSL !== null) {
    const opt = summarize(oosAcc[bestSL]);
    console.log(`RECOMMENDATION: Set PS SL = ${bestSL}×ATR`);
    console.log(`  OOS at ${bestSL}×ATR: n=${opt.n}  WR=${opt.wr.toFixed(1)}%  Avg=${opt.avg >= 0 ? '+' : ''}${opt.avg.toFixed(2)}%  PF=${opt.pf === Infinity ? '∞' : opt.pf.toFixed(2)}  Wilson=${opt.wils.toFixed(1)}%`);
    const current = summarize(oosAcc[4.0]);
    if (current) console.log(`  Current (4.0×ATR): n=${current.n}  WR=${current.wr.toFixed(1)}%  Avg=${current.avg >= 0 ? '+' : ''}${current.avg.toFixed(2)}%  PF=${current.pf === Infinity ? '∞' : current.pf.toFixed(2)}  Wilson=${current.wils.toFixed(1)}%`);
  }
  console.log('='.repeat(80));
  console.log('\nDone.\n');
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  runWorker();
}
