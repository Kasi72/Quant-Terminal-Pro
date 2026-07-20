#!/usr/bin/env node
/**
 * PHASE 2: PER-CONDITION WEIGHT OPTIMIZATION
 * For each archetype, fit P(Win) = sigmoid(β0 + β1*c1 + ... + β6*c6)
 * and redistribute condition points proportional to logistic coefficients.
 *
 * Current weights are domain-knowledge guesses. This replaces them with
 * data-derived weights showing which conditions actually predict 5% wins.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';
const TARGET_PCT = 5;
const SL_MULT    = 3.0;
const MAX_BARS   = 20;
const EPOCHS     = 5000;
const LR         = 0.05;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  PHASE 2: CONDITION WEIGHT OPTIMIZATION');
console.log('  Fit logistic regression on 6-condition vectors per archetype');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── I/O ──────────────────────────────────────────────────────────────────────

function loadCSV(fp) {
  return fs.readFileSync(fp, 'utf8').trim().split('\n').slice(1).map(l => {
    const [, o, h, lo, c, v] = l.split(',');
    return { o: +o, h: +h, l: +lo, c: +c, v: parseInt(v) || 0 };
  }).filter(r => r.c > 0);
}

// ── Indicators ────────────────────────────────────────────────────────────────

function calcATR14(cs, end) {
  if (end < 14) return cs[end] ? cs[end].h - cs[end].l : 0;
  let s = 0;
  for (let i = end - 13; i <= end; i++)
    s += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i-1].c), Math.abs(cs[i].l - cs[i-1].c));
  return s / 14;
}

function avgVolume(cs, end, n) {
  let s = 0, cnt = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) { s += cs[i].v; cnt++; }
  return cnt > 0 ? s / cnt : 0;
}

function bbWidth(cs, end) {
  if (end < 20) return 0;
  let sum = 0;
  for (let i = end - 19; i <= end; i++) sum += cs[i].c;
  const mean = sum / 20;
  let variance = 0;
  for (let i = end - 19; i <= end; i++) variance += (cs[i].c - mean) ** 2;
  const sd = Math.sqrt(variance / 20);
  return cs[end].c > 0 ? 4 * sd / cs[end].c : 0; // 4×sd / price = normalized BB width
}

function dmi14(cs, end) {
  if (end < 15) return { diPlus: 20, diMinus: 20, adx: 20 };
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = end - 13; i <= end; i++) {
    const upMove   = cs[i].h - cs[i-1].h;
    const downMove = cs[i-1].l - cs[i].l;
    plusDM  += (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
    trSum   += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i-1].c), Math.abs(cs[i].l - cs[i-1].c));
  }
  if (trSum === 0) return { diPlus: 20, diMinus: 20, adx: 20 };
  const diPlus  = 100 * plusDM / trSum;
  const diMinus = 100 * minusDM / trSum;
  return { diPlus, diMinus, adx: 20 }; // adx approximation
}

function labelTrade(cs, idx, entry, atr14) {
  const target = entry * (1 + TARGET_PCT / 100);
  const sl     = entry - SL_MULT * atr14;
  for (let i = idx + 1; i <= Math.min(idx + MAX_BARS, cs.length - 1); i++) {
    if (cs[i].l <= sl) return 0;
    if (cs[i].h >= target) return 1;
  }
  return 0;
}

// ── Logistic regression ───────────────────────────────────────────────────────

function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x)))); }

function fitLogistic(data, featureNames) {
  const k = featureNames.length;
  const betas = new Array(k + 1).fill(0); // β0 + β1..βk
  const n = data.length;

  for (let ep = 0; ep < EPOCHS; ep++) {
    const grads = new Array(k + 1).fill(0);
    for (const d of data) {
      let z = betas[0];
      for (let j = 0; j < k; j++) z += betas[j + 1] * d.features[j];
      const err = sigmoid(z) - d.win;
      grads[0] += err;
      for (let j = 0; j < k; j++) grads[j + 1] += err * d.features[j];
    }
    for (let j = 0; j <= k; j++) betas[j] -= (LR / n) * grads[j];
  }

  return { betas, predict(features) { let z = betas[0]; for (let j = 0; j < features.length; j++) z += betas[j+1]*features[j]; return sigmoid(z); } };
}

// ── Archetype condition simulators ────────────────────────────────────────────

/**
 * CompressionCoil — detect coiling compression phase
 * c1: ≥8 consecutive narrow bars (< 0.7×ATR)
 * c2: volume declining ≥ 2 consecutive days
 * c3: price in upper 41% of 20d range
 * c4: BB width ≤ 30th percentile (60d)
 * c5: signal bar narrow (≤0.8×ATR), green, closeLoc>55%, body>30%
 * c6: DI+ > DI−
 */
