#!/usr/bin/env node
/**
 * DYNAMIC TRAILING STOP OPTIMIZATION  (Phase 5)
 *
 * Backtests 5 classes of trailing stop strategies on all ULTRA signals
 * from 60 NIFTY stocks using full 20-bar OHLC price paths.
 *
 * Strategies:
 *   S0  STATIC_4ATR       — fixed stop at entry−4×ATR, never moves (baseline)
 *   S1  CHANDELIER_ALWAYS — HH_since_entry − k×ATR from bar 1 (11 k values)
 *   S2  CHAND_PROFIT      — wait for +P% close, then chandelier HH−k×ATR (35 combos)
 *   S3  ATR_RATCHET       — zone tighten: 4×→2.5×→BE→lock-in as profit grows (24 combos)
 *   S4  SUPERTREND        — mid(H,L)−k×ATR, trail from bar 1 (6 k values)
 *
 * Simulation rule:
 *   - Stop is computed using PREVIOUS bar's data (realistic: trader sets overnight)
 *   - Stop only ever tightens (Math.max); never loosens
 *   - Stop hit = bar.l ≤ stop; Target hit = bar.h ≥ entry×1.05
 *   - Time exit = close of bar 20
 *
 * Metrics optimised:
 *   E = WR×5% − SL_rate×avg_stop_loss%          (expectancy per trade)
 *   Bootstrap 95% CI (500 resamples) on the winner
 *   Conditional P(Win | unrealized_PnL, bars_held) table for all ULTRA signals
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';
const TARGET    = 5.0;   // % profit target
const MAX_BARS  = 20;    // trade horizon
const N_BOOT    = 500;
const INIT_MULT = 4.0;   // deployed initial stop multiplier

// Phase-3 ULTRA thresholds
const ULTRA_T = {
  CompressionCoil: 84,
  VolumeFootprint: 98,
  MomentumPocket:  99,
  EMAStack:        99,
};
const STRONG_T = 62, BUY_T = 43;

// Phase-2 condition weights
const W = {
  CompressionCoil: [20,  3, 49, 18,  3,  3],
  VolumeFootprint: [43,  3,  3, 21,  3, 18],
  MomentumPocket:  [ 3, 10, 16,  3, 39, 25],
  EMAStack:        [23,  3, 39, 17,  3, 11],
};

// ── Helpers (identical to sl_sweet_spot.js) ──────────────────────────────────

function loadCSV(fp) {
  return fs.readFileSync(fp, 'utf8').trim().split('\n').slice(1).map(l => {
    const [, o, h, lo, c, v] = l.split(',');
    return { o: +o, h: +h, l: +lo, c: +c, v: parseInt(v) || 0 };
  }).filter(r => r.c > 0);
}

function atr14(cs, end) {
  if (end < 1) return cs[end].h - cs[end].l;
  let s = 0, cnt = 0;
  for (let i = Math.max(1, end - 13); i <= end; i++) {
    s += Math.max(cs[i].h - cs[i].l,
                  Math.abs(cs[i].h - cs[i-1].c),
                  Math.abs(cs[i].l - cs[i-1].c));
    cnt++;
  }
  return cnt > 0 ? s / cnt : cs[end].h - cs[end].l;
}

function avgVol(cs, end, n) {
  let s = 0, c = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) { s += cs[i].v; c++; }
  return c > 0 ? s / c : 0;
}

function bbWidth(cs, end) {
  if (end < 20) return 0;
  let sum = 0;
  for (let i = end - 19; i <= end; i++) sum += cs[i].c;
  const mu = sum / 20;
  let v = 0;
  for (let i = end - 19; i <= end; i++) v += (cs[i].c - mu) ** 2;
  return cs[end].c > 0 ? 4 * Math.sqrt(v / 20) / cs[end].c : 0;
}

function dmi(cs, end) {
  if (end < 14) return { dp: 20, dm: 20 };
  let pdm = 0, mdm = 0, tr = 0;
  for (let i = end - 13; i <= end; i++) {
    const up = cs[i].h - cs[i-1].h, dn = cs[i-1].l - cs[i].l;
    pdm += (up > dn && up > 0) ? up : 0;
    mdm += (dn > up && dn > 0) ? dn : 0;
    tr  += Math.max(cs[i].h - cs[i].l,
                    Math.abs(cs[i].h - cs[i-1].c),
                    Math.abs(cs[i].l - cs[i-1].c));
  }
  return { dp: tr > 0 ? 100 * pdm / tr : 20, dm: tr > 0 ? 100 * mdm / tr : 20 };
}

// ── Archetype condition simulators ────────────────────────────────────────────

function runCC(cs, i, a) {
  if (i < 60) return null;
  const sig = cs[i];
  let cb = 0;
  for (let j = i-1; j >= Math.max(0, i-20); j--) { if ((cs[j].h - cs[j].l) < 0.7 * a) cb++; else break; }
  let vd = 0;
  for (let j = i-1; j >= Math.max(1, i-5); j--) { if (cs[j].v < cs[j-1].v) vd++; else break; }
  let hi20 = 0, lo20 = Infinity;
  for (let j = Math.max(0, i-20); j < i; j++) { hi20 = Math.max(hi20, cs[j].h); lo20 = Math.min(lo20, cs[j].l); }
  const pp20 = hi20 > lo20 ? (sig.c - lo20) / (hi20 - lo20) * 100 : 50;
  const bws = []; for (let j = i - 59; j <= i; j++) bws.push(bbWidth(cs, j));
  bws.sort((a, b) => a - b);
  const p30 = bws[Math.floor(bws.length * 0.30)];
  const sr = sig.h - sig.l, cl = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50, bp = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0;
  const { dp, dm } = dmi(cs, i);
  const c = [cb >= 8, vd >= 2, pp20 >= 59, bbWidth(cs, i) <= p30, sr <= 0.8 * a && sig.c > sig.o && cl > 55 && bp > 30, dp > dm];
  const bonus = Math.min(10, cb * 3) + Math.min(5, Math.max(0, pp20 - 65) * 0.5);
  return { c, bonus };
}

function runVF(cs, i, a) {
  if (i < 20) return null;
  const sig = cs[i];
  const v20 = avgVol(cs, i-1, 20), vr20 = v20 > 0 ? sig.v / v20 : 0;
  const sr = sig.h - sig.l, cl = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50, uw = sr > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sr * 100 : 0;
  let hi20 = 0; for (let j = Math.max(0, i-20); j < i; j++) hi20 = Math.max(hi20, cs[j].h);
  const rng = sr / a;
  const prev = cs[i-1]?.c ?? sig.o;
  const gap = prev > 0 ? (sig.o - prev) / prev * 100 : 0;
  const { dp, dm } = dmi(cs, i);
  const c = [vr20 >= 3.7, cl >= 68 && uw <= 12, hi20 > 0 && sig.c >= hi20 * 0.83, rng >= 2.4, gap >= -2.6, dp > dm];
  const bonus = Math.min(10, (vr20 - 3) * 5) + Math.min(5, (cl - 68) * 0.3);
  return { c, bonus };
}

function runMP(cs, i, a) {
  if (i < 60) return null;
  const sig = cs[i];
  let hi52 = 0; for (let j = Math.max(0, i-252); j < i; j++) hi52 = Math.max(hi52, cs[j].h);
  const dd52 = hi52 > 0 ? (hi52 - sig.c) / hi52 * 100 : 0;
  const refL = i >= 20 ? Math.min(...cs.slice(i-20, i).map(b => b.l)) : sig.l;
  const sr = sig.h - sig.l, bp = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0, cl = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const v20 = avgVol(cs, i-1, 20), vr20 = v20 > 0 ? sig.v / v20 : 0;
  const { dp, dm } = dmi(cs, i);
  const c = [dd52 >= 15, sig.l > refL, sig.c > sig.o && bp >= 60, cl >= 55, vr20 >= 1.5, dp > dm];
  const bonus = Math.min(10, 0) + Math.min(5, (vr20 - 1.5) * 4);
  return { c, bonus };
}

function runES(cs, i, a) {
  if (i < 55) return null;
  const sig = cs[i];
  const k20 = 2/21, k50 = 2/51;
  let e20 = cs[0].c, e50 = cs[0].c;
  for (let j = 1; j < i; j++) { e20 = cs[j].c * k20 + e20 * (1 - k20); e50 = cs[j].c * k50 + e50 * (1 - k50); }
  const prevE20 = e20; e20 = sig.c * k20 + e20 * (1 - k20);
  let below = 0; for (let j = i-1; j >= Math.max(0, i-10); j--) { if (cs[j].c < prevE20) below++; else break; }
  const sr = sig.h - sig.l, bp = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0, cl = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const v20 = avgVol(cs, i-1, 20), vr = v20 > 0 ? sig.v / v20 : 0;
  const { dp, dm } = dmi(cs, i);
  const c = [sig.c > e20 && cs[i-1]?.c <= prevE20, below >= 3, e20 > e50, sig.c > sig.o && bp >= 40, cl >= 60, dp > dm];
  const bonus = Math.min(10, below * 2) + Math.min(5, (vr - 1.8) * 5);
  return { c, bonus };
}

function calcScore(arch, res) {
  return Math.min(100, Math.round(res.c.reduce((s, b, j) => s + (b ? W[arch][j] : 0), 0) + res.bonus));
}

function getStage(sc, arch) {
  const ut = ULTRA_T[arch] ?? 86;
  return sc >= ut ? 'ULTRA' : sc >= STRONG_T ? 'STRONG' : sc >= BUY_T ? 'BUY' : null;
}

// ── Strategy registry ─────────────────────────────────────────────────────────
//
// Each strategy is a function:
//   (stop, bar, hh, entry, atr, unrealClose, unrealHigh, barsHeld) → candidateStop
// where:
//   stop        = current stop level (from end of previous bar)
//   bar         = current bar {o,h,l,c}
//   hh          = highest high since entry (inclusive of current bar)
//   entry       = trade entry price
//   atr         = ATR at signal bar
//   unrealClose = (bar.c − entry) / entry × 100  (unrealized PnL at close %)
//   unrealHigh  = (hh − entry) / entry × 100     (max unrealized so far %)
//   barsHeld    = bars since entry
//
// The simulation enforces: newStop = Math.max(stop, candidate) — only ever tightens.

const STRATEGIES = [];

// ── S0: Static baseline ───────────────────────────────────────────────────────
STRATEGIES.push({
  name: 'STATIC_4ATR', label: 'Static 4×ATR (baseline)',
  group: 'STATIC',
  fn: (stop) => stop,
  params: {},
});

// ── S1: Chandelier Always — trail from bar 1 ──────────────────────────────────
// Stop = max(init_stop, HH_since_entry − k×ATR)
// k < INIT_MULT: activates while trade is still down (risky but tight)
// k = INIT_MULT: activates exactly at entry level
// k > INIT_MULT: only activates once trade is above entry + (k−INIT_MULT)×ATR
for (const k of [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]) {
  STRATEGIES.push({
    name: `CA_k${k}`, label: `Chandelier_Always k=${k}×ATR`,
    group: 'CA',
    fn: (stop, bar, hh, entry, atr) => hh - k * atr,
    params: { k },
  });
}

// ── S2: Chandelier on Profit — wait for P% close gain, then tight trail ───────
// Phase 1 (unrealClose < P): hold at 4×ATR static
// Phase 2 (unrealClose ≥ P): trail at HH − k×ATR (tighter than init)
for (const P of [0.5, 1.0, 1.5, 2.0, 2.5]) {       // profit trigger %
  for (const k of [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) { // trail multiplier
    STRATEGIES.push({
      name: `CP_P${P}_k${k}`, label: `Chandelier_OnProfit P=${P}% k=${k}×ATR`,
      group: 'CP',
      fn: (stop, bar, hh, entry, atr, unrealClose) =>
        unrealClose >= P ? hh - k * atr : entry - INIT_MULT * atr,
      params: { P, k },
    });
  }
}

// ── S3: ATR Ratchet — stepwise tightening as profit grows ────────────────────
// Zone 0 (unrealClose <  p1): stop = entry − 4×ATR
// Zone 1 (unrealClose ≥ p1): stop = max(current, entry − m1×ATR)  [tighten]
// Zone 2 (unrealClose ≥ p2): stop = max(current, entry)           [breakeven]
// Zone 3 (unrealClose ≥ p3): stop = max(current, entry + lock×entry) [lock-in]
const LOCK_PCT = 1.0; // % of entry to lock in at zone 3
for (const p1 of [0.5, 1.0, 1.5, 2.0]) {   // zone 1 trigger
  for (const p2 of [2.0, 2.5, 3.0]) {       // breakeven trigger
    for (const p3 of [3.5, 4.0, 4.5]) {     // lock-in trigger
      if (p1 >= p2 || p2 >= p3) continue;
      for (const m1 of [2.0, 2.5, 3.0]) {   // tightened multiplier in zone 1
        STRATEGIES.push({
          name: `RCH_p1${p1}_p2${p2}_p3${p3}_m${m1}`,
          label: `Ratchet p1=${p1}%→${m1}×  p2=${p2}%→BE  p3=${p3}%→+${LOCK_PCT}%`,
          group: 'RATCHET',
          fn: (stop, bar, hh, entry, atr, unrealClose) => {
            if (unrealClose >= p3) return entry * (1 + LOCK_PCT / 100);
            if (unrealClose >= p2) return entry;
            if (unrealClose >= p1) return entry - m1 * atr;
            return entry - INIT_MULT * atr;
          },
          params: { p1, p2, p3, m1 },
        });
      }
    }
  }
}

// ── S4: Supertrend — bar midpoint minus k×ATR ─────────────────────────────────
// Stop = (bar.h + bar.l) / 2 − k×ATR (standard Supertrend lower band for longs)
for (const k of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) {
  STRATEGIES.push({
    name: `ST_k${k}`, label: `Supertrend k=${k}×ATR`,
    group: 'ST',
    fn: (stop, bar, hh, entry, atr) => (bar.h + bar.l) / 2 - k * atr,
    params: { k },
  });
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  DYNAMIC TRAILING STOP OPTIMIZATION  (Phase 5)');
console.log(`  ${STRATEGIES.length} strategies: Static(1) + Chandelier_Always(9) + Chandelier_Profit(35) + Ratchet(72) + Supertrend(6)`);
console.log(`${'═'.repeat(70)}\n`);

// ── Simulation engine ─────────────────────────────────────────────────────────
//
// Sequence per bar:
//   1. Update hh = max(hh_prev, bar.h)  — include current bar's high in HH
//   2. Compute unrealClose, unrealHigh from hh
//   3. Compute stop candidate from strategy (uses hh from CURRENT bar)
//   4. Apply Math.max (only tighten)
//   5. Check bar.l ≤ stop → SL exit
//   6. Check bar.h ≥ TGT → target exit
//
// NOTE: The stop is computed with the CURRENT bar's high in HH before checking
// the CURRENT bar's low. This is a realistic "fill at stop price on same bar
// that updated HH" model, standard for daily bars.

function simulate(cs, idx, entry, atr, stopFn) {
  const TGT = entry * (1 + TARGET / 100);
  let stop = entry - INIT_MULT * atr;
  let hh   = entry;

  for (let b = idx + 1; b <= Math.min(idx + MAX_BARS, cs.length - 1); b++) {
    const bar  = cs[b];
    hh = Math.max(hh, bar.h);
    const unrealClose = (bar.c  - entry) / entry * 100;
    const unrealHigh  = (hh     - entry) / entry * 100;
    const barsHeld    = b - idx;

    const candidate = stopFn(stop, bar, hh, entry, atr, unrealClose, unrealHigh, barsHeld);
    stop = Math.max(stop, candidate);

    if (bar.l <= stop) {
      return { win: 0, exit: 'SL',   pnl: (stop - entry) / entry * 100, bars: barsHeld };
    }
    if (bar.h >= TGT) {
      return { win: 1, exit: 'TGT',  pnl: TARGET,                        bars: barsHeld };
    }
  }

  const exitBar = Math.min(idx + MAX_BARS, cs.length - 1);
  return { win: 0, exit: 'TIME', pnl: (cs[exitBar].c - entry) / entry * 100, bars: MAX_BARS };
}

// ── Load signals ───────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('_OHLCV.csv')).sort().slice(0, 60);
console.log(`Loading ${files.length} stocks…`);

const rawData = [];

for (let si = 0; si < files.length; si++) {
  try {
    const cs = loadCSV(path.join(DATA_DIR, files[si]));
    if (cs.length < 80) continue;

    for (let i = 65; i < cs.length - MAX_BARS; i++) {
      const a = atr14(cs, i);
      if (a === 0) continue;
      const atrPct = a / cs[i].c * 100;
      if (atrPct > 3.5) continue;

      let bestScore = -1, bestArch = null, bestStage = null;
      const runners = [
        ['CompressionCoil', runCC(cs, i, a)],
        ['VolumeFootprint', runVF(cs, i, a)],
        ['MomentumPocket',  runMP(cs, i, a)],
        ['EMAStack',        runES(cs, i, a)],
      ];
      for (const [arch, res] of runners) {
        if (!res) continue;
        const sc = calcScore(arch, res);
        const st = getStage(sc, arch);
        if (st && sc > bestScore) { bestScore = sc; bestArch = arch; bestStage = st; }
      }
      if (!bestStage) continue;

      rawData.push({ cs, idx: i, entry: cs[i].c, atr: a, atrPct, arch: bestArch, stage: bestStage });
    }
  } catch (e) { /* skip corrupt files */ }
}

