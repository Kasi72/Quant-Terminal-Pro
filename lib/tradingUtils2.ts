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
  candles: { h: number; l: number; c: number; o: number; v?: number }[],
  zoneHigh?: number,
  zoneLow?: number,
  entry?: number,
  stop?: number,
  target1?: number,
  zoneLen?: number,
  zoneTightnessPct?: number,
  zoneATRRatio?: number,
  zoneShape?: string,
): string {
  const last = candles.slice(-60);
  if (last.length < 5) return '';

  // Price range — include all overlay levels
  const allPrices = last.flatMap(c => [c.h, c.l]);
  if (zoneHigh) allPrices.push(zoneHigh);
  if (zoneLow) allPrices.push(zoneLow);
  if (entry && entry > 0) allPrices.push(entry);
  if (stop && stop > 0) allPrices.push(stop);
  if (target1 && target1 > 0) allPrices.push(target1);
  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const buf = (rawMax - rawMin) * 0.08;
  const minP = rawMin - buf * 0.3;
  const maxP = rawMax + buf * 0.7;
  const range = maxP - minP || 1;

  // ── Layout (wide viewBox + width:100% → scales proportionally to container) ──
  const W = 310;        // viewBox width
  const lW = 54;        // right label column
  const cW = W - lW;   // candle area width (0..256)
  const pH = 106;       // price area height
  const vH = 38;        // volume area height
  const H = pH + vH + 5;
  const pad = 5;
  const vy0 = pH + 3;
  const vBot = vy0 + vH;

  const toY = (p: number) => pad + (1 - (p - minP) / range) * (pH - 2 * pad);
  const n = last.length;
  const slW = (cW - pad) / n;
  const bW = Math.max(1.5, slW - 0.8);
  const xOf = (i: number) => pad + i * slW;

  // style="width:100%" with NO fixed height → browser preserves aspect ratio
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%">`;
  svg += `<rect width="${W}" height="${H}" fill="#0d1117" rx="4"/>`;
  svg += `<line x1="${pad}" y1="${pH + 1.5}" x2="${cW}" y2="${pH + 1.5}" stroke="#1e293b" stroke-width="0.7"/>`;

  // ── Compression zone — quality-scored, two-tier horizontal level lines ──
  // Ceiling = breakout/resistance level (dominant visual)
  // Floor   = support/invalidation level (receded, secondary)
  let zoneOverlay = '';
  if (zoneHigh && zoneLow) {
    const zy1  = toY(zoneHigh);
    const zy2  = toY(zoneLow);
    const dur  = zoneLen ?? 0;
    const zS   = dur > 0 ? Math.max(0, n - dur) : 0;
    const xZ0  = xOf(zS);
    const xZ1  = xOf(n - 1) + bW;
    const zBandH = Math.max(1, zy2 - zy1);

    // ── Quality score (0–100) from three orthogonal factors ──
    const tight = zoneTightnessPct ?? 15;
    const atrR  = zoneATRRatio   ?? 1.0;
    // Tightness: exponential reward — sub-5% zones are genuinely rare setups
    const tScore = tight < 3   ? 40 : tight < 5  ? 32
                 : tight < 7   ? 22 : tight < 10 ? 12 : 5;
    // Duration: longer base = more coiled energy (Darvas box / Minervini logic)
    const dScore = dur  >= 20  ? 30 : dur  >= 14 ? 24
                 : dur  >= 10  ? 17 : dur  >= 6  ? 10 : 4;
    // ATR ratio inside zone: lower = quieter = more compressed
    const aScore = atrR <= 0.45 ? 30 : atrR <= 0.60 ? 24
                 : atrR <= 0.75 ? 16 : atrR <= 0.90 ? 8 : 3;
    const quality = tScore + dScore + aScore;   // 0–100

    // ── Volume trend inside zone (computed from raw candles) ──
    // Declining volume during compression = institutional absorption = bullish
    const zCandles = last.slice(zS);
    const zVols    = zCandles.map(c => c.v ?? 0).filter(v => v > 0);
    const volDecl  = zVols.length >= 4
      && zVols[zVols.length - 1] < zVols[0] * 0.82;

    // ── Tier + visual style ──
    // ELITE (≥75): rare high-conviction setup → mint green
    // GOOD  (≥50): solid setup              → near-white
    // FAIR  (≥30): marginal                 → amber
    // WEAK  (<30): wide / short             → slate
    const tier =
      quality >= 75 ? 'ELITE' :
      quality >= 50 ? 'GOOD'  :
      quality >= 30 ? 'FAIR'  : 'WEAK';

    const ceilColor =
      tier === 'ELITE' ? '#86efac' :   // mint green
      tier === 'GOOD'  ? '#e2e8f0' :   // near-white
      tier === 'FAIR'  ? '#fcd34d' :   // amber
                         '#94a3b8';    // slate

    const ceilW  = tier === 'ELITE' ? 1.3 : tier === 'GOOD' ? 1.1 : 0.9;
    const floorC = '#475569';   // always slate — floor is context, not signal
    const floorW = 0.75;

    // ── PASS 1: zone-band fill (behind candles, zone x-span only) ──
    svg += `<rect x="${xZ0}" y="${zy1}" width="${Math.max(1, xZ1 - xZ0)}" `
         + `height="${zBandH}" fill="${ceilColor}" opacity="0.07" rx="1"/>`;

    // ── PASS 2: lines + markers + label (on top of candles) ──

    // Floor — full chart width, receded
    zoneOverlay +=
      `<line x1="${pad}" y1="${zy2}" x2="${cW}" y2="${zy2}" `
    + `stroke="${floorC}" stroke-width="${floorW}"/>`;

    // Ceiling — full chart width, dominant
    zoneOverlay +=
      `<line x1="${pad}" y1="${zy1}" x2="${cW}" y2="${zy1}" `
    + `stroke="${ceilColor}" stroke-width="${ceilW}"/>`;

    // Left-edge bracket: dashed vertical connector at zone start
    // Shows exactly where compression began — like a TradingView "zone box" left wall
    if (xZ0 > pad + 4) {
      zoneOverlay +=
        `<line x1="${xZ0}" y1="${zy1}" x2="${xZ0}" y2="${zy2}" `
      + `stroke="${ceilColor}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.55"/>`;
    }

    // ── Annotation pill ──
    // Content: tier label + duration + tightness + optional volume trend tag
    const shapeTag  = zoneShape === 'ASCENDING' ? ' ↗' : '';
    const volTag    = volDecl ? ' ↓V' : '';
    const tierLabel = tier === 'ELITE' ? '★ ' : tier === 'FAIR' ? '△ ' : '';
    const annText   =
      `${tierLabel}COMP ${dur}d · ${tight.toFixed(1)}%${shapeTag}${volTag}`;

    // Pill colours match tier
    const pillBg  =
      tier === 'ELITE' ? '#052e16' :
      tier === 'GOOD'  ? '#0d1117' :
      tier === 'FAIR'  ? '#1c1108' : '#111827';
    const pillBdr =
      tier === 'ELITE' ? '#166534' :
      tier === 'GOOD'  ? '#374151' :
      tier === 'FAIR'  ? '#854d0e' : '#374151';

    const pillW  = 116;
    const pillH  = 14;
    const spaceAbove = zy1 - pad;
    const spaceBelow = pH - pad - zy2;
    const annY = spaceAbove >= pillH + 5 ? zy1 - pillH - 4
               : spaceBelow >= pillH + 5 ? zy2 + 4
               : zy1 + 5;
    const annX = Math.min(Math.max(xZ0, pad + 1), cW - pillW - 2);

    zoneOverlay +=
      `<rect x="${annX}" y="${annY}" width="${pillW}" height="${pillH}" `
    + `fill="${pillBg}" stroke="${pillBdr}" stroke-width="0.8" rx="2"/>`;
    zoneOverlay +=
      `<text x="${annX + 5}" y="${annY + 10.5}" font-size="9" `
    + `fill="${ceilColor}" font-weight="bold">${annText}</text>`;
  }

  // ── Pivot High / Pivot Low markers (3-bar lookback) ──
  const phIdxs: number[] = [];
  const plIdxs: number[] = [];
  for (let i = 3; i < n - 4; i++) {
    const hi = last[i].h;
    if (hi > last[i-1].h && hi > last[i-2].h && hi > last[i-3].h &&
        hi > last[i+1].h && hi > last[i+2].h && hi > last[i+3].h) phIdxs.push(i);
    const lo = last[i].l;
    if (lo < last[i-1].l && lo < last[i-2].l && lo < last[i-3].l &&
        lo < last[i+1].l && lo < last[i+2].l && lo < last[i+3].l) plIdxs.push(i);
  }
  for (const i of phIdxs.slice(-2)) {
    const cx = xOf(i) + bW / 2;
    const wy = toY(last[i].h);
    if (wy > pad + 16) {
      svg += `<polygon points="${cx-4},${wy-9} ${cx+4},${wy-9} ${cx},${wy-4}" fill="#fb923c"/>`;
      svg += `<text x="${cx}" y="${wy - 11}" text-anchor="middle" font-size="8" fill="#fb923c" font-weight="bold">PH</text>`;
    }
  }
  for (const i of plIdxs.slice(-2)) {
    const cx = xOf(i) + bW / 2;
    const wy = toY(last[i].l);
    if (wy < pH - pad - 16) {
      svg += `<polygon points="${cx-4},${wy+9} ${cx+4},${wy+9} ${cx},${wy+4}" fill="#38bdf8"/>`;
      svg += `<text x="${cx}" y="${wy + 20}" text-anchor="middle" font-size="8" fill="#38bdf8" font-weight="bold">PL</text>`;
    }
  }

  // ── Level lines with right-side pill labels ──
  const drawLevel = (price: number, col: string, label: string, dash: string) => {
    const ly = toY(price);
    if (ly < 2 || ly > pH - 2) return;
    svg += `<line x1="${pad}" y1="${ly}" x2="${cW}" y2="${ly}" stroke="${col}" stroke-width="1" stroke-dasharray="${dash}"/>`;
    // Dark pill background + readable text
    svg += `<rect x="${cW + 2}" y="${ly - 9}" width="${lW - 3}" height="18" fill="#0a0f1e" rx="3"/>`;
    svg += `<text x="${cW + 4}" y="${ly - 1}" font-size="8.5" fill="${col}" font-weight="bold">${label}</text>`;
    svg += `<text x="${cW + 4}" y="${ly + 9}" font-size="9" fill="${col}">₹${price.toFixed(0)}</text>`;
  };
  if (target1 && target1 > 0) drawLevel(target1, '#2dd4bf', 'T1', '5,3');
  if (entry && entry > 0) drawLevel(entry, '#4ade80', 'ENT', '3,2');
  if (stop && stop > 0) drawLevel(stop, '#f87171', 'SL', '3,2');

  // ── EMA50 (slate) then EMA20 (amber) on top ──
  const buildEma = (k: number): string[] => {
    let e = last[0].c;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      e = last[i].c * k + e * (1 - k);
      const ey = toY(e);
      if (ey >= 0 && ey <= pH) pts.push(`${(xOf(i) + bW / 2).toFixed(1)},${ey.toFixed(1)}`);
    }
    return pts;
  };
  const e50 = buildEma(2 / 51);
  const e20 = buildEma(2 / 21);
  if (e50.length > 1) svg += `<polyline points="${e50.join(' ')}" fill="none" stroke="#64748b" stroke-width="1.1" opacity="0.65"/>`;
  if (e20.length > 1) svg += `<polyline points="${e20.join(' ')}" fill="none" stroke="#f59e0b" stroke-width="1.3" opacity="0.85"/>`;

  // ── Volume histogram ──
  const vols = last.map(c => c.v ?? 0);
  const hasVol = vols.some(v => v > 0);
  const maxVol = Math.max(...vols, 1);
  const priorVols = vols.slice(0, -1).filter(v => v > 0);
  const avgVol = priorVols.length ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : 0;
  if (hasVol) {
    for (let i = 0; i < n; i++) {
      const c = last[i]; const isSig = i === n - 1;
      const bHv = Math.max(1.5, ((c.v ?? 0) / maxVol) * (vH - 3));
      const isG = c.c >= c.o;
      svg += `<rect x="${xOf(i)}" y="${vBot - bHv}" width="${bW}" height="${bHv}" fill="${isG ? (isSig ? '#4ade80' : '#166534') : (isSig ? '#f87171' : '#7f1d1d')}"/>`;
    }
    if (avgVol > 0) {
      const avy = vBot - (avgVol / maxVol) * (vH - 3);
      svg += `<line x1="${pad}" y1="${avy}" x2="${cW}" y2="${avy}" stroke="#475569" stroke-width="0.8" stroke-dasharray="4,3"/>`;
    }
    svg += `<text x="${pad + 2}" y="${vy0 + 10}" font-size="8" fill="#64748b">VOL</text>`;
  }

  // ── Candles (on top of everything) ──
  for (let i = 0; i < n; i++) {
    const c = last[i]; const x = xOf(i);
    const isG = c.c >= c.o; const isSig = i === n - 1;
    if (isSig) {
      const wt = Math.max(0, toY(c.h) - 3);
      const wb = Math.min(pH - 1, toY(c.l) + 3);
      svg += `<rect x="${x - 2}" y="${wt}" width="${bW + 4}" height="${Math.max(4, wb - wt)}" fill="none" stroke="#fbbf24" stroke-width="1.8" rx="1.5"/>`;
    }
    const col = isG ? (isSig ? '#4ade80' : '#34d399') : (isSig ? '#f87171' : '#ef4444');
    const bTop = toY(Math.max(c.o, c.c));
    const bBot = toY(Math.min(c.o, c.c));
    svg += `<line x1="${x + bW / 2}" y1="${toY(c.h)}" x2="${x + bW / 2}" y2="${toY(c.l)}" stroke="${col}" stroke-width="${isSig ? 1.2 : 0.6}"/>`;
    svg += `<rect x="${x}" y="${bTop}" width="${bW}" height="${Math.max(0.8, bBot - bTop)}" fill="${col}" opacity="${isSig ? 1 : 0.88}"/>`;
  }

  // ── Zone border + label ON TOP of candles (fully visible) ──
  svg += zoneOverlay;

  // ── VOL↑ surge badge — lives in the VOLUME row, never touches price candles ──
  if (hasVol && avgVol > 0 && (last[n - 1]?.v ?? 0) > 1.8 * avgVol) {
    svg += `<rect x="${cW - 34}" y="${vy0 + 2}" width="32" height="13" fill="#0a0f1e" rx="2"/>`;
    svg += `<text x="${cW - 18}" y="${vy0 + 12}" text-anchor="middle" font-size="8.5" fill="#fbbf24" font-weight="bold">VOL↑</text>`;
  }

  // ── Last close price — top-LEFT corner, always clear of the signal candle ──
  const lc = last[n - 1]?.c;
  if (lc) {
    const lcTxt = `₹${lc.toFixed(1)}`;
    const lcW = lcTxt.length * 6.2 + 6;   // rough char-width estimate
    svg += `<rect x="${pad}" y="${pad}" width="${lcW}" height="14" fill="#0a0f1e" rx="3"/>`;
    svg += `<text x="${pad + 4}" y="${pad + 11}" font-size="10" fill="#cbd5e1" font-weight="bold">${lcTxt}</text>`;
  }

  // ── EMA legend pills — bottom-left, just above the price/vol separator ──
  svg += `<rect x="${pad}" y="${pH - 15}" width="38" height="12" fill="#0a0f1e" rx="2"/>`;
  svg += `<text x="${pad + 4}" y="${pH - 6}" font-size="8" fill="#f59e0b" font-weight="bold">EMA20</text>`;
  svg += `<rect x="${pad + 41}" y="${pH - 15}" width="38" height="12" fill="#0a0f1e" rx="2"/>`;
  svg += `<text x="${pad + 45}" y="${pH - 6}" font-size="8" fill="#64748b" font-weight="bold">EMA50</text>`;

  svg += '</svg>';
  return svg;
}
