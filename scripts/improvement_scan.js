'use strict';
// improvement_scan.js — 5-axis improvement scan
// Axes: ORS TP lift | CC tradePromoted gate | EMA stage expansion | VF TP lift | RS gate
// 2-phase: workers scan+store candles; main post-processes without re-scanning

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const WORKERS    = Number(process.env.WORKERS || Math.min(os.cpus().length, 12));
const OOS_START  = Date.parse('2023-01-01') / 1000;
const WINDOW     = 300;
const MIN_BARS   = 150;
const NIFTY_FP   = path.join(DATA_DIR, 'NIFTY50.csv');
const OUT_FILE   = path.join(__dirname, 'results', 'improvement_scan.txt');
const MAX_STORE  = 22; // max candles to store per signal (covers all maxHold values up to 20)

// Scan with widest possible stages for each param so all axes get data
// EMA Stack includes STRONG_BUY for stage-expansion axis
const SCAN_CFG = [
  { key: 'optimized_deployable_20plus',    label: 'VF Scout',     stages: new Set(['PRE_BREAKOUT']),                                           ucMin: 0,  maxHold: 20, tp: 5, sl: 5.0 },
  { key: 'optimized_highprecision_15plus', label: 'CC Precision', stages: new Set(['PRE_BREAKOUT']),                                           ucMin: 50, maxHold: 20, tp: 3, sl: 2.5 },
  { key: 'optimized_ultraselective_8plus', label: 'EMA Stack',    stages: new Set(['PRE_BREAKOUT', 'STRONG_BUY']),                             ucMin: 0,  maxHold: 20, tp: 3, sl: 5.0 },
  { key: 'sniper_95plus',                  label: 'Sniper PS',    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']),     ucMin: 70, maxHold: 15, tp: 4, sl: 5.0 },
  { key: 'ors_prime_reversal',             label: 'ORS Reversal', stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']),     ucMin: 0,  maxHold: 10, tp: 3, sl: 5.0 },
];

// ─── CSV parse ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/), out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 5) continue;
    const ts = Date.parse(p[0]), o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +(p[5] || 0);
    if (!Number.isFinite(ts) || o <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) { if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x; else d.push(x); }
  return d;
}

// ─── ATR ──────────────────────────────────────────────────────────────────────
function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  if (c.length < 2) return out;
  const tr = [0];
  for (let i = 1; i < c.length; i++)
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  if (c.length <= 14) { for (let i = 1; i < c.length; i++) out[i] = tr[i]; return out; }
  let s = 0; for (let i = 1; i <= 14; i++) s += tr[i]; out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

// ─── Worker ───────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const engine = require(path.join(workerData.engineDir, 'stockEngine.js'));
  // Reconstruct Sets (serialized as arrays across worker threads)
  const scanCfg = workerData.scanCfg.map(p => ({ ...p, stages: new Set(p.stages) }));
  const signals = [];
  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { continue; }
    if (c.length < MIN_BARS) continue;
    const atr14 = atr14Array(c);
    for (const ps of scanCfg) {
      let lastExit = -1;
      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExit) continue;
        if (c[i].ts < OOS_START) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, ps.key); } catch { continue; }
        if (!r || !ps.stages.has(r.stage)) continue;
        if (ps.ucMin && (r.ucScore ?? 0) < ps.ucMin) continue;
        const atrSig = atr14[i] || c[i].c * 0.02;
        const lb = Math.max(0, i - 20);
        signals.push({
          key:        ps.key,
          label:      ps.label,
          stage:      r.stage,
          uc:         Math.round(r.ucScore ?? 0),
          promoted:   r.tradePromoted ?? false,
          overlay:    r.practicalOverlay?.passed ?? false,
          ts:         c[i].ts,
          ts20back:   c[lb].ts,
          stockRet20: c[lb].c > 0 ? (c[i].c / c[lb].c - 1) : null,
          atr:        atrSig,
          // entry candles: from next bar, up to MAX_STORE bars
          candles:    c.slice(i + 1, i + 1 + MAX_STORE).map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c })),
        });
        lastExit = i + ps.maxHold;
      }
    }
  }
  parentPort.postMessage({ type: 'done', signals });
  process.exit(0);
}

