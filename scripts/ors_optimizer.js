'use strict';
/**
 * ors_optimizer.js — ORS (Opening Range Spike) hyper-tune
 * =========================================================
 * Problem: W3=0.50 tail allocated to T3 at avg 50.5% — hit only 18% of trades.
 *          STRONG ORS (n=343) WR=37%, ULTRA ORS (n=185) WR=66.5% — divergent.
 *
 * Sweeps: t1Mult × T3/T1 ratio × W1/W2/W3 weights
 * Also: per-stage (STRONG vs ULTRA) analysis.
 */

const fs   = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const ORS_AI      = 0;   // ORS archetype index

// ── Load latest extract ───────────────────────────────────────────────────────
function loadORSTrades() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('deep_extract_') && f.endsWith('.json'))
    .sort().reverse();
  if (!files.length) { console.error('No deep_extract found'); process.exit(1); }
  const fp = path.join(RESULTS_DIR, files[0]);
  console.log(`\n  Extract: ${files[0]}\n`);
  const { trades } = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const oos   = trades.filter(t => t.ai === ORS_AI && t.o);
  const is_   = trades.filter(t => t.ai === ORS_AI && !t.o);
  const ultra = oos.filter(t => t.gi === 2);
  const strong= oos.filter(t => t.gi === 1);
  const buy   = oos.filter(t => t.gi === 0);
  console.log(`  ORS trades: OOS n=${oos.length}  IS n=${is_.length}`);
  console.log(`    ULTRA n=${ultra.length}  STRONG n=${strong.length}  BUY n=${buy.length}\n`);
  return { oos, is: is_, ultra, strong, buy };
}

// ── Re-simulator ──────────────────────────────────────────────────────────────
function resim(t, t1P, t2P, t3P, W1, W2, W3) {
  const maxJ = Math.min(t.mh, t.bt.length, t.cp.length, t.mf.length);
  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;
  for (let j = 0; j < maxJ; j++) {
    const stopB = (t.bt[j] & 1) !== 0;
    const cMFE  = t.mf[j];
    if (phase === 1) {
      if (stopB && cMFE < t1P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t1P) { wPL += W1 * t1P; wLeft -= W1; t1Hit = true; phase = 2; }
    }
    if (phase === 2) {
      if (stopB && cMFE < t2P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t2P) { wPL += W2 * t2P; wLeft -= W2; t2Hit = true; phase = 3; }
    }
    if (phase === 3) {
      if (stopB && cMFE < t3P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t3P) { wPL += W3 * t3P; t3Hit = true; return { wPL, t1Hit, t2Hit, t3Hit }; }
    }
    if (j === maxJ - 1 && wLeft > 0) {
      wPL += wLeft * (t.cp[j] ?? 0);
      return { wPL, t1Hit, t2Hit, t3Hit };
    }
  }
  return { wPL, t1Hit, t2Hit, t3Hit };
}

function evaluate(trades, t1M, t2R, t3R, W1, W2, W3) {
  if (!trades.length) return null;
  let n = 0, wins = 0, sumPL = 0, sumWin = 0, sumLoss = 0;
  let nt1 = 0, nt2 = 0, nt3 = 0;
  for (const t of trades) {
    const t1P = t1M * t.ap;
    const t2P = t1P * t2R;
    const t3P = t1P * t3R;
    const r = resim(t, t1P, t2P, t3P, W1, W2, W3);
    n++;
    sumPL += r.wPL;
    if (r.wPL > 0) { wins++; sumWin += r.wPL; }
    else             sumLoss += r.wPL;
    if (r.t1Hit) nt1++;
    if (r.t2Hit) nt2++;
    if (r.t3Hit) nt3++;
  }
  const wr    = wins / n * 100;
  const pf    = sumLoss === 0 ? 99 : Math.abs(sumWin / sumLoss);
  const avgPL = sumPL / n;
  const score = pf * wr / 100;
  const escT1 = nt1 / n * 100;
  const escT2 = nt1 > 0 ? nt2 / nt1 * 100 : 0;
  const escT3 = nt2 > 0 ? nt3 / nt2 * 100 : 0;
  return { n, wr, pf, avgPL, score, escT1, escT2, escT3 };
}

function quarter(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;
}

function fmt(n, dp=2, w=8)  { return n == null ? 'N/A'.padStart(w) : n.toFixed(dp).padStart(w); }
function fmtPct(n, w=7)     { return n == null ? 'N/A'.padStart(w) : (n.toFixed(1)+'%').padStart(w); }

const SEP = '═'.repeat(115);
const sep = '─'.repeat(115);

