// Breakout Model Sweep — forward MFE/MAE backtest over the NSE universe.
//
// Scores the 5 breakout-level models (+ confluence + the CURRENT 5%-move trigger
// as a baseline) on real data: for every signal, measures the biggest forward
// run-up (MFE), the drawdown (MAE), follow-through, and forward return.
// Ranks each model's param grid by fitness = ftRate×meanMFE − (1−ftRate)×|meanMAE|.
//
// Usage:
//   node scripts/breakoutModelSweep.js               # full universe
//   node scripts/breakoutModelSweep.js --limit 200   # quick smoke run
//   node scripts/breakoutModelSweep.js --horizon 10  # override forward window

const fs = require('fs');
const path = require('path');

const bm = require('./_compiled_current/breakoutModels');
const bt = require('./_compiled_current/mfeBacktest');

const CSV_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_CANDLES = 320;

// ── args ──
const args = process.argv.slice(2);
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const LIMIT   = parseInt(argVal('--limit', '0'), 10);
const HORIZON = parseInt(argVal('--horizon', '20'), 10);

// ── CSV loader (format: DATE,OPEN,HIGH,LOW,CLOSE,VOLUME,ADJ_CLOSE) ──
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDate(s) { const [d, m, y] = s.split('-'); return new Date(+y, MONTHS[m], +d).getTime() / 1000; }

function loadCSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!isFinite(c) || c <= 0 || !isFinite(h) || !isFinite(l) || !isFinite(o) || !isFinite(v)) continue;
    if (h < l || h < c || l > c) continue;
    candles.push({ ts: parseDate(p[0]), o, h, l, c, v });
  }
  return candles;
}

// ── param grids ──
const HH_WINDOWS = [20, 50, 63, 126, 252];

const GRIDS = {
  Donchian: bt.grid({ N: [20, 50, 63, 126, 252], volMult: [0, 1.5] }),
  Swing:    bt.grid({ k: [2, 3], lookback: [40, 60], volMult: [0, 1.5] }),
  VCP:      bt.grid({ maxBase: [30, 45], maxTightPct: [6, 10], maxDepthPct: [25, 35], minVolMult: [1.5], near52wPct: [15, 25], requireVolDecline: [true] }),
  Pocket:   bt.grid({ emaPeriod: [10, 50], maxExtPct: [5, 10] }),
  NewHigh:  bt.grid({ N: [126, 252], volMult: [1.5], maxAbovePct: [3, 8] }),
};

const MAKERS = {
  Donchian: (p) => (c, i, ctx) => bm.modelDonchian(c, i, p, ctx),
  Swing:    (p) => (c, i, ctx) => bm.modelSwing(c, i, p, ctx),
  VCP:      (p) => (c, i, ctx) => bm.modelVCP(c, i, p, ctx),
  Pocket:   (p) => (c, i, ctx) => bm.modelPocketPivot(c, i, p, ctx),
  NewHigh:  (p) => (c, i, ctx) => bm.modelNewHigh(c, i, p, ctx),
};

// Baseline: the CURRENT detection trigger — a ≥5% close-to-close move on ≥3× vol.
// Level = prior close (so follow-through = still above the launch close).
function currentTrigger(c, i, ctx) {
  if (i < 1) return { isBreakout: false, level: 0, distancePct: 0, meta: {} };
  const prev = c[i - 1], cur = c[i];
  const movePct = (cur.c - prev.c) / prev.c * 100;
  const av = ctx.avgVol20[i];
  const volOk = av > 0 && cur.v >= 3 * av;
  return { isBreakout: movePct >= 5 && movePct <= 25 && volOk, level: prev.c, distancePct: movePct, meta: {} };
}

const CFG = { horizon: HORIZON, ftBars: 5, entryMode: 'close', warmup: 260, cooldown: 5 };

// ── load universe + build ctx once ──
console.log(`Loading universe from ${CSV_DIR} …`);
let files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
if (LIMIT > 0) files = files.slice(0, LIMIT);

const universe = [];
let skipped = 0;
for (const f of files) {
  const candles = loadCSV(path.join(CSV_DIR, f));
  if (candles.length < MIN_CANDLES) { skipped++; continue; }
  const ctx = bm.buildCtx(candles, HH_WINDOWS);
  universe.push({ candles, ctx, symbol: f.replace(/_NS_OHLCV\.csv$/, '') });
}
console.log(`Loaded ${universe.length} symbols (${skipped} skipped for <${MIN_CANDLES} candles). Horizon=${HORIZON}d.\n`);

// ── run sweeps ──
const fmt = (x, d = 2) => (x >= 0 ? ' ' : '') + x.toFixed(d);
const pct = (x) => (x * 100).toFixed(1) + '%';

function printRows(title, rows, describe, topN = 6) {
  console.log(`\n══ ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`);
  console.log('  fitness  signals  ft%    MFE     MAE    fwdRet  win%   MFE/MAE  params');
  for (const r of rows.slice(0, topN)) {
    const a = r.agg;
    console.log(
      `  ${fmt(a.fitness).padStart(7)}  ${String(a.signals).padStart(6)}  ${pct(a.ftRate).padStart(5)}  ` +
      `${fmt(a.meanMFE).padStart(6)}  ${fmt(a.meanMAE).padStart(6)}  ${fmt(a.meanFwdRet).padStart(6)}  ` +
      `${pct(a.winRate).padStart(5)}  ${fmt(a.mfeMaeRatio).padStart(6)}   ${describe(r.params)}`,
    );
  }
}

const leaderboard = [];
for (const [name, paramList] of Object.entries(GRIDS)) {
  const t0 = Date.now();
  const rows = bt.sweep(universe, paramList, MAKERS[name], CFG);
  const describe = (p) => Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' ');
  printRows(`${name}  (${paramList.length} configs, ${((Date.now() - t0) / 1000).toFixed(1)}s)`, rows, describe);
  if (rows[0]) leaderboard.push({ model: name, ...rows[0].agg, params: describe(rows[0].params) });
}

// baseline
{
  const all = [];
  for (const u of universe) for (const e of bt.runSymbol(u.candles, u.ctx, currentTrigger, CFG)) all.push(e);
  const a = bt.aggregate(all);
  printRows('BASELINE — current 5%-move trigger', [{ params: {}, agg: a }], () => 'movePct≥5 & vol≥3×');
  leaderboard.push({ model: 'CURRENT-5%', ...a, params: 'movePct≥5 & vol≥3×' });
}

// ── final leaderboard (best config per model) ──
leaderboard.sort((a, b) => b.fitness - a.fitness);
console.log(`\n\n╔══ LEADERBOARD — best config per model, ranked by fitness ${'═'.repeat(18)}`);
console.log('  model         fitness  signals  ft%    MFE     MAE    fwdRet  win%   params');
for (const r of leaderboard) {
  console.log(
    `  ${r.model.padEnd(12)} ${fmt(r.fitness).padStart(7)}  ${String(r.signals).padStart(6)}  ${pct(r.ftRate).padStart(5)}  ` +
    `${fmt(r.meanMFE).padStart(6)}  ${fmt(r.meanMAE).padStart(6)}  ${fmt(r.meanFwdRet).padStart(6)}  ${pct(r.winRate).padStart(5)}  ${r.params}`,
  );
}
console.log('\nHigher fitness = level whose breach more reliably precedes big momentum.');
console.log('MFE = avg biggest forward run-up · MAE = avg drawdown · ft% = held above level after 5d.\n');
