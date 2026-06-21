import type { AnalysisResult } from './stockEngine';
import { SECTOR_PRESETS } from './sectorPresets';
import { getIndustryTag, getIndustryFull } from './industryMap';

// ─── #1: Conviction Score ────────────────────────────────────────────────────

export function computeConviction(r: AnalysisResult): number {
  const stageWeight: Record<string, number> = {
    ULTRA_STRONG_BUY: 30, STRONG_BUY: 25, BUY: 20,
    PRE_BREAKOUT: 10, EARLY_INFLECTION: 5, COMPRESSION_WATCH: 2, NO_SIGNAL: 0,
  };
  const stage = stageWeight[r.stage] ?? 0;
  const infl = Math.min(r.inflectionScore ?? 0, 100) * 0.25;
  const mom = Math.min(r.momentum?.momentumScore ?? 0, 100) * 0.2;
  const conf = Math.min(r.confidence ?? 0, 100) * 0.15;
  const trade = r.priceEngine?.tradeValid ? 10 : 0;
  const raw = stage + infl + mom + conf + trade;
  return Number.isFinite(raw) ? Math.round(Math.min(Math.max(raw, 0), 100)) : 0;
}

// ─── #2: Sector Tag Map ─────────────────────────────────────────────────────

const SECTOR_SHORT: Record<string, string> = {
  'Auto': 'AUTO', 'Bank': 'BNK', 'Private Bank': 'PVB', 'PSU Bank': 'PSB',
  'Capital Goods': 'CAP', 'Chemicals': 'CHM', 'Construction': 'CON',
  'Consumer Durables': 'DUR', 'Consumer Services': 'SVC', 'Financial Services': 'FIN',
  'FinServ ex-Bank': 'FEX', 'FMCG': 'FMCG', 'Healthcare': 'HC', 'Hospitals': 'HOS',
  'Housing Finance': 'HF', 'Insurance': 'INS', 'IT': 'IT', 'Media': 'MED',
  'Metal': 'MTL', 'NBFC': 'NBFC', 'Oil & Gas': 'O&G', 'Pharma': 'PHR',
  'Power': 'PWR', 'Realty': 'RLT', 'Retail': 'RTL', 'Telecom': 'TEL',
  'Transport Services': 'TRN',
};

let _sectorCache: Map<string, string> | null = null;

function buildSectorCache(): Map<string, string> {
  if (_sectorCache) return _sectorCache;
  _sectorCache = new Map();
  for (const sp of SECTOR_PRESETS) {
    const tag = SECTOR_SHORT[sp.label] ?? sp.label.slice(0, 3).toUpperCase();
    for (const sym of sp.symbols) {
      if (!_sectorCache.has(sym)) _sectorCache.set(sym, tag);
    }
  }
  return _sectorCache;
}

export function getSectorTag(symbol: string): string {
  // Primary: industry map (808 stocks with NSE-official industry)
  const indTag = getIndustryTag(symbol);
  if (indTag) return indTag;
  // Fallback: sector preset membership
  const cache = buildSectorCache();
  const clean = symbol.replace('.NS', '').replace('.BO', '');
  return cache.get(clean) ?? '';
}

export function getSectorFull(symbol: string): string {
  // Primary: industry map
  const indFull = getIndustryFull(symbol);
  if (indFull) return indFull;
  // Fallback: sector presets
  const clean = symbol.replace('.NS', '').replace('.BO', '');
  for (const sp of SECTOR_PRESETS) {
    if (sp.symbols.includes(clean)) return sp.label;
  }
  return '';
}

// ─── #7: Scan Statistics ─────────────────────────────────────────────────────

export interface ScanStats {
  total: number;
  actionable: number;
  avgConfidence: number;
  avgRisk: number;
  bestRR: { symbol: string; rr: number } | null;
  strongestSignal: { symbol: string; score: number } | null;
  highestConviction: { symbol: string; conv: number } | null;
  nearBreakoutCount: number;
  sectorBreakdown: Record<string, number>;
}

