'use strict';

/**
 * Trail-A / Trail-B paired audit.
 *
 * Audit-only script. It does not modify production behavior.
 *
 * Variants:
 *   current  = Trail-A on, Trail-B on
 *   noA      = Trail-A off, Trail-B on
 *   noB      = Trail-A on, Trail-B off
 *   noTrails = Trail-A off, Trail-B off
 *
 * Trail-A: pre-T1 day-9+ review trail = prior 5-bar swing low - 0.35 ATR.
 * Trail-B: post-T2 chandelier = highest close since T2 - 1.5 ATR.
 */

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.OHLCV_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const WINDOW = Number(process.env.WINDOW || 300);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const TARGET_PCT = Number(process.env.TARGET_PCT || 5);
const OOS_DATE = process.env.OOS_DATE || '2025-05-05';
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || 8));
const REQUIRE_PROMOTED = process.env.REQUIRE_PROMOTED !== '0';
const VERIFY_COPY = process.env.VERIFY_COPY !== '0';

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];

const LABELS = {
  optimized_deployable_20plus: 'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus: 'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus: 'PerfectStorm',
  ors_prime_reversal: 'ORS-Prime',
};

const VARIANTS = {
  current: { trailA: true, trailB: true },
  noA: { trailA: false, trailB: true },
  noB: { trailA: true, trailB: false },
  noTrails: { trailA: false, trailB: false },
};

const BUY_STAGES = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 7, Oct: 9, Nov: 10, Dec: 11 };
MON.Sep = 8;