function compressionCoilConditions(cs, idx) {
  const sig = cs[idx];
  const atr = calcATR14(cs, idx);
  if (atr === 0) return null;
  const atrPct = atr / sig.c * 100;
  if (atrPct > 3.5) return null;

  // c1: count consecutive narrow bars ending at idx-1
  let compressionBars = 0;
  for (let i = idx - 1; i >= Math.max(0, idx - 20); i--) {
    if ((cs[i].h - cs[i].l) < 0.7 * atr) compressionBars++;
    else break;
  }
  const c1 = compressionBars >= 8;

  // c2: volume declining ≥ 2 consecutive days
  let volDeclineDays = 0;
  for (let i = idx - 1; i >= Math.max(1, idx - 5); i--) {
    if (cs[i].v < cs[i-1].v) volDeclineDays++;
    else break;
  }
  const c2 = volDeclineDays >= 2;

  // c3: price in upper 41% of 20d range
  let hi20 = 0, lo20 = Infinity;
  for (let i = Math.max(0, idx - 20); i < idx; i++) {
    hi20 = Math.max(hi20, cs[i].h); lo20 = Math.min(lo20, cs[i].l);
  }
  const pricePos20 = hi20 > lo20 ? (sig.c - lo20) / (hi20 - lo20) * 100 : 50;
  const c3 = pricePos20 >= 59; // upper 41%

  // c4: BB width ≤ 30th percentile over 60 days
  if (idx < 60) return null;
  const bws = [];
  for (let i = idx - 59; i <= idx; i++) bws.push(bbWidth(cs, i));
  bws.sort((a, b) => a - b);
  const pctl30 = bws[Math.floor(bws.length * 0.30)];
  const c4 = bbWidth(cs, idx) <= pctl30;

  // c5: signal bar range ≤ 0.8×ATR, green, closeLoc>55%, body>30%
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct  = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const c5 = sigRange <= 0.8 * atr && sig.c > sig.o && closeLoc > 55 && bodyPct > 30;

  // c6: DI+ > DI−
  const { diPlus, diMinus } = dmi14(cs, idx);
  const c6 = diPlus > diMinus;

  return { c1, c2, c3, c4, c5, c6, compressionBars, pricePos20, atr, sig };
}

/**
 * VolumeFootprint — explosive volume with range expansion
 * c1: volume ≥ 3.7× 20d avg
 * c2: close in top 32% of range AND upper wick ≤ 12%
 * c3: price within 17% of 20d high
 * c4: range expansion ≥ 2.4×ATR
 * c5: no gap-down open (≤ -2.6%)
 * c6: DI+ > DI−
 */
function volumeFootprintConditions(cs, idx) {
  const sig = cs[idx];
  const atr = calcATR14(cs, idx);
  if (atr === 0) return null;
  const atrPct = atr / sig.c * 100;
  if (atrPct > 3.5) return null;
  if (idx < 20) return null;

  const vAvg20 = avgVolume(cs, idx - 1, 20);
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const c1 = volRatio20 >= 3.7;

  const sigRange = sig.h - sig.l;
  const closeLoc   = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const upperWick  = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const c2 = closeLoc >= 68 && upperWick <= 12;

  let hi20 = 0;
  for (let i = Math.max(0, idx - 20); i < idx; i++) hi20 = Math.max(hi20, cs[i].h);
  const c3 = hi20 > 0 && sig.c >= hi20 * 0.83;

  const rangeATR = atr > 0 ? sigRange / atr : 0;
  const c4 = rangeATR >= 2.4;

  const prevClose = idx > 0 ? cs[idx-1].c : sig.o;
  const gapPct = prevClose > 0 ? (sig.o - prevClose) / prevClose * 100 : 0;
  const c5 = gapPct >= -2.6;

  const { diPlus, diMinus } = dmi14(cs, idx);
  const c6 = diPlus > diMinus;

  return { c1, c2, c3, c4, c5, c6, volRatio20, closeLoc, atr, sig };
}

/**
 * MomentumPocket — pullback into demand zone after trend
 * c1: stock is ≥ 15% below 52W high (meaningful pullback)
 * c2: higher low vs previous swing (support holding)
 * c3: signal candle green with large body (≥60%) at support
 * c4: closeLoc ≥ 55% (close in upper half)
 * c5: volume ≥ 1.5× 20d avg (demand showing)
 * c6: DI+ > DI−
 */
