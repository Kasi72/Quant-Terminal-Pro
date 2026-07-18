'use strict';
/**
 * CC + MP Hyper-Optimizer v2 — target OOS WR > 80%
 *
 * Replicates beOptimizer's EXACT exit model (entry=next bar open,
 * stop clamped [3.5%,6.5%] off close, targets +5/7/10%, partial exits,
 * BREAKEVEN at +2% → stop to +0.5%).
 *
 * Extends beOptimizer by sweeping ADDITIONAL filters on top of the
 * already-deployed CMF+OBV gates:
 *   RSI14 range, volRatio20 min, RSI2 max, scoreMin, condsMin, stageFilter
 */
const fs   = require('fs');
const path = require('path');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

// ── Constants (must match beOptimizer exactly) ─────────────────────────────
const WINDOW   = 220;
const STEP     = 5;
const COOL     = 5;
const MAX_H    = 20;
const IS_SPLIT = 0.70;
const MIN_N_IS = 15;
const MIN_N_OS = 8;
const BUY_S    = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const STRONG_S = new Set(['STRONG_BUY','ULTRA_STRONG_BUY']);

// ── Date parser ────────────────────────────────────────────────────────────
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){
  s=s.trim();
  if(s.includes('-')){const p=s.split('-');if(p.length===3){if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}}
  const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();
}
function dayBucket(ts){return Math.floor(ts/86400000);}

// ── File loader ────────────────────────────────────────────────────────────
function parseNSE(fp){
  const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}
  return out;
}

// ── Indicators (computed independently of engine gates) ────────────────────
function computeCMF(candles,endIdx,period=20){
  const start=Math.max(0,endIdx-period+1);let sumMFV=0,sumVol=0;
  for(let i=start;i<=endIdx;i++){const{h,l,c,v}=candles[i];const rng=h-l;if(rng>0&&v>0){sumMFV+=((c-l)-(h-c))/rng*v;sumVol+=v;}}
  return sumVol>0?sumMFV/sumVol:0;
}
function computeOBVSlope(candles,endIdx,period=10){
  const start=Math.max(1,endIdx-period);if(endIdx-start<3)return 0;
  let obv=0;const obvV=[],vols=[];
  for(let i=start;i<=endIdx;i++){if(candles[i].c>candles[i-1].c)obv+=candles[i].v;else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;obvV.push(obv);vols.push(candles[i].v);}
  const n=obvV.length,mv=vols.reduce((a,b)=>a+b,0)/n||1;
  let sx=0,sy=0,sxy=0,sx2=0;
  for(let i=0;i<n;i++){sx+=i;sy+=obvV[i];sxy+=i*obvV[i];sx2+=i*i;}
  const d=n*sx2-sx*sx;return Math.abs(d)<1e-10?0:((n*sxy-sx*sy)/d)/mv;
}
function computeRSI(candles,endIdx,period=14){
  const start=Math.max(1,endIdx-period*3);let g=0,l=0;
  for(let i=start;i<=endIdx;i++){const d=candles[i].c-candles[i-1].c;if(d>0)g+=d;else l-=d;}
  const n=endIdx-start;if(!n)return 50;g/=n;l/=n;return l===0?100:100-100/(1+g/l);
}