function parseDate(s) {
  const raw = String(s || '').trim();
  if (!raw) return 0;
  const p = raw.split('-');
  if (p.length === 3) {
    if (p[0].length === 4) return Date.UTC(+p[0], +p[1] - 1, +p[2]);
    if (MON[p[1]] !== undefined) return Date.UTC(+p[2], MON[p[1]], +p[0]);
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function isoDateFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseCsv(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const ts = parseDate(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5] || 0;
    if (!ts || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts, d: isoDateFromTs(ts), o, h, l, c, v });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function finitePositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function computeATR14(candles, idx) {
  if (idx < 1) return candles[0] ? candles[0].h - candles[0].l : 1;
  const period = Math.min(14, idx);
  let tr = 0;
  for (let j = idx - period + 1; j <= idx; j++) {
    const hi = candles[j].h, lo = candles[j].l, pc = candles[j - 1]?.c ?? lo;
    tr += Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
  }
  return tr / period;
}

function obv5Slope(candles, idx) {
  const window = Math.min(5, idx);
  if (window < 2) return 0;
  let obv = 0;
  const obvArr = [];
  for (let j = idx - window + 1; j <= idx; j++) {
    const vol = candles[j].v ?? 0;
    const pc = candles[j - 1].c;
    if (candles[j].c > pc) obv += vol;
    else if (candles[j].c < pc) obv -= vol;
    obvArr.push(obv);
  }
  const n = obvArr.length;
  const xMean = (n - 1) / 2;
  const yMean = obvArr.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let k = 0; k < n; k++) {
    num += (k - xMean) * (obvArr[k] - yMean);
    den += (k - xMean) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function advanceDateStr(base, days) {
  const d = new Date(base);
  if (!Number.isFinite(d.getTime())) return base;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function candleDate(candle, fallbackBase, dayIndex) {
  if (candle.d && candle.d.length >= 10) return candle.d.slice(0, 10);
  if (candle.ts) return new Date((candle.ts + 19800) * 1000).toISOString().slice(0, 10);
  return advanceDateStr(fallbackBase, dayIndex);
}

function avgVol20(candles, idx) {
  let s = 0, n = 0;
  for (let j = Math.max(0, idx - 20); j < idx; j++) {
    const v = candles[j].v;
    if (v != null && v > 0) { s += v; n++; }
  }
  return n > 0 ? s / n : 0;
}

function fiveBarSwingLow(candles, idx) {
  const start = Math.max(0, idx - 4);
  let lo = Infinity;
  for (let j = start; j <= idx; j++) lo = Math.min(lo, candles[j].l);
  return lo;
}

function getHardStop(trade) {
  const entry = trade.entryPrice;
  const reviewStop = trade.stopLoss > 0 && trade.stopLoss < entry ? trade.stopLoss : 0;
  const disasterStop = trade.disasterStop > 0 && trade.disasterStop < entry ? trade.disasterStop : 0;
  return disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop) ? disasterStop : reviewStop;
}

function normalizeTargets(entry, pe) {
  const t1 = finitePositive(pe?.target5);
  const t2 = finitePositive(pe?.target7);
  const t3 = finitePositive(pe?.target10);
  return {
    target1: t1 > entry ? t1 : entry * 1.05,
    target2: t2 > Math.max(entry, t1) ? t2 : entry * 1.075,
    target3: t3 > Math.max(entry, t2) ? t3 : entry * 1.10,
  };
}

function validateVariant(trade, candlesSinceEntry, options = {}, toggles = VARIANTS.current) {
  const today = new Date().toISOString().slice(0, 10);
  const entryDateBase = trade.entryDate ?? today;
  let exitBarIdx = -1;

  const defaultResult = {
    symbol: trade.symbol, status: 'open', pnlPct: 0, pnlR: 0, daysHeld: 0,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0, closedPrice: 0, closedDate: '',
    gateLog: [], trailLog: [],
  };

  if (!trade || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) return defaultResult;
  if (!Array.isArray(candlesSinceEntry) || candlesSinceEntry.length === 0) return defaultResult;

  const entry = trade.entryPrice;
  const validReviewStop = trade.stopLoss > 0 && trade.stopLoss < entry;
  const reviewStop = validReviewStop ? trade.stopLoss : 0;
  const hardStop = getHardStop(trade);
  const riskPerShare = hardStop > 0 ? Math.max(0, entry - hardStop) : 0;
  if (!(hardStop > 0) || !(riskPerShare > 0)) return defaultResult;
  let dynamicStop = reviewStop || hardStop;

  const preEntryCandles = (options.preEntryCandles ?? [])
    .filter(c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  const replayCandles = candlesSinceEntry
    .filter(c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  const history = [...preEntryCandles, ...replayCandles];
  const historyOffset = preEntryCandles.length;
  const requestedMaxHold = options.maxHoldBars ?? trade.maxHoldBars ?? 20;
  const maxHoldBars = Math.max(1, Math.min(60, Math.trunc(requestedMaxHold)));
  const monitoredCandles = replayCandles.slice(0, maxHoldBars);

  const gateLog = [];
  const trailLog = [];
  const targetLog = [];
  let mfePrice = entry, maePrice = entry;
  let status = 'open';
  let closedPrice = 0, closedDate = '';

  const plannedT1 = trade.target1 && trade.target1 > entry ? trade.target1 : Infinity;
  const effectiveT1 = plannedT1;
  let t1Hit = false, t2Hit = false;
  let highestCloseSinceT2 = entry;
  let t1HitBar = -1, t2HitBar = -1;
  let pendingReviewExit = null;
  let trailAFired = false, trailBFired = false;
  let trailAStopExit = false, trailBStopExit = false;

  for (let i = 0; i < monitoredCandles.length; i++) {
    const candle = monitoredCandles[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;
    const histIdx = historyOffset + i;
    const open = candle.o ?? candle.c;
    const hi = candle.h;
    const lo = candle.l;
    const close = candle.c;
    const vol = candle.v ?? 0;
    const cDate = candleDate(candle, entryDateBase, i + 1);
    const prev = history[histIdx - 1] ?? null;
    const prev2 = history[histIdx - 2] ?? null;

    if (pendingReviewExit) {
      closedPrice = open;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: pendingReviewExit.stopLevel,
        dipPct: pendingReviewExit.stopLevel > 0 ? (pendingReviewExit.stopLevel - open) / pendingReviewExit.stopLevel * 100 : 0,
        triggerType: 'review_open',
        gatesTested: [{ gate: 'REVIEW Next-Open Execution', passed: true, reason: `Review stop confirmed on ${pendingReviewExit.signalDate}; exited at next open` }],
        result: 'STOPPED',
        stopKind: 'review',
      });
      if (open < maePrice) maePrice = open;
      exitBarIdx = i;
      break;
    }

    if (toggles.trailA && !t1Hit && i >= 8) {
      const swingLow = fiveBarSwingLow(history, histIdx - 1);
      const trailAtr = computeATR14(history, histIdx - 1);
      const bufferedTrail = swingLow - 0.35 * trailAtr;
      if (bufferedTrail > dynamicStop && bufferedTrail < entry) {
        const oldStop = dynamicStop;
        dynamicStop = bufferedTrail;
        trailAFired = true;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `Trail-A review trail ${oldStop.toFixed(2)} -> ${dynamicStop.toFixed(2)}` });
      }
    }

    if (toggles.trailB && t2Hit && trade.target3 && trade.target3 > 0) {
      const rawAtr = computeATR14(history, histIdx - 1);
      const atr14Floor = trade.atr14AtEntry && trade.atr14AtEntry > 0 ? trade.atr14AtEntry : 0;
      const atr = rawAtr > 0 ? Math.max(rawAtr, atr14Floor * 0.5) : atr14Floor;
      const chandelier = highestCloseSinceT2 - 1.5 * atr;
      if (chandelier > dynamicStop && chandelier < trade.target3) {
        const oldStop = dynamicStop;
        dynamicStop = chandelier;
        trailBFired = true;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `Trail-B chandelier ${oldStop.toFixed(2)} -> ${dynamicStop.toFixed(2)}` });
      }
    }

    const executableStop = t1Hit ? Math.max(hardStop, dynamicStop) : hardStop;
    const gapThroughHardStop = executableStop > 0 && open <= executableStop;
    const hardStopTouched = executableStop > 0 && lo <= executableStop;
    if (hardStopTouched) {
      const fill = gapThroughHardStop ? open : executableStop;
      closedPrice = fill;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      if (t1Hit && trailBFired) trailBStopExit = true;
      if (t1Hit && trailAFired && !trailBFired) trailAStopExit = true;
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: executableStop,
        dipPct: executableStop > 0 ? (executableStop - fill) / executableStop * 100 : 0,
        triggerType: gapThroughHardStop ? 'gap_down' : 'intraday_low',
        gatesTested: [{ gate: t1Hit ? 'HARD Protective Trail' : 'HARD Disaster Stop', passed: true, reason: 'stop-first fill' }],
        result: 'STOPPED',
        stopKind: t1Hit ? 'trail' : 'hard',
      });
      if (fill < maePrice) maePrice = fill;
      exitBarIdx = i;
      break;
    }

    if (hi > mfePrice) mfePrice = hi;
    if (lo < maePrice) maePrice = lo;

    const t1InRange = !t1Hit && effectiveT1 < Infinity && hi >= effectiveT1;
    const reviewTouched = !t1Hit && dynamicStop > 0 && lo <= dynamicStop;
    if (reviewTouched && !t1InRange) {
      const range = hi - lo;
      const closeLoc = range > 0 ? (close - lo) / range * 100 : 50;
      const lwPct = range > 0 ? (Math.min(open, close) - lo) / range * 100 : 0;
      const avgV = avgVol20(history, histIdx);
      const volRatio = avgV > 0 && vol > 0 ? vol / avgV : 0;
      const atr14 = computeATR14(history, histIdx);
      const obvSlope = obv5Slope(history, histIdx);
      const dipBelowStop = (dynamicStop - lo) / dynamicStop * 100;
      const closeDistanceAtr = atr14 > 0 ? Math.max(0, dynamicStop - close) / atr14 : Infinity;
      const nearStop = close >= dynamicStop || closeDistanceAtr <= 0.25;
      const closedAboveStop = close >= dynamicStop;

      const ch1 = prev ? close - prev.c : 0;
      const ch2 = prev2 && prev ? prev.c - prev2.c : 0;
      const rsiG = prev2 ? ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2 : 0;
      const rsiL = prev2 ? ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2 : 0;
      const rsi2 = !prev2 ? 50 : rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);
      const buyerDefense = lwPct > 20 || closeLoc > 65;

      const isSpring = atr14 > 0 && closedAboveStop && (dynamicStop - lo) <= 0.5 * atr14;
      const isCapitulation = rsi2 < 10 && nearStop && buyerDefense;
      const stabilizing = !!prev && close >= prev.c && nearStop;
      const isHammer = lwPct >= 40 && closeLoc >= 55 && nearStop;
      const hasVolume = avgV > 0 && vol > 0;
      const isAccumulation = hasVolume && obvSlope > 0;
      const isNarrowSweep = atr14 > 0 && range < 0.75 * atr14 && closedAboveStop;
      const isLowVolSweep = hasVolume && volRatio < 0.65 && nearStop;
      const isolatedRed = !!prev && (prev.o ?? prev.c) <= prev.c && prev.c > dynamicStop && nearStop;
      const stopToLowRange = Math.max(0, dynamicStop - lo);
      const recoveryPct = stopToLowRange > 0 ? (close - lo) / stopToLowRange * 100 : 0;
      const strongRecovery = recoveryPct > 60 && nearStop;

      const sw5AtEntry = trade.sw5LowAtEntry ?? 0;
      const structureKnown = sw5AtEntry > 0;
      const priorSwingLow = i >= 8 ? fiveBarSwingLow(history, histIdx - 1) : 0;
      const structureRef = structureKnown ? Math.max(sw5AtEntry, priorSwingLow > 0 ? priorSwingLow : sw5AtEntry) : 0;
      const structureIntact = structureKnown && close >= structureRef * 0.997;
      const structureBroken = structureKnown && !structureIntact;
      const priceDefense = isSpring || isCapitulation || isHammer || isNarrowSweep || strongRecovery;
      const flowDefense = isAccumulation || isLowVolSweep;
      const exhaustionDefense = stabilizing || isolatedRed;
      const evidenceGroups = [priceDefense, flowDefense, exhaustionDefense, structureIntact].filter(Boolean).length;
      const confluenceShield = !closedAboveStop && nearStop && !structureBroken && priceDefense && evidenceGroups >= 2;
      const shielded = closedAboveStop || confluenceShield;

      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: dynamicStop,
        dipPct: dipBelowStop, triggerType: 'intraday_low',
        gatesTested: [],
        result: shielded ? 'SHIELDED' : 'EXIT_PENDING',
        stopKind: 'review',
        evidenceGroups,
      });

      if (shielded) continue;
      pendingReviewExit = { signalDate: cDate, stopLevel: dynamicStop };
      continue;
    }

    if (!t1Hit && effectiveT1 < Infinity && hi >= effectiveT1) {
      t1Hit = true;
      t1HitBar = i;
      status = 'hit_t1';
      closedPrice = effectiveT1;
      closedDate = cDate;
      if (entry > dynamicStop) {
        dynamicStop = entry;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `T1 hit ${effectiveT1.toFixed(2)} - hard stop moved to breakeven` });
      }
      targetLog.push({ target: 'T1', day: i + 1, date: cDate, price: effectiveT1, fraction: 0.5 });
    }

    if (t1Hit && !t2Hit && trade.target2 && trade.target2 > 0 && hi >= trade.target2) {
      t2Hit = true;
      t2HitBar = i;
      status = 'hit_t2';
      closedPrice = trade.target2;
      if (i > t1HitBar) closedDate = cDate;
      if ((trade.target1 ?? 0) > dynamicStop) {
        dynamicStop = trade.target1 ?? dynamicStop;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `T2 hit ${trade.target2.toFixed(2)} - chandelier starts` });
      }
      highestCloseSinceT2 = close;
      targetLog.push({ target: 'T2', day: i + 1, date: cDate, price: trade.target2, fraction: 0.3 });
    }

    if (t2Hit && trade.target3 && trade.target3 > 0 && hi >= trade.target3) {
      status = 'hit_t3';
      closedPrice = trade.target3;
      if (i >= t2HitBar) closedDate = cDate;
      exitBarIdx = i;
      targetLog.push({ target: 'T3', day: i + 1, date: cDate, price: trade.target3, fraction: 0.2 });
      break;
    }

    if (t2Hit && close > highestCloseSinceT2) highestCloseSinceT2 = close;
  }

  const lastCandleClose = monitoredCandles[monitoredCandles.length - 1]?.c ?? 0;
  if (status === 'hit_t1' && !t2Hit && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate = '';
  }
  if (status === 'hit_t2' && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate = '';
  }

  const daysHeld = exitBarIdx >= 0 ? exitBarIdx + 1 : monitoredCandles.length;
  if (exitBarIdx < 0 && daysHeld >= maxHoldBars && ['open', 'hit_t1', 'hit_t2'].includes(status)) {
    const lastCandle = monitoredCandles[monitoredCandles.length - 1];
    if (status === 'open') status = 'expired';
    closedPrice = lastCandle?.c ?? entry;
    closedDate = candleDate(lastCandle ?? { h: 0, l: 0, c: 0 }, entryDateBase, daysHeld);
    exitBarIdx = monitoredCandles.length - 1;
  } else if (status === 'open') {
    const lastCandle = monitoredCandles[monitoredCandles.length - 1];
    closedPrice = lastCandle?.c ?? 0;
  }

  const T1 = effectiveT1 < Infinity ? effectiveT1 : (trade.target1 ?? entry);
  const T2 = trade.target2 ?? entry;
  const T3 = trade.target3 ?? entry;
  let weightedExitPrice;
  if (status === 'hit_t1') weightedExitPrice = T1 * 0.5 + closedPrice * 0.5;
  else if (status === 'hit_t2') weightedExitPrice = T1 * 0.5 + T2 * 0.3 + closedPrice * 0.2;
  else if (status === 'hit_t3') weightedExitPrice = T1 * 0.5 + T2 * 0.3 + T3 * 0.2;
  else weightedExitPrice = closedPrice > 0 ? closedPrice : entry;

  const pnlPct = weightedExitPrice > 0 ? ((weightedExitPrice - entry) / entry) * 100 : 0;
  const pnlR = riskPerShare > 0 && weightedExitPrice > 0 ? (weightedExitPrice - entry) / riskPerShare : 0;
  const mfe = ((mfePrice - entry) / entry) * 100;
  const mae = ((maePrice - entry) / entry) * 100;
  const mfeR = riskPerShare > 0 ? (mfePrice - entry) / riskPerShare : 0;
  const maeR = riskPerShare > 0 ? (maePrice - entry) / riskPerShare : 0;

  return {
    symbol: trade.symbol,
    status,
    pnlPct: round2(pnlPct),
    pnlR: round2(pnlR),
    daysHeld,
    mfe: round2(mfe),
    mae: round2(mae),
    mfeR: round2(mfeR),
    maeR: round2(maeR),
    closedPrice: round2(closedPrice),
    closedDate: status !== 'open' ? closedDate : '',
    gateLog: gateLog.length ? gateLog : undefined,
    trailLog: trailLog.length ? trailLog : undefined,
    targetLog: targetLog.length ? targetLog : undefined,
    trailAFired,
    trailBFired,
    trailAStopExit,
    trailBStopExit,
  };
}

