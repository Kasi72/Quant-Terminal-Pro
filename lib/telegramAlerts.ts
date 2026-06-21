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
  };
}

export const DEFAULT_TG_CONFIG: TelegramConfig = {
  botToken: '', chatId: '', enabled: false,
  alerts: { newSignal: true, targetHit: true, stopped: true, regimeChange: true, dailySummary: true, signalDecay: false },
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
  const sym = esc(r.symbol.replace('.NS', '').replace('.BO', ''));
  const stageLabel = r.stage.replace(/_/g, ' ');
  const pe = r.priceEngine;
  const rps = pe.plannedEntry - pe.tacticalStop;
  const t1R = rps > 0 ? ((pe.target5 - pe.plannedEntry) / rps).toFixed(1) : '—';

  let msg = `🟢 <b>NEW BUY SIGNAL</b>\n\n`;
  msg += `<b>${sym}</b> — ${stageLabel}\n`;
  msg += `Entry: ₹${pe.plannedEntry.toFixed(2)} | SL: ₹${pe.tacticalStop.toFixed(2)}\n`;
  msg += `T1: ₹${pe.target5.toFixed(2)} (${t1R}R) | R:R: ${pe.rewardRisk.toFixed(2)}\n`;

  const verdict = pe.rewardRisk >= 3.5 ? 'Elite' : pe.rewardRisk >= 2.5 ? 'Very Good' : pe.rewardRisk >= 2.0 ? 'Good' : pe.rewardRisk >= 1.5 ? 'Acceptable' : 'Weak';
  msg += `Verdict: ${verdict}`;
  if (extras?.conviction) msg += ` | Conv: ${extras.conviction}`;
  msg += '\n';

  if (extras?.onset) msg += `★ ${extras.onset}\n`;
  if (extras?.rsRank) msg += `RS Rank: ${extras.rsRank}`;
  if (extras?.tfAlign) msg += ` | TF: ${extras.tfAlign}`;
  if (extras?.rsRank || extras?.tfAlign) msg += '\n';

  if (extras?.pivotPosition) {
    msg += `\nPivot: ${extras.pivotPosition}\n`;
    if (extras.pivotR1) msg += `R1: ₹${extras.pivotR1.toFixed(0)} `;
    if (extras.pivotS1) msg += `S1: ₹${extras.pivotS1.toFixed(0)}`;
    msg += '\n';
  }
  if (extras?.pivotWarning) msg += `\n⚠ ${extras.pivotWarning}\n`;

  return msg;
}

// ─── Alert #2: Target Hit ───────────────────────────────────────────────────

export function formatTargetHitAlert(t: TrackedTrade): string {
  const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
  const target = t.status === 'hit_t1' ? 'T1' : t.status === 'hit_t2' ? 'T2' : 'T3';
  let msg = `✅ <b>TARGET HIT — ${sym}</b>\n\n`;
  msg += `${target} hit at ₹${(t.closedPrice ?? 0).toFixed(2)}\n`;
  msg += `Entry: ₹${t.entryPrice.toFixed(2)} | P&L: ${(t.pnlPct ?? 0) >= 0 ? '+' : ''}${(t.pnlPct ?? 0).toFixed(2)}%\n`;
  msg += `R-Multiple: ${(t.pnlR ?? 0) >= 0 ? '+' : ''}${(t.pnlR ?? 0).toFixed(2)}R | Days: ${t.daysHeld ?? '—'}\n`;
  const mfePct = t.highestPrice && t.entryPrice > 0 ? ((t.highestPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1) : '—';
  msg += `MFE: +${mfePct}%\n`;
  return msg;
}

// ─── Alert #3: Stopped Out ──────────────────────────────────────────────────

export function formatStoppedAlert(t: TrackedTrade): string {
  const sym = esc(t.symbol.replace('.NS', '').replace('.BO', ''));
  let msg = `🔴 <b>STOPPED — ${sym}</b>\n\n`;
  msg += `Stop hit at ₹${(t.closedPrice ?? t.stopLoss).toFixed(2)}\n`;
  msg += `Entry: ₹${t.entryPrice.toFixed(2)} | P&L: ${(t.pnlPct ?? 0).toFixed(2)}%\n`;
  msg += `R-Multiple: ${(t.pnlR ?? 0).toFixed(2)}R | Days: ${t.daysHeld ?? '—'}\n`;
  return msg;
}

// ─── Alert #4: Market Regime Change ─────────────────────────────────────────

export function formatRegimeChangeAlert(
  prevRegime: string, newRegime: string,
  niftyClose: number, ema50: number, ema200: number, sizingMult: number
): string {
  const emoji = newRegime === 'bull' ? '🟢' : newRegime === 'bear' ? '🔴' : '🟡';
  const label = newRegime === 'bull' ? 'Bull Market' : newRegime === 'bear' ? 'Bear Market' : 'Neutral';
  const prevLabel = prevRegime === 'bull' ? 'Bull' : prevRegime === 'bear' ? 'Bear' : 'Neutral';
  let msg = `⚠ <b>MARKET REGIME CHANGE</b>\n\n`;
  msg += `${prevLabel} → ${emoji} ${label}\n`;
  msg += `Nifty: ₹${niftyClose.toFixed(0)} | EMA50: ₹${ema50.toFixed(0)} | EMA200: ₹${ema200.toFixed(0)}\n`;
  msg += `Position sizing: ×${sizingMult}\n`;
  if (newRegime === 'bear') msg += `\n🛑 No new trades recommended`;
  return msg;
}

// ─── Alert #5: Daily Summary ────────────────────────────────────────────────

export function formatDailySummaryAlert(
  date: string, totalScanned: number, actionable: number,
  newSignals: string[], droppedSignals: string[],
  openTrades: number, winRate: number, cumulativeR: number,
  bestSignal?: { symbol: string; conviction: number; rr: number }
): string {
  let msg = `📊 <b>DAILY SCAN SUMMARY — ${date}</b>\n\n`;
  msg += `Scanned: ${totalScanned} stocks\n`;
  msg += `Actionable: ${actionable}`;
  if (newSignals.length > 0) msg += `\nNew: ${newSignals.map(s => esc(s.replace('.NS', ''))).join(', ')}`;
  if (droppedSignals.length > 0) msg += `\nDropped: ${droppedSignals.map(s => esc(s.replace('.NS', ''))).join(', ')}`;
  msg += `\n\nPortfolio: ${openTrades} open | WR: ${winRate.toFixed(0)}% | ${cumulativeR >= 0 ? '+' : ''}${cumulativeR.toFixed(1)}R cumulative`;
  if (bestSignal) {
    msg += `\nBest: <b>${esc(bestSignal.symbol.replace('.NS', ''))}</b> (Conv ${bestSignal.conviction}, R:R ${bestSignal.rr.toFixed(1)})`;
  }
  return msg;
}

// ─── Alert #6: Signal Decay Warning ─────────────────────────────────────────

export function formatSignalDecayAlert(symbol: string, ageDays: number, decayedConv: number, extended: boolean): string {
  const sym = esc(symbol.replace('.NS', '').replace('.BO', ''));
  let msg = `⏳ <b>SIGNAL AGING — ${sym}</b>\n\n`;
  msg += `Signal is ${ageDays} days old (conviction decayed to ${decayedConv})\n`;
  if (extended) msg += `Stock has moved >1 ATR above entry — extended\n`;
  msg += `\nConsider: skip entry or wait for pullback`;
  return msg;
}
