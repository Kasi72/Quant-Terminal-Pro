"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTrade = validateTrade;
exports.applyValidation = applyValidation;
exports.computeRollingStats = computeRollingStats;

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
    try {
        const d = new Date(base);
        if (isNaN(d.getTime())) return base;
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    } catch { return base; }
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

function validateTrade(trade, candlesSinceEntry) {
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
    const validStop = trade.stopLoss > 0 && trade.stopLoss < entry;
    const riskPerShare = validStop ? entry - trade.stopLoss : entry * 0.05;
    let dynamicStop = validStop ? trade.stopLoss : 0;

    const gateLog = [];
    const trailLog = [];
    let mfePrice = entry, maePrice = entry;
    let status = 'open';
    let closedPrice = 0, closedDate = '';

    const plannedT1 = (trade.target1 && trade.target1 > entry) ? trade.target1 : Infinity;
    const effectiveT1 = plannedT1; // no 5% cap — use ATR-absolute targets directly

    let t1Hit = false, t2Hit = false;
    let highestCloseSinceT1 = entry;
    let highestCloseSinceT2 = trade.target2 ?? entry;
    let t1HitBar = -1, t2HitBar = -1;

    for (let i = 0; i < candlesSinceEntry.length; i++) {
        const candle = candlesSinceEntry[i];
        if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;
        const open = candle.o ?? candle.c;
        const hi = candle.h;
        const lo = candle.l;
        const close = candle.c;
        const vol = candle.v ?? 0;
        const cDate = candleDate(candle, entryDateBase, i + 1);
        const prev = i >= 1 ? candlesSinceEntry[i - 1] : null;
        const prev2 = i >= 2 ? candlesSinceEntry[i - 2] : null;

        // Trail-A: day 8+, pre-T1 — raise stop to 5-bar swing low
        if (!t1Hit && i >= 8) {
            const swingLow = fiveBarSwingLow(candlesSinceEntry, i - 1);
            if (swingLow > dynamicStop && swingLow < entry) {
                const prevStop = dynamicStop;
                dynamicStop = swingLow;
                trailLog.push({ day: i, newStop: dynamicStop, reason: `Day-${i} 5-bar swing trail: ₹${prevStop.toFixed(2)} → ₹${dynamicStop.toFixed(2)}` });
            }
        }

        // Trail-B: Chandelier after T2
        if (t2Hit && trade.target3 && trade.target3 > 0) {
            const rawAtr = computeATR14(candlesSinceEntry, i);
            const atr14Floor = (trade.atr14AtEntry > 0) ? trade.atr14AtEntry : 0;
            const atr = rawAtr > 0 ? Math.max(rawAtr, atr14Floor * 0.5) : atr14Floor;
            const chandelier = highestCloseSinceT2 - 1.5 * atr;
            if (chandelier > dynamicStop && chandelier < (trade.target3 ?? Infinity)) {
                const prevStop = dynamicStop;
                dynamicStop = chandelier;
                trailLog.push({ day: i, newStop: dynamicStop, reason: `Chandelier: highClose ${highestCloseSinceT2.toFixed(2)} − 1.5×ATR(${atr.toFixed(2)}) = ₹${dynamicStop.toFixed(2)} (was ₹${prevStop.toFixed(2)})` });
            }
        }

        const gapDownOpen = open < dynamicStop;
        const intradayBreak = !gapDownOpen && lo <= dynamicStop;
        const stopBreached = gapDownOpen || intradayBreak;

        if (stopBreached) {
            // Day-1 Fortress: shield intraday dips on entry day (gap-downs still fatal)
            if (i === 0 && !gapDownOpen) {
                if (hi > mfePrice) mfePrice = hi;
                if (lo < maePrice) maePrice = lo;
                continue;
            }
            // G-GAP: gap-down open — immediate SL-M, bypass all gates
            if (gapDownOpen) {
                closedPrice = open;
                closedDate = cDate;
                status = 'stopped';
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

            const t1InRange = !t1Hit && effectiveT1 < Infinity && hi >= effectiveT1;
            if (!t1InRange) {
                // ── Intraday stop: run 10-gate cascade ────────────────────────────
                const dipBelowStop = dynamicStop > 0 ? (dynamicStop - lo) / dynamicStop * 100 : 0;
                const range = hi - lo;
                const closeLoc = range > 0 ? (close - lo) / range * 100 : 50;
                const lwPct = range > 0 ? (Math.min(open, close) - lo) / range * 100 : 0;
                const isGreen = close > open;
                const avgV = avgVol20(candlesSinceEntry, i);
                const volRatio = avgV > 0 ? vol / avgV : 0;
                const ch1 = prev ? close - prev.c : 0;
                const ch2 = prev2 ? (prev?.c ?? 0) - prev2.c : 0;
                const rsiG = prev2 ? ((ch1 > 0 ? ch1 : 0) + (ch2 > 0 ? ch2 : 0)) / 2 : 0;
                const rsiL = prev2 ? ((ch1 < 0 ? -ch1 : 0) + (ch2 < 0 ? -ch2 : 0)) / 2 : 0;
                const rsi2 = !prev2 ? 50 : rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);
                const obvSlope = obv5Slope(candlesSinceEntry, i);
                const atr14 = computeATR14(candlesSinceEntry, i);
                const trigType = intradayBreak ? 'intraday_low' : 'close';
                const logEntry = {
                    day: i, date: cDate, close, low: lo,
                    stopLevel: dynamicStop, dipPct: dipBelowStop,
                    triggerType: trigType, gatesTested: [], result: 'NOT_TRIGGERED',
                };
                let blocked = false;

                // ── G0: Wyckoff Spring — ATR-relative dip threshold ───────────────
                const closedAboveStop = close > dynamicStop;
                const springThreshPct = atr14 > 0 && dynamicStop > 0
                    ? Math.max(0.5, (0.5 * atr14 / dynamicStop) * 100)
                    : 1.5;
                const isSpring = dipBelowStop < springThreshPct && closedAboveStop;
                logEntry.gatesTested.push({
                    gate: 'G0 Spring Shield', passed: isSpring,
                    reason: isSpring
                        ? `ATR-sweep: dip ${dipBelowStop.toFixed(2)}% < ${springThreshPct.toFixed(2)}% (0.5×ATR/stop) + close above stop — structural sweep`
                        : dipBelowStop < springThreshPct
                            ? `Dip ${dipBelowStop.toFixed(2)}% shallow but close ₹${close.toFixed(2)} still below stop`
                            : `Deep dip ${dipBelowStop.toFixed(2)}% > ${springThreshPct.toFixed(2)}% threshold — not a spring`,
                });
                if (isSpring) { blocked = true; logEntry.result = 'SHIELDED'; }

                // ── G1 v2: Verified Capitulation — RSI-2<10 + spring zone + buyer evidence
                if (!blocked) {
                    const extremeRSI = rsi2 < 10;
                    const atDist = atr14 > 0 ? (dynamicStop - close) / atr14 : (closedAboveStop ? -1 : 1);
                    const inSpringZone = atDist <= 0.25;
                    const buyerDefense = lwPct > 20 || closeLoc > 35;
                    const isCapitulation = extremeRSI && inSpringZone && buyerDefense;
                    let capReason;
                    if (!extremeRSI) {
                        capReason = `RSI-2 = ${rsi2.toFixed(0)} — need <10 for verified capitulation`;
                    } else if (!inSpringZone) {
                        capReason = `RSI-2 = ${rsi2.toFixed(0)} extreme but close ₹${close.toFixed(2)} is ${atDist.toFixed(2)}×ATR below stop — sellers in control`;
                    } else if (!buyerDefense) {
                        capReason = `RSI-2 = ${rsi2.toFixed(0)} + spring zone but no buyer evidence (wick ${lwPct.toFixed(0)}%, loc ${closeLoc.toFixed(0)}%)`;
                    } else {
                        capReason = `RSI-2 = ${rsi2.toFixed(0)} + spring zone (${atDist.toFixed(2)}×ATR) + buyer evidence (wick ${lwPct.toFixed(0)}%, loc ${closeLoc.toFixed(0)}%) — verified capitulation`;
                    }
                    logEntry.gatesTested.push({ gate: 'G1 RSI-2 Verified Capitulation', passed: isCapitulation, reason: capReason });
                    if (isCapitulation) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G2: 2-Day Confirm + narrow-range sub-condition ────────────────
                if (!blocked) {
                    const isNarrowBar = atr14 > 0 && range < 0.7 * atr14 && closedAboveStop;
                    if (isNarrowBar) {
                        logEntry.gatesTested.push({
                            gate: 'G2 2-Day Confirm', passed: false,
                            reason: `Narrow-range bar: ${range.toFixed(2)} < 0.7×ATR(${(0.7 * atr14).toFixed(2)}) — tight dip (close above stop)`,
                        });
                        blocked = true; logEntry.result = 'SHIELDED';
                    } else {
                        const isFirstDayBelow = !prev || prev.c > dynamicStop;
                        if (isFirstDayBelow) {
                            const highVolDistribution = volRatio > 1.8;
                            const deepBearish = atr14 > 0 && (dynamicStop - lo) > atr14 && closeLoc < 25;
                            if (highVolDistribution || deepBearish) {
                                logEntry.gatesTested.push({
                                    gate: 'G2 2-Day Confirm', passed: true,
                                    reason: highVolDistribution
                                        ? `First day below stop, volume ${volRatio.toFixed(1)}× avg > 1.8× — institutional distribution`
                                        : `First day: deep dip ${(dynamicStop - lo).toFixed(2)} > 1×ATR + bearish close loc ${closeLoc.toFixed(0)}% — genuine selling`,
                                });
                            } else {
                                logEntry.gatesTested.push({
                                    gate: 'G2 2-Day Confirm', passed: false,
                                    reason: `First day below stop, vol ${volRatio.toFixed(1)}× avg — wait for confirmation`,
                                });
                                blocked = true; logEntry.result = 'SHIELDED';
                            }
                        } else {
                            const stabilizing = close >= (prev?.c ?? 0) && close > dynamicStop * 0.97;
                            const lowVolNoise = vol > 0 && avgV > 0 && vol < avgV * 0.8;
                            if (stabilizing) {
                                logEntry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'Stabilizing — today ≥ yesterday and recovering toward stop' });
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
                        gate: 'G3 Hammer Shield', passed: isHammer,
                        reason: isHammer
                            ? `Hammer: lower wick ${lwPct.toFixed(0)}% of range, close loc ${closeLoc.toFixed(0)}% — strong rejection`
                            : `No hammer: lwPct ${lwPct.toFixed(0)}%, closeLoc ${closeLoc.toFixed(0)}%`,
                    });
                    if (isHammer) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G4: OBV 5-Day Slope ───────────────────────────────────────────
                if (!blocked) {
                    const isAccumulation = obvSlope > 0;
                    logEntry.gatesTested.push({
                        gate: 'G4 OBV 5d Slope', passed: isAccumulation,
                        reason: isAccumulation
                            ? `OBV slope +${obvSlope.toFixed(0)} (rising) — smart money accumulating`
                            : `OBV slope ${obvSlope.toFixed(0)} (falling) — distribution confirmed`,
                    });
                    if (isAccumulation) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G5: Narrow-Range Sweep Candle ─────────────────────────────────
                if (!blocked) {
                    const isSweepCandle = atr14 > 0 && range < 0.75 * atr14 && closedAboveStop;
                    logEntry.gatesTested.push({
                        gate: 'G5 Narrow Sweep', passed: isSweepCandle,
                        reason: isSweepCandle
                            ? `Range ${range.toFixed(2)} < 0.75×ATR(${(0.75 * atr14).toFixed(2)}) + close above stop — structural sweep, not distribution`
                            : atr14 > 0
                                ? `Range ${range.toFixed(2)} ≥ 0.75×ATR(${(0.75 * atr14).toFixed(2)}) — full selling bar` + (!closedAboveStop ? ' + close below stop' : '')
                                : 'ATR unavailable — no narrow-range filter',
                    });
                    if (isSweepCandle) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G6: Low-Volume Sweep ──────────────────────────────────────────
                if (!blocked) {
                    const isLowVolSweep = avgV > 0 && volRatio < 0.65 && closedAboveStop;
                    logEntry.gatesTested.push({
                        gate: 'G6 Low-Vol Sweep', passed: isLowVolSweep,
                        reason: isLowVolSweep
                            ? `Volume ${volRatio.toFixed(2)}× avg < 0.65× + close above stop — thin session sweep`
                            : avgV > 0
                                ? `Volume ${volRatio.toFixed(2)}× avg` + (!closedAboveStop ? ' + close below stop' : '')
                                : 'Volume unavailable — no low-vol filter',
                    });
                    if (isLowVolSweep) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G7: Consecutive Red — prev green must close ABOVE stop ────────
                if (!blocked) {
                    const prevWasGreen = prev ? ((prev.o ?? prev.c) <= prev.c && prev.c > dynamicStop) : true;
                    logEntry.gatesTested.push({
                        gate: 'G7 Consec Red', passed: !prevWasGreen,
                        reason: prevWasGreen
                            ? `Previous candle was green and closed ₹${(prev?.c ?? 0).toFixed(2)} above stop — isolated red dip`
                            : prev && (prev.o ?? prev.c) <= prev.c
                                ? `Previous candle was green but closed ₹${prev.c.toFixed(2)} below stop — sub-stop bounce, not isolation`
                                : '≥2 consecutive red candles — sustained selling pressure confirmed',
                    });
                    if (prevWasGreen) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G8: Intraday Close Recovery ───────────────────────────────────
                if (!blocked) {
                    const stopToLowRange = Math.max(0, dynamicStop - lo);
                    const recoveryPct = stopToLowRange > 0 ? (close - lo) / stopToLowRange * 100 : 0;
                    const strongRecovery = recoveryPct > 60 && close > lo;
                    logEntry.gatesTested.push({
                        gate: 'G8 Close Recovery', passed: strongRecovery,
                        reason: strongRecovery
                            ? `Close recovered ${recoveryPct.toFixed(0)}% of stop-to-low range — buyers defended intraday`
                            : stopToLowRange > 0
                                ? `Weak recovery ${recoveryPct.toFixed(0)}% of stop-to-low — no buyer defence`
                                : 'No stop-to-low range to measure recovery',
                    });
                    if (strongRecovery) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── G9: Structure Intact — trail-aware after day 8 ───────────────
                if (!blocked) {
                    const sw5AtEntry = trade.sw5LowAtEntry;
                    let refLow;
                    if (!t1Hit && i >= 8) {
                        const currentSw5 = fiveBarSwingLow(candlesSinceEntry, i);
                        refLow = sw5AtEntry > 0 ? Math.max(sw5AtEntry, currentSw5) : currentSw5;
                    } else {
                        refLow = sw5AtEntry > 0 ? sw5AtEntry : fiveBarSwingLow(candlesSinceEntry, i);
                    }
                    const structureIntact = refLow > 0 && close >= refLow * 0.997;
                    logEntry.gatesTested.push({
                        gate: 'G9 Structure OK', passed: structureIntact,
                        reason: structureIntact
                            ? `Close ₹${close.toFixed(2)} ≥ ${!t1Hit && i >= 8 ? 'current' : 'entry'} swing low ₹${refLow.toFixed(2)}×0.997 — structure intact`
                            : `Close ₹${close.toFixed(2)} < ${!t1Hit && i >= 8 ? 'current' : 'entry'} swing low ₹${refLow.toFixed(2)} — structural level broken, genuine exit`,
                    });
                    if (structureIntact) { blocked = true; logEntry.result = 'SHIELDED'; }
                }

                // ── ALL GATES PASSED → STOP IS REAL ──────────────────────────────
                if (!blocked) {
                    logEntry.result = 'STOPPED';
                    closedPrice = close < dynamicStop ? close : dynamicStop;
                    closedDate = cDate;
                    status = 'stopped';
                    gateLog.push(logEntry);
                    exitBarIdx = i;
                    break;
                }
                gateLog.push(logEntry);
            }
        }

        if (status === 'stopped') break;
        if (!gapDownOpen) {
            if (hi > mfePrice) mfePrice = hi;
            if (lo < maePrice) maePrice = lo;
        }

        if (t1Hit && !t2Hit && i > t1HitBar) {
            const breakevenStop = Math.max(entry, dynamicStop);
            if (lo <= breakevenStop) {
                closedPrice = breakevenStop;
                closedDate = cDate;
                status = 'hit_t1';
                exitBarIdx = i;
                break;
            }
        }
        if (t2Hit && i > t2HitBar) {
            if (lo <= dynamicStop) {
                closedPrice = dynamicStop;
                closedDate = cDate;
                status = 'hit_t2';
                exitBarIdx = i;
                break;
            }
        }

        if (!t1Hit && effectiveT1 < Infinity && hi >= effectiveT1) {
            t1Hit = true;
            t1HitBar = i;
            status = 'hit_t1';
            closedPrice = effectiveT1;
            closedDate = cDate;
            if (entry > dynamicStop) {
                dynamicStop = entry;
                trailLog.push({ day: i, newStop: dynamicStop, reason: `T1 hit ₹${effectiveT1.toFixed(2)} — stop moved to breakeven ₹${entry.toFixed(2)}` });
            }
            highestCloseSinceT1 = close;
        }
        if (t1Hit && !t2Hit && trade.target2 && trade.target2 > 0 && hi >= trade.target2) {
            t2Hit = true;
            t2HitBar = i;
            status = 'hit_t2';
            closedPrice = trade.target2;
            if (i > t1HitBar) closedDate = cDate;
            if ((trade.target1 ?? 0) > dynamicStop) {
                dynamicStop = trade.target1 ?? dynamicStop;
                trailLog.push({ day: i, newStop: dynamicStop, reason: `T2 hit ₹${trade.target2.toFixed(2)} — Chandelier trail starts, floor at T1 ₹${(trade.target1 ?? 0).toFixed(2)}` });
            }
            highestCloseSinceT2 = Math.max(trade.target2 ?? close, close);
        }
        if (t2Hit && trade.target3 && trade.target3 > 0 && hi >= trade.target3) {
            status = 'hit_t3';
            closedPrice = trade.target3;
            if (i >= t2HitBar) closedDate = cDate;
            exitBarIdx = i;
            break;
        }
        if (t1Hit && close > highestCloseSinceT1) highestCloseSinceT1 = close;
        if (t2Hit && close > highestCloseSinceT2) highestCloseSinceT2 = close;
    }

    // FALSE-STOP OVERRIDE REMOVED: once all 10 gates confirm a real stop, the trade is exited.
    // Post-stop price recovery does NOT change the outcome — in real trading the position is
    // already closed. Keeping stopped trades as 'stopped' is required for accurate EV_R stats.

    const lastCandleClose = candlesSinceEntry[candlesSinceEntry.length - 1]?.c ?? 0;
    if (status === 'hit_t1' && !t2Hit && exitBarIdx < 0 && lastCandleClose > 0) {
        closedPrice = lastCandleClose;
        closedDate = '';
    }
    if (status === 'hit_t2' && exitBarIdx < 0 && lastCandleClose > 0) {
        closedPrice = lastCandleClose;
        closedDate = '';
    }

    const daysHeld = exitBarIdx >= 0 ? exitBarIdx + 1 : candlesSinceEntry.length;
    if (status === 'open' && daysHeld >= 20) {
        const lastCandle = candlesSinceEntry[candlesSinceEntry.length - 1];
        status = 'expired';
        closedPrice = lastCandle?.c ?? entry;
        closedDate = candleDate(lastCandle ?? { h: 0, l: 0, c: 0 }, entryDateBase, daysHeld);
        exitBarIdx = candlesSinceEntry.length - 1;
    } else if (status === 'open') {
        const lastCandle = candlesSinceEntry[candlesSinceEntry.length - 1];
        closedPrice = lastCandle?.c ?? 0;
    }

    let weightedExitPrice;
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
    const pnlR = riskPerShare > 0 && weightedExitPrice > 0 ? (weightedExitPrice - entry) / riskPerShare : 0;
    const mfe = ((mfePrice - entry) / entry) * 100;
    const mae = ((maePrice - entry) / entry) * 100;
    const mfeR = riskPerShare > 0 ? (mfePrice - entry) / riskPerShare : 0;
    const maeR = riskPerShare > 0 ? (maePrice - entry) / riskPerShare : 0;

    return {
        symbol: trade.symbol,
        status: status === 'open' ? 'open' : status,
        pnlPct: Math.round(pnlPct * 100) / 100,
        pnlR: Math.round(pnlR * 100) / 100,
        daysHeld,
        mfe: Math.round(mfe * 100) / 100,
        mae: Math.round(mae * 100) / 100,
        mfeR: Math.round(mfeR * 100) / 100,
        maeR: Math.round(maeR * 100) / 100,
        closedPrice: Math.round(closedPrice * 100) / 100,
        closedDate: status !== 'open' ? closedDate : '',
        gateLog: gateLog.length > 0 ? gateLog : undefined,
        trailLog: trailLog.length > 0 ? trailLog : undefined,
    };
}

function applyValidation(trade, result) {
    const needsUpdate =
        trade.status === 'stopped' ||
        trade.status === 'hit_t1' ||
        trade.status === 'hit_t2';
    if (trade.status !== 'open' && !needsUpdate) return trade;
    if (result.status === 'open') {
        return {
            ...trade,
            currentPrice: (result.closedPrice && result.closedPrice > 0) ? result.closedPrice : (trade.currentPrice ?? trade.entryPrice),
            highestPrice: Math.max(trade.highestPrice ?? 0, trade.entryPrice * (1 + result.mfe / 100)),
            daysHeld: result.daysHeld,
            lastCheckDate: new Date().toISOString().slice(0, 10),
            gateLog: result.gateLog,
        };
    }
    return {
        ...trade,
        status: result.status,
        closedPrice: result.closedPrice,
        closedDate: result.closedDate,
        pnlPct: result.pnlPct,
        pnlR: result.pnlR,
        daysHeld: result.daysHeld,
        mfe: result.mfe,
        mae: result.mae,
        mfeR: result.mfeR,
        maeR: result.maeR,
        currentPrice: result.closedPrice,
        highestPrice: trade.entryPrice * (1 + result.mfe / 100),
        lastCheckDate: new Date().toISOString().slice(0, 10),
        gateLog: result.gateLog,
        trailLog: result.trailLog,
    };
}

function computeRollingStats(trades, lastN, label) {
    const closed = trades.filter(t => t.status !== 'open').slice(-lastN);
    const wins = closed.filter(t => (t.pnlPct ?? 0) > 0);
    const losses = closed.filter(t => (t.pnlPct ?? 0) <= 0);
    return {
        period: label,
        total: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        avgMFE: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / wins.length : 0,
        avgMAE: losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0) / losses.length : 0,
        avgTimeToTarget: wins.length > 0 ? wins.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / wins.length : 0,
    };
}
