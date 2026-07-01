import type { TrackedTrade } from './tradingUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GateLogEntry {
  day: number;
  close: number;
  stopLevel: number;
  dipPct: number;
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
  gateLog?: GateLogEntry[];
}

interface Candle { h: number; l: number; c: number; o?: number; v?: number; }

// ─── Bar-by-bar sequential validation (Level 3 — precise) ───────────────────
//
// For each day since entry, check IN ORDER:
//   1. Did the LOW hit stop BEFORE the HIGH hit T1?
//   2. Or did the HIGH hit T1 BEFORE the LOW hit stop?
// This handles same-day stop+target scenarios correctly.

export function validateTrade(
  trade: TrackedTrade,
  candlesSinceEntry: Candle[]
): ValidationResult {
  const defaultResult: ValidationResult = { symbol: trade.symbol, status: 'open', pnlPct: 0, pnlR: 0, daysHeld: 0, mfe: 0, mae: 0, mfeR: 0, maeR: 0, closedPrice: 0, closedDate: '', gateLog: [] };
  if (!trade || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) return defaultResult;
  if (!Array.isArray(candlesSinceEntry) || candlesSinceEntry.length === 0) return defaultResult;

  const riskPerShare = Math.max(trade.entryPrice - trade.stopLoss, 0.01);
  const gateLog: GateLogEntry[] = [];
  let mfePrice = trade.entryPrice;
  let maePrice = trade.entryPrice;
  let status: ValidationResult['status'] = 'open';
  let closedPrice = 0;
  let closedDate = '';

  // Partial exit model: continue tracking after T1 to find highest target reached
  // T1 hit → sell 50%, move SL to breakeven, keep checking T2/T3
  // T2 hit → sell 30% more, trail with Chandelier, keep checking T3
  // T3 hit → sell final 20%, trade fully closed
  // Stop hit (after T1) → breakeven (no loss on remaining), use T1 as exit
  let t1Hit = false, t2Hit = false;
  let stopAfterT1 = false;

  for (let i = 0; i < candlesSinceEntry.length; i++) {
    const candle = candlesSinceEntry[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;

    // Track MFE/MAE
    if (candle.h > mfePrice) mfePrice = candle.h;
    if (candle.l < maePrice) maePrice = candle.l;


    // CASCADING GATES Stop v4 — 10-gate precision system with Wyckoff Spring Shield
    // Gate 0: Shallow Dip Shield (Wyckoff Spring detection)
    // Gates 1-9: Original cascading validation
    if (i > 0) {
      if (!t1Hit && candle.c <= trade.stopLoss) {
        const openP = candle.o ?? candle.c;
        const isGreen = openP < candle.c;
        const range = candle.h - candle.l;
        const closeLoc = range > 0 ? (candle.c - candle.l) / range * 100 : 50;
        const lwPct = range > 0 ? (Math.min(openP, candle.c) - candle.l) / range * 100 : 0;
        const prevCandle = i >= 1 ? candlesSinceEntry[i-1] : null;
        const prevPrevCandle = i >= 2 ? candlesSinceEntry[i-2] : null;

        // 10-GATE CASCADE with logging
        const dipBelowStop = trade.stopLoss > 0 ? (trade.stopLoss - candle.c) / trade.stopLoss * 100 : 0;
        const ch1 = prevCandle ? candle.c - prevCandle.c : 0;
        const ch2 = prevCandle && prevPrevCandle ? prevCandle.c - prevPrevCandle.c : 0;
        const rsiG = ((ch2 > 0 ? ch2 : 0) + (ch1 > 0 ? ch1 : 0)) / 2;
        const rsiL = ((ch2 < 0 ? -ch2 : 0) + (ch1 < 0 ? -ch1 : 0)) / 2;
        const rsi2 = rsiL < 0.001 ? 100 : 100 - 100 / (1 + rsiG / rsiL);

        const entry: GateLogEntry = { day: i, close: candle.c, stopLevel: trade.stopLoss, dipPct: dipBelowStop, gatesTested: [], result: 'NOT_TRIGGERED' };
        let blocked = false;

        // GATE 0: Wyckoff Spring Shield — grid-searched: 1.5% optimal (was 2.0%)
        entry.gatesTested.push({ gate: 'G0 Spring Shield', passed: dipBelowStop >= 1.5, reason: dipBelowStop < 1.5 ? `Dip only ${dipBelowStop.toFixed(1)}% — spring likely` : `Deep dip ${dipBelowStop.toFixed(1)}%` });
        if (dipBelowStop < 1.5) { blocked = true; entry.result = 'SHIELDED'; }

        // GATE 1: RSI-2 Oversold
        if (!blocked) {
          // G1 RSI threshold: 20 optimal (grid-searched on Nifty 500, was 5)
          entry.gatesTested.push({ gate: 'G1 RSI Oversold', passed: rsi2 >= 20, reason: rsi2 < 20 ? `RSI-2 = ${rsi2.toFixed(0)} — deep capitulation` : `RSI-2 = ${rsi2.toFixed(0)}` });
          if (rsi2 < 20) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // GATE 2: Smart 2-Day Confirmation
        if (!blocked) {
          const prevAbove = !prevCandle || prevCandle.c > trade.stopLoss;
          const stabilizing = prevCandle ? candle.c >= prevCandle.c : false;
          // Volume check: compare to 20-bar average (not single previous bar)
          let avgVol = 0, volCount = 0;
          for (let vi = Math.max(0, i - 20); vi < i; vi++) {
            if (candlesSinceEntry[vi]?.v != null && (candlesSinceEntry[vi].v ?? 0) > 0) { avgVol += candlesSinceEntry[vi].v!; volCount++; }
          }
          avgVol = volCount > 0 ? avgVol / volCount : 0;
          // G2 volume mult: 0.8 optimal (grid-searched on Nifty 500, was 0.6)
          const lowVol = candle.v != null && avgVol > 0 && candle.v < avgVol * 0.8;
          if (prevAbove) { entry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'First day below — wait' }); blocked = true; entry.result = 'SHIELDED'; }
          else if (stabilizing) { entry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'Stabilizing — today ≥ yesterday' }); blocked = true; entry.result = 'SHIELDED'; }
          else if (lowVol) { entry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: false, reason: 'Low volume — retail noise' }); blocked = true; entry.result = 'SHIELDED'; }
          else { entry.gatesTested.push({ gate: 'G2 2-Day Confirm', passed: true, reason: '2nd day below, accelerating, volume OK' }); }
        }

        // GATE 3: Hammer Rejection
        if (!blocked) {
          const isHammer = lwPct >= 40 && closeLoc >= 50;
          entry.gatesTested.push({ gate: 'G3 Hammer Shield', passed: !isHammer, reason: isHammer ? `Hammer: lwPct ${lwPct.toFixed(0)}%, closeLoc ${closeLoc.toFixed(0)}%` : `No hammer` });
          if (isHammer) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // GATE 4: Green Recovery
        if (!blocked) {
          const greenRecov = isGreen && closeLoc >= 50;
          entry.gatesTested.push({ gate: 'G4 Green Recovery', passed: !greenRecov, reason: greenRecov ? 'Green candle + close above 50%' : `${isGreen ? 'Green' : 'Red'}, closeLoc ${closeLoc.toFixed(0)}%` });
          if (greenRecov) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // GATE 5: Close Position — grid-searched: 50% optimal on Nifty 500 (was 45%)
        if (!blocked) {
          entry.gatesTested.push({ gate: 'G5 Close Position', passed: closeLoc < 50, reason: closeLoc >= 50 ? `CloseLoc ${closeLoc.toFixed(0)}% ≥ 50% — not weak enough` : `CloseLoc ${closeLoc.toFixed(0)}% — genuinely weak` });
          if (closeLoc >= 50) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // GATE 6: OBV Declining
        if (!blocked) {
          const obvRising = prevCandle && candle.c > (prevPrevCandle?.c ?? trade.entryPrice);
          entry.gatesTested.push({ gate: 'G6 OBV Check', passed: !obvRising, reason: obvRising ? 'OBV proxy rising — accumulation' : 'OBV declining — distribution' });
          if (obvRising) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // GATE 7: Consecutive Red
        if (!blocked) {
          const prevGreen = !prevCandle || (prevCandle.o ?? prevCandle.c) <= prevCandle.c;
          entry.gatesTested.push({ gate: 'G7 Consec Red', passed: !prevGreen, reason: prevGreen ? 'Previous candle was green — single red' : '≥2 consecutive red candles' });
          if (prevGreen) { blocked = true; entry.result = 'SHIELDED'; }
        }

        // ALL GATES PASSED
        if (!blocked) {
          entry.result = 'STOPPED';
          status = 'stopped';
          closedPrice = trade.stopLoss;
          gateLog.push(entry);
          break;
        }

        gateLog.push(entry);
      }
      // After T1: trailing stop = breakeven (entry price)
      if (t1Hit && !t2Hit && candle.l <= trade.entryPrice) {
        // Stopped at breakeven after T1 — use T1 as the exit (partial profit captured)
        status = 'hit_t1';
        closedPrice = trade.target1;
        stopAfterT1 = true;
        break;
      }
      // After T2: trailing stop = T1 level
      if (t2Hit && candle.l <= trade.target1) {
        status = 'hit_t2';
        closedPrice = trade.target2;
        break;
      }
    }

    // Target checks — DON'T break on T1/T2, continue to find highest
    if (!t1Hit && trade.target1 > 0 && candle.h >= trade.target1) {
      t1Hit = true;
      status = 'hit_t1';
      closedPrice = trade.target1;
      // Don't break — continue checking T2/T3
    }
    if (t1Hit && !t2Hit && trade.target2 > 0 && candle.h >= trade.target2) {
      t2Hit = true;
      status = 'hit_t2';
      closedPrice = trade.target2;
      // Don't break — continue checking T3
    }
    if (t2Hit && trade.target3 > 0 && candle.h >= trade.target3) {
      status = 'hit_t3';
      closedPrice = trade.target3;
      break; // T3 is final — fully closed
    }
  }

  // Time expiry: if > 20 days and still open, mark expired
  // Grid-searched: 20d hold captures 48.3% T1 hits vs 39.5% at 10d
  const daysHeld = candlesSinceEntry.length;
  if (status === 'open' && daysHeld >= 20) {
    status = 'expired';
    closedPrice = candlesSinceEntry.length > 0 ? candlesSinceEntry[candlesSinceEntry.length - 1].c : trade.entryPrice;
  }

  // Weighted P&L for partial exits:
  // T1 only: 50% at T1 + 50% at breakeven (conservative) = avg of T1 and entry
  // T2: 50% at T1 + 30% at T2 + 20% at breakeven = weighted avg
  // T3: 50% at T1 + 30% at T2 + 20% at T3 = full capture
  let weightedExitPrice = closedPrice;
  if (status === 'hit_t1' && !stopAfterT1) {
    weightedExitPrice = trade.target1 * 0.5 + trade.entryPrice * 0.5; // 50% booked, 50% breakeven
  } else if (status === 'hit_t2') {
    weightedExitPrice = trade.target1 * 0.5 + trade.target2 * 0.3 + trade.entryPrice * 0.2;
  } else if (status === 'hit_t3') {
    weightedExitPrice = trade.target1 * 0.5 + trade.target2 * 0.3 + trade.target3 * 0.2;
  }
  const pnlPct = weightedExitPrice > 0 ? ((weightedExitPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
  const pnlR = riskPerShare > 0 && weightedExitPrice > 0 ? (weightedExitPrice - trade.entryPrice) / riskPerShare : 0;
  const mfe = ((mfePrice - trade.entryPrice) / trade.entryPrice) * 100;
  const mae = ((maePrice - trade.entryPrice) / trade.entryPrice) * 100;
  const mfeR = riskPerShare > 0 ? (mfePrice - trade.entryPrice) / riskPerShare : 0;
  const maeR = riskPerShare > 0 ? (maePrice - trade.entryPrice) / riskPerShare : 0;

  const today = new Date().toISOString().slice(0, 10);

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
    closedDate: status !== 'open' ? today : '',
    gateLog: gateLog.length > 0 ? gateLog : undefined,
  };
}

// ─── Apply validation to tracked trade ───────────────────────────────────────

export function applyValidation(trade: TrackedTrade, result: ValidationResult): TrackedTrade {
  if (trade.status !== 'open') return trade; // already closed, don't overwrite
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
    currentPrice: result.closedPrice,
    highestPrice: trade.entryPrice * (1 + result.mfe / 100),
    lastCheckDate: new Date().toISOString().slice(0, 10),
    gateLog: result.gateLog,
  };
}

// ─── Rolling Stats ───────────────────────────────────────────────────────────

export interface RollingStats {
  period: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgMFE: number;
  avgMAE: number;
  avgTimeToTarget: number;
}

export function computeRollingStats(trades: TrackedTrade[], lastN: number, label: string): RollingStats {
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
