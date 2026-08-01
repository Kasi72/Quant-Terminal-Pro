'use strict';

/**
 * ATR-to-5% Backtest
 * Question: How many ATR multiples does price need to travel to hit a 5% target?
 * Method: For every day a stock has a valid ATR14, record how far (in ATR units)
 *         the high gets within 20 bars. Then see what fraction actually hits 5%,
 *         and at what ATR multiple.
 *
 * T1 = 4 ATR (current setting) — this tells us if 4 ATR is too tight or right.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const TARGET_PCT = 5.0;   // 5% profit target
const HORIZON    = 20;    // bars to look forward
const MIN_BARS   = 250;   // minimum history needed
const OUT_DIR    = path.join(__dirname, 'results');

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]), c = Number(p[4]), v = Number(p[5]);
    if (!Number.isFinite(ts) || ![o,h,l,c,v].every(Number.isFinite) || o <= 0 || h <= 0) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length-1].ts === x.ts) d[d.length-1] = x;
    else d.push(x);
  }
  return d;
}

// ── ATR14 ─────────────────────────────────────────────────────────────────────
function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  const tr  = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const pc = c[i-1].c;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  if (c.length <= 14) return out;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i-1] * 13 + tr[i]) / 14;
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(DATA_DIR)
  .filter(f => /\.csv$/i.test(f))
  .map(f => ({ name: f, fp: path.join(DATA_DIR, f) }));

console.log(`\nScanning ${files.length} files | Target: +${TARGET_PCT}% | Horizon: ${HORIZON} bars\n`);

// Distribution buckets: how many ATR multiples did it take to hit 5%?
// Buckets: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5+, never
const BUCKET_EDGES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

let totalSignals  = 0;
let hitsAt5Pct    = 0;
let hitsAt4Atr    = 0;  // hit 5% AND needed <= 4 ATR
const bucketHits  = new Array(BUCKET_EDGES.length + 1).fill(0); // +1 for "never hit"
const maxMfeBuckets = new Array(BUCKET_EDGES.length + 1).fill(0);

// Track ATR% distribution of signal bars
const atrPctBuckets = { lt1: 0, '1to2': 0, '2to3': 0, gt3: 0 };

// Per-symbol stats for top stocks
const symbolStats = {};

let processed = 0;

for (const { name, fp } of files) {
  let c;
  try { c = parseCSV(fp); } catch { continue; }
  processed++;

  if (c.length < MIN_BARS + HORIZON + 1) continue;

  const atr14  = atr14Array(c);
  const symbol = name.replace(/_OHLCV\.csv$/i, '').replace(/\.csv$/i, '');

  let symSignals = 0, symHits = 0;

  // Sample every day from bar 200 onwards (skip early warm-up)
  for (let i = 200; i < c.length - HORIZON - 1; i++) {
    const atr = atr14[i];
    if (!atr || atr <= 0) continue;

    const entry   = c[i+1].o;  // next-bar open entry
    if (!entry || entry <= 0) continue;

    const atrPct  = (atr / entry) * 100;
    if (atrPct < 0.3 || atrPct > 15) continue;  // sanity filter

    totalSignals++;
    symSignals++;

    // Track ATR% distribution
    if      (atrPct < 1)  atrPctBuckets.lt1++;
    else if (atrPct < 2)  atrPctBuckets['1to2']++;
    else if (atrPct < 3)  atrPctBuckets['2to3']++;
    else                  atrPctBuckets.gt3++;

    const target5px = entry * (1 + TARGET_PCT / 100);

    // Walk forward HORIZON bars, find MFE and whether 5% was hit
    let hit5 = false;
    let atrMultAtHit = null;
    let mfeAtrMult = 0;

    for (let j = i + 1; j <= i + HORIZON && j < c.length; j++) {
      const bar = c[j];
      const highMove = ((bar.h - entry) / entry) * 100;
      const highInAtr = (bar.h - entry) / atr;
      mfeAtrMult = Math.max(mfeAtrMult, highInAtr);

      if (!hit5 && bar.h >= target5px) {
        hit5 = true;
        atrMultAtHit = highInAtr;
      }
    }

    // Bucket by max MFE in ATR multiples
    let mfeBucket = BUCKET_EDGES.length; // "5+"
    for (let b = 0; b < BUCKET_EDGES.length; b++) {
      if (mfeAtrMult <= BUCKET_EDGES[b]) { mfeBucket = b; break; }
    }
    maxMfeBuckets[mfeBucket]++;

    if (hit5) {
      hitsAt5Pct++;
      symHits++;

      // Which ATR-multiple bucket did 5% fall in?
      let hitBucket = BUCKET_EDGES.length;
      for (let b = 0; b < BUCKET_EDGES.length; b++) {
        if (atrMultAtHit <= BUCKET_EDGES[b]) { hitBucket = b; break; }
      }
      bucketHits[hitBucket]++;

      if (atrMultAtHit <= 4) hitsAt4Atr++;
    } else {
      bucketHits[BUCKET_EDGES.length]++; // never hit
    }
  }

  symbolStats[symbol] = { signals: symSignals, hits: symHits, rate: symSignals > 0 ? (symHits / symSignals * 100) : 0 };
}

// ── Report ────────────────────────────────────────────────────────────────────
const hitRate = (hitsAt5Pct / totalSignals * 100).toFixed(1);
const t1CoverageRate = (hitsAt4Atr / hitsAt5Pct * 100).toFixed(1);

const bucketLabels = BUCKET_EDGES.map((e, i) => {
  const prev = i === 0 ? 0 : BUCKET_EDGES[i-1];
  return `${prev}–${e}×ATR`;
});
bucketLabels.push('Never hit 5%');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  ATR-to-5% BACKTEST REPORT');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Files scanned    : ${processed}`);
console.log(`  Total bar-signals: ${totalSignals.toLocaleString()}`);
console.log(`  Hit 5% in 20 bars: ${hitsAt5Pct.toLocaleString()} (${hitRate}%)`);
console.log(`  T1=4ATR covers   : ${hitsAt4Atr.toLocaleString()} of those hits (${t1CoverageRate}%)`);
console.log();

console.log('── ATR% of entry price (signal bar distribution) ──────────────');
const total = totalSignals;
console.log(`  ATR < 1%  : ${atrPctBuckets.lt1.toLocaleString().padStart(8)} (${(atrPctBuckets.lt1/total*100).toFixed(1)}%) — tight stocks`);
console.log(`  ATR 1–2%  : ${atrPctBuckets['1to2'].toLocaleString().padStart(8)} (${(atrPctBuckets['1to2']/total*100).toFixed(1)}%) — normal`);
console.log(`  ATR 2–3%  : ${atrPctBuckets['2to3'].toLocaleString().padStart(8)} (${(atrPctBuckets['2to3']/total*100).toFixed(1)}%) — volatile`);
console.log(`  ATR > 3%  : ${atrPctBuckets.gt3.toLocaleString().padStart(8)} (${(atrPctBuckets.gt3/total*100).toFixed(1)}%) — high-vol`);
console.log();

console.log('── HOW MANY ATR to touch 5% (among hits) ──────────────────────');
console.log('   (This tells you where to set T1 to capture 5%)');
const hitTotal = hitsAt5Pct;
let cumHits = 0;
for (let b = 0; b < BUCKET_EDGES.length; b++) {
  cumHits += bucketHits[b];
  const pct  = hitTotal > 0 ? (bucketHits[b] / hitTotal * 100).toFixed(1) : '0.0';
  const cpct = hitTotal > 0 ? (cumHits / hitTotal * 100).toFixed(1) : '0.0';
  const marker = b === BUCKET_EDGES.indexOf(4) ? '  ◄ T1=4ATR' : '';
  console.log(`  ${bucketLabels[b].padEnd(14)}: ${String(bucketHits[b]).padStart(8)}  (${pct.padStart(5)}% of hits | cum ${cpct.padStart(5)}%)${marker}`);
}
console.log();

console.log('── MAX MFE distribution in 20 bars (all signals) ───────────────');
console.log('   (How far does price actually go — regardless of 5% hit)');
for (let b = 0; b <= BUCKET_EDGES.length; b++) {
  const label = b < BUCKET_EDGES.length ? bucketLabels[b] : 'Never >0.5% move';
  const pct = (maxMfeBuckets[b] / totalSignals * 100).toFixed(1);
  const marker = b === BUCKET_EDGES.indexOf(4) ? '  ◄ T1=4ATR cap' : '';
  console.log(`  ${label.padEnd(14)}: ${String(maxMfeBuckets[b]).padStart(8)}  (${pct.padStart(5)}%)${marker}`);
}
console.log();

// Top/bottom stocks by 5% hit rate (min 100 signals)
const ranked = Object.entries(symbolStats)
  .filter(([, s]) => s.signals >= 100)
  .sort((a, b) => b[1].rate - a[1].rate);

console.log('── Top 10 stocks reaching 5% most often ───────────────────────');
for (const [sym, s] of ranked.slice(0, 10)) {
  console.log(`  ${sym.padEnd(20)} ${s.rate.toFixed(1).padStart(5)}%  (${s.hits}/${s.signals})`);
}
console.log();
console.log('── Bottom 10 stocks (hardest to reach 5%) ──────────────────────');
for (const [sym, s] of ranked.slice(-10)) {
  console.log(`  ${sym.padEnd(20)} ${s.rate.toFixed(1).padStart(5)}%  (${s.hits}/${s.signals})`);
}
console.log();

console.log('── KEY INSIGHT ─────────────────────────────────────────────────');
// Median ATR multiple needed: find bucket containing 50th percentile
let cum50 = 0;
let medBucket = -1;
for (let b = 0; b < BUCKET_EDGES.length; b++) {
  cum50 += bucketHits[b];
  if (cum50 >= hitTotal * 0.5 && medBucket < 0) medBucket = b;
}
const medLabel = medBucket >= 0 ? bucketLabels[medBucket] : 'beyond 5×ATR';
console.log(`  Median ATR multiple to hit 5%  : ${medLabel}`);
console.log(`  Signals that NEVER reach 5%    : ${bucketHits[BUCKET_EDGES.length].toLocaleString()} (${(bucketHits[BUCKET_EDGES.length]/totalSignals*100).toFixed(1)}%)`);
console.log(`  T1=4ATR captures of all hits   : ${t1CoverageRate}%`);
console.log();

// Save to JSON
const report = {
  generatedAt: new Date().toISOString(),
  config: { targetPct: TARGET_PCT, horizon: HORIZON },
  totals: { processed, totalSignals, hitsAt5Pct, hitRate: parseFloat(hitRate), hitsAt4Atr, t1CoverageRate: parseFloat(t1CoverageRate) },
  atrPctDistribution: atrPctBuckets,
  atrMultiplesNeededToHit5: Object.fromEntries(bucketLabels.map((l, i) => [l, bucketHits[i]])),
  maxMfeDistribution: Object.fromEntries(bucketLabels.map((l, i) => [l, maxMfeBuckets[i]])),
};
const outFile = path.join(OUT_DIR, `atr_to_5pct_${new Date().toISOString().slice(0,16).replace('T','T').replace(':','-')}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`  Report saved: ${outFile}`);
console.log('═══════════════════════════════════════════════════════════════\n');
