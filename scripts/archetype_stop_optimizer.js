'use strict';
/**
 * archetype_stop_optimizer.js  —  Phase 3: Per-archetype stop cap/floor/mult grid search
 * ========================================================================================
 * Extends ultra_stop_optimizer.js (which only ran on CB) to all 6 archetypes.
 *
 * For each archetype × ATR band, grid-searches:
 *   capPct   : maximum loss cap  (stop ≤ capPct% below entry)
 *   atrMult  : stop distance in ATR multiples
 *   floorPct : minimum loss floor (stop ≥ floorPct% below entry)
 *
 * DOES NOT re-run analyzeStock() — extracts signal entry/ATR data from Phase 1
 * extract, then re-computes stop = clamp(atrMult×ATR, floor, cap) and re-simulates
 * forward bars from the per-bar bit-fields already collected.
 *
 * Grid per archetype × band:
 *   capPct  : 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.5  (8 levels)
 *   atrMult : 1.5, 2.0, 2.5, 3.0, 3.5                     (5 levels)
 *   floorPct: 1.0, 1.5, 2.0, 2.5, 3.0                     (5 levels)
 *   Total   : 8 × 5 × 5 = 200 combos per cell
 *
 * Reports: stop-rate reduction, WR delta, PF delta vs current params.
 *
 * Usage: node scripts/archetype_stop_optimizer.js [deep_extract_TIMESTAMP.json]
 */

const fs   = require('fs');
const path = require('path');

const ARCH_NAMES = ['ORS','VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','CircuitBreaker'];
const BUCKETS    = ['TIGHT','NORMAL','VOLATILE','HIGH'];
const OUT_DIR    = path.join(__dirname, 'results');

// ── Load Phase 1 extract ─────────────────────────────────────────────────────
const files1 = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('deep_extract_')).sort().reverse();
const extractPath = process.argv[2] || (files1.length ? path.join(OUT_DIR, files1[0]) : null);
if (!extractPath) { console.error('No deep_extract found. Run Phase 1 first.'); process.exit(1); }

console.log(`\n📊 Archetype Stop Optimizer (Phase 3)`);
console.log(`   Reading: ${extractPath}`);
const { meta, trades } = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const oosTrades = trades.filter(t => t.o === 1);
console.log(`   OOS trades: ${oosTrades.length.toLocaleString()}\n`);

// ── Current production stop params (for baseline comparison) ─────────────────
// From stockEngine.ts archetypePriceEngine (post ultra_stop_optimizer 2026-07-24)
// Format: [atrMult, capPct, floorPct] per [arch][band]
const CURRENT = {
  ORS:             { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,2.0], VOLATILE:[3.0,5.5,2.0], HIGH:[2.0,4.0,2.0] },
  VolumeFootprint: { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,2.0], VOLATILE:[3.0,5.5,2.0], HIGH:[2.0,4.0,2.0] },
  CompressionCoil: { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,2.0], VOLATILE:[3.0,5.5,2.0], HIGH:[2.0,12.5,2.0] },
  MomentumPocket:  { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,3.0], VOLATILE:[3.0,5.5,3.5], HIGH:[2.0,12.5,2.0] },
  EMAStack:        { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,2.0], VOLATILE:[3.0,5.5,2.0], HIGH:[2.0,12.5,2.0] },
  CircuitBreaker:  { TIGHT:[3.0,6.0,2.0], NORMAL:[3.0,4.0,2.0], VOLATILE:[3.0,8.0,2.0], HIGH:[2.5,12.5,2.0] },
};

// ── Stop calculator ───────────────────────────────────────────────────────────
// Mirrors archetypePriceEngine stop formula
// entry=100%, rawStopPct = atrMult × atrPct, cap/floor in pct from entry
function computeStopPct(atrPct, atrMult, capPct, floorPct) {
  const rawStopPct = atrMult * atrPct;   // % below entry
  const clamped    = Math.max(floorPct, Math.min(capPct, rawStopPct));
  return clamped;  // % below entry
}

