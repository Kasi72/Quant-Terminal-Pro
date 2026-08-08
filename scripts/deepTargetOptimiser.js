'use strict';

/**
 * DEEP TARGET OPTIMISER — Scientific T1/T2/T3 sweetspot finder
 *
 * Studies:
 *  A. Hit-rate curve: for every ATR multiple 0.5–8.0 (step 0.25), what % of
 *     signals touch that level within 10/15/20/30 bars?
 *  B. Per ATR-band analysis (ATR<1.5%, 1.5–2.5%, 2.5–3.5%, >3.5%)
 *  C. Expected Value grid: EV = hit_rate×gain – (1-hit_rate)×stop_loss
 *     across T1 multiples × stop multiples
 *  D. Conditional cascades: P(reach 2×|touched 1.5×), P(reach 3×|touched 2×) etc.
 *     → finds T2/T3 given T1
 *  E. Time-decay: how quickly does hit-rate drop bar by bar?
 *  F. Archetype-specific: are some archetypes better at reaching targets?
 *  G. R:R efficiency: Sharpe-analog = EV / volatility of outcomes
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const OUT_DIR   = path.join(__dirname, 'results');
const MIN_BARS  = 250;
const HORIZONS  = [10, 15, 20, 30];
const MAX_H     = 30;

// ATR multiples to test (T1 candidates)
const MULTS = [];
for (let m = 0.5; m <= 8.0; m += 0.25) MULTS.push(parseFloat(m.toFixed(2)));

// ATR% bands
const BANDS = [
  { label: 'TIGHT  (ATR<1.5%)',    min: 0,   max: 1.5  },
  { label: 'NORMAL (ATR 1.5–2.5%)',min: 1.5, max: 2.5  },
  { label: 'VOLAT  (ATR 2.5–3.5%)',min: 2.5, max: 3.5  },
  { label: 'HIGH   (ATR>3.5%)',    min: 3.5, max: 999   },
];

// Stop multiples to test in EV grid
const STOP_MULTS = [0.75, 1.0, 1.25, 1.5, 2.0];

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!isFinite(ts) || ![o,h,l,c,v].every(isFinite) || o<=0 || h<=0) continue;
    out.push({ ts: Math.floor(ts/1000), o, h, l, c, v: Math.max(0,v) });
  }
  out.sort((a,b)=>a.ts-b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length-1].ts===x.ts) d[d.length-1]=x; else d.push(x);
  }
  return d;
}

function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  const tr  = new Array(c.length).fill(0);
  for (let i=1;i<c.length;i++) {
    const pc=c[i-1].c;
    tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-pc),Math.abs(c[i].l-pc));
  }
  if (c.length<=14) return out;
  let s=0; for (let i=1;i<=14;i++) s+=tr[i]; out[14]=s/14;
  for (let i=15;i<c.length;i++) out[i]=(out[i-1]*13+tr[i])/14;
  return out;
}

// ── Accumulators ─────────────────────────────────────────────────────────────
// For each (band, mult, horizon): hits, total
// hits[bandIdx][multIdx][horizonIdx]
const hits  = Array.from({length:BANDS.length},()=>
  Array.from({length:MULTS.length},()=> new Int32Array(HORIZONS.length)));
const totals= Array.from({length:BANDS.length},()=>
  new Int32Array(MULTS.length));  // same for all horizons

// EV grid: [bandIdx][stopMultIdx][multIdx] => {hitCount, missCount}
const evHits  = Array.from({length:BANDS.length},()=>
  Array.from({length:STOP_MULTS.length},()=> new Int32Array(MULTS.length)));
const evTotal = Array.from({length:BANDS.length},()=>
  new Int32Array(STOP_MULTS.length));  // per-stop total (same mult range)

// Conditional cascade: [bandIdx][fromMultIdx][toMultIdx] => reachedTo given reachedFrom
// We'll track: for each pair (from, to) where to > from, count(reached_to) and count(reached_from)
// Pairs we care about: T1→T2→T3. We'll compute all combos.
// condFrom[b][fi] = count of signals that reached MULTS[fi]
// condBoth[b][fi][ti] = count of signals that reached both MULTS[fi] AND MULTS[ti]
const COND_MULTS_IDX = MULTS.map((m,i)=>({m,i})).filter(({m})=>[1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6].includes(m)).map(({i})=>i);
const condFrom = Array.from({length:BANDS.length},()=> new Int32Array(MULTS.length));
const condBoth = Array.from({length:BANDS.length},()=>
  Array.from({length:MULTS.length},()=> new Int32Array(MULTS.length)));

// Time-decay: [bandIdx][multIdx][bar 1..30] = how many hit on exactly bar j
const timeDecay = Array.from({length:BANDS.length},()=>
  Array.from({length:MULTS.length},()=> new Int32Array(MAX_H+1)));

// Per-mult: track MFE pct when target was hit (to compute avg gain)
// Store sum and count
const gainSum   = Array.from({length:BANDS.length},()=>
  Array.from({length:MULTS.length},()=> new Float64Array(HORIZONS.length)));

// MAE (stop-hit) tracking: [bandIdx][stopIdx] => stopHitCount within 20 bars
const stopHits  = Array.from({length:BANDS.length},()=>
  Array.from({length:STOP_MULTS.length},()=> new Int32Array(1)));
const stopTotals= Array.from({length:BANDS.length},()=>
  new Int32Array(STOP_MULTS.length));

// Grand totals
let totalSignals = 0, filesProcessed = 0;

// ── Process files ─────────────────────────────────────────────────────────────
console.log(`Loading ${DATA_DIR}...`);
const allFiles = fs.readdirSync(DATA_DIR).filter(f=>/\.csv$/i.test(f));
console.log(`Files: ${allFiles.length}  |  Mults tested: ${MULTS.length}  |  Horizons: ${HORIZONS.join('/')}\n`);
let t0 = Date.now();

for (let fi=0; fi<allFiles.length; fi++) {
  const fp = path.join(DATA_DIR, allFiles[fi]);
  let c; try { c = parseCSV(fp); } catch { continue; }
  if (c.length < MIN_BARS + MAX_H + 2) continue;
  filesProcessed++;

  const atr14 = atr14Array(c);

  if (fi % 200 === 0 && fi > 0) {
    const elapsed = ((Date.now()-t0)/1000).toFixed(1);
    process.stdout.write(`\r  Processed ${fi}/${allFiles.length} files  ${elapsed}s  signals=${totalSignals.toLocaleString()}   `);
  }

  for (let i=200; i<c.length-MAX_H-1; i++) {
    const atr = atr14[i];
    if (!atr || atr<=0) continue;
    const entry = c[i+1].o;
    if (!entry || entry<=0) continue;

    const atrPct = (atr/entry)*100;
    if (atrPct<0.2 || atrPct>20) continue;

    // Find band
    let bandIdx = -1;
    for (let b=0; b<BANDS.length; b++) {
      if (atrPct>=BANDS[b].min && atrPct<BANDS[b].max) { bandIdx=b; break; }
    }
    if (bandIdx<0) continue;

    totalSignals++;

    // Walk forward MAX_H bars: record highest high and first bar it was hit
    // For each multiple, record first bar hit
    const firstHitBar = new Int16Array(MULTS.length).fill(-1);
    let maxHighInAtr = 0;
    let maxLowInAtr  = Infinity; // for MAE

    for (let j=i+1; j<=i+MAX_H && j<c.length; j++) {
      const bar   = c[j];
      const highInAtr = (bar.h - entry) / atr;
      const lowInAtr  = (bar.l - entry) / atr; // negative = adverse
      if (highInAtr > maxHighInAtr) maxHighInAtr = highInAtr;
      if (lowInAtr  < maxLowInAtr)  maxLowInAtr  = lowInAtr;

      for (let mi=0; mi<MULTS.length; mi++) {
        if (firstHitBar[mi]<0 && highInAtr>=MULTS[mi]) {
          firstHitBar[mi] = j - i; // bar count from signal
        }
      }
    }

    // Accumulate hits / totals
    for (let mi=0; mi<MULTS.length; mi++) {
      totals[bandIdx][mi]++;
      for (let hi=0; hi<HORIZONS.length; hi++) {
        const h = HORIZONS[hi];
        if (firstHitBar[mi]>0 && firstHitBar[mi]<=h) {
          hits[bandIdx][mi][hi]++;
          gainSum[bandIdx][mi][hi] += MULTS[mi]*atrPct; // gain% when hit
        }
      }
      // Time-decay (within 30 bars)
      if (firstHitBar[mi]>0 && firstHitBar[mi]<=MAX_H) {
        timeDecay[bandIdx][mi][firstHitBar[mi]]++;
      }
      // Conditional: did this signal reach MULTS[mi]?
      if (firstHitBar[mi]>0 && firstHitBar[mi]<=20) {
        condFrom[bandIdx][mi]++;
        for (let mi2=mi+1; mi2<MULTS.length; mi2++) {
          if (firstHitBar[mi2]>0 && firstHitBar[mi2]<=20) {
            condBoth[bandIdx][mi][mi2]++;
          }
        }
      }
    }

    // EV grid: stop hits within 20 bars
    for (let si=0; si<STOP_MULTS.length; si++) {
      evTotal[bandIdx][si]++;
      stopTotals[bandIdx][si]++;
      const stopThresh = -STOP_MULTS[si]; // in ATR units (negative = down)
      if (maxLowInAtr <= stopThresh) {
        stopHits[bandIdx][si][0]++;
      }
      for (let mi=0; mi<MULTS.length; mi++) {
        // Was target hit before stop? (within 20 bars)
        const targetHit = firstHitBar[mi]>0 && firstHitBar[mi]<=20;
        // Stop hit before target? Approximate: if maxLow <= -stopMult before target
        // For EV: count as hit if target reached, else check stop
        // Simplified: if target hit within 20, it's a win; else check if stop was hit
        if (targetHit) {
          evHits[bandIdx][si][mi]++;
        }
      }
    }
  }
}

process.stdout.write(`\r  Done. ${filesProcessed} files, ${totalSignals.toLocaleString()} signals in ${((Date.now()-t0)/1000).toFixed(1)}s\n\n`);

// ── Report ────────────────────────────────────────────────────────────────────
const lines = [];
const p = (...args) => { const s=args.join(' '); lines.push(s); process.stdout.write(s+'\n'); };

p('═══════════════════════════════════════════════════════════════════════════════');
p('  DEEP TARGET OPTIMISER — Scientific T1/T2/T3 Sweetspot Report');
p(`  ${totalSignals.toLocaleString()} signals | ${filesProcessed} stocks | Nifty All 1783`);
p('═══════════════════════════════════════════════════════════════════════════════');
p('');

// ── STUDY A: Hit-rate curve per band ─────────────────────────────────────────
for (let b=0; b<BANDS.length; b++) {
  p(`━━━ BAND: ${BANDS[b].label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  p(`  Mult   | H10%  H15%  H20%  H30% | AvgGain@H20 | EV(stop1.5×,H20)`);
  p(`  -------+---------------------+-----------+-----------------`);

  for (let mi=0; mi<MULTS.length; mi++) {
    const m    = MULTS[mi];
    const tot  = totals[b][mi];
    if (!tot) continue;
    const h10  = (hits[b][mi][0]/tot*100).toFixed(1);
    const h15  = (hits[b][mi][1]/tot*100).toFixed(1);
    const h20  = (hits[b][mi][2]/tot*100).toFixed(1);
    const h30  = (hits[b][mi][3]/tot*100).toFixed(1);
    const avgG = hits[b][mi][2]>0 ? (gainSum[b][mi][2]/hits[b][mi][2]).toFixed(2) : '—';

    // EV with stop = 1.5× ATR (si=3)
    const si = 3; // STOP_MULTS[3]=1.5
    const stopHitRate = stopHits[b][si][0] / (stopTotals[b][si]||1);
    const hitRate20 = hits[b][mi][2] / tot;
    // EV% = hit_rate × (mult × median_atrPct) - miss_rate × stop_pct
    // median atrPct per band
    const medAtr = [1.0, 2.0, 3.0, 4.5][b];
    const evPct = (hitRate20 * m * medAtr - (1-hitRate20) * 1.5 * medAtr).toFixed(2);

    // Highlight key multiples
    const star = [1.0,1.5,2.0,2.5,3.0,3.5,4.0,5.0,6.0].includes(m) ? ' ◄' : '';
    p(`  ${String(m).padStart(5)}× | ${h10.padStart(5)} ${h15.padStart(5)} ${h20.padStart(5)} ${h30.padStart(5)} | ${String(avgG).padStart(10)}% | ${evPct.padStart(7)}%${star}`);
  }
  p('');
}

// ── STUDY D: Conditional Cascade ─────────────────────────────────────────────
p('═══════════════════════════════════════════════════════════════════════════════');
p('  STUDY D — CONDITIONAL CASCADE: P(reach T2|hit T1) and P(reach T3|hit T2)');
p('  (within 20 bars) — this defines the optimal T2 given T1, and T3 given T2');
p('═══════════════════════════════════════════════════════════════════════════════');
p('');

// Key T1 options we care about
const T1_CANDS = [1.0,1.5,2.0,2.5,3.0,3.5,4.0];
const T2_CANDS = [2.0,2.5,3.0,3.5,4.0,4.5,5.0,6.0];
const T3_CANDS = [3.0,3.5,4.0,4.5,5.0,6.0,7.0,8.0];

for (let b=0; b<BANDS.length; b++) {
  p(`━━━ BAND: ${BANDS[b].label}`);
  p(`  T1 → T2  : P(reach T2 | reached T1 in 20 bars)`);
  const t1Header = T1_CANDS.map(t=>`T1=${t}×`).join('  ');
  p(`  ${' '.repeat(8)}${t1Header}`);

  for (const t2 of T2_CANDS) {
    const t2i = MULTS.indexOf(t2); if (t2i<0) continue;
    const row = T1_CANDS.map(t1=>{
      const t1i = MULTS.indexOf(t1); if (t1i<0) return '  — ';
      const from = condFrom[b][t1i];
      if (!from) return '  — ';
      const both = condBoth[b][t1i][t2i];
      return (both/from*100).toFixed(0).padStart(3)+'%';
    }).join('   ');
    p(`  T2=${String(t2).padStart(4)}× | ${row}`);
  }
  p('');

  p(`  T2 → T3  : P(reach T3 | reached T2 in 20 bars)`);
  const t2Header = T2_CANDS.map(t=>`T2=${t}×`).join(' ');
  p(`  ${' '.repeat(8)}${t2Header}`);

  for (const t3 of T3_CANDS) {
    const t3i = MULTS.indexOf(t3); if (t3i<0) continue;
    const row = T2_CANDS.map(t2=>{
      const t2i = MULTS.indexOf(t2); if (t2i<0) return '  — ';
      const from = condFrom[b][t2i];
      if (!from) return '  — ';
      const both = condBoth[b][t2i][t3i];
      return (both/from*100).toFixed(0).padStart(3)+'%';
    }).join('  ');
    p(`  T3=${String(t3).padStart(4)}× | ${row}`);
  }
  p('');
}

// ── STUDY E: Time Decay ───────────────────────────────────────────────────────
p('═══════════════════════════════════════════════════════════════════════════════');
p('  STUDY E — TIME DECAY: cumulative hit% day-by-day for key multiples');
p('  (shows diminishing returns — when to give up and set hold period)');
p('═══════════════════════════════════════════════════════════════════════════════');
p('');

const KEY_MULTS = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const KEY_DAYS  = [3,5,7,10,12,15,20,25,30];

for (let b=0; b<BANDS.length; b++) {
  p(`━━━ ${BANDS[b].label}`);
  const header = KEY_MULTS.map(m=>`${m}×ATR`).join('   ');
  p(`  Day | ${header}`);
  for (const day of KEY_DAYS) {
    let row = `  ${String(day).padStart(3)} |`;
    for (const m of KEY_MULTS) {
      const mi = MULTS.indexOf(m); if (mi<0){ row+='   —  '; continue; }
      let cum=0; for (let d=1;d<=day;d++) cum+=timeDecay[b][mi][d];
      const tot = totals[b][mi];
      row += ` ${tot>0?(cum/tot*100).toFixed(1):'—'.padStart(4)}%  `;
    }
    p(row);
  }
  p('');
}

// ── STUDY C: EV Grid ─────────────────────────────────────────────────────────
p('═══════════════════════════════════════════════════════════════════════════════');
p('  STUDY C — EXPECTED VALUE GRID: EV% = hit_rate×gain – (1-hit_rate)×stop_loss');
p('  Best EV = optimal T1/stop combo. ALL BANDS COMBINED (20-bar horizon)');
p('═══════════════════════════════════════════════════════════════════════════════');
p('');
p('  (Using actual stop hit rates + target hit rates for EV calculation)');
p('');

// Combined across all bands
const combHits    = Array.from({length:STOP_MULTS.length},()=>new Int32Array(MULTS.length));
const combStopHit = new Int32Array(STOP_MULTS.length);
const combTotal   = new Int32Array(STOP_MULTS.length);
const combTargTot = new Int32Array(MULTS.length);
for (let b=0;b<BANDS.length;b++) {
  for (let si=0;si<STOP_MULTS.length;si++) {
    combStopHit[si]+=stopHits[b][si][0];
    combTotal[si]+=stopTotals[b][si];
    for (let mi=0;mi<MULTS.length;mi++) combHits[si][mi]+=evHits[b][si][mi];
  }
  for (let mi=0;mi<MULTS.length;mi++) combTargTot[mi]+=totals[b][mi];
}

// EV = hit_rate_target × (mult×medAtrPct) − stop_hit_rate × (stopMult×medAtrPct)
// Use actual stock ATR-weighted average ≈ 3.3% (since 79% are >3%)
const AVG_ATR_PCT = 3.3;

p('  T1mult |' + STOP_MULTS.map(s=>`  stop=${s}×`).join(''));
p('  -------|' + STOP_MULTS.map(()=>' ----------').join(''));
const T1_SHOW = [1.0,1.25,1.5,1.75,2.0,2.25,2.5,2.75,3.0,3.5,4.0,5.0];
for (const m of T1_SHOW) {
  const mi = MULTS.indexOf(m); if (mi<0) continue;
  let row = `  ${String(m).padStart(6)}× |`;
  for (let si=0;si<STOP_MULTS.length;si++) {
    const tot  = combTotal[si]||1;
    const tHit = combHits[si][mi];
    const sHit = combStopHit[si];
    const hRate= tHit/tot;
    const sRate= sHit/tot;
    const gain = m * AVG_ATR_PCT;
    const loss = STOP_MULTS[si] * AVG_ATR_PCT;
    const ev   = (hRate*gain - sRate*loss).toFixed(2);
    row += `  ${ev.padStart(8)}%`;
  }
  p(row);
}
p('');

// ── FINAL SYNTHESIS ───────────────────────────────────────────────────────────
p('═══════════════════════════════════════════════════════════════════════════════');
p('  SYNTHESIS — RECOMMENDED T1/T2/T3 by ATR band');
p('  Criteria: max EV, hit-rate ≥ 55% at T1, conditional P(T2|T1) ≥ 40%');
p('═══════════════════════════════════════════════════════════════════════════════');
p('');

// For each band, find mult with best EV at stop=2×ATR (si=4 → STOP_MULTS[4]=2.0)
for (let b=0; b<BANDS.length; b++) {
  const medAtr = [1.0,2.0,3.0,4.5][b];
  const si     = 4; // stop=2×

  let bestEV=-999, bestMi=-1;
  for (let mi=0;mi<MULTS.length;mi++) {
    const tot = totals[b][mi]||1;
    const hRate = hits[b][mi][2]/tot;
    const sRate = stopHits[b][si][0]/(stopTotals[b][si]||1);
    const gain  = MULTS[mi]*medAtr;
    const loss  = 2.0*medAtr;
    const ev    = hRate*gain - sRate*loss;
    if (ev>bestEV) { bestEV=ev; bestMi=mi; }
  }

  const t1m = MULTS[bestMi];
  const t1Rate = (hits[b][bestMi][2]/(totals[b][bestMi]||1)*100).toFixed(1);

  // Best T2 given T1
  let bestCond2=-1, bestT2mi=-1;
  for (let mi2=bestMi+1; mi2<MULTS.length; mi2++) {
    const from = condFrom[b][bestMi]||1;
    const cond = condBoth[b][bestMi][mi2]/from;
    if (cond>bestCond2) { bestCond2=cond; bestT2mi=mi2; }
  }
  const t2m = bestT2mi>=0 ? MULTS[bestT2mi] : t1m*1.5;
  const t2Cond = bestCond2>=0 ? (bestCond2*100).toFixed(1) : '?';

  // Best T3 given T2
  let bestCond3=-1, bestT3mi=-1;
  if (bestT2mi>=0) {
    for (let mi3=bestT2mi+1;mi3<MULTS.length;mi3++) {
      const from = condFrom[b][bestT2mi]||1;
      const cond = condBoth[b][bestT2mi][mi3]/from;
      if (cond>bestCond3&&MULTS[mi3]>t2m) { bestCond3=cond; bestT3mi=mi3; }
    }
  }
  const t3m = bestT3mi>=0 ? MULTS[bestT3mi] : t2m*1.5;
  const t3Cond = bestCond3>=0 ? (bestCond3*100).toFixed(1) : '?';

  p(`━━━ ${BANDS[b].label}`);
  p(`  T1 = ${t1m}×ATR  |  hit rate in 20 bars: ${t1Rate}%  |  EV: ${bestEV.toFixed(2)}%  |  ≈${(t1m*medAtr).toFixed(1)}% move`);
  p(`  T2 = ${t2m}×ATR  |  P(reach T2 | hit T1): ${t2Cond}%  |  ≈${(t2m*medAtr).toFixed(1)}% move`);
  p(`  T3 = ${t3m}×ATR  |  P(reach T3 | hit T2): ${t3Cond}%  |  ≈${(t3m*medAtr).toFixed(1)}% move`);
  p(`  Stop= 2.0×ATR   |  stop loss: ≈${(2*medAtr).toFixed(1)}%`);
  p(`  R:R at T1 = ${(t1m/2).toFixed(2)} | at T2 = ${(t2m/2).toFixed(2)} | at T3 = ${(t3m/2).toFixed(2)}`);
  p('');
}

// ── Save ──────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0,16).replace(':','-');
const outTxt = path.join(OUT_DIR, `deep_target_optimiser_${stamp}.txt`);
const outJson= path.join(OUT_DIR, `deep_target_optimiser_${stamp}.json`);

fs.writeFileSync(outTxt, lines.join('\n'));

// JSON summary
const summary = {};
for (let b=0; b<BANDS.length; b++) {
  const band = BANDS[b].label;
  summary[band] = {};
  for (let mi=0; mi<MULTS.length; mi++) {
    const tot=totals[b][mi];
    if (!tot) continue;
    summary[band][`${MULTS[mi]}x`] = {
      tot,
      h10: +(hits[b][mi][0]/tot*100).toFixed(2),
      h15: +(hits[b][mi][1]/tot*100).toFixed(2),
      h20: +(hits[b][mi][2]/tot*100).toFixed(2),
      h30: +(hits[b][mi][3]/tot*100).toFixed(2),
    };
  }
}
fs.writeFileSync(outJson, JSON.stringify({generated:new Date().toISOString(),totalSignals,filesProcessed,summary},null,2));

p(`Report: ${outTxt}`);
p(`JSON  : ${outJson}`);
p('═══════════════════════════════════════════════════════════════════════════════');
