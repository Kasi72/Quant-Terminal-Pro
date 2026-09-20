// TypeSafe AI (Jev) scoring layer — post-gate signal quality ranking.
// Only called for ULTRA_STRONG_BUY signals in batch-screener (typically 5-20/session).
// Results embedded in raw_json.jevScore before Supabase upsert — no schema migration needed.

import { choice, score, noul, TypeSafeClient } from '@typesafe-ai/sdk';
import type { AnalysisResult } from './stockEngine';

export interface JevScore {
  quality: number;           // 0-10 candle quality (sort key — higher = better)
  falseBkProb: number;       // 0-1 false breakout probability (noul)
  strength: string;          // choice: ultra_strong | strong | moderate | weak
  strengthConf: number;      // Jev confidence on strength choice
  scoredAt: string;          // ISO timestamp
}

let _client: TypeSafeClient | null = null;
function getClient(): TypeSafeClient {
  if (!_client) _client = new TypeSafeClient();
  return _client;
}

export async function scoreSignal(result: AnalysisResult): Promise<JevScore | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') return null;

  try {
    const client = getClient();

    const state = {
      archetype:         result.archetypeType ?? 'unknown',
      volume_ratio_20d:  result.exactVolRatio20,
      range_vs_atr:      result.exactRangeATR14,
      body_pct:          result.bodyPct,
      upper_wick_pct:    result.upperWickPct,
      close_location:    result.closeLoc,
      rsi14:             result.rsi14,
      pre10_range_atr:   result.pre10AvgRangeATR,
      vol_vs_pre5:       result.exactVolVsPre5,
      near_breakout_pct: result.nearBreakoutPct,
      inflection_score:  result.inflectionScore,
    };

    const response = await client.systemOne({
      state,
      questions: {
        quality: score(
          'Rate this NSE stock breakout signal quality. ' +
          'Positive: body_pct > 65 (strong close), upper_wick_pct < 6 (no rejection), ' +
          'volume_ratio_20d > 3 and vol_vs_pre5 > 2 (volume surge), ' +
          'pre10_range_atr < 1.5 (quiet base before explosion), rsi14 55–75. ' +
          'Penalise: high upper wick, low volume, rsi14 > 80, pre10_range_atr > 2.',
          [
            'Weak — likely false breakout, multiple red flags',
            'Below average — some concerns present',
            'Average — mixed signals, marginal setup',
            'Strong — most criteria met, good setup',
            'Perfect — all criteria met, ideal momentum breakout',
          ] as const
        ),
        false_breakout: noul(
          'This breakout candle shows classic false breakout / bull trap characteristics: ' +
          'high upper wick relative to body, volume not meaningfully above average, ' +
          'RSI overextended above 80, or candle extended far above base.'
        ),
        strength: choice('Overall breakout signal strength?', {
          ultra_strong: null,
          strong: null,
          moderate: null,
          weak: null,
        }),
      },
    });

    return {
      quality:      Math.round(response.answers.quality.score * 2.5 * 10) / 10, // 0-4 → 0-10
      falseBkProb:  response.answers.false_breakout.noul,
      strength:     response.answers.strength.choice,
      strengthConf: response.answers.strength.confidence,
      scoredAt:     new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// Sequential with 100ms gap to respect rate limits.
// ULTRA_STRONG_BUY count is typically 5–20/session so latency is acceptable.
export async function scoreSignalBatch(
  results: AnalysisResult[]
): Promise<Map<string, JevScore>> {
  const out = new Map<string, JevScore>();
  for (const r of results) {
    const s = await scoreSignal(r);
    if (s) out.set(r.symbol, s);
    await new Promise(res => setTimeout(res, 100));
  }
  return out;
}
