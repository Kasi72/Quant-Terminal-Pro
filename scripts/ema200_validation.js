'use strict';
/**
 * ema200_validation.js
 * Validates: do IS losses for ORS + VF cluster below EMA200 at entry?
 *
 * Outputs per-archetype:
 *   - 2x2 table: above/below EMA200 × win/loss
 *   - Quarterly WR split: above-EMA200 only vs all signals
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_JS = path.join(__dirname, '_compiled_current', 'stockEngine.js');
const OOS_CUT   = new Date('2024-01-01T00:00:00Z').getTime() / 1000;
const WINDOW    = 300;
const MIN_BARS  = WINDOW + 30;

const TARGETS = [
  ['ORS',             'ors_prime_reversal'],
  ['VolumeFootprint', 'optimized_deployable_20plus'],
];

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const [o, h, l, c, v] = [+p[1], +p[2], +p[3], +p[4], +p[5]];
    if (!isFinite(ts) || !isFinite(o) || o <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
    else d.push(x);
  }
  return d;
}

// ── EMA200 array for all bars ─────────────────────────────────────────────────
function buildEMA200(candles) {
  const N   = 200;
  const k   = 2 / (N + 1);
  const ema = new Float64Array(candles.length);
  if (candles.length < N) return ema;
  let val = 0;
  for (let i = 0; i < N; i++) val += candles[i].c;
  val /= N;
  ema[N - 1] = val;
  for (let i = N; i < candles.length; i++) {
    val = candles[i].c * k + val * (1 - k);
    ema[i] = val;
  }
  return ema;
}

// ── Quarter label ─────────────────────────────────────────────────────────────
function qLabel(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// ── Simple exit sim: cascade T1→T2→T3 same as deep_backtest ──────────────────
function simExit(candles, entryIdx, pe) {
  const entry   = pe.plannedEntry;
  const stop    = pe.tacticalStop;
  const t1      = pe.target5;
  const maxHold = pe.maxHoldBars || 20;
  if (entry <= 0 || stop <= 0 || t1 <= entry) return null;

  const endIdx = Math.min(candles.length - 1, entryIdx + maxHold - 1);
  let phase = 1, wLeft = 1.0, weightedPL = 0;
  let stopHit = false, beHit = false, t1Hit = false;
  let t2 = pe.target7, t3 = pe.target10;

  const W1 = 0.50, W2 = 0.30, W3 = 0.20;

  for (let j = entryIdx; j <= endIdx; j++) {
    const bar = candles[j];
    if (!bar) break;

    const loGain = (bar.l - entry) / entry * 100;
    const hiGain = (bar.h - entry) / entry * 100;
    const stopPct = (stop - entry) / entry * 100;
    const t1Pct   = (t1 - entry) / entry * 100;
    const t2Pct   = t2 > 0 ? (t2 - entry) / entry * 100 : 0;
    const t3Pct   = t3 > 0 ? (t3 - entry) / entry * 100 : 0;
    const bePct   = 0;

    if (!beHit && bar.l <= entry) beHit = true;

    const stopEffective = beHit ? Math.max(stopPct, bePct) : stopPct;

    if (!stopHit && loGain <= stopEffective) {
      const chunk = phase === 1 ? W1 : phase === 2 ? W2 : W3;
      weightedPL += chunk * wLeft / chunk * stopEffective;
      // simpler: full remaining weight exits at stop
      weightedPL += wLeft * stopEffective;
      stopHit = true;
      break;
    }

    if (phase === 1 && !t1Hit && hiGain >= t1Pct) {
      weightedPL += W1 * t1Pct;
      wLeft -= W1;
      t1Hit = true;
      phase = 2;
    }
    if (phase === 2 && t2 > 0 && hiGain >= t2Pct) {
      weightedPL += W2 * t2Pct;
      wLeft -= W2;
      phase = 3;
    }
    if (phase === 3 && t3 > 0 && hiGain >= t3Pct) {
      weightedPL += W3 * t3Pct;
      wLeft = 0;
      break;
    }

    if (j === endIdx && wLeft > 0) {
      const closePL = (bar.c - entry) / entry * 100;
      weightedPL += wLeft * closePL;
    }
  }

  return { pl: weightedPL, win: weightedPL > 0 };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const engine = require(ENGINE_JS);

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

console.log(`Scanning ${files.length} files for ORS + VF IS trades...\n`);

// Per-archetype results
const results = {};
for (const [arch] of TARGETS) {
  results[arch] = {
    above: { wins: 0, losses: 0 },
    below: { wins: 0, losses: 0 },
    byQuarter: {},   // q → { above: {w,l}, below: {w,l} }
  };
}

let processed = 0;
for (const fp of files) {
  let candles;
  try { candles = parseCSV(fp); } catch { continue; }
  if (candles.length < MIN_BARS) continue;

  const ema200 = buildEMA200(candles);

  for (const [arch, key] of TARGETS) {
    const res = results[arch];

    for (let i = WINDOW - 1; i < candles.length - 2; i++) {
      const bar = candles[i];
      if (!bar || bar.c <= 0) continue;
      if (bar.ts >= OOS_CUT) continue;  // IS only

      // Need EMA200 valid (bar index ≥ 199)
      if (i < 199 || ema200[i] <= 0) continue;

      const w = candles.slice(i - WINDOW + 1, i + 1);
      let r;
      try { r = engine.analyzeStock(w, key, false); } catch { continue; }
      if (!r) continue;
      const stg = r.stage;
      if (stg !== 'BUY' && stg !== 'STRONG_BUY' && stg !== 'ULTRA_STRONG_BUY') continue;

      const pe = r.priceEngine;
      if (!pe || !pe.tradeValid || pe.tacticalStop <= 0) continue;

      const exit = simExit(candles, i + 1, pe);
      if (!exit) continue;

      const aboveEMA200 = bar.c > ema200[i];
      const bucket = aboveEMA200 ? res.above : res.below;
      if (exit.win) bucket.wins++; else bucket.losses++;

      // Quarterly split
      const q = qLabel(bar.ts);
      if (!res.byQuarter[q]) res.byQuarter[q] = { above: {w:0,l:0}, below: {w:0,l:0} };
      const qb = aboveEMA200 ? res.byQuarter[q].above : res.byQuarter[q].below;
      if (exit.win) qb.w++; else qb.l++;
    }
  }

  processed++;
  if (processed % 200 === 0) process.stdout.write(`  ${processed}/${files.length} files...\r`);
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════');
console.log('  EMA200 REGIME VALIDATION — IS period (pre-2024)');
console.log('══════════════════════════════════════════════════════\n');

function wr(w, l) {
  const n = w + l;
  return n === 0 ? '  —  ' : `${(w/n*100).toFixed(1)}% (n=${n})`;
}

for (const [arch] of TARGETS) {
  const res = results[arch];
  const { above, below } = res;
  const allW = above.wins + below.wins;
  const allL = above.losses + below.losses;

  console.log(`▌ ${arch}`);
  console.log(`  Overall IS WR        : ${wr(allW, allL)}`);
  console.log(`  Above EMA200 WR      : ${wr(above.wins, above.losses)}  ← with filter`);
  console.log(`  Below EMA200 WR      : ${wr(below.wins, below.losses)}  ← filtered out`);
  console.log(`  Signals filtered     : ${below.wins + below.losses} of ${allW+allL} (${((below.wins+below.losses)/(allW+allL+0.001)*100).toFixed(1)}%)`);
  console.log();

  console.log('  Quarterly breakdown:');
  const qs = Object.keys(res.byQuarter).sort();
  for (const q of qs) {
    const { above: a, below: b } = res.byQuarter[q];
    const aWR = wr(a.w, a.l);
    const bWR = wr(b.w, b.l);
    console.log(`    ${q}  above=${aWR}  below=${bWR}`);
  }
  console.log('\n──────────────────────────────────────────────────────\n');
}

console.log('Done.');
