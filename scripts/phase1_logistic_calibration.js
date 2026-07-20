#!/usr/bin/env node
/**
 * PHASE 1: LOGISTIC REGRESSION CALIBRATION
 * Derive statistically grounded BUY/STRONG_BUY/ULTRA thresholds
 * from actual win/loss outcomes on historical OHLCV data.
 *
 * Replaces hardcoded thresholds (43, 62, 80) with P(Win) quantiles
 * derived from: P(Win) = sigmoid(β₀ + β₁×score + β₂×conditions)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';
const TARGET_PCT = 5;     // 5% profit target
const SL_MULT    = 3.0;   // 3×ATR stop (deployed value)
const MAX_BARS   = 20;    // 20-bar hold window
const LEARN_RATE = 0.01;
const EPOCHS     = 3000;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  PHASE 1: LOGISTIC REGRESSION THRESHOLD CALIBRATION');
console.log('  Goal: Replace hardcoded 43/62/80 with P(Win) quantiles');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── Data loading ─────────────────────────────────────────────────────────────

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  return lines.map(line => {
    const [date, o, h, l, c, v] = line.split(',');
    return { o: +o, h: +h, l: +l, c: +c, v: parseInt(v) || 0 };
  }).filter(r => r.c > 0 && r.h > 0);
}

// ── Technical indicators ──────────────────────────────────────────────────────

function calcATR14(candles, end) {
  if (end < 14) return 0;
  let sum = 0;
  for (let i = end - 13; i <= end; i++) {
    sum += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
  }
  return sum / 14;
}

function calcRSI2(candles, end) {
  if (end < 3) return 50;
  let gains = 0, losses = 0;
  for (let i = end - 1; i <= end; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function avgVolume(candles, end, period) {
  if (end < period) return 0;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) sum += candles[i].v;
  return sum / period;
}

// ── Score calculation (mirrors stockEngine.ts logic) ─────────────────────────

function calcScore(candles, idx) {
  const sig = candles[idx];
  const range = sig.h - sig.l;
  const body = Math.abs(sig.c - sig.o);
  const atr14 = calcATR14(candles, idx);
  if (atr14 === 0) return null;

  const atrPct = atr14 / sig.c * 100;
  if (atrPct > 3.5) return null; // HIGH band filter (deployed)

  // Entry gates
  const bodyPct  = range > 0 ? body / range * 100 : 0;
  const closeLoc = range > 0 ? (sig.c - sig.l) / range * 100 : 50;
  if (bodyPct < 60 || closeLoc < 40) return null;

  // ── Score components ─────────────────────────────────────────────────

  // 1. Compression quality (30 pts) — pre-10 avg range vs ATR
  let compScore = 0;
  if (idx >= 10) {
    let rangeSum = 0;
    for (let i = idx - 10; i < idx; i++) rangeSum += (candles[i].h - candles[i].l);
    const avgRange = rangeSum / 10;
    const compressionRatio = avgRange / atr14;
    if (compressionRatio <= 0.7)       compScore = 30;
    else if (compressionRatio <= 0.85) compScore = 22;
    else if (compressionRatio <= 1.0)  compScore = 15;
    else if (compressionRatio <= 1.2)  compScore = 8;
    else                               compScore = 0;
  }

  // 2. Close location (10 pts)
  const closeScore = closeLoc >= 80 ? 10
    : closeLoc >= 65 ? 8
    : closeLoc >= 50 ? 6
    : closeLoc >= 40 ? 3
    : 0;

  // 3. Body % (10 pts)
  const bodyScore = bodyPct >= 90 ? 10
    : bodyPct >= 75 ? 8
    : bodyPct >= 60 ? 6
    : 0;

  // 4. Upper wick (5 pts) — small upper wick = clean breakout
  const upperWick = range > 0 ? (sig.h - Math.max(sig.o, sig.c)) / range * 100 : 0;
  const wickScore = upperWick <= 5 ? 5
    : upperWick <= 15 ? 3
    : upperWick <= 25 ? 1
    : 0;

  // 5. Volume vs 20-day average (10 pts)
  const vol20 = avgVolume(candles, idx - 1, 20);
  const volRatio20 = vol20 > 0 ? sig.v / vol20 : 1;
  const vol20Score = volRatio20 >= 3.0 ? 10
    : volRatio20 >= 2.0 ? 8
    : volRatio20 >= 1.5 ? 6
    : volRatio20 >= 1.0 ? 3
    : 0;

  // 6. Volume vs pre-5 average (10 pts)
  const vol5 = avgVolume(candles, idx - 1, 5);
  const volRatio5 = vol5 > 0 ? sig.v / vol5 : 1;
  const vol5Score = volRatio5 >= 2.5 ? 10
    : volRatio5 >= 1.8 ? 8
    : volRatio5 >= 1.3 ? 5
    : volRatio5 >= 1.0 ? 2
    : 0;

  // 7. Volume expansion trend (5 pts)
  const volExpScore = volRatio5 > volRatio20 ? 5
    : volRatio5 > volRatio20 * 0.8 ? 2
    : 0;

  // 8. RSI(2) (10 pts) — oversold bounce is better
  const rsi2 = calcRSI2(candles, idx);
  const rsiScore = rsi2 <= 20 ? 10
    : rsi2 <= 35 ? 8
    : rsi2 <= 50 ? 6
    : rsi2 <= 65 ? 3
    : 0;

  // 9. Candle risk (10 pts) — ATR% as volatility proxy
  const riskScore = atrPct <= 1.0 ? 10
    : atrPct <= 1.5 ? 8
    : atrPct <= 2.0 ? 6
    : atrPct <= 2.5 ? 4
    : atrPct <= 3.0 ? 2
    : 0;

  const totalScore = compScore + closeScore + bodyScore + wickScore +
                     vol20Score + vol5Score + volExpScore + rsiScore + riskScore;

  // ── Conditions count (6 binary) ──────────────────────────────────────

  let conditionsMet = 0;

  if (idx >= 10) {
    // Cond 1: Pre-10 avg range compressed (< 1.0× ATR)
    let rangeSum = 0;
    let highVolCount = 0;
    let redVolSum = 0;
    for (let i = idx - 10; i < idx; i++) {
      rangeSum += (candles[i].h - candles[i].l);
      if (candles[i].v > vol20 * 1.5) highVolCount++;
      if (candles[i].c < candles[i].o) redVolSum++;
    }
    const avgR = rangeSum / 10;
    if (avgR / atr14 <= 1.0) conditionsMet++;

    // Cond 2: Pre-10 avg volume ratio low (< 1.2×)
    const vol10avg = avgVolume(candles, idx - 1, 10);
    if (vol10avg / (vol20 || 1) <= 1.2) conditionsMet++;

    // Cond 3: Pre-5 avg volume ratio low (< 1.1×)
    if (vol5 / (vol20 || 1) <= 1.1) conditionsMet++;

    // Cond 4: Few high-volume days in pre-10 (≤ 2)
    if (highVolCount <= 2) conditionsMet++;

    // Cond 5: Low red-volume bias in pre-10 (≤ 6 days)
    if (redVolSum <= 6) conditionsMet++;

    // Cond 6: Zone tightness — compression ratio ≤ 0.9
    if (avgR / atr14 <= 0.9) conditionsMet++;
  }

  return { score: totalScore, conditions: conditionsMet, atrPct };
}

// ── Win/Loss labeler ──────────────────────────────────────────────────────────

function labelTrade(candles, idx, entryPrice, atr14) {
  const target = entryPrice * (1 + TARGET_PCT / 100);
  const sl     = entryPrice - (SL_MULT * atr14);

  for (let i = idx + 1; i <= Math.min(idx + MAX_BARS, candles.length - 1); i++) {
    if (candles[i].l <= sl) return 0; // Stop loss hit → Loss
    if (candles[i].h >= target) return 1; // 5% target hit → Win
  }
  return 0; // Time-exit without target → Loss
}

// ── Logistic regression (gradient descent) ───────────────────────────────────

function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
}

function fitLogistic(data) {
  // Normalize inputs
  const scores = data.map(d => d.score);
  const conds  = data.map(d => d.conditions);
  const meanS  = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdS   = Math.sqrt(scores.reduce((a, b) => a + (b - meanS) ** 2, 0) / scores.length) || 1;
  const meanC  = conds.reduce((a, b) => a + b, 0) / conds.length;
  const stdC   = Math.sqrt(conds.reduce((a, b) => a + (b - meanC) ** 2, 0) / conds.length) || 1;

  let b0 = 0, b1 = 0, b2 = 0;
  const n = data.length;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    let db0 = 0, db1 = 0, db2 = 0;
    for (const d of data) {
      const xs = (d.score - meanS) / stdS;
      const xc = (d.conditions - meanC) / stdC;
      const pred = sigmoid(b0 + b1 * xs + b2 * xc);
      const err  = pred - d.win;
      db0 += err;
      db1 += err * xs;
      db2 += err * xc;
    }
    b0 -= (LEARN_RATE / n) * db0;
    b1 -= (LEARN_RATE / n) * db1;
    b2 -= (LEARN_RATE / n) * db2;
  }

  // Return model with denormalization helper
  return {
    b0, b1, b2, meanS, stdS, meanC, stdC,
    predict(score, cond) {
      const xs = (score - meanS) / stdS;
      const xc = (cond  - meanC) / stdC;
      return sigmoid(b0 + b1 * xs + b2 * xc);
    }
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 50); // 50 stocks for a more robust sample

console.log(`Processing ${files.length} stocks...\n`);

const dataset = [];
let skipped = 0;

for (const file of files) {
  try {
    const candles = loadCSV(path.join(DATA_DIR, file));
    if (candles.length < 60) continue;

    for (let i = 25; i < candles.length - MAX_BARS; i++) {
      const result = calcScore(candles, i);
      if (!result) { skipped++; continue; }

      const atr14 = calcATR14(candles, i);
      if (atr14 === 0) continue;

      const win = labelTrade(candles, i, candles[i].c, atr14);
      dataset.push({ score: result.score, conditions: result.conditions, win });
    }
  } catch (e) {
    // skip bad files
  }
}

console.log(`Dataset: ${dataset.length} signals (${skipped} filtered out)\n`);

if (dataset.length < 100) {
  console.log('⚠️  Insufficient data. Need at least 100 signals.');
  process.exit(1);
}

// ── Descriptive stats ─────────────────────────────────────────────────────────

const wins   = dataset.filter(d => d.win === 1).length;
const losses = dataset.filter(d => d.win === 0).length;
const baseWR = (wins / dataset.length * 100).toFixed(1);

console.log('BASE STATISTICS');
console.log('───────────────────────────────────────────────────────────────');
console.log(`Total signals: ${dataset.length}`);
console.log(`Wins (5% hit): ${wins} (${baseWR}%)`);
console.log(`Losses:        ${losses} (${(100 - +baseWR).toFixed(1)}%)\n`);

// Score distribution
const scoreGroups = {};
for (let s = 0; s <= 100; s += 10) scoreGroups[s] = { wins: 0, total: 0 };
for (const d of dataset) {
  const bucket = Math.floor(d.score / 10) * 10;
  const key = Math.min(bucket, 100);
  if (scoreGroups[key] !== undefined) {
    scoreGroups[key].total++;
    scoreGroups[key].wins += d.win;
  }
}

console.log('WIN RATE BY SCORE BUCKET (empirical)');
console.log('───────────────────────────────────────────────────────────────');
console.log('Score    | Count | Win%');
for (const [bucket, g] of Object.entries(scoreGroups)) {
  if (g.total === 0) continue;
  const wr = (g.wins / g.total * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(g.wins / g.total * 20));
  console.log(`${String(bucket).padStart(3)}-${String(+bucket + 9).padStart(3)}  | ${String(g.total).padStart(5)} | ${wr.padStart(5)}% ${bar}`);
}

// Conditions distribution
console.log('\nWIN RATE BY CONDITIONS COUNT');
console.log('───────────────────────────────────────────────────────────────');
console.log('Conds | Count | Win%');
for (let c = 0; c <= 6; c++) {
  const group = dataset.filter(d => d.conditions === c);
  if (group.length === 0) continue;
  const wr = (group.filter(d => d.win).length / group.length * 100).toFixed(1);
  console.log(`  ${c}   | ${String(group.length).padStart(5)} | ${wr.padStart(5)}%`);
}

// ── Fit logistic regression ───────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────────────');
console.log('FITTING LOGISTIC REGRESSION...');
console.log('  P(Win) = sigmoid(β₀ + β₁×score + β₂×conditions)');

const model = fitLogistic(dataset);

// Evaluate accuracy
let correct = 0;
for (const d of dataset) {
  const p = model.predict(d.score, d.conditions);
  if ((p >= 0.5) === (d.win === 1)) correct++;
}
const accuracy = (correct / dataset.length * 100).toFixed(1);

console.log(`\nModel accuracy: ${accuracy}% (vs ${baseWR}% base rate)`);
console.log(`β₀=${model.b0.toFixed(4)} β₁(score)=${model.b1.toFixed(4)} β₂(conds)=${model.b2.toFixed(4)}\n`);

// ── Find new thresholds ───────────────────────────────────────────────────────

// For each (score, conditions) combo, find P(Win)
// Then find score thresholds where P(Win) crosses 45%, 55%, 65%

function findScoreThreshold(targetProb, fixedCond) {
  for (let s = 0; s <= 100; s++) {
    if (model.predict(s, fixedCond) >= targetProb) return s;
  }
  return 100;
}

console.log('───────────────────────────────────────────────────────────────');
console.log('NEW CALIBRATED THRESHOLDS (from logistic regression)\n');
console.log('At median conditions (3):');

const medCond = 3;
const buyThresh    = findScoreThreshold(0.45, medCond);
const strongThresh = findScoreThreshold(0.55, medCond);
const ultraThresh  = findScoreThreshold(0.65, medCond);

console.log(`  BUY:          score ≥ ${buyThresh}   (P(Win) ≥ 45%)`);
console.log(`  STRONG_BUY:   score ≥ ${strongThresh}   (P(Win) ≥ 55%)`);
console.log(`  ULTRA_STRONG: score ≥ ${ultraThresh}   (P(Win) ≥ 65%)\n`);
console.log('Current hardcoded values:');
console.log('  BUY=43, STRONG_BUY=62, ULTRA_STRONG_BUY=80\n');

// Show P(Win) at key score points
console.log('P(Win) CURVE (at conditions=3)');
console.log('───────────────────────────────────────────────────────────────');
console.log('Score | P(Win) | Stage');
for (let s = 20; s <= 95; s += 5) {
  const p = model.predict(s, 3) * 100;
  const stage = s >= ultraThresh ? 'ULTRA_STRONG'
    : s >= strongThresh ? 'STRONG_BUY'
    : s >= buyThresh    ? 'BUY'
    : 'PRE_BREAKOUT';
  const bar = '▓'.repeat(Math.round(p / 5));
  console.log(`  ${String(s).padStart(3)} | ${p.toFixed(1).padStart(5)}% | ${stage.padEnd(14)} ${bar}`);
}

// ── Validate: compare old vs new thresholds on dataset ───────────────────────

function evaluateThresholds(data, buyT, strongT, ultraT) {
  const buckets = {
    ULTRA:  { wins: 0, total: 0 },
    STRONG: { wins: 0, total: 0 },
    BUY:    { wins: 0, total: 0 },
    PRE:    { wins: 0, total: 0 }
  };
  for (const d of data) {
    const stage = d.score >= ultraT  ? 'ULTRA'
      : d.score >= strongT ? 'STRONG'
      : d.score >= buyT    ? 'BUY'
      : 'PRE';
    buckets[stage].total++;
    buckets[stage].wins += d.win;
  }
  return buckets;
}

const oldResults = evaluateThresholds(dataset, 43, 62, 80);
const newResults = evaluateThresholds(dataset, buyThresh, strongThresh, ultraThresh);

console.log('\n───────────────────────────────────────────────────────────────');
console.log('VALIDATION: OLD vs NEW THRESHOLDS\n');
console.log('Stage         | OLD WR | OLD n | NEW WR | NEW n');
console.log('─'.repeat(53));

const stages = ['ULTRA', 'STRONG', 'BUY', 'PRE'];
for (const stage of stages) {
  const o = oldResults[stage];
  const n = newResults[stage];
  const oWR = o.total > 0 ? (o.wins / o.total * 100).toFixed(1) : '-';
  const nWR = n.total > 0 ? (n.wins / n.total * 100).toFixed(1) : '-';
  console.log(
    `${stage.padEnd(13)} | ${oWR.padStart(5)}% | ${String(o.total).padStart(5)} | ${nWR.padStart(5)}% | ${String(n.total).padStart(5)}`
  );
}

// ── Recommendation ────────────────────────────────────────────────────────────

const oldUltraWR = oldResults.ULTRA.total > 0
  ? (oldResults.ULTRA.wins / oldResults.ULTRA.total * 100)
  : 0;
const newUltraWR = newResults.ULTRA.total > 0
  ? (newResults.ULTRA.wins / newResults.ULTRA.total * 100)
  : 0;
const improvement = (newUltraWR - oldUltraWR).toFixed(1);

console.log('\n───────────────────────────────────────────────────────────────');
console.log('RECOMMENDATION\n');

if (+improvement > 1) {
  console.log(`✅ DEPLOY new thresholds — ULTRA win rate: +${improvement}% improvement\n`);
} else if (+improvement > 0) {
  console.log(`⚠️  MARGINAL improvement (${improvement}%) — consider A/B testing before deploy\n`);
} else {
  console.log(`⚠️  Old thresholds slightly better on this sample (${improvement}%)`);
  console.log(`    Possible causes: sample size, or old thresholds were already near-optimal\n`);
}

console.log('To update stockEngine.ts, change archetypeStage() thresholds to:');
console.log(`  const scoreRank = score >= ${ultraThresh} ? 3 : score >= ${strongThresh} ? 2 : score >= ${buyThresh} ? 1 : 0;`);
console.log('\nThis replaces:');
console.log('  const scoreRank = score >= 80 ? 3 : score >= 62 ? 2 : score >= 43 ? 1 : 0;');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Phase 1 complete. Run phase2_pca_weights.js for weight optimization.');
console.log('═══════════════════════════════════════════════════════════════\n');
