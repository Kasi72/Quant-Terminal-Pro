// ─── AI Signal Narrative Generator ───────────────────────────────────────────
// Generates human-readable trade thesis from computed data — no AI API needed

import type { AnalysisResult } from './stockEngine';
import type { AllPivots } from './pivotCalculator';
import type { RSRanking, TFAlignment } from './advancedFeatures';

function safe(v: number, f = 0): number { return Number.isFinite(v) ? v : f; }

export interface SignalNarrative {
  headline: string;
  setup: string;
  entry: string;
  risk: string;
  caution: string;
  verdict: string;
}

export function generateNarrative(
  r: AnalysisResult,
  rs?: RSRanking | null,
  tf?: TFAlignment | null,
  pivots?: AllPivots | null,
  onsetTier?: string | null,
  conviction?: number,
  earningsSeason?: boolean,
): SignalNarrative {
  try {
    const sym = r.symbol.replace('.NS', '').replace('.BO', '');
    const pe = r.priceEngine;
    const rps = pe.plannedEntry - pe.tacticalStop;
    const rr = pe.rewardRisk;
    const zone = r.zone;
    const mom = r.momentum;
    const stats = r.stats;

    // ── HEADLINE ──
    const stageWord = r.stage === 'ULTRA_STRONG_BUY' ? 'Ultra Strong' : r.stage === 'STRONG_BUY' ? 'Strong' : 'Actionable';
    const headline = `${sym} — ${stageWord} Breakout Signal (Conviction ${conviction ?? '—'})`;

    // ── SETUP DESCRIPTION ──
    const setupParts: string[] = [];

    // Compression zone
    if (zone) {
      const tightness = zone.zoneTightnessPct;
      const len = zone.windowLength;
      const tightnessWord = tightness <= 5 ? 'extremely tight' : tightness <= 10 ? 'tight' : 'moderate';
      setupParts.push(`${sym} compressed for ${len} candles in a ${tightnessWord} ${tightness.toFixed(1)}% range`);

      // Context
      const dd = safe(stats?.drawdownFrom52WH);
      if (dd > 15) setupParts.push(`after a ${dd.toFixed(0)}% pullback from its 52-week high`);
      else if (dd > 5) setupParts.push(`consolidating ${dd.toFixed(0)}% below its 52-week high`);
      else setupParts.push('near its 52-week high');
    }

    // Signal candle quality
    const candleParts: string[] = [];
    if (r.bodyPct >= 60) candleParts.push('strong full-body');
    else if (r.bodyPct >= 40) candleParts.push('solid body');
    if (r.closeLoc >= 80) candleParts.push('closing near the high');
    else if (r.closeLoc >= 65) candleParts.push('closing in the upper half');
    if (r.upperWickPct <= 15) candleParts.push('minimal upper wick');
    const volExp = safe(r.exactVolVsPre5);
    if (volExp >= 3) candleParts.push(`on ${volExp.toFixed(1)}x average volume`);
    else if (volExp >= 2) candleParts.push(`on ${volExp.toFixed(1)}x volume expansion`);

    if (candleParts.length > 0) {
      setupParts.push(`Today's breakout candle: ${candleParts.join(', ')}`);
    }

    // Onset candle
    if (onsetTier === 'BEST') setupParts.push('This is a Volume-Thrust Close-High candle — the highest-probability onset pattern (81.8% backtest hit rate for >5% moves)');
    else if (onsetTier === 'STRONG') setupParts.push('This is a Strong Onset candle — volume-confirmed expansion breakout');

    // Momentum quality
    if (mom) {
      const momParts: string[] = [];
      if (mom.emaAligned) momParts.push('EMAs are aligned bullish');
      if (mom.higherLowConfirmed) momParts.push('higher low structure confirmed');
      if (mom.volDryUpScore >= 3) momParts.push('volume dried up during compression');
      if (mom.adxInRange) momParts.push(`ADX at ${safe(mom.adx14).toFixed(0)} (sweet spot)`);
      if (momParts.length > 0) setupParts.push(momParts.join(', '));
    }

    // RS and TF
    if (rs && rs.rsRank >= 70) setupParts.push(`RS Rank ${rs.rsRank} (top ${100 - rs.rsRank}% — outperforming market)`);
    if (tf?.alignment === 'DW') setupParts.push('Weekly chart confirms — both daily AND weekly breakout aligned');
    else if (tf?.alignment === 'D') setupParts.push('Daily breakout only — weekly still compressing (watch for confirmation)');

    // TTM Squeeze
    if (stats?.ttmSqueezeFired) setupParts.push('TTM Squeeze just fired — momentum released from tight compression');
    else if (stats?.ttmSqueezeOn) setupParts.push('TTM Squeeze is ON — compression active, breakout imminent');

    const setup = setupParts.join('. ') + '.';

    // ── ENTRY PLAN ──
    const entryParts: string[] = [];
    entryParts.push(`Entry at ₹${pe.plannedEntry.toFixed(2)} with stop at ₹${pe.tacticalStop.toFixed(2)} (${safe(pe.tacticalRiskPct).toFixed(1)}% risk)`);
    const rrVerdict = rr >= 3.5 ? 'Elite' : rr >= 2.5 ? 'Very Good' : rr >= 2.0 ? 'Good' : 'Acceptable';
    entryParts.push(`R:R is ${rr.toFixed(2)}:1 (${rrVerdict})`);
    entryParts.push(`T1 at ₹${pe.target5.toFixed(2)} — sell 50% here, move stop to breakeven`);
    if (pe.target7 > 0) entryParts.push(`T2 at ₹${pe.target7.toFixed(2)} — sell 30%, trail with Chandelier exit`);

    const entry = entryParts.join('. ') + '.';

    // ── RISK FACTORS ──
    const riskParts: string[] = [];

    // Pivot warnings
    if (pivots) {
      const nearestR = pivots.nextResistance;
      if (nearestR && pe.target5 > 0) {
        const t1Dist = Math.abs(pe.target5 - nearestR.price);
        if (t1Dist < pe.plannedEntry * 0.005) {
          riskParts.push(`T1 (₹${pe.target5.toFixed(0)}) sits right at pivot ${nearestR.level} (₹${nearestR.price.toFixed(0)}) — price may stall before target`);
        }
      }
      const confluence = pivots.confluence.filter(c => c.type === 'resistance' && c.relevance === 'immediate');
      if (confluence.length > 0) {
        riskParts.push(`Immediate resistance cluster at ₹${confluence[0].price.toFixed(0)} (${confluence[0].strength} methods agree)`);
      }
    }

    // Gap warning
    if (pe.gapPct > 2) riskParts.push(`Stock gapped up ${pe.gapPct.toFixed(1)}% — consider half-size to manage gap risk`);
    if (pe.entryStatus === 'no_chase') riskParts.push('Entry is extended — do NOT chase, wait for pullback');

    // Sector/regime
    if (earningsSeason) riskParts.push('Earnings season active — verify individual stock earnings date before entry');

    if (rs && rs.rsRank < 30) riskParts.push(`RS Rank only ${rs.rsRank} — stock is underperforming the market, weaker setup`);

    const caution = riskParts.length > 0 ? riskParts.join('. ') + '.' : 'No specific risk flags identified.';

    // ── VERDICT ──
    const verdictParts: string[] = [];
    const score = conviction ?? 0;
    if (score >= 70) verdictParts.push('High-conviction setup');
    else if (score >= 50) verdictParts.push('Moderate-conviction setup');
    else verdictParts.push('Lower-conviction setup — be selective');

    if (rr >= 2.5 && (rs?.rsRank ?? 0) >= 60 && tf?.alignment === 'DW') {
      verdictParts.push('This is an A-grade setup: strong R:R + RS leader + weekly confirmation. Full position size.');
    } else if (rr >= 2.0 && (rs?.rsRank ?? 0) >= 50) {
      verdictParts.push('B-grade setup: decent R:R and relative strength. Standard position size.');
    } else {
      verdictParts.push('C-grade setup: acceptable but not ideal. Consider half-size or skip.');
    }

    const verdict = verdictParts.join(' ');

    return { headline, setup, entry, risk: caution, caution, verdict };
  } catch {
    return {
      headline: `${r?.symbol ?? 'UNKNOWN'} — Signal`, setup: 'Analysis unavailable.',
      entry: 'See trade engine for details.', risk: '—', caution: '—', verdict: '—',
    };
  }
}