// ─── Nifty helpers ────────────────────────────────────────────────────────────
function loadNifty(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = raw.split(/\r?\n/);
  const arr = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 5) continue;
    const ts = Date.parse(p[0].trim());
    const c = +p[4];
    if (!Number.isFinite(ts) || c <= 0) continue;
    arr.push({ ts: Math.floor(ts / 1000), c });
  }
  arr.sort((a, b) => a.ts - b.ts);
  return arr;
}

function niftyAt(arr, ts) {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].ts < ts) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(arr[lo - 1].ts - ts) < Math.abs(arr[lo].ts - ts)) return arr[lo - 1].c;
  return arr[lo].c;
}

// ─── Sim from stored candles ──────────────────────────────────────────────────
// opts.belock: move SL to entry once close > entry + 1×ATR (breakeven lock)
// opts.tstop:  exit at market if close < entry + 0.3×(tpPct) after maxHold/2 bars
function simFC(candles, tpPct, slAtr, atr, maxHold, opts = {}) {
  if (!candles.length || candles[0].o <= 0 || atr <= 0) return null;
  const entry    = candles[0].o;
  let   stop     = entry - slAtr * atr;
  const tp       = entry * (1 + tpPct / 100);
  const end      = Math.min(candles.length - 1, maxHold - 1);
  const tstopBar = Math.ceil(maxHold / 2);           // time-stop trigger bar
  const tstopMin = entry * (1 + 0.3 * tpPct / 100); // 30% progress toward TP
  let exitPx     = candles[end].c, hitTP = false, mfe = 0, mae = 0;
  for (let j = 0; j <= end; j++) {
    const b = candles[j];
    const up = (b.h - entry) / entry * 100; if (up > mfe) mfe = up;
    const dn = (entry - b.l) / entry * 100; if (dn > mae) mae = dn;
    // breakeven lock: once a close exceeds entry + 1×ATR, floor stop at entry
    if (opts.belock && b.c > entry + atr && stop < entry) stop = entry;
    // time stop: at midpoint bar, exit if not making sufficient progress
    if (opts.tstop && j === tstopBar && b.c < tstopMin) { exitPx = b.c; break; }
    if (b.o <= stop) { exitPx = b.o; break; }
    if (b.l <= stop) { exitPx = stop; break; }
    if (b.h >= tp)   { exitPx = tp; hitTP = true; break; }
  }
  return { pnl: (exitPx - entry) / entry * 100, hitTP };
}