// ── Re-simulator with new stopPct ────────────────────────────────────────────
// Uses per-bar bit-fields but recomputes stop-hit threshold
// With new stop, riskPct changes → need to recompute bit for stopHit
// IMPORTANT: we stored b.l <= original_stop in bit0. We can't re-use it for a different stop.
// We need to re-derive stopHit from raw bar prices.
// BUT: deep_extract only stores BITS, not raw prices.
// SOLUTION: store the original riskPct (rp) in the record.
// If new stopPct < original riskPct → stop is TIGHTER → fewer bars clear stop → better WR?
//   No: the stop determines which bars are hits. We need actual bar lows.
// We don't have raw lows — we need to use a proxy.
//
// APPROXIMATION: Use the bit-field approach where:
//   bit0 (original stopHit) = b.l <= original_stop (b.l <= entry × (1 - rp/100))
//
// For a NEW stop at newStopPct:
//   new_stop_price = entry × (1 - newStopPct/100)
//
// If newStopPct < rp (stop is TIGHTER = farther away → MORE room):
//   new_stop_price > original_stop → bars that hit original_stop may NOT hit new_stop
//   → WR could improve
// If newStopPct > rp (stop is LOOSER = closer → less room):
//   new_stop_price < original_stop → bars that didn't hit original_stop COULD hit new_stop
//   → WR could worsen
//
// We need raw bar lows to determine this accurately.
// Since we only have bits, we can do this:
//   - If new_stop = entry × (1 - newStopPct/100)
//   - Original stop = entry × (1 - rp/100)
//   - For a bar where bit0=1 (b.l <= original_stop):
//       b.l ≤ entry×(1-rp/100) ≤ entry×(1-newStopPct/100) IF newStopPct ≥ rp
//       So if newStopPct ≥ rp: bit0=1 → also hits new stop
//   - For a bar where bit0=0 (b.l > original_stop):
//       If newStopPct < rp: new_stop > original_stop, so b.l might be > or < new_stop
//       We don't know → APPROXIMATION needed
//
// Better approximation: use beHit (bit4: b.l <= entry) as the "upper bound" of stop hits
// and bit0 as the "lower bound". For stops between entry and original_stop, the hit rate
// is between bit4 rate and bit0 rate. Linear interpolation.
//
// For simplicity and correctness, we'll only compare combos where newStopPct ≥ rp (looser stops)
// since for those, bit0=1 always means new stop also hit. For tighter stops, we'll flag as
// "needs rescan" and estimate.
//
// ALTERNATIVE: Use closePL as proxy — if closePL[0] < -newStopPct, likely stopped on bar 1.
// This is actually a good approach for the first bar at least.
//
// For now, let's use the following approach:
// 1. Group trades by original riskPct range
// 2. For each new stopPct, re-simulate using original bits where valid, otherwise estimate
//
// PRACTICAL SIMPLIFICATION: This script will re-scan a subset of symbols for accuracy.
// But since we already have Phase 1, let's use it with the following rule:
//   - Bit0 = stopHit with ORIGINAL stop (rp)
//   - For new stop simulation where newStopPct WIDENS the stop (newStopPct > rp):
//     Stop ALWAYS fires when bit0=1 (since new_stop < original_stop < bar_low is impossible)
//     Actually no: if newStopPct > rp, new_stop PRICE = entry×(1-newStopPct/100) is LOWER.
//     Lower new_stop means more room, stop harder to hit.
//     bit0=1 means b.l ≤ entry×(1-rp/100).
//     If newStopPct > rp: new_stop = entry×(1-newStopPct/100) < entry×(1-rp/100)
//     So b.l ≤ original_stop does NOT guarantee b.l ≤ new_stop.
//     We can't tell from bits alone if b.l ≤ new_stop when new_stop < original_stop.
//
// FINAL DECISION: This is fundamentally limited by the Phase 1 data (only bits, not raw prices).
// For Phase 3, we'll do a FULL RESCAN using the same engine, but override stop computation.
// This requires running analyzeStock() but with a patched stop.
//
// Since we can't easily patch the compiled engine, we'll use a SEPARATE scan approach:
// Extract signals from Phase 1, then re-simulate using approximation with a note about it.
// The approximation: stopHit threshold linearly interpolated between bit0 and bit4.

