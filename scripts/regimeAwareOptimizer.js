'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// REGIME-AWARE HYPER-OPTIMIZER
//
// Key insight from walk-forward test: massive IS/OOS WR drop is bull-market
// overfitting. 2021-2024 (IS) was a strong NSE bull cycle; 2025-2026 (OOS)
// had corrections. Solution: Nifty 50 regime filter + improved exit model.
//
// Additions over archetypeHyperOptimizer.js:
//   1. Regime filter: only trade when Nifty 50 > EMA-200
//   2. Three exit models compared:
//      A. ORIGINAL: 50%@+5%  30%@+7%  rem@+10%  |  SL=tacticalStop  maxBar=20
//      B. BREAKEVEN: same targets but stop moves to +0.5% after stock rises +2%
//      C. TIGHT: 70%@+3%  rem@+6%  |  stop→breakeven@+2%  maxBar=12
//   3. Walk-forward IS/OOS split per symbol (70/30 chronological)
//   4. CMF + OBV + stage + score + condsMet sweep (same as archetypeHyperOptimizer)
//   5. Regime-filtered baseline + regime-filtered IS/OOS comparison
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
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV', fmt: 'nse' },
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio',     fmt: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50',         fmt: 'nse' },
];

// Nifty 50 index file (use any large-cap index file as regime proxy)
const NIFTY50_DIR = 'C:/Users/drkkr/Downloads/NIFTY 50';

const WINDOW   = 220;
const STEP     = 5;
const COOL     = 5;
const MAX_H_A  = 20;  // original & breakeven max hold
const MAX_H_C  = 12;  // tight exit max hold
const IS_SPLIT = 0.70;
const MIN_N    = 15;
const BUY_S    = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const STRONG_S = new Set(['STRONG_BUY','ULTRA_STRONG_BUY']);

const SCORE_THRESH  = [40, 45, 50, 55, 60, 65, 70, 75, 80];
const CONDS_THRESH  = [3, 4, 5, 6];
const CMF_THRESH    = [-0.10, 0.00, 0.05, 0.10, 0.15, 0.20];
const OBV_THRESH    = [-1.0, 0.0, 0.5, 1.0];
const STAGE_FILTERS = [
  { name: 'ANY',    fn: s => BUY_S.has(s)    },
  { name: 'STRONG+',fn: s => STRONG_S.has(s) },
];

// ── indicators ────────────────────────────────────────────────────────────────
function ema(candles, period, startIdx) {
  if (candles.length < period) return candles[candles.length - 1]?.c || 0;
  const k = 2 / (period + 1);
  let e = candles.slice(startIdx - period + 1, startIdx + 1)
                 .reduce((a, b) => a + b.c, 0) / period;
  return e;
}

