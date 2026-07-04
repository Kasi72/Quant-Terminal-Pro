import type { TrackedTrade } from './tradingUtils';

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
interface Candle { h: number; l: number; c: number; o?: number; v?: number; d?: string; }

// ─── ATR helper ──────────────────────────────────────────────────────────────
// Computes a 14-period ATR from available candles ending at idx.
// Falls back to average range if fewer than 15 bars exist.
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
// Returns positive if OBV has been rising over last 5 bars (accumulation),
// negative if falling (distribution).
function obv5Slope(candles: Candle[], idx: number): number {
  const window = Math.min(5, idx);
  if (window < 2) return 0;
  let obv = 0;
  const obvArr: number[] = [];
  for (let j = idx - window; j <= idx; j++) {
    const vol = candles[j].v ?? 0;
    const pc = candles[j - 1]?.c ?? candles[j].c;
    if (candles[j].c > pc) obv += vol;
    else if (candles[j].c < pc) obv -= vol;
    obvArr.push(obv);
  }
  // Linear slope of OBV over the window
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

// ─── Date arithmetic ──────────────────────────────────────────────────────────
// Advances a YYYY-MM-DD string by N calendar days (approximate — used only as
// fallback when candles don't carry a date field).
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
  return (candle.d && candle.d.length >= 10) ? candle.d.slice(0, 10)
    : advanceDateStr(fallbackBase, dayIndex);
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

// ─── 3-bar swing low (time-stop trail floor) ──────────────────────────────────
function threeBarSwingLow(candles: Candle[], idx: number): number {
  const start = Math.max(0, idx - 2);
  let lo = Infinity;
  for (let j = start; j <= idx; j++) lo = Math.min(lo, candles[j].l);
  return lo;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ══════════════════════════════════════════════════════════════════════════════
//
// Improvements over v1:
//
//  #1  Stop triggered by intraday LOW, not just close — correctly detects
//      intraday stop hunts that recovered by close.
//
//  #2  Gap-down immediate exit — if candle.o < stopLoss, the SL-M order was
//      filled at the open. Skip all gates; exit at open price.
//
//  #3  Actual candle date for closedDate — uses candle.d when available,
//      falls back to entryDate + dayIndex. Never stamps "today".
//
//  #4  Gate 2 high-volume exception — first-day breach on volume > 1.5× avg
//      is distribution, not a spring. Gate 2 no longer blindly shields day-1.
//
//  #5  Chandelier trail after T2 — dynamic stop = highestClose - 1.5×ATR14.
//      Much tighter than pinning to T1; better protects captured gains.
//
//  #6  OBV Gate 4 using proper 5-day cumulative slope — replaces the
//      incorrect 2-day close comparison that was labelled "OBV".
//
//  #7  Time-based trailing stop — after day 8 with no T1, the stop floor
//      rises to the 3-bar swing low if that's higher than original stop.
//      Reduces time-in-trade risk on stalling breakouts.
//
//  #8  Same-bar T1 + breakeven collision — T1 hit and low-below-entry on
//      the same bar: assume T1 fills first (breakout bias); breakeven exit
//      triggers only on a subsequent bar.

export function validateTrade(
  trade: TrackedTrade,
  candlesSinceEntry: Candle[]
): ValidationResult {
  const today = new Date().toISOString().slice(0, 10);
  const entryDateBase = (trade as any).entryDate ?? today;

  let exitBarIdx = -1; // tracks which bar the trade exited on

  const defaultResult: ValidationResult = {
    symbol: trade.symbol, status: 'open', pnlPct: 0, pnlR: 0, daysHeld: 0,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0, closedPrice: 0, closedDate: '',
    gateLog: [], trailLog: [],
  };

  if (!trade || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) return defaultResult;
  if (!Array.isArray(candlesSinceEntry) || candlesSinceEntry.length === 0) return defaultResult;

  const entry   = trade.entryPrice;
  const riskPerShare = Math.max(entry - trade.stopLoss, 0.01);

  // ── Live stop level — updated by trail logic ──────────────────────────────
  let dynamicStop = trade.stopLoss;   // rises over time; never falls

  // ── State ─────────────────────────────────────────────────────────────────
  const gateLog: GateLogEntry[] = [];
  const trailLog: Array<{ day: number; newStop: number; reason: string }> = [];
  let mfePrice = entry, maePrice = entry;
  let status: ValidationResult['status'] = 'open';
  let closedPrice = 0, closedDate = '';

  // Partial exit state
  let t1Hit = false, t2Hit = false;
  // After T1 is hit, track the highest close seen (for Chandelier after T2)
  let highestCloseSinceT1 = entry;
  let highestCloseSinceT2 = trade.target1 ?? entry;
  // Day on which T1/T2 were hit (to avoid same-bar collision)
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

    // Track MFE / MAE — deferred past gap-down check below so we don't credit
    // intraday extremes on a bar where the position exited at open (gap-down).
    // Actual update happens after the gap-down branch.

    // Update highestClose trackers (for Chandelier after T1/T2)
    if (t1Hit) {
      if (close > highestCloseSinceT1) highestCloseSinceT1 = close;
    }
    if (t2Hit) {
      if (close > highestCloseSinceT2) highestCloseSinceT2 = close;
    }

    // ── #7 TIME-BASED TRAILING STOP (day 8+, before T1) ───────────────────
    // After holding 8 days with no T1, raise stop to 3-bar swing low if
    // that level is higher than the original stop. Ratchets upward only.
    if (!t1Hit && i >= 8) {
      const swingLow = threeBarSwingLow(candlesSinceEntry, i - 1); // look back
      if (swingLow > dynamicStop && swingLow < entry) {
        const prev = dynamicStop;
        dynamicStop = swingLow;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `Day-${i} 3-bar swing low trail: ₹${prev.toFixed(2)} → ₹${dynamicStop.toFixed(2)}` });
      }
    }

    // ── #5 CHANDELIER TRAIL after T2 (before T3) ──────────────────────────
    // Dynamic stop = highestCloseSinceT2 - 1.5 × ATR14. Ratchets upward.
    if (t2Hit && trade.target3 && trade.target3 > 0) {
      const atr = computeATR14(candlesSinceEntry, i);
      const chandelier = highestCloseSinceT2 - 1.5 * atr;
      if (chandelier > dynamicStop && chandelier < (trade.target3 ?? Infinity)) {
        const prev = dynamicStop;
        dynamicStop = chandelier;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `Chandelier: highClose ${highestCloseSinceT2.toFixed(2)} − 1.5×ATR(${atr.toFixed(2)}) = ₹${dynamicStop.toFixed(2)} (was ₹${prev.toFixed(2)})` });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STOP DETECTION — checked BEFORE target hits on same bar (loss-first
    // ordering when both stop and target touched; but gap-up open resolves
    // target first — see below)
    // ════════════════════════════════════════════════════════════════════════

    // Determine if stop was breached this bar and in what way
    const gapDownOpen   = open < dynamicStop;                  // #2 gap-down
    const intradayBreak = !gapDownOpen && lo <= dynamicStop;   // #1 intraday low
    const stopBreached  = gapDownOpen || intradayBreak;

    if (stopBreached) {
      // ── #2 GAP-DOWN: immediate exit at open, no gates (even on i=0) ───
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
        exitBarIdx = i;
        break; // MFE/MAE intentionally NOT updated — position exited at open
      }

      // Position still alive past gap-down check — update MFE/MAE with this bar's extremes
      if (hi > mfePrice) mfePrice = hi;
      if (lo < maePrice) maePrice = lo;

      // ── Also: if T1 and stop both within this bar's range ───────────────
      // Breakout bias: if open is above the stop and T1 is also within range,
      // and this is NOT after T1 is hit, assume target fills before stop
      // (price went up then came back). T1 hit is handled in target section
      // below — here we just note whether T1 was already pending same bar.
      const t1InRange = !t1Hit && trade.target1 && hi >= trade.target1 && open < (trade.target1 ?? Infinity);
      if (t1InRange) {
        // Breakout bias: T1 fills first on this bar. Let the target section
        // below handle T1; skip stop cascade this iteration.
        // (T1 hit code later in this same loop iteration will set t1Hit=true)
      } else if (i > 0) {
        // ── #1 INTRADAY STOP — run full gate cascade (requires prev bar) ──
        const dipBelowStop = dynamicStop > 0 ? (dynamicStop - lo) / dynamicStop * 100 : 0;
        const range        = hi - lo;
        const closeLoc     = range > 0 ? (close - lo) / range * 100 : 50;
        const lwPct        = range > 0 ? (Math.min(open, close) - lo) / range * 100 : 0;
        const isGreen      = close > open;
        const avgV         = avgVol20(candlesSinceEntry, i);

        // Compute RSI-2 (2-period momentum proxy)
        const ch1 = prev  ? close        - prev.c  : 0;
        const ch2 = prev2 ? (prev?.c ?? 0) - prev2.c : 0;
        const rsiG = ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2;
        const rsiL = ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2;
        const rsi2 = rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);

        // OBV 5-day slope
        const obvSlope = obv5Slope(candlesSinceEntry, i);

        // ATR for context
        const atr14 = computeATR14(candlesSinceEntry, i);

        const trigType = intradayBreak ? 'intraday_low' : 'close';
        const logEntry: GateLogEntry = {
          day: i, date: cDate, close, low: lo,
          stopLevel: dynamicStop, dipPct: dipBelowStop,
          triggerType: trigType, gatesTested: [], result: 'NOT_TRIGGERED',
        };
        let blocked = false;

        // ── GATE 0: Wyckoff Spring Shield ──────────────────────────────────
        // Only triggers if the intraday dip below stop is < 1.5% AND close
        // recovered back above stop. True spring = shallow dip + recovery.
        // If close is still below stop this is NOT a spring — pass through.
        const closedAboveStop = close > dynamicStop;
        const isSpring = dipBelowStop < 1.5 && closedAboveStop;
        logEntry.gatesTested.push({
          gate: 'G0 Spring Shield',
          passed: isSpring,
          reason: isSpring
            ? `Shallow dip ${dipBelowStop.toFixed(1)}% + close ₹${close.toFixed(2)} recovered above stop — Wyckoff spring`
            : dipBelowStop < 1.5
              ? `Dip only ${dipBelowStop.toFixed(1)}% but close ₹${close.toFixed(2)} still below stop — not a spring`
              : `Deep dip ${dipBelowStop.toFixed(1)}% — no spring`,
        });
        if (isSpring) { blocked = true; logEntry.result = 'SHIELDED'; }

        // ── GATE 1: RSI-2 Capitulation Flush ──────────────────────────────
        // Deep oversold RSI-2 means panic selling — buyers likely to step in.
        if (!blocked) {
          const isCapitulation = rsi2 < 20;
          logEntry.gatesTested.push({
            gate: 'G1 RSI-2 Capitulation',
            passed: isCapitulation,
            reason: `RSI-2 = ${rsi2.toFixed(0)}${isCapitulation ? ' — extreme capitulation flush, shield' : ' — momentum not washed out'}`,
          });
          if (isCapitulation) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── GATE 2: 2-Day Confirmation (with high-volume exception) ────────
        // Shield if this is the FIRST day below stop — UNLESS volume is
        // > 1.5× avg (distribution breakdown — don't shield).
        // #4 improvement: high-volume day-1 breach is genuine, not a spring.
        if (!blocked) {
          const isFirstDayBelow = !prev || prev.c > dynamicStop;
          if (isFirstDayBelow) {
            const volRatio = avgV > 0 ? vol / avgV : 0;
            const highVolDistribution = volRatio > 1.5;
            if (highVolDistribution) {
              logEntry.gatesTested.push({
                gate: 'G2 2-Day Confirm',
                passed: true,
                reason: `First day below stop BUT volume ${volRatio.toFixed(1)}× avg — institutional distribution, do not shield`,
              });
              // Allow cascade to continue (not blocked)
            } else {
              logEntry.gatesTested.push({
                gate: 'G2 2-Day Confirm',
                passed: false,
                reason: `First day below stop, volume only ${volRatio.toFixed(1)}× avg — wait for confirmation`,
              });
              blocked = true; logEntry.result = 'SHIELDED';
            }
          } else {
            const stabilizing = close >= (prev?.c ?? 0);
            const lowVolNoise  = vol > 0 && avgV > 0 && vol < avgV * 0.8;
            if (stabilizing) {
              logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'Stabilizing — today ≥ yesterday, not accelerating down' });
              blocked = true; logEntry.result = 'SHIELDED';
            } else if (lowVolNoise) {
              logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: `Low volume (${vol > 0 && avgV > 0 ? (vol/avgV).toFixed(1) : '?'}× avg) — retail noise, not distribution` });
              blocked = true; logEntry.result = 'SHIELDED';
            } else {
              logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: true, reason: '2nd+ day below, accelerating, volume confirms' });
            }
          }
        }

        // ── GATE 3: Hammer / Bullish Rejection ────────────────────────────
        // Large lower wick + close in upper half = buyers aggressively
        // defended the level. This is a valid shield in all situations.
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

        // ── GATE 4: OBV 5-Day Slope (accumulation vs distribution) ────────
        // #6 improvement: uses real cumulative OBV slope, not a 2-day
        // close comparison. Rising OBV while price dips = accumulation.
        if (!blocked) {
          const isAccumulation = obvSlope > 0;
          logEntry.gatesTested.push({
            gate: 'G4 OBV 5d Slope',
            passed: isAccumulation,
            reason: isAccumulation
              ? `OBV slope = +${obvSlope.toFixed(0)} (rising) — smart money accumulating below stop`
              : `OBV slope = ${obvSlope.toFixed(0)} (falling) — distribution confirmed`,
          });
          if (isAccumulation) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── GATE 5: Consecutive Red (selling exhaustion check) ─────────────
        // If the previous candle was green, this is an isolated red dip,
        // not a sustained breakdown. Shield.
        if (!blocked) {
          const prevWasGreen = prev ? (prev.o ?? prev.c) <= prev.c : false;
          logEntry.gatesTested.push({
            gate: 'G5 Consec Red',
            passed: !prevWasGreen,
            reason: prevWasGreen
              ? 'Previous candle was green — isolated red dip, not a breakdown'
              : '≥2 consecutive red candles — sustained selling pressure',
          });
          if (prevWasGreen) { blocked = true; logEntry.result = 'SHIELDED'; }
        }

        // ── ALL GATES PASSED → STOP IS REAL ──────────────────────────────
        if (!blocked) {
          logEntry.result = 'STOPPED';
          // Exit price: close if close < stop (closed below), else stop level
          // (stop was breached intraday but close recovered — still stop, use
          // stop price as conservative fill assumption)
          closedPrice = close < dynamicStop ? close : dynamicStop;
          closedDate  = cDate;
          status      = 'stopped';
          gateLog.push(logEntry);
          exitBarIdx = i;
          break;
        }

        gateLog.push(logEntry);
      } // end intraday stop cascade
    } // end stopBreached block

    // Bail early if already stopped
    if ((status as string) === 'stopped') break;

    // Non-gap-down bars that didn't stop: update MFE/MAE with full intraday range
    if (!gapDownOpen) {
      if (hi > mfePrice) mfePrice = hi;
      if (lo < maePrice) maePrice = lo;
    }

    // ════════════════════════════════════════════════════════════════════════
    // TRAILING STOP CHECKS (after T1/T2 — only on subsequent bars, not same
    // bar as the target hit, to avoid same-bar collision — #8 fix)
    // ════════════════════════════════════════════════════════════════════════

    // After T1 (and on a different bar than T1 hit): trail at breakeven
    if (t1Hit && !t2Hit && i > t1HitBar) {
      // Dynamic stop is now max(breakeven, chandelier) — enforced above.
      // Explicit check: if low goes below breakeven trail stop
      const breakevenStop = Math.max(entry, dynamicStop);
      if (lo <= breakevenStop) {
        closedPrice = breakevenStop;
        closedDate  = cDate;
        status      = 'hit_t1'; // partial: T1 booked, remainder exited at breakeven
        exitBarIdx = i;
        break;
      }
    }

    // After T2 (and on a different bar): trail at Chandelier (updated above)
    if (t2Hit && i > t2HitBar) {
      if (lo <= dynamicStop) {
        closedPrice = dynamicStop;
        closedDate  = cDate;
        status      = 'hit_t2'; // partial: T1+T2 booked, remainder exited at trail
        exitBarIdx = i;
        break;
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // TARGET CHECKS — cascade upward, don't break until T3
    // ════════════════════════════════════════════════════════════════════════

    if (!t1Hit && trade.target1 && trade.target1 > 0 && hi >= trade.target1) {
      t1Hit       = true;
      t1HitBar    = i;
      status      = 'hit_t1';
      closedPrice = trade.target1;
      closedDate  = cDate;
      // Advance dynamic stop to breakeven immediately
      if (entry > dynamicStop) {
        dynamicStop = entry;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `T1 hit at ₹${trade.target1.toFixed(2)} — stop moved to breakeven ₹${entry.toFixed(2)}` });
      }
      highestCloseSinceT1 = close;
      // Continue — don't break, check T2 on same bar
    }

    if (t1Hit && !t2Hit && trade.target2 && trade.target2 > 0 && hi >= trade.target2) {
      t2Hit        = true;
      t2HitBar     = i;
      status       = 'hit_t2';
      closedPrice  = trade.target2;
      // Keep closedDate from T1 if same bar, else update
      if (i > t1HitBar) closedDate = cDate;
      // Advance dynamic stop to T1 level (floor) as Chandelier starts from here
      if ((trade.target1 ?? 0) > dynamicStop) {
        dynamicStop = trade.target1 ?? dynamicStop;
        trailLog.push({ day: i, newStop: dynamicStop, reason: `T2 hit at ₹${trade.target2.toFixed(2)} — Chandelier trail starts, floor at T1 ₹${(trade.target1 ?? 0).toFixed(2)}` });
      }
      highestCloseSinceT2 = close;
      // Continue — don't break, check T3 on same bar
    }

    if (t2Hit && trade.target3 && trade.target3 > 0 && hi >= trade.target3) {
      status      = 'hit_t3';
      closedPrice = trade.target3;
      if (i > t2HitBar) closedDate = cDate;
      exitBarIdx = i;
      break; // T3 is fully closed
    }
  } // end bar loop

  // ── Time expiry: > 20 days still open ────────────────────────────────────
  // daysHeld: use exit bar index when trade closed early, else total candles
  const daysHeld = exitBarIdx >= 0 ? exitBarIdx + 1 : candlesSinceEntry.length;
  if (status === 'open' && daysHeld >= 20) {
    const lastCandle = candlesSinceEntry[candlesSinceEntry.length - 1];
    status      = 'expired';
    closedPrice = lastCandle?.c ?? entry;
    closedDate  = candleDate(lastCandle ?? { h: 0, l: 0, c: 0 }, entryDateBase, daysHeld);
    exitBarIdx  = candlesSinceEntry.length - 1;
  }

  // ── Weighted P&L: realistic partial exit model ────────────────────────────
  //
  // Actual outcome after each target hit:
  //   hit_t1 (partial + stopped at breakeven):  50% @ T1 + 50% @ entry
  //   hit_t2 (T1 + T2 + stopped at Chandelier): 50% @ T1 + 30% @ T2 + 20% @ closedPrice
  //   hit_t3 (full):                             50% @ T1 + 30% @ T2 + 20% @ T3
  //   stopped (before T1):                       100% @ stop fill price
  //   expired:                                   100% @ last close

  let weightedExitPrice: number;
  const T1 = trade.target1 ?? entry;
  const T2 = trade.target2 ?? entry;
  const T3 = trade.target3 ?? entry;

  if (status === 'hit_t1') {
    // 50% sold at T1; remaining 50% exited at closedPrice (Chandelier/trail stop)
    weightedExitPrice = T1 * 0.5 + closedPrice * 0.5;
  } else if (status === 'hit_t2') {
    // 50% at T1, 30% at T2, remaining 20% exited at Chandelier/trail stop (closedPrice)
    weightedExitPrice = T1 * 0.5 + T2 * 0.3 + closedPrice * 0.2;
  } else if (status === 'hit_t3') {
    // Full capture across all tranches
    weightedExitPrice = T1 * 0.5 + T2 * 0.3 + T3 * 0.2;
  } else {
    // stopped / expired: full position exited at closedPrice
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
  if (trade.status !== 'open') return trade;
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