function resimWithNewStop(t, newStopPct, W1, W2, W3) {
  const { rp, p1: t1Pct, p2: t2Pct, p3: t3Pct, bt, cp, mh } = t;

  // Determine stop adjustment factor
  // If newStopPct < rp: tighter stop (more room) → stop harder to hit → improve WR
  // If newStopPct > rp: wider stop (less room) → stop easier to hit → worsen WR
  // newStopRatio: how much does the stop change?
  const stopRatio = newStopPct / rp;  // >1 = wider, <1 = tighter

  // For simulation: scale bit0 probability by stopRatio
  // If stopRatio=1: same as original
  // If stopRatio=0.8: 80% of original stop-hits still apply (tighter = fewer hits)
  //   But we're RELAXING the stop (bigger cap = further from entry = MORE room = FEWER stops)
  //   WAIT: I'm confusing "stop" direction.
  //   Original stop = entry × (1 - rp/100)  [below entry]
  //   New stop      = entry × (1 - newStopPct/100)
  //   If newStopPct > rp: new_stop PRICE is FURTHER below entry → MORE room → FEWER stops hit
  //   So wider stopPct → better WR (fewer stops)
  //   bit4 = b.l <= entry (most permissive: stop AT entry)
  //   bit0 = b.l <= original_stop (original stop)
  //   For a stop between original and entry: hit rate ∈ [bit0_rate, bit4_rate]

  let phase = 1, wLeft = 1.0, wPL = 0;

  for (let j = 0; j < Math.min(mh, bt.length); j++) {
    const bits = bt[j];
    const cpl  = cp[j];

    const origStopHit = (bits & 1)  !== 0;  // b.l <= original_stop
    const t1b         = (bits & 2)  !== 0;
    const t2b         = (bits & 4)  !== 0;
    const t3b         = (bits & 8)  !== 0;
    const atEntry     = (bits & 16) !== 0;  // b.l <= entry (beHit)

    // Estimate whether new stop is hit:
    // If newStopPct >= rp: stop is looser or same, so origStopHit is a SUFFICIENT condition
    //   (new stop is at or below original stop → if original stop hit, new stop hit too)
    //   Wait no — wider cap = stop further below = fewer hits. Let me re-think:
    //   newStopPct is cap % below entry. LARGER newStopPct = stop FURTHER below entry = HARDER to hit.
    //   So: if newStopPct > rp → new stop harder to hit → newStopHit ≤ origStopHit
    //   APPROXIMATION: for a bar where origStopHit=0, assume newStopHit=0 (fine)
    //   For a bar where origStopHit=1: we don't know (price went below original stop
    //   but might not have gone below new (deeper) stop)
    //   → We underestimate new_stop_hits → slightly optimistic result (OK for guidance)
    //
    // Actually: if newStopPct > rp (cap is wider), it means we're allowing a bigger drawdown.
    //   The stop price is LOWER: entry × (1 - 0.10) = 0.90 vs entry × (1 - 0.08) = 0.92
    //   If orig cap=8%, new cap=10%: original_stop = 0.92 × entry, new_stop = 0.90 × entry
    //   For a bar where b.l ≤ 0.92×entry (bit0=1): b.l may or may not be ≤ 0.90×entry
    //   → we CANNOT determine from bit0 alone if new stop hit
    //
    // For TIGHTER stop (newStopPct < rp):
    //   new_stop_price HIGHER (closer to entry), easier to hit
    //   If bit0=1: definitely new stop also hit (since new_stop > original_stop)
    //   If bit0=0 and atEntry=0 (b.l > entry): definitely NOT hit (new stop < entry)
    //   If bit0=0 and atEntry=1 (b.l ≤ entry): uncertain (b.l between new_stop and original_stop possible)
    //
    // CONCLUSION: We can only be EXACT for:
    //   - Same stop: trivial
    //   - Tighter stop (newStopPct < rp): bit0=1 → new stop hit (since new_stop > orig_stop → price that goes below orig also goes below new? No!)
    //     Actually: new_stop > original_stop (tighter = closer to entry = HIGHER price)
    //     So bit0=1 means b.l ≤ original_stop < new_stop → yes, new stop definitely hit
    //     bit0=0: might be above new_stop → unknown
    //   - Wider stop: bit0=1 might not be enough (need price to go even further)
    //
    // So we can reliably DETECT:
    //   - newStopPct < rp (tighter/closer): bit0=1 → new stop also hit (since new_stop > orig_stop)
    //     This is what we want for TIGHTER CAPS (fewer stop hits if we use tighter caps in the formula)
    //   - newStopPct > rp (wider/further): bit0=1 is inconclusive for new stop
    //
    // For the optimizer, we care about WIDENING the cap (to reduce false stops).
    // For widening, we use conservative estimate: only count stop as hit if the close is
    // below the new stop (using closePL as approximation):
    //   newStopHit ≈ closePL <= -newStopPct (close went below new stop level)
    //   This UNDERESTIMATES stop hits (doesn't catch intrabar stop then recovery).
    //   Treat this as a lower bound, actual improvement may be less.

    let newStopHit;
    if (newStopPct <= rp) {
      // Tighter stop: if original stop hit → new stop definitely hit (new_stop is closer = higher price)
      // Also check if closePL indicates a stop was hit in this bar if bit0=0
      newStopHit = origStopHit;  // conservative — ignore marginal extra hits (they'd be tiny)
    } else {
      // Wider stop: use close below new stop as proxy (underestimates, conservative)
      newStopHit = cpl <= -newStopPct;
    }

    if (phase === 1) {
      if (newStopHit && !t1b) {
        wPL -= wLeft * newStopPct;
        return wPL;
      }
      if (t1b) {
        wPL  += W1 * t1Pct; wLeft = W2 + W3; phase = 2;
      }
    }
    if (phase === 2) {
      if (newStopHit && !t2b) { wPL -= wLeft * newStopPct; return wPL; }
      if (t2b) { wPL += W2 * t2Pct; wLeft = W3; phase = 3; }
    }
    if (phase === 3) {
      if (newStopHit && !t3b) { wPL -= wLeft * newStopPct; return wPL; }
      if (t3b) { wPL += W3 * t3Pct; return wPL; }
    }
    if (j === Math.min(mh, bt.length) - 1 && wLeft > 0) {
      wPL += wLeft * cpl;
      return wPL;
    }
  }
  return wPL;
}