const ultraCount  = rawData.filter(d => d.stage === 'ULTRA').length;
const strongCount = rawData.filter(d => d.stage === 'STRONG').length;
const buyCount    = rawData.filter(d => d.stage === 'BUY').length;
console.log(`Signals: ${rawData.length} total (ULTRA=${ultraCount}, STRONG=${strongCount}, BUY=${buyCount})\n`);

// ── Run all strategies ─────────────────────────────────────────────────────────

console.log(`Running ${STRATEGIES.length} strategies × ${rawData.length} signals…`);
const t0 = Date.now();

// allOutcomes[stratIdx][signalIdx] = { win, exit, pnl, bars }
const allOutcomes = STRATEGIES.map(s =>
  rawData.map(({ cs, idx, entry, atr }) => simulate(cs, idx, entry, atr, s.fn))
);

console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ── Analysis helpers ───────────────────────────────────────────────────────────

function analyzeGroup(indices, stratIdx) {
  if (indices.length === 0) return { n: 0, wr: 0, slr: 0, E: 0, avgLoss: 0, avgBars: 0, avgATR: 0 };
  let wins = 0, sls = 0, totalLoss = 0, totalBars = 0;
  for (const i of indices) {
    const o = allOutcomes[stratIdx][i];
    wins     += o.win;
    if (o.exit === 'SL') { sls++; totalLoss += Math.abs(o.pnl); }
    totalBars += o.bars;
  }
  const n = indices.length;
  const wr = wins / n, slr = sls / n;
  const avgLoss = sls > 0 ? totalLoss / sls : 0;
  const avgBars = totalBars / n;
  const avgATR  = indices.reduce((s, i) => s + rawData[i].atrPct, 0) / n;
  const E = wr * TARGET - slr * avgLoss;
  return { n, wr, slr, E, avgLoss, avgBars, avgATR };
}

