'use strict';

/**
 * T1 breakeven policy audit.
 *
 * ARKADE-style false negatives come from the post-T1 hard breakeven stop:
 * after T1, the remaining 50% exits if intraday low touches entry.
 *
 * This audit compares:
 *   current          T1 immediately moves remaining 50% to hard breakeven
 *   reviewUntilT2    after T1, keep protective stop at the frozen review level until T2
 *   delayedBE3       activate breakeven only after 3 completed bars after T1
 *   closeBE          after T1, breakeven needs close below entry, exits next open
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
  current: { beMode: 'immediate' },
  reviewUntilT2: { beMode: 'review_until_t2' },
  delayedBE3: { beMode: 'delay_bars', delayBars: 3 },
  closeBE: { beMode: 'close_confirmed' },
};

const BUY_STAGES = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

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

function candleDate(candle, fallbackBase, dayIndex) {
  if (candle.d && candle.d.length >= 10) return candle.d.slice(0, 10);
  const d = new Date(fallbackBase);
  if (!Number.isFinite(d.getTime())) return fallbackBase;
  d.setDate(d.getDate() + dayIndex);
  return d.toISOString().slice(0, 10);
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
  return Number.isFinite(lo) ? lo : 0;
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

function beIsActive(variant, i, t1HitBar) {
  if (variant.beMode === 'immediate') return true;
  if (variant.beMode === 'review_until_t2') return false;
  if (variant.beMode === 'delay_bars') return i - t1HitBar >= (variant.delayBars ?? 3);
  if (variant.beMode === 'close_confirmed') return false;
  return true;
}

function validateVariant(trade, candlesSinceEntry, options = {}, variant = VARIANTS.current) {
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
  const reviewStop = trade.stopLoss > 0 && trade.stopLoss < entry ? trade.stopLoss : 0;
  const hardStop = getHardStop(trade);
  const riskPerShare = hardStop > 0 ? Math.max(0, entry - hardStop) : 0;
  if (!(hardStop > 0) || !(riskPerShare > 0)) return defaultResult;
  let dynamicStop = reviewStop || hardStop;

  const preEntryCandles = (options.preEntryCandles ?? []).filter(c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  const replayCandles = candlesSinceEntry.filter(c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  const history = [...preEntryCandles, ...replayCandles];
  const historyOffset = preEntryCandles.length;
  const maxHoldBars = Math.max(1, Math.min(60, Math.trunc(options.maxHoldBars ?? trade.maxHoldBars ?? 20)));
  const monitoredCandles = replayCandles.slice(0, maxHoldBars);

  const gateLog = [], trailLog = [], targetLog = [];
  let mfePrice = entry, maePrice = entry;
  let status = 'open', closedPrice = 0, closedDate = '';
  const effectiveT1 = trade.target1 && trade.target1 > entry ? trade.target1 : Infinity;
  let t1Hit = false, t2Hit = false;
  let highestCloseSinceT2 = entry;
  let t1HitBar = -1, t2HitBar = -1;
  let pendingReviewExit = null;
  let pendingCloseBEExit = null;
  let beStopExit = false;

  for (let i = 0; i < monitoredCandles.length; i++) {
    const candle = monitoredCandles[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;
    const histIdx = historyOffset + i;
    const open = candle.o ?? candle.c;
    const hi = candle.h, lo = candle.l, close = candle.c, vol = candle.v ?? 0;
    const cDate = candleDate(candle, entryDateBase, i + 1);
    const prev = history[histIdx - 1] ?? null;
    const prev2 = history[histIdx - 2] ?? null;

    if (pendingReviewExit || pendingCloseBEExit) {
      const pending = pendingReviewExit ?? pendingCloseBEExit;
      closedPrice = open;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      if (pendingCloseBEExit) beStopExit = true;
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: pending.stopLevel,
        dipPct: pending.stopLevel > 0 ? (pending.stopLevel - open) / pending.stopLevel * 100 : 0,
        triggerType: 'review_open',
        gatesTested: [{ gate: pendingCloseBEExit ? 'T1 Close-Confirmed Breakeven' : 'REVIEW Next-Open Execution', passed: true, reason: `Confirmed on ${pending.signalDate}; exited at next open` }],
        result: 'STOPPED',
        stopKind: pendingCloseBEExit ? 'trail' : 'review',
      });
      if (open < maePrice) maePrice = open;
      exitBarIdx = i;
      break;
    }

    if (!t1Hit && i >= 10) {
      const swingLow = fiveBarSwingLow(history, histIdx - 1);
      const trailAtr = computeATR14(history, histIdx - 1);
      const bufferedTrail = swingLow - 0.45 * trailAtr;
      if (bufferedTrail > dynamicStop && bufferedTrail < entry) {
        dynamicStop = bufferedTrail;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: 'Trail-A review trail' });
      }
    }

    if (t2Hit && trade.target3 && trade.target3 > 0) {
      const rawAtr = computeATR14(history, histIdx - 1);
      const atr14Floor = trade.atr14AtEntry && trade.atr14AtEntry > 0 ? trade.atr14AtEntry : 0;
      const atr = rawAtr > 0 ? Math.max(rawAtr, atr14Floor * 0.5) : atr14Floor;
      const chandelier = highestCloseSinceT2 - 2.0 * atr;
      if (chandelier > dynamicStop && chandelier < trade.target3) {
        dynamicStop = chandelier;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: 'Trail-B chandelier' });
      }
    }

    if (hi > mfePrice) mfePrice = hi;

    const beActive = t1Hit && !t2Hit && beIsActive(variant, i, t1HitBar);
    const executableStop = t2Hit
      ? Math.max(hardStop, dynamicStop)
      : t1Hit
        ? Math.max(hardStop, beActive ? entry : (reviewStop || hardStop))
        : hardStop;
    const gapThroughHardStop = executableStop > 0 && open <= executableStop;
    const hardStopTouched = executableStop > 0 && lo <= executableStop;
    if (hardStopTouched) {
      const fill = gapThroughHardStop ? open : executableStop;
      closedPrice = fill;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      beStopExit = t1Hit && !t2Hit && beActive && executableStop >= entry;
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

    if (lo < maePrice) maePrice = lo;

    if (variant.beMode === 'close_confirmed' && t1Hit && !t2Hit && close < entry) {
      pendingCloseBEExit = { signalDate: cDate, stopLevel: entry };
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: entry,
        dipPct: (entry - close) / entry * 100,
        triggerType: 'close',
        gatesTested: [{ gate: 'T1 Close-Confirmed Breakeven', passed: true, reason: 'Close below entry after T1; exit next open' }],
        result: 'EXIT_PENDING',
        stopKind: 'trail',
      });
      continue;
    }

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
      const nearStop = close >= dynamicStop || closeDistanceAtr <= 0.30;
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
      const isDoji = atr14 > 0 && range < 0.5 * atr14 && closeDistanceAtr <= 0.15;
      const isNarrowSweep = atr14 > 0 && range < 0.75 * atr14 && (closedAboveStop || isDoji);
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
        if (variant.beMode === 'immediate') dynamicStop = entry;
        trailLog.push({ day: i + 1, newStop: variant.beMode === 'immediate' ? dynamicStop : entry, reason: 'T1 hit - breakeven protection armed' });
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
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: 'T2 hit - chandelier starts, hard floor at T1' });
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
    beStopExit,
  };
}

function buildTrade(symbol, date, ts, ps, stage, res, entry, pe, candles, sigIdx) {
  const targets = normalizeTargets(entry, pe);
  const reviewStop = finitePositive(pe.tacticalStop);
  const disasterStop = finitePositive(pe.disasterStop);
  const hardStop = disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop) ? disasterStop : reviewStop;
  if (!(entry > 0) || !(reviewStop > 0) || !(reviewStop < entry) || !(hardStop > 0) || !(hardStop < entry)) return null;
  return {
    symbol, stage, entryPrice: entry, entryDate: date, stopLoss: reviewStop, disasterStop: hardStop,
    target1: targets.target1, target2: targets.target2, target3: targets.target3,
    paramSetKey: ps, sector: '', conviction: res.confidence || 0, status: 'open',
    sw5LowAtEntry: finitePositive(pe.sw5LowAtEntry) || fiveBarSwingLow(candles, sigIdx),
    atr14AtEntry: finitePositive(pe.atr14AtEntry) || computeATR14(candles, sigIdx),
    maxHoldBars: Math.max(1, Math.min(60, Math.trunc(pe.maxHoldBars || MAX_HOLD))),
    _ts: ts,
  };
}

function pf(rows, key) {
  let win = 0, loss = 0;
  for (const r of rows) {
    const v = r[key].pnlR;
    if (v > 0) win += v;
    else if (v < 0) loss += Math.abs(v);
  }
  return loss > 0 ? win / loss : (win > 0 ? 999 : 0);
}

function summarize(rows, key) {
  const n = rows.length;
  const decided = rows.filter(r => r[key].status !== 'open');
  const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;
  const hit5 = rows.filter(r => r[key].mfe >= TARGET_PCT);
  const wins = decided.filter(r => r[key].pnlR > 0);
  const stopped = decided.filter(r => r[key].status === 'stopped');
  return {
    n,
    hit5Pct: n ? hit5.length / n * 100 : 0,
    winPct: decided.length ? wins.length / decided.length * 100 : 0,
    stopPct: decided.length ? stopped.length / decided.length * 100 : 0,
    pf: pf(decided, key),
    avgR: avg(decided, r => r[key].pnlR),
    avgPnlPct: avg(decided, r => r[key].pnlPct),
    avgMfe: avg(rows, r => r[key].mfe),
    avgMae: avg(rows, r => Math.abs(r[key].mae)),
    beStopExit: rows.filter(r => r[key].beStopExit).length,
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
  const avgDelta = changed.length ? changed.reduce((s, r) => s + (r[baseKey].pnlR - r[altKey].pnlR), 0) / changed.length : 0;
  const totalDelta = rows.reduce((s, r) => s + (r[baseKey].pnlR - r[altKey].pnlR), 0);
  return { changed: changed.length, better: better.length, worse: worse.length, neutral: changed.length - better.length - worse.length, avgDelta, totalDelta, examplesBetter: better, examplesWorse: worse };
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
  let verified = 0, mismatch = 0;

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
        const trade = buildTrade(symbol, entryBar.d, entryBar.ts, ps, res.stage, res, entryBar.o, res.priceEngine || {}, candles, i);
        if (!trade) continue;
        const replayCandles = candles.slice(eIdx + 1, eIdx + 1 + trade.maxHoldBars + 1);
        if (!replayCandles.length) continue;
        const runOpts = { preEntryCandles: candles.slice(Math.max(0, eIdx - 80), eIdx), maxHoldBars: trade.maxHoldBars };
        const row = { symbol, date: entryBar.d, ts: entryBar.ts, bucket: entryBar.ts < oosTs ? 'IS' : 'OOS', key: ps, label: LABELS[ps] };
        for (const [key, variant] of Object.entries(VARIANTS)) row[key] = validateVariant(trade, replayCandles, runOpts, variant);
        if (VERIFY_COPY && verified < 300) {
          const prod = validateTrade(trade, replayCandles, runOpts);
          verified++;
          if (prod.status !== row.current.status || prod.closedDate !== row.current.closedDate || Math.abs((prod.pnlR || 0) - (row.current.pnlR || 0)) > 0.011) mismatch++;
        }
        out[ps].push(row);
        lastTrade[ps] = eIdx + trade.maxHoldBars;
      }
    }
  }
  parentPort.postMessage({ out, verified, mismatch });
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
  console.log('T1 breakeven policy backtest');
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${allFiles.length} | workers: ${N_WORKERS} | OOS: ${OOS_DATE}`);
  console.log(`Signal filter: ${REQUIRE_PROMOTED ? 'BUY stages with tradePromoted != false' : 'all BUY stages'}\n`);
  let done = 0, verified = 0, mismatch = 0;
  await Promise.all(chunks.map(files => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files, oosTs } });
    w.on('message', data => {
      for (const ps of PARAM_SETS) combined[ps].push(...data.out[ps]);
      verified += data.verified || 0;
      mismatch += data.mismatch || 0;
      done += files.length;
      process.stdout.write(`  processed ${done}/${allFiles.length}\r`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  })));
  console.log('\n');
  console.log(`Validator-copy sanity check: ${verified - mismatch}/${verified} matched production status/date/R`);
  const allRows = Object.values(combined).flat();
  const buckets = [
    { name: 'ALL', rows: allRows },
    { name: 'OOS', rows: allRows.filter(r => r.bucket === 'OOS') },
  ];
  const summaries = {}, comparisons = {};
  for (const bucket of buckets) {
    summaries[bucket.name] = {};
    comparisons[bucket.name] = {};
    for (const key of Object.keys(VARIANTS)) summaries[bucket.name][key] = summarize(bucket.rows, key);
    for (const key of Object.keys(VARIANTS).filter(k => k !== 'current')) comparisons[bucket.name][key] = compare(bucket.rows, key, 'current');
  }
  for (const bucket of buckets) {
    console.log(`${bucket.name} summary`);
    const hdr = ['Variant'.padEnd(14), 'N'.padStart(5), 'Hit5'.padStart(8), 'WinR'.padStart(8), 'Stop%'.padStart(8), 'PF'.padStart(7), 'AvgR'.padStart(8), 'AvgP&L'.padStart(8), 'MFE'.padStart(8), 'MAE'.padStart(8), 'BEexit'.padStart(7)].join('  ');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const key of Object.keys(VARIANTS)) {
      const s = summaries[bucket.name][key];
      console.log([
        key.padEnd(14), String(s.n).padStart(5), `${fmt(s.hit5Pct, 1)}%`.padStart(8),
        `${fmt(s.winPct, 1)}%`.padStart(8), `${fmt(s.stopPct, 1)}%`.padStart(8),
        fmt(s.pf, 2).padStart(7), fmt(s.avgR, 3).padStart(8), `${fmt(s.avgPnlPct, 2)}%`.padStart(8),
        `${fmt(s.avgMfe, 2)}%`.padStart(8), `${fmt(s.avgMae, 2)}%`.padStart(8), String(s.beStopExit).padStart(7),
      ].join('  '));
    }
    console.log('');
    for (const [key, c] of Object.entries(comparisons[bucket.name])) {
      console.log(`${bucket.name} ${key} vs current: changed=${c.changed}, helped=${c.better}, hurt=${c.worse}, neutral=${c.neutral}, avgDelta=${fmt(c.avgDelta, 3)}R, totalDelta=${fmt(c.totalDelta, 2)}R`);
    }
    console.log('');
  }
  console.log('Route-level OOS deltas vs current');
  const routeHdr = ['Route'.padEnd(17), 'N'.padStart(5), 'CurrentR'.padStart(9), 'BestAlt'.padStart(14), 'AltR'.padStart(8), 'DeltaR'.padStart(8), 'CurrentPF'.padStart(9), 'AltPF'.padStart(7)].join('  ');
  console.log(routeHdr);
  console.log('-'.repeat(routeHdr.length));
  const routeRows = [];
  for (const ps of PARAM_SETS) {
    const rows = combined[ps].filter(r => r.bucket === 'OOS');
    const cur = summarize(rows, 'current');
    const alts = Object.keys(VARIANTS).filter(k => k !== 'current').map(key => ({ key, s: summarize(rows, key) }));
    const best = alts.sort((a, b) => b.s.avgR - a.s.avgR)[0] ?? { key: 'none', s: cur };
    routeRows.push({ key: ps, label: LABELS[ps], current: cur, best });
    console.log([
      LABELS[ps].padEnd(17), String(rows.length).padStart(5), fmt(cur.avgR, 3).padStart(9),
      best.key.padStart(14), fmt(best.s.avgR, 3).padStart(8), fmt(best.s.avgR - cur.avgR, 3).padStart(8),
      fmt(cur.pf, 2).padStart(9), fmt(best.s.pf, 2).padStart(7),
    ].join('  '));
  }
  const bestKey = Object.entries(comparisons.OOS).sort((a, b) => b[1].totalDelta - a[1].totalDelta)[0]?.[0] ?? 'reviewUntilT2';
  const bestCompAll = comparisons.ALL[bestKey];
  const bestExamples = bestCompAll.examplesBetter.sort((a, b) => (b[bestKey].pnlR - b.current.pnlR) - (a[bestKey].pnlR - a.current.pnlR)).slice(0, 15);
  const worstExamples = bestCompAll.examplesWorse.sort((a, b) => (a[bestKey].pnlR - a.current.pnlR) - (b[bestKey].pnlR - b.current.pnlR)).slice(0, 15);
  console.log(`\nBest improvements for ${bestKey} vs current`);
  for (const r of bestExamples.slice(0, 10)) console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.label.padEnd(16)} delta=${fmt(r[bestKey].pnlR - r.current.pnlR, 2)}R current=${r.current.status}/${fmt(r.current.pnlR, 2)}R alt=${r[bestKey].status}/${fmt(r[bestKey].pnlR, 2)}R`);
  console.log(`\nWorst degradations for ${bestKey} vs current`);
  for (const r of worstExamples.slice(0, 10)) console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.label.padEnd(16)} delta=${fmt(r[bestKey].pnlR - r.current.pnlR, 2)}R current=${r.current.status}/${fmt(r.current.pnlR, 2)}R alt=${r[bestKey].status}/${fmt(r[bestKey].pnlR, 2)}R`);
  const arkadeRows = allRows.filter(r => r.symbol === 'ARKADE.NS');
  if (arkadeRows.length) {
    console.log('\nARKADE rows');
    for (const r of arkadeRows) console.log(`  ${r.date} ${r.label} current=${r.current.status}/${fmt(r.current.pnlR, 2)}R reviewUntilT2=${r.reviewUntilT2.status}/${fmt(r.reviewUntilT2.pnlR, 2)}R delayedBE3=${r.delayedBE3.status}/${fmt(r.delayedBE3.pnlR, 2)}R closeBE=${r.closeBE.status}/${fmt(r.closeBE.pnlR, 2)}R`);
  }
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const tag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outDir, `t1_be_audit_${tag}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    config: { DATA_DIR, WINDOW, MAX_HOLD, TARGET_PCT, OOS_DATE, REQUIRE_PROMOTED, VERIFY_COPY },
    validatorCopy: { verified, mismatch },
    summaries,
    comparisons,
    routeRows,
    arkadeRows,
  }, null, 2));
  console.log(`\nJSON -> ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