export function computeScanStats(results: AnalysisResult[]): ScanStats {
  const actionable = results.filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage));
  const validTrades = results.filter(r => r.priceEngine.tradeValid);
  const risks = validTrades.map(r => r.priceEngine.tacticalRiskPct).filter(r => r > 0);

  let bestRR: { symbol: string; rr: number } | null = null;
  let strongestSignal: { symbol: string; score: number } | null = null;
  let highestConv: { symbol: string; conv: number } | null = null;

  for (const r of results) {
    if (r.priceEngine.rewardRisk > (bestRR?.rr ?? 0)) bestRR = { symbol: r.symbol, rr: r.priceEngine.rewardRisk };
    if (r.inflectionScore > (strongestSignal?.score ?? 0)) strongestSignal = { symbol: r.symbol, score: r.inflectionScore };
    const conv = computeConviction(r);
    if (conv > (highestConv?.conv ?? 0)) highestConv = { symbol: r.symbol, conv };
  }

  const sectorBreakdown: Record<string, number> = {};
  for (const r of actionable) {
    const sector = getSectorFull(r.symbol) || 'Other';
    sectorBreakdown[sector] = (sectorBreakdown[sector] ?? 0) + 1;
  }

  return {
    total: results.length,
    actionable: actionable.length,
    avgConfidence: results.length > 0 ? results.reduce((s, r) => s + r.confidence, 0) / results.length : 0,
    avgRisk: risks.length > 0 ? risks.reduce((s, r) => s + r, 0) / risks.length : 0,
    bestRR, strongestSignal, highestConviction: highestConv,
    nearBreakoutCount: results.filter(r => r.nearBreakout).length,
    sectorBreakdown,
  };
}

// ─── #9: Trade Journal Export ─────────────────────────────────────────────────

export function generateJournalMarkdown(
  results: AnalysisResult[],
  stats: ScanStats,
  trackedTrades: { symbol: string; status: string; pnlPct?: number }[],
  regime: string
): string {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [
    `# Quant Terminal Pro — Trade Journal`,
    `## ${today}`,
    ``,
    `### Market Regime: ${regime}`,
    ``,
    `### Scan Summary`,
    `- **Stocks Scanned:** ${stats.total}`,
    `- **Actionable Signals:** ${stats.actionable}`,
    `- **Near Breakout:** ${stats.nearBreakoutCount}`,
    `- **Avg Confidence:** ${stats.avgConfidence.toFixed(1)}%`,
    `- **Avg Risk:** ${stats.avgRisk.toFixed(2)}%`,
    stats.bestRR ? `- **Best R:R:** ${stats.bestRR.symbol} (${stats.bestRR.rr.toFixed(2)})` : '',
    stats.strongestSignal ? `- **Strongest Signal:** ${stats.strongestSignal.symbol} (Score: ${stats.strongestSignal.score})` : '',
    stats.highestConviction ? `- **Highest Conviction:** ${stats.highestConviction.symbol} (${stats.highestConviction.conv}/100)` : '',
    ``,
    `### Actionable Signals`,
    `| Symbol | Stage | Conviction | Entry | Risk% | R:R |`,
    `|--------|-------|-----------|-------|-------|-----|`,
    ...results
      .filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage))
      .map(r => `| ${r.symbol} | ${r.stage} | ${computeConviction(r)} | ₹${r.priceEngine.plannedEntry.toFixed(2)} | ${r.priceEngine.tacticalRiskPct.toFixed(2)}% | ${r.priceEngine.rewardRisk.toFixed(2)} |`),
    ``,
    trackedTrades.length > 0 ? `### Tracked Trades` : '',
    trackedTrades.length > 0 ? `| Symbol | Status | P&L |` : '',
    trackedTrades.length > 0 ? `|--------|--------|-----|` : '',
    ...trackedTrades.map(t => `| ${t.symbol} | ${t.status} | ${t.pnlPct !== undefined ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%` : 'Open'} |`),
  ].filter(l => l !== '');

  return lines.join('\n');
}

// ─── #10: Dedup Guard ────────────────────────────────────────────────────────

export function deduplicateSymbols(symbols: string[]): { unique: string[]; removed: number } {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of symbols) {
    const clean = s.replace('.NS', '').replace('.BO', '').toUpperCase();
    if (!seen.has(clean)) {
      seen.add(clean);
      unique.push(s);
    }
  }
  return { unique, removed: symbols.length - unique.length };
}
