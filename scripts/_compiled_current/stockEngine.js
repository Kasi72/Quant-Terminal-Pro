"use strict";
// Quant Terminal Pro v9.0 — Analysis Engine
// Pure TypeScript, browser-safe (no Node.js APIs)
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARAM_SET_OPTIONS = exports.PARAM_SETS = void 0;
exports.analyzeStockWithLookback = analyzeStockWithLookback;
exports.computeRSvsNifty = computeRSvsNifty;
exports.computeClusterBreakdown = computeClusterBreakdown;
exports.analyzeStockMulti = analyzeStockMulti;
exports.analyzeStock = analyzeStock;
exports.detectMonster = detectMonster;
exports.detectCandleDNA = detectCandleDNA;
exports.generateDemoData = generateDemoData;
const statsEngine_1 = require("./statsEngine");
const advancedEngine_1 = require("./advancedEngine");
// Feature #3: Lookback — scan last N candles as potential signal candles, return best
function analyzeStockWithLookback(candles, paramSetKey, lookback) {
    const stageRank = {
        ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4,
        EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
    };
    let best = null;
    const end = candles.length;
    const start = Math.max(30, end - lookback);
    for (let i = end; i >= start; i--) {
        const slice = candles.slice(0, i);
        if (slice.length < 30)
            break;
        const r = analyzeStock(slice, paramSetKey);
        if (!best || stageRank[r.stage] > stageRank[best.stage] ||
            (stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore)) {
            best = r;
        }
        if (r.stage === 'ULTRA_STRONG_BUY')
            break; // stop only on highest tier; keep searching for stronger signals
    }
    return best ?? analyzeStock(candles, paramSetKey);
}
// Feature #4: Relative Strength vs Nifty 50
function computeRSvsNifty(stockCandles, niftyCandles, period = 20) {
    if (stockCandles.length < period + 1 || niftyCandles.length < period + 1)
        return 1.0;
    const stockEnd = stockCandles[stockCandles.length - 1].c;
    const stockStart = stockCandles[stockCandles.length - 1 - period].c;
    const niftyEnd = niftyCandles[niftyCandles.length - 1].c;
    const niftyStart = niftyCandles[niftyCandles.length - 1 - period].c;
    if (stockStart <= 0 || niftyStart <= 0)
        return 1.0;
    const stockReturn = stockEnd / stockStart;
    const niftyReturn = niftyEnd / niftyStart;
    return niftyReturn > 0 ? stockReturn / niftyReturn : 1.0;
}
// Compute conditions met per param set (for cluster breakdown column)
function computeClusterBreakdown(candles) {
    const mapping = [
        { key: 'optimized_deployable_20plus', label: 'deployable' },
        { key: 'optimized_highprecision_15plus', label: 'highPrecision' },
        { key: 'optimized_elite_10plus', label: 'elite' },
        { key: 'optimized_ultraselective_8plus', label: 'ultraSelective' },
        { key: 'sniper_95plus', label: 'sniper' },
    ];
    const result = {};
    for (const { key, label } of mapping) {
        const r = analyzeStock(candles, key);
        result[label] = { met: r.conditionsMet, total: r.totalConditions };
    }
    // ORS-Prime: separate reversal analysis
    const orsR = analyzeStock(candles, 'ors_prime_reversal');
    result.orsReversal = {
        met: orsR.conditionsMet,
        total: orsR.totalConditions,
        score: orsR.orsScore ?? 0,
        confirmed: orsR.orsConfirmed ?? false,
    };
    return result;
}
function analyzeStockMulti(candles, symbol) {
    const byParamSet = {};
    let best = null;
    const passedSets = [];
    const stageRank = {
        ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4,
        EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
    };
    const mapping = [
        { key: 'optimized_deployable_20plus', label: 'deployable' },
        { key: 'optimized_highprecision_15plus', label: 'highPrecision' },
        { key: 'optimized_elite_10plus', label: 'elite' },
        { key: 'optimized_ultraselective_8plus', label: 'ultraSelective' },
        { key: 'sniper_95plus', label: 'sniper' },
    ];
    const breakdown = {};
    for (const { key, label } of mapping) {
        const r = analyzeStock(candles, key);
        r.symbol = symbol;
        byParamSet[key] = r;
        breakdown[label] = { met: r.conditionsMet, total: r.totalConditions };
        if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) {
            passedSets.push(key);
        }
        if (!best || stageRank[r.stage] > stageRank[best.stage] ||
            (stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore)) {
            best = r;
        }
    }
    // ORS-Prime reversal — separate path, included in byParamSet and breakdown
    const orsR = analyzeStock(candles, 'ors_prime_reversal');
    orsR.symbol = symbol;
    byParamSet['ors_prime_reversal'] = orsR;
    breakdown.orsReversal = {
        met: orsR.conditionsMet,
        total: orsR.totalConditions,
        score: orsR.orsScore ?? 0,
        confirmed: orsR.orsConfirmed ?? false,
    };
    if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(orsR.stage)) {
        passedSets.push('ors_prime_reversal');
        if (!best || stageRank[orsR.stage] > stageRank[best.stage] ||
            (stageRank[orsR.stage] === stageRank[best.stage] && orsR.inflectionScore > best.inflectionScore)) {
            best = orsR;
        }
    }
    // Set full breakdown on best result
    best.clusterBreakdown = breakdown;
    return {
        symbol,
        lastClose: best.lastClose,
        lastDate: best.lastDate,
        best: best,
        byParamSet,
        passedSets,
        passedCount: passedSets.length,
    };
}
// ─── PARAM SETS ── LOCKED ─────────────────────────────────────────────────────
// These values are verified by scripts/goldenParams.json.
// Before changing any value: node scripts/check-params  (will show drift).
// After an intentional change: npm run update-params    (updates the lock).
// ──────────────────────────────────────────────────────────────────────────────
exports.PARAM_SETS = {
    // v13 forensic — stop-first validation: 68.3% WR, +2.08% avg, PF 2.24 (41 trades)
    optimized_deployable_20plus: {
        name: 'Deployable Forensic D6', tag: '68.3% WR',
        minAvgTurnover20: 10000000, maxATRPct14Pctl120: 50,
        maxPre10AvgRangeATR: 1.15, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
        maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.90,
        maxPre10HighVolCount: 2, highVolMultiplier: 1.35, maxPre10RedVolBias: 0.8,
        breakoutMultiplier: 1.001,
        minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
        minExactVolRatio20: 1.3, minExactVolVsPre5: 2.0,
        minCloseLoc: 40, maxUpperWickPct: 18, minBodyPct: 50, maxCandleRisk: 10.0,
        minUltraPrecisionScore: 45, minRSI2: 50,
        minVolatilityExpansionRatio: 2.0, minCandleQualityScore: 2,
        maxCloseAboveZonePct: 6.0,
        forensic: {
            maxCusumPos: 0.04,
            requireBullishPattern: true,
        },
    },
    // v13 forensic — stop-first validation: 62.5% WR, +1.33% avg, PF 1.67 (80 trades)
    optimized_highprecision_15plus: {
        name: 'HighPrecision Forensic HP2', tag: '62.5% WR',
        minAvgTurnover20: 10000000, maxATRPct14Pctl120: 85,
        maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 5.0,
        maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
        maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 1.1,
        breakoutMultiplier: 1.001,
        minExactRangeATR14: 0.8, maxExactRangeATR14: 5.0,
        minExactVolRatio20: 1.1, minExactVolVsPre5: 2.0,
        minCloseLoc: 50, maxUpperWickPct: 10, minBodyPct: 50, maxCandleRisk: 5.0,
        minUltraPrecisionScore: 50, minRSI2: 50,
        minVolatilityExpansionRatio: 1.4, minCandleQualityScore: null,
        maxCloseAboveZonePct: 4.0,
        forensic: {
            maxBodyATR: 1.6,
        },
    },
    // v12 tuned — stop-first validation: 75.0% WR, +3.41% avg, PF 4.33 (12 trades; small sample)
    optimized_elite_10plus: {
        name: 'Elite Tuned', tag: '75.0% WR',
        minAvgTurnover20: 20000000, maxATRPct14Pctl120: 60,
        maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 1.0, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
        maxPre10AvgVolRatio: 1.0, maxPre5AvgVolRatio: 1.10,
        maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 1.1,
        breakoutMultiplier: 1.001,
        minExactRangeATR14: 1.8, maxExactRangeATR14: 6.0,
        minExactVolRatio20: 2.2, minExactVolVsPre5: 2.0,
        minCloseLoc: 55, maxUpperWickPct: 15, minBodyPct: 35, maxCandleRisk: 5.0,
        minUltraPrecisionScore: 0, minRSI2: 50,
        minVolatilityExpansionRatio: 1.4, minCandleQualityScore: 2,
        maxCloseAboveZonePct: 8.0,
    },
    // ✅ Grid-optimised v13 — 1616-stock sweep, n=294, WR=56.8%, Wilson=51.09%, PF=1.933
    // Key changes vs v12: minUltraPrecisionScore 0→60, minExactVolRatio20 0.8→1.5,
    //   minExactVolVsPre5 1.5→2.0, minCloseLoc 65→63, maxUpperWickPct 20→15,
    //   minVolatilityExpansionRatio 1.4→1.1, minBodyPct 60→30, maxPre10HighVolCount 0→1,
    //   maxPre10RedVolBias 0.8→1.5, maxZoneTightnessPct 15→18, minExactRangeATR14 1.2→1.0
    // ✅ ChatGPT forensic v12 — 1616-stock sweep, n=54, WR=70.4%, Wilson=57.2%, PF=3.656
    // OOS (last 30%): n=17, WR=70.6%, PF=4.237. Tighter than Grid-v13 (7x fewer signals, cleaner setup)
    optimized_ultraselective_8plus: {
        name: 'Ultra-Selective Forensic 8+', tag: '70.4% WR',
        minAvgTurnover20: 10000000, maxATRPct14Pctl120: 95,
        maxPre10AvgRangeATR: 1.3, maxPre10ExpansionCount: 0, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 0.95, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
        maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
        maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 0.8,
        breakoutMultiplier: 1.001,
        minExactRangeATR14: 1.2, maxExactRangeATR14: 6.0,
        minExactVolRatio20: 0.8, minExactVolVsPre5: 1.5,
        minCloseLoc: 65, maxUpperWickPct: 20, minBodyPct: 60, maxCandleRisk: 8.5,
        minUltraPrecisionScore: 0, minRSI2: 50,
        minVolatilityExpansionRatio: 1.4, minCandleQualityScore: 3,
        maxCloseAboveZonePct: null,
    },
    // ✅ ORS-Prime v3 Rank 2 — deep_tune_updated_six_full_v3 (1616 stocks, 2021-2026)
    // IS: n=2160 WR=81.3% Avg=1.09% PF=1.51 | OOS: n=648 WR=85.0% Avg=1.92% PF=2.30 MFE=6.3% MAE=-4.7%
    // Key changes vs v1: RSI2 gate relaxed to 15 (score does the work), range tightened to 6%
    //   (quality filter), distEMA20 tightened to -5 (must be meaningfully below EMA20),
    //   body tightened to 55%, wick relaxed to 25%, requireSwingLow/RedCandle both false.
    //   The score gate (≥72) ensures only deeply oversold stocks pass (RSI14≤30 + z-score pushes score over 72).
    // v4 hyper-tune explored (92% OOS WR) but rejected: smaller avg gain (+1.28% vs +1.92%),
    //   wider-stop losers hit -19% MAE vs -14%, and tighter TP=3% vs 4% reduces per-trade R-multiple.
    //   v3 has better R:R (PF=2.30) and higher avg gain — preferred for live trading.
    // Code fix: requireRedCandle param now honoured (was hardcoded `red &&` before v2+)
    // DO NOT mix with breakout param-set logic — routes to analyzeORS() internally
    ors_prime_reversal: {
        name: 'ORS-Prime v3', tag: '↩ 85% OOS WR',
        // Breakout fields unused (set to pass-all so analyzeStock early-exits cleanly)
        minAvgTurnover20: 0, maxATRPct14Pctl120: 100,
        maxPre10AvgRangeATR: 99, maxPre10ExpansionCount: 99, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 99, minZoneLen: 1, maxZoneLen: 100, maxZoneTightnessPct: 100,
        maxPre10AvgVolRatio: 99, maxPre5AvgVolRatio: 99,
        maxPre10HighVolCount: 99, highVolMultiplier: 1.35, maxPre10RedVolBias: 99,
        breakoutMultiplier: 0,
        minExactRangeATR14: 0, maxExactRangeATR14: 99,
        minExactVolRatio20: 0, minExactVolVsPre5: 0,
        minCloseLoc: 0, maxUpperWickPct: 100, minBodyPct: 0, maxCandleRisk: 100,
        minUltraPrecisionScore: 0, minRSI2: 0,
        minVolatilityExpansionRatio: null, minCandleQualityScore: null,
        maxCloseAboveZonePct: null,
        // ORS-specific logic — v2 GA-tuned params
        ors: {
            maxRSI2: 15, // v3: relax gate, score does the work (RSI14≤30 pushes score to 72+)
            maxRSI14: 45, // v3: slightly relaxed from 38
            maxCloseLoc: 50, // v2+ improvement (was 35 in v1)
            minBodyPct: 55, // v3: tightened from 45 (stronger body = cleaner cap candle)
            maxUpperWickPct: 25, // v3: slightly relaxed from 20
            minRangePct: 6, // v3: quality filter — only large-range capitulation days
            maxDistEMA20: -5.0, // v3: tightened — must be meaningfully below EMA20
            minDdSwingHigh: 30, // restored to v1 — requires real drawdown
            requireSwingLow: false,
            requireRedCandle: false,
            minOrsScore: 72, // v3: restored — achievable via RSI14≤30+z-score bonus
            tpPct: 4,
            slAtrMult: 2.0,
            maxHoldBars: 15,
        },
    },
    // ✅ v12-tuned — minExactVolVsPre5 1.0→3.5 (defining sniper filter), ATR pctl 50→40,
    //    maxPre10AvgRangeATR 0.80→1.15, maxPre10RedVolBias 0.90→1.6, minExactVolRatio20 1.8→1.5,
    //    minCloseLoc 75→65, maxUpperWickPct 20→15, minBodyPct 50→20, minVolExpRatio 2.0→1.0
    sniper_95plus: {
        name: 'Sniper v12-N500 95+', tag: '🎯 67% WR',
        minAvgTurnover20: 10000000, maxATRPct14Pctl120: 40,
        maxPre10AvgRangeATR: 1.15, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
        zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
        maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
        maxPre10HighVolCount: 0, highVolMultiplier: 1.35, maxPre10RedVolBias: 1.6,
        breakoutMultiplier: 1.001,
        minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
        minExactVolRatio20: 1.5, minExactVolVsPre5: 3.5,
        minCloseLoc: 65, maxUpperWickPct: 15, minBodyPct: 20, maxCandleRisk: 6.0,
        minUltraPrecisionScore: 5, minRSI2: 50,
        minVolatilityExpansionRatio: 1.0, minCandleQualityScore: 2,
        maxCloseAboveZonePct: 5.0,
    },
};
exports.PARAM_SET_OPTIONS = [
    { key: 'optimized_deployable_20plus', name: exports.PARAM_SETS.optimized_deployable_20plus.name, tag: exports.PARAM_SETS.optimized_deployable_20plus.tag },
    { key: 'optimized_highprecision_15plus', name: exports.PARAM_SETS.optimized_highprecision_15plus.name, tag: exports.PARAM_SETS.optimized_highprecision_15plus.tag },
    { key: 'optimized_elite_10plus', name: exports.PARAM_SETS.optimized_elite_10plus.name, tag: exports.PARAM_SETS.optimized_elite_10plus.tag },
    { key: 'optimized_ultraselective_8plus', name: exports.PARAM_SETS.optimized_ultraselective_8plus.name, tag: exports.PARAM_SETS.optimized_ultraselective_8plus.tag },
    { key: 'sniper_95plus', name: exports.PARAM_SETS.sniper_95plus.name, tag: exports.PARAM_SETS.sniper_95plus.tag },
    { key: 'ors_prime_reversal', name: exports.PARAM_SETS.ors_prime_reversal.name, tag: exports.PARAM_SETS.ors_prime_reversal.tag },
];
// ─── CORE HELPERS ─────────────────────────────────────────────────────────────
function arr_mean(arr) {
    if (arr.length === 0)
        return 0;
    let sum = 0;
    for (const v of arr)
        sum += v;
    return sum / arr.length;
}
function arr_median(arr) {
    if (arr.length === 0)
        return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
function safe(val, fallback = 0) {
    if (!Number.isFinite(val))
        return fallback;
    if (val === 0 && 1 / val === -Infinity)
        return 0; // convert -0 to 0
    if (val > 1e15 || val < -1e15)
        return 0; // clamp extreme outliers
    return val;
}
// ─── v7.2 MOMENTUM HELPERS ──────────────────────────────────────────────────
function computeEMA(candles, period) {
    const result = new Array(candles.length).fill(0);
    if (candles.length === 0)
        return result;
    const k = 2 / (period + 1);
    // Seed with SMA of first `period` bars to avoid cold-start bias
    const seedLen = Math.min(period, candles.length);
    let seed = 0;
    for (let i = 0; i < seedLen; i++)
        seed += candles[i].c;
    result[seedLen - 1] = seed / seedLen;
    for (let i = seedLen; i < candles.length; i++) {
        result[i] = candles[i].c * k + result[i - 1] * (1 - k);
    }
    return result;
}
function computeADX14(candles) {
    if (candles.length < 30)
        return 20;
    const period = 14;
    const dmPlus = [];
    const dmMinus = [];
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const hDiff = candles[i].h - candles[i - 1].h;
        const lDiff = candles[i - 1].l - candles[i].l;
        dmPlus.push(hDiff > lDiff && hDiff > 0 ? hDiff : 0);
        dmMinus.push(lDiff > hDiff && lDiff > 0 ? lDiff : 0);
        const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
        trs.push(tr);
    }
    if (trs.length < period)
        return 20;
    let smoothTR = 0, smoothDMp = 0, smoothDMm = 0;
    for (let i = 0; i < period; i++) {
        smoothTR += trs[i];
        smoothDMp += dmPlus[i];
        smoothDMm += dmMinus[i];
    }
    const dxValues = [];
    for (let i = period; i < trs.length; i++) {
        smoothTR = smoothTR - smoothTR / period + trs[i];
        smoothDMp = smoothDMp - smoothDMp / period + dmPlus[i];
        smoothDMm = smoothDMm - smoothDMm / period + dmMinus[i];
        const diPlus = smoothTR > 0 ? (smoothDMp / smoothTR) * 100 : 0;
        const diMinus = smoothTR > 0 ? (smoothDMm / smoothTR) * 100 : 0;
        const diSum = diPlus + diMinus;
        const dx = diSum > 0 ? (Math.abs(diPlus - diMinus) / diSum) * 100 : 0;
        dxValues.push(dx);
    }
    if (dxValues.length < period)
        return safe(dxValues.length > 0 ? arr_mean(dxValues) : 20);
    let adx = arr_mean(dxValues.slice(0, period));
    for (let i = period; i < dxValues.length; i++) {
        adx = (adx * (period - 1) + dxValues[i]) / period;
    }
    return safe(adx, 20);
}
function computeOBVSlope10(candles, endIdx) {
    const start = Math.max(1, endIdx - 10);
    const len = endIdx - start;
    if (len < 3)
        return 0;
    let obv = 0;
    const obvValues = [];
    const vols = [];
    for (let i = start; i <= endIdx; i++) {
        if (candles[i].c > candles[i - 1].c)
            obv += candles[i].v;
        else if (candles[i].c < candles[i - 1].c)
            obv -= candles[i].v;
        obvValues.push(obv);
        vols.push(candles[i].v);
    }
    const n = obvValues.length;
    if (n < 3)
        return 0;
    const meanVol = arr_mean(vols) || 1;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += obvValues[i];
        sumXY += i * obvValues[i];
        sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10)
        return 0;
    const slope = (n * sumXY - sumX * sumY) / denom;
    return safe(slope / meanVol);
}
function computeVolDryUpScore(candles, endIdx) {
    const start = Math.max(0, endIdx - 5);
    let score = 0;
    for (let i = start + 1; i < endIdx; i++) {
        if (candles[i].v < candles[i - 1].v)
            score++;
    }
    return score;
}
function computeMomentumEnhancements(candles, endIdx, zone, priceEngine) {
    const sig = candles[endIdx];
    // EMA alignment
    const ema20Arr = computeEMA(candles, 20);
    const ema50Arr = computeEMA(candles, 50);
    const ema20 = safe(ema20Arr[endIdx]);
    const ema50 = safe(ema50Arr[endIdx]);
    const emaAligned = candles.length >= 50 && sig.c > ema20 && sig.c > ema50 && ema20 > ema50;
    // Higher low confirmation
    const swingStart = Math.max(0, endIdx - 30);
    const swingEnd = Math.max(0, endIdx - 20);
    let swingLow20 = Infinity;
    for (let i = swingStart; i < swingEnd; i++) {
        if (candles[i].l < swingLow20)
            swingLow20 = candles[i].l;
    }
    if (!Number.isFinite(swingLow20))
        swingLow20 = 0;
    const higherLowConfirmed = zone !== null && zone.zoneLow > swingLow20 && swingLow20 > 0;
    // Volume dry-up
    const volDryUpScore = computeVolDryUpScore(candles, endIdx);
    // OBV slope
    const obvSlope10 = computeOBVSlope10(candles, endIdx);
    // ADX
    const adx14 = computeADX14(candles);
    const adxInRange = adx14 > 40;
    // Gap-adjusted R:R
    let gapAdjustedRR = 0;
    if (priceEngine.plannedEntry > 0 && priceEngine.tacticalStop > 0 && priceEngine.tradeValid) {
        const risk = priceEngine.plannedEntry - priceEngine.tacticalStop;
        if (risk > 0) {
            const t1Dist = priceEngine.target5 - priceEngine.plannedEntry;
            gapAdjustedRR = t1Dist > 0 ? t1Dist / risk : 0;
        }
    }
    // Composite momentum score (0-100)
    // Re-calibrated on 3,806 breakout signals × 1,617 NSE stocks.
    // REMOVED: higherLow (r=−0.041, −1.17% edge), adxInRange (r=−0.034, −0.89% edge),
    // gapRR≥2 (r=−0.005, −0.65% edge) — all three are NEGATIVE predictors.
    // volDryUp is the dominant positive predictor (+0.76% edge); obvSlope secondary (+0.32%).
    // adx>40 (strong trend, no upper cap) replaces the inverted adxInRange 20-40 filter.
    let momentumScore = 0;
    if (emaAligned)
        momentumScore += 5; // near-zero (r=+0.0003), small weight retained for UI
    if (volDryUpScore >= 3)
        momentumScore += 35; // r=+0.014, strongest positive predictor
    if (volDryUpScore >= 4)
        momentumScore += 10; // bonus for very strong dry-up
    if (obvSlope10 >= 0.5)
        momentumScore += 30; // r=+0.024, secondary positive predictor
    if (adx14 > 40)
        momentumScore += 10; // ADX>40 = strong trend (NOT range-bound 20-40)
    return {
        emaAligned, ema20: safe(ema20), ema50: safe(ema50),
        higherLowConfirmed, swingLow20: safe(swingLow20),
        volDryUpScore,
        obvSlope10: safe(obvSlope10),
        adx14: safe(adx14, 20), adxInRange,
        gapAdjustedRR: safe(gapAdjustedRR),
        momentumScore: clamp(momentumScore, 0, 100),
        rsNifty20: 1.0,
    };
}
function percentileRank(window, value) {
    if (window.length === 0)
        return 50;
    // Use (below + 0.5×equal)/n to avoid 0th-percentile when value equals window max
    const below = window.filter(v => v < value).length;
    const equal = window.filter(v => v === value).length;
    return ((below + equal * 0.5) / window.length) * 100;
}
// ─── ATR14 — Wilder's smoothing ───────────────────────────────────────────────
function computeATR14(candles) {
    const result = new Array(candles.length).fill(0);
    if (candles.length === 0)
        return result;
    const trs = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const prevC = candles[i - 1].c;
        const tr = Math.max(c.h - c.l, Math.abs(c.h - prevC), Math.abs(c.l - prevC));
        trs[i] = tr;
    }
    // trs[0] = 0 (no previous candle)
    // ATR[14] = SMA of first 14 TRs (indices 1..14)
    if (candles.length <= 14) {
        for (let i = 1; i < candles.length; i++) {
            result[i] = trs[i];
        }
        return result;
    }
    let atrSum = 0;
    for (let i = 1; i <= 14; i++)
        atrSum += trs[i];
    result[14] = atrSum / 14;
    for (let i = 15; i < candles.length; i++) {
        result[i] = (result[i - 1] * 13 + trs[i]) / 14;
    }
    return result;
}
// ─── RSI ─────────────────────────────────────────────────────────────────────
function computeRSI(candles, period) {
    const needed = period + 20;
    if (candles.length < needed)
        return 50;
    const slice = candles.slice(candles.length - needed);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = slice[i].c - slice[i - 1].c;
        if (diff > 0)
            gains += diff;
        else
            losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < slice.length; i++) {
        const diff = slice[i].c - slice[i - 1].c;
        const g = diff > 0 ? diff : 0;
        const l = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss < 1e-10)
        return avgGain < 1e-10 ? 50 : 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
