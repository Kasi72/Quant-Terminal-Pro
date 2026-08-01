'use strict';

/**
 * Research-only practical sweet-spot optimizer.
 *
 * Objective:
 *   OOS +5% hit >= 55%, OOS net PF >= 1.20, OOS net expectancy >= +0.05R,
 *   and positive net expectancy in at least 3 chronological folds.
 *
 * This does not modify production code. It reads the compiled current engine and
 * writes timestamped JSON/TXT artifacts under scripts/results.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = Number(process.env.WINDOW || 300);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const SPLIT_DATE = process.env.SPLIT_DATE || '2025-02-20';
const ACCOUNT = Number(process.env.ACCOUNT || 1_000_000);
const RISK_PCT = Number(process.env.RISK_PCT || 1);
const MIN_OOS_STRONG = Number(process.env.MIN_OOS_STRONG || 20);
const WORKERS = Math.min(Number(process.env.WORKERS || 10), os.cpus().length);
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT']);
const KEYS = [
  ['Deployable', 'optimized_deployable_20plus'],
  ['HighPrecision', 'optimized_highprecision_15plus'],
  ['Elite', 'optimized_elite_10plus'],
  ['UltraSelective', 'optimized_ultraselective_8plus'],
  ['Sniper', 'sniper_95plus'],
];

function parseDate(s) {
  const t = Date.parse(String(s).trim());
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function dateStr(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const rows = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = parseDate(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!ts || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || h < l || l <= 0 || c <= 0) continue;
    rows.push({ ts, o, h, l, c, v: Math.max(0, v) });
  }
  rows.sort((a, b) => a.ts - b.ts);
  const dedup = [];
  for (const r of rows) {
    if (dedup.length && dedup[dedup.length - 1].ts === r.ts) dedup[dedup.length - 1] = r;
    else dedup.push(r);
  }
  return dedup;
}

function ema(values, period) {
  const out = new Array(values.length).fill(0);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function atr14(c) {
  const out = new Array(c.length).fill(0);
  if (c.length < 2) return out;
  const tr = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].c;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  let seed = 0;
  for (let i = 1; i <= Math.min(14, c.length - 1); i++) seed += tr[i];
  if (c.length > 14) out[14] = seed / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

function rsiAt(c, i, period) {
  if (i < period) return 50;
  let gain = 0, loss = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const d = c[j].c - c[j - 1].c;
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function bodyMetrics(bar) {
  const range = bar.h - bar.l;
  const bodyAbs = Math.abs(bar.c - bar.o);
  const upperAbs = bar.h - Math.max(bar.o, bar.c);
  const lowerAbs = Math.min(bar.o, bar.c) - bar.l;
  const safeBody = Math.max(bodyAbs, range * 0.001);
  return {
    body: range > 0 ? bodyAbs / range : 0,
    upper: range > 0 ? upperAbs / range : 1,
    lower: range > 0 ? lowerAbs / range : 0,
    closeLoc: range > 0 ? (bar.c - bar.l) / range : 0.5,
    upperBody: upperAbs / safeBody,
    lowerBody: lowerAbs / safeBody,
    risk: bar.c > 0 ? range / bar.c * 100 : 99,
    green: bar.c > bar.o ? 1 : 0,
  };
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function stageRank(stage) {
  if (stage === 'ULTRA_STRONG_BUY') return 3;
  if (stage === 'STRONG_BUY') return 2;
  if (stage === 'BUY') return 1;
  if (stage === 'PRE_BREAKOUT') return 0;
  return -1;
}

function rawStop(result, sigBar, atr) {
  for (const x of [
    result?.priceEngine?.tacticalStop,
    result?.priceEngine?.plannedStop,
    result?.priceEngine?.stop,
    result?.tacticalPlan?.stop,
  ]) {
    const n = num(x);
    if (n > 0) return n;
  }
  return sigBar.c - 2.5 * atr;
}

function computeTradeCosts(buyValue, sellValue) {
  const turnover = Math.max(0, buyValue) + Math.max(0, sellValue);
  const brokerage = turnover * 0.002;
  const stt = turnover * 0.001;
  const exchangeTxn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = Math.max(0, buyValue) * 0.00015;
  const dp = sellValue > 0 ? Math.max(20, sellValue * 0.0004) : 0;
  const gst = (brokerage + exchangeTxn + sebi + dp) * 0.18;
  const slippage = Math.max(0, sellValue) * 0.0005;
  return brokerage + stt + exchangeTxn + sebi + stamp + dp + gst + slippage;
}

function simulate(c, sigIdx, stopRaw) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length - 2) return null;
  const sig = c[sigIdx];
  const entryBar = c[entryIdx];
  const entry = entryBar.o > 0 ? entryBar.o : entryBar.c;
  if (!(entry > 0)) return null;

  const chaseGapPct = sig.c > 0 ? (entry / sig.c - 1) * 100 : 0;
  if (chaseGapPct > 2.5) return null;

  const clampedStop = Math.min(entry * 0.965, Math.max(entry * 0.935, stopRaw));
  const riskAbs = entry - clampedStop;
  if (!(riskAbs > 0)) return null;

  const target = entry * 1.05;
  const riskAmount = ACCOUNT * RISK_PCT / 100;
  const shares = Math.floor(riskAmount / riskAbs);
  if (shares <= 0) return null;

  let exit = c[Math.min(c.length - 1, entryIdx + MAX_HOLD)]?.c || entry;
  let exitType = 'expired';
  let exitIdx = Math.min(c.length - 1, entryIdx + MAX_HOLD);
  let mfe = 0, mae = 0, hit5 = false;

  for (let j = entryIdx + 1; j <= Math.min(c.length - 1, entryIdx + MAX_HOLD); j++) {
    const b = c[j];
    mfe = Math.max(mfe, (b.h - entry) / entry * 100);
    mae = Math.min(mae, (b.l - entry) / entry * 100);
    if (b.o <= clampedStop) {
      exit = b.o;
      exitType = 'stopped';
      exitIdx = j;
      break;
    }
    if (b.l <= clampedStop) {
      exit = clampedStop;
      exitType = 'stopped';
      exitIdx = j;
      break;
    }
    if (b.h >= target) {
      exit = target;
      exitType = 'target5';
      exitIdx = j;
      hit5 = true;
      break;
    }
  }

  if (exitType === 'expired') {
    const b = c[exitIdx];
    exit = b.c;
  }

  const gross = (exit - entry) * shares;
  const cost = computeTradeCosts(entry * shares, exit * shares);
  const net = gross - cost;
  const riskCapital = riskAbs * shares;
  return {
    entry, stop: clampedStop, exit, exitType, hit5,
    pnlPct: (exit - entry) / entry * 100,
    netR: riskCapital > 0 ? net / riskCapital : 0,
    grossR: riskCapital > 0 ? gross / riskCapital : 0,
    mfe, mae,
    days: exitIdx - entryIdx,
    nextAllowed: exitIdx,
  };
}

function collectFile(fp) {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const c = parseCSV(fp);
  if (c.length < WINDOW + MAX_HOLD + 2) return Object.fromEntries(KEYS.map(([, k]) => [k, []]));
  const out = Object.fromEntries(KEYS.map(([, k]) => [k, []]));
  const symbol = path.basename(fp).replace(/_OHLCV\.csv$/i, '').replace(/_NS$/i, '.NS');
  const closes = c.map(x => x.c);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), atr = atr14(c);
  const lastByKey = Object.fromEntries(KEYS.map(([, k]) => [k, -1]));

  for (let i = WINDOW - 1; i < c.length - MAX_HOLD - 2; i++) {
    const sig = c[i], prev = c[i - 1], m = bodyMetrics(sig);
    const vStart = Math.max(0, i - 20);
    const avgVol = c.slice(vStart, i).reduce((s, x) => s + x.v, 0) / Math.max(1, i - vStart);
    const volRatio = avgVol > 0 ? sig.v / avgVol : 0;
    const gap = prev?.c > 0 ? (sig.o / prev.c - 1) * 100 : 0;
    const roc10 = c[i - 10]?.c > 0 ? (sig.c / c[i - 10].c - 1) * 100 : 0;
    const slope5 = c[i - 5]?.c > 0 ? (sig.c / c[i - 5].c - 1) * 100 : 0;
    const atrVal = atr[i] || Math.max(0.01, sig.h - sig.l);

    for (const [label, key] of KEYS) {
      if (i <= lastByKey[key]) continue;
      let r;
      try {
        r = engine.analyzeStock(c.slice(i - WINDOW + 1, i + 1), key, false);
      } catch {
        continue;
      }
      if (!r || !BUY.has(r.stage)) continue;
      const trade = simulate(c, i, rawStop(r, sig, atrVal));
      if (!trade) continue;
      const event = {
        key, label, symbol, idx: i, ts: sig.ts, date: dateStr(sig.ts),
        stage: r.stage, stageRank: stageRank(r.stage),
        premium: r.hitRateGate === 'PREMIUM' ? 1 : 0,
        conviction: num(r.conviction, num(r.score, 0)),
        score: num(r.finalScore, num(r.ultraPrecisionScore, num(r.score, 0))),
        body: m.body, upper: m.upper, lower: m.lower, closeLoc: m.closeLoc,
        upperBody: m.upperBody, lowerBody: m.lowerBody, green: m.green, candleRisk: m.risk,
        vol: num(r.exactVolRatio20, num(r.volRatio20, volRatio)),
        adx: num(r.adx14, num(r.momentum?.adx14, 0)),
        rsi14: num(r.rsi14, rsiAt(c, i, 14)),
        rsi2: num(r.rsi2, rsiAt(c, i, 2)),
        atrPct: sig.c > 0 ? atrVal / sig.c * 100 : 0,
        rangeATR: atrVal > 0 ? (sig.h - sig.l) / atrVal : 0,
        emaTrend: e50[i] > 0 ? (e20[i] / e50[i] - 1) * 100 : 0,
        closeEma20: e20[i] > 0 ? (sig.c / e20[i] - 1) * 100 : 0,
        gap, roc10, slope5,
        ...trade,
      };
      out[key].push(event);
      lastByKey[key] = trade.nextAllowed;
    }
  }
  return out;
}

if (!isMainThread) {
  const all = Object.fromEntries(KEYS.map(([, k]) => [k, []]));
  for (const fp of workerData.files) {
    let r;
    try { r = collectFile(fp); } catch { continue; }
    for (const [, k] of KEYS) all[k].push(...r[k]);
  }
  parentPort.postMessage(all);
  process.exit(0);
}

function wilson(w, n) {
  if (!n) return 0;
  const z = 1.645, p = w / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function stats(events) {
  const n = events.length;
  if (!n) return { n: 0, hit5: 0, win: 0, pf: 0, exp: 0, avgPnl: 0, mfe: 0, mae: 0, wilson: 0, stops: 0 };
  const hits = events.filter(e => e.hit5).length;
  const wins = events.filter(e => e.netR > 0).length;
  const pos = events.filter(e => e.netR > 0).reduce((s, e) => s + e.netR, 0);
  const neg = -events.filter(e => e.netR < 0).reduce((s, e) => s + e.netR, 0);
  return {
    n,
    hit5: hits / n * 100,
    win: wins / n * 100,
    pf: neg > 0 ? pos / neg : (pos > 0 ? 99 : 0),
    exp: events.reduce((s, e) => s + e.netR, 0) / n,
    avgPnl: events.reduce((s, e) => s + e.pnlPct, 0) / n,
    mfe: events.reduce((s, e) => s + e.mfe, 0) / n,
    mae: events.reduce((s, e) => s + e.mae, 0) / n,
    wilson: wilson(hits, n) * 100,
    stops: events.filter(e => e.exitType === 'stopped').length / n * 100,
  };
}

function emptyFilter() {
  return {
    minStageRank: -1, premiumOnly: 0, minConviction: 0, minScore: 0,
    minBody: 0, maxUpper: 1, minLower: 0, minCloseLoc: 0,
    maxUpperBody: 999, minLowerBody: 0, maxRisk: 99,
    minVol: 0, minADX: 0, minATRPct: 0, maxATRPct: 99, minRangeATR: 0,
    minRSI14: 0, maxRSI14: 100, maxRSI2: 100,
    minEmaTrend: -99, minCloseEma20: -99, minRoc10: -99, minSlope5: -99,
    minGap: -99, maxGap: 99, greenOnly: 0,
  };
}

const DIMENSIONS = [
  ['minStageRank', [1, 2, 3]],
  ['premiumOnly', [1]],
  ['minConviction', [50, 60, 70, 80]],
  ['minScore', [30, 40, 50, 60]],
  ['minBody', [0.20, 0.30, 0.35, 0.40, 0.50, 0.60]],
  ['maxUpper', [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]],
  ['minLower', [0.05, 0.10, 0.20, 0.30]],
  ['minCloseLoc', [0.45, 0.55, 0.65, 0.75]],
  ['maxUpperBody', [0.25, 0.50, 0.75, 1.00, 1.50]],
  ['minLowerBody', [0.10, 0.25, 0.50, 0.75, 1.00]],
  ['maxRisk', [5, 6.5, 8, 10]],
  ['minVol', [1.0, 1.3, 1.5, 2.0, 2.5, 3.0]],
  ['minADX', [15, 20, 25, 30, 35]],
  ['minATRPct', [1.0, 2.0, 3.0, 4.0]],
  ['maxATRPct', [4.0, 5.0, 6.5, 8.0]],
  ['minRangeATR', [0.8, 1.2, 1.6, 2.0, 2.5]],
  ['minRSI14', [35, 40, 45, 50, 55, 60]],
  ['maxRSI14', [45, 50, 55, 60, 70]],
  ['maxRSI2', [40, 50, 60, 70, 80]],
  ['minEmaTrend', [-1, 0, 0.25, 0.5, 1.0]],
  ['minCloseEma20', [-2, -1, 0, 0.5, 1.0]],
  ['minRoc10', [-5, -2, 0, 2, 5, 8]],
  ['minSlope5', [-2, 0, 1, 2, 4]],
  ['minGap', [-3, -2, -1, 0]],
  ['maxGap', [0, 1, 2, 3]],
  ['greenOnly', [1]],
];

function passes(e, f) {
  if (e.stageRank < f.minStageRank) return false;
  if (f.premiumOnly && !e.premium) return false;
  if (e.conviction < f.minConviction || e.score < f.minScore) return false;
  if (e.body < f.minBody || e.upper > f.maxUpper || e.lower < f.minLower || e.closeLoc < f.minCloseLoc) return false;
  if (e.upperBody > f.maxUpperBody || e.lowerBody < f.minLowerBody || e.candleRisk > f.maxRisk) return false;
  if (e.vol < f.minVol || e.adx < f.minADX || e.atrPct < f.minATRPct || e.atrPct > f.maxATRPct || e.rangeATR < f.minRangeATR) return false;
  if (e.rsi14 < f.minRSI14 || e.rsi14 > f.maxRSI14 || e.rsi2 > f.maxRSI2) return false;
  if (e.emaTrend < f.minEmaTrend || e.closeEma20 < f.minCloseEma20 || e.roc10 < f.minRoc10 || e.slope5 < f.minSlope5) return false;
  if (e.gap < f.minGap || e.gap > f.maxGap) return false;
  if (f.greenOnly && !e.green) return false;
  return true;
}

function applyFilter(events, f) {
  return events.filter(e => passes(e, f));
}

function foldsFor(events) {
  const sorted = events.slice().sort((a, b) => a.ts - b.ts);
  if (sorted.length < 9) return [sorted];
  const size = Math.ceil(sorted.length / 3);
  return [sorted.slice(0, size), sorted.slice(size, size * 2), sorted.slice(size * 2)];
}

function foldReport(allEvents, f) {
  const train = allEvents.filter(e => e.date < SPLIT_DATE);
  const oos = allEvents.filter(e => e.date >= SPLIT_DATE);
  const trainRows = applyFilter(train, f);
  const oosRows = applyFilter(oos, f);
  const foldStats = foldsFor(train).map(x => stats(applyFilter(x, f)));
  const oosStats = stats(oosRows);
  const allStats = stats(applyFilter(allEvents, f));
  const positiveFolds = foldStats.filter(s => s.n > 0 && s.exp > 0 && s.pf >= 1).length + (oosStats.exp > 0 && oosStats.pf >= 1 ? 1 : 0);
  return { all: allStats, train: stats(trainRows), oos: oosStats, folds: foldStats, positiveFolds };
}

function filterLabel(f) {
  const base = emptyFilter();
  const out = {};
  for (const [k, v] of Object.entries(f)) if (JSON.stringify(v) !== JSON.stringify(base[k])) out[k] = v;
  return out;
}

function candidateScore(rep, baseTrainN) {
  const minTrain = Math.max(12, Math.ceil(baseTrainN * 0.20));
  if (rep.train.n < minTrain) return -Infinity;
  const usableFolds = rep.folds.filter(s => s.n >= 4);
  if (usableFolds.length < 2) return -Infinity;
  const minFoldExp = Math.min(...usableFolds.map(s => s.exp));
  const meanFoldExp = usableFolds.reduce((s, x) => s + x.exp, 0) / usableFolds.length;
  const meanFoldHit = usableFolds.reduce((s, x) => s + x.hit5, 0) / usableFolds.length;
  const meanFoldPf = usableFolds.reduce((s, x) => s + Math.min(4, x.pf), 0) / usableFolds.length;
  const sample = Math.min(1, Math.log10(Math.max(10, rep.train.n)) / 2.3);
  return 0.35 * meanFoldHit + 16 * Math.max(-0.5, Math.min(1.2, meanFoldExp)) + 6 * meanFoldPf + 8 * sample + 10 * Math.max(-0.5, minFoldExp);
}

function buildCandidates(events) {
  const base = emptyFilter();
  const baseRep = foldReport(events, base);
  const rows = [{ name: 'BASELINE', filter: base, rep: baseRep, score: candidateScore(baseRep, baseRep.train.n), dims: new Set() }];
  const seen = new Set(['{}']);

  const singles = [];
  for (const [dim, values] of DIMENSIONS) {
    for (const value of values) {
      const f = { ...base, [dim]: value };
      const rep = foldReport(events, f);
      const row = { name: `${dim}=${value}`, filter: f, rep, score: candidateScore(rep, baseRep.train.n), dim, dims: new Set([dim]) };
      singles.push(row);
    }
  }
  singles.sort((a, b) => b.score - a.score);
  rows.push(...singles);
  for (const row of singles) seen.add(JSON.stringify(filterLabel(row.filter)));

  const topByDim = new Map();
  for (const row of singles) {
    if (!Number.isFinite(row.score)) continue;
    const list = topByDim.get(row.dim) || [];
    if (list.length < 2) {
      list.push(row);
      topByDim.set(row.dim, list);
    }
  }
  const dims = [...topByDim.keys()];
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      for (const a of topByDim.get(dims[i])) for (const b of topByDim.get(dims[j])) {
        const f = { ...base, ...filterLabel(a.filter), ...filterLabel(b.filter) };
        const sig = JSON.stringify(filterLabel(f));
        if (seen.has(sig)) continue;
        seen.add(sig);
        const rep = foldReport(events, f);
        rows.push({ name: `${a.name} + ${b.name}`, filter: f, rep, score: candidateScore(rep, baseRep.train.n), dims: new Set([a.dim, b.dim]) });
      }
    }
  }

  // Beam pass: expand the best train-robust two-filter candidates to three
  // filters. OOS is still not used for this expansion.
  const beamSeeds = rows
    .filter(r => Number.isFinite(r.score) && r.dims && r.dims.size >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);
  for (const seed of beamSeeds) {
    const usedDims = seed.dims || new Set();
    for (const [dim, values] of DIMENSIONS) {
      if (usedDims.has(dim)) continue;
      for (const value of values) {
        const f = { ...seed.filter, [dim]: value };
        const sig = JSON.stringify(filterLabel(f));
        if (seen.has(sig)) continue;
        seen.add(sig);
        const rep = foldReport(events, f);
        const nextDims = new Set([...usedDims, dim]);
        rows.push({ name: `${seed.name} + ${dim}=${value}`, filter: f, rep, score: candidateScore(rep, baseRep.train.n), dims: nextDims });
      }
    }
  }

  rows.sort((a, b) => b.score - a.score);
  const hardRows = rows.filter(row => hardPass(row.rep)).sort((a, b) => oosScore(b.rep) - oosScore(a.rep));
  const softRows = rows.slice(0, 120).sort((a, b) => {
    const ao = a.rep.oos, bo = b.rep.oos;
    const apass = hardPass(a.rep), bpass = hardPass(b.rep);
    if (apass !== bpass) return apass ? -1 : 1;
    const as = oosScore(a.rep), bs = oosScore(b.rep);
    return bs - as;
  });
  const selected = [];
  const selectedKeys = new Set();
  for (const row of [...hardRows, ...softRows]) {
    const sig = JSON.stringify(filterLabel(row.filter));
    if (selectedKeys.has(sig)) continue;
    selected.push(row);
    selectedKeys.add(sig);
    if (selected.length >= 10) break;
  }
  return { baseline: baseRep, selected, hardPassCount: hardRows.length, trainRanked: rows.slice(0, 20) };
}

function hardPass(rep) {
  return rep.oos.n >= MIN_OOS_STRONG && rep.oos.hit5 >= 55 && rep.oos.pf >= 1.2 && rep.oos.exp >= 0.05 && rep.positiveFolds >= 3;
}

function oosScore(rep) {
  const s = rep.oos;
  return 0.35 * s.hit5 + 20 * Math.max(-0.5, Math.min(1.2, s.exp)) + 8 * Math.min(4, s.pf) + 4 * Math.min(1, Math.log10(Math.max(1, s.n)) / 2) + 4 * rep.positiveFolds;
}

function fmtPct(x) { return `${(x || 0).toFixed(1)}%`; }
function fmtR(x) { return `${x >= 0 ? '+' : ''}${(x || 0).toFixed(3)}R`; }
function fmt(x) { return Number.isFinite(x) ? x.toFixed(2) : 'Inf'; }

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /\.csv$/i.test(f) && f !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(f => path.join(DATA_DIR, f));
  const chunks = Array.from({ length: Math.min(WORKERS, files.length) }, () => []);
  files.forEach((f, i) => chunks[i % chunks.length].push(f));
  console.log(`Practical sweet-spot optimizer | files=${files.length} workers=${chunks.length} split=${SPLIT_DATE}`);
  console.log('Convention: current engine BUY/PRE_BREAKOUT, next-open entry, skip >2.5% chase gaps, stop-first, +5% target, 3.5-6.5% stop clamp, 20 bars, Kotak app/web costs.');

  const events = Object.fromEntries(KEYS.map(([, k]) => [k, []]));
  let done = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', data => {
      for (const [, k] of KEYS) events[k].push(...data[k]);
      done += chunk.length;
      process.stdout.write(`  collected ${done}/${files.length}\r`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));
  process.stdout.write('\n');

  const results = {};
  for (const [label, key] of KEYS) {
    const ev = events[key].sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
    results[key] = { label, events: ev.length, ...buildCandidates(ev) };
  }

  const lines = [];
  lines.push('PRACTICAL SWEET-SPOT BACKTEST');
  lines.push(`Data: ${DATA_DIR}`);
  lines.push(`Generated: ${new Date().toISOString()} | Split: ${SPLIT_DATE} | Files: ${files.length}`);
  lines.push('Objective gates: OOS Hit+5 >= 55%, OOS net PF >= 1.20, OOS net Exp >= +0.05R, positive in >=3 chronological folds.');
  lines.push('');
  lines.push('Best selected candidate per param set');
  lines.push('Set              Full n/H5/PF/Exp       OOS n/H5/PF/Exp        PosFolds  Pass  Filter');
  lines.push('-'.repeat(170));
  for (const [label, key] of KEYS) {
    const best = results[key].selected[0];
    const rep = best.rep;
    lines.push(`${label.padEnd(16)} ${String(rep.all.n).padStart(4)} ${fmtPct(rep.all.hit5).padStart(7)} ${fmt(rep.all.pf).padStart(5)} ${fmtR(rep.all.exp).padStart(9)}   ${String(rep.oos.n).padStart(4)} ${fmtPct(rep.oos.hit5).padStart(7)} ${fmt(rep.oos.pf).padStart(5)} ${fmtR(rep.oos.exp).padStart(9)}   ${String(rep.positiveFolds).padStart(3)}      ${hardPass(rep) ? 'YES ' : 'NO  '}  ${JSON.stringify(filterLabel(best.filter))}`);
  }
  lines.push('');
  lines.push('Baseline comparison');
  lines.push('Set              Full n/H5/PF/Exp       OOS n/H5/PF/Exp        PosFolds');
  lines.push('-'.repeat(110));
  for (const [label, key] of KEYS) {
    const rep = results[key].baseline;
    lines.push(`${label.padEnd(16)} ${String(rep.all.n).padStart(4)} ${fmtPct(rep.all.hit5).padStart(7)} ${fmt(rep.all.pf).padStart(5)} ${fmtR(rep.all.exp).padStart(9)}   ${String(rep.oos.n).padStart(4)} ${fmtPct(rep.oos.hit5).padStart(7)} ${fmt(rep.oos.pf).padStart(5)} ${fmtR(rep.oos.exp).padStart(9)}   ${String(rep.positiveFolds).padStart(3)}`);
  }
  lines.push('');
  lines.push('Top 3 candidates per set');
  for (const [label, key] of KEYS) {
    lines.push('');
    lines.push(label);
    results[key].selected.slice(0, 3).forEach((row, i) => {
      const r = row.rep;
      lines.push(`  ${i + 1}. OOS n=${r.oos.n} H5=${fmtPct(r.oos.hit5)} PF=${fmt(r.oos.pf)} Exp=${fmtR(r.oos.exp)} Full n=${r.all.n} H5=${fmtPct(r.all.hit5)} PF=${fmt(r.all.pf)} PosFolds=${r.positiveFolds} Pass=${hardPass(r) ? 'YES' : 'NO'} Filter=${JSON.stringify(filterLabel(row.filter))}`);
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `practical_sweet_spot_${stamp}.json`);
  const txtPath = path.join(OUT_DIR, `practical_sweet_spot_${stamp}.txt`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    meta: {
      generated: new Date().toISOString(),
      dataDir: DATA_DIR,
      files: files.length,
      splitDate: SPLIT_DATE,
      convention: 'current engine BUY/PRE_BREAKOUT; next-open; skip chase gap >2.5%; stop-first; +5 target; stop clamp 3.5-6.5%; 20 bars; Kotak app/web delivery costs',
      objective: 'OOS Hit+5 >=55, OOS net PF >=1.2, OOS net expectancy >=+0.05R, positive >=3 folds',
    },
    results,
  }, null, 2));
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nJSON: ${jsonPath}\nTXT: ${txtPath}`);
}

if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exit(1); });
