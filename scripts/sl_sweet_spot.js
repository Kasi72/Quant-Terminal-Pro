#!/usr/bin/env node
/**
 * STOP-LOSS SWEET SPOT OPTIMIZATION
 *
 * For every ULTRA/STRONG/BUY signal, re-simulates the trade outcome at
 * 19 SL multipliers (0.5×–5.0×ATR in 0.25 steps) without re-reading data.
 * Finds the exact SL_mult that maximises per-trade expectancy per archetype
 * and stage, with bootstrap confidence intervals.
 *
 * Math:
 *   E(m) = WR(m)×TARGET% − SL_rate(m)×(m×avg_ATR%) − TIME_rate(m)×avg_time_pnl(m)
 *   optimal m* = argmax E(m) with n≥50 constraint
 *
 * Also computes:
 *   - MAE (maximum adverse excursion) distribution per winning trade
 *   - Per-archetype optimal SL multiplier
 *   - Gain-to-pain ratio = (WR×5) / (SL_rate×SL_pct)
 *   - Bootstrap 95% CI on E at optimal m*
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';
const TARGET    = 5;       // % profit target
const MAX_BARS  = 20;
const N_BOOT    = 400;

// Phase-3 ULTRA thresholds (deployed)
const ULTRA_T = {
  CompressionCoil: 84,
  VolumeFootprint: 98,
  MomentumPocket:  99,
  EMAStack:        99,
};
const STRONG_T = 62, BUY_T = 43;

// Phase-2 condition weights (deployed)
const W = {
  CompressionCoil: [20,  3, 49, 18,  3,  3],
  VolumeFootprint: [43,  3,  3, 21,  3, 18],
  MomentumPocket:  [ 3, 10, 16,  3, 39, 25],
  EMAStack:        [23,  3, 39, 17,  3, 11],
};

// SL sweep range
const SL_RANGE = [];
for (let m = 0.5; m <= 5.0; m += 0.25) SL_RANGE.push(parseFloat(m.toFixed(2)));

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadCSV(fp) {
  return fs.readFileSync(fp, 'utf8').trim().split('\n').slice(1).map(l => {
    const [, o, h, lo, c, v] = l.split(',');
    return { o: +o, h: +h, l: +lo, c: +c, v: parseInt(v) || 0 };
  }).filter(r => r.c > 0);
}

function atr14(cs, end) {
  if (end < 1) return cs[end].h - cs[end].l;
  let s = 0, cnt = 0;
  for (let i = Math.max(1, end - 13); i <= end; i++) {
    s += Math.max(cs[i].h - cs[i].l,
                  Math.abs(cs[i].h - cs[i-1].c),
                  Math.abs(cs[i].l - cs[i-1].c));
    cnt++;
  }
  return cnt > 0 ? s / cnt : cs[end].h - cs[end].l;
}

function avgVol(cs, end, n) {
  let s = 0, c = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) { s += cs[i].v; c++; }
  return c > 0 ? s / c : 0;
}

function computeRSI(cs, end, p) {
  if (end < p) return 50;
  let g = 0, l = 0;
  for (let i = end - p + 1; i <= end; i++) {
    const d = cs[i].c - cs[i-1].c;
    if (d > 0) g += d; else l += Math.abs(d);
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function bbWidth(cs, end) {
  if (end < 20) return 0;
  let sum = 0;
  for (let i = end-19; i <= end; i++) sum += cs[i].c;
  const mu = sum/20;
  let v = 0;
  for (let i = end-19; i <= end; i++) v += (cs[i].c - mu)**2;
  return cs[end].c > 0 ? 4*Math.sqrt(v/20)/cs[end].c : 0;
}

function dmi(cs, end) {
  if (end < 14) return { dp: 20, dm: 20 };
  let pdm = 0, mdm = 0, tr = 0;
  for (let i = end-13; i <= end; i++) {
    const up = cs[i].h - cs[i-1].h, dn = cs[i-1].l - cs[i].l;
    pdm += (up > dn && up > 0) ? up : 0;
    mdm += (dn > up && dn > 0) ? dn : 0;
    tr  += Math.max(cs[i].h - cs[i].l,
                    Math.abs(cs[i].h - cs[i-1].c),
                    Math.abs(cs[i].l - cs[i-1].c));
  }
  return { dp: tr>0?100*pdm/tr:20, dm: tr>0?100*mdm/tr:20 };
}

// ── Archetype condition simulators ────────────────────────────────────────────

function runCC(cs, i, a) {
  if (i < 60) return null;
  const sig = cs[i];
  let cb = 0;
  for (let j=i-1; j>=Math.max(0,i-20); j--) { if ((cs[j].h-cs[j].l)<0.7*a) cb++; else break; }
  let vd = 0;
  for (let j=i-1; j>=Math.max(1,i-5); j--) { if (cs[j].v<cs[j-1].v) vd++; else break; }
  let hi20=0, lo20=Infinity;
  for (let j=Math.max(0,i-20); j<i; j++) { hi20=Math.max(hi20,cs[j].h); lo20=Math.min(lo20,cs[j].l); }
  const pp20 = hi20>lo20 ? (sig.c-lo20)/(hi20-lo20)*100 : 50;
  const bws = []; for (let j=i-59; j<=i; j++) bws.push(bbWidth(cs,j));
  bws.sort((a,b)=>a-b);
  const p30 = bws[Math.floor(bws.length*0.30)];
  const sr=sig.h-sig.l, cl=sr>0?(sig.c-sig.l)/sr*100:50, bp=sr>0?Math.abs(sig.c-sig.o)/sr*100:0;
  const {dp,dm} = dmi(cs,i);
  const c = [cb>=8, vd>=2, pp20>=59, bbWidth(cs,i)<=p30, sr<=0.8*a&&sig.c>sig.o&&cl>55&&bp>30, dp>dm];
  const bonus = Math.min(10,cb*3)+Math.min(5,Math.max(0,pp20-65)*0.5);
  return { c, bonus };
}

function runVF(cs, i, a) {
  if (i < 20) return null;
  const sig = cs[i];
  const v20=avgVol(cs,i-1,20), vr20=v20>0?sig.v/v20:0;
  const sr=sig.h-sig.l, cl=sr>0?(sig.c-sig.l)/sr*100:50, uw=sr>0?(sig.h-Math.max(sig.o,sig.c))/sr*100:0;
  let hi20=0; for (let j=Math.max(0,i-20); j<i; j++) hi20=Math.max(hi20,cs[j].h);
  const rng=sr/a; const prev=cs[i-1]?.c??sig.o; const gap=prev>0?(sig.o-prev)/prev*100:0;
  const {dp,dm} = dmi(cs,i);
  const c = [vr20>=3.7, cl>=68&&uw<=12, hi20>0&&sig.c>=hi20*0.83, rng>=2.4, gap>=-2.6, dp>dm];
  const bonus = Math.min(10,(vr20-3)*5)+Math.min(5,(cl-68)*0.3);
  return { c, bonus };
}

function runMP(cs, i, a) {
  if (i < 60) return null;
  const sig = cs[i];
  let hi52=0; for (let j=Math.max(0,i-252); j<i; j++) hi52=Math.max(hi52,cs[j].h);
  const dd52=hi52>0?(hi52-sig.c)/hi52*100:0;
  const refL=i>=20?Math.min(...cs.slice(i-20,i).map(b=>b.l)):sig.l;
  const sr=sig.h-sig.l, bp=sr>0?Math.abs(sig.c-sig.o)/sr*100:0, cl=sr>0?(sig.c-sig.l)/sr*100:50;
  const v20=avgVol(cs,i-1,20), vr20=v20>0?sig.v/v20:0;
  const {dp,dm} = dmi(cs,i);
  let sb=0; for (let j=i-1; j>=Math.max(0,i-20); j--) { if ((cs[j].h-cs[j].l)<a) sb++; else break; }
  const c = [dd52>=15, sig.l>refL, sig.c>sig.o&&bp>=60, cl>=55, vr20>=1.5, dp>dm];
  const bonus = Math.min(10,sb*3)+Math.min(5,(vr20-1.5)*4);
  return { c, bonus };
}

function runES(cs, i, a) {
  if (i < 55) return null;
  const sig = cs[i];
  const k20=2/21, k50=2/51;
  let e20=cs[0].c, e50=cs[0].c;
  for (let j=1; j<i; j++) { e20=cs[j].c*k20+e20*(1-k20); e50=cs[j].c*k50+e50*(1-k50); }
  const prevE20=e20; e20=sig.c*k20+e20*(1-k20);
  let below=0; for (let j=i-1; j>=Math.max(0,i-10); j--) { if (cs[j].c<prevE20) below++; else break; }
  const sr=sig.h-sig.l, bp=sr>0?Math.abs(sig.c-sig.o)/sr*100:0, cl=sr>0?(sig.c-sig.l)/sr*100:50;
  const v20=avgVol(cs,i-1,20), vr=v20>0?sig.v/v20:0;
  const {dp,dm} = dmi(cs,i);
  const c = [sig.c>e20&&cs[i-1]?.c<=prevE20, below>=3, e20>e50, sig.c>sig.o&&bp>=40, cl>=60, dp>dm];
  const bonus = Math.min(10,below*2)+Math.min(5,(vr-1.8)*5);
  return { c, bonus };
}

function calcScore(arch, res) {
  return Math.min(100, Math.round(res.c.reduce((s,b,j)=>s+(b?W[arch][j]:0), 0) + res.bonus));
}

function getStage(sc, arch) {
  const ut = ULTRA_T[arch] ?? 86;
  return sc >= ut ? 'ULTRA' : sc >= STRONG_T ? 'STRONG' : sc >= BUY_T ? 'BUY' : null;
}

// ── Label at variable SL_mult ─────────────────────────────────────────────────

function labelAtMult(cs, idx, entry, atr, slMult) {
  const tgt = entry * (1 + TARGET/100);
  const sl  = entry - slMult * atr;
  const slPct = (entry - sl) / entry * 100;
  for (let i = idx+1; i <= Math.min(idx+MAX_BARS, cs.length-1); i++) {
    if (cs[i].l <= sl)  return { win:0, exit:'SL',   pnl:-slPct, bars:i-idx };
    if (cs[i].h >= tgt) return { win:1, exit:'TGT',  pnl:TARGET, bars:i-idx };
  }
  const exitBar = Math.min(idx+MAX_BARS, cs.length-1);
  const pnl = (cs[exitBar].c - entry) / entry * 100;
  return { win:0, exit:'TIME', pnl, bars:MAX_BARS };
}

// For winning trades: compute MAE = worst drawdown before target hit
function computeMAE(cs, idx, entry, atr) {
  const tgt = entry * (1 + TARGET/100);
  let minLow = entry;
  for (let i = idx+1; i <= Math.min(idx+MAX_BARS, cs.length-1); i++) {
    minLow = Math.min(minLow, cs[i].l);
    if (cs[i].h >= tgt) break;
  }
  return (entry - minLow) / entry * 100; // MAE as % of entry
}

// ── Collect signals ────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('_OHLCV.csv')).sort().slice(0, 60);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  STOP-LOSS SWEET SPOT OPTIMIZATION');
console.log('  19 SL levels (0.5×–5.0×ATR) · per-archetype · bootstrap 400');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`Loading ${files.length} stocks...\n`);

// signals[arch][stage] = array of { entry, atrPct, atm, slMult→outcome }
// Store raw: { entry, atrPct, atr, idx, stockIdx }
const signals = {
  CompressionCoil: { ULTRA:[], STRONG:[], BUY:[] },
  VolumeFootprint: { ULTRA:[], STRONG:[], BUY:[] },
  MomentumPocket:  { ULTRA:[], STRONG:[], BUY:[] },
  EMAStack:        { ULTRA:[], STRONG:[], BUY:[] },
};
const rawData = []; // {cs, idx, entry, atr, arch, stage}

for (let si=0; si<files.length; si++) {
  try {
    const cs = loadCSV(path.join(DATA_DIR, files[si]));
    if (cs.length < 80) continue;

    for (let i=65; i<cs.length-MAX_BARS; i++) {
      const a = atr14(cs, i);
      if (a===0) continue;
      const atrPct = a/cs[i].c*100;
      if (atrPct > 3.5) continue;

      let bestScore=-1, bestArch=null, bestStage=null;
      const runners = [
        ['CompressionCoil', runCC(cs,i,a)],
        ['VolumeFootprint', runVF(cs,i,a)],
        ['MomentumPocket',  runMP(cs,i,a)],
        ['EMAStack',        runES(cs,i,a)],
      ];
      for (const [arch, res] of runners) {
        if (!res) continue;
        const sc = calcScore(arch, res);
        const st = getStage(sc, arch);
        if (st && sc > bestScore) { bestScore=sc; bestArch=arch; bestStage=st; }
      }
      if (!bestStage) continue;

      rawData.push({ cs, idx:i, entry:cs[i].c, atr:a, atrPct, arch:bestArch, stage:bestStage });
    }
  } catch(e) {}
}

console.log(`Total signals: ${rawData.length}`);
console.log(`  ULTRA: ${rawData.filter(d=>d.stage==='ULTRA').length}`);
console.log(`  STRONG: ${rawData.filter(d=>d.stage==='STRONG').length}`);
console.log(`  BUY: ${rawData.filter(d=>d.stage==='BUY').length}\n`);

// ── SL sweep ──────────────────────────────────────────────────────────────────

// For each signal, compute outcome at every SL multiplier
// Store result[signalIdx][slIdx] = { win, exit, pnl, bars }
console.log('Running SL sweep across 19 multipliers...');
const outcomes = rawData.map(({ cs, idx, entry, atr }) =>
  SL_RANGE.map(m => labelAtMult(cs, idx, entry, atr, m))
);

// Also compute MAE for each signal at the current SL (3×ATR reference)
const maes = rawData.map(({ cs, idx, entry, atr }) => computeMAE(cs, idx, entry, atr));
console.log('Done.\n');

// ── Analysis helpers ──────────────────────────────────────────────────────────

function analyzeGroup(indices, slIdx) {
  let wins=0, sls=0, times=0, totalPnl=0, bars=0;
  const avgATR = indices.reduce((s,i)=>s+rawData[i].atrPct,0)/indices.length;
  for (const i of indices) {
    const o = outcomes[i][slIdx];
    wins += o.win;
    if (o.exit==='SL') sls++;
    else if (o.exit==='TIME') times++;
    totalPnl += o.pnl;
    bars += o.bars;
  }
  const n = indices.length;
  const wr   = wins/n;
  const slr  = sls/n;
  const tr   = times/n;
  const avgTimePnl = tr>0 ? totalPnl/n - wr*TARGET - slr*(-SL_RANGE[slIdx]*avgATR) : 0;
  const E    = wr*TARGET - slr*(SL_RANGE[slIdx]*avgATR);
  return { wr, slr, tr, n, E, avgATR };
}

function bootstrapE(indices, slIdx, n_boot) {
  const Es = [];
  for (let b=0; b<n_boot; b++) {
    let wins=0, sls=0;
    const avgATR = indices.reduce((s,i)=>s+rawData[i].atrPct,0)/indices.length;
    for (let j=0; j<indices.length; j++) {
      const i = indices[Math.floor(Math.random()*indices.length)];
      const o = outcomes[i][slIdx];
      wins += o.win; if (o.exit==='SL') sls++;
    }
    const n=indices.length, wr=wins/n, slr=sls/n;
    Es.push(wr*TARGET - slr*(SL_RANGE[slIdx]*avgATR));
  }
  Es.sort((a,b)=>a-b);
  return {
    mean: Es.reduce((s,v)=>s+v,0)/Es.length,
    lo:   Es[Math.floor(n_boot*0.025)],
    hi:   Es[Math.floor(n_boot*0.975)],
  };
}

// ── Main analysis: per archetype × stage ──────────────────────────────────────

const archs  = ['CompressionCoil','VolumeFootprint','MomentumPocket','EMAStack'];
const stages = ['ULTRA','STRONG','BUY'];
const optTable = {}; // optTable[arch][stage] = { optMult, optWR, optE, currentE, ... }

for (const arch of archs) {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`▶ ${arch}`);

  for (const stage of stages) {
    const idx = rawData
      .map((d,i)=>({d,i}))
      .filter(({d})=>d.arch===arch && d.stage===stage)
      .map(({i})=>i);
    if (idx.length < 20) { console.log(`  ${stage}: insufficient signals (n=${idx.length})`); continue; }

    // Compute E at each SL level
    const grid = SL_RANGE.map((m,si)=>({ m, ...analyzeGroup(idx, si) }));

    // Current deployed (3×ATR) index
    const curr3Idx = SL_RANGE.indexOf(3.0);
    const curr = grid[curr3Idx];

    // Optimal: max E with n≥50 constraint
    const valid = grid.filter(g=>g.n>=50); // always same n (n is always idx.length)
    const optByE  = grid.reduce((b,g)=>g.E>b.E?g:b, grid[0]);

    // Optimal: tightest SL that keeps WR ≥ current WR (fewest stops at same quality)
    const optBySlr = grid.reduce((b,g)=>g.slr<b.slr&&g.E>=curr.E*0.95?g:b, grid[curr3Idx]);

    // Bootstrap CI at opt
    const optSlIdx = SL_RANGE.indexOf(optByE.m);
    const ci = bootstrapE(idx, optSlIdx, N_BOOT);
    const ciCurr = bootstrapE(idx, curr3Idx, N_BOOT);

    // MAE analysis (only for this group)
    const groupMaes = idx.map(i=>maes[i]).filter(m=>m>0);
    groupMaes.sort((a,b)=>a-b);
    const mae50 = groupMaes[Math.floor(groupMaes.length*0.50)]??0;  // median MAE
    const mae75 = groupMaes[Math.floor(groupMaes.length*0.75)]??0;  // 75th pctile
    const mae90 = groupMaes[Math.floor(groupMaes.length*0.90)]??0;  // 90th pctile
    // Optimal SL from MAE: cover 75th pctile of adverse excursion
    const maeOptMult = mae75 / curr.avgATR;

    console.log(`\n  ─── ${stage} (n=${idx.length}) ───`);
    console.log(`  SL×  | Win%  | SL%   | Expectancy  | Gain-to-Pain`);

    const printMults = [0.75,1.0,1.25,1.5,1.75,2.0,2.5,3.0,3.5,4.0,4.5,5.0];
    for (const m of printMults) {
      const g = grid.find(x=>x.m===m);
      if (!g) continue;
      const gtp = g.slr>0 ? (g.wr*TARGET)/(g.slr*m*g.avgATR) : 99;
      const marker = m===3.0 ? ' ← current' : m===optByE.m ? ' ← ★ opt E' : '';
      const eStr = (g.E>=0?'+':'')+g.E.toFixed(3)+'%';
      console.log(`  ${m.toFixed(2).padStart(4)} | ${(g.wr*100).toFixed(1).padStart(5)}% | ${(g.slr*100).toFixed(1).padStart(5)}% | ${eStr.padStart(11)} | ${gtp.toFixed(2).padStart(12)}${marker}`);
    }

    console.log(`\n  MAE analysis (adverse excursion before target):`);
    console.log(`    Median MAE: ${mae50.toFixed(2)}%  75th: ${mae75.toFixed(2)}%  90th: ${mae90.toFixed(2)}%`);
    console.log(`    SL to cover 75th pctile of MAE: ${maeOptMult.toFixed(2)}×ATR`);

    console.log(`\n  ★ Sweet spot:`);
    console.log(`    Max Expectancy:  SL=${optByE.m}×ATR → WR=${(optByE.wr*100).toFixed(1)}%, SL%=${(optByE.slr*100).toFixed(1)}%, E=${optByE.E.toFixed(3)}%`);
    console.log(`    Current (3×ATR): WR=${(curr.wr*100).toFixed(1)}%, SL%=${(curr.slr*100).toFixed(1)}%, E=${curr.E.toFixed(3)}%`);
    console.log(`    E gain:         ${((optByE.E-curr.E)>=0?'+':'')}${(optByE.E-curr.E).toFixed(3)}% per trade`);
    console.log(`    Bootstrap 95% CI at ${optByE.m}×: E = ${ci.mean.toFixed(3)}% [${ci.lo.toFixed(3)}–${ci.hi.toFixed(3)}]`);
    console.log(`    Bootstrap 95% CI at 3.0×: E = ${ciCurr.mean.toFixed(3)}% [${ciCurr.lo.toFixed(3)}–${ciCurr.hi.toFixed(3)}]`);

    if (!optTable[arch]) optTable[arch] = {};
    optTable[arch][stage] = {
      optMult: optByE.m, optWR: optByE.wr*100, optSlr: optByE.slr*100, optE: optByE.E,
      currWR: curr.wr*100, currSlr: curr.slr*100, currE: curr.E,
      eGain: optByE.E - curr.E,
      mae50, mae75, maeOptMult,
      ci_lo: ci.lo, ci_hi: ci.hi, ci_mean: ci.mean,
    };
  }
}

// ── Final recommendations ──────────────────────────────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════════');
console.log('FINAL RECOMMENDATION: PER-ARCHETYPE OPTIMAL SL MULTIPLIERS\n');
console.log('Focus on ULTRA (highest-stakes decisions):\n');
console.log('Archetype         | Curr 3×  WR% | Opt SL× | Opt WR%  | SL Rate% | E Gain');
console.log('─'.repeat(78));

for (const arch of archs) {
  const r = optTable[arch]?.ULTRA;
  if (!r) continue;
  console.log(
    `${arch.padEnd(17)} | ${r.currWR.toFixed(1).padStart(12)}% | ${r.optMult.toFixed(2).padStart(7)} | ${r.optWR.toFixed(1).padStart(8)}% | ${r.optSlr.toFixed(1).padStart(8)}% | ${((r.eGain>=0)?'+':'')+r.eGain.toFixed(3)}%`
  );
}

console.log('\n\nstockEngine.ts update (if SL mult differs per archetype):\n');
console.log('const ARCH_SL: Record<string,number> = {');
for (const arch of archs) {
  const r = optTable[arch]?.ULTRA;
  if (!r) continue;
  const note = r.eGain > 0.05 ? '// ★ significant gain' : r.eGain > 0 ? '// marginal' : '// no improvement — keep 3×';
  const mult = r.eGain > 0 ? r.optMult : 3.0;
  console.log(`  ${arch.padEnd(17)}: ${mult.toFixed(2)}, ${note}`);
}
console.log('};\n');

console.log('MAE-based recommendation (cover 75th pctile of adverse excursion):');
console.log('Archetype         | MAE 50th% | MAE 75th% | MAE-opt SL×');
console.log('─'.repeat(60));
for (const arch of archs) {
  const r = optTable[arch]?.ULTRA;
  if (!r) continue;
  console.log(
    `${arch.padEnd(17)} | ${r.mae50.toFixed(2).padStart(9)}% | ${r.mae75.toFixed(2).padStart(9)}% | ${r.maeOptMult.toFixed(2).padStart(11)}×`
  );
}

const outPath = `scripts/results/sl_sweetspot_${new Date().toISOString().slice(0,16).replace(':','-')}.json`;
fs.mkdirSync('scripts/results', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), optTable, SL_RANGE }, null, 2));
console.log(`\nResults saved: ${outPath}`);
console.log('═══════════════════════════════════════════════════════════════\n');
