'use strict';
/**
 * GPT Hybrid JSON — Selective Gate Improvement Test (v2)
 *
 * Uses compiled engine (same as fivePctHitRateBacktest) so archetype signals
 * are IDENTICAL to production. Only the hitRateGate logic varies per variant.
 *
 * Engine result fields used for gates:
 *   result.rsi14, result.rsi2, result.exactVolRatio20, result.adx14,
 *   result.bodyPct, result.closeLoc, result.atrPct14, result.hitRateGate
 *   + we compute maxRSI2Last5 and lowerWick from raw candles.
 *
 * Variants tested:
 *   VolumeFootprint:
 *     VF_current  — deployed Phase-1 gate (rsi14≥55+rsi2≤80+vol≥2.5+adx≥30+body≥0.3+cloc≥0.7)
 *     VF_gpt      — same + atrPct14≥2.5 (GPT's new volatility confirmation)
 *
 *   CompressionCoil:
 *     CC_current  — deployed gate (rsi14≥50+rsi2≤80+vol≥2.0+cloc≥0.5)
 *     CC_vol3     — same but vol≥3.0 (GPT raises this from 2.0→3.0)
 *
 *   EMAStack:
 *     EMA_current  — lowerWick≥0.3, hold=10
 *     EMA_gptA     — lowerWick≥0.3 + maxRSI2Last5≤40, hold=10
 *     EMA_gptB     — maxRSI2Last5≤40 only, hold=10
 *     EMA_hold20   — lowerWick≥0.3, hold=20 (GPT change)
 *     EMA_gptA_h20 — lowerWick≥0.3 + maxRSI2Last5≤40, hold=20
 */

const fs      = require('fs');
const path    = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW     = 300;
const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){s=s.trim();if(s.includes('-')){const p=s.split('-');if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();}
function parseNSE(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}return out;}
function avgTurnover20(c,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=c[j].c*c[j].v;n++;}return n>0?s/n:0;}

// Compute maxRSI2Last5 from raw candles (needed for EMAStack gate)
// We use result.rsi2 from engine output for the current bar; but need last 5 bars.
// Approximation: we track rsi2 from candles directly.
function computeRSI2Arr(candles){
  const out=new Array(candles.length).fill(50);let aG=0,aL=0;
  for(let i=1;i<=2;i++){const d=candles[i].c-candles[i-1].c;if(d>0)aG+=d;else aL-=d;}
  aG/=2;aL/=2;
  for(let i=2;i<candles.length;i++){
    if(i>2){const d=candles[i].c-candles[i-1].c;const g=d>0?d:0,l=d<0?-d:0;aG=aG/2+g/2;aL=aL/2+l/2;}
    out[i]=aL>0?100-100/(1+aG/aL):(aG>0?100:50);
  }
  return out;
}

// ── Gate functions — take engine result + raw candle at signal bar ──────────
function gateVF_current(r){
  return r.rsi14>=55&&r.rsi2<=80&&(r.exactVolRatio20??0)>=2.5&&(r.adx14??0)>=30&&(r.bodyPct??0)/100>=0.3&&(r.closeLoc??50)/100>=0.7;
}
function gateVF_gpt(r){
  return r.rsi14>=55&&r.rsi2<=80&&(r.exactVolRatio20??0)>=2.5&&(r.adx14??0)>=30&&(r.bodyPct??0)/100>=0.3&&(r.closeLoc??50)/100>=0.7&&(r.atrPct14??0)>=2.5;
}
function gateCC_current(r){
  return r.rsi14>=50&&r.rsi2<=80&&(r.exactVolRatio20??0)>=2.0&&(r.closeLoc??50)/100>=0.5;
}
function gateCC_vol3(r){
  return r.rsi14>=50&&r.rsi2<=80&&(r.exactVolRatio20??0)>=3.0&&(r.closeLoc??50)/100>=0.5;
}
function gateEMA_lowerWick(candle){
  const range=candle.h-candle.l;
  return range>0?(Math.min(candle.o,candle.c)-candle.l)/range>=0.3:false;
}
function gateEMA_maxRsi2(rsi2Arr,i){
  let mx=0;for(let j=Math.max(0,i-4);j<=i;j++)if(rsi2Arr[j]>mx)mx=rsi2Arr[j];return mx<=40;
}

