import type { AnalysisResult, StageRating } from './stockEngine';

// ─── #2: Watchlist with Notes ────────────────────────────────────────────────

export interface WatchlistItem {
  symbol: string;
  note: string;
  addedDate: string;
  stage: StageRating;
  lastClose: number;
}

export function loadWatchlist(): WatchlistItem[] {
  try { return JSON.parse(localStorage.getItem('qtp_watchlist') ?? '[]'); } catch { return []; }
}

export function saveWatchlist(items: WatchlistItem[]) {
  try { localStorage.setItem('qtp_watchlist', JSON.stringify(items)); } catch {}
}

// ─── #3: Signal Age ──────────────────────────────────────────────────────────

export interface SignalHistory {
  [symbol: string]: { stage: StageRating; date: string }[];
}

export function loadSignalHistory(): SignalHistory {
  try { return JSON.parse(localStorage.getItem('qtp_signal_history') ?? '{}'); } catch { return {}; }
}

export function saveSignalHistory(h: SignalHistory) {
  try { localStorage.setItem('qtp_signal_history', JSON.stringify(h)); } catch {}
}

export function updateSignalHistory(results: AnalysisResult[], history: SignalHistory): SignalHistory {
  const today = new Date().toISOString().slice(0, 10);
  const updated = { ...history };
  for (const r of results) {
    if (!updated[r.symbol]) updated[r.symbol] = [];
    const entries = updated[r.symbol];
    if (entries.length === 0 || entries[entries.length - 1].date !== today) {
      entries.push({ stage: r.stage, date: today });
      if (entries.length > 10) entries.splice(0, entries.length - 10);
    } else {
      entries[entries.length - 1].stage = r.stage;
    }
  }
  return updated;
}

export function getSignalAge(symbol: string, currentStage: StageRating, history: SignalHistory): number {
  const entries = history[symbol];
  if (!entries || entries.length === 0) return 0;
  const actionable = ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'];
  if (!actionable.includes(currentStage)) return 0;
  let age = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (actionable.includes(entries[i].stage)) age++;
    else break;
  }
  return age;
}

// ─── #5: Zerodha Basket Export ───────────────────────────────────────────────

export function exportZerodhaBasket(results: AnalysisResult[], accountSize: number): string {
  const lines = ['Tradingsymbol,Exchange,Transaction type,Order type,Quantity,Price,Trigger price'];
  for (const r of results) {
    if (!r.priceEngine.tradeValid) continue;
    const entry = r.priceEngine.plannedEntry;
    const sl = r.priceEngine.tacticalStop;
    const risk = entry - sl;
    if (risk <= 0) continue;
    const qty = Math.floor((accountSize * 0.01) / risk);
    if (qty <= 0) continue;
    const exchange = r.symbol.endsWith('.BO') ? 'BSE' : 'NSE';
    const sym = r.symbol.replace('.NS', '').replace('.BO', '');
    lines.push(`${sym},${exchange},BUY,LIMIT,${qty},${entry.toFixed(2)},0`);
  }
  return lines.join('\n');
}

export function exportAngelOneBasket(results: AnalysisResult[], accountSize: number): string {
  const lines = ['Symbol,Exchange,Action,OrderType,Qty,Price'];
  for (const r of results) {
    if (!r.priceEngine.tradeValid) continue;
    const entry = r.priceEngine.plannedEntry;
    const sl = r.priceEngine.tacticalStop;
    const risk = entry - sl;
    if (risk <= 0) continue;
    const qty = Math.floor((accountSize * 0.01) / risk);
    if (qty <= 0) continue;
    const sym = r.symbol.replace('.NS', '').replace('.BO', '');
    lines.push(`${sym},NSE,BUY,LIMIT,${qty},${entry.toFixed(2)}`);
  }
  return lines.join('\n');
}

// ─── #6: Sector Rotation Timeline ────────────────────────────────────────────

export interface SectorTimeline {
  [sector: string]: { date: string; buyCount: number; preCount: number }[];
}