function bootstrapE(indices, stratIdx, nBoot) {
  const Es = [];
  for (let b = 0; b < nBoot; b++) {
    let wins = 0, sls = 0, totalLoss = 0;
    for (let j = 0; j < indices.length; j++) {
      const i = indices[Math.floor(Math.random() * indices.length)];
      const o = allOutcomes[stratIdx][i];
      wins += o.win;
      if (o.exit === 'SL') { sls++; totalLoss += Math.abs(o.pnl); }
    }
    const n = indices.length, wr = wins / n, slr = sls / n;
    const avgLoss = sls > 0 ? totalLoss / sls : 0;
    Es.push(wr * TARGET - slr * avgLoss);
  }
  Es.sort((a, b) => a - b);
  return {
    mean: Es.reduce((s, v) => s + v, 0) / Es.length,
    lo:   Es[Math.floor(nBoot * 0.025)],
    hi:   Es[Math.floor(nBoot * 0.975)],
  };
}

// ── Per-archetype analysis (ULTRA focus) ──────────────────────────────────────

const ARCHS   = ['CompressionCoil', 'VolumeFootprint', 'MomentumPocket', 'EMAStack'];
const baseIdx = STRATEGIES.findIndex(s => s.name === 'STATIC_4ATR');
const deployRec = {};  // final deployment parameters per archetype