const VARIANTS = [
  { key:'VF_current',   ps:'optimized_deployable_20plus',    maxHold:20, gate:(r,c,i,rsi2)=>gateVF_current(r),          label:'VolumeFootprint — current (rsi14≥55 rsi2≤80 vol≥2.5 adx≥30 body≥0.3 cloc≥0.7)' },
  { key:'VF_gpt',       ps:'optimized_deployable_20plus',    maxHold:20, gate:(r,c,i,rsi2)=>gateVF_gpt(r),              label:'VolumeFootprint — +atrPct14≥2.5 (GPT add)' },
  { key:'CC_current',   ps:'optimized_highprecision_15plus', maxHold:20, gate:(r,c,i,rsi2)=>gateCC_current(r),          label:'CompressionCoil — current (rsi14≥50 rsi2≤80 vol≥2.0 cloc≥0.5)' },
  { key:'CC_vol3',      ps:'optimized_highprecision_15plus', maxHold:20, gate:(r,c,i,rsi2)=>gateCC_vol3(r),            label:'CompressionCoil — vol≥3.0 (GPT upgrade)' },
  { key:'EMA_current',  ps:'optimized_ultraselective_8plus', maxHold:10, gate:(r,c,i,rsi2)=>gateEMA_lowerWick(c[i]),   label:'EMAStack — lowerWick≥0.3, hold=10 (current)' },
  { key:'EMA_gptA',     ps:'optimized_ultraselective_8plus', maxHold:10, gate:(r,c,i,rsi2)=>gateEMA_lowerWick(c[i])&&gateEMA_maxRsi2(rsi2,i),  label:'EMAStack — lowerWick≥0.3 AND maxRSI2_5≤40, hold=10' },
  { key:'EMA_gptB',     ps:'optimized_ultraselective_8plus', maxHold:10, gate:(r,c,i,rsi2)=>gateEMA_maxRsi2(rsi2,i),  label:'EMAStack — maxRSI2_5≤40 only, hold=10' },
  { key:'EMA_hold20',   ps:'optimized_ultraselective_8plus', maxHold:20, gate:(r,c,i,rsi2)=>gateEMA_lowerWick(c[i]),   label:'EMAStack — lowerWick≥0.3, hold=20 (GPT maxHold)' },
  { key:'EMA_gptA_h20', ps:'optimized_ultraselective_8plus', maxHold:20, gate:(r,c,i,rsi2)=>gateEMA_lowerWick(c[i])&&gateEMA_maxRsi2(rsi2,i), label:'EMAStack — lowerWick≥0.3 AND maxRSI2_5≤40, hold=20' },
];

// ── Simulation ────────────────────────────────────────────────────────────────
function simulateTrade(candles,sigIdx,initStop,maxHold){
  const eIdx=sigIdx+1;if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const rawStop=initStop,floorStop=ep*(1-3.5/100),capStop=ep*(1-6.5/100);
  const stop=Math.min(floorStop,Math.max(capStop,rawStop)),target=ep*(1+TARGET_PCT/100);
  let hitTarget=false,hitStop=false,barsToTarget=null;
  for(let b=1;b<=maxHold;b++){const idx=eIdx+b;if(idx>=candles.length)break;const bar=candles[idx];if(bar.l<=stop){hitStop=true;break;}if(bar.h>=target){hitTarget=true;barsToTarget=b;break;}}
  const riskPct=(ep-stop)/ep*100;
  return{hitTarget,hitStop,barsToTarget,riskPct,pnl:hitTarget?TARGET_PCT:(hitStop?-riskPct:0)};
}

// ── Aggregate ─────────────────────────────────────────────────────────────────
function aggregate(trades){
  if(!trades.length)return null;
  const n=trades.length,winners=trades.filter(t=>t.hitTarget),losers=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const gW=winners.length*TARGET_PCT,gL=losers.reduce((s,t)=>s+t.riskPct,0);
  const pf=gL>0?gW/gL:(gW>0?999:0);
  return{n,hit5Pct:(winners.length/n*100).toFixed(1),pf:pf.toFixed(2)};
}