export function loadSectorTimeline(): SectorTimeline {
  try { return JSON.parse(localStorage.getItem('qtp_sector_timeline') ?? '{}'); } catch { return {}; }
}

export function saveSectorTimeline(t: SectorTimeline) {
  try { localStorage.setItem('qtp_sector_timeline', JSON.stringify(t)); } catch {}
}

// ─── #7: Stock Overlap Detector ──────────────────────────────────────────────

export function detectOverlap(newSymbols: string[], existingResults: AnalysisResult[]): {
  newOnly: string[];
  overlap: string[];
  overlapCount: number;
} {
  const existing = new Set(existingResults.map(r => r.symbol.replace('.NS', '').replace('.BO', '')));
  const newClean = newSymbols.map(s => s.replace('.NS', '').replace('.BO', ''));
  const overlap: string[] = [];
  const newOnly: string[] = [];
  for (let i = 0; i < newSymbols.length; i++) {
    if (existing.has(newClean[i])) overlap.push(newSymbols[i]);
    else newOnly.push(newSymbols[i]);
  }
  return { newOnly, overlap, overlapCount: overlap.length };
}

// ─── #1: Sparkline SVG Generator ─────────────────────────────────────────────

export function generateSparklineSVG(
  candles: { h: number; l: number; c: number; o: number }[],
  zoneHigh?: number,
  zoneLow?: number,
  entry?: number,
  stop?: number
): string {
  const last = candles.slice(-60);
  if (last.length < 5) return '';
  const allPrices = last.flatMap(c => [c.h, c.l]);
  if (zoneHigh) allPrices.push(zoneHigh);
  if (zoneLow) allPrices.push(zoneLow);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const w = 260, h = 80, pad = 2;

  const toY = (p: number) => pad + (1 - (p - minP) / range) * (h - 2 * pad);
  const barW = Math.max(1, (w - 2 * pad) / last.length - 1);

  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${h}px">`;
  svg += `<rect width="${w}" height="${h}" fill="#0d1117" rx="4"/>`;

  // Zone shading
  if (zoneHigh && zoneLow) {
    const zy1 = toY(zoneHigh), zy2 = toY(zoneLow);
    svg += `<rect x="${pad}" y="${zy1}" width="${w - 2 * pad}" height="${zy2 - zy1}" fill="#1e3a5f" opacity="0.4"/>`;
    svg += `<line x1="${pad}" y1="${zy1}" x2="${w - pad}" y2="${zy1}" stroke="#3b82f6" stroke-width="0.5" stroke-dasharray="3,3"/>`;
  }

  // Entry/Stop lines
  if (entry && entry > 0) {
    svg += `<line x1="${pad}" y1="${toY(entry)}" x2="${w - pad}" y2="${toY(entry)}" stroke="#34d399" stroke-width="0.5" stroke-dasharray="2,2"/>`;
  }
  if (stop && stop > 0) {
    svg += `<line x1="${pad}" y1="${toY(stop)}" x2="${w - pad}" y2="${toY(stop)}" stroke="#ef4444" stroke-width="0.5" stroke-dasharray="2,2"/>`;
  }

  // Candles
  for (let i = 0; i < last.length; i++) {
    const c = last[i];
    const x = pad + i * ((w - 2 * pad) / last.length);
    const isGreen = c.c >= c.o;
    const color = isGreen ? '#34d399' : '#ef4444';
    const bodyTop = toY(Math.max(c.o, c.c));
    const bodyBot = toY(Math.min(c.o, c.c));
    const bodyH = Math.max(0.5, bodyBot - bodyTop);
    svg += `<line x1="${x + barW / 2}" y1="${toY(c.h)}" x2="${x + barW / 2}" y2="${toY(c.l)}" stroke="${color}" stroke-width="0.5"/>`;
    svg += `<rect x="${x}" y="${bodyTop}" width="${barW}" height="${bodyH}" fill="${color}"/>`;
  }

  svg += '</svg>';
  return svg;
}
