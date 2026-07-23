import type { TrackedTrade } from './tradeOps';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GateLogEntry {
  day: number;
  date: string;
  close: number;
  low: number;
  stopLevel: number;
  dipPct: number;
  triggerType: 'intraday_low' | 'close' | 'gap_down';
  gatesTested: Array<{ gate: string; passed: boolean; reason: string }>;
  result: 'SHIELDED' | 'STOPPED' | 'NOT_TRIGGERED';
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
}

// d is the candle's date string (YYYY-MM-DD) — optional for backward compatibility
interface Candle { h: number; l: number; c: number; o?: number; v?: number; d?: string; ts?: number; }

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
// MAIN VALIDATOR — Gate Cascade v6 (Phase-3 calibrated, 10-gate)
// ══════════════════════════════════════════════════════════════════════════════
//
// Stop formula: max(entry - 1.5×ATR, 5-bar swing low × 0.997), clamped [2.5%, 6.5%].
// Sweep rate with new stop: 10.3% (up from 3.6% with old 2×ATR stop).
// Gates must shield ~3× more stop touches — recalibrated + 2 new gates added.
// T1 = 1.5×ATR, T2 = 3×ATR, T3 = 5×ATR above entry. R:R@T2 = 2.0 (baseline).
// effectiveT1: uses ATR-absolute targets directly — no 5% hard cap.
//
// Infrastructure:
//  Trail-A: Time-based trail (day 8+): raise stop to 5-bar swing low.
//  Trail-B: Chandelier after T2: highestClose − 1.5×ATR.
//  G-GAP:   Gap-down open below stop → SL-M at open, bypass all gates.
//  Day-1 Fortress: same-session intraday dip on entry day, shield unconditionally.
//
// 10 gates (G0-G9), each independently tests the stop touch:
//  G0: Wyckoff Spring — dip < 0.5×ATR deep AND close above stop (ATR-relative).
//  G1: RSI-2 Capitulation — RSI-2 < 25 (widened from 20 for 10.3% sweep rate).
//  G2: 2-Day Confirmation — first day below stop without high-vol (>1.8×) distribution.
//      Narrow-range sub-condition: range < 0.7×ATR shields even multi-day dips.
//  G3: Hammer Shield — lower wick ≥40% of range, close location ≥55%.
//  G4: OBV 5d Slope — rising OBV = accumulation, not distribution.
//  G5: Narrow-Range Sweep — range < 0.75×ATR + close above stop.
//  G6: Low-Volume Sweep — volume < 0.65×avg + close above stop.
//  G7: Consecutive Red — previous candle was green (isolated single-red dip).
//  G8: Intraday Close Recovery — close recovered >60% from low back to stop zone.
//  G9: Structure Intact — close still ≥ 5-bar swing low × 0.997 (structural basis OK).