const { oos, is: isTrades, ultra, strong, buy } = loadORSTrades();

const avgT1base = oos.reduce((s,t) => s + 1.5*t.ap, 0)/oos.length;
const avgT3base = avgT1base * (10/3);

console.log(SEP);
console.log('  ORS (Opening Range Spike) HYPER-OPTIMIZER');
console.log(`  Baseline: t1Mult=1.5, T2/T1=1.67, T3/T1=3.33, W1=0.40 W2=0.10 W3=0.50`);
console.log(`  Problem : T3avg=${avgT3base.toFixed(1)}% hit only 18% trades; W3=0.50 tail mostly unreachable`);
console.log(`            STRONG WR=37% vs ULTRA WR=66.5% — major divergence by stage`);
console.log(SEP);

const baseline = evaluate(oos, 1.5, 5/3, 10/3, 0.40, 0.10, 0.50);
const baseUltra = evaluate(ultra, 1.5, 5/3, 10/3, 0.40, 0.10, 0.50);
const baseStrong= evaluate(strong, 1.5, 5/3, 10/3, 0.40, 0.10, 0.50);

console.log(`\n  BASELINE (OOS n=${baseline.n}):`);
console.log(`    ALL   : WR=${baseline.wr.toFixed(1)}% PF=${baseline.pf.toFixed(2)} AvgPL=+${baseline.avgPL.toFixed(2)}% Score=${baseline.score.toFixed(3)} escT1=${baseline.escT1.toFixed(1)}% escT2=${baseline.escT2.toFixed(1)}% escT3=${baseline.escT3.toFixed(1)}%`);
console.log(`    ULTRA : WR=${baseUltra.wr.toFixed(1)}% PF=${baseUltra.pf.toFixed(2)} AvgPL=+${baseUltra.avgPL.toFixed(2)}%`);
console.log(`    STRONG: WR=${baseStrong.wr.toFixed(1)}% PF=${baseStrong.pf.toFixed(2)} AvgPL=+${baseStrong.avgPL.toFixed(2)}%`);

// ── SECTION 1: T1Mult Sweep ──────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 1 — T1Mult Sweep  (W1=0.40 W2=0.10 W3=0.50, T3/T1=3.33)\n');
console.log('  ' + ['t1M','AvgT1%','AvgT2%','AvgT3%','escT1%','escT2%','escT3%','WR%','PF','AvgPL%','Score'].map((h,i)=>h.padStart([5,7,7,7,7,7,7,7,6,8,8][i])).join(' '));
console.log('  ' + sep.slice(0,112));

const t1Sweep = [];
for (let t1M = 0.50; t1M <= 3.51; t1M = Math.round((t1M+0.25)*100)/100) {
  const ev  = evaluate(oos, t1M, 5/3, 10/3, 0.40, 0.10, 0.50);
  const at1 = oos.reduce((s,t)=>s+t1M*t.ap,0)/oos.length;
  const at2 = at1*(5/3), at3 = at1*(10/3);
  t1Sweep.push({ t1M, avgT1:at1, ...ev });
  const marker = t1M === 1.5 ? ' ◄ baseline' : '';
  console.log('  ' + [
    t1M.toFixed(2).padStart(5), at1.toFixed(1).padStart(7), at2.toFixed(1).padStart(7), at3.toFixed(1).padStart(7),
    fmtPct(ev.escT1),fmtPct(ev.escT2),fmtPct(ev.escT3),
    fmtPct(ev.wr),fmt(ev.pf,2,6),fmt(ev.avgPL,2,8),fmt(ev.score,3,8),
  ].join(' ') + marker);
}
const bestT1 = t1Sweep.reduce((b,x)=>x.score>b.score?x:b);
console.log(`\n  Best t1Mult=${bestT1.t1M.toFixed(2)}, Score=${bestT1.score.toFixed(3)}, WR=${bestT1.wr.toFixed(1)}%, PF=${bestT1.pf.toFixed(2)}, AvgPL=+${bestT1.avgPL.toFixed(2)}%`);

// ── SECTION 2: T3/T1 Ratio Sweep ─────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 2 — T3/T1 Ratio Sweep  (t1Mult=${bestT1.t1M.toFixed(2)}, W1=0.40 W2=0.10 W3=0.50)\n`);
console.log('  ' + ['T3/T1','AvgT3%','escT1%','escT2%','escT3%','WR%','PF','AvgPL%','Score'].map((h,i)=>h.padStart([6,7,7,7,7,7,6,8,8][i])).join(' '));
console.log('  ' + sep.slice(0,90));