function momentumPocketConditions(cs, idx) {
  const sig = cs[idx];
  const atr = calcATR14(cs, idx);
  if (atr === 0) return null;
  const atrPct = atr / sig.c * 100;
  if (atrPct > 3.5) return null;
  if (idx < 60) return null;

  // 52W high (252 bars)
  let hi52W = 0;
  for (let i = Math.max(0, idx - 252); i < idx; i++) hi52W = Math.max(hi52W, cs[i].h);
  const dd52W = hi52W > 0 ? (hi52W - sig.c) / hi52W * 100 : 0;
  const c1 = dd52W >= 15;

  // Higher low: current low > recent swing low
  const refLow = idx >= 20 ? Math.min(...cs.slice(idx - 20, idx).map(b => b.l)) : sig.l;
  const c2 = sig.l > refLow;

  const sigRange = sig.h - sig.l;
  const bodyPct  = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const c3 = sig.c > sig.o && bodyPct >= 60;

  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const c4 = closeLoc >= 55;

  const vAvg20 = avgVolume(cs, idx - 1, 20);
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const c5 = volRatio20 >= 1.5;

  const { diPlus, diMinus } = dmi14(cs, idx);
  const c6 = diPlus > diMinus;

  return { c1, c2, c3, c4, c5, c6, dd52W, volRatio20, atr, sig };
}

/**
 * EMAStack — EMA20 crossover after multi-day dip
 * c1: today's close crossed above EMA20 (TODAY, not before)
 * c2: was below EMA20 for ≥ 3 consecutive days
 * c3: EMA20 > EMA50 (uptrend intact)
 * c4: signal candle green, body ≥ 40%
 * c5: closeLoc ≥ 60%
 * c6: DI+ > DI−
 */
function emaStackConditions(cs, idx) {
  const sig = cs[idx];
  const atr = calcATR14(cs, idx);
  if (atr === 0) return null;
  const atrPct = atr / sig.c * 100;
  if (atrPct > 3.5) return null;
  if (idx < 55) return null;

  // Compute EMA20 and EMA50
  function ema(n) {
    const k = 2 / (n + 1);
    let e = cs[0].c;
    for (let i = 1; i <= idx; i++) e = cs[i].c * k + e * (1 - k);
    return e;
  }
  const ema20 = ema(20);
  const ema50 = ema(50);

  // c1: today crossed above EMA20
  const prevEma20 = (() => { const k = 2/21; let e = cs[0].c; for (let i = 1; i < idx; i++) e = cs[i].c*k + e*(1-k); return e; })();
  const c1 = sig.c > ema20 && (idx === 0 || cs[idx-1].c <= prevEma20);

  // c2: was below EMA20 for ≥ 3 days
  let belowCount = 0;
  for (let i = idx - 1; i >= Math.max(0, idx - 10); i--) {
    if (cs[i].c < ema20) belowCount++;
    else break;
  }
  const c2 = belowCount >= 3;

  const c3 = ema20 > ema50;

  const sigRange = sig.h - sig.l;
  const bodyPct  = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const c4 = sig.c > sig.o && bodyPct >= 40;

  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const c5 = closeLoc >= 60;

  const vAvg20 = avgVolume(cs, idx - 1, 20);
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const { diPlus, diMinus } = dmi14(cs, idx);
  const c6 = diPlus > diMinus;

  return { c1, c2, c3, c4, c5, c6, belowCount, volRatio20, atr, sig };
}

// ── Data collection ───────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 60);

console.log(`Processing ${files.length} stocks...\n`);

const datasets = {
  CompressionCoil:  [],
  VolumeFootprint:  [],
  MomentumPocket:   [],
  EMAStack:         [],
};

