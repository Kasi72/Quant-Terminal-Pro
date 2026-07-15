// Forward MFE/MAE Backtest Harness
//
// For any breakout model, replays history bar-by-bar. When the model fires at bar i,
// it measures the FORWARD path over `horizon` bars:
//   MFE = max favorable excursion  (biggest run-up)   → "biggest momentum"
//   MAE = max adverse excursion     (deepest drawdown)  → failed-breakout risk
//   follow-through = held above the level after ftBars
//   forwardReturn  = close-to-close over the horizon
//
// Fitness = ftRate × meanMFE − (1 − ftRate) × |meanMAE|
// The higher the fitness, the more reliably that model+params precedes big momentum.
// This is what the GA (Sprint 3) evolves against.

import type { Candle, BreakoutSignal, SeriesCtx } from './breakoutModels';

export interface ExcursionCfg {
  horizon:   number;   // bars to look forward
  ftBars:    number;   // bars after which we check the level still holds
  entryMode: 'close' | 'nextOpen';
}

export interface Excursion {
  mfePct: number;
  maePct: number;
  forwardReturnPct: number;
  followThrough: boolean;
}

// Forward path from a breakout at bar i. Uses only bars > i (no lookahead into i).
export function forwardExcursion(
  candles: Candle[], i: number, level: number, cfg: ExcursionCfg,
): Excursion | null {
  const entryIdx = cfg.entryMode === 'nextOpen' ? i + 1 : i;
  if (entryIdx >= candles.length) return null;
  const entry = cfg.entryMode === 'nextOpen' ? candles[entryIdx].o : candles[i].c;
  if (!(entry > 0)) return null;

  const end = Math.min(i + cfg.horizon, candles.length - 1);
  if (end <= entryIdx) return null;

  let maxH = -Infinity, minL = Infinity;
  for (let j = entryIdx + (cfg.entryMode === 'nextOpen' ? 0 : 1); j <= end; j++) {
    if (candles[j].h > maxH) maxH = candles[j].h;
    if (candles[j].l < minL) minL = candles[j].l;
  }
  if (!isFinite(maxH) || !isFinite(minL)) return null;

  const ftIdx = Math.min(i + cfg.ftBars, candles.length - 1);
  const followThrough = candles[ftIdx].c >= level;

  return {
    mfePct: (maxH - entry) / entry * 100,
    maePct: (minL - entry) / entry * 100,       // ≤ 0
    forwardReturnPct: (candles[end].c - entry) / entry * 100,
    followThrough,
  };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export interface Aggregate {
  signals:     number;
  ftRate:      number;   // fraction that held above the level
  meanMFE:     number;
  medianMFE:   number;
  meanMAE:     number;
  meanFwdRet:  number;
  winRate:     number;   // fraction with forwardReturn > 0
  mfeMaeRatio: number;
  fitness:     number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function aggregate(exs: Excursion[]): Aggregate {
  const n = exs.length;
  if (n === 0) {
    return { signals: 0, ftRate: 0, meanMFE: 0, medianMFE: 0, meanMAE: 0, meanFwdRet: 0, winRate: 0, mfeMaeRatio: 0, fitness: 0 };
  }
  const mfe = exs.map(e => e.mfePct);
  const mae = exs.map(e => e.maePct);
  const fwd = exs.map(e => e.forwardReturnPct);
  const ft  = exs.filter(e => e.followThrough).length / n;
  const meanMFE = mfe.reduce((a, b) => a + b, 0) / n;
  const meanMAE = mae.reduce((a, b) => a + b, 0) / n;   // negative
  const meanFwd = fwd.reduce((a, b) => a + b, 0) / n;
  const winRate = fwd.filter(x => x > 0).length / n;
  // Fitness = momentum-capture expectancy. Uses winRate (P(forward move up)) — NOT
  // the level-hold ftRate, which is gameable by placing the level far below entry.
  // Rewards a high chance of a real up-move (winRate), big when it works (MFE),
  // penalized by drawdown when it fails (MAE). Level-independent, so models with
  // honest level placement aren't beaten by triggers that fire on extended spikes.
  const fitness = winRate * meanMFE - (1 - winRate) * Math.abs(meanMAE);
  return {
    signals: n, ftRate: ft, meanMFE, medianMFE: median(mfe), meanMAE,
    meanFwdRet: meanFwd, winRate,
    mfeMaeRatio: meanMAE !== 0 ? meanMFE / Math.abs(meanMAE) : 0,
    fitness,
  };
}

// ── Per-symbol run ────────────────────────────────────────────────────────────

export type ModelFn = (candles: Candle[], i: number, ctx: SeriesCtx) => BreakoutSignal;

export interface RunCfg extends ExcursionCfg {
  warmup:   number;   // skip the first N bars (need history for levels)
  cooldown: number;   // min bars between two signals on the same symbol (dedupe clustering)
}

// Runs one model over one symbol, returns the forward excursions of its signals.
export function runSymbol(candles: Candle[], ctx: SeriesCtx, model: ModelFn, cfg: RunCfg): Excursion[] {
  const out: Excursion[] = [];
  const lastEnd = candles.length - cfg.horizon - 1;
  let lastSignal = -Infinity;
  for (let i = cfg.warmup; i <= lastEnd; i++) {
    if (i - lastSignal < cfg.cooldown) continue;
    const sig = model(candles, i, ctx);
    if (!sig.isBreakout) continue;
    const ex = forwardExcursion(candles, i, sig.level, cfg);
    if (ex) { out.push(ex); lastSignal = i; }
  }
  return out;
}

// ── Sweep over a param grid ───────────────────────────────────────────────────

export interface SweepRow<P> { params: P; agg: Aggregate; }

// Cartesian product of a grid spec { key: value[] } → array of param objects.
export function grid<P extends Record<string, unknown>>(spec: { [K in keyof P]: P[K][] }): P[] {
  const keys = Object.keys(spec) as (keyof P)[];
  let combos: Partial<P>[] = [{}];
  for (const k of keys) {
    const next: Partial<P>[] = [];
    for (const combo of combos) for (const v of spec[k]) next.push({ ...combo, [k]: v });
    combos = next;
  }
  return combos as P[];
}

// Runs a model factory across a param grid over the whole (preloaded) universe.
// `universe` is a list of { candles, ctx } already built once.
export function sweep<P>(
  universe: { candles: Candle[]; ctx: SeriesCtx }[],
  paramList: P[],
  makeModel: (p: P) => ModelFn,
  cfg: RunCfg,
): SweepRow<P>[] {
  const rows: SweepRow<P>[] = [];
  for (const params of paramList) {
    const model = makeModel(params);
    const all: Excursion[] = [];
    for (const u of universe) {
      const exs = runSymbol(u.candles, u.ctx, model, cfg);
      for (const e of exs) all.push(e);
    }
    rows.push({ params, agg: aggregate(all) });
  }
  rows.sort((a, b) => b.agg.fitness - a.agg.fitness);
  return rows;
}