// ── Worker ────────────────────────────────────────────────────────────────────
if(!isMainThread){
  const{files,oosTs}=workerData;
  const buckets={};for(const v of VARIANTS)buckets[v.key]={is:[],oos:[]};

  for(const fp of files){
    const candles=parseNSE(fp);if(candles.length<WINDOW+25)continue;
    const rsi2Arr=computeRSI2Arr(candles);

    // Group variants by param set to avoid re-running the engine
    const byPs={};for(const v of VARIANTS){if(!byPs[v.ps])byPs[v.ps]=[];byPs[v.ps].push(v);}

    const lastTrade={};for(const v of VARIANTS)lastTrade[v.key]=-1;

    for(let i=WINDOW;i<candles.length-22;i++){
      if(avgTurnover20(candles,i)<MIN_TURN)continue;

      for(const [ps,variants] of Object.entries(byPs)){
        // Only run engine if any variant for this ps needs this bar
        const needsCheck=variants.some(v=>i>lastTrade[v.key]);
        if(!needsCheck)continue;

        let result;
        try{result=analyzeStock(candles.slice(0,i+1),ps);}catch{continue;}
        if(!result||!BUY_STAGES.has(result.stage))continue;

        const initStop=result.tacticalPlan?.stop??result.priceEngine?.stop??candles[i].c*(1-5/100);

        for(const v of variants){
          if(i<=lastTrade[v.key])continue;
          try{if(!v.gate(result,candles,i,rsi2Arr))continue;}catch{continue;}
          const trade=simulateTrade(candles,i,initStop,v.maxHold);
          if(!trade)continue;
          lastTrade[v.key]=i+1+(trade.barsToTarget??v.maxHold);
          const bucket=candles[i].ts<oosTs?'is':'oos';
          buckets[v.key][bucket].push(trade);
        }
      }
    }
  }
  parentPort.postMessage(buckets);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv').map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORKERS},(_,i)=>allFiles.filter((_,j)=>j%N_WORKERS===i));
const combined={};for(const v of VARIANTS)combined[v.key]={is:[],oos:[]};
let done=0;

Promise.all(chunks.map(files=>new Promise((resolve,reject)=>{
  const w=new Worker(__filename,{workerData:{files,oosTs}});
  w.on('message',data=>{for(const v of VARIANTS){combined[v.key].is.push(...data[v.key].is);combined[v.key].oos.push(...data[v.key].oos);}done+=files.length;process.stdout.write(`  ${done}/${allFiles.length}\r`);resolve();});
  w.on('error',reject);
}))).then(()=>{
  console.log('\n\n=== GPT Hybrid — Selective Gate Results (compiled engine signals) ===\n');
  console.log(`${'Variant'.padEnd(60)}  ${'OOS n'.padStart(6)}  ${'OOS H5%'.padStart(8)}  ${'OOS PF'.padStart(7)}  |  ${'IS n'.padStart(5)}  ${'IS H5%'.padStart(7)}`);
  console.log('─'.repeat(102));

  let lastArch='';
  for(const v of VARIANTS){
    const arch=v.ps.includes('deployable')?'VF':v.ps.includes('highprecision')?'CC':'EMA';
    if(arch!==lastArch){console.log('');lastArch=arch;}
    const oos=aggregate(combined[v.key].oos);
    const is_=aggregate(combined[v.key].is);
    const oosStr=oos?`${String(oos.n).padStart(6)}  ${(oos.hit5Pct+'%').padStart(8)}  ${oos.pf.padStart(7)}`:'     —         —        —';
    const isStr=is_?`${String(is_.n).padStart(5)}  ${(is_.hit5Pct+'%').padStart(7)}`:'    —       —';
    console.log(`${v.label.padEnd(60)}  ${oosStr}  |  ${isStr}`);
  }
  console.log('\nOOS cutoff: '+OOS_DATE+' | Target: +'+TARGET_PCT+'% | Universe: 1616 NIFTY ALL');
});