for (const file of files) {
  try {
    const cs = loadCSV(path.join(DATA_DIR, file));
    if (cs.length < 80) continue;

    for (let i = 65; i < cs.length - MAX_BARS; i++) {
      const atr14 = calcATR14(cs, i);
      if (atr14 === 0) continue;
      const win = labelTrade(cs, i, cs[i].c, atr14);

      // CompressionCoil
      const cc = compressionCoilConditions(cs, i);
      if (cc) {
        datasets.CompressionCoil.push({
          features: [+cc.c1, +cc.c2, +cc.c3, +cc.c4, +cc.c5, +cc.c6],
          continuousBonus: Math.min(10, cc.compressionBars * 3) + Math.min(5, Math.max(0, cc.pricePos20 - 65) * 0.5),
          win
        });
      }

      // VolumeFootprint
      const vf = volumeFootprintConditions(cs, i);
      if (vf) {
        datasets.VolumeFootprint.push({
          features: [+vf.c1, +vf.c2, +vf.c3, +vf.c4, +vf.c5, +vf.c6],
          continuousBonus: Math.min(10, (vf.volRatio20 - 3) * 5) + Math.min(5, (vf.closeLoc - 68) * 0.3),
          win
        });
      }

      // MomentumPocket
      const mp = momentumPocketConditions(cs, i);
      if (mp) {
        datasets.MomentumPocket.push({
          features: [+mp.c1, +mp.c2, +mp.c3, +mp.c4, +mp.c5, +mp.c6],
          continuousBonus: Math.min(10, 0) + Math.min(5, (mp.volRatio20 - 1.5) * 4),
          win
        });
      }

      // EMAStack (strict crossover — fewer signals)
      const es = emaStackConditions(cs, i);
      if (es) {
        datasets.EMAStack.push({
          features: [+es.c1, +es.c2, +es.c3, +es.c4, +es.c5, +es.c6],
          continuousBonus: Math.min(10, es.belowCount * 2) + Math.min(5, (es.volRatio20 - 1.8) * 5),
          win
        });
      }
    }
  } catch (e) {}
}

// ── Per-archetype analysis ────────────────────────────────────────────────────

const ARCHETYPE_NAMES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

const CURRENT_WEIGHTS = {
  CompressionCoil: [20, 15, 15, 20, 15, 15],
  VolumeFootprint: [20, 20, 15, 20, 10, 15],
  MomentumPocket:  [18, 12, 20, 17, 13, 20],
  EMAStack:        [25, 15, 15, 15, 10, 20],
};

const RESULTS = {};