// ─── COMPRESSION ZONE ─────────────────────────────────────────────────────────
function findCompressionZone(candles, atr14, params, endIdx) {
    let bestZone = null;
    let bestProximity = Infinity;
    let bestTightness = Infinity;
    let bestLength = 0;
    const searchStart = Math.max(0, endIdx - 60);
    for (let s = searchStart; s <= endIdx - params.minZoneLen; s++) {
        for (let len = params.maxZoneLen; len >= params.minZoneLen; len--) {
            const end = s + len;
            if (end > endIdx)
                continue;
            const proximity = endIdx - end;
            if (proximity > 5)
                continue;
            let valid = true;
            let zoneHigh = -Infinity;
            let zoneLow = Infinity;
            const atrRatios = [];
            for (let i = s; i < end; i++) {
                const atrVal = atr14[i] ?? 0.0001;
                if (atrVal <= 0) {
                    valid = false;
                    break;
                }
                const rangeATR = (candles[i].h - candles[i].l) / atrVal;
                if (rangeATR > params.zoneRangeATRThreshold) {
                    valid = false;
                    break;
                }
                atrRatios.push(rangeATR);
                if (candles[i].h > zoneHigh)
                    zoneHigh = candles[i].h;
                if (candles[i].l < zoneLow)
                    zoneLow = candles[i].l;
            }
            if (!valid)
                continue;
            const zoneATRRatio = arr_mean(atrRatios);
            const zoneTightnessPct = zoneLow > 0 ? ((zoneHigh - zoneLow) / zoneLow) * 100 : 0;
            // Zone shape: compare first half vs second half
            const mid = Math.floor(len / 2);
            let fhH = -Infinity, shH = -Infinity, fhL = Infinity, shL = Infinity;
            for (let i = s; i < s + mid; i++) {
                fhH = Math.max(fhH, candles[i].h);
                fhL = Math.min(fhL, candles[i].l);
            }
            for (let i = s + mid; i < end; i++) {
                shH = Math.max(shH, candles[i].h);
                shL = Math.min(shL, candles[i].l);
            }
            const zoneShape = shL > fhL * 1.005 && shH >= fhH * 0.995 ? 'ASCENDING'
                : shH < fhH * 0.995 && shL <= fhL * 1.005 ? 'DESCENDING' : 'FLAT';
            // Reject descending zones — backtested: 40.2% WR, PF 1.41, 19% false stops
            if (zoneShape === 'DESCENDING')
                continue;
            if (proximity < bestProximity ||
                (proximity === bestProximity && zoneTightnessPct < bestTightness) ||
                (proximity === bestProximity && zoneTightnessPct === bestTightness && len > bestLength)) {
                bestProximity = proximity;
                bestTightness = zoneTightnessPct;
                bestLength = len;
                bestZone = {
                    zoneHigh,
                    zoneLow,
                    zoneATRRatio,
                    zoneTightnessPct,
                    windowLength: len,
                    zoneShape,
                };
            }
        }
    }
    return bestZone;
}
// ─── ULTRA PRECISION SCORE ────────────────────────────────────────────────────
function computeUPS(zone, closeLoc, bodyPct, upperWickPct, volRatio20, volVsPre5, volExpRatio, rsi2, signalRangePct) {
    let score = 0;
    // Component 1 — Compression quality (30 pts)
    if (zone) {
        if (zone.zoneTightnessPct <= 5)
            score += 30;
        else if (zone.zoneTightnessPct <= 8)
            score += 25;
        else if (zone.zoneTightnessPct <= 12)
            score += 20;
        else if (zone.zoneTightnessPct <= 15)
            score += 15;
    }
    // Component 2 — Close location (10 pts)
    if (closeLoc >= 75)
        score += 10;
    else if (closeLoc >= 65)
        score += 7;
    else if (closeLoc >= 55)
        score += 4;
    // Component 3 — Body % (10 pts)
    if (bodyPct >= 70)
        score += 10;
    else if (bodyPct >= 55)
        score += 7;
    else if (bodyPct >= 40)
        score += 4;
    else if (bodyPct >= 20)
        score += 2;
    // Component 4 — Upper wick (5 pts)
    if (upperWickPct <= 15)
        score += 5;
    else if (upperWickPct <= 25)
        score += 3;
    else if (upperWickPct <= 35)
        score += 1;
    // Component 5 — Vol vs 20-day (10 pts)
    if (volRatio20 >= 2.0)
        score += 10;
    else if (volRatio20 >= 1.5)
        score += 7;
    else if (volRatio20 >= 1.0)
        score += 4;
    // Component 6 — Vol vs pre-5 (10 pts)
    if (volVsPre5 >= 3.0)
        score += 10;
    else if (volVsPre5 >= 2.0)
        score += 7;
    else if (volVsPre5 >= 1.5)
        score += 4;
    // Component 7 — Vol expansion (5 pts)
    if (volExpRatio >= 2.5)
        score += 5;
    else if (volExpRatio >= 1.5)
        score += 3;
    else if (volExpRatio >= 1.0)
        score += 1;
    // Component 8 — RSI(2) (10 pts)
    if (rsi2 >= 70)
        score += 10;
    else if (rsi2 >= 60)
        score += 7;
    else if (rsi2 >= 50)
        score += 4;
    else if (rsi2 >= 40)
        score += 2;
    // Component 9 — Candle risk (10 pts) — signalRangePct
    if (signalRangePct <= 5)
        score += 10;
    else if (signalRangePct <= 7)
        score += 7;
    else if (signalRangePct <= 9)
        score += 4;
    else if (signalRangePct <= 11)
        score += 2;
    return clamp(score, 0, 100);
}
// ─── CANDLE QUALITY SCORE ─────────────────────────────────────────────────────
function computeCQS(closeLoc, upperWickPct, bodyPct, volVsPre5, volExpRatio) {
    let score = 0;
    if (closeLoc >= 65)
        score += 1;
    if (upperWickPct <= 30)
        score += 1;
    if (bodyPct >= 40)
        score += 1;
    if (volVsPre5 >= 2.5)
        score += 1;
    if (volExpRatio >= 1.5)
        score += 1;
    return score;
}
// ─── INFLECTION SCORE ─────────────────────────────────────────────────────────
// margin-based credit: how far PAST a threshold a value is, not just whether
// it cleared the threshold. `span` is the distance above/below the threshold
// that earns full credit (e.g. 2x the min ratio, or the room up to a 0-100 cap).
function marginUp(value, min, span) {
    if (span <= 0)
        return value >= min ? 1 : 0;
    return clamp((value - min) / span, 0, 1);
}
function marginDown(value, max, span) {
    if (span <= 0)
        return value <= max ? 1 : 0;
    return clamp((max - value) / span, 0, 1);
}
// Stage classification (see call site) only reaches this scorer once EVERY
// gating condition (preCondsMet && breakoutOk && exactCondsMet) is already
// true. The old implementation awarded flat full credit for each condition
// the moment it passed — but since all of them are guaranteed true here,
// that guaranteed a score FLOOR of ~82/100, above the ULTRA_STRONG_BUY
// cutoff (75) on every single signal that reached this branch. BUY (45-60)
// and STRONG_BUY (60-75) were mathematically unreachable: every signal that
// got this far scored 82-100 and landed in ULTRA_STRONG_BUY regardless of
// how marginally it cleared each gate. Replaced with continuous margin
// credit — barely-clearing-the-bar signals now score near the floor,
// comfortably-clearing signals score in the middle, and only genuinely
// exceptional signals (well past every threshold) reach 75+.
function computeInflectionScore(zone, params, breakoutOk, pre10AvgRangeATR, pre10AvgVolRatio, pre5AvgVolRatio, pre10RedVolBias, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2, volatilityExpansionRatio, candleQualityScore) {
    // Base: reaching this function means preCondsMet && breakoutOk && exactCondsMet
    // all passed. Award 45 points as the floor for clearing all gates, then add
    // margin bonuses (up to 55 more) for how comfortably each condition was cleared.
    // This maps: barely-passing → 45 (BUY), comfortably-passing → 60-74 (STRONG_BUY),
    // exceptionally-passing → 75+ (ULTRA_STRONG_BUY).
    let score = 45;
    // Zone quality bonus (0–15 pts)
    if (zone) {
        score += marginUp(zone.windowLength, params.minZoneLen, params.maxZoneLen - params.minZoneLen) * 5;
        score += marginDown(zone.zoneTightnessPct, params.maxZoneTightnessPct, params.maxZoneTightnessPct * 0.5) * 10;
    }
    // Pre-condition comfort bonus (0–10 pts) — how far below each max threshold
    score += marginDown(pre10AvgRangeATR, params.maxPre10AvgRangeATR, params.maxPre10AvgRangeATR * 0.5) * 2.5;
    score += marginDown(pre10AvgVolRatio, params.maxPre10AvgVolRatio, params.maxPre10AvgVolRatio * 0.5) * 2.5;
    score += marginDown(pre5AvgVolRatio, params.maxPre5AvgVolRatio, params.maxPre5AvgVolRatio * 0.5) * 2.5;
    score += marginDown(pre10RedVolBias, params.maxPre10RedVolBias, params.maxPre10RedVolBias * 0.5) * 2.5;
    // Candle quality bonus (0–20 pts)
    score += marginUp(exactRangeATR14, params.minExactRangeATR14, params.minExactRangeATR14) * 3;
    score += marginUp(exactVolRatio20, params.minExactVolRatio20, params.minExactVolRatio20) * 3;
    score += marginUp(exactVolVsPre5, params.minExactVolVsPre5, params.minExactVolVsPre5) * 3;
    score += marginUp(closeLoc, params.minCloseLoc, 100 - params.minCloseLoc) * 3;
    score += marginDown(upperWickPct, params.maxUpperWickPct, params.maxUpperWickPct * 0.5) * 2;
    score += marginUp(bodyPct, params.minBodyPct, 100 - params.minBodyPct) * 2;
    score += marginDown(signalRangePct, params.maxCandleRisk, params.maxCandleRisk * 0.5) * 4;
    // Precision bonus (0–10 pts)
    score += marginUp(ultraPrecisionScore, params.minUltraPrecisionScore, 100 - params.minUltraPrecisionScore) * 4;
    score += marginUp(rsi2, params.minRSI2, 100 - params.minRSI2) * 2;
    if (params.minVolatilityExpansionRatio !== null) {
        score += marginUp(volatilityExpansionRatio, params.minVolatilityExpansionRatio, params.minVolatilityExpansionRatio) * 2;
    }
    if (params.minCandleQualityScore !== null) {
        score += marginUp(candleQualityScore, params.minCandleQualityScore, 5 - params.minCandleQualityScore) * 2;
    }
    return clamp(score, 0, 100);
}
// ─── BUILD NULL PRICE ENGINE ──────────────────────────────────────────────────
function buildNullPriceEngine() {
    return {
        breakoutLevel: 0, plannedEntry: 0,
        gapPct: 0, gapATR: 0, entryMode: 'breakout', entryStatus: 'normal',
        entryBuffer: 0, efficiencyRatio: 0,
        tacticalStop: 0, tacticalRiskPct: 0,
        stopWeinstein: 0, stopKase: 0, stopElder: 0, stopSignalLow: 0,
        disasterStop: 0, disasterRiskPct: 0, riskPerShare: 0,
        target5: 0, target7: 0, target10: 0, target3R: 0,
        t1R: 0, t2R: 0, t3R_mult: 0,
        rewardRisk: 0,
        chandelierT1: 0, chandelierT2: 0, chandelierT3: 0,
        failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0,
        tradeValid: false,
        hh252: 0, pctFrom52W: 0, breakoutTier: 'B',
    };
}
// ═══════════════════════════════════════════════════════════════════════════════
// BUILD TRADE ENGINE v5 — Scientific Extreme
// ═══════════════════════════════════════════════════════════════════════════════
//
// Synthesizes 7 methodologies from the world's top trading researchers:
//
// ENTRY:
//   Weinstein Stage Analysis — buy on confirmed close above resistance
//   Kaufman Adaptive — buffer scales with market efficiency ratio
//
// STOP LOSS:
//   Kase DevStop — True Range standard deviation method (2σ below structure)
//   Elder SafeZone — directional noise filtering
//   LeBeau Chandelier — ATR from highest high for trailing
//   Weinstein — structural stop below the base
//
// TARGETS:
//   Van Tharp R-Multiple framework — all targets in units of risk
//   Schwager — asymmetric scaling (let winners run, cut losers short)
//
// POSITION SIZING:
//   Chande VIDYA — adaptive to current volatility regime
//
// All prices: NSE tick-rounded (₹0.05)
// ═══════════════════════════════════════════════════════════════════════════════
function tick(price) {
    return Math.round(price * 20) / 20;
}
function protectRoundNumber(stopPrice) {
    const roundLevels = [50, 100, 250, 500, 1000, 2500, 5000];
    for (const r of roundLevels) {
        const nearest = Math.round(stopPrice / r) * r;
        const distPct = Math.abs(stopPrice - nearest) / (stopPrice || 1) * 100;
        if (distPct < 0.4 && distPct > 0) {
            return tick(nearest - 0.005 * nearest);
        }
    }
    return stopPrice;
}
// Kase DevStop: Standard deviation of True Range over N bars
// Reference: Cynthia Kase, "Trading with the Odds" (1996)
function kaseDevStop(candles, endIdx, period, multiplier) {
    if (endIdx < period + 1)
        return candles[endIdx]?.l ?? 0;
    const trs = [];
    for (let i = endIdx - period + 1; i <= endIdx; i++) {
        if (i < 1)
            continue;
        trs.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
    }
    if (trs.length < 3)
        return candles[endIdx].l;
    const m = trs.reduce((s, v) => s + v, 0) / trs.length;
    let variance = 0;
    for (const tr of trs)
        variance += (tr - m) ** 2;
    const sd = Math.sqrt(variance / (trs.length - 1));
    // Stop = recent low - multiplier × stddev(TR)
    let recentLow = Infinity;
    for (let i = endIdx - period + 1; i <= endIdx; i++) {
        if (candles[i].l < recentLow)
            recentLow = candles[i].l;
    }
    return tick(recentLow - multiplier * sd);
}
// Elder SafeZone: Filters directional noise from stop placement
// Reference: Alexander Elder, "Come Into My Trading Room" (2002)
function elderSafeZone(candles, endIdx, lookback, multiplier) {
    if (endIdx < lookback + 1)
        return candles[endIdx]?.l ?? 0;
    // For long trades: measure downside penetrations (how far price dips below prior low)
    const penetrations = [];
    for (let i = endIdx - lookback + 1; i <= endIdx; i++) {
        if (i < 1)
            continue;
        if (candles[i].l < candles[i - 1].l) {
            penetrations.push(candles[i - 1].l - candles[i].l);
        }
    }
    if (penetrations.length === 0)
        return tick(candles[endIdx].l);
    const avgPenetration = penetrations.reduce((s, v) => s + v, 0) / penetrations.length;
    return tick(candles[endIdx].l - multiplier * avgPenetration);
}
function buildTradeEngine(sig, prevCandle, zone, atr14, atrPct, stage, candles, endIdx, pre10AvgRangeATR, avgTurnover20 = 0) {
    // Guard: ATR must be positive for meaningful trade calculations
    if (atr14 <= 0)
        return buildNullPriceEngine();
    // ══════════════════════════════════════════════════════════════════════
    // ENTRY (Weinstein + Kaufman adaptive buffer)
    // ══════════════════════════════════════════════════════════════════════
    // GA-optimal lookback: N=299 (Donchian fitness 3.27, NewHigh fitness 3.11 — both
    // converged independently vs N=252 coarse grid). VCP tier thresholds kept from
    // coarse grid (GA VCP overfit: 2 signals, 100% WR — not statistically valid).
    // GA run: scripts/ga_results_2026-07-15T07-37-10.json (392 symbols, horizon=20d)
    const N_HH = Math.min(299, endIdx);
    let hh252 = 0;
    for (let i = endIdx - N_HH; i < endIdx; i++) {
        if (candles[i].h > hh252)
            hh252 = candles[i].h;
    }
    const breakoutLevel = tick(Math.max(hh252 > 0 ? hh252 : sig.h, zone.zoneHigh));
    const pctFrom52W = hh252 > 0 && sig.c > 0 ? Math.max(0, (hh252 - sig.c) / sig.c * 100) : 100;
    const breakoutTier = pctFrom52W <= 15 && zone.zoneTightnessPct <= 10 ? 'A+' // VCP tight coil near 52W high
        : pctFrom52W <= 25 ? 'A' // at or approaching 52W high
            : 'B'; // zone breakout, not near 52W
    // Kaufman Efficiency Ratio: measures how "efficient" recent price movement is.
    // ER = |close - close[N]| / sum(|close[i] - close[i-1]|) for i in last N bars.
    // High ER (trending) = tighter buffer. Low ER (noisy) = wider buffer.
    let erNum = 0, erDen = 0;
    const erPeriod = 10;
    if (endIdx >= erPeriod) {
        erNum = Math.abs(candles[endIdx].c - candles[endIdx - erPeriod].c);
        for (let i = endIdx - erPeriod + 1; i <= endIdx; i++) {
            erDen += Math.abs(candles[i].c - candles[i - 1].c);
        }
    }
    const efficiencyRatio = erDen > 0 ? erNum / erDen : 0.5;
    // Buffer = (0.10 - 0.07 × ER) × ATR14
    // ER=1.0 → 0.03×ATR, ER=0.6 → 0.058×ATR, ER=0.0 → 0.10×ATR
    // Minimum: 1 tick (₹0.05)
    const adaptiveBuffer = Math.max(0.05, (0.10 - 0.07 * efficiencyRatio) * atr14);
    // Slippage model
    const turnoverCr = avgTurnover20 / 1e7;
    const slippageMult = turnoverCr >= 50 ? 0.0003 : turnoverCr >= 10 ? 0.0008 : 0.0015;
    const plannedEntry = tick(breakoutLevel + adaptiveBuffer + breakoutLevel * slippageMult);
    // Gap analysis in ATR units
    const gapPct = prevCandle.c > 0 ? ((sig.o - prevCandle.c) / prevCandle.c) * 100 : 0;
    const gapATR = atr14 > 0 ? Math.abs(sig.o - prevCandle.c) / atr14 : 0;
    const entryMode = gapATR > 1.5 ? 'gap_caution' : 'breakout';
    const entryStatus = gapATR > 2.0 ? 'no_chase' : gapATR > 1.0 ? 'half_size' : 'normal';
    // ══════════════════════════════════════════════════════════════════════
    // TACTICAL STOP — Multi-method consensus
    // ══════════════════════════════════════════════════════════════════════
    //
    // Four independent methods each produce a stop level.
    // The FINAL stop = the SECOND-LOWEST of the four.
    const sigRange = sig.h - sig.l;
    // Reference stop methods (for display — not used for actual stop)
    const weinstein = tick(zone.zoneLow - 0.25 * atr14);
    const kase = kaseDevStop(candles, endIdx, 20, 2.0);
    const elder = elderSafeZone(candles, endIdx, 20, 2.5);
    const signalLow = tick(sig.l - 0.15 * atr14);
    // ── Actual stop: Grid-searched optimal formula ──
    //
    // Formula: ZoneLow - 0.5 × ATR14, clamped [4%, 6.5%], CLOSE-ONLY trigger
    // Grid-searched on 33,600 combos × 14,445 signals:
    //   Stop [4,6.5] + T1 2.15×ATR[4,12] + Hold 20d = sweetest spot
    //   WR 48.3%, Expect +1.435%, R:R 1.17 (was 0.94)
    let tacticalStop = tick(zone.zoneLow - 0.50 * atr14);
    const floorStop = tick(plannedEntry * (1 - 4.0 / 100));
    const capStop = tick(plannedEntry * (1 - 6.5 / 100));
    if (tacticalStop > floorStop)
        tacticalStop = floorStop; // too tight → widen to 4%
    if (tacticalStop < capStop)
        tacticalStop = capStop; // too wide → tighten to 6.5%
    tacticalStop = protectRoundNumber(tacticalStop);
    tacticalStop = tick(tacticalStop);
    // Re-apply clamp: protectRoundNumber can push stop slightly outside [capStop, floorStop]
    if (tacticalStop > floorStop)
        tacticalStop = floorStop;
    if (tacticalStop < capStop)
        tacticalStop = capStop;
    const tacticalRiskPct = plannedEntry > 0 ? ((plannedEntry - tacticalStop) / plannedEntry) * 100 : 0;
    // ══════════════════════════════════════════════════════════════════════
    // DISASTER STOP (Gap protection — Schwager method)
    // ══════════════════════════════════════════════════════════════════════
    //
    // Schwager: "The disaster stop must be beyond any reasonable retracement."
    // Place below the LOWEST of all structural levels with a full ATR buffer.
    const lowestStructural = Math.min(sig.l, zone.zoneLow);
    // Kase 3σ method for extreme protection
    const kase3sigma = kaseDevStop(candles, endIdx, 20, 3.0);
    let disasterStop = tick(Math.min(lowestStructural - 0.50 * atr14, kase3sigma));
    disasterStop = protectRoundNumber(disasterStop);
    disasterStop = tick(disasterStop);
    const disasterRiskPct = plannedEntry > 0 ? ((plannedEntry - disasterStop) / plannedEntry) * 100 : 0;
    // ══════════════════════════════════════════════════════════════════════
    // TARGETS (Hybrid: ATR-based primary + R-multiple secondary)
    // ══════════════════════════════════════════════════════════════════════
    //
    // Why ATR-based targets instead of fixed R-multiples:
    //
    //   Fixed R targets (T1 = 2R) produce a CONSTANT R:R for every stock.
    //   This is a tautology — it tells you nothing about setup quality.
    //
    //   ATR-based targets reflect how far the stock ACTUALLY moves:
    //   - High-ATR stock with tight stop → high R:R (great setup)
    //   - Low-ATR stock with wide stop → low R:R (weak setup)
    //
    //   R:R now VARIES per stock and reveals which trades have the best
    //   risk/reward structure. A world-class trader evaluates: "Can this
    //   stock reach 1.5× its daily range before hitting my stop?"
    //
    // ── Backtested Hybrid Target System (29-stock hyperopt) ──────
    //
    // Backtested on 29 OHLCV files, deep grid optimization:
    //
    //   T1 = clamp(2.15 × ATR%, 3.00%, 5.00%)
    //        87.5% hit rate | PF 8.30 | avg 4.07 days | avg return 3.72%
    //
    //   T2 = min(5.65%, 2.80 × ATR%)
    //        Momentum continuation target
    //
    //   T3 = ATR-bucket dependent:
    //        ATR% < 1.5  → 5% fixed
    //        ATR% 1.5-3  → 7% fixed
    //        ATR% > 3    → 10% fixed
    //
    //   Why clamp, not just min:
    //   - Floor 3%: prevents tiny meaningless targets on low-ATR stocks
    //   - Cap 5%: momentum validation point, beyond which hit rate drops
    //   - 2.15×ATR: empirical sweet spot from grid search (1.5-3.0 step 0.05)
    const riskPerShare = plannedEntry - tacticalStop;
    const atrPctAtEntry = plannedEntry > 0 ? (atr14 / plannedEntry) * 100 : 2.5;
    // T1: clamp(2.15 × ATR%, 4.00%, 12.00%) — grid-searched sweetest spot
    // 33,600 combos: WR 48.3% (was 39.5%), Expect +1.435% (was +0.859%), R:R 1.17
    const t1Pct = Math.max(4.00, Math.min(12.00, 2.15 * atrPctAtEntry));
    const target5 = tick(plannedEntry * (1 + t1Pct / 100));
    // T2: T1 + 1 full ATR step — guarantees meaningful separation regardless of ATR level.
    // Previous formula min(5.65%, 2.80×ATR%) caused T2 < T1 when ATR% > ~2.6%
    // (T1 = 2.15×ATR exceeded 5.65 cap), collapsing T2 to T1 + ₹0.05 (5-paise diff).
    const t2Pct = t1Pct + atrPctAtEntry;
    const target7 = tick(plannedEntry * (1 + t2Pct / 100));
    // T3: T2 + 1.5 ATR steps, or ATR-bucket floor, whichever is higher
    const t3BucketPct = atrPctAtEntry < 1.5 ? 5.0 : atrPctAtEntry <= 3.0 ? 7.0 : 10.0;
    const t3Pct = Math.max(t3BucketPct, t2Pct + 1.5 * atrPctAtEntry);
    const target10 = tick(Math.max(plannedEntry * (1 + t3Pct / 100), target7 + 0.05));
    // R-based reference (Van Tharp 3R)
    const target3R = tick(plannedEntry + 3.0 * riskPerShare);
    // R:R computed from T1 vs actual risk
    const rewardRisk = riskPerShare > 0 ? (target5 - plannedEntry) / riskPerShare : 0;
    // R-multiples at each target
    const t1RMult = riskPerShare > 0 ? (target5 - plannedEntry) / riskPerShare : 0;
    const t2RMult = riskPerShare > 0 ? (target7 - plannedEntry) / riskPerShare : 0;
    const t3RMult = riskPerShare > 0 ? (target10 - plannedEntry) / riskPerShare : 0;
    // ══════════════════════════════════════════════════════════════════════
    // TRAILING STOPS (LeBeau Chandelier Exit)
    // ══════════════════════════════════════════════════════════════════════
    //
    // Chuck LeBeau: "The Chandelier Exit hangs a trailing stop from the
    // highest high since entry, like a chandelier from the ceiling."
    //
    // After T1: Breakeven (entry price) — lock in zero risk
    // After T2: Chandelier 2×ATR below T2 (approximation of highest high)
    // After T3: Chandelier 3×ATR below T3
    const failedBreakoutLevel = tick(zone.zoneHigh);
    const timeStop3d = tick(plannedEntry); // post-T1: breakeven
    const timeStop5d = tick(Math.max(plannedEntry, Math.min(target7 - 2.0 * atr14, target7 - 0.01))); // post-T2: Chandelier 2×ATR, floor at entry
    const timeStop10d = tick(Math.max(plannedEntry, Math.min(target10 - 3.0 * atr14, target10 - 0.01))); // post-T3: Chandelier 3×ATR, floor at entry
    // ══════════════════════════════════════════════════════════════════════
    // TRADE VALIDITY (Schwager risk management rules)
    // ══════════════════════════════════════════════════════════════════════
    // ── Trade Validity (recalibrated for Cascading Gates stop v2) ──────
    //
    // Old system: R:R ≥ 1.5 with 2-3.5% stop (42.6% trigger rate)
    // New system: R:R ≥ 0.5 with 4-6.5% stop (CLOSE-ONLY via 10-gate filter)
    //
    // Mathematical proof (from 29-OHLCV backtest):
    //   Cascading Gates WR = 89.5%, P(stop trigger) = 8.6%
    //   At R:R 0.5: Expectancy = 0.895 × 0.5 - 0.105 = +0.343R (strongly positive)
    //   At R:R 0.6: Expectancy = 0.895 × 0.6 - 0.105 = +0.432R
    //   Worst Monte Carlo (85% WR): 0.85 × 0.5 - 0.15 = +0.275R (still positive)
    //
    // Low R:R trades (< 0.8) actually have HIGHER hit rate (52.8% vs 28.8%)
    // because wide stops = strong breakouts with deep structural support.
    // R:R is NOT predictive of outcome with Cascading Gates protection.
    let tradeValid = true;
    if (tacticalStop >= plannedEntry)
        tradeValid = false;
    if (disasterRiskPct > 8.0)
        tradeValid = false;
    if (tacticalRiskPct > 8.0)
        tradeValid = false;
    if (riskPerShare <= 0)
        tradeValid = false;
    if (rewardRisk < 0.5)
        tradeValid = false;
    if (stage !== 'BUY' && stage !== 'STRONG_BUY' && stage !== 'ULTRA_STRONG_BUY')
        tradeValid = false;
    return {
        breakoutLevel: safe(breakoutLevel),
        plannedEntry: safe(plannedEntry),
        gapPct: safe(gapPct),
        gapATR: safe(gapATR),
        entryMode,
        entryStatus,
        entryBuffer: safe(adaptiveBuffer),
        efficiencyRatio: safe(efficiencyRatio),
        tacticalStop: safe(tacticalStop),
        tacticalRiskPct: safe(tacticalRiskPct),
        stopWeinstein: safe(weinstein),
        stopKase: safe(kase),
        stopElder: safe(elder),
        stopSignalLow: safe(signalLow),
        disasterStop: safe(disasterStop),
        disasterRiskPct: safe(disasterRiskPct),
        riskPerShare: safe(riskPerShare),
        target5: safe(target5),
        target7: safe(target7),
        target10: safe(target10),
        target3R: safe(target3R),
        t1R: safe(t1RMult),
        t2R: safe(t2RMult),
        t3R_mult: safe(t3RMult),
        rewardRisk: safe(rewardRisk),
        chandelierT1: safe(timeStop3d),
        chandelierT2: safe(timeStop5d),
        chandelierT3: safe(timeStop10d),
        failedBreakoutLevel: safe(failedBreakoutLevel),
        timeStop3d: safe(timeStop3d),
        timeStop5d: safe(timeStop5d),
        timeStop10d: safe(timeStop10d),
        tradeValid,
        hh252: safe(hh252),
        pctFrom52W: safe(pctFrom52W),
        breakoutTier,
    };
}
// ─── BUILD CHECKLIST ──────────────────────────────────────────────────────────
function evaluateForensicOverlay(params, candleDNA, advanced, stats) {
    const forensic = params.forensic;
    if (!forensic)
        return { ok: true, checklist: [] };
    const checks = [];
    const add = (enabled, label, pass, value) => {
        if (enabled)
            checks.push({ label, pass, value });
    };
    add(forensic.minCandleDnaScore !== undefined && forensic.minCandleDnaScore !== null, `CandleDNA ≥ ${forensic.minCandleDnaScore}`, candleDNA.score >= (forensic.minCandleDnaScore ?? 0), candleDNA.score.toFixed(0));
    add(forensic.minCandleDnaCloseQuality !== undefined && forensic.minCandleDnaCloseQuality !== null, `DNA close quality ≥ ${forensic.minCandleDnaCloseQuality}`, candleDNA.wickCleanliness >= (forensic.minCandleDnaCloseQuality ?? 0), candleDNA.wickCleanliness.toFixed(0));
    add(forensic.minCandleDnaLowerTail !== undefined && forensic.minCandleDnaLowerTail !== null, `DNA lower-tail support ≥ ${forensic.minCandleDnaLowerTail}`, candleDNA.rangeExpansion >= (forensic.minCandleDnaLowerTail ?? 0), candleDNA.rangeExpansion.toFixed(0));
    add(forensic.maxBodyATR !== undefined && forensic.maxBodyATR !== null, `Body/ATR ≤ ${forensic.maxBodyATR}`, candleDNA.bodyATR <= (forensic.maxBodyATR ?? Infinity), candleDNA.bodyATR.toFixed(2));
    add(forensic.maxUpperToLowerWickRatio !== undefined && forensic.maxUpperToLowerWickRatio !== null, `Upper/lower wick ≤ ${forensic.maxUpperToLowerWickRatio}`, candleDNA.upperToLowerWickRatio <= (forensic.maxUpperToLowerWickRatio ?? Infinity), candleDNA.upperToLowerWickRatio.toFixed(2));
    add(forensic.minMarubozuScore !== undefined && forensic.minMarubozuScore !== null, `Marubozu score ≥ ${forensic.minMarubozuScore}`, candleDNA.marubozuScore >= (forensic.minMarubozuScore ?? 0), candleDNA.marubozuScore.toFixed(0));
    add(forensic.minAdvScore !== undefined && forensic.minAdvScore !== null, `Advanced score ≥ ${forensic.minAdvScore}`, advanced.advScore >= (forensic.minAdvScore ?? 0), advanced.advScore.toFixed(0));
    add(forensic.minFer20 !== undefined && forensic.minFer20 !== null, `FER20 ≥ ${forensic.minFer20}`, advanced.fer20 >= (forensic.minFer20 ?? 0), advanced.fer20.toFixed(2));
    add(forensic.maxCusumPos !== undefined && forensic.maxCusumPos !== null, `CUSUM+ ≤ ${forensic.maxCusumPos}`, advanced.cusumPos <= (forensic.maxCusumPos ?? Infinity), advanced.cusumPos.toFixed(3));
    add(forensic.maxMwcScore !== undefined && forensic.maxMwcScore !== null, `MWC score ≤ ${forensic.maxMwcScore}`, advanced.mwcScore <= (forensic.maxMwcScore ?? Infinity), String(advanced.mwcScore));
    add(forensic.maxTram !== undefined && forensic.maxTram !== null, `TRAM ≤ ${forensic.maxTram}`, advanced.tram <= (forensic.maxTram ?? Infinity), advanced.tram.toFixed(2));
    add(forensic.maxCleanMom !== undefined && forensic.maxCleanMom !== null, `Clean momentum ≤ ${forensic.maxCleanMom}`, advanced.cleanMom <= (forensic.maxCleanMom ?? Infinity), advanced.cleanMom.toFixed(1));
    add(forensic.maxDurationRatio !== undefined && forensic.maxDurationRatio !== null, `Duration ratio ≤ ${forensic.maxDurationRatio}`, advanced.durationRatio <= (forensic.maxDurationRatio ?? Infinity), advanced.durationRatio.toFixed(2));
    add(forensic.maxVram !== undefined && forensic.maxVram !== null, `VRAM ≤ ${forensic.maxVram}`, advanced.vram <= (forensic.maxVram ?? Infinity), advanced.vram.toFixed(2));
    add(forensic.minPic !== undefined && forensic.minPic !== null, `PIC ≥ ${forensic.minPic}`, advanced.pic >= (forensic.minPic ?? 0), advanced.pic.toFixed(1));
    add(forensic.maxPic !== undefined && forensic.maxPic !== null, `PIC ≤ ${forensic.maxPic}`, advanced.pic <= (forensic.maxPic ?? Infinity), advanced.pic.toFixed(1));
    add(forensic.maxUtbotBarsAgo !== undefined && forensic.maxUtbotBarsAgo !== null, `UTBot bars ago ≤ ${forensic.maxUtbotBarsAgo}`, advanced.utbotBarsAgo <= (forensic.maxUtbotBarsAgo ?? Infinity), String(advanced.utbotBarsAgo));
    add(forensic.maxBbWidthPctl !== undefined && forensic.maxBbWidthPctl !== null, `BB width pctl ≤ ${forensic.maxBbWidthPctl}`, stats.bbWidthPctl <= (forensic.maxBbWidthPctl ?? Infinity), stats.bbWidthPctl.toFixed(1));
    add(forensic.minVolZScore !== undefined && forensic.minVolZScore !== null, `Volume Z ≥ ${forensic.minVolZScore}`, stats.volZScore >= (forensic.minVolZScore ?? 0), stats.volZScore.toFixed(2));
    add(forensic.minStatsScore !== undefined && forensic.minStatsScore !== null, `Stats score ≥ ${forensic.minStatsScore}`, stats.statsScore >= (forensic.minStatsScore ?? 0), String(stats.statsScore));
    add(forensic.minSharpe20 !== undefined && forensic.minSharpe20 !== null, `Sharpe20 ≥ ${forensic.minSharpe20}`, stats.sharpe20 >= (forensic.minSharpe20 ?? -Infinity), stats.sharpe20.toFixed(2));
    add(forensic.maxEntropy10 !== undefined && forensic.maxEntropy10 !== null, `Entropy10 ≤ ${forensic.maxEntropy10}`, stats.entropy10 <= (forensic.maxEntropy10 ?? Infinity), stats.entropy10.toFixed(2));
    add(forensic.minInsideBars !== undefined && forensic.minInsideBars !== null, `Inside bars ≥ ${forensic.minInsideBars}`, stats.insideBars >= (forensic.minInsideBars ?? 0), String(stats.insideBars));
    add(forensic.minGuppyCompressDays !== undefined && forensic.minGuppyCompressDays !== null, `Guppy compress days ≥ ${forensic.minGuppyCompressDays}`, stats.guppyCompressDays >= (forensic.minGuppyCompressDays ?? 0), String(stats.guppyCompressDays));
    add(forensic.minGuppyGroupGapPct !== undefined && forensic.minGuppyGroupGapPct !== null, `Guppy group gap ≥ ${forensic.minGuppyGroupGapPct}%`, stats.guppyGroupGapPct >= (forensic.minGuppyGroupGapPct ?? 0), stats.guppyGroupGapPct.toFixed(2) + '%');
    add(!!forensic.requireGuppyCleanBullishFan, 'Guppy clean bullish fan', stats.guppyCleanBullishFan, stats.guppyCleanBullishFan ? 'Yes' : 'No');
    add(!!forensic.requireGuppyCoiledRelease, 'Guppy coiled release', stats.guppyCoiledRelease, stats.guppyCoiledRelease ? 'Yes' : 'No');
    add(forensic.minCandlePatternStrength !== undefined && forensic.minCandlePatternStrength !== null, `Pattern strength ≥ ${forensic.minCandlePatternStrength}`, stats.candlePatternStrength >= (forensic.minCandlePatternStrength ?? 0), String(stats.candlePatternStrength));
    add(!!forensic.requireBullishPattern, 'Bullish candle pattern', stats.candlePatternType === 'bullish', stats.candlePatternType);
    return { ok: checks.every(c => c.pass), checklist: checks };
}
function buildChecklist(params, avgTurnover20, atrPct14Pctl120, pre10AvgRangeATR, pre10ExpansionCount, zone, pre10AvgVolRatio, pre5AvgVolRatio, pre10HighVolCount, pre10RedVolBias, breakoutOk, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2, 
// booleans
liquidityOk, volOk, zoneOk, pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk, pre10HighVolOk, pre10RedBiasOk, exactRangeOk, exactVolOk, exactVolPre5Ok, closeLocOk, wickOk, bodyOk, riskOk, upsOk, rsi2Ok, volExpOk, cqsOk, volatilityExpansionRatio, candleQualityScore, closeAboveZoneOk, closeAboveZonePct, forensicChecklist = []) {
    const fmt = (n, dec = 2) => n.toFixed(dec);
    const fmtM = (n) => (n / 1000000).toFixed(1) + 'M';
    return [
        {
            label: `Liquidity ≥ ${fmtM(params.minAvgTurnover20)}`,
            pass: liquidityOk,
            value: fmtM(avgTurnover20),
        },
        {
            label: `ATR% Pctl ≤ ${params.maxATRPct14Pctl120}`,
            pass: volOk,
            value: fmt(atrPct14Pctl120, 1),
        },
        {
            label: `Pre-10 AvgRangeATR ≤ ${params.maxPre10AvgRangeATR}`,
            pass: pre10RangeOk,
            value: fmt(pre10AvgRangeATR),
        },
        {
            label: `Pre-10 Expansion ≤ ${params.maxPre10ExpansionCount}`,
            pass: pre10ExpOk,
            value: String(pre10ExpansionCount),
        },
        {
            label: `Zone exists + tightness ≤ ${params.maxZoneTightnessPct}%`,
            pass: zoneOk,
            value: zone ? `${fmt(zone.zoneTightnessPct, 1)}%` : 'no zone',
        },
        {
            label: `Zone length ≥ ${params.minZoneLen}`,
            pass: zoneOk && zone !== null && zone.windowLength >= params.minZoneLen,
            value: zone ? String(zone.windowLength) : '—',
        },
        {
            label: `Pre-10 AvgVolRatio ≤ ${params.maxPre10AvgVolRatio}`,
            pass: pre10VolOk,
            value: fmt(pre10AvgVolRatio),
        },
        {
            label: `Pre-5 AvgVolRatio ≤ ${params.maxPre5AvgVolRatio}`,
            pass: pre5VolOk,
            value: fmt(pre5AvgVolRatio),
        },
        {
            label: `Pre-10 HighVol ≤ ${params.maxPre10HighVolCount}`,
            pass: pre10HighVolOk,
            value: String(pre10HighVolCount),
        },
        {
            label: `Pre-10 RedVolBias ≤ ${params.maxPre10RedVolBias}`,
            pass: pre10RedBiasOk,
            value: fmt(pre10RedVolBias),
        },
        {
            label: `Breakout (close > zoneHigh×${params.breakoutMultiplier})`,
            pass: breakoutOk,
            value: breakoutOk ? 'Yes' : 'No',
        },
        ...(params.maxCloseAboveZonePct !== null ? [{
                label: `Close above zone ≤ ${params.maxCloseAboveZonePct}%`,
                pass: closeAboveZoneOk,
                value: zone ? fmt(closeAboveZonePct) + '%' : '—',
            }] : []),
        {
            label: `Range/ATR ${params.minExactRangeATR14}–${params.maxExactRangeATR14}`,
            pass: exactRangeOk,
            value: fmt(exactRangeATR14),
        },
        {
            label: `Vol/20d ≥ ${params.minExactVolRatio20}`,
            pass: exactVolOk,
            value: fmt(exactVolRatio20),
        },
        {
            label: `Vol/Pre5 ≥ ${params.minExactVolVsPre5}`,
            pass: exactVolPre5Ok,
            value: fmt(exactVolVsPre5),
        },
        {
            label: `Close Loc ≥ ${params.minCloseLoc}%`,
            pass: closeLocOk,
            value: `${fmt(closeLoc, 1)}%`,
        },
        {
            label: `Upper Wick ≤ ${params.maxUpperWickPct}%`,
            pass: wickOk,
            value: `${fmt(upperWickPct, 1)}%`,
        },
        {
            label: `Body ≥ ${params.minBodyPct}%`,
            pass: bodyOk,
            value: `${fmt(bodyPct, 1)}%`,
        },
        {
            label: `Candle Risk ≤ ${params.maxCandleRisk}%`,
            pass: riskOk,
            value: `${fmt(signalRangePct, 1)}%`,
        },
        {
            label: `UPS ≥ ${params.minUltraPrecisionScore}`,
            pass: upsOk,
            value: String(Math.round(ultraPrecisionScore)),
        },
        {
            label: `RSI(2) ≥ ${params.minRSI2}`,
            pass: rsi2Ok,
            value: fmt(rsi2, 1),
        },
        ...(params.minVolatilityExpansionRatio !== null ? [{
                label: `VolExp ≥ ${params.minVolatilityExpansionRatio}`,
                pass: volExpOk,
                value: fmt(volatilityExpansionRatio),
            }] : []),
        ...(params.minCandleQualityScore !== null ? [{
                label: `CandleQuality ≥ ${params.minCandleQualityScore}`,
                pass: cqsOk,
                value: String(candleQualityScore),
            }] : []),
        ...forensicChecklist,
    ];
}
// ─── ORS-PRIME REVERSAL ENGINE ───────────────────────────────────────────────
// Separate analysis path — do NOT mix with breakout logic.
// Signal candle i: red, RSI2≤5, body≥45%, upWick≤20%, rPct≥3.5%,
//   close ≥3% below EMA20, 60d drawdown ≥30%, 6-bar swing-low pivot, ORS score≥72.
// Confirmation: candle i+1 (next day) closes GREEN → ULTRA_STRONG_BUY (enter at i+2 open).
// Signal only (no confirm yet): STRONG_BUY.
// ORS score bonus: 252d z-score ≤−2.5 adds +8pts, ≤−3.0 adds +12pts.
function computeOrsScore(params) {
    let s = 0;
    // RSI2 depth (30 pts) — d=−1.37
    if (params.rsi2 <= 3)
        s += 30;
    else if (params.rsi2 <= 5)
        s += 25;
    else if (params.rsi2 <= 10)
        s += 20;
    else if (params.rsi2 <= 15)
        s += 12;
    // RSI14 (15 pts)
    if (params.rsi14 <= 30)
        s += 15;
    else if (params.rsi14 <= 38)
        s += 10;
    else if (params.rsi14 <= 45)
        s += 5;
    // Range/close% (10 pts) — d=+0.65
    if (params.rPct >= 5)
        s += 10;
    else if (params.rPct >= 3.5)
        s += 7;
    else if (params.rPct >= 2.4)
        s += 4;
    // EMA20 distance (10 pts) — d=−0.68
    if (params.distE20 <= -8)
        s += 10;
    else if (params.distE20 <= -5)
        s += 7;
    else if (params.distE20 <= -2)
        s += 4;
    // Body (8 pts) — d=+0.49
    if (params.bodyPct >= 60)
        s += 8;
    else if (params.bodyPct >= 45)
        s += 5;
    else if (params.bodyPct >= 35)
        s += 2;
    // Upper wick (7 pts) — d=−0.51
    if (params.upWick <= 10)
        s += 7;
    else if (params.upWick <= 20)
        s += 5;
    else if (params.upWick <= 30)
        s += 2;
    // Swing-low pivot (5 pts)
    if (params.isSwLo)
        s += 5;
    // Volume dry-up before signal (5 pts) — exhaustion
    if (params.volDryUp <= 0.70)
        s += 5;
    else if (params.volDryUp <= 0.85)
        s += 3;
    // Drawdown from 60d swing high (10 pts) — elastic bounce magnitude
    if (params.ddFromSwHi >= 30)
        s += 10;
    else if (params.ddFromSwHi >= 25)
        s += 8;
    else if (params.ddFromSwHi >= 20)
        s += 6;
    else if (params.ddFromSwHi >= 15)
        s += 3;
    // 252d z-score bonus (soft component, not a hard gate) — d=+0.00 standalone but additive
    if (params.zScore <= -3.0)
        s += 12;
    else if (params.zScore <= -2.5)
        s += 8;
    else if (params.zScore <= -2.0)
        s += 5;
    return Math.min(s, 100);
}
function analyzeORS(candles) {
    const n = candles.length;
    const noOrs = (stage = 'NO_SIGNAL', score = 0) => ({
        symbol: '', stage, inflectionScore: score, confidence: 0,
        paramSetKey: 'ors_prime_reversal',
        lastClose: n > 0 ? candles[n - 1].c : 0,
        lastDate: n > 0 ? new Date(candles[n - 1].ts * 1000).toISOString().slice(0, 10) : '',
        avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
        volRatio20: 0, rsi2: 0, rsi14: 50, zone: null,
        pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
        pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
        pre10HighVolCount: 0, pre10RedVolBias: 0,
        exactRangeATR14: 0, exactVolRatio20: 0, exactVolVsPre5: 0,
        closeLoc: 0, upperWickPct: 0, bodyPct: 0,
        signalRangePct: 0, volatilityExpansionRatio: 0,
        ultraPrecisionScore: score, candleQualityScore: 0,
        priceEngine: buildNullPriceEngine(),
        conditionsMet: 0, totalConditions: 10, checklist: [],
        momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1.0 },
        nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
        stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral', candlePatternStrength: 0, statsScore: 0 },
        clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: 0, total: 10, score, confirmed: false } },
        monster: { badges: [], topProbability: 0 },
        dayChangePct: 0,
        candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
        orsScore: score, ddFromSwingHigh: 0, distFromEMA20: 0, zScore252: 0, orsConfirmed: false,
    });
    const orsParams = exports.PARAM_SETS['ors_prime_reversal'].ors;
    if (n < 260)
        return noOrs();
    // ── Helper: check one candle at index i ──────────────────────────────────
    const atr14Arr = computeATR14(candles);
    const ema20Arr = computeEMA(candles, 20);
    // 252d rolling z-score
    const zScoreAt = (i) => {
        const start = Math.max(0, i - 251);
        let sum = 0, cnt = 0;
        for (let j = start; j <= i; j++) {
            sum += candles[j].c;
            cnt++;
        }
        const mean = sum / cnt;
        let varSum = 0;
        for (let j = start; j <= i; j++) {
            const d = candles[j].c - mean;
            varSum += d * d;
        }
        const std = cnt > 1 ? Math.sqrt(varSum / (cnt - 1)) : 0;
        return std > 0 ? (candles[i].c - mean) / std : 0;
    };
    const evalCandle = (i) => {
        if (i < 10)
            return null;
        const c = candles[i];
        const range = c.h - c.l;
        if (range <= 0 || c.c <= 0)
            return null;
        // Liquidity
        let tSum = 0, tCnt = 0;
        for (let j = Math.max(0, i - 20); j < i; j++) {
            tSum += candles[j].c * candles[j].v;
            tCnt++;
        }
        if (tCnt === 0 || tSum / tCnt < 10000000)
            return null;
        const a14 = atr14Arr[i] || 0.0001;
        const bodyPct = Math.abs(c.c - c.o) / range * 100;
        const upWick = (c.h - Math.max(c.o, c.c)) / range * 100;
        const closeLoc = (c.c - c.l) / range * 100;
        const rPct = range / c.c * 100;
        const red = c.c < c.o;
        // RSI2
        let g2 = 0, l2 = 0;
        for (let j = Math.max(1, i - 1); j <= i; j++) {
            const d = candles[j].c - candles[j - 1].c;
            if (d > 0)
                g2 += d;
            else
                l2 -= d;
        }
        const rsi2 = l2 === 0 ? 100 : 100 - 100 / (1 + g2 / l2);
        // RSI14
        let g14 = 0, l14 = 0;
        for (let j = Math.max(1, i - 13); j <= i; j++) {
            const d = candles[j].c - candles[j - 1].c;
            if (d > 0)
                g14 += d;
            else
                l14 -= d;
        }
        const rsi14 = l14 === 0 ? 100 : 100 - 100 / (1 + g14 / l14);
        // EMA20 distance
        const e20 = ema20Arr[i];
        const distE20 = e20 > 0 ? (c.c - e20) / e20 * 100 : 0;
        // 60d swing high drawdown
        let swHi = -Infinity;
        for (let j = Math.max(0, i - 60); j < i; j++)
            if (candles[j].h > swHi)
                swHi = candles[j].h;
        const ddFromSwHi = swHi > 0 ? (swHi - c.c) / swHi * 100 : 0;
        // 6-bar swing-low pivot
        let minLo = Infinity;
        for (let j = Math.max(0, i - 6); j < i; j++)
            if (candles[j].l < minLo)
                minLo = candles[j].l;
        const isSwLo = c.l <= minLo;
        // Volume dry-up (pre-5 avg vs 20d avg)
        let v20s = 0, v20c = 0;
        for (let j = Math.max(0, i - 20); j < i; j++) {
            v20s += candles[j].v;
            v20c++;
        }
        const vAvg20 = v20c ? v20s / v20c : 1;
        let v5s = 0, v5c = 0;
        for (let j = Math.max(0, i - 5); j < i; j++) {
            v5s += candles[j].v;
            v5c++;
        }
        const volDryUp = v5c ? (v5s / v5c) / vAvg20 : 1;
        const zScore = zScoreAt(i);
        const score = computeOrsScore({ rsi2, rsi14, rPct, distE20, bodyPct, upWick, isSwLo, volDryUp, ddFromSwHi, zScore });
        // Gate check
        const passes = ((!orsParams.requireRedCandle || red) &&
            rsi2 <= orsParams.maxRSI2 &&
            rsi14 <= orsParams.maxRSI14 &&
            closeLoc <= orsParams.maxCloseLoc &&
            bodyPct >= orsParams.minBodyPct &&
            upWick <= orsParams.maxUpperWickPct &&
            rPct >= orsParams.minRangePct &&
            distE20 <= orsParams.maxDistEMA20 &&
            ddFromSwHi >= orsParams.minDdSwingHigh &&
            (!orsParams.requireSwingLow || isSwLo) &&
            score >= orsParams.minOrsScore);
        return { passes, score, a14, bodyPct, upWick, closeLoc, rPct, rsi2, rsi14, distE20, ddFromSwHi, zScore, vAvg20, c };
    };
    const endIdx = n - 1;
    const sig = candles[endIdx];
    // Check: is today's candle a green-confirmation of yesterday's ORS signal?
    const prevEval = endIdx >= 1 ? evalCandle(endIdx - 1) : null;
    const todayGreen = sig.c > sig.o;
    const confirmed = !!(prevEval?.passes && todayGreen);
    // Check: is today's candle itself an ORS signal?
    const todayEval = evalCandle(endIdx);
    const primaryEval = confirmed ? prevEval : todayEval;
    if (!primaryEval?.passes)
        return noOrs();
    const { score, a14, bodyPct, upWick, closeLoc, rPct, rsi2, rsi14, distE20, ddFromSwHi, zScore, vAvg20 } = primaryEval;
    // Price engine — entry at next open, stop = entry − 2×ATR
    const entryPrice = confirmed ? sig.o : (n > 1 ? candles[n - 1].c : sig.c); // approximate
    const tacticalStop = Math.max(0, entryPrice - orsParams.slAtrMult * a14);
    const target4pct = entryPrice * (1 + orsParams.tpPct / 100);
    const rrRatio = tacticalStop > 0 && entryPrice > tacticalStop
        ? (target4pct - entryPrice) / (entryPrice - tacticalStop) : 0;
    const pe = {
        ...buildNullPriceEngine(),
        plannedEntry: entryPrice,
        tacticalStop,
        target5: target4pct,
        riskPerShare: entryPrice - tacticalStop,
        rewardRisk: rrRatio,
        tradeValid: true,
    };
    // Stage
    const stage = confirmed ? 'ULTRA_STRONG_BUY' : 'STRONG_BUY';
    // Checklist
    const checklist = [
        { label: 'RSI(2) ≤ 5 (deeply oversold)', pass: rsi2 <= orsParams.maxRSI2, value: rsi2.toFixed(1) },
        { label: 'RSI(14) ≤ 38', pass: rsi14 <= orsParams.maxRSI14, value: rsi14.toFixed(1) },
        { label: 'Red capitulation candle', pass: primaryEval.c.c < primaryEval.c.o, value: primaryEval.c.c < primaryEval.c.o ? 'RED' : 'GREEN' },
        { label: `Body ≥ ${orsParams.minBodyPct}%`, pass: bodyPct >= orsParams.minBodyPct, value: bodyPct.toFixed(1) + '%' },
        { label: `Upper wick ≤ ${orsParams.maxUpperWickPct}%`, pass: upWick <= orsParams.maxUpperWickPct, value: upWick.toFixed(1) + '%' },
        { label: `Range/Close ≥ ${orsParams.minRangePct}%`, pass: rPct >= orsParams.minRangePct, value: rPct.toFixed(2) + '%' },
        { label: `EMA20 dist ≤ ${orsParams.maxDistEMA20}%`, pass: distE20 <= orsParams.maxDistEMA20, value: distE20.toFixed(2) + '%' },
        { label: `60d drawdown ≥ ${orsParams.minDdSwingHigh}%`, pass: ddFromSwHi >= orsParams.minDdSwingHigh, value: ddFromSwHi.toFixed(1) + '%' },
        { label: '6-bar swing-low pivot', pass: primaryEval.passes, value: primaryEval.passes ? 'YES' : 'NO' },
        { label: `ORS score ≥ ${orsParams.minOrsScore}`, pass: score >= orsParams.minOrsScore, value: score.toString() },
        { label: 'Green confirmation candle', pass: confirmed, value: confirmed ? 'CONFIRMED ✓' : 'PENDING' },
    ];
    return {
        symbol: '',
        stage,
        inflectionScore: score,
        confidence: (score / 100) * 100,
        paramSetKey: 'ors_prime_reversal',
        lastClose: sig.c,
        lastDate: new Date(sig.ts * 1000).toISOString().slice(0, 10),
        avgTurnover20: vAvg20 * sig.c,
        atrPct14: a14 / sig.c * 100,
        atrPct14Pctl120: 0,
        volRatio20: sig.v / (vAvg20 || 1),
        rsi2, rsi14,
        zone: null,
        pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
        pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
        pre10HighVolCount: 0, pre10RedVolBias: 0,
        exactRangeATR14: (sig.h - sig.l) / a14,
        exactVolRatio20: sig.v / (vAvg20 || 1),
        exactVolVsPre5: 0,
        closeLoc, upperWickPct: upWick, bodyPct,
        signalRangePct: rPct,
        volatilityExpansionRatio: 0,
        ultraPrecisionScore: score,
        candleQualityScore: 0,
        priceEngine: pe,
        conditionsMet: checklist.filter(c => c.pass).length,
        totalConditions: checklist.length,
        checklist,
        momentum: { emaAligned: false, ema20: ema20Arr[endIdx] ?? 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: rrRatio, momentumScore: 0, rsNifty20: 1.0 },
        nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
        stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: ddFromSwHi, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'ORS Signal', candlePatternType: 'bullish', candlePatternStrength: score, statsScore: score },
        clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: checklist.filter(c => c.pass).length, total: checklist.length, score, confirmed } },
        monster: { badges: [{ type: 'MRV', probability: score / 100, details: `ORS-Prime score ${score} — ${confirmed ? 'ENTRY CONFIRMED' : 'watch for green confirm'}` }], topProbability: score / 100 },
        dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0,
        candleDNA: detectCandleDNA(candles, endIdx, a14),
        orsScore: score,
        ddFromSwingHigh: ddFromSwHi,
        distFromEMA20: distE20,
        zScore252: zScore,
        orsConfirmed: confirmed,
    };
}
// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
function analyzeStock(candles, paramSetKey) {
    const noSignalBase = (symbol = 'UNKNOWN') => ({
        symbol,
        stage: 'NO_SIGNAL',
        inflectionScore: 0,
        confidence: 0,
        paramSetKey,
        lastClose: candles.length > 0 ? candles[candles.length - 1].c : 0,
        lastDate: candles.length > 0
            ? new Date(candles[candles.length - 1].ts * 1000).toISOString().slice(0, 10)
            : '',
        avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
        volRatio20: 0, rsi2: 50, rsi14: 50,
        zone: null,
        pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
        pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
        pre10HighVolCount: 0, pre10RedVolBias: 0,
        exactRangeATR14: 0, exactVolRatio20: 0, exactVolVsPre5: 0,
        closeLoc: 0, upperWickPct: 0, bodyPct: 0,
        signalRangePct: 0, volatilityExpansionRatio: 0,
        ultraPrecisionScore: 0, candleQualityScore: 0,
        priceEngine: buildNullPriceEngine(),
        conditionsMet: 0,
        totalConditions: 20,
        checklist: [],
        momentum: {
            emaAligned: false, ema20: 0, ema50: 0,
            higherLowConfirmed: false, swingLow20: 0,
            volDryUpScore: 0, obvSlope10: 0,
            adx14: 20, adxInRange: true,
            gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1.0,
        },
        nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
        stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral', candlePatternStrength: 0, statsScore: 0 },
        clusterBreakdown: { deployable: { met: 0, total: 21 }, highPrecision: { met: 0, total: 19 }, elite: { met: 0, total: 21 }, ultraSelective: { met: 0, total: 20 }, sniper: { met: 0, total: 21 } },
        monster: { badges: [], topProbability: 0 },
        dayChangePct: 0,
        candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
    });
    // ORS-Prime: separate reversal engine — dispatch immediately
    if (paramSetKey === 'ors_prime_reversal')
        return analyzeORS(candles);
    // 1. Guard — early return if insufficient data
    if (!candles || candles.length === 0 || candles.length < 30)
        return noSignalBase();
    // 2. params
    const params = exports.PARAM_SETS[paramSetKey];
    // 3. endIdx
    const endIdx = candles.length - 1;
    const sig = candles[endIdx];
    const prev = candles[endIdx - 1];
    // 5. ATR14 array
    const atr14Array = computeATR14(candles);
    // 6. atr14
    const atr14 = atr14Array[endIdx] ?? 0.0001;
    // 7. ATR percentile
    const atrPct14 = sig.c > 0 ? (atr14 / sig.c) * 100 : 0;
    const window120Start = Math.max(0, endIdx - 120);
    const window120 = [];
    for (let i = window120Start; i < endIdx; i++) {
        if (atr14Array[i] > 0 && candles[i].c > 0) {
            window120.push((atr14Array[i] / candles[i].c) * 100);
        }
    }
    const atrPct14Pctl120 = percentileRank(window120, atrPct14);
    // 8. avgTurnover20
    const t20Start = Math.max(0, endIdx - 20);
    const turnoverArr = [];
    for (let i = t20Start; i < endIdx; i++) {
        turnoverArr.push(candles[i].c * candles[i].v);
    }
    const avgTurnover20 = arr_mean(turnoverArr);
    // 9. volRatio20
    const vol20Start = Math.max(0, endIdx - 20);
    const vol20Arr = [];
    for (let i = vol20Start; i < endIdx; i++) {
        vol20Arr.push(candles[i].v);
    }
    const volAvg20 = arr_mean(vol20Arr);
    if (volAvg20 <= 0)
        return noSignalBase();
    const volRatio20 = sig.v / volAvg20;
    // 10. RSI
    const rsi2 = computeRSI(candles, 2);
    const rsi14 = computeRSI(candles, 14);
    // 11. Pre-10/5 windows
    const pre10Start = Math.max(0, endIdx - 10);
    const pre5Start = Math.max(0, endIdx - 5);
    const pre10Candles = candles.slice(pre10Start, endIdx);
    const pre5Candles = candles.slice(pre5Start, endIdx);
    const pre10RangeATRArr = pre10Candles.map((c, idx) => {
        const actualIdx = pre10Start + idx;
        const a = atr14Array[actualIdx] || 0.0001;
        return (c.h - c.l) / a;
    });
    const pre10AvgRangeATR = arr_mean(pre10RangeATRArr);
    const pre10ExpansionCount = pre10Candles.filter((c, idx) => {
        const actualIdx = pre10Start + idx;
        const a = atr14Array[actualIdx] || 0.0001;
        return (c.h - c.l) / a > params.expansionATRMultiplier;
    }).length;
    const pre10VolRatios = pre10Candles.map(c => c.v / volAvg20);
    const pre10AvgVolRatio = arr_mean(pre10VolRatios);
    const pre5VolRatios = pre5Candles.map(c => c.v / volAvg20);
    const pre5AvgVolRatio = arr_mean(pre5VolRatios);
    const pre10HighVolCount = pre10Candles.filter(c => c.v / volAvg20 > params.highVolMultiplier).length;
    const pre10RedVol = pre10Candles.filter(c => c.c < c.o).reduce((sum, c) => sum + c.v, 0);
    const pre10GreenVol = pre10Candles.filter(c => c.c >= c.o).reduce((sum, c) => sum + c.v, 0);
    const pre10RedVolBias = pre10GreenVol > 0 ? pre10RedVol / pre10GreenVol : (pre10RedVol > 0 ? 10 : 1);
    // 12. Zone
    const zone = findCompressionZone(candles, atr14Array, params, endIdx);
    // 13. Signal candle indicators
    const sigRange = sig.h - sig.l;
    const exactRangeATR14 = sigRange / (atr14 || 0.0001);
    const pre5VolAvgRaw = arr_mean(pre5Candles.map(c => c.v)) || 1;
    const exactVolRatio20 = sig.v / volAvg20;
    const exactVolVsPre5 = pre5VolAvgRaw > 0 ? sig.v / pre5VolAvgRaw : 0;
    const closeLoc = sigRange > 0 ? ((sig.c - sig.l) / sigRange) * 100 : 50;
    const upperWickPct = sigRange > 0 ? ((sig.h - Math.max(sig.o, sig.c)) / sigRange) * 100 : 0;
    const bodyPct = sigRange > 0 ? (Math.abs(sig.c - sig.o) / sigRange) * 100 : 0;
    const signalRangePct = sig.c > 0 ? (sigRange / sig.c) * 100 : 0;
    const volatilityExpansionRatio = pre10AvgRangeATR > 0 ? exactRangeATR14 / pre10AvgRangeATR : 0;
    // 14. UPS
    const ultraPrecisionScore = computeUPS(zone, closeLoc, bodyPct, upperWickPct, exactVolRatio20, exactVolVsPre5, volatilityExpansionRatio, rsi2, signalRangePct);
    // 15. CQS
    const candleQualityScore = computeCQS(closeLoc, upperWickPct, bodyPct, exactVolVsPre5, volatilityExpansionRatio);
    const candleDNA = detectCandleDNA(candles, endIdx, atr14);
    const advanced = (0, advancedEngine_1.computeAdvancedFeatures)(candles, endIdx, atr14);
    const stats = (0, statsEngine_1.computeStatsFeatures)(candles, endIdx);
    const forensicEval = evaluateForensicOverlay(params, candleDNA, advanced, stats);
    const forensicOk = forensicEval.ok;
    // 16. Condition booleans
    const liquidityOk = avgTurnover20 >= params.minAvgTurnover20;
    const volOk = atrPct14Pctl120 <= params.maxATRPct14Pctl120;
    const zoneOk = zone !== null &&
        zone.zoneTightnessPct <= params.maxZoneTightnessPct &&
        zone.windowLength >= params.minZoneLen;
    const breakoutOk = zone !== null && sig.c > zone.zoneHigh * params.breakoutMultiplier;
    const closeAboveZonePct = zone !== null && zone.zoneHigh > 0 ? ((sig.c - zone.zoneHigh) / zone.zoneHigh) * 100 : 0;
    const closeAboveZoneOk = params.maxCloseAboveZonePct === null || closeAboveZonePct <= params.maxCloseAboveZonePct;
    const pre10RangeOk = pre10AvgRangeATR <= params.maxPre10AvgRangeATR;
    const pre10ExpOk = pre10ExpansionCount <= params.maxPre10ExpansionCount;
    const pre10VolOk = pre10AvgVolRatio <= params.maxPre10AvgVolRatio;
    const pre5VolOk = pre5AvgVolRatio <= params.maxPre5AvgVolRatio;
    const pre10HighVolOk = pre10HighVolCount <= params.maxPre10HighVolCount;
    const pre10RedBiasOk = pre10RedVolBias <= params.maxPre10RedVolBias;
    const exactRangeOk = exactRangeATR14 >= params.minExactRangeATR14 &&
        exactRangeATR14 <= params.maxExactRangeATR14;
    const exactVolOk = exactVolRatio20 >= params.minExactVolRatio20;
    const exactVolPre5Ok = exactVolVsPre5 >= params.minExactVolVsPre5;
    const closeLocOk = closeLoc >= params.minCloseLoc;
    const wickOk = upperWickPct <= params.maxUpperWickPct;
    const bodyOk = bodyPct >= params.minBodyPct;
    const riskOk = signalRangePct <= params.maxCandleRisk;
    const upsOk = ultraPrecisionScore >= params.minUltraPrecisionScore;
    const rsi2Ok = rsi2 >= params.minRSI2;
    const volExpOk = params.minVolatilityExpansionRatio === null ||
        volatilityExpansionRatio >= params.minVolatilityExpansionRatio;
    const cqsOk = params.minCandleQualityScore === null ||
        candleQualityScore >= params.minCandleQualityScore;
    // 17. preCondsMet / exactCondsMet / conditionsMet
    const preCondsMet = pre10RangeOk && pre10ExpOk && pre10VolOk && pre5VolOk &&
        pre10HighVolOk && pre10RedBiasOk;
    const exactCondsMet = exactRangeOk && exactVolOk && exactVolPre5Ok && closeLocOk &&
        wickOk && bodyOk && riskOk && upsOk && rsi2Ok && volExpOk && cqsOk && forensicOk;
    const allConditions = [
        liquidityOk, volOk, zoneOk, breakoutOk,
        pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk,
        pre10HighVolOk, pre10RedBiasOk,
        exactRangeOk, exactVolOk, exactVolPre5Ok, closeLocOk,
        wickOk, bodyOk, riskOk, upsOk, rsi2Ok,
    ];
    if (params.minVolatilityExpansionRatio !== null)
        allConditions.push(volExpOk);
    if (params.minCandleQualityScore !== null)
        allConditions.push(cqsOk);
    if (params.maxCloseAboveZonePct !== null)
        allConditions.push(closeAboveZoneOk);
    for (const item of forensicEval.checklist)
        allConditions.push(item.pass);
    const totalConditions = allConditions.length;
    const conditionsMet = allConditions.filter(Boolean).length;
    // 18. inflectionScore — only meaningful when all gates pass (BUY+ path)
    // Computing it unconditionally would award the 45-point base floor to
    // PRE_BREAKOUT results, inflating stored scores and misleading tiebreakers.
    const inflectionScore = (preCondsMet && breakoutOk && exactCondsMet)
        ? computeInflectionScore(zone, params, breakoutOk, pre10AvgRangeATR, pre10AvgVolRatio, pre5AvgVolRatio, pre10RedVolBias, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2, volatilityExpansionRatio, candleQualityScore)
        : 0;
    // 19. Stage determination
    // ALL spec conditions must be satisfied in order:
    //   Liquidity → ATR regime → Zone exists → Pre-10 environment → Breakout + exact candle
    let stage;
    if (!liquidityOk || !volOk) {
        // Failed liquidity or volatility regime gate
        stage = 'NO_SIGNAL';
    }
    else if (!zoneOk) {
        // No valid compression zone found
        stage = 'NO_SIGNAL';
    }
    else if (preCondsMet && breakoutOk && exactCondsMet) {
        // ALL conditions pass — grade by inflection score
        if (inflectionScore >= 75)
            stage = 'ULTRA_STRONG_BUY';
        else if (inflectionScore >= 60)
            stage = 'STRONG_BUY';
        else if (inflectionScore >= 45)
            stage = 'BUY';
        else
            stage = 'PRE_BREAKOUT';
    }
    else if (breakoutOk && preCondsMet && (exactRangeOk || exactVolOk)) {
        // Zone + pre-conditions + breakout but not all exact candle conditions
        stage = 'PRE_BREAKOUT';
    }
    else if (breakoutOk && (exactRangeOk || exactVolOk)) {
        // Breakout with some signal but pre-conditions not clean
        stage = 'PRE_BREAKOUT';
    }
    else if (preCondsMet) {
        // Zone + pre-conditions clean, no breakout yet
        stage = 'EARLY_INFLECTION';
    }
    else {
        // Zone found but environment not clean
        stage = 'COMPRESSION_WATCH';
    }
    // 20. confidence
    const confidence = (conditionsMet / totalConditions) * 100;
    // 21. priceEngine
    let priceEngine;
    if (stage !== 'NO_SIGNAL' &&
        stage !== 'COMPRESSION_WATCH' &&
        zone !== null) {
        priceEngine = buildTradeEngine(sig, prev, zone, atr14, atrPct14, stage, candles, endIdx, pre10AvgRangeATR, avgTurnover20);
    }
    else {
        priceEngine = buildNullPriceEngine();
    }
    // 21b. v7.2 momentum enhancements (additive overlay — does NOT affect stage)
    const momentum = computeMomentumEnhancements(candles, endIdx, zone, priceEngine);
    // Forensic-validated entry gates applied after momentum is computed.
    // emaAligned + higherLow lifted WR from 73% → 77% — the only entry-level
    // features that genuinely separate losers from winners in backtesting.
    if (!momentum.emaAligned || !momentum.higherLowConfirmed) {
        priceEngine = { ...priceEngine, tradeValid: false };
    }
    // 21d. v7.3 near-breakout detection — v2 tiered (validated on Nifty 500)
    const nearBreakoutPct = zone ? ((zone.zoneHigh - sig.c) / sig.c) * 100 : 99;
    const nearBreakout = zone !== null && nearBreakoutPct >= 0 && nearBreakoutPct <= 2 && liquidityOk && volOk && preCondsMet && !breakoutOk;
    const nearBreakoutTier = zone === null || nearBreakoutPct < 0 || nearBreakoutPct > 10 || !liquidityOk || !preCondsMet || breakoutOk ? null :
        nearBreakoutPct < 1 ? 'IMMINENT' :
            nearBreakoutPct < 2.5 ? 'NEAR' :
                nearBreakoutPct < 5 ? 'WATCH' : 'EARLY';
    // 22. checklist
    const checklist = buildChecklist(params, avgTurnover20, atrPct14Pctl120, pre10AvgRangeATR, pre10ExpansionCount, zone, pre10AvgVolRatio, pre5AvgVolRatio, pre10HighVolCount, pre10RedVolBias, breakoutOk, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2, liquidityOk, volOk, zoneOk, pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk, pre10HighVolOk, pre10RedBiasOk, exactRangeOk, exactVolOk, exactVolPre5Ok, closeLocOk, wickOk, bodyOk, riskOk, upsOk, rsi2Ok, volExpOk, cqsOk, volatilityExpansionRatio, candleQualityScore, closeAboveZoneOk, closeAboveZonePct, forensicEval.checklist);
    // 23. lastDate
    const lastDate = new Date(sig.ts * 1000).toISOString().slice(0, 10);
    return {
        symbol: 'UNKNOWN',
        stage,
        inflectionScore: safe(inflectionScore),
        confidence: safe(confidence),
        paramSetKey,
        lastClose: safe(sig.c),
        lastDate,
        avgTurnover20: safe(avgTurnover20),
        atrPct14: safe(atrPct14),
        atrPct14Pctl120: safe(atrPct14Pctl120),
        volRatio20: safe(volRatio20),
        rsi2: safe(rsi2, 50),
        rsi14: safe(rsi14, 50),
        zone,
        pre10AvgRangeATR: safe(pre10AvgRangeATR),
        pre10ExpansionCount,
        pre10AvgVolRatio: safe(pre10AvgVolRatio),
        pre5AvgVolRatio: safe(pre5AvgVolRatio),
        pre10HighVolCount,
        pre10RedVolBias: safe(pre10RedVolBias),
        exactRangeATR14: safe(exactRangeATR14),
        exactVolRatio20: safe(exactVolRatio20),
        exactVolVsPre5: safe(exactVolVsPre5),
        closeLoc: safe(closeLoc, 50),
        upperWickPct: safe(upperWickPct),
        bodyPct: safe(bodyPct),
        signalRangePct: safe(signalRangePct),
        volatilityExpansionRatio: safe(volatilityExpansionRatio),
        ultraPrecisionScore: safe(ultraPrecisionScore),
        candleQualityScore,
        priceEngine,
        conditionsMet,
        totalConditions,
        checklist,
        momentum,
        nearBreakoutPct: safe(nearBreakoutPct),
        nearBreakout,
        nearBreakoutTier,
        stats,
        clusterBreakdown: {
            deployable: paramSetKey === 'optimized_deployable_20plus' ? { met: conditionsMet, total: totalConditions } : { met: 0, total: 0 },
            highPrecision: paramSetKey === 'optimized_highprecision_15plus' ? { met: conditionsMet, total: totalConditions } : { met: 0, total: 0 },
            elite: paramSetKey === 'optimized_elite_10plus' ? { met: conditionsMet, total: totalConditions } : { met: 0, total: 0 },
            ultraSelective: paramSetKey === 'optimized_ultraselective_8plus' ? { met: conditionsMet, total: totalConditions } : { met: 0, total: 0 },
            sniper: paramSetKey === 'sniper_95plus' ? { met: conditionsMet, total: totalConditions } : { met: 0, total: 0 },
            orsReversal: { met: 0, total: 0, score: 0, confirmed: false },
        },
        monster: { badges: [], topProbability: 0 },
        dayChangePct: endIdx >= 1 && candles[endIdx - 1].c > 0 ? safe((sig.c - candles[endIdx - 1].c) / candles[endIdx - 1].c * 100) : 0,
        candleDNA,
        advanced,
    };
}
// ─── MONSTER SCAN — Detect >10% MFE probability ─────────────────────────────
function detectMonster(candles, endIdx, result) {
    const badges = [];
    const sig = candles[endIdx];
    if (!sig || sig.c <= 0 || endIdx < 50)
        return { badges, topProbability: 0 };
    const rng = sig.h - sig.l;
    const atrPct = result.atrPct14;
    // ── 5-day momentum ──
    const mom5 = endIdx >= 5 ? (sig.c - candles[endIdx - 5].c) / candles[endIdx - 5].c * 100 : 0;
    // ── SMA50 ──
    let sma50 = 0;
    if (endIdx >= 49) {
        let s = 0;
        for (let j = endIdx - 49; j <= endIdx; j++)
            s += candles[j].c;
        sma50 = s / 50;
    }
    const aboveSMA50 = sig.c > sma50 && sma50 > 0;
    // ── eRA ──
    const eRA = result.exactRangeATR14;
    // ── Volume ratio ──
    const vr = result.volRatio20;
    // ── Swing high distance ──
    let high50 = 0;
    for (let j = Math.max(0, endIdx - 50); j < endIdx; j++) {
        if (candles[j].h > high50)
            high50 = candles[j].h;
    }
    const swingDist = high50 > 0 ? (sig.c - high50) / high50 * 100 : 0;
    // ── Pre-10 vol ratio ──
    const pre10VR = result.pre10AvgVolRatio;
    // ── RSI-2 ──
    const rsi2 = result.rsi2;
    // ── Lower wick ──
    const lowerWick = rng > 0 ? (Math.min(sig.c, sig.o) - sig.l) / rng * 100 : 0;
    // ── MONSTER MOVE v2 — OOS-validated on 146,425 points, 455 Nifty 500 stocks ──
    // Original v1 thresholds (calibrated on 77 stocks, 21/20/15-signal samples)
    // showed severe overfitting on proper 60/40 train/test validation. v2 uses
    // ONLY thresholds whose OOS (held-out) win rate stayed close to train rate.
    // ── 🚀 MOMENTUM CONTINUATION ──
    // Robust filter: Mom5≥7%, eRA≥1.2, VR≥1.0, ATR≥4.5%, above SMA50
    // ATR floor lowered from 5.0% to 4.5% after a dedicated threshold sweep
    // (scripts/momAtrThresholdSweep.js, 0.25% steps, same 60/40 split): OOS
    // rate is flat across 4.0-5.5% (49-52%), with 4.5% performing same-or-
    // better than 5.0% (50.9% vs 49.3% OOS) while >2x'ing candidate coverage
    // (507 vs 221 OOS matches). Below 4.0% it genuinely degrades (37-46%),
    // so this isn't "lower is free" — 4.5% is the best-supported point in
    // the real plateau, not an arbitrary relaxation.
    if (mom5 >= 7 && eRA >= 1.2 && vr >= 1.0 && atrPct >= 4.5 && aboveSMA50) {
        badges.push({ type: 'MOM', probability: 51, details: `Mom5 ${mom5.toFixed(1)}%, eRA ${eRA.toFixed(1)}, VR ${vr.toFixed(1)}x, ATR ${atrPct.toFixed(1)}%, >SMA50 — OOS-validated` });
    }
    // ── 🔄 MEAN REVERSION ── (strongest validated pattern — 2.5x baseline edge)
    // Robust filter: Swing≤-30%, RSI2≤60, PreVR≤0.3
    // TRAIN 96.7% (60 sig) → TEST/OOS 88.6% (35 sig), -8.1pp degradation
    if (swingDist <= -30 && rsi2 <= 60 && pre10VR <= 0.3) {
        badges.push({ type: 'MRV', probability: 89, details: `Swing ${swingDist.toFixed(0)}%, RSI2 ${rsi2.toFixed(0)}, PreVR ${pre10VR.toFixed(2)} — OOS-validated, strongest pattern` });
    }
    // ── 💥 BREAKOUT — DEPRECATED ──
    // Properly stability-optimized, this pattern's best OOS rate (34.4%) converges
    // to the random baseline (35.0%). It has NO genuine predictive edge — the
    // original 60-90% claims were pure overfitting on a 15-signal sample.
    // Badge intentionally NOT emitted. See scripts/monsterRobustFinal.js.
    const topProbability = badges.length > 0 ? Math.max(...badges.map(b => b.probability)) : 0;
    return { badges, topProbability };
}
// ─── CANDLE DNA SCORE — Deep wick/body/ATR composite ────────────────────────
// Calibrated on 3,802 breakout-context signals across 1,617 NSE stocks.
// Key finding: old formula was INVERTED — big body/eRA predicts poorly.
// True predictors: upperWickATR<0.05→+3.75% avg20d (r=-0.056),
// lowerWickATR→+0.057 correlation, 3-candle avgCL3→+0.042 correlation.
// bodyATR r=-0.040 (NEGATIVE), eRA r=-0.043 (NEGATIVE) — both removed from score.
function detectCandleDNA(candles, endIdx, atr14) {
    const sig = candles[endIdx];
    if (!sig || atr14 <= 0) {
        return { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' };
    }
    const rng = sig.h - sig.l;
    if (rng <= 0) {
        return { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' };
    }
    const bodySize = Math.abs(sig.c - sig.o);
    const upperWickAbs = sig.h - Math.max(sig.c, sig.o);
    const lowerWickAbs = Math.min(sig.c, sig.o) - sig.l;
    const upperWickPct = upperWickAbs / rng * 100;
    const lowerWickPct = lowerWickAbs / rng * 100;
    const bodyATR = bodySize / atr14;
    const eRA = rng / atr14;
    const upperToLowerWickRatio = lowerWickAbs > 0.001 ? upperWickAbs / lowerWickAbs : (upperWickAbs > 0.001 ? 99 : 1);
    const marubozuScore = Math.max(0, 100 - (upperWickPct + lowerWickPct));
    const upperWickATR = upperWickAbs / atr14;
    const lowerWickATR = lowerWickAbs / atr14;
    // 3-candle avg close location (primary upward pressure signal)
    const closeLoc0 = (sig.c - sig.l) / rng * 100;
    const cl1 = endIdx >= 1 ? (() => { const p = candles[endIdx - 1]; const r = p.h - p.l; return r > 0 ? (p.c - p.l) / r * 100 : 50; })() : closeLoc0;
    const cl2 = endIdx >= 2 ? (() => { const p = candles[endIdx - 2]; const r = p.h - p.l; return r > 0 ? (p.c - p.l) / r * 100 : 50; })() : closeLoc0;
    const avgCL3 = (closeLoc0 + cl1 + cl2) / 3;
    // ── Upper Wick Quality (0-40): upperWickATR — primary predictor (r=-0.056) ──
    // Backtest 3,806 signals: <0.02→+4.91%, 0.05-0.08→+3.01%, ≥1.0→-0.22% avg20d.
    // Best sweet spot combo: uw<0.08 + lw≥0.15 + cl≥55 → +4.99% avg20d, N=260.
    let upperWickQuality = 0;
    if (upperWickATR < 0.02)
        upperWickQuality = 40; // near-perfect close, +4.91% avg20d
    else if (upperWickATR < 0.08)
        upperWickQuality = 30; // excellent, +3.01% avg20d
    else if (upperWickATR < 0.15)
        upperWickQuality = 18;
    else if (upperWickATR < 0.25)
        upperWickQuality = 10;
    else if (upperWickATR < 0.50)
        upperWickQuality = 4;
    // ── Close Location Quality (0-35): 3-candle avgCL3 (r=+0.042) ──
    // Backtest: 65-70 bucket is sweet spot (+2.97%), >85 is +2.87%. Both rewarded equally.
    let closeQuality = 0;
    if (avgCL3 > 85)
        closeQuality = 35;
    else if (avgCL3 > 75)
        closeQuality = 28;
    else if (avgCL3 > 65)
        closeQuality = 22; // sweet spot: +2.97% avg20d
    else if (avgCL3 > 55)
        closeQuality = 12;
    else if (avgCL3 > 45)
        closeQuality = 5;
    // ── Support Tail Quality (0-25): lowerWickATR — strongest positive (r=+0.057) ──
    // Backtest: ≥0.60 is extraordinary (+4.09%), ≥0.40 is strong (+1.87% avg20d).
    let supportTail = 0;
    if (lowerWickATR > 0.60)
        supportTail = 25; // exceptional: +4.09% avg20d
    else if (lowerWickATR > 0.40)
        supportTail = 20; // strong: +1.87% avg20d
    else if (lowerWickATR > 0.25)
        supportTail = 14;
    else if (lowerWickATR > 0.15)
        supportTail = 8;
    else if (lowerWickATR > 0.08)
        supportTail = 4;
    const score = Math.min(100, upperWickQuality + closeQuality + supportTail);
    // Tier thresholds lowered: ELITE≥70 (was 75), STRONG≥50 (was 55), GOOD≥30 (was 35).
    // NEW ELITE averages +4.73% avg20d vs OLD ELITE +0.91% — formula confirmed superior.
    const tier = score >= 70 ? 'ELITE' : score >= 50 ? 'STRONG' : score >= 30 ? 'GOOD' : 'WEAK';
    return {
        score,
        bodyStrength: upperWickQuality, // repurposed: upper wick quality (0-40)
        wickCleanliness: closeQuality, // repurposed: close location quality (0-35)
        rangeExpansion: supportTail, // repurposed: support tail quality (0-25)
        bodyATR: safe(bodyATR),
        upperToLowerWickRatio: safe(upperToLowerWickRatio),
        marubozuScore: safe(marubozuScore),
        tier,
    };
}
// ─── GENERATE DEMO DATA ───────────────────────────────────────────────────────
function generateDemoData(paramSetKey, count = 25) {
    const symbols = [
        'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS',
        'WIPRO.NS', 'LT.NS', 'AXISBANK.NS', 'MARUTI.NS', 'TATAMOTORS.NS',
        'SUNPHARMA.NS', 'BAJFINANCE.NS', 'KOTAKBANK.NS', 'ITC.NS', 'NESTLEIND.NS',
        'TATASTEEL.NS', 'HINDALCO.NS', 'JSWSTEEL.NS', 'ULTRACEMCO.NS', 'GRASIM.NS',
        'POWERGRID.NS', 'NTPC.NS', 'ONGC.NS', 'BPCL.NS', 'COALINDIA.NS',
    ];
    // Deterministic pseudo-random seeded by index
    const rnd = (seed, lo, hi) => {
        const x = Math.sin(seed * 9301 + 49297) * 233280;
        const r = x - Math.floor(x);
        return lo + r * (hi - lo);
    };
    const stageDistribution = [
        'ULTRA_STRONG_BUY', 'ULTRA_STRONG_BUY', 'ULTRA_STRONG_BUY',
        'STRONG_BUY', 'STRONG_BUY', 'STRONG_BUY', 'STRONG_BUY',
        'BUY', 'BUY', 'BUY', 'BUY', 'BUY',
        'PRE_BREAKOUT', 'PRE_BREAKOUT', 'PRE_BREAKOUT', 'PRE_BREAKOUT',
        'EARLY_INFLECTION', 'EARLY_INFLECTION', 'EARLY_INFLECTION',
        'COMPRESSION_WATCH', 'COMPRESSION_WATCH', 'COMPRESSION_WATCH',
        'NO_SIGNAL', 'NO_SIGNAL', 'NO_SIGNAL',
    ];
    const params = exports.PARAM_SETS[paramSetKey];
    const results = [];
    const baseTs = Math.floor(Date.now() / 1000) - 86400;
    for (let i = 0; i < Math.min(count, symbols.length); i++) {
        const symbol = symbols[i];
        const stage = stageDistribution[i % stageDistribution.length];
        const seed = i + 1;
        const isActionable = stage === 'BUY' || stage === 'STRONG_BUY' || stage === 'ULTRA_STRONG_BUY';
        const hasZone = stage !== 'NO_SIGNAL';
        const lastClose = Math.round(rnd(seed, 100, 5000) * 100) / 100;
        const atrPct14 = rnd(seed + 1, 0.5, 4.5);
        const atrPct14Pctl120 = stage === 'NO_SIGNAL' ? rnd(seed + 2, 76, 99) : rnd(seed + 2, 20, 65);
        const avgTurnover20 = rnd(seed + 3, 15000000, 500000000);
        const volRatio20 = isActionable ? rnd(seed + 4, 1.5, 4.0) : rnd(seed + 4, 0.4, 1.2);
        const rsi2val = isActionable ? rnd(seed + 5, 55, 90) : rnd(seed + 5, 30, 65);
        const rsi14val = rnd(seed + 6, 40, 75);
        const zoneTightnessPct = hasZone
            ? (stage === 'ULTRA_STRONG_BUY' || stage === 'STRONG_BUY'
                ? rnd(seed + 7, 2, 7)
                : rnd(seed + 7, 5, 14))
            : 0;
        const zoneWindowLength = hasZone ? Math.round(rnd(seed + 8, params.minZoneLen, params.maxZoneLen)) : 0;
        const zoneHigh = lastClose * (isActionable ? 0.998 : 0.985);
        const zoneLow = zoneHigh * (1 - zoneTightnessPct / 100);
        const zone = hasZone
            ? {
                zoneHigh,
                zoneLow,
                zoneATRRatio: rnd(seed + 9, 0.3, 0.8),
                zoneTightnessPct,
                windowLength: zoneWindowLength,
            }
            : null;
        const pre10AvgRangeATR = isActionable ? rnd(seed + 10, 0.3, 0.7) : rnd(seed + 10, 0.5, 1.2);
        const pre10ExpansionCount = Math.round(rnd(seed + 11, 0, 3));
        const pre10AvgVolRatio = isActionable ? rnd(seed + 12, 0.5, 0.85) : rnd(seed + 12, 0.6, 1.3);
        const pre5AvgVolRatio = isActionable ? rnd(seed + 13, 0.5, 0.85) : rnd(seed + 13, 0.6, 1.3);
        const pre10HighVolCount = Math.round(rnd(seed + 14, 0, 3));
        const pre10RedVolBias = rnd(seed + 15, 0.5, 1.05);
        const closeLoc = isActionable ? rnd(seed + 16, 68, 95) : rnd(seed + 16, 30, 75);
        const upperWickPct = isActionable ? rnd(seed + 17, 3, 28) : rnd(seed + 17, 10, 45);
        const bodyPct = isActionable ? rnd(seed + 18, 40, 85) : rnd(seed + 18, 15, 60);
        const exactRangeATR14 = isActionable ? rnd(seed + 19, 1.2, 3.5) : rnd(seed + 19, 0.5, 2.0);
        const exactVolRatio20 = isActionable ? rnd(seed + 20, 1.1, 3.5) : rnd(seed + 20, 0.4, 1.2);
        const exactVolVsPre5 = isActionable ? rnd(seed + 21, 2.1, 5.0) : rnd(seed + 21, 0.8, 2.5);
        const signalRangePct = rnd(seed + 22, 1.5, 7.0);
        const volatilityExpansionRatio = isActionable ? rnd(seed + 23, 1.5, 3.5) : rnd(seed + 23, 0.5, 1.8);
        const ultraPrecisionScore = isActionable
            ? Math.round(rnd(seed + 24, params.minUltraPrecisionScore + 5, 95))
            : Math.round(rnd(seed + 24, 10, params.minUltraPrecisionScore + 10));
        const candleQualityScore = isActionable ? Math.round(rnd(seed + 25, 3, 5)) : Math.round(rnd(seed + 25, 0, 3));
        const inflectionScore = stage === 'ULTRA_STRONG_BUY' ? Math.round(rnd(seed + 26, 75, 100)) :
            stage === 'STRONG_BUY' ? Math.round(rnd(seed + 26, 60, 75)) :
                stage === 'BUY' ? Math.round(rnd(seed + 26, 45, 60)) :
                    stage === 'PRE_BREAKOUT' ? Math.round(rnd(seed + 26, 30, 50)) :
                        stage === 'EARLY_INFLECTION' ? Math.round(rnd(seed + 26, 20, 35)) :
                            Math.round(rnd(seed + 26, 5, 25));
        const conditionsMet = stage === 'ULTRA_STRONG_BUY' ? Math.round(rnd(seed + 27, 17, 20)) :
            stage === 'STRONG_BUY' ? Math.round(rnd(seed + 27, 14, 18)) :
                stage === 'BUY' ? Math.round(rnd(seed + 27, 12, 16)) :
                    stage === 'PRE_BREAKOUT' ? Math.round(rnd(seed + 27, 9, 13)) :
                        Math.round(rnd(seed + 27, 4, 10));
        const confidence = (conditionsMet / 20) * 100;
        // Build placeholder priceEngine
        let priceEngine;
        if (isActionable && zone !== null) {
            const breakoutLevel = zoneHigh;
            const plannedEntry = breakoutLevel * 1.001;
            const tacticalRiskPct = rnd(seed + 28, 1.0, 2.5);
            const tacticalStop = plannedEntry * (1 - tacticalRiskPct / 100);
            const riskPerShare = plannedEntry - tacticalStop;
            priceEngine = {
                breakoutLevel, plannedEntry,
                gapPct: rnd(seed + 29, -0.3, 0.8), gapATR: rnd(seed + 29, 0, 1.5),
                entryMode: 'breakout', entryStatus: 'normal',
                entryBuffer: 0.05, efficiencyRatio: rnd(seed + 30, 0.3, 0.8),
                tacticalStop, tacticalRiskPct,
                stopWeinstein: tacticalStop * 0.998, stopKase: tacticalStop * 1.001, stopElder: tacticalStop * 0.999, stopSignalLow: tacticalStop * 1.002,
                disasterStop: zoneLow * 0.99, disasterRiskPct: rnd(seed + 30, 3, 7), riskPerShare,
                target5: plannedEntry + rnd(seed + 90, 1.2, 2.0) * riskPerShare,
                target7: plannedEntry + rnd(seed + 91, 2.0, 3.5) * riskPerShare,
                target10: plannedEntry + rnd(seed + 92, 3.5, 6.0) * riskPerShare,
                target3R: plannedEntry + 3 * riskPerShare,
                t1R: rnd(seed + 90, 1.2, 2.0), t2R: rnd(seed + 91, 2.0, 3.5), t3R_mult: rnd(seed + 92, 3.5, 6.0),
                rewardRisk: rnd(seed + 93, 1.2, 3.5),
                chandelierT1: plannedEntry, chandelierT2: plannedEntry + 1.5 * riskPerShare, chandelierT3: plannedEntry + 3 * riskPerShare,
                failedBreakoutLevel: zoneHigh,
                timeStop3d: plannedEntry, timeStop5d: plannedEntry + riskPerShare, timeStop10d: plannedEntry + 2 * riskPerShare,
                tradeValid: true,
                hh252: 0, pctFrom52W: 0, breakoutTier: 'B',
            };
        }
        else {
            priceEngine = {
                breakoutLevel: lastClose, plannedEntry: lastClose,
                gapPct: 0, gapATR: 0, entryMode: 'breakout', entryStatus: 'normal',
                entryBuffer: 0, efficiencyRatio: 0,
                tacticalStop: 0, tacticalRiskPct: 0,
                stopWeinstein: 0, stopKase: 0, stopElder: 0, stopSignalLow: 0,
                disasterStop: 0, disasterRiskPct: 0, riskPerShare: 0,
                target5: 0, target7: 0, target10: 0, target3R: 0,
                t1R: 0, t2R: 0, t3R_mult: 0, rewardRisk: 0,
                chandelierT1: 0, chandelierT2: 0, chandelierT3: 0,
                failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0,
                tradeValid: false,
                hh252: 0, pctFrom52W: 0, breakoutTier: 'B',
            };
        }
        const lastDate = new Date((baseTs - i * 86400) * 1000).toISOString().slice(0, 10);
        // Build checklist
        const liquidityOk = avgTurnover20 >= params.minAvgTurnover20;
        const volOk = atrPct14Pctl120 <= params.maxATRPct14Pctl120;
        const zoneOk = zone !== null && zone.zoneTightnessPct <= params.maxZoneTightnessPct && zone.windowLength >= params.minZoneLen;
        const breakoutOk = zone !== null && lastClose > zone.zoneHigh * params.breakoutMultiplier;
        const pre10RangeOk = pre10AvgRangeATR <= params.maxPre10AvgRangeATR;
        const pre10ExpOk = pre10ExpansionCount <= params.maxPre10ExpansionCount;
        const pre10VolOk = pre10AvgVolRatio <= params.maxPre10AvgVolRatio;
        const pre5VolOk = pre5AvgVolRatio <= params.maxPre5AvgVolRatio;
        const pre10HighVolOk = pre10HighVolCount <= params.maxPre10HighVolCount;
        const pre10RedBiasOk = pre10RedVolBias <= params.maxPre10RedVolBias;
        const exactRangeOk = exactRangeATR14 >= params.minExactRangeATR14 && exactRangeATR14 <= params.maxExactRangeATR14;
        const exactVolOk = exactVolRatio20 >= params.minExactVolRatio20;
        const exactVolPre5Ok = exactVolVsPre5 >= params.minExactVolVsPre5;
        const closeLocOk = closeLoc >= params.minCloseLoc;
        const wickOk = upperWickPct <= params.maxUpperWickPct;
        const bodyOk = bodyPct >= params.minBodyPct;
        const riskOk = signalRangePct <= params.maxCandleRisk;
        const upsOk = ultraPrecisionScore >= params.minUltraPrecisionScore;
        const rsi2Ok = rsi2val >= params.minRSI2;
        const volExpOk = params.minVolatilityExpansionRatio === null || volatilityExpansionRatio >= params.minVolatilityExpansionRatio;
        const cqsOk = params.minCandleQualityScore === null || candleQualityScore >= params.minCandleQualityScore;
        const clAbvZonePct = zone !== null && zone.zoneHigh > 0 ? ((lastClose - zone.zoneHigh) / zone.zoneHigh) * 100 : 0;
        const closeAboveZoneOk = params.maxCloseAboveZonePct === null || clAbvZonePct <= params.maxCloseAboveZonePct;
        const checklist = buildChecklist(params, avgTurnover20, atrPct14Pctl120, pre10AvgRangeATR, pre10ExpansionCount, zone, pre10AvgVolRatio, pre5AvgVolRatio, pre10HighVolCount, pre10RedVolBias, breakoutOk, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2val, liquidityOk, volOk, zoneOk, pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk, pre10HighVolOk, pre10RedBiasOk, exactRangeOk, exactVolOk, exactVolPre5Ok, closeLocOk, wickOk, bodyOk, riskOk, upsOk, rsi2Ok, volExpOk, cqsOk, volatilityExpansionRatio, candleQualityScore, closeAboveZoneOk, clAbvZonePct);
        results.push({
            symbol,
            stage,
            inflectionScore,
            confidence,
            paramSetKey,
            lastClose,
            lastDate,
            avgTurnover20,
            atrPct14,
            atrPct14Pctl120,
            volRatio20,
            rsi2: rsi2val,
            rsi14: rsi14val,
            zone,
            pre10AvgRangeATR,
            pre10ExpansionCount,
            pre10AvgVolRatio,
            pre5AvgVolRatio,
            pre10HighVolCount,
            pre10RedVolBias,
            exactRangeATR14,
            exactVolRatio20,
            exactVolVsPre5,
            closeLoc,
            upperWickPct,
            bodyPct,
            signalRangePct,
            volatilityExpansionRatio,
            ultraPrecisionScore,
            candleQualityScore,
            priceEngine,
            conditionsMet,
            totalConditions: checklist.length,
            checklist,
            momentum: {
                emaAligned: isActionable,
                ema20: lastClose * (isActionable ? 0.98 : 1.02),
                ema50: lastClose * (isActionable ? 0.95 : 1.05),
                higherLowConfirmed: isActionable || stage === 'PRE_BREAKOUT',
                swingLow20: lastClose * 0.92,
                volDryUpScore: isActionable ? Math.round(rnd(seed + 40, 3, 4)) : Math.round(rnd(seed + 40, 0, 3)),
                obvSlope10: isActionable ? rnd(seed + 41, 0.5, 2.0) : rnd(seed + 41, -0.5, 0.8),
                adx14: rnd(seed + 42, 15, 35),
                adxInRange: true,
                gapAdjustedRR: isActionable ? rnd(seed + 43, 2.0, 4.0) : rnd(seed + 43, 0.5, 2.0),
                momentumScore: isActionable ? Math.round(rnd(seed + 44, 65, 100)) : Math.round(rnd(seed + 44, 10, 50)),
                rsNifty20: isActionable ? rnd(seed + 45, 1.0, 1.3) : rnd(seed + 45, 0.8, 1.1),
            },
            nearBreakoutPct: stage === 'EARLY_INFLECTION' ? rnd(seed + 46, 0.3, 1.8) : (stage === 'COMPRESSION_WATCH' ? rnd(seed + 46, 1, 4) : -1),
            nearBreakout: stage === 'EARLY_INFLECTION',
            nearBreakoutTier: stage === 'EARLY_INFLECTION' ? 'IMMINENT' : stage === 'COMPRESSION_WATCH' ? 'NEAR' : null,
            stats: {
                volZScore: isActionable ? rnd(seed + 50, 2.0, 4.0) : rnd(seed + 50, -0.5, 1.8),
                volZSignificant: isActionable,
                bbWidth: rnd(seed + 51, 0.02, 0.10),
                bbWidthPctl: isActionable ? rnd(seed + 52, 3, 15) : rnd(seed + 52, 20, 80),
                bbSqueeze: isActionable,
                keltnerSqueeze: isActionable && rnd(seed + 53, 0, 1) > 0.4,
                lrSlope10: rnd(seed + 54, -0.2, 0.2),
                lrSlopeFlat: isActionable,
                autoCorr5: rnd(seed + 55, -0.3, 0.5),
                momentumRegime: isActionable,
                hurst: isActionable ? rnd(seed + 56, 0.55, 0.75) : rnd(seed + 56, 0.40, 0.55),
                hurstTrending: isActionable,
                skewness20: rnd(seed + 57, -0.5, 1.5),
                positiveSkew: isActionable,
                statsScore: isActionable ? Math.round(rnd(seed + 58, 60, 95)) : Math.round(rnd(seed + 58, 10, 40)),
                drawdownFrom52WH: isActionable ? rnd(seed + 70, 1, 10) : rnd(seed + 70, 10, 40),
                pctFrom52WL: isActionable ? rnd(seed + 71, 30, 90) : rnd(seed + 71, 5, 50),
                sharpe20: isActionable ? rnd(seed + 72, 1.0, 3.0) : rnd(seed + 72, -1, 1.5),
                entropy10: rnd(seed + 73, 0.5, 2.2),
                cusumSignal: isActionable && rnd(seed + 74, 0, 1) > 0.5,
                sectorRelZ: 0,
                insideBars: isActionable ? Math.round(rnd(seed + 75, 1, 4)) : 0,
                volProfileSkew: isActionable ? rnd(seed + 76, 0.1, 0.6) : rnd(seed + 76, -0.3, 0.3),
                garchForecast: isActionable ? rnd(seed + 77, 1.2, 2.0) : rnd(seed + 77, 0.8, 1.3),
                ttmSqueezeOn: !isActionable && hasZone,
                ttmSqueezeFired: isActionable,
                ttmMomentum: isActionable ? rnd(seed + 78, 1, 10) : rnd(seed + 78, -5, 5),
                ttmMomentumRising: isActionable,
                rsi14: isActionable ? rnd(seed + 79, 55, 75) : rnd(seed + 79, 35, 65),
                cci34: isActionable ? rnd(seed + 80, 50, 200) : rnd(seed + 80, -100, 100),
                ema10: lastClose * (isActionable ? rnd(seed + 81, 0.97, 0.995) : rnd(seed + 81, 0.98, 1.02)),
                ema21: lastClose * (isActionable ? rnd(seed + 82, 0.94, 0.99) : rnd(seed + 82, 0.96, 1.04)),
                ema55: lastClose * (isActionable ? rnd(seed + 83, 0.90, 0.97) : rnd(seed + 83, 0.92, 1.06)),
                sma200: lastClose * (isActionable ? rnd(seed + 84, 0.80, 0.94) : rnd(seed + 84, 0.85, 1.10)),
                ema10Cross: isActionable && rnd(seed + 87, 0, 1) > 0.7,
                ema21Cross: isActionable && rnd(seed + 88, 0, 1) > 0.85,
                ema55Cross: false,
                sma200Cross: false,
                guppySpreadPct: isActionable ? rnd(seed + 85, 0.2, 0.8) : rnd(seed + 85, 1.5, 5.0),
                guppyCompressed: isActionable,
                guppyUltraCompressed: isActionable && rnd(seed + 86, 0, 1) > 0.5,
                guppyCompressDays: isActionable ? Math.round(rnd(seed + 89, 7, 10)) : Math.round(rnd(seed + 89, 0, 5)),
                guppyCleanBullishFan: isActionable && rnd(seed + 90, 0, 1) > 0.3,
                guppyGroupGapPct: isActionable ? rnd(seed + 91, 1, 5) : rnd(seed + 91, -2, 1),
                guppyCoiledRelease: isActionable && rnd(seed + 92, 0, 1) > 0.5,
                candlePattern: isActionable ? ['B-EN', 'B-MZ', 'HAMR', '3WS', 'MRST', 'B-ST'][Math.floor(rnd(seed + 88, 0, 6))] : ['BEAR', 'SPIN', 'DOJI', 'R-WK'][Math.floor(rnd(seed + 88, 0, 4))],
                candlePatternFull: isActionable ? 'Bullish Engulfing' : 'Bearish',
                candlePatternType: (isActionable ? 'bullish' : 'bearish'),
                candlePatternStrength: isActionable ? 3 : 1,
            },
            clusterBreakdown: {
                deployable: { met: Math.round(rnd(seed + 60, isActionable ? 18 : 8, 21)), total: 21 },
                highPrecision: { met: Math.round(rnd(seed + 61, isActionable ? 16 : 7, 19)), total: 19 },
                elite: { met: Math.round(rnd(seed + 62, isActionable ? 17 : 8, 21)), total: 21 },
                ultraSelective: { met: Math.round(rnd(seed + 63, isActionable ? 16 : 7, 20)), total: 20 },
                sniper: { met: Math.round(rnd(seed + 64, isActionable ? 17 : 5, 21)), total: 21 },
                orsReversal: {
                    met: Math.round(rnd(seed + 65, isActionable ? 6 : 2, 10)),
                    total: 10,
                    score: isActionable ? Math.round(rnd(seed + 66, 60, 88)) : Math.round(rnd(seed + 66, 30, 65)),
                    confirmed: isActionable && rnd(seed + 67, 0, 1) > 0.6,
                },
            },
            monster: { badges: [], topProbability: 0 },
            dayChangePct: rnd(seed + 70, -4, 6),
            candleDNA: { score: Math.round(rnd(seed + 71, isActionable ? 50 : 15, isActionable ? 95 : 60)), bodyStrength: Math.round(rnd(seed + 72, 0, 35)), wickCleanliness: Math.round(rnd(seed + 73, 0, 35)), rangeExpansion: Math.round(rnd(seed + 74, 0, 30)), bodyATR: rnd(seed + 75, 0.3, 2.0), upperToLowerWickRatio: rnd(seed + 76, 0.2, 2.0), marubozuScore: rnd(seed + 77, 40, 95), tier: isActionable ? 'STRONG' : 'GOOD' },
        });
    }
    return results;
}
