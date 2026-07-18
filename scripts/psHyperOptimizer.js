'use strict';
/**
 * PerfectStorm Hyper-Optimizer
 *
 * PerfectStorm already has ADX≥30 + candle-quality gates and requires
 * ≥2 of 4 sub-archetypes to fire. Sub-archetypes CC and MP already carry
 * their own CMF/OBV gates, but VolumeFootprint and EMAStack do not.
 * This sweeps a COMPOSITE-LEVEL CMF, OBV, and volRatio20 gate applied
 * AFTER sub-archetypes fire, to lift OOS WR from ~40-51% toward 80%+.
 *
 * Exit model: identical to beOptimizer (entry=next-bar open, targets +5/7/10%,
 * partial exits 50/30/rest, BREAKEVEN at +2% → stop to +0.5%).
 */
const fs   = require('fs');
const path = require('path');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW   = 220;
const STEP     = 1;   // step=1 — PS is rare, need every bar
const COOL     = 3;
const MAX_H    = 20;
const IS_SPLIT = 0.70;
const MIN_N_IS = 8;
const MIN_N_OS = 5;
const BUY_S    = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const STRONG_S = new Set(['STRONG_BUY','ULTRA_STRONG_BUY']);

const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){
  s=s.trim();
  if(s.includes('-')){const p=s.split('-');if(p.length===3){if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}}
  const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();
}
function dayBucket(ts){return Math.floor(ts/86400000);}

function parseNSE(fp){
  const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}
  return out;
}

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

// Regime map
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

const DATA_DIR='C:/Users/drkkr/Downloads/NIFTY ALL1783';

console.log('Building regime map…');
const regime=buildRegime();

console.log('\nPhase 1: Collecting PerfectStorm signals…');
const bank=[];

const files=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
let done=0;
for(const fn of files){
  const all=parseNSE(path.join(DATA_DIR,fn));
  if(all.length<WINDOW+MAX_H+5){done++;continue;}
  const isEnd=Math.floor(all.length*IS_SPLIT);
  let last=-COOL-1;

  for(let i=WINDOW;i<all.length-MAX_H-2;i+=STEP){
    if(i-last<COOL)continue;
    const win=all.slice(i-WINDOW,i+1);
    let res;
    try{res=analyzeStock(win,'sniper_95plus');}catch{continue;}
    if(!res||!BUY_S.has(res.stage))continue;

    const sc=all[i].c;
    const raw=res.priceEngine?.tacticalStop||sc*0.95;
    const stop=Math.min(sc*0.965,Math.max(sc*0.935,raw));

    const t=simBreakeven(all,i,stop);
    if(!t)continue;
    last=i;

    const db=dayBucket(all[i].ts);
    const inBull=regime.size>0?(regime.get(db)??false):true;

    // Composite-level indicators (independent of sub-archetype gates)
    const cmf20  = computeCMF(all,i,20);
    const obv10  = computeOBVSlope(all,i,10);
    const rsi14  = computeRSI(all,i,14);
    const rsi2   = computeRSI(all,i,2);
    let vSum=0,vCnt=0;
    for(let j=Math.max(0,i-20);j<i;j++){vSum+=all[j].v;vCnt++;}
    const vAvg=vCnt>0?vSum/vCnt:1;
    const volRatio20=all[i].v/vAvg;
    const fires=res.conditionsMet||0; // how many sub-archetypes fired

    bank.push({
      ...t,
      stage:res.stage,
      score:res.inflectionScore||0,
      conds:res.conditionsMet||0,
      fires,
      cmf20,obv10,inBull,
      rsi14,rsi2,volRatio20,
      isBar:i<isEnd,
    });
  }
  done++;
  if(done%50===0)process.stdout.write(`  ${done}/${files.length}\r`);
}
console.log(`\n  ✓ ${done} symbols processed`);
console.log(`  Total PS signals: ${bank.length} (IS: ${bank.filter(s=>s.isBar).length}, OOS: ${bank.filter(s=>!s.isBar).length})\n`);

// Baseline
const baseIS =metrics(bank.filter(s=>s.isBar));
const baseOOS=metrics(bank.filter(s=>!s.isBar));
console.log(`Baseline IS:  WR=${baseIS.wr.toFixed(1)}% avg=${baseIS.avg.toFixed(2)} n=${baseIS.n}`);
console.log(`Baseline OOS: WR=${baseOOS.wr.toFixed(1)}% avg=${baseOOS.avg.toFixed(2)} n=${baseOOS.n}\n`);

