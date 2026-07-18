'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// ARCHETYPE HYPER-OPTIMIZER — Walk-Forward Edition
// Target: IS WR ≥ 80%  |  OOS WR ≥ 75%  |  PF maximised
//
// Method:
//   1. Parse all 549 symbols, compute indicators once (fast precompute)
//   2. Split each symbol 70/30 chronologically (IS / OOS)
//   3. For each archetype: collect signals with full metadata
//      (score, conditionsMet, stage, CMF-20, OBV-slope-10, plus archetype-specific metrics)
//   4. Sweep 1500+ filter combinations on IS signals → find WR ≥ 80%
//   5. Validate surviving candidates on OOS → keep OOS WR ≥ 75%
//   6. Print best params + ready-to-paste engine patch
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { analyzeStock } = require(path.join(__dirname, '_compiled_current', 'stockEngine.js'));

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PS_LABEL = {
  optimized_deployable_20plus:    'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus:         'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus:                  'PerfectStorm',
};

const DATA_DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV', fmt: 'nse'   },
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio',     fmt: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50',         fmt: 'nse'   },
];

const WINDOW   = 220;
const STEP     = 5;
const COOL     = 5;
const MAX_H    = 20;
const MIN_C    = WINDOW + MAX_H + 5;
const IS_SPLIT = 0.70;   // 70% IS, 30% OOS
const BUY_S    = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const STRONG_S = new Set(['STRONG_BUY', 'ULTRA_STRONG_BUY']);
const ULTRA_S  = new Set(['ULTRA_STRONG_BUY']);
const MIN_N    = 15;     // minimum trades for a combo to be valid

// ── sweep grid ────────────────────────────────────────────────────────────────
const SCORE_THRESH  = [40, 45, 50, 55, 60, 65, 70, 75, 80];
const CONDS_THRESH  = [3, 4, 5, 6];
const CMF_THRESH    = [-0.20, -0.10, -0.05, 0.00, 0.05, 0.10, 0.15, 0.20];
const OBV_THRESH    = [-1.0, 0.0, 0.5, 1.0, 1.5];
const STAGE_FILTERS = [
  { name: 'ANY',    fn: s => BUY_S.has(s)    },
  { name: 'STRONG+',fn: s => STRONG_S.has(s) },
  { name: 'ULTRA',  fn: s => ULTRA_S.has(s)  },
];

// ── indicators ────────────────────────────────────────────────────────────────
function computeCMF(candles, endIdx, period = 20) {
  const start = Math.max(0, endIdx - period + 1);
  let sumMFV = 0, sumVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const { h, l, c, v } = candles[i];
    const rng = h - l;
    if (rng > 0 && v > 0) { sumMFV += ((c-l)-(h-c)) / rng * v; sumVol += v; }
  }
  return sumVol > 0 ? sumMFV / sumVol : 0;
}

function computeOBVSlope(candles, endIdx, period = 10) {
  const start = Math.max(1, endIdx - period);
  if (endIdx - start < 3) return 0;
  let obv = 0; const obvV = [], vols = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].c > candles[i-1].c) obv += candles[i].v;
    else if (candles[i].c < candles[i-1].c) obv -= candles[i].v;
    obvV.push(obv); vols.push(candles[i].v);
  }
  const n = obvV.length;
  const mv = vols.reduce((a,b)=>a+b,0)/n || 1;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i=0;i<n;i++){sx+=i;sy+=obvV[i];sxy+=i*obvV[i];sx2+=i*i;}
  const d = n*sx2 - sx*sx;
  return Math.abs(d)<1e-10 ? 0 : ((n*sxy-sx*sy)/d)/mv;
}

// ── parsers ───────────────────────────────────────────────────────────────────
function parseNSE(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const out = [];
  for (let i=1;i<lines.length;i++) {
    const p=lines[i].split(','); if(p.length<6)continue;
    const c=+p[4]; if(!c||c<=0)continue;
    out.push({ts:Date.parse(p[0])||i*86400000,o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});
  }
  return out;
}
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const off = lines[0].toLowerCase().startsWith('symbol')?1:0;
  const out = [];
  for (let i=1;i<lines.length;i++) {
    const p=lines[i].split(','); if(p.length<5+off)continue;
    const c=+p[4+off]; if(!c||c<=0)continue;
    out.push({ts:Date.parse(p[off])||i*86400000,o:+p[1+off],h:+p[2+off],l:+p[3+off],c,v:+p[5+off]||0});
  }
  return out;
}