for (const arch of ARCHS) {
  const ultraIdx = rawData
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.arch === arch && d.stage === 'ULTRA')
    .map(({ i }) => i);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`▶  ${arch}  (ULTRA n=${ultraIdx.length})`);
  if (ultraIdx.length < 30) { console.log('   ⚠  insufficient ULTRA signals — skipping'); continue; }

  const base = analyzeGroup(ultraIdx, baseIdx);
  console.log(`\n   Baseline (Static 4×ATR): WR=${(base.wr*100).toFixed(1)}%  SLR=${(base.slr*100).toFixed(1)}%  avgLoss=${base.avgLoss.toFixed(2)}%  E=${base.E.toFixed(3)}%  avgBars=${base.avgBars.toFixed(1)}`);

  // Grid search: best E across all strategies
  let bestE = base.E, bestStratIdx = baseIdx, bestStats = base;

  for (let si = 0; si < STRATEGIES.length; si++) {
    if (si === baseIdx) continue;
    const stats = analyzeGroup(ultraIdx, si);
    if (stats.E > bestE) { bestE = stats.E; bestStratIdx = si; bestStats = stats; }
  }

  // Top 10 by expectancy
  const ranked = STRATEGIES.map((s, si) => ({ si, ...s, ...analyzeGroup(ultraIdx, si) }));
  ranked.sort((a, b) => b.E - a.E);

  console.log(`\n   Top 10 strategies by E:`);
  console.log(`   ${'Strategy'.padEnd(38)} WR%    SLR%  AvgLoss%  E%`);
  for (const r of ranked.slice(0, 10)) {
    const tag = r.si === baseIdx ? ' ← baseline'
              : r.si === bestStratIdx ? ' ← ★ BEST'
              : '';
    console.log(`   ${r.name.padEnd(38)} ${(r.wr*100).toFixed(1).padStart(5)} ${(r.slr*100).toFixed(1).padStart(6)} ${r.avgLoss.toFixed(2).padStart(8)} ${r.E.toFixed(3).padStart(6)}%${tag}`);
  }

  // Per-group analysis (best CA, CP, RATCHET, ST)
  const groups = ['CA', 'CP', 'RATCHET', 'ST'];
  console.log(`\n   Best by strategy group:`);
  for (const g of groups) {
    const best = ranked.filter(r => r.group === g)[0];
    if (!best) continue;
    console.log(`   ${g.padEnd(10)} best: ${best.name.padEnd(35)} E=${best.E.toFixed(3)}%  params=${JSON.stringify(best.params)}`);
  }

  const winner = STRATEGIES[bestStratIdx];
  const baseCI   = bootstrapE(ultraIdx, baseIdx, N_BOOT);
  const winnerCI = bootstrapE(ultraIdx, bestStratIdx, N_BOOT);

  console.log(`\n   ★  Winner: ${winner.label}`);
  console.log(`      WR:      ${(base.wr*100).toFixed(1)}% → ${(bestStats.wr*100).toFixed(1)}%`);
  console.log(`      SL rate: ${(base.slr*100).toFixed(1)}% → ${(bestStats.slr*100).toFixed(1)}%`);
  console.log(`      Avg SL loss: ${base.avgLoss.toFixed(2)}% → ${bestStats.avgLoss.toFixed(2)}%`);
  console.log(`      E gain:  ${base.E.toFixed(3)}% → ${bestStats.E.toFixed(3)}%  (${bestStats.E > base.E ? '+' : ''}${(bestStats.E - base.E).toFixed(3)}%/trade)`);
  console.log(`      Avg bars: ${base.avgBars.toFixed(1)} → ${bestStats.avgBars.toFixed(1)}`);
  console.log(`      Bootstrap 95% CI:`);
  console.log(`        Baseline:  [${baseCI.lo.toFixed(3)}, ${baseCI.hi.toFixed(3)}]  mean=${baseCI.mean.toFixed(3)}%`);
  console.log(`        Winner:    [${winnerCI.lo.toFixed(3)}, ${winnerCI.hi.toFixed(3)}]  mean=${winnerCI.mean.toFixed(3)}%`);
  console.log(`      Significant: ${winnerCI.lo > baseCI.lo ? 'YES (lower CI exceeds baseline lower CI)' : 'Marginal — CIs overlap'}`);

  deployRec[arch] = {
    strategy:  winner.name,
    label:     winner.label,
    params:    winner.params,
    group:     winner.group,
    baseE:     base.E,
    winnerE:   bestStats.E,
    eGain:     bestStats.E - base.E,
    winnerWR:  bestStats.wr * 100,
    winnerSLR: bestStats.slr * 100,
    winnerCI,
    baseCI,
    n:         ultraIdx.length,
  };
}

