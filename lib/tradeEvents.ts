import { isTerminalTrade, type TrackedTrade } from './tradeOps';

export type TradeLogEventType =
  | 'hit_5pct'
  | 'hit_7pct'
  | 'hit_10pct'
  | 'hit_t1'
  | 'hit_t2'
  | 'hit_t3'
  | 'wick_shield'          // low swept review stop; close recovered above it
  | 'below_stop_rescue'    // close below review stop; confluence gates rescued
  | 'review_exit_pending'  // close confirmed below review stop; exit queued next open
  | 'review_exit'          // next-open execution of the pending review exit (terminal)
  | 'hard_stop'            // hard disaster stop hit intraday — before T1 (terminal)
  | 'trail_stop'           // protective trail / T2 chandelier stop (terminal)
  | 'target_exit'
  | 'expired'
  | 'manual_close'
  | 'closed_early'
  // legacy aliases — kept so consuming code doesn't break; new logic emits the specific types above
  | 'stop_shielded'
  | 'stopped';

export interface TradeLogEvent {
  type: TradeLogEventType;
  detail: string;
  terminal: boolean;
}

export interface TradeEventPriceRow {
  date: string;
  dayNum: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeMilestoneState {
  fivePct: boolean;
  sevenPct: boolean;
  tenPct: boolean;
  t1: boolean;
  t2: boolean;
  t3: boolean;
}

export interface DerivedTradeEventRow {
  events: TradeLogEvent[];
  state: TradeMilestoneState;
  rawStopTouch: boolean;
  stopVerified: boolean;
  stopShielded: boolean;
  stopGate: string | null;
  terminal: boolean;
}

export const TRADE_EVENT_ICONS: Record<TradeLogEventType, string> = {
  hit_5pct: '✅',
  hit_7pct: '✅✅',
  hit_10pct: '✅✅✅',
  hit_t1: '🎯',
  hit_t2: '🎯🎯',
  hit_t3: '🎯🎯🎯',
  wick_shield: '🛡',
  below_stop_rescue: '🔰',
  review_exit_pending: '⏳',
  review_exit: '🔔',
  hard_stop: '🛑',
  trail_stop: '⛓',
  target_exit: '↩',
  expired: '⏰',
  manual_close: '✅',
  closed_early: '✅',
  // legacy
  stop_shielded: '🛡',
  stopped: '🛑',
};

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pctFromEntry(price: number, entry: number): number {
  return entry > 0 ? (price - entry) / entry * 100 : 0;
}

function normalizeDate(value?: string): string | null {
  return value ? value.slice(0, 10) : null;
}

export function getValidTradeTargets(trade: TrackedTrade): {
  t1: number | null;
  t2: number | null;
  t3: number | null;
} {
  const entry = finitePositive(trade.entryPrice);
  if (entry == null) return { t1: null, t2: null, t3: null };

  const rawT1 = finitePositive(trade.target1);
  const t1 = rawT1 != null && rawT1 > entry ? rawT1 : null;
  const rawT2 = finitePositive(trade.target2);
  const t2 = t1 != null && rawT2 != null && rawT2 > t1 ? rawT2 : null;
  const rawT3 = finitePositive(trade.target3);
  const t3 = t2 != null && rawT3 != null && rawT3 > t2 ? rawT3 : null;
  return { t1, t2, t3 };
}

export function deriveTradeEventRows(
  trade: TrackedTrade,
  rows: TradeEventPriceRow[],
): DerivedTradeEventRow[] {
  const entry = finitePositive(trade.entryPrice) ?? 0;
  const stopLoss = finitePositive(trade.stopLoss) ?? 0;
  const fivePctTarget = entry * 1.05;
  const sevenPctTarget = entry * 1.07;
  const tenPctTarget = entry * 1.10;
  const targets = getValidTradeTargets(trade);
  const terminalDate = isTerminalTrade(trade) ? normalizeDate(trade.closedDate) : null;

  const gateByDay = new Map<number, NonNullable<TrackedTrade['gateLog']>[number]>();
  const gateByDate = new Map<string, NonNullable<TrackedTrade['gateLog']>[number]>();
  for (const gate of trade.gateLog ?? []) {
    gateByDay.set(gate.day, gate);
    const gateDate = normalizeDate(gate.date);
    if (gateDate) gateByDate.set(gateDate, gate);
  }

  let seenFivePct = false;
  let seenSevenPct = false;
  let seenTenPct = false;
  let seenT1 = false;
  let seenT2 = false;
  let seenT3 = false;
  let terminalReached = false;

  return rows.map((row) => {
    const date = normalizeDate(row.date) ?? row.date;
    const gate = gateByDate.get(date)
      ?? gateByDay.get(row.dayNum - 1)
      ?? gateByDay.get(row.dayNum);
    const effectiveStop = finitePositive(gate?.stopLevel) ?? stopLoss;
    const rawStopTouch = effectiveStop > 0 && row.low <= effectiveStop;
    const isTerminalDate = terminalDate != null && date === terminalDate;
    const stopVerified = !terminalReached && trade.status === 'stopped' && (
      isTerminalDate || gate?.result === 'STOPPED'
    );
    const stopShielded = !terminalReached && !stopVerified && gate?.result === 'SHIELDED';
    const reviewExitPending = !terminalReached && gate?.result === 'EXIT_PENDING';
    const events: TradeLogEvent[] = [];

    // Daily OHLC cannot resolve whether the high or low occurred first. The
    // validator uses conservative stop-first treatment for a verified stop.
    if (stopVerified) {
      const stopPrice = finitePositive(trade.closedPrice) ?? effectiveStop;
      const gateName = gate?.gatesTested?.[0]?.gate ?? '';
      // review_open = next-session open fill after a pending review exit
      // 'Protective Trail' gate name = hard runner trail after T1/T2
      // everything else = hard disaster stop
      const isReviewExit = gate?.triggerType === 'review_open';
      const isTrailStop = !isReviewExit && gateName.includes('Protective Trail');
      const eventType: TradeLogEventType = isReviewExit ? 'review_exit'
        : isTrailStop ? 'trail_stop'
        : 'hard_stop';
      const label = isReviewExit ? 'Review exit' : isTrailStop ? 'Trail stop' : 'Hard stop';
      events.push({
        type: eventType,
        detail: `${label} ₹${stopPrice.toFixed(2)} (${pctFromEntry(stopPrice, entry).toFixed(1)}%)`,
        terminal: true,
      });
      terminalReached = true;
    } else if (!terminalReached) {
      const crossed: Array<{ type: TradeLogEventType; price: number; detail: string }> = [];
      const high = finitePositive(row.high) ?? 0;
      const close = finitePositive(row.close) ?? 0;

      if (!seenFivePct && fivePctTarget > 0 && high >= fivePctTarget) {
        const source = close >= fivePctTarget
          ? `CMP +${pctFromEntry(close, entry).toFixed(1)}%`
          : `High +${pctFromEntry(high, entry).toFixed(1)}%`;
        crossed.push({
          type: 'hit_5pct',
          price: fivePctTarget,
          detail: `+5% ₹${fivePctTarget.toFixed(2)} crossed (${source})`,
        });
        seenFivePct = true;
      }
      if (!seenSevenPct && sevenPctTarget > 0 && high >= sevenPctTarget) {
        const source = close >= sevenPctTarget
          ? `CMP +${pctFromEntry(close, entry).toFixed(1)}%`
          : `High +${pctFromEntry(high, entry).toFixed(1)}%`;
        crossed.push({
          type: 'hit_7pct',
          price: sevenPctTarget,
          detail: `+7% ₹${sevenPctTarget.toFixed(2)} crossed (${source})`,
        });
        seenSevenPct = true;
      }
      if (!seenTenPct && tenPctTarget > 0 && high >= tenPctTarget) {
        const source = close >= tenPctTarget
          ? `CMP +${pctFromEntry(close, entry).toFixed(1)}%`
          : `High +${pctFromEntry(high, entry).toFixed(1)}%`;
        crossed.push({
          type: 'hit_10pct',
          price: tenPctTarget,
          detail: `+10% ₹${tenPctTarget.toFixed(2)} crossed (${source})`,
        });
        seenTenPct = true;
      }
      if (!seenT1 && targets.t1 != null && high >= targets.t1) {
        crossed.push({ type: 'hit_t1', price: targets.t1, detail: `T1 ₹${targets.t1.toFixed(2)} cleared` });
        seenT1 = true;
      }
      if (!seenT2 && targets.t2 != null && high >= targets.t2) {
        crossed.push({ type: 'hit_t2', price: targets.t2, detail: `T2 ₹${targets.t2.toFixed(2)} cleared` });
        seenT2 = true;
      }
      if (!seenT3 && targets.t3 != null && high >= targets.t3) {
        const fullyClosed = trade.status === 'hit_t3';
        crossed.push({
          type: 'hit_t3',
          price: targets.t3,
          detail: `T3 ₹${targets.t3.toFixed(2)} cleared${fullyClosed ? ' · fully closed' : ' · status pending validation'}`,
        });
        seenT3 = true;
      }

      crossed
        .sort((a, b) => a.price - b.price)
        .forEach((event) => {
          const isTerminalT3 = event.type === 'hit_t3' && trade.status === 'hit_t3';
          events.push({ type: event.type, detail: event.detail, terminal: isTerminalT3 });
          if (isTerminalT3) terminalReached = true;
        });

      if (stopShielded) {
        const isWickShield = close >= effectiveStop;
        const supportingGates = gate?.gatesTested?.filter(g => g.passed).map(g => g.gate) ?? [];
        const blockedBy = supportingGates.length > 0
          ? supportingGates.join(' + ')
          : isWickShield
            ? 'close recovered above review stop'
            : 'confluence shield';
        events.push({
          type: isWickShield ? 'wick_shield' : 'below_stop_rescue',
          detail: isWickShield
            ? `Wick Shield — low swept stop, close recovered (${blockedBy})`
            : `Below-Stop Rescue — close below stop, gates saved (${blockedBy})`,
          terminal: false,
        });
      }

      if (reviewExitPending) {
        events.push({
          type: 'review_exit_pending',
          detail: `Review stop confirmed at close; exit queued for next session open`,
          terminal: false,
        });
      }

      if (!terminalReached && isTerminalDate) {
        if (trade.status === 'expired') {
          events.push({
            type: 'expired',
            detail: `Day ${row.dayNum} expired at ₹${row.close.toFixed(2)}`,
            terminal: true,
          });
          terminalReached = true;
        } else if (trade.status === 'manual_close' || trade.status === 'closed_early') {
          const closePrice = finitePositive(trade.closedPrice) ?? row.close;
          events.push({
            type: trade.status,
            detail: `${trade.status === 'manual_close' ? 'Manual close' : 'Closed early'} at ₹${closePrice.toFixed(2)} (${pctFromEntry(closePrice, entry).toFixed(1)}%)`,
            terminal: true,
          });
          terminalReached = true;
        } else if (trade.status === 'hit_t1' || trade.status === 'hit_t2') {
          const closePrice = finitePositive(trade.closedPrice) ?? row.close;
          const completedAt = trade.status === 'hit_t1' ? 'T1' : 'T2';
          const remainingSize = trade.status === 'hit_t1' ? '50%' : '20%';
          const exitReason = gate?.result === 'STOPPED' && (gate.gatesTested?.[0]?.gate ?? '').includes('Protective Trail')
            ? 'hard protective trail'
            : `exit after ${completedAt}`;
          events.push({
            type: 'target_exit',
            detail: `Final ${remainingSize} ${exitReason} at ₹${closePrice.toFixed(2)} (${pctFromEntry(closePrice, entry).toFixed(1)}% vs entry)`,
            terminal: true,
          });
          terminalReached = true;
        } else if (trade.status === 'hit_t3' && !events.some(e => e.type === 'hit_t3')) {
          const closePrice = finitePositive(trade.closedPrice) ?? targets.t3 ?? row.high;
          events.push({
            type: 'hit_t3',
            detail: `T3 completion recorded at ₹${closePrice.toFixed(2)} · target history incomplete`,
            terminal: true,
          });
          terminalReached = true;
        }
      }
    }

    return {
      events,
      state: { fivePct: seenFivePct, sevenPct: seenSevenPct, tenPct: seenTenPct, t1: seenT1, t2: seenT2, t3: seenT3 },
      rawStopTouch,
      stopVerified,
      stopShielded,
      stopGate: gate?.result ?? null,
      terminal: terminalReached,
    };
  });
}

export function primaryTradeEventType(events: TradeLogEvent[]): TradeLogEventType | null {
  const terminal = events.find(event => event.terminal);
  if (terminal) return terminal.type;
  const priority: TradeLogEventType[] = [
    'hit_t3',
    'hit_t2',
    'hit_t1',
    'hit_10pct',
    'hit_7pct',
    'hit_5pct',
    'review_exit',
    'hard_stop',
    'trail_stop',
    'wick_shield',
    'below_stop_rescue',
    'review_exit_pending',
    'target_exit',
    'expired',
    'manual_close',
    'closed_early',
    // legacy fallbacks
    'stop_shielded',
    'stopped',
  ];
  return priority.find(type => events.some(event => event.type === type)) ?? null;
}

export function summarizeTradeEvents(events: TradeLogEvent[]): string | null {
  return events.length > 0 ? events.map(event => event.detail).join(' · ') : null;
}
