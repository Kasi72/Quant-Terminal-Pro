import type { AnalysisResult } from './stockEngine';
import type { TrackedTrade } from './tradingUtils';

// ─── Telegram Config ────────────────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  alerts: {
    newSignal: boolean;
    targetHit: boolean;
    stopped: boolean;
    regimeChange: boolean;
    dailySummary: boolean;
    signalDecay: boolean;
    validationSummary: boolean;
  };
}

export const DEFAULT_TG_CONFIG: TelegramConfig = {
  botToken: '', chatId: '', enabled: false,
  alerts: { newSignal: true, targetHit: true, stopped: true, regimeChange: true, dailySummary: true, signalDecay: false, validationSummary: true },
};

export function loadTelegramConfig(): TelegramConfig {
  try {
    const raw = localStorage.getItem('qtp_telegram');
    return raw ? { ...DEFAULT_TG_CONFIG, ...JSON.parse(raw) } : DEFAULT_TG_CONFIG;
  } catch { return DEFAULT_TG_CONFIG; }
}

export function saveTelegramConfig(cfg: TelegramConfig) {
  try { localStorage.setItem('qtp_telegram', JSON.stringify(cfg)); } catch {}
}

// ─── Send Message ───────────────────────────────────────────────────────────

export async function sendTelegramMessage(cfg: TelegramConfig, message: string): Promise<boolean> {
  if (!cfg.enabled || !cfg.botToken || !cfg.chatId) return false;
  try {
    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cfg.botToken, chatId: cfg.chatId, message }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch { return false; }
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ─── Alert #1: New BUY Signal ───────────────────────────────────────────────

export function formatNewSignalAlert(r: AnalysisResult, extras?: {
  conviction?: number; rsRank?: number; tfAlign?: string; onset?: string;
  pivotPosition?: string; pivotR1?: number; pivotS1?: number; pivotWarning?: string;
}): string {
  try {
    const sym = esc(r.symbol.replace('.NS', '').replace('.BO', ''));
    const stageLabel = r.stage.replace(/_/g, ' ');
    const pe = r.priceEngine;
    const rps = pe.plannedEntry - pe.tacticalStop;
    const t1RVal = rps > 0 ? (pe.target5 - pe.plannedEntry) / rps : NaN;
    const t1R = Number.isFinite(t1RVal) ? t1RVal.toFixed(1) : '—';
    const t2RVal = rps > 0 ? (pe.target7 - pe.plannedEntry) / rps : NaN;
    const t3RVal = rps > 0 ? (pe.target10 - pe.plannedEntry) / rps : NaN;
    const riskPct = pe.plannedEntry > 0 ? ((pe.plannedEntry - pe.tacticalStop) / pe.plannedEntry * 100) : 0;
    const t1Pct = pe.plannedEntry > 0 ? ((pe.target5 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;
    const t2Pct = pe.plannedEntry > 0 ? ((pe.target7 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;
    const t3Pct = pe.plannedEntry > 0 ? ((pe.target10 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;

    // Verdict v2 — R:R vs outcome is U-shaped (re-derived on 2,914 trades, 456 stocks):
    // Elite=RR>=1.5 (67.6% WR, +3.27% avg), Good=RR 0.6-0.8 or 1.0-1.5,
    // Weak=RR 0.8-1.0 (validated dead zone), Fair=RR<0.6 (sparse data)
    const rr = pe.rewardRisk;
    const verdict = rr <= 0 ? '—' : rr >= 1.5 ? 'Elite' : ((rr >= 0.6 && rr < 0.8) || (rr >= 1.0 && rr < 1.5)) ? 'Good' : (rr >= 0.8 && rr < 1.0) ? 'Weak' : 'Fair';

    let msg = `🟢 <b>NEW BUY SIGNAL</b>\n\n`;
    msg += `<b>${sym}</b> — ${stageLabel}\n`;
    msg += `Conv: ${extras?.conviction ?? '—'} | Verdict: ${verdict}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Trade Sheet
    msg += `<b>📋 TRADE SHEET</b>\n`;
    msg += `CMP:   Rs.${r.lastClose.toFixed(2)}\n`;
    msg += `Entry: Rs.${Number.isFinite(pe.plannedEntry) ? pe.plannedEntry.toFixed(2) : '—'}`;
    if (pe.gapPct > 1) msg += ` (gap ${pe.gapPct.toFixed(1)}% — ${pe.entryStatus})`;
    msg += `\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Stop Loss
    msg += `<b>🛑 STOP LOSS</b>\n`;
    msg += `SL:    Rs.${Number.isFinite(pe.tacticalStop) ? pe.tacticalStop.toFixed(2) : '—'} (-${riskPct.toFixed(1)}%)\n`;
    msg += `Risk:  Rs.${rps > 0 ? rps.toFixed(2) : '—'}/share\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Targets
    msg += `<b>🎯 TARGETS (partial exit)</b>\n`;
    msg += `T1 (sell 50%): Rs.${Number.isFinite(pe.target5) ? pe.target5.toFixed(2) : '—'} (+${t1Pct.toFixed(1)}% · ${t1R}R)\n`;
    msg += `T2 (sell 30%): Rs.${Number.isFinite(pe.target7) ? pe.target7.toFixed(2) : '—'} (+${t2Pct.toFixed(1)}% · ${Number.isFinite(t2RVal) ? t2RVal.toFixed(1) : '—'}R)\n`;
    msg += `T3 (sell 20%): Rs.${Number.isFinite(pe.target10) ? pe.target10.toFixed(2) : '—'} (+${t3Pct.toFixed(1)}% · ${Number.isFinite(t3RVal) ? t3RVal.toFixed(1) : '—'}R)\n`;
    msg += `R:R: ${Number.isFinite(pe.rewardRisk) ? pe.rewardRisk.toFixed(2) : '—'}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Position sizing (for Rs.10L account, 1% risk)
    const accountSize = 1000000;
    const riskAmount = accountSize * 0.01;
    const shares = rps > 0 ? Math.floor(riskAmount / rps) : 0;
    const capital = shares * pe.plannedEntry;
    msg += `<b>💰 POSITION SIZE (1% risk on 10L)</b>\n`;
    msg += `Shares: ${shares} | Capital: Rs.${Math.round(capital).toLocaleString()}\n`;
    msg += `Max loss: Rs.${Math.round(riskAmount)} (1% of capital)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Signal quality
    msg += `<b>📊 SIGNAL QUALITY</b>\n`;
    if (extras?.onset) msg += `Candle: ★ ${esc(extras.onset)}\n`;
    if (extras?.rsRank) msg += `RS Rank: ${extras.rsRank}/100\n`;
    if (extras?.tfAlign) msg += `Timeframe: ${extras.tfAlign === 'DW' ? 'Daily+Weekly aligned' : extras.tfAlign === 'D' ? 'Daily only' : esc(extras.tfAlign)}\n`;
    msg += `ATR%: ${Number.isFinite(r.atrPct14) ? r.atrPct14.toFixed(2) : '0.00'}% | Vol: ${Number.isFinite(r.volRatio20) ? r.volRatio20.toFixed(1) : '0.0'}x\n`;

    if (extras?.pivotPosition) {
      msg += `Pivot: ${esc(extras.pivotPosition)}`;
      if (extras.pivotR1 && Number.isFinite(extras.pivotR1)) msg += ` | R1: Rs.${extras.pivotR1.toFixed(0)}`;
      if (extras.pivotS1 && Number.isFinite(extras.pivotS1)) msg += ` | S1: Rs.${extras.pivotS1.toFixed(0)}`;
      msg += '\n';
    }
    if (extras?.pivotWarning) msg += `⚠ ${esc(extras.pivotWarning)}\n`;

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>📝 ACTION PLAN</b>\n`;
    msg += `1. BUY ${shares} shares at Rs.${Number.isFinite(pe.plannedEntry) ? pe.plannedEntry.toFixed(2) : '—'}\n`;
    msg += `2. Set SL-M at Rs.${Number.isFinite(pe.tacticalStop) ? pe.tacticalStop.toFixed(2) : '—'}\n`;
    msg += `3. At T1 → sell ${Math.round(shares*0.5)} (50%), move SL to entry\n`;
    msg += `4. At T2 → sell ${Math.round(shares*0.3)} (30%), trail SL to T1\n`;
    msg += `5. At T3 → sell remaining ${Math.round(shares*0.2)} (20%)\n`;

    return msg;
  } catch {
    return `🟢 <b>NEW BUY SIGNAL</b>\n\n${esc(r?.symbol ?? 'UNKNOWN')} — formatting error\n`;
  }
}

// ─── Alert #2: Target Hit ───────────────────────────────────────────────────

export function formatTargetHitAlert(t: TrackedTrade): string {
  try {
    const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
    const target = t.status === 'hit_t1' ? 'T1' : t.status === 'hit_t2' ? 'T2' : 'T3';
    const closedPrice = t.closedPrice ?? 0;
    const pnlPct = t.pnlPct ?? 0;
    const pnlR = t.pnlR ?? 0;
    let msg = `✅ <b>TARGET HIT — ${sym}</b>\n\n`;
    msg += `${target} hit at ₹${Number.isFinite(closedPrice) ? closedPrice.toFixed(2) : '—'}\n`;
    msg += `Entry: ₹${Number.isFinite(t.entryPrice) ? t.entryPrice.toFixed(2) : '—'} | P&L: ${pnlPct >= 0 ? '+' : ''}${Number.isFinite(pnlPct) ? pnlPct.toFixed(2) : '0.00'}%\n`;
    msg += `R-Multiple: ${pnlR >= 0 ? '+' : ''}${Number.isFinite(pnlR) ? pnlR.toFixed(2) : '0.00'}R | Days: ${t.daysHeld ?? '—'}\n`;
    const mfeRaw = t.highestPrice && t.entryPrice > 0 ? ((t.highestPrice - t.entryPrice) / t.entryPrice * 100) : NaN;
    const mfePct = Number.isFinite(mfeRaw) ? mfeRaw.toFixed(1) : '—';
    msg += `MFE: +${mfePct}%\n`;
    return msg;
  } catch {
    return `✅ <b>TARGET HIT — ${esc(t?.symbol ?? 'UNKNOWN')}</b>\n\nFormatting error\n`;
  }
}

// ─── Alert #3: Stopped Out ──────────────────────────────────────────────────

export function formatStoppedAlert(t: TrackedTrade): string {
  try {
    const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
    const stopPrice = t.closedPrice ?? t.stopLoss;
    const pnlPct = t.pnlPct ?? 0;
    const pnlR = t.pnlR ?? 0;
    let msg = `🔴 <b>STOPPED — ${sym}</b>\n\n`;
    msg += `Stop hit at ₹${Number.isFinite(stopPrice) ? stopPrice.toFixed(2) : '—'}\n`;
    msg += `Entry: ₹${Number.isFinite(t.entryPrice) ? t.entryPrice.toFixed(2) : '—'} | P&L: ${Number.isFinite(pnlPct) ? pnlPct.toFixed(2) : '0.00'}%\n`;
    msg += `R-Multiple: ${Number.isFinite(pnlR) ? pnlR.toFixed(2) : '0.00'}R | Days: ${t.daysHeld ?? '—'}\n`;
    return msg;
  } catch {
    return `🔴 <b>STOPPED — ${esc(t?.symbol ?? 'UNKNOWN')}</b>\n\nFormatting error\n`;
  }
}

// ─── Alert #4: Market Regime Change ─────────────────────────────────────────

export function formatRegimeChangeAlert(
  prevRegime: string, newRegime: string,
  niftyClose: number, ema50: number, ema200: number, sizingMult: number
): string {
  try {
    const emoji = newRegime.includes('bull') ? '🟢' : newRegime.includes('bear') ? '🔴' : '🟡';
    const labels: Record<string, string> = { strong_bull: 'Strong Bull', bull: 'Bull Market', neutral: 'Neutral', bear: 'Bear Market', strong_bear: 'Strong Bear' };
    const label = labels[newRegime] || newRegime;
    const prevLabel = labels[prevRegime] || prevRegime;
    let msg = `⚠ <b>MARKET REGIME CHANGE</b>\n\n`;
    msg += `${prevLabel} → ${emoji} ${label}\n`;
    msg += `Nifty: ₹${Number.isFinite(niftyClose) ? niftyClose.toFixed(0) : '—'} | EMA50: ₹${Number.isFinite(ema50) ? ema50.toFixed(0) : '—'} | EMA200: ₹${Number.isFinite(ema200) ? ema200.toFixed(0) : '—'}\n`;
    msg += `Position sizing: ×${Number.isFinite(sizingMult) ? sizingMult : '—'}\n`;
    if (newRegime.includes('bear')) msg += `\n🛑 Reduce exposure — ${newRegime === 'strong_bear' ? 'STOP trading' : 'quarter size only'}`;
    return msg;
  } catch {
    return `⚠ <b>MARKET REGIME CHANGE</b>\n\nFormatting error\n`;
  }
}

// ─── Alert #5: Daily Summary ────────────────────────────────────────────────

export function formatDailySummaryAlert(
  date: string, totalScanned: number, actionable: number,
  newSignals: string[], droppedSignals: string[],
  openTrades: number, winRate: number, cumulativeR: number,
  bestSignal?: { symbol: string; conviction: number; rr: number }
): string {
  try {
    let msg = `📊 <b>DAILY SCAN SUMMARY — ${date}</b>\n\n`;
    msg += `Scanned: ${totalScanned} stocks\n`;
    msg += `Actionable: ${actionable}`;
    if (newSignals.length > 0) msg += `\nNew: ${newSignals.map(s => esc(s.replace('.NS', ''))).join(', ')}`;
    if (droppedSignals.length > 0) msg += `\nDropped: ${droppedSignals.map(s => esc(s.replace('.NS', ''))).join(', ')}`;
    msg += `\n\nPortfolio: ${openTrades} open | WR: ${Number.isFinite(winRate) ? winRate.toFixed(0) : '—'}% | ${cumulativeR >= 0 ? '+' : ''}${Number.isFinite(cumulativeR) ? cumulativeR.toFixed(1) : '0.0'}R cumulative`;
    if (bestSignal) {
      msg += `\nBest: <b>${esc(bestSignal.symbol.replace('.NS', ''))}</b> (Conv ${bestSignal.conviction}, R:R ${Number.isFinite(bestSignal.rr) ? bestSignal.rr.toFixed(1) : '—'})`;
    }
    return msg;
  } catch {
    return `📊 <b>DAILY SCAN SUMMARY — ${date ?? 'unknown'}</b>\n\nFormatting error\n`;
  }
}

// ─── Alert #6: Signal Decay Warning ─────────────────────────────────────────

export function formatValidationSummaryAlert(trades: TrackedTrade[]): string {
  try {
    const open = trades.filter(t => t.status === 'open');
    const closed = trades.filter(t => t.status !== 'open');
    if (open.length === 0 && closed.length === 0) return '';

    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    let msg = `📊 <b>VALIDATION SCAN — ${now}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (open.length > 0) {
      msg += `<b>OPEN TRADES (${open.length})</b>\n`;
      let totalPnl = 0;
      for (const t of open) {
        const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
        const cmp = t.currentPrice ?? t.entryPrice;
        const pnl = ((cmp - t.entryPrice) / t.entryPrice * 100);
        totalPnl += pnl;
        const pnlStr = pnl >= 0 ? `+${pnl.toFixed(1)}%` : `${pnl.toFixed(1)}%`;
        const emoji = pnl >= 3 ? '🟢' : pnl >= 0 ? '🔵' : pnl >= -3 ? '🟡' : '🔴';
        const days = t.daysHeld ?? 0;
        const gLog = t.gateLog;
        const shields = gLog ? gLog.filter(e => e.result === 'SHIELDED').length : 0;
        const shieldStr = shields > 0 ? ` 🛡${shields}` : '';
        msg += `${emoji} <b>${sym}</b> ₹${cmp.toFixed(0)} ${pnlStr} D${days}${shieldStr}\n`;
      }
      const avgPnl = totalPnl / open.length;
      msg += `\n📈 Portfolio: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}% avg\n`;
    }

    // Recently closed (last 24h)
    const recentClosed = closed.filter(t => {
      if (!t.closedDate) return false;
      const cd = new Date(t.closedDate);
      return Date.now() - cd.getTime() < 86400000;
    });
    if (recentClosed.length > 0) {
      msg += `\n<b>RECENTLY CLOSED (${recentClosed.length})</b>\n`;
      for (const t of recentClosed) {
        const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
        const pnl = t.pnlPct ?? 0;
        const emoji = t.status === 'stopped' ? '🛑' : t.status === 'expired' ? '⏰' : '✅';
        msg += `${emoji} ${sym} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% (${t.status.replace('hit_', 'T').toUpperCase()})\n`;
      }
    }

    msg += `\n<i>Dr KKR Quant Terminal Pro v9.0</i>`;
    return msg;
  } catch {
    return '📊 <b>VALIDATION SCAN</b>\n\nFormatting error';
  }
}

export function formatSignalDecayAlert(symbol: string, ageDays: number, decayedConv: number, extended: boolean): string {
  try {
    const sym = esc(symbol.replace('.NS', '').replace('.BO', ''));
    let msg = `⏳ <b>SIGNAL AGING — ${sym}</b>\n\n`;
    msg += `Signal is ${ageDays} days old (conviction decayed to ${decayedConv})\n`;
    if (extended) msg += `Stock has moved >1 ATR above entry — extended\n`;
    msg += `\nConsider: skip entry or wait for pullback`;
    return msg;
  } catch {
    return `⏳ <b>SIGNAL AGING — ${esc(symbol ?? 'UNKNOWN')}</b>\n\nFormatting error\n`;
  }
}
