// GA Breakout Parameter Optimizer — Sprint 3
//
// Evolves optimal params for the top 3 breakout models (Donchian, NewHigh, VCP)
// using a real genetic algorithm:  tournament selection + BLX-0 crossover + Gaussian
// mutation + elite preservation.  Fitness = winRate×meanMFE − (1−winRate)×|meanMAE|
//
// Usage:
//   node scripts/gaBreakoutSweep.js                     # all 3 models, full universe
//   node scripts/gaBreakoutSweep.js --model VCP         # single model
//   node scripts/gaBreakoutSweep.js --pop 30 --gen 15   # faster run
//   node scripts/gaBreakoutSweep.js --limit 400         # subsample (~¼ universe, ~8× faster)
//   node scripts/gaBreakoutSweep.js --horizon 10        # shorter forward window
//
// Runtime estimate: ~30-50 min for all 3 models, full universe, pop=50 gen=25

'use strict';

const fs   = require('fs');
const path = require('path');
const bm   = require('./_compiled_current/breakoutModels');
const bt   = require('./_compiled_current/mfeBacktest');

// ── CLI args ──────────────────────────────────────────────────────────────────
const ARGS    = process.argv.slice(2);
const argVal  = (f, d) => { const i = ARGS.indexOf(f); return i >= 0 ? ARGS[i + 1] : d; };
const LIMIT       = parseInt(argVal('--limit',      '0'),  10);
const POP         = parseInt(argVal('--pop',        '50'),  10);
const GEN         = parseInt(argVal('--gen',        '25'),  10);
const HORIZON     = parseInt(argVal('--horizon',    '20'),  10);
const MODEL_F     = argVal('--model', '').toUpperCase();
const MIN_SIGNALS = parseInt(argVal('--minSignals', '0'),   10);

// Apply minSignals hard floor: candidates below the threshold are rejected
function calcFitness(agg) {
  if (MIN_SIGNALS > 0 && agg.signals < MIN_SIGNALS) return -999 + agg.signals * 0.001;
  return agg.fitness;
}

// ── Universe ──────────────────────────────────────────────────────────────────
const CSV_DIR     = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_CANDLES = 320;
const HH_WINDOWS  = [20, 50, 63, 126, 252];
const MONTHS      = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseDate(s) {
  const [d, m, y] = s.split('-');
  return new Date(+y, MONTHS[m], +d).getTime() / 1000;
}

function loadCSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!isFinite(c) || c <= 0 || !isFinite(h) || !isFinite(l) || !isFinite(o) || !isFinite(v)) continue;
    if (h < l || h < c || l > c) continue;
    out.push({ ts: parseDate(p[0]), o, h, l, c, v });
  }
  return out;
}

process.stdout.write('Loading universe … ');
let files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
if (LIMIT > 0) {
  // Deterministic subsample: sort by name then stride-pick so we get geographic spread
  files = files.sort();
  const step = Math.max(1, Math.floor(files.length / LIMIT));
  files = files.filter((_, i) => i % step === 0).slice(0, LIMIT);
}
const universe = [];
for (const f of files) {
  const candles = loadCSV(path.join(CSV_DIR, f));
  if (candles.length >= MIN_CANDLES) universe.push({ candles, ctx: bm.buildCtx(candles, HH_WINDOWS) });
}
console.log(`${universe.length} symbols  horizon=${HORIZON}d  pop=${POP}  gen=${GEN}\n`);

// ── Backtest config ───────────────────────────────────────────────────────────
const CFG = { horizon: HORIZON, ftBars: 5, entryMode: 'close', warmup: 260, cooldown: 5 };

// ── Core fitness evaluator ────────────────────────────────────────────────────
function evaluate(makeFn) {
  const all = [];
  for (const u of universe) {
    const exs = bt.runSymbol(u.candles, u.ctx, makeFn, CFG);
    for (const e of exs) all.push(e);
  }
  return bt.aggregate(all);
}