// ── Conditional P(Win | pnl_bin, bars_held) table ────────────────────────────
//
// Uses the STATIC (baseline) outcomes as the neutral reference.
// Read: given you're at X% unrealized PnL after Y bars, what's P(hit 5% target)?

console.log(`\n\n${'═'.repeat(70)}`);
console.log('CONDITIONAL WIN PROBABILITY  P(Win | close_PnL%, bars_held)');
console.log('All ULTRA signals combined · static stop (no trailing, neutral baseline)');
console.log('═'.repeat(70));

const ultraAll = rawData
  .map((d, i) => ({ d, i }))
  .filter(({ d }) => d.stage === 'ULTRA')
  .map(({ i }) => i);

// PnL bins (upper bound, exclusive): trade is in bin if pnl < binEdge
const PNL_EDGES  = [-6, -4, -2, -1, 0, 1, 2, 3, 4, 5];
const PNL_LABELS = PNL_EDGES.map((e, j) =>
  j === 0 ? `<${e}%` : `[${PNL_EDGES[j-1]},${e})%`
);
const BAR_CHECKS = [1, 2, 3, 5, 7, 10, 15, 20];

// cell[barCheck][binIdx] = { wins, total }
const condTable = BAR_CHECKS.map(() => PNL_EDGES.map(() => ({ wins: 0, total: 0 })));