function tradeRow(symbol, date, ts, ps, stage, res, entry, pe, candles, sigIdx) {
  const targets = normalizeTargets(entry, pe);
  const reviewStop = finitePositive(pe.tacticalStop);
  const disasterStop = finitePositive(pe.disasterStop);
  const hardStop = disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop)
    ? disasterStop
    : reviewStop;
  if (!(entry > 0) || !(reviewStop > 0) || !(reviewStop < entry) || !(hardStop > 0) || !(hardStop < entry)) return null;
  return {
    symbol,
    stage,
    entryPrice: entry,
    entryDate: date,
    stopLoss: reviewStop,
    disasterStop: hardStop,
    target1: targets.target1,
    target2: targets.target2,
    target3: targets.target3,
    paramSetKey: ps,
    sector: '',
    conviction: res.confidence || 0,
    status: 'open',
    sw5LowAtEntry: finitePositive(pe.sw5LowAtEntry) || fiveBarSwingLow(candles, sigIdx),
    atr14AtEntry: finitePositive(pe.atr14AtEntry) || computeATR14(candles, sigIdx),
    maxHoldBars: Math.max(1, Math.min(60, Math.trunc(pe.maxHoldBars || MAX_HOLD))),
    _ts: ts,
  };
}

function pf(rows, field = 'pnlR') {
  const grossWin = rows.reduce((s, r) => s + Math.max(0, r[field]), 0);
  const grossLoss = Math.abs(rows.reduce((s, r) => s + Math.min(0, r[field]), 0));
  return grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0);
}

