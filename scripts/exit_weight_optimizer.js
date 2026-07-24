'use strict';
/**
 * exit_weight_optimizer.js  —  Phase 2: Exit weight grid search
 * ==============================================================
 * Reads deep_extract JSON from Phase 1.
 * Re-simulates the T1/T2/T3 cascade for every OOS trade across a grid of:
 *   W1  (first exit weight)   : 0.30 → 0.70 step 0.05
 *   W2  (second exit weight)  : 0.10 → 0.45 step 0.05  (W3 = 1−W1−W2, must >0)
 *   maxHold                   : 10, 12, 15, 18, 20, 25 bars
 *   trailBE                   : false / true  (move stop to entry after T1 hit)
 *
 * Ranked by OOS PF × WR per archetype, with MaxDD and Kelly.
 *
 * Usage: node scripts/exit_weight_optimizer.js <deep_extract_TIMESTAMP.json>
 */

const fs   = require('fs');
const path = require('path');

const ARCH_NAMES = ['ORS','VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','CircuitBreaker'];
const STAGES     = ['BUY','STRONG','ULTRA'];
const BUCKETS    = ['TIGHT','NORMAL','VOLATILE','HIGH'];
const OUT_DIR    = path.join(__dirname, 'results');

// ── Load Phase 1 extract ─────────────────────────────────────────────────────
const extractArg = process.argv[2];
if (!extractArg) {
  // Auto-detect latest deep_extract file
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('deep_extract_')).sort().reverse();
  if (!files.length) { console.error('No deep_extract file found. Run Phase 1 first.'); process.exit(1); }
  process.argv[2] = path.join(OUT_DIR, files[0]);
  console.log(`Auto-detected: ${files[0]}`);
}
const extractPath = process.argv[2];

console.log(`\n📊 Exit Weight Optimizer (Phase 2)`);
console.log(`   Reading: ${extractPath}`);
const { meta, trades } = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const oosTrades = trades.filter(t => t.o === 1);
console.log(`   OOS trades: ${oosTrades.length.toLocaleString()}  (of ${trades.length.toLocaleString()} total)\n`);

// ── Re-simulator ─────────────────────────────────────────────────────────────
function resimulate(t, W1, W2, W3, maxH, trailBE) {
  const { rp: riskPct, p1: t1Pct, p2: t2Pct, p3: t3Pct, bt, cp, mh } = t;
  const actualMax = Math.min(maxH, bt.length);

  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Hit = false;

  for (let j = 0; j < actualMax; j++) {
    const bits = bt[j];
    const cpl  = cp[j];

    const stopHit = (bits & 1) !== 0;
    const t1b     = (bits & 2) !== 0;
    const t2b     = (bits & 4) !== 0;
    const t3b     = (bits & 8) !== 0;
    const beHit   = (bits & 16) !== 0;  // low <= entry (for trail)

    if (phase === 1) {
      if (stopHit && !t1b) {
        // Stop fires before T1 in this bar (conservative: stop checked first)
        wPL -= wLeft * riskPct;
        return wPL;
      }
      if (t1b) {
        wPL  += W1 * t1Pct;
        wLeft = W2 + W3;
        t1Hit = true;
        phase = 2;
        // Check T2 in same bar (fall through)
      }
    }

    if (phase === 2) {
      const stopLevel = trailBE ? beHit : stopHit; // trail to entry after T1
      if (stopLevel && !t2b) {
        wPL -= wLeft * (trailBE ? 0 : riskPct); // BE trail = 0 loss on remaining
        return wPL;
      }
      if (t2b) {
        wPL  += W2 * t2Pct;
        wLeft = W3;
        phase = 3;
      }
    }

    if (phase === 3) {
      const stopLevel = trailBE ? beHit : stopHit;
      if (stopLevel && !t3b) {
        wPL -= wLeft * (trailBE ? 0 : riskPct);
        return wPL;
      }
      if (t3b) {
        wPL += W3 * t3Pct;
        return wPL;
      }
    }

    // Time exit (last bar or maxH reached)
    if (j === actualMax - 1 && wLeft > 0) {
      wPL += wLeft * cpl;
      return wPL;
    }
  }
  return wPL;
}

// ── Grid ─────────────────────────────────────────────────────────────────────
const W1_VALS    = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
const W2_VALS    = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45];
const MH_VALS    = [10, 12, 15, 18, 20, 25];
const TRAIL_VALS = [false, true];

const combos = [];
for (const W1 of W1_VALS)
  for (const W2 of W2_VALS) {
    const W3 = Math.round((1 - W1 - W2) * 1000) / 1000;
    if (W3 <= 0.04) continue;
    for (const maxH of MH_VALS)
      for (const trail of TRAIL_VALS)
        combos.push({ W1, W2, W3, maxH, trail });
  }

console.log(`   Grid: ${combos.length.toLocaleString()} combos × ${oosTrades.length.toLocaleString()} OOS trades`);
console.log(`   (${(combos.length * oosTrades.length / 1e6).toFixed(1)}M simulations)\n`);

// ── Evaluate each combo per archetype ────────────────────────────────────────
// Group OOS trades by archetype
const byArch = Array.from({ length: 6 }, () => []);
for (const t of oosTrades) byArch[t.ai].push(t);