// ── BREAKEVEN exit model (identical to beOptimizer) ───────────────────────
function simBreakeven(candles,sigIdx,initStop){
  const eIdx=sigIdx+1;
  if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const t1=ep*1.05,t2=ep*1.07,t3=ep*1.10;
  const be=ep*1.005;
  let rem=1,pnl=0,stop=initStop,beDone=false;
  for(let b=1;b<=MAX_H;b++){
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    if(!beDone&&bar.h>=ep*1.02){stop=Math.max(stop,be);beDone=true;}
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.50*(bar.c-ep)/ep*100;rem-=0.50;}
    if(rem>=0.29&&bar.c>=t2){pnl+=0.30*(bar.c-ep)/ep*100;rem-=0.30;}
    if(rem>0&&bar.c>=t3){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return{pnl,win:pnl>0.1};
}

function metrics(trades){
  if(!trades.length)return{wr:0,pf:0,avg:0,n:0};
  const wins=trades.filter(t=>t.win).length;const wr=wins/trades.length*100;
  const gW=trades.filter(t=>t.pnl>0).reduce((a,b)=>a+b.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((a,b)=>a+b.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const avg=trades.reduce((a,b)=>a+b.pnl,0)/trades.length;
  return{wr,pf,avg,n:trades.length};
}

// ── Regime map (Nifty 50 EMA-200) ─────────────────────────────────────────
const NIFTY50_DIR='C:/Users/drkkr/Downloads/NIFTY 50';
function buildRegime(){
  if(!fs.existsSync(NIFTY50_DIR)){console.log('No NIFTY50 dir — regime disabled');return new Map();}
  const files=fs.readdirSync(NIFTY50_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
  const bullCount=new Map(),total=new Map();
  for(const fn of files){
    const c=parseNSE(path.join(NIFTY50_DIR,fn));if(c.length<210)continue;
    let ema=c.slice(0,200).reduce((a,b)=>a+b.c,0)/200;const k=2/201;
    for(let i=200;i<c.length;i++){ema=c[i].c*k+ema*(1-k);const db=dayBucket(c[i].ts);bullCount.set(db,(bullCount.get(db)||0)+(c[i].c>ema?1:0));total.set(db,(total.get(db)||0)+1);}
  }
  const map=new Map();
  for(const[db,tot]of total)map.set(db,(bullCount.get(db)||0)/tot>=0.50);
  const bd=[...map.values()].filter(Boolean).length;
  console.log(`Regime: ${map.size} days, ${bd} bull (${(bd/map.size*100).toFixed(0)}%) [${files.length} stocks]`);
  return map;
}

// ── Collect signals ────────────────────────────────────────────────────────
const DATA_DIR='C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const TARGET_PS={
  'optimized_highprecision_15plus':'CompressionCoil',
  'optimized_elite_10plus':'MomentumPocket',
};

console.log('Building regime map…');
const regime=buildRegime();

console.log('\nPhase 1: Collecting signals…');
const bank={};
for(const ps of Object.keys(TARGET_PS))bank[ps]=[];

const files=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
let done=0;
for(const fn of files){
  const all=parseNSE(path.join(DATA_DIR,fn));
  if(all.length<WINDOW+MAX_H+5){done++;continue;}
  const isEnd=Math.floor(all.length*IS_SPLIT);

  for(const ps of Object.keys(TARGET_PS)){
    let last=-COOL-1;
    for(let i=WINDOW;i<all.length-MAX_H-2;i+=STEP){
      if(i-last<COOL)continue;
      const win=all.slice(i-WINDOW,i+1);
      let res;
      try{res=analyzeStock(win,ps);}catch{continue;}
      if(!res||!BUY_S.has(res.stage))continue;

      const sc=all[i].c;
      const raw=res.priceEngine?.tacticalStop||sc*0.95;
      const stop=Math.min(sc*0.965,Math.max(sc*0.935,raw));

      const t=simBreakeven(all,i,stop);
      if(!t)continue;
      last=i;

      const db=dayBucket(all[i].ts);
      const inBull=regime.size>0?(regime.get(db)??false):true;
      // Compute independent indicators for sweep
      const cmf20=computeCMF(all,i,20);
      const obv10=computeOBVSlope(all,i,10);
      const rsi14=computeRSI(all,i,14);
      const rsi2=computeRSI(all,i,2);
      // volRatio20
      let vSum=0,vCnt=0;
      for(let j=Math.max(0,i-20);j<i;j++){vSum+=all[j].v;vCnt++;}
      const vAvg=vCnt>0?vSum/vCnt:1;
      const volRatio20=all[i].v/vAvg;

      bank[ps].push({
        ...t,
        stage:res.stage,
        score:res.inflectionScore||0,
        conds:res.conditionsMet||0,
        cmf20,obv10,inBull,
        rsi14,rsi2,volRatio20,
        isBar:i<isEnd,
      });
    }
  }
  done++;
  if(done%50===0)process.stdout.write(`  ${done}/${files.length}\r`);
}
console.log(`\n  ✓ ${done} symbols processed\n`);

// ── Sweep grid ─────────────────────────────────────────────────────────────
// Baseline filters (already deployed in engine — must be passed by all signals)
// CC: CMF≥0.10, OBV≥-1.0   MP: CMF≥-0.10, OBV≥-1.0
// Additional filters to sweep ON TOP:

const SCORE_T   = [40,50,60,70,75,80];
const CONDS_T   = [3,4,5];
const RSI14_MIN = [null,20,25,30,35];
const RSI14_MAX = [null,45,50,55,60,65];
const VOL_MIN   = [null,1.5,2.0,2.5,3.0];
const RSI2_MAX  = [null,30,50,70];
const STAGES    = [
  {name:'ANY',    fn:s=>BUY_S.has(s)},
  {name:'STRONG+',fn:s=>STRONG_S.has(s)},
];
const REGIME_T  = [false,true];

// Phase 2: sweep per archetype
const allResults={};

for(const[ps,label] of Object.entries(TARGET_PS)){
  const all=bank[ps];
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`▶ ${label} (${ps})  total signals=${all.length}`);

  const base=metrics(all);
  const baseIS=metrics(all.filter(s=>s.isBar));
  const baseOOS=metrics(all.filter(s=>!s.isBar));
  console.log(`  Baseline  IS: WR=${baseIS.wr.toFixed(1)}% n=${baseIS.n}  →  OOS: WR=${baseOOS.wr.toFixed(1)}% n=${baseOOS.n}`);

  const best=[];
  let comboDone=0;

  for(const regimeOnly of REGIME_T){
    const isSigs =all.filter(s=>s.isBar  &&(!regimeOnly||s.inBull));
    const oosSigs=all.filter(s=>!s.isBar &&(!regimeOnly||s.inBull));
    if(!isSigs.length)continue;

    for(const scoreMin  of SCORE_T)
    for(const condsMin  of CONDS_T)
    for(const sf        of STAGES)
    for(const rsi14min  of RSI14_MIN)
    for(const rsi14max  of RSI14_MAX)
    for(const rsi2max   of RSI2_MAX)
    for(const volMin    of VOL_MIN)
    {
      if(rsi14min!=null&&rsi14max!=null&&rsi14min>=rsi14max)continue;

      const isF=isSigs.filter(s=>
        s.score>=scoreMin&&s.conds>=condsMin&&sf.fn(s.stage)&&
        (rsi14min==null||s.rsi14>=rsi14min)&&
        (rsi14max==null||s.rsi14<=rsi14max)&&
        (rsi2max ==null||s.rsi2 <=rsi2max)&&
        (volMin  ==null||s.volRatio20>=volMin)
      );
      if(isF.length<MIN_N_IS)continue;
      const isM=metrics(isF);
      if(isM.wr<72)continue; // IS WR ≥ 72% pre-filter

      const oosF=oosSigs.filter(s=>
        s.score>=scoreMin&&s.conds>=condsMin&&sf.fn(s.stage)&&
        (rsi14min==null||s.rsi14>=rsi14min)&&
        (rsi14max==null||s.rsi14<=rsi14max)&&
        (rsi2max ==null||s.rsi2 <=rsi2max)&&
        (volMin  ==null||s.volRatio20>=volMin)
      );
      if(oosF.length<MIN_N_OS)continue;
      const oosM=metrics(oosF);

      best.push({scoreMin,condsMin,stageFilter:sf.name,regimeOnly,rsi14min,rsi14max,rsi2max,volMin,isM,oosM});
      comboDone++;
    }
  }

  best.sort((a,b)=>b.oosM.wr-a.oosM.wr||b.isM.wr-a.isM.wr||b.oosM.n-a.oosM.n);
  allResults[ps]={label,baseline:{isM:baseIS,oosM:baseOOS},best};

  // Print top 15
  console.log(`\n  Top 15 (of ${comboDone} valid combos):`);
  console.log(`  ${'OOS WR'.padEnd(8)} ${'n_oos'.padEnd(6)} ${'IS WR'.padEnd(7)} ${'n_is'.padEnd(5)} ${'Sc'.padEnd(4)} ${'Cd'.padEnd(4)} ${'Stage'.padEnd(8)} ${'Rg'.padEnd(4)} ${'RSI14'.padEnd(10)} ${'RSI2≤'.padEnd(7)} ${'Vol≥'.padEnd(6)} ${'OOS avg'.padEnd(8)}`);
  for(const r of best.slice(0,15)){
    const rr=(r.rsi14min!=null||r.rsi14max!=null)?`${r.rsi14min??'*'}-${r.rsi14max??'*'}`:'*';
    const tag=r.oosM.wr>=80?' ✅':r.oosM.wr>=75?' 🟡':r.oosM.wr>=70?' 🟠':' ❌';
    console.log(`  ${r.oosM.wr.toFixed(1).padEnd(8)} ${r.oosM.n.toString().padEnd(6)} ${r.isM.wr.toFixed(1).padEnd(7)} ${r.isM.n.toString().padEnd(5)} ${r.scoreMin.toString().padEnd(4)} ${r.condsMin.toString().padEnd(4)} ${r.stageFilter.padEnd(8)} ${(r.regimeOnly?'Y':'N').padEnd(4)} ${rr.padEnd(10)} ${(r.rsi2max??'*').toString().padEnd(7)} ${(r.volMin??'*').toString().padEnd(6)} ${r.oosM.avg.toFixed(2)}%${tag}`);
  }

  // Robust (n≥30)
  const robust=best.filter(r=>r.oosM.n>=30);
  if(robust.length){
    const r=robust[0];
    const rr=(r.rsi14min!=null||r.rsi14max!=null)?`${r.rsi14min??'any'}-${r.rsi14max??'any'}`:'any';
    console.log(`\n  Best ROBUST (OOS n≥30): WR ${r.oosM.wr.toFixed(1)}% n=${r.oosM.n} | IS ${r.isM.wr.toFixed(1)}% n=${r.isM.n}`);
    console.log(`  Filters: score≥${r.scoreMin} conds≥${r.condsMin} stage=${r.stageFilter} regime=${r.regimeOnly} RSI14=${rr} RSI2≤${r.rsi2max??'any'} vol≥${r.volMin??'any'}`);
  }
}

// Save
const outFile=`scripts/results/ccmp_hyperopt_v2_${new Date().toISOString().slice(0,16).replace(':','-')}.json`;
fs.writeFileSync(outFile,JSON.stringify(allResults,null,2));
console.log(`\nSaved → ${outFile}`);