for (const [arch, data] of Object.entries(datasets)) {
  if (data.length < 50) {
    console.log(`⚠️  ${arch}: too few signals (${data.length}), skipping\n`);
    continue;
  }

  const wins  = data.filter(d => d.win).length;
  const baseWR = (wins / data.length * 100).toFixed(1);

  console.log(`\n${'─'.repeat(65)}`);
  console.log(`ARCHETYPE: ${arch}`);
  console.log(`Signals: ${data.length} | Base WR: ${baseWR}%`);

  // Per-condition empirical win rates
  console.log('\nCondition | Met n | WR when Met | WR when Not | Delta');
  for (let j = 0; j < 6; j++) {
    const met    = data.filter(d => d.features[j] === 1);
    const notMet = data.filter(d => d.features[j] === 0);
    const wrMet  = met.length > 0    ? (met.filter(d=>d.win).length    / met.length    * 100) : 0;
    const wrNot  = notMet.length > 0 ? (notMet.filter(d=>d.win).length / notMet.length * 100) : 0;
    const delta  = wrMet - wrNot;
    console.log(
      `c${j+1} (${ARCHETYPE_NAMES[j]}) | ${String(met.length).padStart(6)} | ${wrMet.toFixed(1).padStart(10)}% | ${wrNot.toFixed(1).padStart(11)}% | ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
    );
  }

  // Fit logistic regression on 6-condition binary features
  const model = fitLogistic(data, ARCHETYPE_NAMES);
  const betas = model.betas.slice(1); // drop β0

  // Compute new weights: proportional to |β|, scaled so sum = 90 (leave 10 for bonuses)
  const absSum = betas.reduce((s, b) => s + Math.abs(b), 0);
  const newWeights = absSum > 0
    ? betas.map(b => Math.round(Math.max(0, b) / absSum * 90))
    : CURRENT_WEIGHTS[arch];

  // Normalize to ensure they actually sum to 90
  const wSum = newWeights.reduce((s, w) => s + w, 0);
  if (wSum > 0 && wSum !== 90) {
    const scale = 90 / wSum;
    for (let j = 0; j < 6; j++) newWeights[j] = Math.round(newWeights[j] * scale);
    // Fix rounding: adjust largest to hit exactly 90
    const diff = 90 - newWeights.reduce((s, w) => s + w, 0);
    const maxIdx = newWeights.indexOf(Math.max(...newWeights));
    newWeights[maxIdx] += diff;
  }

  // Validation: compare old vs new weights
  function evalWeights(weights) {
    const buckets = { ULTRA: {w:0,t:0}, STRONG: {w:0,t:0}, BUY: {w:0,t:0} };
    for (const d of data) {
      const score = d.features.reduce((s, f, j) => s + f * weights[j], 0) + d.continuousBonus;
      const stage = score >= 86 ? 'ULTRA' : score >= 62 ? 'STRONG' : score >= 43 ? 'BUY' : null;
      if (stage) { buckets[stage].t++; buckets[stage].w += d.win; }
    }
    return buckets;
  }

  const oldB = evalWeights(CURRENT_WEIGHTS[arch]);
  const newB = evalWeights(newWeights);

  console.log(`\nValidation (old vs new weights at score thresholds 86/62/43):`);
  console.log(`Stage  | Old WR   | Old n | New WR   | New n`);
  for (const s of ['ULTRA', 'STRONG', 'BUY']) {
    const o = oldB[s], n = newB[s];
    const oWR = o.t > 0 ? (o.w/o.t*100).toFixed(1) : '-';
    const nWR = n.t > 0 ? (n.w/n.t*100).toFixed(1) : '-';
    console.log(`${s.padEnd(6)} | ${oWR.padStart(7)}% | ${String(o.t).padStart(5)} | ${nWR.padStart(7)}% | ${String(n.t).padStart(5)}`);
  }

  console.log('\nWeight comparison:');
  console.log(`       Current: [${CURRENT_WEIGHTS[arch].join(', ')}] (sum=${CURRENT_WEIGHTS[arch].reduce((s,v)=>s+v,0)})`);
  console.log(`           New: [${newWeights.join(', ')}] (sum=${newWeights.reduce((s,v)=>s+v,0)})`);
  console.log(`β coefficients: [${betas.map(b=>b.toFixed(2)).join(', ')}]`);

  RESULTS[arch] = { data: data.length, baseWR, newWeights, oldWeights: CURRENT_WEIGHTS[arch], oldB, newB, betas };
}

// ── Summary and stockEngine.ts update instructions ────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY: NEW SCORE LINES FOR stockEngine.ts\n');

const archetypeScoreFormulas = {
  CompressionCoil: (w, bonuses = 'Math.min(10, compressionBars * 3) + Math.min(5, Math.max(0, pricePos20 - 65) * 0.5)') =>
    `(c1 ? ${w[0]} : 0) + (c2 ? ${w[1]} : 0) + (c3 ? ${w[2]} : 0) + (c4 ? ${w[3]} : 0) + (c5 ? ${w[4]} : 0) + (c6 ? ${w[5]} : 0) +\n    ${bonuses}`,
  VolumeFootprint: (w, bonuses = 'Math.min(10, (volRatio20 - 3) * 5) + Math.min(5, (closeLoc - 68) * 0.3)') =>
    `(c1 ? ${w[0]} : 0) + (c2 ? ${w[1]} : 0) + (c3 ? ${w[2]} : 0) + (c4 ? ${w[3]} : 0) + (c5 ? ${w[4]} : 0) + (c6 ? ${w[5]} : 0) +\n    ${bonuses}`,
  MomentumPocket: (w, bonuses = 'Math.min(10, stabilizationBars * 3) + Math.min(5, (volRatio20 - 1.5) * 4)') =>
    `(c1 ? ${w[0]} : 0) + (c2 ? ${w[1]} : 0) + (c3 ? ${w[2]} : 0) + (c4 ? ${w[3]} : 0) + (c5 ? ${w[4]} : 0) + (c6 ? ${w[5]} : 0) +\n    ${bonuses}`,
  EMAStack: (w, bonuses = 'Math.min(10, belowCount * 2) + Math.min(5, (volRatio20 - 1.8) * 5)') =>
    `(c1 ? ${w[0]} : 0) + (c2 ? ${w[1]} : 0) + (c3 ? ${w[2]} : 0) + (c4 ? ${w[3]} : 0) + (c5 ? ${w[4]} : 0) + (c6 ? ${w[5]} : 0) +\n    ${bonuses}`,
};

for (const [arch, res] of Object.entries(RESULTS)) {
  if (!res) continue;
  console.log(`\n── ${arch} ──`);
  if (!archetypeScoreFormulas[arch]) continue;
  console.log(`  const score = Math.min(100, Math.round(`);
  console.log(`    ${archetypeScoreFormulas[arch](res.newWeights)}`);
  console.log(`  ));`);
}

// Save results to JSON
const outPath = path.join('scripts', 'results', `phase2_weights_${new Date().toISOString().slice(0,16).replace(':','-')}.json`);
fs.mkdirSync('scripts/results', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(RESULTS, null, 2));
console.log(`\nResults saved: ${outPath}`);
console.log('\n═══════════════════════════════════════════════════════════════');