function calcStats(sigs, tpPct, slAtr, maxHold, opts = {}) {
  const results = sigs.map(s => simFC(s.candles, tpPct, slAtr, s.atr, maxHold, opts)).filter(Boolean);
  const N = results.length;
  if (!N) return { N: 0, wr: 0, pf: 0, avg: 0 };
  const wins = results.filter(r => r.pnl > 0);
  const losses = results.filter(r => r.pnl <= 0);
  const grossW = wins.reduce((a, r) => a + r.pnl, 0);
  const grossL = losses.reduce((a, r) => a + Math.abs(r.pnl), 0);
  return {
    N,
    wr:  wins.length / N * 100,
    pf:  grossL > 0 ? grossW / grossL : wins.length > 0 ? 99 : 0,
    avg: results.reduce((a, r) => a + r.pnl, 0) / N,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────
const W = 120;
const line = '─'.repeat(W);
const bar  = '═'.repeat(W);
const f2   = v => Number.isFinite(v) ? v.toFixed(2) : '—';
const fWR  = v => Number.isFinite(v) ? v.toFixed(1) + '%' : '—';
function row(label, s) {
  return `  ${label.padEnd(30)} N=${String(s.N).padStart(5)}  WR=${fWR(s.wr).padStart(6)}  PF=${f2(s.pf).padStart(5)}  avg=${(s.avg >= 0 ? '+' : '') + f2(s.avg).padStart(6)}%`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv') && f !== 'NIFTY50.csv')
    .map(f => ({ fp: path.join(DATA_DIR, f) }));

  process.stdout.write(`${bar}\n  IMPROVEMENT SCAN — 5 AXES\n  Universe: ${files.length} stocks  OOS: 2023-2026  Workers: ${WORKERS}\n${bar}\n\n`);
  process.stdout.write('  Phase 1: scanning (collecting signals + candles)...\n');

  // Split files across workers
  const chunks = Array.from({ length: WORKERS }, () => []);
  files.forEach((f, i) => chunks[i % WORKERS].push(f));

  const allSignals = await Promise.all(chunks.map(chunk => new Promise((res, rej) => {
    const w = new Worker(__filename, {
      workerData: { files: chunk, engineDir: ENGINE_DIR, scanCfg: SCAN_CFG.map(p => ({ ...p, stages: [...p.stages] })) },
    });
    w.on('message', m => m.type === 'done' && res(m.signals));
    w.on('error', rej);
  }))).then(batches => batches.flat());

  // Reconstruct stages Sets (serialized as arrays from worker)
  const scanCfgMap = Object.fromEntries(SCAN_CFG.map(p => [p.key, p]));

  process.stdout.write(`  Phase 1 done. Total signals: ${allSignals.length}\n\n`);
  SCAN_CFG.forEach(p => {
    const n = allSignals.filter(s => s.key === p.key).length;
    process.stdout.write(`  ${p.label.padEnd(18)}: ${n}\n`);
  });

  // Load Nifty for RS gate
  process.stdout.write('\n  Loading Nifty50 for RS gate...\n');
  const nifty = loadNifty(NIFTY_FP);
  // Attach rs_delta to each signal
  for (const s of allSignals) {
    if (s.stockRet20 === null) { s.rs_delta = null; continue; }
    const nC  = niftyAt(nifty, s.ts);
    const nC0 = niftyAt(nifty, s.ts20back);
    if (!nC || !nC0 || nC0 <= 0) { s.rs_delta = null; continue; }
    const niftyRet = nC / nC0 - 1;
    s.rs_delta = s.stockRet20 - niftyRet;
  }

  const lines_out = [];
  const out = s => { lines_out.push(s); process.stdout.write(s + '\n'); };

  out(`\n${bar}`);
  out(`  AXIS 1 — ORS REVERSAL TP SWEEP  (SL=5×ATR, maxHold=10)`);
  out(bar);
  out(`  ${'Config'.padEnd(30)} ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'PF'.padStart(5)}  ${'avg%'.padStart(7)}`);
  out(`  ${line}`);
  const ors = allSignals.filter(s => s.key === 'ors_prime_reversal');
  for (const tp of [3, 4, 5, 6]) {
    const s = calcStats(ors, tp, 5.0, 10);
    out(row(`ORS TP=${tp}%`, s));
  }

  out(`\n${bar}`);
  out(`  AXIS 2 — CC PRECISION: tradePromoted gate  (TP=3%, SL=2.5×ATR, maxHold=20)`);
  out(bar);
  const cc = allSignals.filter(s => s.key === 'optimized_highprecision_15plus');
  const ccBase = calcStats(cc, 3, 2.5, 20);
  const ccProm = calcStats(cc.filter(s => s.promoted), 3, 2.5, 20);
  out(row('CC baseline (uc≥50)', ccBase));
  out(row('CC + tradePromoted gate', ccProm));
  out(`  (tradePromoted in engine: ucScore≥60 + stopGap≥3% + T1 range sane)`);

  out(`\n${bar}`);
  out(`  AXIS 3 — EMA STACK STAGE EXPANSION  (TP=3%, SL=5×ATR, maxHold=20)`);
  out(bar);
  const ema = allSignals.filter(s => s.key === 'optimized_ultraselective_8plus');
  const emaPB = ema.filter(s => s.stage === 'PRE_BREAKOUT');
  const emaSB = ema.filter(s => s.stage === 'STRONG_BUY');
  const emaBoth = ema.filter(s => s.stage === 'PRE_BREAKOUT' || s.stage === 'STRONG_BUY');
  out(row('EMA Stack PB only (baseline)', calcStats(emaPB, 3, 5.0, 20)));
  out(row('EMA Stack SB only', calcStats(emaSB, 3, 5.0, 20)));
  out(row('EMA Stack PB+SB combined', calcStats(emaBoth, 3, 5.0, 20)));

  out(`\n${bar}`);
  out(`  AXIS 4 — VF SCOUT TP SWEEP  (SL=5×ATR, maxHold=20) + DYNAMIC SL IMPACT`);
  out(bar);
  const vf = allSignals.filter(s => s.key === 'optimized_deployable_20plus');
  for (const tp of [2, 3, 4, 5, 6, 7, 8]) {
    out(row(`VF TP=${tp}% SL=5× H≤20`, calcStats(vf, tp, 5.0, 20)));
  }
  out(row('VF TP=5% + breakeven lock', calcStats(vf, 5, 5.0, 20, { belock: true })));
  out(row('VF TP=5% + time stop', calcStats(vf, 5, 5.0, 20, { tstop: true })));
  out(row('VF TP=5% + both', calcStats(vf, 5, 5.0, 20, { belock: true, tstop: true })));

  out(`\n${bar}`);
  out(`  AXIS 4b — SNIPER PS v20 PARAMS  (TP=3%, SL=2.5×ATR, maxHold=8) vs DYNAMIC SL FEATURES`);
  out(bar);
  const ps = allSignals.filter(s => s.key === 'sniper_95plus');
  out(row('PS v20 baseline  (TP=3%, SL=2.5×, H≤8)', calcStats(ps, 3, 2.5, 8)));
  out(row('PS + breakeven lock', calcStats(ps, 3, 2.5, 8, { belock: true })));
  out(row('PS + time stop', calcStats(ps, 3, 2.5, 8, { tstop: true })));
  out(row('PS + breakeven + time stop', calcStats(ps, 3, 2.5, 8, { belock: true, tstop: true })));
  out(row('PS OLD (TP=1.5%, SL=2.5×, H≤8)', calcStats(ps, 1.5, 2.5, 8)));

  out(`\n${bar}`);
  out(`  AXIS 5 — RELATIVE STRENGTH GATE (stock 20d return vs Nifty 20d return)`);
  out(`  rs_delta = stock_ret_20d - nifty_ret_20d  |  >0 = outperforming index`);
  out(bar);

  const TRADEABLES = [
    { key: 'optimized_deployable_20plus',    label: 'VF Scout',     tp: 5, sl: 5.0, maxHold: 20 },  // v21
    { key: 'optimized_highprecision_15plus', label: 'CC Precision', tp: 3, sl: 2.5, maxHold: 20 },
    { key: 'optimized_ultraselective_8plus', label: 'EMA Stack',    tp: 3, sl: 5.0, maxHold: 20 },
    { key: 'sniper_95plus',                  label: 'Sniper PS',    tp: 3, sl: 2.5, maxHold: 8  },  // v20
    { key: 'ors_prime_reversal',             label: 'ORS Reversal', tp: 3, sl: 5.0, maxHold: 10 },
  ];

  const RS_LABELS = [
    { label: 'No RS gate (baseline)',      fn: s => s.rs_delta !== null },
    { label: 'RS > 0%  (outperforming)',   fn: s => s.rs_delta !== null && s.rs_delta > 0 },
    { label: 'RS > 3%  (strong RS)',       fn: s => s.rs_delta !== null && s.rs_delta > 0.03 },
    { label: 'RS > 5%  (very strong RS)',  fn: s => s.rs_delta !== null && s.rs_delta > 0.05 },
    { label: 'RS > 10% (dominant RS)',     fn: s => s.rs_delta !== null && s.rs_delta > 0.10 },
  ];

  out(`\n  ── Combined tradeable pool ──`);
  out(`  ${'RS filter'.padEnd(30)} ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'PF'.padStart(5)}  ${'avg%'.padStart(7)}`);
  out(`  ${line}`);
  for (const rsl of RS_LABELS) {
    const pool = [];
    for (const p of TRADEABLES) {
      const sigs = allSignals.filter(s => s.key === p.key && rsl.fn(s));
      const res = sigs.map(s => simFC(s.candles, p.tp, p.sl, s.atr, p.maxHold)).filter(Boolean);
      pool.push(...res);
    }
    const N = pool.length;
    const wins = pool.filter(r => r.hitTP);
    const losses = pool.filter(r => !r.hitTP);
    const gW = wins.reduce((a, r) => a + r.pnl, 0);
    const gL = losses.reduce((a, r) => a + Math.abs(r.pnl), 0);
    const pf = gL > 0 ? gW / gL : wins.length > 0 ? 99 : 0;
    const avg = N ? pool.reduce((a, r) => a + r.pnl, 0) / N : 0;
    out(row(rsl.label, { N, wr: N ? wins.length / N * 100 : 0, pf, avg }));
  }

  out(`\n  ── Per param RS breakdown ──`);
  for (const p of TRADEABLES) {
    out(`\n  ${p.label}`);
    out(`  ${'RS filter'.padEnd(30)} ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'PF'.padStart(5)}  ${'avg%'.padStart(7)}`);
    out(`  ${line}`);
    for (const rsl of RS_LABELS) {
      const sigs = allSignals.filter(s => s.key === p.key && rsl.fn(s));
      out(row(rsl.label, calcStats(sigs, p.tp, p.sl, p.maxHold)));
    }
  }

  out(`\n${bar}`);
  out(`  AXIS 6 — DYNAMIC SL: ALL ARCHETYPES (breakeven lock + time stop)`);
  out(`  Breakeven lock: SL→entry once close > entry+1×ATR`);
  out(`  Time stop: exit at bar ceil(maxHold/2) if close < entry+0.3×TP`);
  out(bar);
  out(`  ${'Config'.padEnd(40)} ${'N'.padStart(5)}  ${'WR%'.padStart(6)}  ${'PF'.padStart(5)}  ${'avg%'.padStart(7)}`);
  out(`  ${line}`);
  const DYNMODES = [
    { label: 'v20 baseline',           opts: {} },
    { label: 'v20 + breakeven lock',   opts: { belock: true } },
    { label: 'v20 + time stop',        opts: { tstop: true } },
    { label: 'v20 + both',             opts: { belock: true, tstop: true } },
  ];
  for (const mode of DYNMODES) {
    const pool = [];
    for (const p of TRADEABLES) {
      const sigs = allSignals.filter(s => s.key === p.key);
      const res = sigs.map(s => simFC(s.candles, p.tp, p.sl, s.atr, p.maxHold, mode.opts)).filter(Boolean);
      pool.push(...res);
    }
    const N = pool.length;
    const wins = pool.filter(r => r.hitTP);
    const losses = pool.filter(r => !r.hitTP);
    const gW = wins.reduce((a, r) => a + r.pnl, 0);
    const gL = losses.reduce((a, r) => a + Math.abs(r.pnl), 0);
    const pf = gL > 0 ? gW / gL : wins.length > 0 ? 99 : 0;
    const avg = N ? pool.reduce((a, r) => a + r.pnl, 0) / N : 0;
    out(row(mode.label.padEnd(40), { N, wr: N ? wins.length / N * 100 : 0, pf, avg }));
  }

  out(`\n${bar}`);
  out(`  DONE`);
  out(`  Saved: ${OUT_FILE}\n`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines_out.join('\n'), 'utf8');
})();