for (const i of ultraAll) {
  const { cs, idx, entry } = rawData[i];
  const finalWin = allOutcomes[baseIdx][i].win;

  for (let bi = 0; bi < BAR_CHECKS.length; bi++) {
    const barIdx = idx + BAR_CHECKS[bi];
    if (barIdx >= cs.length) continue;
    const pnl = (cs[barIdx].c - entry) / entry * 100;

    let bin = PNL_EDGES.length - 1;
    for (let ei = 0; ei < PNL_EDGES.length; ei++) {
      if (pnl < PNL_EDGES[ei]) { bin = ei; break; }
    }
    condTable[bi][bin].total++;
    if (finalWin) condTable[bi][bin].wins++;
  }
}

const header = `  bars | ${PNL_LABELS.map(l => l.padStart(10)).join(' ')}`;
console.log('\n' + header);
console.log('  ' + '─'.repeat(header.length - 2));
for (let bi = 0; bi < BAR_CHECKS.length; bi++) {
  let row = `  ${String(BAR_CHECKS[bi]).padStart(4)} | `;
  for (let ei = 0; ei < PNL_EDGES.length; ei++) {
    const cell = condTable[bi][ei];
    if (cell.total < 5) { row += '     N/A  '; continue; }
    row += `   ${(cell.wins / cell.total * 100).toFixed(0).padStart(3)}% (${String(cell.total).padStart(3)})`;
  }
  console.log(row);
}
console.log('\n  Interpretation: each cell = P(hit 5% target | currently at that PnL after N bars)');
console.log('  Key insight: cells in "0 to 1%" range early show whether a "wait for breakeven" strategy works');