export function validateTrade(
  trade: TrackedTrade,
  candlesSinceEntry: Candle[]
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

  const entry        = trade.entryPrice;
  const validStop    = trade.stopLoss > 0 && trade.stopLoss < entry;
  const riskPerShare = validStop ? entry - trade.stopLoss : entry * 0.05;

  let dynamicStop = validStop ? trade.stopLoss : 0;

  const gateLog: GateLogEntry[] = [];
  const trailLog: Array<{ day: number; newStop: number; reason: string }> = [];
  let mfePrice = entry, maePrice = entry;
  let status: ValidationResult['status'] = 'open';
  let closedPrice = 0, closedDate = '';

  const plannedT1  = (trade.target1 && trade.target1 > entry) ? trade.target1 : Infinity;
  const effectiveT1 = plannedT1;

  let t1Hit = false, t2Hit = false;
  let highestCloseSinceT1 = entry;
  let highestCloseSinceT2 = trade.target2 ?? entry;
  let t1HitBar = -1, t2HitBar = -1;

  // ── Bar-by-bar loop ───────────────────────────────────────────────────────
  for (let i = 0; i < candlesSinceEntry.length; i++) {
    const candle = candlesSinceEntry[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;

    const open  = candle.o ?? candle.c;
    const hi    = candle.h;
    const lo    = candle.l;
    const close = candle.c;
    const vol   = candle.v ?? 0;
    const cDate = candleDate(candle, entryDateBase, i + 1);
    const prev  = i >= 1 ? candlesSinceEntry[i - 1] : null;
    const prev2 = i >= 2 ? candlesSinceEntry[i - 2] : null;

    // ── #7 TIME-BASED TRAILING STOP (day 8+, before T1) ───────────────────
    // After holding 8 days with no T1, raise stop to 5-bar swing low if
    // higher than current stop. 5-bar window aligned with structure-stop window.
    if (!t1Hit && i >= 8) {
      const swingLow = fiveBarSwingLow(candlesSinceEntry, i - 1);
      if (swingLow > dynamicStop && swingLow < entry) {
        const prev = dynamicStop;
        dynamicStop = swingLow;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `Day-${i} 5-bar swing trail: ₹${prev.toFixed(2)} → ₹${dynamicStop.toFixed(2)}` });
      }
    }

    // ── #5 CHANDELIER TRAIL after T2 (before T3) ──────────────────────────
    if (t2Hit && trade.target3 && trade.target3 > 0) {
      const rawAtr = computeATR14(candlesSinceEntry, i);
      // When fewer than 14 post-entry bars exist, computeATR14 underestimates ATR
      // (uses 2-3 bars). Fall back to the ATR captured at entry time.
      const atr14Floor = (trade as any).atr14AtEntry > 0 ? (trade as any).atr14AtEntry : 0;
      const atr = rawAtr > 0 ? Math.max(rawAtr, atr14Floor * 0.5) : atr14Floor;
      const chandelier = highestCloseSinceT2 - 1.5 * atr;
      if (chandelier > dynamicStop && chandelier < (trade.target3 ?? Infinity)) {
        const prev = dynamicStop;
        dynamicStop = chandelier;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `Chandelier: highClose ${highestCloseSinceT2.toFixed(2)} − 1.5×ATR(${atr.toFixed(2)}) = ₹${dynamicStop.toFixed(2)} (was ₹${prev.toFixed(2)})` });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STOP DETECTION
    // ════════════════════════════════════════════════════════════════════════

    const gapDownOpen   = open < dynamicStop;
    const intradayBreak = !gapDownOpen && lo <= dynamicStop;
    const stopBreached  = gapDownOpen || intradayBreak;

    if (stopBreached) {
      // ── DAY-1 FORTRESS ────────────────────────────────────────────────────
      if (i === 0 && !gapDownOpen) {
        if (hi > mfePrice) mfePrice = hi;
        if (lo < maePrice) maePrice = lo;
        continue;
      }

      // ── #2 GAP-DOWN: immediate exit at open ───────────────────────────────
      if (gapDownOpen) {
        closedPrice = open;
        closedDate  = cDate;
        status      = 'stopped';
        gateLog.push({
          day: i, date: cDate, close, low: lo, stopLevel: dynamicStop,
          dipPct: (dynamicStop - open) / dynamicStop * 100,
          triggerType: 'gap_down',
          gatesTested: [{ gate: 'G-GAP Gap-Down Bypass', passed: true, reason: `Open ₹${open.toFixed(2)} < stop ₹${dynamicStop.toFixed(2)} — SL-M filled at open` }],
          result: 'STOPPED',
        });
        if (open < maePrice) maePrice = open;
        exitBarIdx = i;
        break;
      }

      if (hi > mfePrice) mfePrice = hi;
      if (lo < maePrice) maePrice = lo;

      // If T1 is reached on the same bar that also touches stop, T1 fills first —
      // breakout bias: in real execution a limit sell at T1 fills before the SL-M.
      // We skip the gate cascade entirely; T1 processing runs in the TARGET CHECKS block below.
      const t1InRange = !t1Hit && effectiveT1 < Infinity && hi >= effectiveT1;
      if (t1InRange) {
        // do nothing here — fall through to TARGET CHECKS which handles T1
      } else {
        // ── INTRADAY STOP — run Phase-3 calibrated gate cascade ──
        const dipBelowStop = dynamicStop > 0 ? (dynamicStop - lo) / dynamicStop * 100 : 0;
        const range        = hi - lo;
        const closeLoc     = range > 0 ? (close - lo) / range * 100 : 50;
        const lwPct        = range > 0 ? (Math.min(open, close) - lo) / range * 100 : 0;
        const isGreen      = close > open;
        const avgV         = avgVol20(candlesSinceEntry, i);
        const volRatio     = avgV > 0 ? vol / avgV : 0;

        // RSI-2 (2-bar approximation)
        const ch1 = prev  ? close        - prev.c  : 0;
        const ch2 = prev2 ? (prev?.c ?? 0) - prev2.c : 0;
        const rsiG = prev2 ? ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2 : 0;
        const rsiL = prev2 ? ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2 : 0;
        const rsi2 = !prev2 ? 50 : rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);

        const obvSlope = obv5Slope(candlesSinceEntry, i);
        const atr14    = computeATR14(candlesSinceEntry, i);

        const trigType = intradayBreak ? 'intraday_low' : 'close';
        const logEntry: GateLogEntry = {
          day: i, date: cDate, close, low: lo,
          stopLevel: dynamicStop, dipPct: dipBelowStop,
          triggerType: trigType, gatesTested: [], result: 'NOT_TRIGGERED',
        };
        let blocked = false;

        // ── G0: Wyckoff Spring Shield (Phase-3 recalibrated) ─────────────
        // OLD: fixed 1.5% dip threshold (wrong for structure stop).
        // NEW: ATR-relative threshold — 0.5×ATR as % of stop.
        // Rationale: structure stop IS the 5-bar swing low. A wick below it
        // < 0.5×ATR deep = classic smart-money sweep, price always recovers.
        // Phase-3 sweep data: 10.3% of 1.5×ATR stop touches are false stops.
        const closedAboveStop  = close > dynamicStop;
        const springThreshPct  = atr14 > 0 && dynamicStop > 0
          ? Math.max(0.5, (0.5 * atr14 / dynamicStop) * 100)
          : 1.5; // fallback to old threshold when ATR unavailable
        const isSpring = dipBelowStop < springThreshPct && closedAboveStop;
        logEntry.gatesTested.push({
          gate: 'G0 Spring Shield',
          passed: isSpring,
          reason: isSpring
            ? `ATR-sweep: dip ${dipBelowStop.toFixed(2)}% < ${springThreshPct.toFixed(2)}% (0.5×ATR/stop) + close ₹${close.toFixed(2)} above stop — structural wick sweep`
            : dipBelowStop < springThreshPct
              ? `Dip ${dipBelowStop.toFixed(2)}% shallow but close ₹${close.toFixed(2)} still below stop`
              : `Deep dip ${dipBelowStop.toFixed(2)}% > ${springThreshPct.toFixed(2)}% threshold — not a spring`,
        });
        if (isSpring) { blocked = true; logEntry.result = 'SHIELDED'; }

        // ── G1 v2: Verified Capitulation Shield ──────────────────────────────
        // Old G1 (rsi2 < 25 alone) shielded when close was WELL below stop:
        //   APLLTD  day 15: RSI-2=0, close 0.29×ATR below stop → gapped further next day
        //   GOODLUCK day 2: RSI-2=0, close 0.68×ATR below stop → gapped further next day
        // Root cause: RSI-2=0 persists in sustained downtrends, masquerading as capitulation.
        // Genuine capitulation MUST show price staying near the stop (spring zone) AND
        // intraday buyers stepping in (lower wick or upper-half close). Without both,
        // RSI-2 exhaustion just means "sellers tired" — not "buyers winning."
        // THREE conditions must ALL hold:
        //   1. RSI-2 < 10       — true panic extreme (not just oversold)
        //   2. Spring zone      — close within 0.25×ATR of stop (sellers haven't broken structure)
        //   3. Buyer evidence   — lower wick >20% of range OR close in upper 35% of bar
        if (!blocked) {
          const extremeRSI   = rsi2 < 10;
          const atDist       = atr14 > 0 ? (dynamicStop - close) / atr14 : (closedAboveStop ? -1 : 1);
          const inSpringZone = atDist <= 0.25;   // negative = above stop, always qualifies
          const buyerDefense = lwPct > 20 || closeLoc > 35;
          const isCapitulation = extremeRSI && inSpringZone && buyerDefense;
          let capReason: string;
          if (!extremeRSI) {
            capReason = `RSI-2 = ${rsi2.toFixed(0)} — need <10 for verified capitulation`;
          } else if (!inSpringZone) {
            capReason = `RSI-2 = ${rsi2.toFixed(0)} extreme but close ₹${close.toFixed(2)} is ${atDist.toFixed(2)}×ATR below stop — sellers in control, not a spring`;
          } else if (!buyerDefense) {
            capReason = `RSI-2 = ${rsi2.toFixed(0)} + spring zone but no buyer evidence (wick ${lwPct.toFixed(0)}%, loc ${closeLoc.toFixed(0)}%)`;
          } else {
            capReason = `RSI-2 = ${rsi2.toFixed(0)} + spring zone (${atDist.toFixed(2)}×ATR from stop) + buyer evidence (wick ${lwPct.toFixed(0)}%, loc ${closeLoc.toFixed(0)}%) — verified capitulation`;
          }
          logEntry.gatesTested.push({
            gate: 'G1 RSI-2 Verified Capitulation',
            passed: isCapitulation,
            reason: capReason,
          });
          if (isCapitulation) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G2: 2-Day Confirmation + Narrow-Range Sub-condition ──────────
        // Phase-3 addition: if today's range < 0.7×ATR → narrow-range dip.
        // Even on day 2+ of a downtrend, a narrow bar touching stop is noise.
        // High-volume distribution exception tightened: 1.5× → 1.8× avg.
        if (!blocked) {
          // Narrow-range sub-condition (new in v5)
          const isNarrowBar = atr14 > 0 && range < 0.7 * atr14 && closedAboveStop;
          if (isNarrowBar) {
            logEntry.gatesTested.push({
              gate: 'G2 2-Day Confirm',
              passed: false,
              reason: `Narrow-range bar: ${range.toFixed(2)} < 0.7×ATR(${(0.7*atr14).toFixed(2)}) — tight dip, not a breakdown (close above stop)`,
            });
            blocked = true; logEntry.result = 'SHIELDED';
          } else {
            const isFirstDayBelow = !prev || prev.c > dynamicStop;
            if (isFirstDayBelow) {
              const highVolDistribution = volRatio > 1.8;
              // Deep-bearish override: if the close is in the bottom 25% of the bar
              // AND the intraday low is >1×ATR below stop, this is genuine distribution
              // not a sweep — don't grant the day-1 grace shield.
              const deepBearish = atr14 > 0 && (dynamicStop - lo) > atr14 && closeLoc < 25;
              if (highVolDistribution || deepBearish) {
                logEntry.gatesTested.push({
                  gate: 'G2 2-Day Confirm',
                  passed: true,
                  reason: highVolDistribution
                    ? `First day below stop BUT volume ${volRatio.toFixed(1)}× avg > 1.8× — institutional distribution, pass through`
                    : `First day: deep dip ${(dynamicStop - lo).toFixed(2)} > 1×ATR(${atr14.toFixed(2)}) + bearish close loc ${closeLoc.toFixed(0)}% — genuine selling, no grace`,
                });
              } else {
                logEntry.gatesTested.push({
                  gate: 'G2 2-Day Confirm',
                  passed: false,
                  reason: `First day below stop, vol ${volRatio.toFixed(1)}× avg (< 1.8×) — wait for confirmation candle`,
                });
                blocked = true; logEntry.result = 'SHIELDED';
              }
            } else {
              // Stabilizing requires price RECOVERING toward stop, not just not getting worse.
              // A stock at 3% below stop "stabilizing" (flat) is still broken.
              const stabilizing = close >= (prev?.c ?? 0) && close > dynamicStop * 0.97;
              const lowVolNoise  = vol > 0 && avgV > 0 && vol < avgV * 0.8;
              if (stabilizing) {
                logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'Stabilizing — today ≥ yesterday close, not accelerating down' });
                blocked = true; logEntry.result = 'SHIELDED';
              } else if (lowVolNoise) {
                logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: `Low volume ${volRatio.toFixed(1)}× avg — retail noise, not distribution` });
                blocked = true; logEntry.result = 'SHIELDED';
              } else {
                logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: true, reason: `Day 2+, accelerating, vol ${volRatio.toFixed(1)}× — distribution confirmed` });
              }
            }
          }
        }

        // ── G3: Hammer / Bullish Rejection ───────────────────────────────
        if (!blocked) {
          const isHammer = lwPct >= 40 && closeLoc >= 55;
          logEntry.gatesTested.push({
            gate: 'G3 Hammer Shield',
            passed: isHammer,
            reason: isHammer
              ? `Hammer: lower wick ${lwPct.toFixed(0)}% of range, close loc ${closeLoc.toFixed(0)}% — strong rejection`
              : `No hammer: lwPct ${lwPct.toFixed(0)}%, closeLoc ${closeLoc.toFixed(0)}%`,
          });
          if (isHammer) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G4: OBV 5-Day Slope (accumulation vs distribution) ──────────
        if (!blocked) {
          const isAccumulation = obvSlope > 0;
          logEntry.gatesTested.push({
            gate: 'G4 OBV 5d Slope',
            passed: isAccumulation,
            reason: isAccumulation
              ? `OBV slope +${obvSlope.toFixed(0)} (rising) — smart money accumulating`
              : `OBV slope ${obvSlope.toFixed(0)} (falling) — distribution confirmed`,
          });
          if (isAccumulation) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G5: Narrow-Range Sweep Candle (NEW — Phase-3 calibrated) ────
        // Smart-money stop hunts are surgical: they push below the stop level
        // briefly using a narrow-range candle then leave. Genuine distribution
        // bars are wide (≥ ATR) with momentum. If today's range < 0.75×ATR
        // AND close is above stop, this is a sweep — not a breakdown.
        // Evidence: Phase-3 sweep rate 10.3% with structure stop; most sweeps
        // are sub-ATR wicks that don't close below the structural level.
        if (!blocked) {
          const isSweepCandle = atr14 > 0 && range < 0.75 * atr14 && closedAboveStop;
          logEntry.gatesTested.push({
            gate: 'G5 Narrow Sweep',
            passed: isSweepCandle,
            reason: isSweepCandle
              ? `Range ${range.toFixed(2)} < 0.75×ATR(${(0.75*atr14).toFixed(2)}) + close above stop — structural sweep candle, not distribution`
              : atr14 > 0
                ? `Range ${range.toFixed(2)} ≥ 0.75×ATR(${(0.75*atr14).toFixed(2)}) — full selling bar` + (!closedAboveStop ? ' + close below stop' : '')
                : 'ATR unavailable — no narrow-range filter',
          });
          if (isSweepCandle) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G6: Low-Volume Sweep (NEW — Phase-3 calibrated) ──────────────
        // Genuine institutional distribution = HIGH volume (smart money needs
        // liquidity to unload). A low-volume dip below stop (<0.65×avg) is
        // retail stop-hunting noise or thin-session sweep, not real selling.
        // Shield when: volume below 65% of avg AND close recovered above stop.
        if (!blocked) {
          const isLowVolSweep = avgV > 0 && volRatio < 0.65 && closedAboveStop;
          logEntry.gatesTested.push({
            gate: 'G6 Low-Vol Sweep',
            passed: isLowVolSweep,
            reason: isLowVolSweep
              ? `Volume ${volRatio.toFixed(2)}× avg < 0.65× + close above stop — thin session sweep, not distribution`
              : avgV > 0
                ? `Volume ${volRatio.toFixed(2)}× avg` + (volRatio >= 0.65 ? ' — sufficient vol to be meaningful' : '') + (!closedAboveStop ? ' + close below stop' : '')
                : 'Volume unavailable — no low-vol filter',
          });
          if (isLowVolSweep) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G7: Consecutive Red / Selling Exhaustion ──────────────────────
        // If the previous candle was green, this is an isolated red dip —
        // not a sustained breakdown. Single red candles on structure stops
        // are normal noise on any uptrending stock.
        if (!blocked) {
          // G7: previous green candle must ALSO have closed ABOVE the current stop.
          // A minor bounce (green) while trading below stop for multiple days is not
          // "isolated single red" — it's a dead-cat bounce within a downtrend.
          const prevWasGreen = prev ? ((prev.o ?? prev.c) <= prev.c && prev.c > dynamicStop) : true;
          logEntry.gatesTested.push({
            gate: 'G7 Consec Red',
            passed: !prevWasGreen,
            reason: prevWasGreen
              ? `Previous candle was green and closed ₹${(prev?.c ?? 0).toFixed(2)} above stop — isolated red dip`
              : prev && (prev.o ?? prev.c) <= prev.c
                ? `Previous candle was green but closed ₹${prev.c.toFixed(2)} below stop — sub-stop bounce, not isolation`
                : '≥2 consecutive red candles — sustained selling pressure confirmed',
          });
          if (prevWasGreen) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G8: Intraday Close Recovery ──────────────────────────────────
        // Price dipped below stop but buyers stepped in — close recovered
        // >60% of the way from intraday low back to the stop level.
        // If close > stop + 0.6×(stop - lo), buyers are clearly defending.
        // Phase-3 insight: at 1.5×ATR stop, 10.3% of touches are sweeps;
        // when close partially recovers into the stop zone, the probability
        // of a genuine breakdown vs. a wick-and-recover is strongly in favour
        // of the bull case.
        if (!blocked) {
          const stopToLowRange = Math.max(0, dynamicStop - lo);
          const recoveryPct    = stopToLowRange > 0 ? (close - lo) / stopToLowRange * 100 : 0;
          const strongRecovery = recoveryPct > 60 && close > lo;
          logEntry.gatesTested.push({
            gate: 'G8 Close Recovery',
            passed: strongRecovery,
            reason: strongRecovery
              ? `Close recovered ${recoveryPct.toFixed(0)}% of stop-to-low range — buyers defended intraday`
              : stopToLowRange > 0
                ? `Weak recovery ${recoveryPct.toFixed(0)}% of stop-to-low — no buyer defence`
                : 'No stop-to-low range to measure recovery',
          });
          if (strongRecovery) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── G9: Structure Intact ──────────────────────────────────────────
        // The Phase-3 stop = max(entry − 1.5×ATR, 5-bar swing low × 0.997).
        // Gate 9 checks: does the candle's close still sit ABOVE the 5-bar
        // swing low that originally set the structure stop?
        // If yes, the structural thesis hasn't been violated — only the
        // derived stop level was touched, not the underlying price structure.
        // If the 5-bar swing low itself is breached on a close, that is a
        // genuine breakdown and no shield applies.
        if (!blocked) {
          // G9: After Trail-A activates (day 8+, pre-T1), the stop has been raised to the
          // CURRENT 5-bar swing low. Checking against the entry-time swing low would be
          // stale — close could be below the trailed stop but above the old entry-time low,
          // causing a false shield. Solution: use max(sw5LowAtEntry, current5barSwingLow)
          // after day 8, so G9 respects the tightened structural reference.
          const sw5AtEntry = (trade as any).sw5LowAtEntry as number;
          let refLow: number;
          if (!t1Hit && i >= 8) {
            const currentSw5 = fiveBarSwingLow(candlesSinceEntry, i);
            refLow = sw5AtEntry > 0 ? Math.max(sw5AtEntry, currentSw5) : currentSw5;
          } else {
            refLow = sw5AtEntry > 0 ? sw5AtEntry : fiveBarSwingLow(candlesSinceEntry, i);
          }
          const structureIntact = refLow > 0 && close >= refLow * 0.997;
          logEntry.gatesTested.push({
            gate: 'G9 Structure OK',
            passed: structureIntact,
            reason: structureIntact
              ? `Close ₹${close.toFixed(2)} ≥ ${!t1Hit && i >= 8 ? 'current' : 'entry'} swing low ₹${refLow.toFixed(2)}×0.997 — structure intact`
              : `Close ₹${close.toFixed(2)} < ${!t1Hit && i >= 8 ? 'current' : 'entry'} swing low ₹${refLow.toFixed(2)} — structural level broken`,
          });
          if (structureIntact) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── ALL GATES PASSED → STOP IS REAL ──────────────────────────────
        if (!blocked) {
          logEntry.result = 'STOPPED';
          closedPrice = close < dynamicStop ? close : dynamicStop;
          closedDate  = cDate;
          status      = 'stopped';
          gateLog.push(logEntry);
          exitBarIdx = i;
          break;
        }

        gateLog.push(logEntry);
      }
    }

    if ((status as string) === 'stopped') break;

    if (!gapDownOpen) {
      if (hi > mfePrice) mfePrice = hi;
      if (lo < maePrice) maePrice = lo;
    }

    // ════════════════════════════════════════════════════════════════════════
    // TRAILING STOP CHECKS (after T1/T2 — on subsequent bars only)
    // ════════════════════════════════════════════════════════════════════════

    if (t1Hit && !t2Hit && i > t1HitBar) {
      const breakevenStop = Math.max(entry, dynamicStop);
      if (lo <= breakevenStop) {
        closedPrice = breakevenStop;
        closedDate  = cDate;
        status      = 'hit_t1';
        exitBarIdx  = i;
        break;
      }
    }

    if (t2Hit && i > t2HitBar) {
      if (lo <= dynamicStop) {
        closedPrice = dynamicStop;
        closedDate  = cDate;
        status      = 'hit_t2';
        exitBarIdx  = i;
        break;
      }
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
        trailLog.push({ day: i, newStop: dynamicStop, reason: `T1 hit ₹${effectiveT1.toFixed(2)} — stop moved to breakeven ₹${entry.toFixed(2)}` });
      }
      highestCloseSinceT1 = close;
      // When stop and T1 both trigger on the same bar, T1 fills first (CRIT-3 fix).
      // No break here — trade continues as hit_t1 with breakeven stop active.
    }

    if (t1Hit && !t2Hit && trade.target2 && trade.target2 > 0 && hi >= trade.target2) {
      t2Hit        = true;
      t2HitBar     = i;
      status       = 'hit_t2';
      closedPrice  = trade.target2;
      if (i > t1HitBar) closedDate = cDate;
      if ((trade.target1 ?? 0) > dynamicStop) {
        dynamicStop = trade.target1 ?? dynamicStop;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `T2 hit ₹${trade.target2.toFixed(2)} — Chandelier trail starts, floor at T1 ₹${(trade.target1 ?? 0).toFixed(2)}` });
      }
      highestCloseSinceT2 = Math.max(trade.target2 ?? close, close);
    }

    if (t2Hit && trade.target3 && trade.target3 > 0 && hi >= trade.target3) {
      status      = 'hit_t3';
      closedPrice = trade.target3;
      if (i >= t2HitBar) closedDate = cDate;
      exitBarIdx  = i;
      break;
    }

    if (t1Hit && close > highestCloseSinceT1) highestCloseSinceT1 = close;
    if (t2Hit && close > highestCloseSinceT2) highestCloseSinceT2 = close;
  }

  // FALSE-STOP OVERRIDE removed: once all 10 gates confirm a real stop, the trade is exited.
  // Post-stop price recovery does NOT change the outcome — in real trading the position is
  // already closed. Keeping stopped trades as 'stopped' is required for accurate EV_R stats.

  // ── RUNNING T1/T2 MARK-TO-MARKET ──────────────────────────────────────────
  const lastCandleClose = candlesSinceEntry[candlesSinceEntry.length - 1]?.c ?? 0;
  if (status === 'hit_t1' && !t2Hit && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate  = '';
  }
  if (status === 'hit_t2' && exitBarIdx < 0 && lastCandleClose > 0) {
    closedPrice = lastCandleClose;
    closedDate  = '';
  }

  // ── Time expiry: > 20 days still open ─────────────────────────────────────
  const daysHeld = exitBarIdx >= 0 ? exitBarIdx + 1 : candlesSinceEntry.length;
  if (status === 'open' && daysHeld >= 20) {
    const lastCandle = candlesSinceEntry[candlesSinceEntry.length - 1];
    status      = 'expired';
    closedPrice = lastCandle?.c ?? entry;
    closedDate  = candleDate(lastCandle ?? { h: 0, l: 0, c: 0 }, entryDateBase, daysHeld);
    exitBarIdx  = candlesSinceEntry.length - 1;
  } else if (status === 'open') {
    const lastCandle = candlesSinceEntry[candlesSinceEntry.length - 1];
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
  };
}