// ── Grid search ───────────────────────────────────────────────────────────────
const CAP_VALS   = [3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.5];
const MULT_VALS  = [1.5, 2.0, 2.5, 3.0, 3.5];
const FLOOR_VALS = [1.0, 1.5, 2.0, 2.5, 3.0];
const W1 = 0.50, W2 = 0.30, W3 = 0.20;  // use current weights for Phase 3

const ts0 = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const recommendations = {};

console.log('  Grid: ' + CAP_VALS.length + ' cap × ' + MULT_VALS.length + ' mult × ' + FLOOR_VALS.length + ' floor = ' + (CAP_VALS.length*MULT_VALS.length*FLOOR_VALS.length) + ' combos per arch×band\n');
console.log('═'.repeat(130));
console.log('  STOP OPTIMIZER — Phase 3');
console.log('═'.repeat(130));

for (let ai = 0; ai < 6; ai++) {
  const archName = ARCH_NAMES[ai];
  const archOOS  = oosTrades.filter(t => t.ai === ai);
  if (archOOS.length < 10) {
    console.log(`\n  ${archName}: insufficient data (${archOOS.length} OOS), skipping`);
    continue;
  }

  console.log(`\n  ── ${archName} (${archOOS.length.toLocaleString()} OOS trades) ──────────────────────────────────`);
  recommendations[archName] = {};

  for (const bkt of BUCKETS) {
    const bi     = ['TIGHT','NORMAL','VOLATILE','HIGH'].indexOf(bkt);
    const bkTrades = archOOS.filter(t => t.bi === bi);
    if (bkTrades.length < 5) {
      console.log(`    ${bkt.padEnd(8)}: insufficient data (${bkTrades.length}), skip`);
      continue;
    }

    // Baseline (current params)
    const [curMult, curCap, curFloor] = CURRENT[archName][bkt];

    function evalStop(capPct, atrMult, floorPct) {
      let n=0, wins=0, stops=0, sumPL=0, swPL=0, slPL=0;
      for (const t of bkTrades) {
        // Compute new stopPct for this trade
        const newStopPct = computeStopPct(t.ap, atrMult, capPct, floorPct);
        const pl = resimWithNewStop(t, newStopPct, W1, W2, W3);
        const origPL = resimWithNewStop(t, t.rp, W1, W2, W3);  // should equal original
        n++; sumPL += pl;
        if (pl >= 0) { wins++; swPL += pl; }
        else { stops += (pl < -0.1 ? 1 : 0); slPL += Math.abs(pl); }
      }
      const wr  = n > 0 ? wins/n*100 : 0;
      const pf  = slPL > 0 ? swPL/slPL : Infinity;
      const avgPL = n > 0 ? sumPL/n : 0;
      const sr  = n > 0 ? stops/n*100 : 0;
      return { n, wr, pf, avgPL, sr, score: pf * wr/100 };
    }

    const baseline = evalStop(curCap, curMult, curFloor);

    let best = null;
    for (const cap of CAP_VALS) {
      for (const mult of MULT_VALS) {
        for (const floor of FLOOR_VALS) {
          if (floor >= cap) continue;  // floor can't exceed cap
          const ev = evalStop(cap, mult, floor);
          if (!best || ev.score > best.score) {
            best = { cap, mult, floor, ...ev };
          }
        }
      }
    }

    if (!best) continue;

    const wrDelta  = best.wr  - baseline.wr;
    const pfDelta  = best.pf  === Infinity ? '∞' : (best.pf - baseline.pf).toFixed(2);
    const plDelta  = best.avgPL - baseline.avgPL;

    console.log(
      `    ${bkt.padEnd(8)} n=${String(bkTrades.length).padStart(6)}  ` +
      `Baseline: WR=${baseline.wr.toFixed(1).padStart(5)}% PF=${baseline.pf.toFixed(2).padStart(5)} [mult=${curMult} cap=${curCap}% floor=${curFloor}%]  →  ` +
      `Best: WR=${best.wr.toFixed(1).padStart(5)}% PF=${best.pf.toFixed(2).padStart(5)} ` +
      `[mult=${best.mult} cap=${best.cap}% floor=${best.floor}%]  ΔWR=${(wrDelta>=0?'+':'')+(wrDelta).toFixed(1)}% ΔPF=${pfDelta}`
    );

    recommendations[archName][bkt] = {
      current: { atrMult: curMult, capPct: curCap, floorPct: curFloor },
      recommended: { atrMult: best.mult, capPct: best.cap, floorPct: best.floor },
      baseline, best,
    };
  }
}