const t3Sweep = [];
for (const t3R of [1.50,1.75,2.00,2.25,2.50,2.75,3.00,3.33,3.75,4.00,4.50,5.00,6.00]) {
  const ev = evaluate(oos, bestT1.t1M, 5/3, t3R, 0.40, 0.10, 0.50);
  const at3 = oos.reduce((s,t)=>s+bestT1.t1M*t3R*t.ap,0)/oos.length;
  t3Sweep.push({ t3R, ...ev });
  const marker = t3R === 10/3 ? ' ◄ baseline' : '';
  console.log('  ' + [
    t3R.toFixed(2).padStart(6), at3.toFixed(1).padStart(7),
    fmtPct(ev.escT1),fmtPct(ev.escT2),fmtPct(ev.escT3),
    fmtPct(ev.wr),fmt(ev.pf,2,6),fmt(ev.avgPL,2,8),fmt(ev.score,3,8),
  ].join(' ') + marker);
}
const bestT3 = t3Sweep.reduce((b,x)=>x.score>b.score?x:b);
console.log(`\n  Best T3/T1=${bestT3.t3R.toFixed(2)}, Score=${bestT3.score.toFixed(3)}, WR=${bestT3.wr.toFixed(1)}%, PF=${bestT3.pf.toFixed(2)}`);

// ── SECTION 3: Weight Sweep ───────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 3 — Weight Sweep  (t1Mult=${bestT1.t1M.toFixed(2)}, T3/T1=${bestT3.t3R.toFixed(2)})\n`);
console.log('  ' + ['W1','W2','W3','WR%','PF','AvgPL%','Score','escT1%','escT2%','escT3%'].map((h,i)=>h.padStart([6,6,6,7,6,8,8,7,7,7][i])).join(' '));
console.log('  ' + sep.slice(0,100));

const wResults = [];
for (const w1 of [0.20,0.30,0.40,0.50,0.60]) {
  for (const w2 of [0.05,0.10,0.15,0.20]) {
    const w3 = Math.round((1-w1-w2)*100)/100;
    if (w3 < 0.05) continue;
    const ev = evaluate(oos, bestT1.t1M, 5/3, bestT3.t3R, w1, w2, w3);
    wResults.push({ w1,w2,w3,...ev });
    const marker = (w1===0.40&&w2===0.10) ? ' ◄ baseline' : '';
    console.log('  ' + [
      w1.toFixed(2).padStart(6),w2.toFixed(2).padStart(6),w3.toFixed(2).padStart(6),
      fmtPct(ev.wr),fmt(ev.pf,2,6),fmt(ev.avgPL,2,8),fmt(ev.score,3,8),
      fmtPct(ev.escT1),fmtPct(ev.escT2),fmtPct(ev.escT3),
    ].join(' ') + marker);
  }
}
const bestW = wResults.reduce((b,x)=>x.score>b.score?x:b);
console.log(`\n  Best weights: W1=${bestW.w1.toFixed(2)} W2=${bestW.w2.toFixed(2)} W3=${bestW.w3.toFixed(2)}, Score=${bestW.score.toFixed(3)}, WR=${bestW.wr.toFixed(1)}%`);

// ── SECTION 4: Joint Grid (t1M × T3/T1 × W1) ────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 4 — Joint Grid: t1Mult × T3/T1 × W1  (top 25 by score)\n');
console.log('  ' + ['t1M','T3/T1','W1','W2','W3','WR%','PF','AvgPL%','Score','escT1%','escT2%','escT3%'].map((h,i)=>h.padStart([5,6,6,6,6,7,6,8,8,7,7,7][i])).join(' '));
console.log('  ' + sep.slice(0,112));

const gridResults = [];
for (const t1M of [0.75,1.00,1.25,1.50,1.75,2.00,2.50]) {
  for (const t3R of [1.75,2.25,2.75,3.33,4.00,5.00]) {
    for (const w1 of [0.20,0.30,0.40,0.50,0.60]) {
      for (const w2 of [0.05,0.10,0.15]) {
        const w3 = Math.round((1-w1-w2)*100)/100;
        if (w3 < 0.05) continue;
        const ev = evaluate(oos, t1M, 5/3, t3R, w1, w2, w3);
        gridResults.push({ t1M, t3R, w1, w2, w3, ...ev });
      }
    }
  }
}
gridResults.sort((a,b)=>b.score-a.score);
for (const r of gridResults.slice(0,25)) {
  console.log('  ' + [
    r.t1M.toFixed(2).padStart(5), r.t3R.toFixed(2).padStart(6),
    r.w1.toFixed(2).padStart(6), r.w2.toFixed(2).padStart(6), r.w3.toFixed(2).padStart(6),
    fmtPct(r.wr), fmt(r.pf,2,6), fmt(r.avgPL,2,8), fmt(r.score,3,8),
    fmtPct(r.escT1), fmtPct(r.escT2), fmtPct(r.escT3),
  ].join(' '));
}
const bestGrid = gridResults[0];