// ─── Apply validation to tracked trade ───────────────────────────────────────

export function applyValidation(trade: TrackedTrade, result: ValidationResult): TrackedTrade {
  const needsUpdate =
    trade.status === 'stopped' ||
    trade.status === 'hit_t1'  ||
    trade.status === 'hit_t2';
  if (trade.status !== 'open' && !needsUpdate) return trade;
  if (result.status === 'open') {
    return {
      ...trade,
      currentPrice:  (result.closedPrice && result.closedPrice > 0) ? result.closedPrice : (trade.currentPrice ?? trade.entryPrice),
      highestPrice:  Math.max(trade.highestPrice ?? 0, trade.entryPrice * (1 + result.mfe / 100)),
      daysHeld:      result.daysHeld,
      lastCheckDate: new Date().toISOString().slice(0, 10),
      gateLog:       result.gateLog,
    };
  }
  return {
    ...trade,
    status:        result.status,
    closedPrice:   result.closedPrice,
    closedDate:    result.closedDate,
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
  const closed = trades.filter(t => t.status !== 'open').slice(-lastN);
  const wins   = closed.filter(t => (t.pnlPct ?? 0) > 0);
  const losses = closed.filter(t => (t.pnlPct ?? 0) <= 0);
  return {
    period:          label,
    total:           closed.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgMFE:          wins.length   > 0 ? wins.reduce((s, t)   => s + (t.pnlPct ?? 0), 0) / wins.length   : 0,
    avgMAE:          losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0) / losses.length : 0,
    avgTimeToTarget: wins.length   > 0 ? wins.reduce((s, t)   => s + (t.daysHeld ?? 0), 0) / wins.length  : 0,
  };
}