function summarize(rows, variantKey) {
  const n = rows.length;
  const decided = rows.filter(r => r[variantKey].status !== 'open');
  const stopped = decided.filter(r => r[variantKey].status === 'stopped');
  const hit5 = rows.filter(r => r[variantKey].mfe >= TARGET_PCT);
  const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;
  const wins = decided.filter(r => r[variantKey].pnlR > 0);
  const losses = decided.filter(r => r[variantKey].pnlR < 0);
  return {
    n,
    decided: decided.length,
    hit5: hit5.length,
    hit5Pct: n ? hit5.length / n * 100 : 0,
    winPct: decided.length ? wins.length / decided.length * 100 : 0,
    stopPct: decided.length ? stopped.length / decided.length * 100 : 0,
    pf: pf(decided.map(r => ({ pnlR: r[variantKey].pnlR }))),
    avgR: avg(decided, r => r[variantKey].pnlR),
    avgPnlPct: avg(decided, r => r[variantKey].pnlPct),
    avgMfe: avg(rows, r => r[variantKey].mfe),
    avgMae: avg(rows, r => Math.abs(r[variantKey].mae)),
    trailA: rows.filter(r => r[variantKey].trailAFired).length,
    trailB: rows.filter(r => r[variantKey].trailBFired).length,
    trailAStopExit: rows.filter(r => r[variantKey].trailAStopExit).length,
    trailBStopExit: rows.filter(r => r[variantKey].trailBStopExit).length,
  };
}

