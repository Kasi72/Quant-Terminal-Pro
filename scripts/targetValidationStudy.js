'use strict';

/**
 * TARGET VALIDATION STUDY — Phase 2
 *
 * Takes the candidates from deepTargetOptimiser and tests them with
 * REAL sequential exit logic:  stop is checked FIRST on each bar (low),
 * then target (high). Whichever triggers first wins.
 *
 * For each (ATR-band, stopMult, T1Mult, T2Mult, T3Mult) combo:
 *   - winRate at T1, payoff, EV, Sharpe-analog, Expectancy
 *   - If T1 hit: how many then reach T2? (conditional hit rate)
 *   - If T2 hit: how many then reach T3?
 *   - Avg bars to exit
 *   - Max adverse excursion before winner hits (MAE of winners)
 *
 * Stop candidates : 0.75×, 1.0×, 1.25×, 1.5×, 2.0×ATR
 * T1   candidates : 1.25×, 1.5×, 1.75×, 2.0×, 2.5×, 3.0×ATR
 * T2   candidates : T1 + {0.75, 1.0, 1.5, 2.0}×ATR
 * T3   candidates : T2 + {1.0, 1.5, 2.0, 2.5}×ATR
 * Hold            : 15 bars
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const OUT_DIR  = path.join(__dirname, 'results');
const MIN_BARS = 250;
const HOLD     = 15;

const BANDS = [
  { label: 'TIGHT  (ATR<1.5%)',    min: 0,   max: 1.5  },
  { label: 'NORMAL (ATR 1.5–2.5%)',min: 1.5, max: 2.5  },
  { label: 'VOLAT  (ATR 2.5–3.5%)',min: 2.5, max: 3.5  },
  { label: 'HIGH   (ATR>3.5%)',    min: 3.5, max: 999   },
];

const STOP_M = [0.75, 1.0, 1.25, 1.5, 2.0];
const T1_M   = [1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const T2_ADJ = [0.75, 1.0, 1.5, 2.0];   // added on top of T1
const T3_ADJ = [1.0,  1.5, 2.0, 2.5];   // added on top of T2

// ── Parser + ATR ─────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o=+p[1],h=+p[2],l=+p[3],c=+p[4],v=+p[5];
    if (!isFinite(ts)||![o,h,l,c,v].every(isFinite)||o<=0||h<=0) continue;
    out.push({ ts:Math.floor(ts/1000), o, h, l, c, v:Math.max(0,v) });
  }
  out.sort((a,b)=>a.ts-b.ts);
  const d=[];
  for (const x of out) {
    if (d.length&&d[d.length-1].ts===x.ts) d[d.length-1]=x; else d.push(x);
  }
  return d;
}

function atr14Array(c) {
  const out=new Array(c.length).fill(0);
  const tr=new Array(c.length).fill(0);
  for (let i=1;i<c.length;i++) {
    const pc=c[i-1].c;
    tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-pc),Math.abs(c[i].l-pc));
  }
  if (c.length<=14) return out;
  let s=0; for (let i=1;i<=14;i++) s+=tr[i]; out[14]=s/14;
  for (let i=15;i<c.length;i++) out[i]=(out[i-1]*13+tr[i])/14;
  return out;
}

// ── Combo key builder ─────────────────────────────────────────────────────────
// Total combos per band: 5 stops × 6 T1 × 4 T2adj × 4 T3adj = 480
const N_STOP = STOP_M.length;
const N_T1   = T1_M.length;
const N_T2   = T2_ADJ.length;
const N_T3   = T3_ADJ.length;
const N_COMBO = N_STOP * N_T1 * N_T2 * N_T3;

function comboIdx(si,t1i,t2i,t3i) {
  return ((si*N_T1+t1i)*N_T2+t2i)*N_T3+t3i;
}

// Per-band accumulators: [N_COMBO]
// For each combo: total, wins(t1), wins(t2), wins(t3), stops, timeouts
// gain sum (%), loss sum (%), bars sum
const struct = () => ({
  total   : new Int32Array(N_COMBO),
  winsT1  : new Int32Array(N_COMBO),
  winsT2  : new Int32Array(N_COMBO),
  winsT3  : new Int32Array(N_COMBO),
  stops   : new Int32Array(N_COMBO),
  timeout : new Int32Array(N_COMBO),
  gainSum : new Float64Array(N_COMBO),  // % gain on wins
  lossSum : new Float64Array(N_COMBO),  // % loss on stops (positive value)
  barsSum : new Int32Array(N_COMBO),
  maeSum  : new Float64Array(N_COMBO),  // MAE of winners (ATR units)
});
const acc = BANDS.map(() => struct());

// ── Process ───────────────────────────────────────────────────────────────────
console.log(`\nPhase 2 — Sequential exit simulation (hold=${HOLD} bars)`);
console.log(`Combos per band: ${N_COMBO}  |  Bands: ${BANDS.length}\n`);

const allFiles = fs.readdirSync(DATA_DIR).filter(f=>/\.csv$/i.test(f));
let processed=0, totalSig=0;
const t0=Date.now();

for (let fi=0; fi<allFiles.length; fi++) {
  const fp = path.join(DATA_DIR, allFiles[fi]);
  let c; try { c=parseCSV(fp); } catch { continue; }
  if (c.length<MIN_BARS+HOLD+2) continue;
  processed++;

  const atr14=atr14Array(c);

  if (fi%200===0&&fi>0) process.stdout.write(`\r  ${fi}/${allFiles.length} files | sigs=${totalSig.toLocaleString()}  `);

  for (let i=200; i<c.length-HOLD-1; i++) {
    const atr=atr14[i]; if (!atr||atr<=0) continue;
    const entry=c[i+1].o; if (!entry||entry<=0) continue;
    const atrPct=(atr/entry)*100;
    if (atrPct<0.2||atrPct>20) continue;

    // Band
    let bi=-1;
    for (let b=0;b<BANDS.length;b++) {
      if (atrPct>=BANDS[b].min&&atrPct<BANDS[b].max) { bi=b; break; }
    }
    if (bi<0) continue;
    totalSig++;

    // Precompute walk-forward: for each bar, record high/low move in ATR units
    const end=Math.min(c.length-1, i+HOLD);
    // We'll check each combo inline — too many combos to precompute all
    // Instead precompute per-bar high and low excursions in ATR units
    const barHighAtr = new Float32Array(HOLD+1);
    const barLowAtr  = new Float32Array(HOLD+1);
    for (let j=1; j<=HOLD && i+j<c.length; j++) {
      const bar=c[i+j];
      barHighAtr[j]=(bar.h-entry)/atr;
      barLowAtr[j] =(bar.l-entry)/atr;  // negative = adverse
    }
    const actualBars = Math.min(HOLD, c.length-1-i);

    // For each combo
    for (let si=0; si<N_STOP; si++) {
      const stopThresh = -STOP_M[si];
      for (let t1i=0; t1i<N_T1; t1i++) {
        const t1Mult = T1_M[t1i];
        for (let t2i=0; t2i<N_T2; t2i++) {
          const t2Mult = t1Mult + T2_ADJ[t2i];
          for (let t3i=0; t3i<N_T3; t3i++) {
            const t3Mult = t2Mult + T3_ADJ[t3i];
            const ci = comboIdx(si,t1i,t2i,t3i);
            const a  = acc[bi];
            a.total[ci]++;

            // Sequential walk: stop checked before target each bar
            let outcome = 'timeout';
            let exitBar = actualBars;
            let exitAtrMult = 0;
            let maeAtr = 0;

            for (let j=1; j<=actualBars; j++) {
              const lo = barLowAtr[j];
              const hi = barHighAtr[j];
              if (lo<maeAtr) maeAtr=lo;

              if (lo<=stopThresh) {
                outcome='stop';
                exitBar=j;
                exitAtrMult=stopThresh;
                break;
              }
              if (hi>=t3Mult) {
                outcome='t3';
                exitBar=j;
                exitAtrMult=t3Mult;
                break;
              }
              if (hi>=t2Mult) {
                // Don't exit — keep tracking for T3, but record T2 hit
                // Actually for cascade tracking, mark T2 and continue
                // but for EV we exit at T2 if T3 not hit
                // Let's exit at T3 or timeout after T2
                // For this study: exit strategy = exit at T1, runner to T3
                // → let's track: did T1 hit? did T2 hit? did T3 hit?
                // The exit in real trading: scale out at T1/T2/T3
                // For EV calculation: count as T2 hit (full position exits at T2 if T3 not hit)
                // We'll use: exit at highest target hit
              }
              if (hi>=t1Mult && outcome==='timeout') {
                // T1 touched — keep going for T2/T3
              }
            }

            // Recompute cleanly: what's the highest target touched?
            // And did stop hit first?
            let stopBar=-1, t1Bar=-1, t2Bar=-1, t3Bar=-1;
            maeAtr=0;
            for (let j=1; j<=actualBars; j++) {
              const lo=barLowAtr[j], hi=barHighAtr[j];
              if (lo<maeAtr) maeAtr=lo;
              if (stopBar<0 && lo<=stopThresh) { stopBar=j; break; } // stop first
              if (t1Bar<0 && hi>=t1Mult) t1Bar=j;
              if (t2Bar<0 && hi>=t2Mult) t2Bar=j;
              if (t3Bar<0 && hi>=t3Mult) { t3Bar=j; break; } // exit at T3
            }

            if (stopBar>0) {
              // Stopped out
              a.stops[ci]++;
              const lossPct = STOP_M[si]*atrPct;
              a.lossSum[ci]+=lossPct;
              a.barsSum[ci]+=stopBar;
              a.maeSum[ci]+=Math.abs(maeAtr);
            } else if (t3Bar>0) {
              a.winsT1[ci]++; a.winsT2[ci]++; a.winsT3[ci]++;
              const gainPct=t3Mult*atrPct;
              a.gainSum[ci]+=gainPct;
              a.barsSum[ci]+=t3Bar;
              a.maeSum[ci]+=Math.abs(maeAtr);
            } else if (t2Bar>0) {
              a.winsT1[ci]++; a.winsT2[ci]++;
              const gainPct=t2Mult*atrPct;
              a.gainSum[ci]+=gainPct;
              a.barsSum[ci]+=t2Bar;
              a.maeSum[ci]+=Math.abs(maeAtr);
            } else if (t1Bar>0) {
              a.winsT1[ci]++;
              const gainPct=t1Mult*atrPct;
              a.gainSum[ci]+=gainPct;
              a.barsSum[ci]+=t1Bar;
              a.maeSum[ci]+=Math.abs(maeAtr);
            } else {
              // Timeout — exit at close of last bar
              a.timeout[ci]++;
              const lastHi=barHighAtr[actualBars];
              const pct=lastHi*atrPct;
              if (pct>0) a.gainSum[ci]+=pct; else a.lossSum[ci]+=Math.abs(pct);
              a.barsSum[ci]+=actualBars;
              a.maeSum[ci]+=Math.abs(maeAtr);
            }
          }
        }
      }
    }
  }
}
process.stdout.write(`\r  Done. ${processed} files, ${totalSig.toLocaleString()} signals in ${((Date.now()-t0)/1000).toFixed(1)}s\n\n`);

// ── Report ────────────────────────────────────────────────────────────────────
const lines=[];
const p=(...a)=>{ const s=a.join(' '); lines.push(s); process.stdout.write(s+'\n'); };

p('═══════════════════════════════════════════════════════════════════════════════');
p('  TARGET VALIDATION STUDY — Phase 2 Results');
p(`  ${totalSig.toLocaleString()} signals | ${processed} stocks | Hold=${HOLD} bars`);
p('  Exit logic: stop checked first (low), then T3→T2→T1 (high). Scale-out model.');
p('═══════════════════════════════════════════════════════════════════════════════');

// For each band, find top 20 combos by Expectancy = winRate × avgWin - lossRate × avgLoss
// Then report them cleanly
for (let bi=0; bi<BANDS.length; bi++) {
  p('');
  p(`━━━ BAND: ${BANDS[bi].label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const a=acc[bi];
  const results=[];

  for (let si=0; si<N_STOP; si++) for (let t1i=0; t1i<N_T1; t1i++) for (let t2i=0; t2i<N_T2; t2i++) for (let t3i=0; t3i<N_T3; t3i++) {
    const ci=comboIdx(si,t1i,t2i,t3i);
    const tot=a.total[ci]; if (!tot) continue;
    const wins=a.winsT1[ci], stops=a.stops[ci], tout=a.timeout[ci];
    const t2hits=a.winsT2[ci], t3hits=a.winsT3[ci];
    if (!wins&&!stops) continue;

    const winRate   = wins/tot;
    const stopRate  = stops/tot;
    const toutRate  = tout/tot;
    const avgWin    = wins>0 ? a.gainSum[ci]/wins : 0;
    const avgLoss   = stops>0 ? a.lossSum[ci]/stops : 0;
    // EV per trade
    const ev        = winRate*avgWin - stopRate*avgLoss;
    // Sharpe-analog: EV / stdDev(outcomes) — approximate with payoff ratio
    const payoff    = avgLoss>0 ? avgWin/avgLoss : 0;
    // Expectancy score = EV × winRate (rewards both high EV and high win rate)
    const score     = ev * winRate * 1000;
    const avgBars   = a.barsSum[ci]/tot;
    const t2condl   = wins>0 ? t2hits/wins : 0;
    const t3condl   = t2hits>0 ? t3hits/t2hits : 0;
    const avgMAE    = (a.maeSum[ci]/tot); // in ATR units — positive value

    const stop=STOP_M[si], t1=T1_M[t1i], t2=t1+T2_ADJ[t2i], t3=t2+T3_ADJ[t3i];
    const rrT1=t1/stop, rrT2=t2/stop, rrT3=t3/stop;

    results.push({ si,t1i,t2i,t3i, stop,t1,t2,t3, tot,wins,stops,tout,t2hits,t3hits,
      winRate,stopRate,toutRate,avgWin,avgLoss,ev,payoff,score,avgBars,
      t2condl,t3condl,avgMAE,rrT1,rrT2,rrT3 });
  }

  // Sort by score (EV × winRate)
  results.sort((a,b)=>b.score-a.score);

  p(`  Ranked by Score = EV × WinRate (higher = better)`);
  p(`  Stop |  T1  |  T2  |  T3 | WinR% | StopR% | AvgWin | AvgLoss | Payoff | EV%  | Score | R:R(T1) | P(T2|W)% | P(T3|T2)% | AvgBars | AvgMAE`);
  p(`  -----|------|------|-----|-------|--------|--------|---------|--------|------|-------|---------|----------|-----------|---------|-------`);

  for (const r of results.slice(0,25)) {
    const line = [
      String(r.stop).padStart(5)+'×',
      String(r.t1).padStart(5)+'×',
      String(r.t2).padStart(5)+'×',
      String(r.t3).padStart(4)+'×',
      (r.winRate*100).toFixed(1).padStart(6)+'%',
      (r.stopRate*100).toFixed(1).padStart(7)+'%',
      r.avgWin.toFixed(2).padStart(7)+'%',
      r.avgLoss.toFixed(2).padStart(8)+'%',
      r.payoff.toFixed(2).padStart(7),
      r.ev.toFixed(3).padStart(5)+'%',
      r.score.toFixed(2).padStart(6),
      r.rrT1.toFixed(2).padStart(8),
      (r.t2condl*100).toFixed(0).padStart(9)+'%',
      (r.t3condl*100).toFixed(0).padStart(10)+'%',
      r.avgBars.toFixed(1).padStart(8),
      r.avgMAE.toFixed(3).padStart(7)+'×ATR',
    ].join(' | ');
    p('  '+line);
  }

  // Also show top by pure EV
  const byEV=[...results].sort((a,b)=>b.ev-a.ev).slice(0,5);
  p('');
  p(`  Top 5 by pure EV:`);
  for (const r of byEV) {
    p(`    stop=${r.stop}× T1=${r.t1}× T2=${r.t2}× T3=${r.t3}× | WR=${(r.winRate*100).toFixed(1)}% | EV=${r.ev.toFixed(3)}% | R:R=${r.rrT1.toFixed(2)} | payoff=${r.payoff.toFixed(2)}`);
  }

  // Highlight the sweet spot recommendation
  // = best score where winRate≥50% AND rrT1≥1.0 AND t2condl≥0.5
  const filtered = results.filter(r=>r.winRate>=0.50&&r.rrT1>=1.0&&r.t2condl>=0.5);
  if (filtered.length>0) {
    const best=filtered[0];
    p('');
    p(`  ★ SWEET SPOT (WR≥50%, R:R≥1.0, P(T2|W)≥50%):`);
    p(`    stop=${best.stop}× | T1=${best.t1}× | T2=${best.t2}× | T3=${best.t3}×`);
    p(`    WinRate=${(best.winRate*100).toFixed(1)}% | AvgWin=${best.avgWin.toFixed(2)}% | AvgLoss=${best.avgLoss.toFixed(2)}% | Payoff=${best.payoff.toFixed(2)}`);
    p(`    EV/trade=${best.ev.toFixed(3)}% | R:R T1=${best.rrT1.toFixed(2)} T2=${best.rrT2.toFixed(2)} T3=${best.rrT3.toFixed(2)}`);
    p(`    P(T2|hit T1)=${(best.t2condl*100).toFixed(0)}% | P(T3|hit T2)=${(best.t3condl*100).toFixed(0)}% | AvgBars=${best.avgBars.toFixed(1)} | AvgMAE=${best.avgMAE.toFixed(2)}×ATR`);
  } else {
    p('');
    p(`  ★ No combo meets WR≥50%+R:R≥1.0 — best available:`);
    const best2=results.find(r=>r.winRate>=0.45&&r.rrT1>=0.8);
    if (best2) p(`    stop=${best2.stop}× T1=${best2.t1}× T2=${best2.t2}× T3=${best2.t3}× | WR=${(best2.winRate*100).toFixed(1)}% | EV=${best2.ev.toFixed(3)}% | R:R=${best2.rrT1.toFixed(2)}`);
  }
}

p('');
p('═══════════════════════════════════════════════════════════════════════════════');
p('  CROSS-BAND SUMMARY — Universal combo that works across all bands');
p('═══════════════════════════════════════════════════════════════════════════════');

// Find the combo that maximises min(score) across all bands
const allComboScores = new Float64Array(N_COMBO).fill(Infinity);
for (let ci=0; ci<N_COMBO; ci++) {
  let minScore=Infinity;
  for (let bi=0; bi<BANDS.length; bi++) {
    const a=acc[bi];
    if (!a.total[ci]) { minScore=-999; break; }
    const wins=a.winsT1[ci], tot=a.total[ci], stops=a.stops[ci];
    const avgWin=wins>0?a.gainSum[ci]/wins:0;
    const avgLoss=stops>0?a.lossSum[ci]/stops:0;
    const ev=(wins/tot)*avgWin - (stops/tot)*avgLoss;
    const sc=ev*(wins/tot)*1000;
    if (sc<minScore) minScore=sc;
  }
  allComboScores[ci]=minScore;
}

// Top 10 universal combos
const universalRanked=[];
for (let si=0; si<N_STOP; si++) for (let t1i=0; t1i<N_T1; t1i++) for (let t2i=0; t2i<N_T2; t2i++) for (let t3i=0; t3i<N_T3; t3i++) {
  const ci=comboIdx(si,t1i,t2i,t3i);
  universalRanked.push({ ci, si,t1i,t2i,t3i, score:allComboScores[ci],
    stop:STOP_M[si], t1:T1_M[t1i], t2:T1_M[t1i]+T2_ADJ[t2i], t3:T1_M[t1i]+T2_ADJ[t2i]+T3_ADJ[t3i] });
}
universalRanked.sort((a,b)=>b.score-a.score);

p('');
p('  Rank | Stop |  T1  |  T2   |  T3  | MinScore | R:R(T1) | R:R(T2) | R:R(T3)');
for (const r of universalRanked.slice(0,15)) {
  p(`  ${String(universalRanked.indexOf(r)+1).padStart(4)} | ${String(r.stop).padStart(4)}× | ${String(r.t1).padStart(4)}× | ${String(r.t2).padStart(5)}× | ${String(r.t3).padStart(4)}× | ${r.score.toFixed(4).padStart(8)} | ${(r.t1/r.stop).toFixed(2).padStart(7)} | ${(r.t2/r.stop).toFixed(2).padStart(7)} | ${(r.t3/r.stop).toFixed(2).padStart(7)}`);
}

// Save
const stamp=new Date().toISOString().slice(0,16).replace(':','-');
const outTxt=path.join(OUT_DIR,`target_validation_study_${stamp}.txt`);
fs.writeFileSync(outTxt,lines.join('\n'));
p('');
p(`Report: ${outTxt}`);
p('═══════════════════════════════════════════════════════════════════════════════');