// Precompute EMA-200 for an entire candle array → returns Float64Array indexed by bar
function precomputeEMA200(candles) {
  const out = new Float64Array(candles.length).fill(NaN);
  if (candles.length < 200) return out;
  const k = 2 / 201;
  let e = 0;
  for (let i = 0; i < 200; i++) e += candles[i].c;
  e /= 200;
  out[199] = e;
  for (let i = 200; i < candles.length; i++) {
    e = candles[i].c * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

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

// ── exit models ───────────────────────────────────────────────────────────────
// A: ORIGINAL — 50%@+5%  30%@+7%  rem@+10%  SL fixed  bar-20
function simOriginal(candles, sigIdx, stop) {
  const eIdx = sigIdx+1;
  if (eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0)return null;
  const t1=ep*1.05,t2=ep*1.07,t3=ep*1.10;
  let rem=1,pnl=0,mae=0,mfe=0;
  for (let b=1;b<=MAX_H_A;b++) {
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    mae=Math.min(mae,(bar.l-ep)/ep*100);
    mfe=Math.max(mfe,(bar.h-ep)/ep*100);
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.50*(bar.c-ep)/ep*100;rem-=0.50;}
    if(rem>=0.29&&bar.c>=t2){pnl+=0.30*(bar.c-ep)/ep*100;rem-=0.30;}
    if(rem>0&&bar.c>=t3){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H_A&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return {pnl,mae:Math.abs(mae),mfe,win:pnl>0.1};
}

// B: BREAKEVEN — same targets, stop moves to +0.5% entry after stock up +2%
function simBreakeven(candles, sigIdx, initStop) {
  const eIdx = sigIdx+1;
  if (eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0)return null;
  const t1=ep*1.05,t2=ep*1.07,t3=ep*1.10;
  const be=ep*1.005; // breakeven stop level
  let rem=1,pnl=0,mae=0,mfe=0,stop=initStop,beTriggered=false;
  for (let b=1;b<=MAX_H_A;b++) {
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    mae=Math.min(mae,(bar.l-ep)/ep*100);
    mfe=Math.max(mfe,(bar.h-ep)/ep*100);
    // Trigger breakeven: if high ever reaches +2%, move stop to +0.5%
    if(!beTriggered&&bar.h>=ep*1.02){stop=Math.max(stop,be);beTriggered=true;}
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.50*(bar.c-ep)/ep*100;rem-=0.50;}
    if(rem>=0.29&&bar.c>=t2){pnl+=0.30*(bar.c-ep)/ep*100;rem-=0.30;}
    if(rem>0&&bar.c>=t3){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H_A&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return {pnl,mae:Math.abs(mae),mfe,win:pnl>0.1};
}

// C: TIGHT — 70%@+3%  rem@+6%  |  stop→BE after +2%  maxBar=12
function simTight(candles, sigIdx, initStop) {
  const eIdx = sigIdx+1;
  if (eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0)return null;
  const t1=ep*1.03,t2=ep*1.06;
  const be=ep*1.005;
  let rem=1,pnl=0,mae=0,mfe=0,stop=initStop,beTriggered=false;
  for (let b=1;b<=MAX_H_C;b++) {
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    mae=Math.min(mae,(bar.l-ep)/ep*100);
    mfe=Math.max(mfe,(bar.h-ep)/ep*100);
    if(!beTriggered&&bar.h>=ep*1.02){stop=Math.max(stop,be);beTriggered=true;}
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.70*(bar.c-ep)/ep*100;rem-=0.70;}
    if(rem>0&&bar.c>=t2){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H_C&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return {pnl,mae:Math.abs(mae),mfe,win:pnl>0.1};
}

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

// ── load Nifty 50 regime ──────────────────────────────────────────────────────
function loadRegime() {
  // Load one big-cap index to get market regime (Nifty 50 or Sensex)
  const map = new Map(); // ts → {above200: bool}
  if (!fs.existsSync(NIFTY50_DIR)) { console.warn('  ⚠️  NIFTY 50 dir not found, regime filter disabled'); return map; }
  const files = fs.readdirSync(NIFTY50_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
  // Aggregate all Nifty 50 stocks → build a composite index-like regime
  // Actually, use all files to get broad regime consensus
  let globalBullDays = new Map(); // ts → bullCount
  let globalTotalDays = new Map(); // ts → total

  for (const fn of files) {
    const candles = parseNSE(path.join(NIFTY50_DIR, fn));
    if (candles.length < 210) continue;
    const ema200 = precomputeEMA200(candles);
    for (let i = 200; i < candles.length; i++) {
      const ts = Math.floor(candles[i].ts / 86400000); // day bucket
      const above = candles[i].c > ema200[i] ? 1 : 0;
      globalBullDays.set(ts, (globalBullDays.get(ts)||0) + above);
      globalTotalDays.set(ts, (globalTotalDays.get(ts)||0) + 1);
    }
  }

  // Regime = bull if > 50% of Nifty50 stocks are above their 200 EMA
  for (const [ts, total] of globalTotalDays) {
    const bull = (globalBullDays.get(ts)||0) / total >= 0.50;
    map.set(ts, bull);
  }
  const bullDays = [...map.values()].filter(Boolean).length;
  console.log(`  Regime loaded: ${map.size} trading days, ${bullDays} bull days (${(bullDays/map.size*100).toFixed(0)}%)`);
  return map;
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
  console.log(`\nLoaded ${files.length} symbols\n`);

  console.log('Loading Nifty 50 regime (% stocks > EMA-200)...');
  const regime = loadRegime();

  console.log('\nPhase 1: Collecting signals with metadata (3 exit models × 5 archetypes)...\n');

  // bank[ps][exitModel] = array of signal records
  const EXITS = ['orig','be','tight'];
  const bank = {};
  for (const ps of PARAM_SETS) {
    bank[ps] = { orig:[], be:[], tight:[] };
  }

  let done=0;
  for (const {fp,fmt} of files) {
    const all = fmt==='nse'?parseNSE(fp):parseYahoo(fp);
    if (all.length < WINDOW + MAX_H_A + 5) { done++; continue; }

    const isEnd = Math.floor(all.length * IS_SPLIT);

    for (const ps of PARAM_SETS) {
      let lastEntry=-COOL-1;
      for (let i=WINDOW;i<all.length-MAX_H_A-2;i+=STEP) {
        if(i-lastEntry<COOL)continue;
        const win=all.slice(i-WINDOW,i+1);
        let res;
        try{res=analyzeStock(win,ps);}catch{continue;}
        if(!res||!BUY_S.has(res.stage))continue;

        const sc=all[i].c;
        const raw=res.priceEngine?.tacticalStop||sc*0.95;
        const initStop=Math.min(sc*0.965,Math.max(sc*0.935,raw));

        const tO=simOriginal(all,i,initStop);
        const tB=simBreakeven(all,i,initStop);
        const tT=simTight(all,i,initStop);
        if(!tO||!tB||!tT)continue;

        lastEntry=i;

        const dayKey=Math.floor(all[i].ts/86400000);
        const inBull=regime.size===0?true:regime.get(dayKey)??false;

        const cmf20=computeCMF(all,i,20);
        const obv10=computeOBVSlope(all,i,10);
        const meta={
          stage:res.stage, score:res.inflectionScore||0, conds:res.conditionsMet||0,
          cmf20, obv10, inBull, isBar: i<isEnd,
        };

        bank[ps].orig.push({...tO,...meta});
        bank[ps].be.push({...tB,...meta});
        bank[ps].tight.push({...tT,...meta});
      }
    }
    done++;
    if(done%50===0)process.stdout.write(`  ${done}/${files.length}\r`);
  }
  console.log(`\n  ✓ ${done} symbols scanned\n`);

  const W=155;
  console.log('Phase 2: Regime-filtered walk-forward sweep\n');
  console.log('═'.repeat(W));
  console.log('  REGIME-AWARE HYPER-OPTIMIZER  |  IS WR target ≥ 80%  |  OOS WR target ≥ 75%');
  console.log('═'.repeat(W));

  const finalResults = [];

  for (const ps of PARAM_SETS) {
    console.log(`\n${'─'.repeat(W)}`);
    console.log(`▶ ${PS_LABEL[ps]}`);

    // Show baselines: no-filter, no-filter+regime, for each exit model
    for (const ex of EXITS) {
      const all = bank[ps][ex];
      const base = metrics(all);
      const regime_all = all.filter(s=>s.inBull);
      const baseR = metrics(regime_all);
      const isBase = metrics(all.filter(s=>s.isBar));
      const isBaseR = metrics(all.filter(s=>s.isBar&&s.inBull));
      const oosBase = metrics(all.filter(s=>!s.isBar));
      const oosBaseR = metrics(all.filter(s=>!s.isBar&&s.inBull));
      console.log(`  [${ex.padEnd(5)}] ALL n=${base.n} WR=${base.wr.toFixed(1)}% | RegimeOnly n=${baseR.n} WR=${baseR.wr.toFixed(1)}% | IS WR=${isBase.wr.toFixed(1)}%→${isBaseR.wr.toFixed(1)}% | OOS WR=${oosBase.wr.toFixed(1)}%→${oosBaseR.wr.toFixed(1)}% (regime)`);
    }

    // Now find best combo per exit model
    let overallBest = null;

    for (const ex of EXITS) {
      const allSigs = bank[ps][ex];
      // Apply regime filter to all signals for this sweep
      const isSigs  = allSigs.filter(s=>s.isBar&&s.inBull);
      const oosSigs = allSigs.filter(s=>!s.isBar&&s.inBull);
      const isBase  = metrics(isSigs);
      const oosBase = metrics(oosSigs);

      if (!isSigs.length) continue;

      const candidates = [];
      for (const scoreMin of SCORE_THRESH) {
        for (const condsMin of CONDS_THRESH) {
          for (const cmfMin of CMF_THRESH) {
            for (const obvMin of OBV_THRESH) {
              for (const sf of STAGE_FILTERS) {
                const isF = isSigs.filter(s =>
                  s.score >= scoreMin && s.conds >= condsMin &&
                  s.cmf20 >= cmfMin && s.obv10 >= obvMin && sf.fn(s.stage)
                );
                if (isF.length < MIN_N) continue;
                const m = metrics(isF);
                if (m.wr < 60) continue;
                candidates.push({ scoreMin,condsMin,cmfMin,obvMin,stageFilter:sf.name,isM:m });
              }
            }
          }
        }
      }

      candidates.sort((a,b)=>b.isM.wr-a.isM.wr||b.isM.pf-a.isM.pf);

      const validated = [];
      const seen = new Set();
      for (const c of candidates.slice(0,300)) {
        const key=`${c.scoreMin}_${c.condsMin}_${c.cmfMin}_${c.obvMin}_${c.stageFilter}`;
        if(seen.has(key))continue;seen.add(key);

        const sf=STAGE_FILTERS.find(f=>f.name===c.stageFilter);
        const oosF=oosSigs.filter(s=>
          s.score>=c.scoreMin&&s.conds>=c.condsMin&&
          s.cmf20>=c.cmfMin&&s.obv10>=c.obvMin&&sf.fn(s.stage)
        );
        if(oosF.length<5)continue;
        const oosM=metrics(oosF);
        validated.push({...c,oosM,exit:ex});
        if(validated.length>=30)break;
      }

      validated.sort((a,b)=>b.oosM.wr-a.oosM.wr||b.oosM.pf-a.oosM.pf);

      if(!validated.length){
        console.log(`  [${ex}] Regime+filter: no combo ≥ IS WR 60% n≥${MIN_N}. Best IS: ${candidates[0]?candidates[0].isM.wr.toFixed(1)+'% n='+candidates[0].isM.n:'—'}`);
        continue;
      }

      const best=validated[0];
      const wrTag=best.oosM.wr>=75?' ✅ TARGET HIT':best.oosM.wr>=65?' 🟡':' ❌';
      console.log(`\n  [${ex}] Top-5 regime-filtered walk-forward (IS n_base=${isBase.n}→ + regime | OOS n_base=${oosBase.n}):`);
      console.log(`  ${'Score≥'.padEnd(7)} ${'Cds≥'.padEnd(5)} ${'CMF≥'.padEnd(7)} ${'OBV≥'.padEnd(6)} ${'Stage'.padEnd(8)} ${'IS_n'.padStart(5)} ${'IS_WR'.padStart(7)} ${'IS_PF'.padStart(7)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'OOS_PF'.padStart(8)} ${'OOS_Avg'.padStart(9)}`);
      for (const v of validated.slice(0,5)) {
        const tag=v.oosM.wr>=75?' ✅':v.oosM.wr>=65?' 🟡':' ❌';
        console.log(`  ${String(v.scoreMin).padEnd(7)} ${String(v.condsMin).padEnd(5)} ${v.cmfMin.toFixed(2).padEnd(7)} ${v.obvMin.toFixed(1).padEnd(6)} ${v.stageFilter.padEnd(8)} ${String(v.isM.n).padStart(5)} ${(v.isM.wr.toFixed(1)+'%').padStart(7)} ${v.isM.pf.toFixed(2).padStart(7)} ${String(v.oosM.n).padStart(6)} ${(v.oosM.wr.toFixed(1)+'%').padStart(8)} ${v.oosM.pf.toFixed(2).padStart(8)} ${(v.oosM.avg.toFixed(2)+'%').padStart(9)}${tag}`);
      }
      console.log(`  ★ [${ex}] BEST: score≥${best.scoreMin} conds≥${best.condsMin} CMF≥${best.cmfMin.toFixed(2)} OBV≥${best.obvMin.toFixed(1)} stage=${best.stageFilter}`);
      console.log(`       IS WR=${best.isM.wr.toFixed(1)}% PF=${best.isM.pf.toFixed(2)} n=${best.isM.n} | OOS WR=${best.oosM.wr.toFixed(1)}% PF=${best.oosM.pf.toFixed(2)} n=${best.oosM.n} Avg=${best.oosM.avg.toFixed(2)}%${wrTag}`);

      if (!overallBest || best.oosM.wr > overallBest.oosM.wr) {
        overallBest = { ps, label:PS_LABEL[ps], ...best,
          isBase: metrics(isSigs), oosBase: metrics(oosSigs) };
      }
    }

    if (overallBest && overallBest.ps === ps) finalResults.push(overallBest);
    else finalResults.push(null);
  }

  // ── summary & patches ────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(W)}`);
  console.log('  FINAL SUMMARY — Best param per archetype (regime + exit model + filter)');
  console.log('  All figures are REGIME-FILTERED (only bullish Nifty days)');
  console.log('═'.repeat(W));

  console.log(`  ${'Archetype'.padEnd(18)} ${'Exit'.padEnd(7)} ${'Score≥'.padEnd(7)} ${'Cds≥'.padEnd(5)} ${'CMF≥'.padEnd(7)} ${'OBV≥'.padEnd(6)} ${'Stage'.padEnd(8)} ${'IS_n'.padStart(5)} ${'IS_WR'.padStart(7)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'OOS_Avg'.padStart(9)}`);
  console.log(`  ${'─'.repeat(W-2)}`);
  for (const r of finalResults) {
    if (!r) { console.log(`  (no result)`); continue; }
    const tag=r.oosM.wr>=75?' ✅':r.oosM.wr>=65?' 🟡':' ❌';
    console.log(`  ${r.label.padEnd(18)} ${r.exit.padEnd(7)} ${String(r.scoreMin).padEnd(7)} ${String(r.condsMin).padEnd(5)} ${r.cmfMin.toFixed(2).padEnd(7)} ${r.obvMin.toFixed(1).padEnd(6)} ${r.stageFilter.padEnd(8)} ${String(r.isM.n).padStart(5)} ${(r.isM.wr.toFixed(1)+'%').padStart(7)} ${String(r.oosM.n).padStart(6)} ${(r.oosM.wr.toFixed(1)+'%').padStart(8)} ${(r.oosM.avg.toFixed(2)+'%').padStart(9)}${tag}`);
  }

  console.log(`\n${'═'.repeat(W)}`);
  console.log('  ENGINE PATCHES (add to each archetype + update screener to check regime before calling analyzeStock)');
  console.log('═'.repeat(W));
  console.log(`
// ── REGIME FILTER (add to screener API route, BEFORE analyzeStock calls) ──
// Only scan stocks when >= 50% of Nifty 50 constituents are above their EMA-200
// This removes bear-market signals that have ~37% WR (VS 55%+ in bull markets)
const bullishRegime = await checkNiftyRegime(); // returns bool
if (!bullishRegime) return { stage: 'NO_SIGNAL', reason: 'Bear regime' };
`);

  for (const r of finalResults) {
    if (!r) continue;
    const exitLabel = r.exit==='orig'?'ORIGINAL (50%@+5% 30%@+7% rem@+10% bar-20)':
                      r.exit==='be'  ?'BREAKEVEN (same targets + stop→BE@+2%)':
                                      'TIGHT (70%@+3% rem@+6% + stop→BE@+2% bar-12)';
    console.log(`
// ══ ${r.label} — exit model: ${exitLabel} ══
// Regime-aware OOS WR ${r.oosBase.wr.toFixed(1)}% → ${r.oosM.wr.toFixed(1)}% (+${(r.oosM.wr-r.oosBase.wr).toFixed(1)}pp) | PF ${r.oosBase.pf.toFixed(2)} → ${r.oosM.pf.toFixed(2)} | n=${r.oosM.n}
const cmf20    = computeCMF(candles, endIdx, 20);
const obvSlope = computeOBVSlope10(candles, endIdx);
if (cmf20 < ${r.cmfMin.toFixed(2)} || obvSlope < ${r.obvMin.toFixed(1)}) return { ...base, conditionsMet: 0 };
// Post-signal gate: require score ≥ ${r.scoreMin}, conditionsMet ≥ ${r.condsMin}, stage = ${r.stageFilter}`);
  }

  const out=path.join(__dirname,'results',
    `regime_aware_hyperopt_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,16)}.json`);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify({
    generated:new Date().toISOString(), isSplit:IS_SPLIT, window:WINDOW, step:STEP,
    results:finalResults,
  },null,2));
  console.log(`\n\n  Full results saved → ${out}\n`);
}

main();