function compare(rows, baseKey, altKey) {
  const changed = rows.filter(r =>
    r[baseKey].status !== r[altKey].status ||
    Math.abs(r[baseKey].pnlR - r[altKey].pnlR) > 0.01 ||
    r[baseKey].closedDate !== r[altKey].closedDate
  );
  const better = changed.filter(r => r[baseKey].pnlR > r[altKey].pnlR + 0.05);
  const worse = changed.filter(r => r[baseKey].pnlR < r[altKey].pnlR - 0.05);
  const neutral = changed.length - better.length - worse.length;
  const avgDelta = changed.length ? changed.reduce((s, r) => s + (r[baseKey].pnlR - r[altKey].pnlR), 0) / changed.length : 0;
  const totalDelta = rows.reduce((s, r) => s + (r[baseKey].pnlR - r[altKey].pnlR), 0);
  return { changed: changed.length, better: better.length, worse: worse.length, neutral, avgDelta, totalDelta, examplesBetter: better, examplesWorse: worse };
}

function fmt(x, d = 2) {
  return Number.isFinite(x) ? x.toFixed(d) : '0.00';
}

if (!isMainThread) {
  const { analyzeStock } = require('./_compiled_current/stockEngine.js');
  const { validateTrade } = require('./_compiled_current/autoValidator.js');
  const { files, oosTs } = workerData;
  const out = {};
  for (const ps of PARAM_SETS) out[ps] = [];
  let mismatch = 0;
  let verified = 0;

  for (const fp of files) {
    const candles = parseCsv(fp);
    if (candles.length < WINDOW + MAX_HOLD + 5) continue;
    const symbol = path.basename(fp).replace('_NS_OHLCV.csv', '.NS').replace(/\.csv$/i, '');
    const lastTrade = {};

    for (let i = WINDOW; i < candles.length - MAX_HOLD - 2; i++) {
      const win = candles.slice(i - WINDOW, i + 1).map(c => ({ ts: Math.floor(c.ts / 1000), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
      for (const ps of PARAM_SETS) {
        if (i <= (lastTrade[ps] ?? -1)) continue;
        let res = null;
        try { res = analyzeStock(win, ps); } catch { continue; }
        if (!res || !BUY_STAGES.has(res.stage)) continue;
        if (REQUIRE_PROMOTED && res.tradePromoted === false) continue;

        const eIdx = i + 1;
        const entryBar = candles[eIdx];
        if (!entryBar) continue;
        const trade = tradeRow(symbol, entryBar.d, entryBar.ts, ps, res.stage, res, entryBar.o, res.priceEngine || {}, candles, i);
        if (!trade) continue;
        const maxHoldBars = trade.maxHoldBars;
        const replayCandles = candles.slice(eIdx + 1, eIdx + 1 + maxHoldBars + 1);
        if (!replayCandles.length) continue;
        const preEntryCandles = candles.slice(Math.max(0, eIdx - 80), eIdx);
        const runOpts = { preEntryCandles, maxHoldBars };

        const row = {
          symbol,
          date: entryBar.d,
          ts: entryBar.ts,
          bucket: entryBar.ts < oosTs ? 'IS' : 'OOS',
          key: ps,
          label: LABELS[ps],
        };
        for (const [variantKey, toggles] of Object.entries(VARIANTS)) {
          row[variantKey] = validateVariant(trade, replayCandles, runOpts, toggles);
        }
        if (VERIFY_COPY && verified < 200) {
          const prod = validateTrade(trade, replayCandles, runOpts);
          verified++;
          if (
            prod.status !== row.current.status ||
            prod.closedDate !== row.current.closedDate ||
            Math.abs((prod.pnlR || 0) - (row.current.pnlR || 0)) > 0.011
          ) mismatch++;
        }
        out[ps].push(row);
        lastTrade[ps] = eIdx + maxHoldBars;
      }
    }
  }
  parentPort.postMessage({ out, mismatch, verified });
  process.exit(0);
}

async function main() {
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
    .map(f => path.join(DATA_DIR, f));
  const chunks = Array.from({ length: N_WORKERS }, (_, i) => allFiles.filter((_, j) => j % N_WORKERS === i));
  const oosTs = parseDate(OOS_DATE);
  const combined = {};
  for (const ps of PARAM_SETS) combined[ps] = [];

  console.log('Trail-A/B paired backtest');
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${allFiles.length} | workers: ${N_WORKERS} | window: ${WINDOW} | OOS: ${OOS_DATE}`);
  console.log(`Signal filter: ${REQUIRE_PROMOTED ? 'BUY stages with tradePromoted != false' : 'all BUY stages'}\n`);

  let done = 0, mismatch = 0, verified = 0;
  await Promise.all(chunks.map(files => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files, oosTs } });
    w.on('message', data => {
      for (const ps of PARAM_SETS) combined[ps].push(...data.out[ps]);
      mismatch += data.mismatch || 0;
      verified += data.verified || 0;
      done += files.length;
      process.stdout.write(`  processed ${done}/${allFiles.length}\r`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  })));
  console.log('\n');
  console.log(`Validator-copy sanity check: ${verified - mismatch}/${verified} matched production status/date/R`);

  const allRows = Object.values(combined).flat();
  const buckets = [
    { name: 'ALL', rows: allRows },
    { name: 'OOS', rows: allRows.filter(r => r.bucket === 'OOS') },
  ];

  const summaries = {};
  const comparisons = {};
  for (const bucket of buckets) {
    summaries[bucket.name] = {};
    comparisons[bucket.name] = {};
    for (const key of Object.keys(VARIANTS)) summaries[bucket.name][key] = summarize(bucket.rows, key);
    comparisons[bucket.name].trailA = compare(bucket.rows, 'current', 'noA');
    comparisons[bucket.name].trailB = compare(bucket.rows, 'current', 'noB');
    comparisons[bucket.name].both = compare(bucket.rows, 'current', 'noTrails');
  }

  for (const bucket of buckets) {
    console.log(`${bucket.name} summary`);
    const hdr = ['Variant'.padEnd(10), 'N'.padStart(5), 'Hit5'.padStart(8), 'WinR'.padStart(8), 'Stop%'.padStart(8), 'PF'.padStart(7), 'AvgR'.padStart(8), 'AvgP&L'.padStart(8), 'MFE'.padStart(8), 'MAE'.padStart(8), 'TrA'.padStart(5), 'TrB'.padStart(5), 'AExit'.padStart(6), 'BExit'.padStart(6)].join('  ');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const key of Object.keys(VARIANTS)) {
      const s = summaries[bucket.name][key];
      console.log([
        key.padEnd(10),
        String(s.n).padStart(5),
        `${fmt(s.hit5Pct, 1)}%`.padStart(8),
        `${fmt(s.winPct, 1)}%`.padStart(8),
        `${fmt(s.stopPct, 1)}%`.padStart(8),
        fmt(s.pf, 2).padStart(7),
        fmt(s.avgR, 3).padStart(8),
        `${fmt(s.avgPnlPct, 2)}%`.padStart(8),
        `${fmt(s.avgMfe, 2)}%`.padStart(8),
        `${fmt(s.avgMae, 2)}%`.padStart(8),
        String(s.trailA).padStart(5),
        String(s.trailB).padStart(5),
        String(s.trailAStopExit).padStart(6),
        String(s.trailBStopExit).padStart(6),
      ].join('  '));
    }
    console.log('');
    for (const [name, c] of Object.entries(comparisons[bucket.name])) {
      console.log(`${bucket.name} ${name}: changed=${c.changed}, helped=${c.better}, hurt=${c.worse}, neutral=${c.neutral}, avgDelta=${fmt(c.avgDelta, 3)}R, totalDelta=${fmt(c.totalDelta, 2)}R`);
    }
    console.log('');
  }

  console.log('Route-level OOS deltas versus noTrails');
  const routeHdr = ['Route'.padEnd(17), 'N'.padStart(5), 'Cur AvgR'.padStart(9), 'NoTrail AvgR'.padStart(12), 'DeltaR'.padStart(8), 'Cur PF'.padStart(7), 'NoTrail PF'.padStart(10), 'Changed'.padStart(8)].join('  ');
  console.log(routeHdr);
  console.log('-'.repeat(routeHdr.length));
  const routeRows = [];
  for (const ps of PARAM_SETS) {
    const rows = combined[ps].filter(r => r.bucket === 'OOS');
    const cur = summarize(rows, 'current');
    const nt = summarize(rows, 'noTrails');
    const cmp = compare(rows, 'current', 'noTrails');
    routeRows.push({ key: ps, label: LABELS[ps], cur, noTrails: nt, cmp });
    console.log([
      LABELS[ps].padEnd(17),
      String(rows.length).padStart(5),
      fmt(cur.avgR, 3).padStart(9),
      fmt(nt.avgR, 3).padStart(12),
      fmt(cur.avgR - nt.avgR, 3).padStart(8),
      fmt(cur.pf, 2).padStart(7),
      fmt(nt.pf, 2).padStart(10),
      String(cmp.changed).padStart(8),
    ].join('  '));
  }

  const changedBoth = comparisons.ALL.both;
  const worst = changedBoth.examplesWorse
    .sort((a, b) => (a.current.pnlR - a.noTrails.pnlR) - (b.current.pnlR - b.noTrails.pnlR))
    .slice(0, 15)
    .map(r => ({
      symbol: r.symbol, date: r.date, route: r.label,
      current: { status: r.current.status, pnlR: r.current.pnlR, pnlPct: r.current.pnlPct, closedDate: r.current.closedDate },
      noTrails: { status: r.noTrails.status, pnlR: r.noTrails.pnlR, pnlPct: r.noTrails.pnlPct, closedDate: r.noTrails.closedDate },
      deltaR: round2(r.current.pnlR - r.noTrails.pnlR),
      trailA: r.current.trailAFired, trailB: r.current.trailBFired,
    }));
  const best = changedBoth.examplesBetter
    .sort((a, b) => (b.current.pnlR - b.noTrails.pnlR) - (a.current.pnlR - a.noTrails.pnlR))
    .slice(0, 15)
    .map(r => ({
      symbol: r.symbol, date: r.date, route: r.label,
      current: { status: r.current.status, pnlR: r.current.pnlR, pnlPct: r.current.pnlPct, closedDate: r.current.closedDate },
      noTrails: { status: r.noTrails.status, pnlR: r.noTrails.pnlR, pnlPct: r.noTrails.pnlPct, closedDate: r.noTrails.closedDate },
      deltaR: round2(r.current.pnlR - r.noTrails.pnlR),
      trailA: r.current.trailAFired, trailB: r.current.trailBFired,
    }));

  console.log('\nBest trail improvements vs noTrails');
  for (const r of best.slice(0, 10)) {
    console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.route.padEnd(16)} delta=${fmt(r.deltaR, 2)}R current=${r.current.status}/${fmt(r.current.pnlR, 2)}R noTrails=${r.noTrails.status}/${fmt(r.noTrails.pnlR, 2)}R A=${r.trailA?'Y':'N'} B=${r.trailB?'Y':'N'}`);
  }
  console.log('\nWorst trail degradations vs noTrails');
  for (const r of worst.slice(0, 10)) {
    console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.route.padEnd(16)} delta=${fmt(r.deltaR, 2)}R current=${r.current.status}/${fmt(r.current.pnlR, 2)}R noTrails=${r.noTrails.status}/${fmt(r.noTrails.pnlR, 2)}R A=${r.trailA?'Y':'N'} B=${r.trailB?'Y':'N'}`);
  }

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const tag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outDir, `trail_ab_audit_${tag}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    config: { DATA_DIR, WINDOW, MAX_HOLD, TARGET_PCT, OOS_DATE, REQUIRE_PROMOTED, VERIFY_COPY },
    validatorCopy: { verified, mismatch },
    summaries,
    comparisons,
    routeRows,
    best,
    worst,
  }, null, 2));
  console.log(`\nJSON -> ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