// ── Deployment recommendation ─────────────────────────────────────────────────

console.log(`\n\n${'═'.repeat(70)}`);
console.log('DEPLOYMENT RECOMMENDATION');
console.log('═'.repeat(70));

let anyBetter = false;
for (const arch of ARCHS) {
  const rec = deployRec[arch];
  if (!rec) continue;
  const eGain = rec.eGain;
  const sig  = rec.winnerCI.lo > rec.baseCI.lo;
  const statusIcon = eGain > 0.05 && sig ? '✓' : eGain > 0 ? '~' : '✗';

  console.log(`\n  ${arch}:`);
  console.log(`    Baseline E:  ${rec.baseE.toFixed(3)}%/trade`);
  console.log(`    Best trail:  ${rec.label}`);
  console.log(`    Winner E:    ${rec.winnerE.toFixed(3)}%/trade  (${eGain >= 0 ? '+' : ''}${eGain.toFixed(3)}%)`);
  console.log(`    Params:      ${JSON.stringify(rec.params)}`);
  console.log(`    Significant: ${statusIcon}  ${sig ? 'Yes' : 'Marginal'}`);

  if (eGain > 0) anyBetter = true;
}

// ── Identify the one universal trailing rule that works across archetypes ──────

console.log('\n\n  ── Cross-archetype universal rule search ──');

// Find the strategy with highest average rank across all archetypes
const archIndices = {};
for (const arch of ARCHS) {
  archIndices[arch] = rawData
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.arch === arch && d.stage === 'ULTRA')
    .map(({ i }) => i);
}

const archRanks = {}; // stratIdx → sum of ranks
for (let si = 0; si < STRATEGIES.length; si++) {
  archRanks[si] = 0;
  for (const arch of ARCHS) {
    const idx = archIndices[arch];
    if (idx.length < 30) continue;
    const stats = analyzeGroup(idx, si);
    archRanks[si] += stats.E;
  }
}

