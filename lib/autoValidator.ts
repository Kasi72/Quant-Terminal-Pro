import {
  didReachFivePctTarget,
  getTradeRiskPerShare,
  getTradeMaePct,
  getTradeMfePct,
  isTradeResolvedForWinRate,
  type TrackedTrade,
} from './tradeOps';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GateLogEntry {
  day: number;
  date: string;
  close: number;
  low: number;
  stopLevel: number;
  dipPct: number;
  triggerType: 'intraday_low' | 'close' | 'gap_down' | 'review_open';
  gatesTested: Array<{ gate: string; passed: boolean; reason: string }>;
  result: 'SHIELDED' | 'STOPPED' | 'EXIT_PENDING' | 'NOT_TRIGGERED';
  stopKind?: 'hard' | 'review' | 'trail';
  evidenceGroups?: number;
}

export interface ValidationResult {
  symbol: string;
  status: 'open' | 'hit_t1' | 'hit_t2' | 'hit_t3' | 'stopped' | 'expired';
  pnlPct: number;
  pnlR: number;
  daysHeld: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  closedPrice: number;
  closedDate: string;
  trailLog?: Array<{ day: number; newStop: number; reason: string }>;
  gateLog?: GateLogEntry[];
  targetLog?: Array<{ target: 'T1' | 'T2' | 'T3'; day: number; date: string; price: number; fraction: number }>;
}

// d is the candle's date string (YYYY-MM-DD) — optional for backward compatibility
export interface ValidationCandle {
  h: number;
  l: number;
  c: number;
  o?: number;
  v?: number;
  d?: string;
  ts?: number;
}

export interface ValidationOptions {
  // Completed candles before the entry date. Indicators are warmed from these bars,
  // while MFE/MAE and holding-period accounting still begin after entry.
  preEntryCandles?: ValidationCandle[];
  maxHoldBars?: number;
}

type Candle = ValidationCandle;

// ─── ATR helper ──────────────────────────────────────────────────────────────
function computeATR14(candles: Candle[], idx: number): number {
  if (idx < 1) return candles[0] ? candles[0].h - candles[0].l : 1;
  const period = Math.min(14, idx);
  let tr = 0;
  for (let j = idx - period + 1; j <= idx; j++) {
    const hi = candles[j].h, lo = candles[j].l, pc = candles[j - 1]?.c ?? lo;
    tr += Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
  }
  return tr / period;
}