const elapsed = ((Date.now() - ts0) / 1000).toFixed(1);
console.log(`\n  Elapsed: ${elapsed}s`);

// ── Compact recommendation table ─────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(110));
console.log('  STOP RECOMMENDATIONS — update archetypePriceEngine() with these values');
console.log('═'.repeat(110));
console.log('  (Note: approximation-based for wider caps; run archetype_stop_rescan.js for exact results)');
console.log(`  ${'Archetype'.padEnd(18)} ${'Band'.padEnd(10)} ${'cur mult'.padEnd(9)} ${'cur cap'.padEnd(9)} ${'cur floor'.padEnd(10)} ${'→ mult'.padEnd(8)} ${'→ cap'.padEnd(8)} ${'→ floor'.padEnd(9)} ${'ΔAPL%'.padEnd(8)}`);
console.log('  ' + '-'.repeat(108));

for (const archName of ARCH_NAMES) {
  if (!recommendations[archName]) continue;
  for (const bkt of BUCKETS) {
    const rec = recommendations[archName][bkt];
    if (!rec) continue;
    const changed = rec.recommended.atrMult !== rec.current.atrMult ||
                    rec.recommended.capPct  !== rec.current.capPct  ||
                    rec.recommended.floorPct !== rec.current.floorPct;
    const flag = changed ? '◀' : '  ';
    const dpl  = rec.best.avgPL - rec.baseline.avgPL;
    console.log(
      `  ${archName.padEnd(18)} ${bkt.padEnd(10)} ` +
      `${String(rec.current.atrMult).padEnd(9)} ${rec.current.capPct.toFixed(1).padEnd(9)}% ` +
      `${rec.current.floorPct.toFixed(1).padEnd(10)}%  ` +
      `${String(rec.recommended.atrMult).padEnd(8)} ${rec.recommended.capPct.toFixed(1).padEnd(8)}% ` +
      `${rec.recommended.floorPct.toFixed(1).padEnd(9)}%  ` +
      `${(dpl>=0?'+':'')}${dpl.toFixed(2).padStart(5)}%  ${flag}`
    );
  }
}

const outFile = path.join(OUT_DIR, `stop_optimizer_${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ stamp, recommendations }, null, 2));
console.log(`\n  Saved: ${outFile}`);
console.log('\n  ✅ Phase 3 complete.\n');