// ── GA primitives ─────────────────────────────────────────────────────────────
function rand(lo, hi)  { return Math.random() * (hi - lo) + lo; }
function randI(lo, hi) { return Math.round(rand(lo, hi)); }
function cf(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function ci(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

// BLX-0 crossover: pick uniform from [min(a,b), max(a,b)]
function blx(a, b)  { return rand(Math.min(a, b), Math.max(a, b)); }

// Tournament selection from sorted population (index 0 = fittest)
function tournament(pop, k) {
  let best = pop[randI(0, pop.length - 1)];
  for (let i = 1; i < k; i++) {
    const c = pop[randI(0, pop.length - 1)];
    if (c.fitness > best.fitness) best = c;
  }
  return best;
}

// ── Model definitions ─────────────────────────────────────────────────────────
//
// Each def has:  init() → params,  mutate(params) → params,
//                crossover(a,b) → params,  make(params) → ModelFn,  fmt(params) → string
//
// Search spaces are wider than the coarse grid to allow genuine exploration.

const DEFS = {

  DONCHIAN: {
    // N-day highest-high breakout with volume filter.
    // Grid best: N=252, volMult=1.5  (fitness 2.82)
    // Search: N ∈ [50,400], volMult ∈ [0,4]
    init: () => ({ N: randI(80, 320), volMult: rand(0.3, 3.5) }),
    mutate: (p) => ({
      N:       ci(p.N       + randI(-50, 50),  20, 450),
      volMult: cf(p.volMult + rand(-0.5, 0.5),  0,   5),
    }),
    crossover: (a, b) => ({
      N:       ci(blx(a.N, b.N), 20, 450),
      volMult: cf(blx(a.volMult, b.volMult), 0, 5),
    }),
    make: (p) => (c, i, ctx) => bm.modelDonchian(c, i, { N: Math.round(p.N), volMult: p.volMult }, ctx),
    fmt:  (p) => `N=${Math.round(p.N)}  volMult=${p.volMult.toFixed(2)}`,
  },

  NEWHIGH: {
    // N-day high with volume filter + not-too-extended cap (maxAbovePct).
    // Grid best: N=252, volMult=1.5, maxAbovePct=8  (fitness 2.80)
    // Search: N ∈ [50,400], volMult ∈ [0,4], maxAbovePct ∈ [1,25]
    init: () => ({ N: randI(80, 320), volMult: rand(0.3, 3.5), maxAbovePct: rand(1, 20) }),
    mutate: (p) => ({
      N:           ci(p.N           + randI(-50, 50),  20, 450),
      volMult:     cf(p.volMult     + rand(-0.5, 0.5),  0,   5),
      maxAbovePct: cf(p.maxAbovePct + rand(-2.5, 2.5),  0.5, 30),
    }),
    crossover: (a, b) => ({
      N:           ci(blx(a.N, b.N), 20, 450),
      volMult:     cf(blx(a.volMult, b.volMult), 0, 5),
      maxAbovePct: cf(blx(a.maxAbovePct, b.maxAbovePct), 0.5, 30),
    }),
    make: (p) => (c, i, ctx) => bm.modelNewHigh(c, i, {
      N: Math.round(p.N), volMult: p.volMult, maxAbovePct: p.maxAbovePct,
    }, ctx),
    fmt: (p) => `N=${Math.round(p.N)}  volMult=${p.volMult.toFixed(2)}  maxAbovePct=${p.maxAbovePct.toFixed(1)}`,
  },

  VCP: {
    // Volatility Contraction Pattern — tight coil near 52W highs.
    // Grid best: maxBase=30, maxTightPct=10, maxDepthPct=25, minVolMult=1.5,
    //            near52wPct=15, requireVolDecline=true  (fitness 2.80, best win%)
    // Search: all 5 continuous params wider + boolean free to flip
    init: () => ({
      maxBase:          rand(10, 65),
      maxTightPct:      rand(3,  22),
      maxDepthPct:      rand(12, 50),
      minVolMult:       rand(0.6, 3.0),
      near52wPct:       rand(5,  50),
      requireVolDecline: Math.random() < 0.5,
    }),
    mutate: (p) => ({
      maxBase:          cf(p.maxBase      + rand(-7,  7),   5,  80),
      maxTightPct:      cf(p.maxTightPct  + rand(-2,  2),   2,  28),
      maxDepthPct:      cf(p.maxDepthPct  + rand(-5,  5),   8,  60),
      minVolMult:       cf(p.minVolMult   + rand(-0.3, 0.3), 0.3, 4),
      near52wPct:       cf(p.near52wPct   + rand(-5,  5),   3,  60),
      requireVolDecline: Math.random() < 0.12 ? !p.requireVolDecline : p.requireVolDecline,
    }),
    crossover: (a, b) => ({
      maxBase:          cf(blx(a.maxBase,     b.maxBase),      5, 80),
      maxTightPct:      cf(blx(a.maxTightPct, b.maxTightPct),  2, 28),
      maxDepthPct:      cf(blx(a.maxDepthPct, b.maxDepthPct),  8, 60),
      minVolMult:       cf(blx(a.minVolMult,  b.minVolMult),  0.3, 4),
      near52wPct:       cf(blx(a.near52wPct,  b.near52wPct),   3, 60),
      requireVolDecline: Math.random() < 0.5 ? a.requireVolDecline : b.requireVolDecline,
    }),
    make: (p) => (c, i, ctx) => bm.modelVCP(c, i, {
      maxBase:          p.maxBase,
      maxTightPct:      p.maxTightPct,
      maxDepthPct:      p.maxDepthPct,
      minVolMult:       p.minVolMult,
      near52wPct:       p.near52wPct,
      requireVolDecline: p.requireVolDecline,
    }, ctx),
    fmt: (p) =>
      `maxBase=${p.maxBase.toFixed(0)}  tight=${p.maxTightPct.toFixed(1)}  depth=${p.maxDepthPct.toFixed(0)}` +
      `  volMult=${p.minVolMult.toFixed(2)}  near52w=${p.near52wPct.toFixed(0)}  rvd=${p.requireVolDecline}`,
  },

};

// ── GA runner ─────────────────────────────────────────────────────────────────
const ELITE_FRAC = 0.08;   // top 8% survive unchanged
const TOUR_K     = 5;      // tournament size
const MUT_RATE   = 0.45;   // per-individual mutation probability

function rowStr(gen, r, def, marker) {
  const a = r.agg;
  return (
    `  ${String(gen).padStart(3)}  ` +
    `${r.fitness.toFixed(4).padStart(8)}  ` +
    `${String(a.signals).padStart(7)}  ` +
    `${(a.winRate * 100).toFixed(1).padStart(5)}%  ` +
    `${a.meanMFE.toFixed(2).padStart(6)}  ` +
    `${a.meanMAE.toFixed(2).padStart(7)}  ` +
    `${a.meanFwdRet.toFixed(2).padStart(6)}` +
    `  ${marker}  ${def.fmt(r.params)}`
  );
}

function runGA(name, def) {
  const t0 = Date.now();
  const eliteN = Math.max(2, Math.round(POP * ELITE_FRAC));

  console.log(`${'═'.repeat(80)}`);
  console.log(`  GA: ${name}   pop=${POP}  gen=${GEN}  elite=${eliteN}  tournK=${TOUR_K}  mutRate=${MUT_RATE}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  gen   fitness  signals  win%    MFE     MAE   fwdRet  flag  params`);
  console.log(`${'─'.repeat(80)}`);

  // ── Initialize population ──
  process.stdout.write(`  Initializing ${POP} individuals`);
  let pop = [];
  for (let i = 0; i < POP; i++) {
    const params = def.init();
    const agg    = evaluate(def.make(params));
    pop.push({ params, agg, fitness: calcFitness(agg) });
    if ((i + 1) % 10 === 0) process.stdout.write('.');
  }
  process.stdout.write('\n');
  pop.sort((a, b) => b.fitness - a.fitness);

  let bestEver = { ...pop[0] };
  console.log(rowStr(0, bestEver, def, '⬆'));

  // ── Evolve ──
  for (let gen = 1; gen <= GEN; gen++) {
    // Elitism: carry forward the top eliteN unchanged
    const next = pop.slice(0, eliteN).map(x => ({ ...x }));

    while (next.length < POP) {
      const pa    = tournament(pop, TOUR_K).params;
      const pb    = tournament(pop, TOUR_K).params;
      let child   = def.crossover(pa, pb);
      if (Math.random() < MUT_RATE) child = def.mutate(child);
      const agg   = evaluate(def.make(child));
      next.push({ params: child, agg, fitness: calcFitness(agg) });
    }

    pop = next.sort((a, b) => b.fitness - a.fitness);

    const improved = pop[0].fitness > bestEver.fitness + 1e-6;
    if (improved) {
      bestEver = { ...pop[0] };
      console.log(rowStr(gen, bestEver, def, '▲'));
    } else if (gen % 5 === 0 || gen === GEN) {
      console.log(rowStr(gen, pop[0], def, ' '));
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  BEST ${name} (${elapsed}s elapsed):`);
  console.log(`    fitness=${bestEver.fitness.toFixed(4)}  signals=${bestEver.agg.signals}` +
    `  win%=${(bestEver.agg.winRate * 100).toFixed(1)}` +
    `  MFE=${bestEver.agg.meanMFE.toFixed(2)}%` +
    `  MAE=${bestEver.agg.meanMAE.toFixed(2)}%` +
    `  fwdRet=${bestEver.agg.meanFwdRet.toFixed(2)}%` +
    `  MFE/MAE=${bestEver.agg.mfeMaeRatio.toFixed(2)}`);
  console.log(`    params: ${def.fmt(bestEver.params)}`);
  console.log('');

  return bestEver;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const toRun = MODEL_F
  ? Object.entries(DEFS).filter(([k]) => k === MODEL_F)
  : Object.entries(DEFS);

if (toRun.length === 0) {
  console.error(`Unknown model: ${MODEL_F}. Available: ${Object.keys(DEFS).join(', ')}`);
  process.exit(1);
}

const winners = {};
for (const [name, def] of toRun) {
  winners[name] = runGA(name, def);
}

// ── Final leaderboard ─────────────────────────────────────────────────────────
console.log('\n╔══ GA OPTIMAL PARAMS — copy these into the analyzer ══════════════════╗');
console.log('  model       fitness  signals   win%    MFE     MAE   fwdRet   params');
console.log('  ──────────────────────────────────────────────────────────────────────');
for (const [name, r] of Object.entries(winners)) {
  const a = r.agg;
  console.log(
    `  ${name.padEnd(10)}  ${r.fitness.toFixed(4).padStart(7)}  ` +
    `${String(a.signals).padStart(7)}  ` +
    `${(a.winRate * 100).toFixed(1).padStart(5)}%  ` +
    `${a.meanMFE.toFixed(2).padStart(6)}  ${a.meanMAE.toFixed(2).padStart(6)}  ` +
    `${a.meanFwdRet.toFixed(2).padStart(6)}   ${DEFS[name].fmt(r.params)}`
  );
}
console.log('\nNext step: wire winning params into lib/breakoutModels.ts → stockEngine.ts\n');

// Save results as JSON so you can resume or compare runs
const outFile = path.join(__dirname, `ga_results_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.writeFileSync(outFile, JSON.stringify(
  Object.fromEntries(Object.entries(winners).map(([k, v]) => [k, { params: v.params, agg: v.agg }])),
  null, 2,
));
console.log(`Results saved → ${outFile}`);