function evalCombo(trades, W1, W2, W3, maxH, trail) {
  let n = 0, wins = 0, sumPL = 0, sumWinPL = 0, sumLossPL = 0;
  let equity = 0, peak = 0, maxDD = 0;
  const rVals = [];

  for (const t of trades) {
    const pl = resimulate(t, W1, W2, W3, maxH, trail);
    const r  = pl / t.rp;
    n++; rVals.push(r);
    sumPL += pl;
    if (pl >= 0) { sumWinPL += pl; wins++; }
    else sumLossPL += Math.abs(pl);
    equity += pl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  if (n < 5) return null;
  const wr    = wins / n * 100;
  const avgPL = sumPL / n;
  const pf    = sumLossPL > 0 ? sumWinPL / sumLossPL : Infinity;
  const avgR  = rVals.reduce((a,b)=>a+b,0) / n;
  const sdR   = Math.sqrt(rVals.reduce((a,b)=>a+(b-avgR)**2,0)/n);
  const kelly = sdR > 0 ? Math.max(0, avgR / (sdR*sdR)) * 100 : 0;
  const score = pf * (wr / 100);  // ranking metric: PF × WinRate

  return { n, wr, avgPL, pf, avgR, kelly, maxDD: maxDD / n, score };
}

const ts0 = Date.now();
const results = {};     // arch → sorted combo results

for (let ai = 0; ai < 6; ai++) {
  const archTrades = byArch[ai];
  const archName   = ARCH_NAMES[ai];

  if (archTrades.length < 10) {
    console.log(`   ${archName}: insufficient OOS trades (${archTrades.length}), skipping`);
    results[archName] = [];
    continue;
  }

  process.stdout.write(`   ${archName} (${archTrades.length.toLocaleString()} OOS): `);

  const rows = [];
  for (const { W1, W2, W3, maxH, trail } of combos) {
    const ev = evalCombo(archTrades, W1, W2, W3, maxH, trail);
    if (ev) rows.push({ W1, W2, W3, maxH, trail, ...ev });
  }
  rows.sort((a,b) => b.score - a.score);
  results[archName] = rows;

  const top = rows[0];
  if (top) {
    console.log(`done.  Best: W1=${top.W1} W2=${top.W2} W3=${top.W3} maxH=${top.maxH} trail=${top.trail}  →  WR=${top.wr.toFixed(1)}% PF=${top.pf.toFixed(2)} AvgPL=${top.avgPL.toFixed(2)}%`);
  } else {
    console.log('no valid combos.');
  }
}

const elapsed = ((Date.now() - ts0) / 1000).toFixed(1);
console.log(`\n   Completed in ${elapsed}s`);

// ── Report top 10 per archetype ───────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const BASELINE = { W1: 0.50, W2: 0.30, W3: 0.20, maxH: 20, trail: false };

console.log('\n\n' + '═'.repeat(130));
console.log('  EXIT WEIGHT OPTIMIZER — Top 10 per archetype (OOS, ranked by PF×WR)');
console.log('  Baseline: W1=0.50 W2=0.30 W3=0.20 maxH=20 trail=false');
console.log('═'.repeat(130));

const recommendations = {};

for (const archName of ARCH_NAMES) {
  const rows = results[archName];
  if (!rows || !rows.length) continue;

  // Baseline performance
  const bl = evalCombo(byArch[ARCH_NAMES.indexOf(archName)], BASELINE.W1, BASELINE.W2, BASELINE.W3, BASELINE.maxH, BASELINE.trail);
  const blStr = bl ? `WR=${bl.wr.toFixed(1)}% PF=${bl.pf.toFixed(2)} AvgPL=${bl.avgPL.toFixed(2)}%` : 'n/a';

  console.log(`\n  ── ${archName} ──────────────────────────────────────────────`);
  console.log(`  Baseline (50/30/20 maxH=20 noTrail): ${blStr}`);
  console.log(`  ${'W1'.padEnd(5)} ${'W2'.padEnd(5)} ${'W3'.padEnd(5)} ${'maxH'.padEnd(5)} ${'trail'.padEnd(6)} ${'WR%'.padEnd(7)} ${'PF'.padEnd(7)} ${'AvgPL%'.padEnd(9)} ${'AvgR'.padEnd(7)} ${'Kelly'.padEnd(7)} ${'Score'.padEnd(8)}`);

  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.W1.toFixed(2).padEnd(5)} ${r.W2.toFixed(2).padEnd(5)} ${r.W3.toFixed(2).padEnd(5)} ` +
      `${String(r.maxH).padEnd(5)} ${(r.trail?'yes':'no').padEnd(6)} ` +
      `${r.wr.toFixed(1).padStart(5)}% ${r.pf.toFixed(2).padStart(6)} ` +
      `${(r.avgPL>=0?'+':'')}${r.avgPL.toFixed(2).padStart(7)}% ` +
      `${(r.avgR>=0?'+':'')}${r.avgR.toFixed(2).padStart(6)} ` +
      `${r.kelly.toFixed(1).padStart(5)}% ${r.score.toFixed(3).padStart(7)}`
    );
  }

  const best = rows[0];
  if (best) recommendations[archName] = { W1: best.W1, W2: best.W2, W3: best.W3, maxH: best.maxH, trail: best.trail };
}

// ── Save results ─────────────────────────────────────────────────────────────
const outFile = path.join(OUT_DIR, `exit_weight_opt_${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ stamp, baseline: BASELINE, results, recommendations }, null, 2));

console.log('\n\n  ── RECOMMENDATIONS ─────────────────────────────────────────────────────────');
for (const [arch, rec] of Object.entries(recommendations)) {
  console.log(`  ${arch.padEnd(18)}: W1=${rec.W1} W2=${rec.W2} W3=${rec.W3} maxHold=${rec.maxH} trailBE=${rec.trail}`);
}
console.log(`\n  Saved: ${outFile}`);
console.log('\n  ✅ Phase 2 complete.\n');