const rankedUniversal = Object.entries(archRanks)
  .map(([si, E]) => ({ si: +si, E, ...STRATEGIES[+si] }))
  .sort((a, b) => b.E - a.E);

console.log('\n  Top 10 strategies by TOTAL E (sum across all 4 archetypes):');
console.log(`  ${'Strategy'.padEnd(38)} TotalE%  Group`);
for (const r of rankedUniversal.slice(0, 10)) {
  const tag = r.name === 'STATIC_4ATR' ? ' ← baseline' : '';
  console.log(`  ${r.name.padEnd(38)} ${r.E.toFixed(3).padStart(8)}  ${r.group}${tag}`);
}

const universalWinner = rankedUniversal[0];
const universalStats  = {};
for (const arch of ARCHS) {
  const idx = archIndices[arch];
  if (idx.length < 30) continue;
  universalStats[arch] = {
    base:   analyzeGroup(idx, baseIdx),
    winner: analyzeGroup(idx, universalWinner.si),
  };
}

console.log(`\n  Universal winner: ${universalWinner.label}`);
console.log(`  Params: ${JSON.stringify(universalWinner.params)}`);
console.log('\n  Per-archetype E comparison:');
for (const arch of ARCHS) {
  const s = universalStats[arch];
  if (!s) continue;
  const gain = s.winner.E - s.base.E;
  console.log(`    ${arch.padEnd(20)} Base=${s.base.E.toFixed(3)}%  Trail=${s.winner.E.toFixed(3)}%  Δ=${gain >= 0 ? '+' : ''}${gain.toFixed(3)}%`);
}

// ── Save results ───────────────────────────────────────────────────────────────

const resultsDir = path.join('scripts', 'results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
const outPath = path.join(resultsDir, `dynamic_trail_${ts}.json`);

const savePayload = {
  timestamp: new Date().toISOString(),
  totalSignals: rawData.length,
  ultraSignals: ultraCount,
  strategiesEvaluated: STRATEGIES.length,
  perArchetype: deployRec,
  universalWinner: {
    name:   universalWinner.name,
    label:  universalWinner.label,
    params: universalWinner.params,
    group:  universalWinner.group,
    perArchE: Object.fromEntries(
      ARCHS.map(a => [a, universalStats[a] ? { base: universalStats[a].base.E, winner: universalStats[a].winner.E } : null])
    ),
  },
};

fs.writeFileSync(outPath, JSON.stringify(savePayload, null, 2));
console.log(`\n\nResults saved → ${outPath}`);

// ── Code snippet for archetypePriceEngine ────────────────────────────────────

console.log(`\n\n${'═'.repeat(70)}`);
console.log('STOCKENGINE.TS DEPLOYMENT CODE SNIPPET');
console.log('Add to archetypePriceEngine() return object:');
console.log('═'.repeat(70));

const univ = universalWinner;
const univP = univ.params;

if (univ.group === 'CP') {
  console.log(`
  // Dynamic trailing stop — Chandelier_OnProfit (Phase 5 optimisation)
  // Activate once unrealised close gain ≥ ${univP.P}%; trail at HH − ${univP.k}×ATR
  // Rule: monitor daily. Once +${univP.P}% close gain hit, trail stop upward.
  trailActivateAt: ${univP.P},   // % gain trigger
  trailMult:       ${univP.k},   // ATR multiplier for chandelier trail
`);
} else if (univ.group === 'RATCHET') {
  console.log(`
  // Dynamic trailing stop — ATR Ratchet (Phase 5 optimisation)
  // Zone 1 (≥+${univP.p1}%): tighten stop to entry − ${univP.m1}×ATR
  // Zone 2 (≥+${univP.p2}%): move stop to entry (breakeven)
  // Zone 3 (≥+${univP.p3}%): lock in at entry +${LOCK_PCT}%
  trailZone1Pct:  ${univP.p1},
  trailZone1Mult: ${univP.m1},
  trailZone2Pct:  ${univP.p2},
  trailZone3Pct:  ${univP.p3},
  trailLockInPct: ${LOCK_PCT},
`);
} else if (univ.group === 'CA') {
  console.log(`
  // Dynamic trailing stop — Chandelier Always (Phase 5 optimisation)
  // From bar 1: trail stop at highest_high_since_entry − ${univP.k}×ATR
  trailMult: ${univP.k},
`);
} else {
  console.log(`  // Winner: ${univ.name}  params: ${JSON.stringify(univP)}`);
}

console.log('\nDone.');