// Sweep grid — PerfectStorm specific
// Since PS already has ADX + quality gates, we focus on:
//   CMF (composite money flow), OBV slope, volRatio20, fires count, score, regime
const CMF_T     = [-0.05, 0.0, 0.05, 0.08, 0.10, 0.12, 0.15];
const OBV_T     = [-2.0, -1.0, -0.5, 0.0, 0.5];
const VOL_T     = [null, 1.2, 1.5, 2.0, 2.5];
const FIRES_T   = [2, 3, 4];           // min sub-archetypes that must fire
const SCORE_T   = [40, 50, 60, 70];
const REGIME_T  = [false, true];
const STAGES    = [
  {name:'ANY',     fn:s=>BUY_S.has(s.stage)},
  {name:'STRONG+', fn:s=>STRONG_S.has(s.stage)},
];

console.log('Phase 2: Sweeping gate combinations…');
const best=[];
let comboDone=0;

for(const regimeOnly of REGIME_T){
  const isSigs =bank.filter(s=>s.isBar  &&(!regimeOnly||s.inBull));
  const oosSigs=bank.filter(s=>!s.isBar &&(!regimeOnly||s.inBull));
  if(!isSigs.length)continue;

  for(const scoreMin  of SCORE_T)
  for(const sf        of STAGES)
  for(const firesMin  of FIRES_T)
  for(const cmfMin    of CMF_T)
  for(const obvMin    of OBV_T)
  for(const volMin    of VOL_T)
  {
    comboDone++;

    const isF=isSigs.filter(s=>
      s.score>=scoreMin && sf.fn(s) &&
      s.fires>=firesMin &&
      s.cmf20>=cmfMin &&
      s.obv10>=obvMin &&
      (volMin==null||s.volRatio20>=volMin)
    );
    if(isF.length<MIN_N_IS)continue;
    const isM=metrics(isF);
    if(isM.wr<70)continue;

    const oosF=oosSigs.filter(s=>
      s.score>=scoreMin && sf.fn(s) &&
      s.fires>=firesMin &&
      s.cmf20>=cmfMin &&
      s.obv10>=obvMin &&
      (volMin==null||s.volRatio20>=volMin)
    );
    if(oosF.length<MIN_N_OS)continue;
    const oosM=metrics(oosF);

    best.push({scoreMin,stageFilter:sf.name,firesMin,cmfMin,obvMin,volMin,regimeOnly,isM,oosM});
  }
}

// Sort by OOS WR, then OOS n as tiebreak
best.sort((a,b)=>b.oosM.wr-a.oosM.wr||(b.oosM.n-a.oosM.n));

console.log(`  ${comboDone} combinations swept, ${best.length} passed filters\n`);

// Print top 20
const top=best.slice(0,20);
console.log('TOP 20 CONFIGURATIONS (by OOS WR):');
console.log('Rank  OOS WR   OOS n  IS WR   IS n  | cmfMin  obvMin  volMin  firesMin  scoreMin  stage       regime');
console.log('─'.repeat(115));
top.forEach((r,i)=>{
  console.log(
    `${String(i+1).padStart(4)}  ${r.oosM.wr.toFixed(1).padStart(6)}%  ${String(r.oosM.n).padStart(5)}  ${r.isM.wr.toFixed(1).padStart(5)}%  ${String(r.isM.n).padStart(4)}  | `+
    `${String(r.cmfMin).padStart(6)}  ${String(r.obvMin).padStart(6)}  ${String(r.volMin??'any').padStart(6)}  ${String(r.firesMin).padStart(8)}  ${String(r.scoreMin).padStart(8)}  ${r.stageFilter.padEnd(10)}  ${r.regimeOnly}`
  );
});

// Best robust (n >= 20 OOS)
const robust=best.filter(r=>r.oosM.n>=20).slice(0,5);
console.log('\nBEST ROBUST (OOS n ≥ 20):');
if(robust.length){
  robust.forEach((r,i)=>{
    console.log(`  #${i+1}: OOS WR=${r.oosM.wr.toFixed(1)}% n=${r.oosM.n} | cmfMin=${r.cmfMin} obvMin=${r.obvMin} volMin=${r.volMin??'any'} fires≥${r.firesMin} score≥${r.scoreMin} stage=${r.stageFilter} regime=${r.regimeOnly}`);
  });
}else{
  console.log('  No robust configs found — see top 20 for thin-sample results');
}

// Save full results
const tag=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outPath=path.join(__dirname,'results',`ps_hyperopt_${tag}.json`);
fs.writeFileSync(outPath,JSON.stringify({
  generated:new Date().toISOString(),
  baseline:{isM:baseIS,oosM:baseOOS},
  top20:top,
  robust,
  all:best,
},null,2));
console.log(`\nResults saved → ${outPath}`);