// ─── OBV 5-day slope ─────────────────────────────────────────────────────────
function obv5Slope(candles: Candle[], idx: number): number {
  const window = Math.min(5, idx);
  if (window < 2) return 0;
  let obv = 0;
  const obvArr: number[] = [];
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

// ─── EMA helper ──────────────────────────────────────────────────────────────
function computeEMAAt(candles: Candle[], idx: number, period: number): number {
  if (idx < period - 1) return 0;
  const start = Math.max(0, idx - Math.min(idx, period * 3));
  let ema = candles[start].c;
  const k = 2 / (period + 1);
  for (let j = start + 1; j <= idx; j++) ema = candles[j].c * k + ema * (1 - k);
  return ema;
}

// ─── Date arithmetic ──────────────────────────────────────────────────────────
function advanceDateStr(base: string, days: number): string {
  try {
    const d = new Date(base);
    if (isNaN(d.getTime())) return base;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  } catch { return base; }
}

// ─── Candle date resolver ─────────────────────────────────────────────────────
function candleDate(candle: Candle, fallbackBase: string, dayIndex: number): string {
  if (candle.d && candle.d.length >= 10) return candle.d.slice(0, 10);
  if (candle.ts) return new Date((candle.ts + 19800) * 1000).toISOString().slice(0, 10);
  return advanceDateStr(fallbackBase, dayIndex);
}

// ─── 20-bar volume average ────────────────────────────────────────────────────
function avgVol20(candles: Candle[], idx: number): number {
  let s = 0, n = 0;
  for (let j = Math.max(0, idx - 20); j < idx; j++) {
    const v = candles[j].v;
    if (v != null && v > 0) { s += v; n++; }
  }
  return n > 0 ? s / n : 0;
}

// ─── 5-bar swing low (aligned with phase-3 structure stop window) ─────────────
function fiveBarSwingLow(candles: Candle[], idx: number): number {
  const start = Math.max(0, idx - 4);
  let lo = Infinity;
  for (let j = start; j <= idx; j++) lo = Math.min(lo, candles[j].l);
  return lo;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR — Gate Cascade v7 (canonical replay model)
// ══════════════════════════════════════════════════════════════════════════════
//
// Execution contract:
//  1. disasterStop is the hard broker stop. It is always stop-first and bypasses gates.
//  2. stopLoss is an end-of-day review level before T1. A wick through it is not an
//     executable stop. A confirmed review exit fills at the next session's open.
//  3. After T1, breakeven and chandelier levels are executable hard trailing stops.
//  4. G0-G9 are evaluated together. A close below the review level is shielded only
//     by confluence: price defence plus another independent evidence group, while
//     price remains near the stop and known entry structure is intact.
//  5. Indicators are warmed only from candles available before or on the replay bar.

export function validateTrade(
  trade: TrackedTrade,
  candlesSinceEntry: Candle[],
  options: ValidationOptions = {},
): ValidationResult {
  const today = new Date().toISOString().slice(0, 10);
  const entryDateBase = (trade as any).entryDate ?? today;

  let exitBarIdx = -1;

  const defaultResult: ValidationResult = {
    symbol: trade.symbol, status: 'open', pnlPct: 0, pnlR: 0, daysHeld: 0,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0, closedPrice: 0, closedDate: '',
    gateLog: [], trailLog: [],
  };

  if (!trade || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) return defaultResult;
  if (!Array.isArray(candlesSinceEntry) || candlesSinceEntry.length === 0) return defaultResult;

  const entry = trade.entryPrice;
  const validReviewStop = trade.stopLoss > 0 && trade.stopLoss < entry;
  const reviewStop = validReviewStop ? trade.stopLoss : 0;
  const validDisasterStop = trade.disasterStop > 0 && trade.disasterStop < entry;
  // A malformed disaster stop above the review level is not allowed to tighten risk
  // retrospectively. In that case the review stop is the safest deterministic fallback.
  const hardStop = validDisasterStop && (!validReviewStop || trade.disasterStop < reviewStop)
    ? trade.disasterStop
    : reviewStop;
  const riskPerShare = getTradeRiskPerShare(trade);
  // A replay without a frozen stop cannot produce defensible R, stop ordering, or
  // position outcomes. Leave the trade unresolved instead of inventing 5% risk.
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

  const gateLog: GateLogEntry[] = [];
  const trailLog: Array<{ day: number; newStop: number; reason: string }> = [];
  const targetLog: NonNullable<ValidationResult['targetLog']> = [];
  let mfePrice = entry, maePrice = entry;
  let status: ValidationResult['status'] = 'open';
  let closedPrice = 0, closedDate = '';

  const plannedT1  = (trade.target1 && trade.target1 > entry) ? trade.target1 : Infinity;
  const effectiveT1 = plannedT1;

  let t1Hit = false, t2Hit = false;
  let highestCloseSinceT2 = entry;
  let t1HitBar = -1, t2HitBar = -1;

  let pendingReviewExit: { signalDate: string; stopLevel: number } | null = null;

  // ── Bar-by-bar loop ───────────────────────────────────────────────────────
  for (let i = 0; i < monitoredCandles.length; i++) {
    const candle = monitoredCandles[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;
    const histIdx = historyOffset + i;

    const open  = candle.o ?? candle.c;
    const hi    = candle.h;
    const lo    = candle.l;
    const close = candle.c;
    const vol   = candle.v ?? 0;
    const cDate = candleDate(candle, entryDateBase, i + 1);
    const prev = history[histIdx - 1] ?? null;
    const prev2 = history[histIdx - 2] ?? null;

    // A review stop confirmed on the prior close exits at today's open. This avoids
    // using a completed daily close and then pretending the order filled earlier.
    if (pendingReviewExit) {
      closedPrice = open;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: pendingReviewExit.stopLevel,
        dipPct: pendingReviewExit.stopLevel > 0
          ? (pendingReviewExit.stopLevel - open) / pendingReviewExit.stopLevel * 100
          : 0,
        triggerType: 'review_open',
        gatesTested: [{
          gate: 'REVIEW Next-Open Execution',
          passed: true,
          reason: `Review stop confirmed on ${pendingReviewExit.signalDate}; exited at next open ₹${open.toFixed(2)}`,
        }],
        result: 'STOPPED',
        stopKind: 'review',
      });
      if (open < maePrice) maePrice = open;
      exitBarIdx = i;
      break;
    }

    // Trail-A starts after ten completed post-entry bars and uses only prior bars.
    // 10 bars (vs 8) gives trades more room to develop before tightening the stop.
    if (!t1Hit && i >= 10) {
      const swingLow = fiveBarSwingLow(history, histIdx - 1);
      const trailAtr = computeATR14(history, histIdx - 1);
      const bufferedTrail = swingLow - 0.45 * trailAtr;
      if (bufferedTrail > dynamicStop && bufferedTrail < entry) {
        const oldStop = dynamicStop;
        dynamicStop = bufferedTrail;
        trailLog.push({
          day: i + 1,
          newStop: dynamicStop,
          reason: `Day-${i + 1} review trail: ₹${oldStop.toFixed(2)} → ₹${dynamicStop.toFixed(2)} (prior swing ₹${swingLow.toFixed(2)} − 0.45×ATR)`,
        });
      }
    }

    if (t2Hit && trade.target3 && trade.target3 > 0) {
      // The stop active for this bar may use only information known before its open.
      // Using the current bar's range/close here would raise the stop retroactively.
      const rawAtr = computeATR14(history, histIdx - 1);
      const atr14Floor = trade.atr14AtEntry && trade.atr14AtEntry > 0 ? trade.atr14AtEntry : 0;
      const atr = rawAtr > 0 ? Math.max(rawAtr, atr14Floor * 0.5) : atr14Floor;
      const chandelier = highestCloseSinceT2 - 2.0 * atr;
      if (chandelier > dynamicStop && chandelier < trade.target3) {
        const oldStop = dynamicStop;
        dynamicStop = chandelier;
        trailLog.push({
          day: i + 1,
          newStop: dynamicStop,
          reason: `Chandelier: high close ₹${highestCloseSinceT2.toFixed(2)} − 2.0×ATR ₹${atr.toFixed(2)} = ₹${dynamicStop.toFixed(2)} (was ₹${oldStop.toFixed(2)})`,
        });
      }
    }

    // Hard broker stop is always authoritative. After T1, the raised breakeven /
    // chandelier stop also becomes a hard protective stop.
    const executableStop = t1Hit ? Math.max(hardStop, dynamicStop) : hardStop;
    const gapThroughHardStop = executableStop > 0 && open <= executableStop;
    const hardStopTouched = executableStop > 0 && lo <= executableStop;
    if (hardStopTouched) {
      const fill = gapThroughHardStop ? open : executableStop;
      closedPrice = fill;
      closedDate = cDate;
      status = t2Hit ? 'hit_t2' : t1Hit ? 'hit_t1' : 'stopped';
      gateLog.push({
        day: i + 1, date: cDate, close, low: lo, stopLevel: executableStop,
        dipPct: executableStop > 0 ? (executableStop - fill) / executableStop * 100 : 0,
        triggerType: gapThroughHardStop ? 'gap_down' : 'intraday_low',
        gatesTested: [{
          gate: t1Hit ? 'HARD Protective Trail' : 'HARD Disaster Stop',
          passed: true,
          reason: gapThroughHardStop
            ? `Open ₹${open.toFixed(2)} crossed hard stop ₹${executableStop.toFixed(2)}; filled at open`
            : `Low ₹${lo.toFixed(2)} crossed hard stop ₹${executableStop.toFixed(2)}; stop-first fill`,
        }],
        result: 'STOPPED',
        stopKind: t1Hit ? 'trail' : 'hard',
      });
      if (fill < maePrice) maePrice = fill;
      exitBarIdx = i;
      break;
    }

    if (hi > mfePrice) mfePrice = hi;
    if (lo < maePrice) maePrice = lo;

    // Before T1, the tactical stop is reviewed on the completed candle. T1 is a
    // resting limit order, so a same-day T1 fill is valid unless the hard stop fired.
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
      // Ultra-tight bars (< 0.5×ATR) that close within 0.15×ATR of stop are algo stop-hunts.
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
      const structureRef = structureKnown
        ? Math.max(sw5AtEntry, priorSwingLow > 0 ? priorSwingLow : sw5AtEntry)
        : 0;
      const structureIntact = structureKnown && close >= structureRef * 0.997;
      const structureBroken = structureKnown && !structureIntact;

      const logEntry: GateLogEntry = {
        day: i + 1, date: cDate, close, low: lo, stopLevel: dynamicStop,
        dipPct: dipBelowStop, triggerType: 'intraday_low',
        gatesTested: [
          { gate: 'G0 Spring Shield', passed: isSpring, reason: isSpring ? 'Shallow ATR-relative wick and close recovered above review stop' : 'No shallow close-above-stop spring' },
          { gate: 'G1 RSI-2 Verified Capitulation', passed: isCapitulation, reason: `RSI-2 ${rsi2.toFixed(0)}, close distance ${Number.isFinite(closeDistanceAtr) ? closeDistanceAtr.toFixed(2) : 'n/a'}×ATR, buyer defence ${buyerDefense ? 'yes' : 'no'}` },
          { gate: 'G2 Stabilization', passed: stabilizing, reason: stabilizing ? 'Close improved versus prior bar and remains near review stop' : 'No near-stop close stabilization' },
          { gate: 'G3 Hammer Shield', passed: isHammer, reason: `Lower wick ${lwPct.toFixed(0)}%, close location ${closeLoc.toFixed(0)}%, near stop ${nearStop ? 'yes' : 'no'}` },
          { gate: 'G4 OBV 5d Slope', passed: isAccumulation, reason: hasVolume ? `OBV slope ${obvSlope.toFixed(0)}` : 'Volume unavailable; gate cannot contribute' },
          { gate: 'G5 Narrow Sweep', passed: isNarrowSweep, reason: atr14 > 0 ? `Range ${(range / atr14).toFixed(2)}×ATR, close ${closedAboveStop ? 'above' : 'below'} stop` : 'ATR unavailable; gate cannot contribute' },
          { gate: 'G6 Low-Vol Sweep', passed: isLowVolSweep, reason: hasVolume ? `Volume ${volRatio.toFixed(2)}× average, near stop ${nearStop ? 'yes' : 'no'}` : 'Volume unavailable; gate cannot contribute' },
          { gate: 'G7 Isolated Red', passed: isolatedRed, reason: isolatedRed ? 'Prior bar was green above the stop and current close remains near it' : 'No qualifying isolated-red context' },
          { gate: 'G8 Close Recovery', passed: strongRecovery, reason: `Recovered ${recoveryPct.toFixed(0)}% of stop-to-low distance, near stop ${nearStop ? 'yes' : 'no'}` },
          { gate: 'G9 Structure OK', passed: structureIntact, reason: structureKnown ? `Close ₹${close.toFixed(2)} vs locked structure ₹${structureRef.toFixed(2)}` : 'Entry swing unavailable; gate cannot contribute and does not auto-shield' },
        ],
        result: 'NOT_TRIGGERED',
        stopKind: 'review',
      };

      const priceDefense = isSpring || isCapitulation || isHammer || isNarrowSweep || strongRecovery;
      const flowDefense = isAccumulation || isLowVolSweep;
      const exhaustionDefense = stabilizing || isolatedRed;
      const evidenceGroups = [priceDefense, flowDefense, exhaustionDefense, structureIntact].filter(Boolean).length;
      const confluenceShield = !closedAboveStop
        && nearStop
        && !structureBroken
        && priceDefense
        && evidenceGroups >= 2;
      const shielded = closedAboveStop || confluenceShield;
      logEntry.evidenceGroups = evidenceGroups;

      if (shielded) {
        logEntry.result = 'SHIELDED';
        gateLog.push(logEntry);
        continue;
      }

      logEntry.result = 'EXIT_PENDING';
      gateLog.push(logEntry);
      pendingReviewExit = { signalDate: cDate, stopLevel: dynamicStop };
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // TARGET CHECKS
    // ════════════════════════════════════════════════════════════════════════

    if (!t1Hit && effectiveT1 < Infinity && hi >= effectiveT1) {
      t1Hit       = true;
      t1HitBar    = i;
      status      = 'hit_t1';
      closedPrice = effectiveT1;
      closedDate  = cDate;
      if (entry > dynamicStop) {
        dynamicStop = entry;
      trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `T1 hit ₹${effectiveT1.toFixed(2)} — hard stop moved to breakeven ₹${entry.toFixed(2)}` });
      }
      targetLog.push({ target: 'T1', day: i + 1, date: cDate, price: effectiveT1, fraction: 0.5 });
      // The hard disaster stop was checked first. The review stop is close-based,
      // so this resting target fill is valid even when the candle wicked below it.
    }

    if (t1Hit && !t2Hit && trade.target2 && trade.target2 > 0 && hi >= trade.target2) {
      t2Hit        = true;
      t2HitBar     = i;
      status       = 'hit_t2';
      closedPrice  = trade.target2;
      if (i > t1HitBar) closedDate = cDate;
      if ((trade.target1 ?? 0) > dynamicStop) {
        dynamicStop = trade.target1 ?? dynamicStop;
        trailLog.push({ day: i + 1, newStop: dynamicStop, reason: `T2 hit ₹${trade.target2.toFixed(2)} — Chandelier trail starts, hard floor at T1 ₹${(trade.target1 ?? 0).toFixed(2)}` });
      }
      // A limit fill at T2 is not a closing print. Chandelier state starts from the
      // actual completed close and is first eligible on the following session.
      highestCloseSinceT2 = close;
      targetLog.push({ target: 'T2', day: i + 1, date: cDate, price: trade.target2, fraction: 0.3 });
    }

    if (t2Hit && trade.target3 && trade.target3 > 0 && hi >= trade.target3) {
      status      = 'hit_t3';
      closedPrice = trade.target3;
      if (i >= t2HitBar) closedDate = cDate;
      exitBarIdx  = i;
      targetLog.push({ target: 'T3', day: i + 1, date: cDate, price: trade.target3, fraction: 0.2 });
      break;
    }

    if (t2Hit && close > highestCloseSinceT2) highestCloseSinceT2 = close;
  }

  // ── RUNNING T1/T2 MARK-TO-MARKET ──────────────────────────────────────────
  const lastCandleClose = monitoredCandles[monitoredCandles.length - 1]?.c ?? 0;
  if (status === 'hit_t1' && !t2Hit && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate  = '';
  }
  if (status === 'hit_t2' && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate  = '';
  }

  // Close at the configured archetype horizon, not at the last candle supplied by
  // the caller. This makes historical replay invariant to how much future data exists.
  const daysHeld = exitBarIdx >= 0 ? exitBarIdx + 1 : monitoredCandles.length;
  if (exitBarIdx < 0 && daysHeld >= maxHoldBars && ['open', 'hit_t1', 'hit_t2'].includes(status)) {
    const lastCandle = monitoredCandles[monitoredCandles.length - 1];
    if (status === 'open') status = 'expired';
    closedPrice = lastCandle?.c ?? entry;
    closedDate  = candleDate(lastCandle ?? { h: 0, l: 0, c: 0 }, entryDateBase, daysHeld);
    exitBarIdx  = monitoredCandles.length - 1;
  } else if (status === 'open') {
    const lastCandle = monitoredCandles[monitoredCandles.length - 1];
    closedPrice = lastCandle?.c ?? 0;
  }

  // ── Weighted P&L ─────────────────────────────────────────────────────────
  // Partial exit model (50%@T1, 30%@T2, 20%@T3):
  //   hit_t1 (partial + breakeven trail): 50%@T1 + 50%@entry
  //   hit_t2 (T1+T2+Chandelier):         50%@T1 + 30%@T2 + 20%@closedPrice
  //   hit_t3 (full):                      50%@T1 + 30%@T2 + 20%@T3
  //   stopped/expired:                    100%@exit
  let weightedExitPrice: number;
  const T1 = effectiveT1 < Infinity ? effectiveT1 : (trade.target1 ?? entry);
  const T2 = trade.target2 ?? entry;
  const T3 = trade.target3 ?? entry;

  if (status === 'hit_t1') {
    weightedExitPrice = T1 * 0.5 + closedPrice * 0.5;
  } else if (status === 'hit_t2') {
    weightedExitPrice = T1 * 0.5 + T2 * 0.3 + closedPrice * 0.2;
  } else if (status === 'hit_t3') {
    weightedExitPrice = T1 * 0.5 + T2 * 0.3 + T3 * 0.2;
  } else {
    weightedExitPrice = closedPrice > 0 ? closedPrice : entry;
  }

  const pnlPct = weightedExitPrice > 0 ? ((weightedExitPrice - entry) / entry) * 100 : 0;
  const pnlR   = riskPerShare > 0 && weightedExitPrice > 0 ? (weightedExitPrice - entry) / riskPerShare : 0;
  const mfe    = ((mfePrice - entry) / entry) * 100;
  const mae    = ((maePrice - entry) / entry) * 100;
  const mfeR   = riskPerShare > 0 ? (mfePrice - entry) / riskPerShare : 0;
  const maeR   = riskPerShare > 0 ? (maePrice - entry) / riskPerShare : 0;

  return {
    symbol:      trade.symbol,
    status:      status === 'open' ? 'open' : status,
    pnlPct:      Math.round(pnlPct * 100) / 100,
    pnlR:        Math.round(pnlR   * 100) / 100,
    daysHeld,
    mfe:         Math.round(mfe  * 100) / 100,
    mae:         Math.round(mae  * 100) / 100,
    mfeR:        Math.round(mfeR * 100) / 100,
    maeR:        Math.round(maeR * 100) / 100,
    closedPrice: Math.round(closedPrice * 100) / 100,
    closedDate:  status !== 'open' ? closedDate : '',
    gateLog:     gateLog.length  > 0 ? gateLog  : undefined,
    trailLog:    trailLog.length > 0 ? trailLog : undefined,
    targetLog:   targetLog.length > 0 ? targetLog : undefined,
  };
}