// ── SECTION 5: Per-Stage Analysis ─────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 5 — Per-Stage (ULTRA vs STRONG) at best joint params\n`);

const STAGES = [
  { name:'ULTRA ', trades:ultra },
  { name:'STRONG', trades:strong },
  { name:'BUY   ', trades:buy },
];

for (const { name, trades } of STAGES) {
  if (!trades.length) continue;

  // Find best t1Mult for this stage specifically
  let stageBest = null;
  for (const t1M of [0.75,1.00,1.25,1.50,1.75,2.00,2.50]) {
    for (const t3R of [1.75,2.25,2.75,3.33,4.00,5.00]) {
      for (const w1 of [0.20,0.30,0.40,0.50,0.60]) {
        for (const w2 of [0.05,0.10]) {
          const w3 = Math.round((1-w1-w2)*100)/100;
          if (w3 < 0.05) continue;
          const ev = evaluate(trades, t1M, 5/3, t3R, w1, w2, w3);
          if (!stageBest || ev.score > stageBest.score) stageBest = { t1M,t3R,w1,w2,w3,...ev };
        }
      }
    }
  }
  const baseStage = evaluate(trades, 1.5, 5/3, 10/3, 0.40, 0.10, 0.50);
  const optStage  = evaluate(trades, bestGrid.t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
  const avgT1opt  = trades.reduce((s,t)=>s+stageBest.t1M*t.ap,0)/trades.length;

  console.log(`  ${name} (n=${trades.length}):`);
  console.log(`    BASE: WR=${baseStage.wr.toFixed(1)}% PF=${baseStage.pf.toFixed(2)} AvgPL=+${baseStage.avgPL.toFixed(2)}% Score=${baseStage.score.toFixed(3)}`);
  console.log(`    UNIV: WR=${optStage.wr.toFixed(1)}% PF=${optStage.pf.toFixed(2)} AvgPL=+${optStage.avgPL.toFixed(2)}% Score=${optStage.score.toFixed(3)}  (t1M=${bestGrid.t1M.toFixed(2)} T3/T1=${bestGrid.t3R.toFixed(2)} W1=${bestGrid.w1} W2=${bestGrid.w2} W3=${bestGrid.w3})`);
  console.log(`    BEST: WR=${stageBest.wr.toFixed(1)}% PF=${stageBest.pf.toFixed(2)} AvgPL=+${stageBest.avgPL.toFixed(2)}% Score=${stageBest.score.toFixed(3)}  (t1M=${stageBest.t1M.toFixed(2)} T3/T1=${stageBest.t3R.toFixed(2)} W1=${stageBest.w1} W2=${stageBest.w2} W3=${stageBest.w3}) T1avg≈${avgT1opt.toFixed(1)}%`);
  console.log('');
}

// ── SECTION 6: Quarterly Walk-Forward ────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 6 — Quarterly Walk-Forward (best joint vs baseline)\n');
console.log('  ' + ['Quarter','N','BASE-WR','BASE-AvgPL','OPT-WR','OPT-AvgPL','ΔWR','ΔAvgPL'].map((h,i)=>h.padStart([9,5,8,10,8,10,8,8][i])).join(' '));
console.log('  ' + sep.slice(0,90));

const byQ = {};
for (const t of oos) {
  const q = quarter(t.di);
  if (!byQ[q]) byQ[q] = [];
  byQ[q].push(t);
}
for (const q of Object.keys(byQ).sort().filter(q=>q>='2024-Q1')) {
  const trades = byQ[q];
  const base = evaluate(trades, 1.5, 5/3, 10/3, 0.40, 0.10, 0.50);
  const opt  = evaluate(trades, bestGrid.t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
  const dWR  = opt.wr - base.wr;
  const dPL  = opt.avgPL - base.avgPL;
  console.log('  ' + [
    q.padEnd(9), String(trades.length).padStart(5),
    fmtPct(base.wr,8), fmt(base.avgPL,2,10),
    fmtPct(opt.wr,8),  fmt(opt.avgPL,2,10),
    ((dWR>=0?'+':'')+dWR.toFixed(1)+'%').padStart(8),
    ((dPL>=0?'+':'')+dPL.toFixed(2)+'%').padStart(8),
  ].join(' '));
}

// ── SECTION 7: Recommendation ─────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 7 — FINAL RECOMMENDATION\n');

const finalOpt = evaluate(oos, bestGrid.t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
const avgT1opt = oos.reduce((s,t)=>s+bestGrid.t1M*t.ap,0)/oos.length;
const avgT2opt = avgT1opt*(5/3);
const avgT3opt = avgT1opt*bestGrid.t3R;

console.log(`  BEFORE: t1Mult=1.50 T3/T1=3.33 W1=0.40 W2=0.10 W3=0.50`);
console.log(`          WR=${baseline.wr.toFixed(1)}% PF=${baseline.pf.toFixed(2)} AvgPL=+${baseline.avgPL.toFixed(2)}% escT1=${baseline.escT1.toFixed(1)}% escT3=${baseline.escT3.toFixed(1)}% Score=${baseline.score.toFixed(3)}`);
console.log('');
console.log(`  AFTER:  t1Mult=${bestGrid.t1M.toFixed(2)} T3/T1=${bestGrid.t3R.toFixed(2)} W1=${bestGrid.w1.toFixed(2)} W2=${bestGrid.w2.toFixed(2)} W3=${bestGrid.w3.toFixed(2)}`);
console.log(`          WR=${finalOpt.wr.toFixed(1)}% PF=${finalOpt.pf.toFixed(2)} AvgPL=+${finalOpt.avgPL.toFixed(2)}% escT1=${finalOpt.escT1.toFixed(1)}% escT3=${finalOpt.escT3.toFixed(1)}% Score=${finalOpt.score.toFixed(3)}`);
console.log('');
console.log(`  ΔWR=${(finalOpt.wr-baseline.wr>=0?'+':'')}${(finalOpt.wr-baseline.wr).toFixed(1)}pp  ΔPF=${(finalOpt.pf-baseline.pf>=0?'+':'')}${(finalOpt.pf-baseline.pf).toFixed(2)}  ΔAvgPL=${(finalOpt.avgPL-baseline.avgPL>=0?'+':'')}${(finalOpt.avgPL-baseline.avgPL).toFixed(2)}%  ΔScore=${(finalOpt.score-baseline.score>=0?'+':'')}${(finalOpt.score-baseline.score).toFixed(3)}`);
console.log('');
console.log(`  Avg target levels → T1=${avgT1opt.toFixed(1)}%  T2=${avgT2opt.toFixed(1)}%  T3=${avgT3opt.toFixed(1)}%`);
console.log('');
console.log('  ── stockEngine.ts code changes ───────────────────────────────');
console.log(`  // t1Mult line (~2535):`);
console.log(`  Before: const t1Mult = isVF ? 1.0 : isMP ? (...) : 1.5;`);
const isORS_t1M_diff = Math.abs(bestGrid.t1M - 1.5) > 0.01;
if (isORS_t1M_diff) {
  console.log(`  After:  const t1Mult = isVF ? 1.0 : isMP ? (...) : archetypeHint === 'ORS' ? ${bestGrid.t1M.toFixed(2)} : 1.5;`);
} else {
  console.log(`  t1Mult unchanged (${bestGrid.t1M.toFixed(2)} = current 1.50) — no engine change needed`);
}
if (Math.abs(bestGrid.t3R - 10/3) > 0.05) {
  console.log(`\n  // t3Mult line (~2537) — ORS needs a special branch:`);
  console.log(`  Before: const t3Mult = t1Mult * (10 / 3);`);
  console.log(`  After:  const t3Mult = archetypeHint === 'ORS' ? t1Mult * ${bestGrid.t3R.toFixed(2)} : t1Mult * (10/3);`);
}
console.log('');
console.log('  ── page.tsx ARCH_EXIT change (ors_prime_reversal) ───────────');
console.log(`  Before: { w1:0.40, w2:0.10, w3:0.50 }`);
console.log(`  After:  { w1:${bestGrid.w1.toFixed(2)}, w2:${bestGrid.w2.toFixed(2)}, w3:${bestGrid.w3.toFixed(2)} }`);
console.log('');

const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outFile = path.join(RESULTS_DIR, `ors_opt_${ts}.json`);
fs.writeFileSync(outFile, JSON.stringify({ baseline, bestGrid, finalOpt, t1Sweep, t3Sweep, gridResults: gridResults.slice(0,50) }, null, 2));
console.log(`  Saved → ${outFile}`);
console.log(SEP + '\n');
