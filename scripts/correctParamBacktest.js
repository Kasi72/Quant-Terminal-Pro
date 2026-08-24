'use strict';
/**
 * correctParamBacktest.js
 * ========================
 * Backtest using PER-PARAM exit configs that match production ARCHETYPE_EXIT_DEFAULTS.
 * Previous backtest used global TP=6%/SL=4×ATR/HOLD=20 — WRONG for all sets.
 *
 * Exit logic per param set:
 *   circuit_breaker_v2:       SL=2.5×ATR, maxHold=3  bars, no fixed TP
 *   ors_prime_reversal:       SL=2.5×ATR, maxHold=5  bars, no fixed TP
 *   sniper_95plus:            SL=2.0×ATR, maxHold=5  bars, no fixed TP
 *   ultraselective_8plus:     SL=2.0×ATR, maxHold=12 bars, no fixed TP
 *   deployable_20plus:        SL=1.5×ATR, maxHold=12 bars, no fixed TP
 *   highprecision_15plus:     SL=1.0×ATR, maxHold=5  bars, no fixed TP
 *   elite_10plus:             SL=4.0×ATR, maxHold=20 bars, TP=4%
 *
 * Usage: node scripts/correctParamBacktest.js
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

// Per-param exit config matching ARCHETYPE_EXIT_DEFAULTS in stockEngine.ts
const EXIT_CONFIG = {
  deployable_20plus:    { tpPct: 0,  slMult: 1.5, maxHold: 12 },
  highprecision_15plus: { tpPct: 0,  slMult: 1.0, maxHold: 5  },
  elite_10plus:         { tpPct: 4,  slMult: 4.0, maxHold: 20 },
  ultraselective_8plus: { tpPct: 0,  slMult: 2.0, maxHold: 12 },
  sniper_95plus:        { tpPct: 0,  slMult: 2.0, maxHold: 5  },
  ors_prime_reversal:   { tpPct: 0,  slMult: 2.5, maxHold: 5  },
  circuit_breaker_v2:   { tpPct: 0,  slMult: 2.5, maxHold: 3  },
};

// Map compiled engine keys → display keys
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
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT']);

// ── CSV parser ─────────────────────────────────────────────────────────────────
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

function simulateTrade(c, sigIdx, atrAtSig, cfg) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || c[entryIdx].o <= 0 || atrAtSig <= 0) return null;

  const entry  = c[entryIdx].o;
  const stop   = entry - cfg.slMult * atrAtSig;
  const tp     = cfg.tpPct > 0 ? entry * (1 + cfg.tpPct / 100) : Infinity;
  const maxEnd = Math.min(c.length - 1, entryIdx + cfg.maxHold - 1);

  let exitPx = c[maxEnd].c;
  let hit    = false;
  let stopped = false;
  let mae = 0, mfe = 0;
  let holdBars = 0;

  for (let j = entryIdx; j <= maxEnd; j++) {
    const b = c[j];
    holdBars = j - entryIdx + 1;
    const barMae = (entry - b.l) / entry * 100;
    const barMfe = (b.h - entry) / entry * 100;
    if (barMae > mae) mae = barMae;
    if (barMfe > mfe) mfe = barMfe;

    if (b.o <= stop) { exitPx = b.o; stopped = true; break; }
    if (b.l <= stop) { exitPx = stop; stopped = true; break; }
    if (b.h >= tp)   { exitPx = tp; hit = true; break; }
    if (j === maxEnd) exitPx = b.c;
  }

  const pnl = (exitPx - entry) / entry * 100;
  return { pnl, hit, stopped, mae, mfe, holdBars };
}

// ─── Worker ───────────────────────────────────────────────────────────────────
function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const oosCutTs = workerData.oosCutTs;
  const trades = [];
  let processed = 0;

  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }
    const atr14 = atr14Array(c);

    for (const engineKey of PARAM_KEYS) {
      const displayKey = KEY_MAP[engineKey];
      const cfg = EXIT_CONFIG[displayKey];
      let lastExitIdx = -1;

      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExitIdx) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, engineKey); } catch { continue; }
        if (!r || !ACTIONABLE.has(r.stage)) continue;

        const split   = c[i].ts < oosCutTs ? 'is' : 'oos';
        const atrSig  = atr14[i] || c[i].c * 0.02;
        const result  = simulateTrade(c, i, atrSig, cfg);
        if (!result) continue;

        trades.push({ key: displayKey, split, stage: r.stage, ...result });
        lastExitIdx = i + cfg.maxHold;
      }
    }

    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', trades });
}

// ─── Stats helpers ────────────────────────────────────────────────────────────
function pctile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return +(s[lo] + (s[hi] - s[lo]) * (idx - lo)).toFixed(2);
}

function stddev(arr, mean) {
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1));
}

function summarize(trades, maxHold) {
  if (!trades.length) return null;
  const wins    = trades.filter(t => t.pnl > 0);
  const losses  = trades.filter(t => t.pnl <= 0);
  const stopped = trades.filter(t => t.stopped);
  const sumWin  = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLoss = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
  const pf      = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : 0);
  const pnls    = trades.map(t => t.pnl);
  const avgPnl  = pnls.reduce((s, v) => s + v, 0) / trades.length;
  const sd      = stddev(pnls, avgPnl);
  const annFactor = Math.sqrt(252 / (maxHold || 10));
  const sharpe  = sd > 0 ? (avgPnl / sd) * annFactor : 0;
  const avgHold = trades.reduce((s, t) => s + (t.holdBars || 0), 0) / trades.length;
  const maes = trades.map(t => t.mae);
  const mfes = trades.map(t => t.mfe);
  return {
    n:       trades.length,
    wr:      (wins.length / trades.length * 100).toFixed(1),
    pf:      isFinite(pf) ? +pf.toFixed(2) : 999,
    avgPnl:  +avgPnl.toFixed(2),
    sharpe:  +sharpe.toFixed(2),
    stopPct: +(stopped.length / trades.length * 100).toFixed(1),
    avgHold: +avgHold.toFixed(1),
    mae: { p25: pctile(maes,25), p50: pctile(maes,50), p75: pctile(maes,75), p90: pctile(maes,90) },
    mfe: { p25: pctile(mfes,25), p50: pctile(mfes,50), p75: pctile(mfes,75), p90: pctile(mfes,90) },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(WORKERS, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n${'='.repeat(90)}`);
  console.log(`  CORRECT PARAM-SPECIFIC EXIT BACKTEST — ${files.length} stocks, ${nWorkers} workers`);
  console.log(`  OOS_CUT=${OOS_CUT} | Per-param: SL/TP/Hold from ARCHETYPE_EXIT_DEFAULTS`);
  console.log(`${'='.repeat(90)}\n`);

  const oosCutTs = Date.parse(OOS_CUT) / 1000;
  let progress  = 0;
  const allTrades = [];

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, oosCutTs } });
    w.on('message', m => {
      if (m.type === 'progress') {
        progress += m.n;
        process.stdout.write(`  Scanning ${progress}/${files.length} stocks...\r`);
      } else if (m.type === 'done') {
        allTrades.push(...m.trades);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c !== 0) reject(new Error(`worker exited ${c}`)); });
  })));

  console.log(`\n  Done. Total signals: ${allTrades.length.toLocaleString()}\n`);

  const DISPLAY_ORDER = [
    'deployable_20plus', 'highprecision_15plus', 'elite_10plus',
    'ultraselective_8plus', 'sniper_95plus', 'ors_prime_reversal', 'circuit_breaker_v2',
  ];

  // Per param set detailed output
  for (const key of DISPLAY_ORDER) {
    const cfg = EXIT_CONFIG[key];
    const kt  = allTrades.filter(t => t.key === key);
    console.log(`\n${'─'.repeat(90)}`);
    console.log(`  ${key.toUpperCase()}  [exit: SL=${cfg.slMult}×ATR  TP=${cfg.tpPct||'none'}  maxHold=${cfg.maxHold}bars]`);
    console.log(`${'─'.repeat(90)}`);

    for (const split of ['is', 'oos']) {
      const label = split === 'is' ? `IN-SAMPLE  <${OOS_CUT}` : `OUT-OF-SAMPLE >=${OOS_CUT}`;
      console.log(`\n  [${label}]`);
      const all = kt.filter(t => t.split === split);
      const s   = summarize(all, cfg.maxHold);
      if (!s) { console.log('    no trades'); continue; }
      console.log(`    ALL   n=${s.n}  WR=${s.wr}%  PF=${s.pf}  avgP&L=${s.avgPnl}%  Sharpe=${s.sharpe}  Stop%=${s.stopPct}%  avgHold=${s.avgHold}d`);
      console.log(`          MAE p25/50/75/90: ${s.mae.p25}/${s.mae.p50}/${s.mae.p75}/${s.mae.p90}%`);
      console.log(`          MFE p25/50/75/90: ${s.mfe.p25}/${s.mfe.p50}/${s.mfe.p75}/${s.mfe.p90}%`);

      // Stage breakdown
      for (const stage of ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT']) {
        const st = summarize(all.filter(t => t.stage === stage), cfg.maxHold);
        if (!st || st.n < 5) continue;
        console.log(`    ${stage.padEnd(20)} n=${st.n}  WR=${st.wr}%  PF=${st.pf}  avg=${st.avgPnl}%  Sharpe=${st.sharpe}`);
      }
    }
  }

  // OOS Summary table
  console.log(`\n${'='.repeat(90)}`);
  console.log(`  OOS SUMMARY (correct per-param exits)  >=  ${OOS_CUT}`);
  console.log(`${'='.repeat(90)}`);
  console.log(`  ${'PARAM SET'.padEnd(28)} ${'EXIT'.padEnd(22)} ${'N'.padStart(5)}  ${'WR%'.padStart(5)}  ${'PF'.padStart(5)}  ${'avg%P&L'.padStart(8)}  ${'Sharpe'.padStart(6)}  ${'Stop%'.padStart(5)}`);
  console.log(`  ${'-'.repeat(85)}`);

  let totalOOS = [], totalN = 0;
  for (const key of DISPLAY_ORDER) {
    const cfg = EXIT_CONFIG[key];
    const oos = allTrades.filter(t => t.key === key && t.split === 'oos');
    totalOOS.push(...oos);
    totalN += oos.length;
    const s   = summarize(oos, cfg.maxHold);
    if (!s) { console.log(`  ${key.padEnd(28)} no OOS trades`); continue; }
    const exitStr = `SL=${cfg.slMult}x TP=${cfg.tpPct||'no'} H=${cfg.maxHold}`;
    console.log(
      `  ${key.padEnd(28)} ${exitStr.padEnd(22)} ${String(s.n).padStart(5)}  ${(s.wr+'%').padStart(5)}  ${String(s.pf).padStart(5)}  ${(s.avgPnl+'%').padStart(8)}  ${String(s.sharpe).padStart(6)}  ${(s.stopPct+'%').padStart(5)}`
    );
  }

  console.log(`  ${'-'.repeat(85)}`);
  // Note: combined Sharpe not meaningful across different exit configs

  // Save results
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(__dirname, 'results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `correctParamBacktest_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    meta: { OOS_CUT, stocks: files.length, exitConfigs: EXIT_CONFIG },
    trades: allTrades,
  }, null, 2));
  console.log(`\n  Raw trades saved → ${outPath}`);
  console.log(`${'='.repeat(90)}\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  runWorker();
}