// ─── Apply validation to tracked trade ───────────────────────────────────────

export function applyValidation(trade: TrackedTrade, result: ValidationResult): TrackedTrade {
  const needsUpdate =
    trade.status === 'open'    ||
    trade.status === 'hit_t1'  ||
    trade.status === 'hit_t2';
  if (!needsUpdate) return trade;
  if (result.status === 'open') {
    return {
      ...trade,
      currentPrice:  (result.closedPrice && result.closedPrice > 0) ? result.closedPrice : (trade.currentPrice ?? trade.entryPrice),
      highestPrice:  Math.max(trade.highestPrice ?? 0, trade.entryPrice * (1 + result.mfe / 100)),
      daysHeld:      result.daysHeld,
      mfe:           result.mfe,
      mae:           result.mae,
      mfeR:          result.mfeR,
      maeR:          result.maeR,
      lastCheckDate: new Date().toISOString().slice(0, 10),
      gateLog:       result.gateLog,
      trailLog:      result.trailLog,
    };
  }
  const terminal = result.closedDate.trim().length > 0;
  return {
    ...trade,
    status:        result.status,
    closedPrice:   terminal ? result.closedPrice : undefined,
    closedDate:    terminal ? result.closedDate : undefined,
    pnlPct:        result.pnlPct,
    pnlR:          result.pnlR,
    daysHeld:      result.daysHeld,
    mfe:           result.mfe,
    mae:           result.mae,
    mfeR:          result.mfeR,
    maeR:          result.maeR,
    currentPrice:  result.closedPrice,
    highestPrice:  trade.entryPrice * (1 + result.mfe / 100),
    lastCheckDate: new Date().toISOString().slice(0, 10),
    gateLog:       result.gateLog,
    trailLog:      result.trailLog,
  };
}

// ─── Rolling Stats ───────────────────────────────────────────────────────────

export interface RollingStats {
  period:          string;
  total:           number;
  wins:            number;
  losses:          number;
  winRate:         number;
  avgMFE:          number;
  avgMAE:          number;
  avgTimeToTarget: number;
}

export function computeRollingStats(
  trades: TrackedTrade[],
  lastN: number,
  label: string,
): RollingStats {
  const closed = trades.filter(isTradeResolvedForWinRate).slice(-lastN);
  const wins   = closed.filter(didReachFivePctTarget);
  const losses = closed.filter(t => !didReachFivePctTarget(t));
  const maeTrades = closed.filter(t => getTradeMaePct(t) > 0);
  return {
    period:          label,
    total:           closed.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgMFE:          wins.length   > 0 ? wins.reduce((s, t)   => s + getTradeMfePct(t), 0) / wins.length   : 0,
    avgMAE:          maeTrades.length > 0 ? maeTrades.reduce((s, t) => s + getTradeMaePct(t), 0) / maeTrades.length : 0,
    avgTimeToTarget: wins.length   > 0 ? wins.reduce((s, t)   => s + (t.daysHeld ?? 0), 0) / wins.length  : 0,
  };
}