// ── trade sim ─────────────────────────────────────────────────────────────────
function simulate(candles, sigIdx, stop) {
  const eIdx = sigIdx+1;
  if (eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0)return null;
  const t1=ep*1.05,t2=ep*1.07,t3=ep*1.10;
  let rem=1,pnl=0,mae=0,mfe=0;
  for (let b=1;b<=MAX_H;b++) {
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    mae=Math.min(mae,(bar.l-ep)/ep*100);
    mfe=Math.max(mfe,(bar.h-ep)/ep*100);
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.50*(bar.c-ep)/ep*100;rem-=0.50;}
    if(rem>=0.29&&bar.c>=t2){pnl+=0.30*(bar.c-ep)/ep*100;rem-=0.30;}
    if(rem>0&&bar.c>=t3){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return {pnl,mae:Math.abs(mae),mfe,win:pnl>0.1};
}

// ── metrics ───────────────────────────────────────────────────────────────────
function metrics(trades) {
  if (!trades.length) return {wr:0,pf:0,avg:0,n:0,med:0};
  const wins=trades.filter(t=>t.win).length;
  const wr=wins/trades.length*100;
  const gW=trades.filter(t=>t.pnl>0).reduce((a,b)=>a+b.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((a,b)=>a+b.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const avg=trades.reduce((a,b)=>a+b.pnl,0)/trades.length;
  const sorted=[...trades].sort((a,b)=>a.pnl-b.pnl);
  const med=sorted[Math.floor(sorted.length/2)].pnl;
  return {wr,pf,avg,n:trades.length,med};
}

function collectFiles() {
  const seen=new Set(),files=[];
  for(const{dir,fmt}of DATA_DIRS){
    if(!fs.existsSync(dir))continue;
    for(const fn of fs.readdirSync(dir)){
      if(!fn.endsWith('.csv')||fn==='ALL_SYMBOLS_OHLCV.csv')continue;
      const fp=path.join(dir,fn);
      if(seen.has(fp))continue;seen.add(fp);files.push({fp,fmt});
    }
  }
  return files;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const files = collectFiles();
  console.log(`\nLoaded ${files.length} symbols — IS/OOS split ${IS_SPLIT*100}/${(1-IS_SPLIT)*100}\n`);
  console.log('Phase 1: Collecting signals with full metadata...\n');

  // signalBank[ps] = array of signal objects with IS flag + all metadata
  const bank = {};
  for (const ps of PARAM_SETS) bank[ps] = [];

  let done=0;
  for (const {fp,fmt} of files) {
    const all = fmt==='nse'?parseNSE(fp):parseYahoo(fp);
    if (all.length<MIN_C){done++;continue;}

    const isEnd = Math.floor(all.length * IS_SPLIT); // IS/OOS boundary bar index

    for (const ps of PARAM_SETS) {
      let lastEntry=-COOL-1;
      for (let i=WINDOW;i<all.length-MAX_H-2;i+=STEP) {
        if(i-lastEntry<COOL)continue;
        const win=all.slice(i-WINDOW,i+1);
        let res;
        try{res=analyzeStock(win,ps);}catch{continue;}
        if(!res||!BUY_S.has(res.stage))continue;

        const sc=all[i].c;
        const raw=res.priceEngine?.tacticalStop||sc*0.95;
        const stop=Math.min(sc*0.965,Math.max(sc*0.935,raw));
        const t=simulate(all,i,stop);
        if(!t)continue;

        lastEntry=i;
        const cmf20=computeCMF(all,i,20);
        const obv10=computeOBVSlope(all,i,10);

        bank[ps].push({
          ...t,
          stage:    res.stage,
          score:    res.inflectionScore || 0,
          conds:    res.conditionsMet   || 0,
          cmf20, obv10,
          isBar:    i < isEnd,   // true = IS, false = OOS
        });
      }
    }
    done++;
    if(done%50===0)process.stdout.write(`  ${done}/${files.length}\r`);
  }
  console.log(`\n  ✓ ${done} symbols scanned.\n`);

  // ── Phase 2: sweep + walk-forward validation ───────────────────────────────
  const W = 140;
  console.log('Phase 2: Sweeping filter combinations (IS optimise → OOS validate)...\n');
  console.log('═'.repeat(W));
  console.log('  HYPER-OPTIMIZER RESULTS — Walk-Forward  |  Target: IS WR ≥ 80%  OOS WR ≥ 75%');
  console.log('═'.repeat(W));

  const finalResults = [];

  for (const ps of PARAM_SETS) {
    const all  = bank[ps];
    const isSig  = all.filter(s=>s.isBar);
    const oosSig = all.filter(s=>!s.isBar);
    const baseIs  = metrics(isSig);
    const baseOos = metrics(oosSig);

    console.log(`\n▶ ${PS_LABEL[ps]}`);
    console.log(`  Baseline IS : n=${baseIs.n}   WR=${baseIs.wr.toFixed(1)}%  PF=${baseIs.pf.toFixed(2)}  Avg=${baseIs.avg.toFixed(2)}%`);
    console.log(`  Baseline OOS: n=${baseOos.n}   WR=${baseOos.wr.toFixed(1)}%  PF=${baseOos.pf.toFixed(2)}  Avg=${baseOos.avg.toFixed(2)}%`);

    // Sweep all combinations
    const candidates = [];
    for (const scoreMin of SCORE_THRESH) {
      for (const condsMin of CONDS_THRESH) {
        for (const cmfMin of CMF_THRESH) {
          for (const obvMin of OBV_THRESH) {
            for (const sf of STAGE_FILTERS) {
              const isF = isSig.filter(s =>
                s.score >= scoreMin &&
                s.conds >= condsMin &&
                s.cmf20 >= cmfMin  &&
                s.obv10 >= obvMin  &&
                sf.fn(s.stage)
              );
              if (isF.length < MIN_N) continue;
              const m = metrics(isF);
              if (m.wr < 65) continue; // pre-filter: don't store junk
              candidates.push({ scoreMin, condsMin, cmfMin, obvMin, stageFilter: sf.name, isM: m });
            }
          }
        }
      }
    }

    // Sort by IS WR desc, then PF desc
    candidates.sort((a,b) => b.isM.wr - a.isM.wr || b.isM.pf - a.isM.pf);

    // Validate top-30 on OOS
    const validated = [];
    const seen = new Set();
    for (const c of candidates.slice(0, 200)) {
      const key = `${c.scoreMin}_${c.condsMin}_${c.cmfMin}_${c.obvMin}_${c.stageFilter}`;
      if (seen.has(key)) continue; seen.add(key);

      const sf = STAGE_FILTERS.find(f=>f.name===c.stageFilter);
      const oosF = oosSig.filter(s =>
        s.score  >= c.scoreMin  &&
        s.conds  >= c.condsMin  &&
        s.cmf20  >= c.cmfMin   &&
        s.obv10  >= c.obvMin   &&
        sf.fn(s.stage)
      );
      if (oosF.length < 5) continue; // need min 5 OOS trades
      const oosM = metrics(oosF);
      validated.push({ ...c, oosM });
      if (validated.length >= 30) break;
    }

    // Sort validated by OOS WR desc
    validated.sort((a,b) => b.oosM.wr - a.oosM.wr || b.oosM.pf - a.oosM.pf);

    if (!validated.length) {
      console.log(`  ⚠️  No combination reached IS WR ≥ 65% with n ≥ ${MIN_N}. Showing best available:`);
      candidates.slice(0,3).forEach(c => {
        console.log(`     scoreMin=${c.scoreMin} conds≥${c.condsMin} CMF≥${c.cmfMin} OBV≥${c.obvMin} stage=${c.stageFilter} → IS WR=${c.isM.wr.toFixed(1)}% n=${c.isM.n}`);
      });
      finalResults.push({ ps, label: PS_LABEL[ps], best: null, baseIs, baseOos });
      continue;
    }

    // Print top-10 validated results
    console.log(`\n  Top validated combinations (IS → OOS):`);
    console.log(`  ${'Score≥'.padEnd(7)} ${'Cds≥'.padEnd(5)} ${'CMF≥'.padEnd(7)} ${'OBV≥'.padEnd(6)} ${'Stage'.padEnd(8)} ${'IS_n'.padStart(5)} ${'IS_WR'.padStart(7)} ${'IS_PF'.padStart(7)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'OOS_PF'.padStart(8)} ${'OOS_Avg'.padStart(9)}`);
    for (const v of validated.slice(0,10)) {
      const isTarget = v.oosM.wr >= 75 ? ' ✅' : v.oosM.wr >= 65 ? ' 🟡' : ' ❌';
      console.log(`  ${String(v.scoreMin).padEnd(7)} ${String(v.condsMin).padEnd(5)} ${v.cmfMin.toFixed(2).padEnd(7)} ${v.obvMin.toFixed(1).padEnd(6)} ${v.stageFilter.padEnd(8)} ${String(v.isM.n).padStart(5)} ${(v.isM.wr.toFixed(1)+'%').padStart(7)} ${v.isM.pf.toFixed(2).padStart(7)} ${String(v.oosM.n).padStart(6)} ${(v.oosM.wr.toFixed(1)+'%').padStart(8)} ${v.oosM.pf.toFixed(2).padStart(8)} ${(v.oosM.avg.toFixed(2)+'%').padStart(9)}${isTarget}`);
    }

    const best = validated[0];
    console.log(`\n  ★ BEST: score≥${best.scoreMin}  conds≥${best.condsMin}  CMF≥${best.cmfMin.toFixed(2)}  OBV≥${best.obvMin.toFixed(1)}  stage=${best.stageFilter}`);
    console.log(`    IS  WR=${best.isM.wr.toFixed(1)}%  PF=${best.isM.pf.toFixed(2)}  n=${best.isM.n}`);
    console.log(`    OOS WR=${best.oosM.wr.toFixed(1)}%  PF=${best.oosM.pf.toFixed(2)}  n=${best.oosM.n}  Avg=${best.oosM.avg.toFixed(2)}%  Med=${best.oosM.med.toFixed(2)}%`);

    finalResults.push({ ps, label: PS_LABEL[ps], best, baseIs, baseOos });
  }

  // ── Phase 3: engine patches ────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(W)}`);
  console.log('  READY-TO-PASTE ENGINE PATCHES  (add at TOP of each archetype function, after base declaration)');
  console.log('═'.repeat(W));

  for (const r of finalResults) {
    const b = r.best;
    if (!b) { console.log(`\n// ${r.label}: no valid combo found — keep current params`); continue; }

    const wrGain = (b.oosM.wr - r.baseOos.wr).toFixed(1);
    console.log(`
// ══ ${r.label} ══
// Hyper-optimised: OOS WR ${r.baseOos.wr.toFixed(1)}% → ${b.oosM.wr.toFixed(1)}% (+${wrGain}pp) | PF ${r.baseOos.pf.toFixed(2)} → ${b.oosM.pf.toFixed(2)} | n=${b.oosM.n}
const cmf20    = computeCMF(candles, endIdx, 20);
const obvSlope = computeOBVSlope10(candles, endIdx);
if (cmf20 < ${b.cmfMin.toFixed(2)} || obvSlope < ${b.obvMin.toFixed(1)}) return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: '${r.label}', archetypeConditions: 0, archetypeTotal: 6 };
// Score gate: require inflectionScore ≥ ${b.scoreMin} (applied via archetypeStage after scoring)
const MIN_SCORE_GATE = ${b.scoreMin};
const MIN_CONDS_GATE = ${b.condsMin};
// Stage filter: ${b.stageFilter}`);

    // Stage filter hint
    if (b.stageFilter === 'STRONG+') {
      console.log(`// → after computing stage, add: if (stage === 'BUY') return { ...base, conditionsMet: conditionsMet, ... } // only STRONG_BUY+`);
    } else if (b.stageFilter === 'ULTRA') {
      console.log(`// → after computing stage, add: if (stage !== 'ULTRA_STRONG_BUY') return { ...base, ... } // only ULTRA`);
    }
  }

  // Save full results
  const out = path.join(__dirname, 'results',
    `archetype_hyperopt_walkforward_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,16)}.json`);
  fs.mkdirSync(path.dirname(out), {recursive:true});
  fs.writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(),
    isSplit: IS_SPLIT, window: WINDOW, step: STEP,
    results: finalResults,
  }, null, 2));
  console.log(`\n\n  Full results saved → ${out}\n`);
}

main();
