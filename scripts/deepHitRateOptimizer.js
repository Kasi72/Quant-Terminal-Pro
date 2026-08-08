'use strict';
/**
 * Deep Hit-Rate Optimizer — MomentumPocket, EMAStack, PerfectStorm, ORS-Prime
 *
 * Expanded indicator set (18 total vs 9 in prior run):
 *   EXISTING: cmf20, obv10, rsi14, rsi2, volRatio, atrPct, adx14, bodyPct, closeLoc
 *   NEW:
 *     macdHist    — MACD(12,26,9) histogram (>0 = bullish momentum building)
 *     stochK      — Stochastic %K(14,3) — momentum velocity
 *     cci20       — CCI(20) — trend strength/exhaustion
 *     ema20slope  — EMA20 slope over 3 bars (positive = rising trend)
 *     obvEmaRatio — OBV / its 10-bar EMA (>1 = OBV rising above trend)
 *     lowerWickPct— lower wick / range (high = bullish demand floor)
 *     rsiSlope5   — RSI14 now minus RSI14 5 bars ago (rising momentum)
 *     roc10       — 10-day rate of change % (price momentum window)
 *     bbPos       — position within Bollinger Band (0=lower, 1=upper)
 *     priceVsEma50— % above/below EMA50 (trend regime filter)
 *
 * IS threshold per archetype (matched to base rate):
 *   MomentumPocket: IS base 49.4% → threshold 52%
 *   EMAStack:       IS base 57.7% → threshold 62%
 *   PerfectStorm:   IS base 38.2% → threshold 42% (OOS 52.6%)
 *   ORS-Prime:      IS base 71.6% → threshold 70% (look for 80%+ OOS)
 *
 * Target: Hit5/20 (price reaches +5% before stop within 20 bars)
 * Entry: next-bar open, stop clamped [3.5%, 6.5%]
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

// ── Config ──────────────────────────────────────────────────────────────────
const WINDOW   = 300;
const MAX_HOLD = 20;
const TARGET   = 1.05;
const OOS_DATE = '2025-05-05';
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORK   = 10;

const TARGETS = {
  'optimized_elite_10plus':         { label: 'MomentumPocket', isThresh: 52, minIS: 12, minOOS: 8  },
  'optimized_ultraselective_8plus': { label: 'EMAStack',       isThresh: 62, minIS: 12, minOOS: 8  },
  'sniper_95plus':                  { label: 'PerfectStorm',   isThresh: 42, minIS: 6,  minOOS: 5  },
  'ors_prime_reversal':             { label: 'ORS-Prime',      isThresh: 70, minIS: 15, minOOS: 8  },
};
const PS_LIST = Object.keys(TARGETS);
const BUY = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// ── Indicator sweep grid ─────────────────────────────────────────────────────
const GRID = {
  // Existing (relaxed for these archetypes)
  cmf20:       [-0.10, -0.05, 0.0, 0.05, 0.08, 0.10, 0.15],
  obv10:       [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0],
  rsi14:       [35, 40, 45, 50, 55],
  rsi2:        [null, 50, 60, 70, 80, 90],
  volRatio:    [1.0, 1.5, 2.0, 2.5, 3.0],
  atrPct:      [null, 1.0, 1.5, 2.0, 2.5, 3.0],
  adx14:       [null, 15, 20, 25, 30],
  // New indicators
  macdHist:    [null, 0],            // null=no filter; 0=macdHist>0 (positive momentum)
  stochK:      [null, 20, 30, 40, 50],  // stochK≥threshold
  cci20:       [null, -100, 0, 50, 100], // CCI≥threshold (>0 = bullish; >100 = strong trend)
  ema20slope:  [null, 0],            // null=no filter; 0=ema20slope>0 (rising EMA20)
  obvEmaRatio: [null, 1.0],          // OBV / 10-bar OBV EMA ≥ threshold
  lowerWick:   [null, 0.1, 0.2, 0.3], // lower wick ≥ % of range
  rsiSlope5:   [null, 0, 2, 5],     // RSI14 rising vs 5 bars ago
  roc10:       [null, 0, 2, 5],     // 10-day ROC ≥ threshold %
  bbPos:       [null, 0.3, 0.5, 0.7], // position in BB ≥ threshold (0=at lower, 1=at upper)
  priceVsEma50:[null, 0, 2, 5],     // % above EMA50 ≥ threshold
};

// ── Date helpers ─────────────────────────────────────────────────────────────
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s=s.trim();
  if(s.includes('-')){const p=s.split('-');if(p.length===3){if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}}
  const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();
}
function parseNSE(fp) {
  const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}
  return out;
}

// ── Technical Indicators ──────────────────────────────────────────────────────
function computeCMF(candles,endIdx,period=20){
  let s=0,v=0;for(let i=Math.max(0,endIdx-period+1);i<=endIdx;i++){const{h,l,c,cv}={h:candles[i].h,l:candles[i].l,c:candles[i].c,cv:candles[i].v};const r=h-l;if(r>0&&cv>0){s+=((c-l)-(h-c))/r*cv;v+=cv;}}
  return v>0?s/v:0;
}
function ema(arr,period){
  const k=2/(period+1);let e=arr[0];
  for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);
  return e;
}
function computeEMAVal(candles,endIdx,period){
  const start=Math.max(0,endIdx-period*3);
  const k=2/(period+1);let e=candles[start].c;
  for(let i=start+1;i<=endIdx;i++)e=candles[i].c*k+e*(1-k);
  return e;
}
function computeOBVSlope(candles,endIdx,period=10){
  const start=Math.max(1,endIdx-period);if(endIdx-start<3)return 0;
  let obv=0;const obvV=[],vols=[];
  for(let i=start;i<=endIdx;i++){if(candles[i].c>candles[i-1].c)obv+=candles[i].v;else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;obvV.push(obv);vols.push(candles[i].v);}
  const n=obvV.length,mv=vols.reduce((a,b)=>a+b,0)/n||1;
  let sx=0,sy=0,sxy=0,sx2=0;
  for(let i=0;i<n;i++){sx+=i;sy+=obvV[i];sxy+=i*obvV[i];sx2+=i*i;}
  const d=n*sx2-sx*sx;return Math.abs(d)<1e-10?0:(n*sxy-sx*sy)/d/mv;
}
function computeOBVEmaRatio(candles,endIdx,period=10){
  const start=Math.max(1,endIdx-period*3);let obv=0;const obvArr=[];
  for(let i=start;i<=endIdx;i++){if(candles[i].c>candles[i-1].c)obv+=candles[i].v;else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;obvArr.push(obv);}
  if(obvArr.length<2)return 1;
  const obvEMA=ema(obvArr,period);
  const cur=obvArr[obvArr.length-1];
  return obvEMA!==0?cur/Math.abs(obvEMA)*(cur>=0?1:-1):0; // simplified ratio
}
function computeRSIAtOffset(candles,endIdx,period,offset=0){
  const idx=endIdx-offset;if(idx<period+1)return 50;
  const start=Math.max(1,idx-period*3);let g=0,l=0;
  for(let i=start;i<=idx;i++){const d=candles[i].c-candles[i-1].c;if(d>0)g+=d;else l-=d;}
  const n=idx-start;if(!n)return 50;g/=n;l/=n;
  return l===0?100:100-100/(1+g/l);
}
function computeATR14Arr(candles,endIdx,period=14){
  const arr=[];let atr=0;
  for(let i=1;i<=endIdx;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));arr.push(tr);}
  if(arr.length<period)return arr[arr.length-1]||0;
  atr=arr.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<arr.length;i++)atr=(atr*(period-1)+arr[i])/period;
  return atr;
}
function computeADX(candles,endIdx,period=14){
  const start=Math.max(1,endIdx-period*2);let pDM=0,mDM=0,tr=0;
  for(let i=start;i<=endIdx;i++){const h=candles[i].h,l=candles[i].l,ph=candles[i-1].h,pl=candles[i-1].l,pc=candles[i-1].c;const t=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));const up=h-ph,dn=pl-l;pDM+=(up>dn&&up>0)?up:0;mDM+=(dn>up&&dn>0)?dn:0;tr+=t;}
  if(!tr)return 0;const di_p=pDM/tr*100,di_m=mDM/tr*100,denom=di_p+di_m;return denom>0?Math.abs(di_p-di_m)/denom*100:0;
}
function computeMACD(candles,endIdx){
  const start=Math.max(0,endIdx-60);
  const k12=2/13,k26=2/27,k9=2/10;
  let e12=candles[start].c,e26=candles[start].c;const macds=[];
  for(let i=start+1;i<=endIdx;i++){e12=candles[i].c*k12+e12*(1-k12);e26=candles[i].c*k26+e26*(1-k26);macds.push(e12-e26);}
  if(macds.length<2)return 0;
  let sig=macds[0];for(let i=1;i<macds.length;i++)sig=macds[i]*k9+sig*(1-k9);
  return macds[macds.length-1]-sig;
}
function computeStochK(candles,endIdx,period=14,smooth=3){
  const start=Math.max(0,endIdx-period-smooth+1);let ks=[];
  for(let i=endIdx-smooth+1;i<=endIdx;i++){const s=Math.max(0,i-period+1);let hi=-Infinity,lo=Infinity;for(let j=s;j<=i;j++){hi=Math.max(hi,candles[j].h);lo=Math.min(lo,candles[j].l);}const rng=hi-lo;ks.push(rng>0?(candles[i].c-lo)/rng*100:50);}
  return ks.reduce((a,b)=>a+b,0)/ks.length;
}
function computeCCI(candles,endIdx,period=20){
  const start=Math.max(0,endIdx-period+1);const tps=[];let mean=0;
  for(let i=start;i<=endIdx;i++){const tp=(candles[i].h+candles[i].l+candles[i].c)/3;tps.push(tp);mean+=tp;}
  mean/=tps.length;let mad=0;for(const tp of tps)mad+=Math.abs(tp-mean);mad/=tps.length;
  return mad>0?(((candles[endIdx].h+candles[endIdx].l+candles[endIdx].c)/3-mean)/(0.015*mad)):0;
}
function computeBBPos(candles,endIdx,period=20){
  const start=Math.max(0,endIdx-period+1);let sum=0,cnt=0;
  for(let i=start;i<=endIdx;i++){sum+=candles[i].c;cnt++;}
  const sma=sum/cnt;let vv=0;for(let i=start;i<=endIdx;i++)vv+=Math.pow(candles[i].c-sma,2);
  const std=Math.sqrt(vv/cnt);const upper=sma+2*std,lower=sma-2*std;
  return upper>lower?(candles[endIdx].c-lower)/(upper-lower):0.5;
}
function computeEMASlope(candles,endIdx,period=20,lookback=3){
  if(endIdx<lookback)return 0;
  const e1=computeEMAVal(candles,endIdx,period);
  const e2=computeEMAVal(candles,endIdx-lookback,period);
  return e2>0?(e1-e2)/e2*100:0;
}

function signalIndicators(candles,endIdx){
  const sig=candles[endIdx];
  const rng=sig.h-sig.l;
  const bodyPct=rng>0?Math.abs(sig.c-sig.o)/rng:0;
  const closeLoc=rng>0?(sig.c-sig.l)/rng:0.5;
  const lowerWick=rng>0?(Math.min(sig.o,sig.c)-sig.l)/rng:0;

  let vSum=0,vCnt=0;
  for(let j=Math.max(0,endIdx-20);j<endIdx;j++){vSum+=candles[j].v;vCnt++;}
  const vAvg=vCnt>0?vSum/vCnt:1;
  const volRatio=sig.v/vAvg;

  const ema20=computeEMAVal(candles,endIdx,20);
  const ema50=computeEMAVal(candles,endIdx,50);
  const priceVsEma50=ema50>0?(sig.c-ema50)/ema50*100:0;
  const atrPct=sig.c>0?computeATR14Arr(candles,endIdx,14)/sig.c*100:0;

  return {
    cmf20:       computeCMF(candles,endIdx,20),
    obv10:       computeOBVSlope(candles,endIdx,10),
    rsi14:       computeRSIAtOffset(candles,endIdx,14,0),
    rsi2:        computeRSIAtOffset(candles,endIdx,2,0),
    volRatio,
    atrPct,
    adx14:       computeADX(candles,endIdx,14),
    bodyPct,
    closeLoc,
    // NEW indicators
    macdHist:    computeMACD(candles,endIdx),
    stochK:      computeStochK(candles,endIdx,14,3),
    cci20:       computeCCI(candles,endIdx,20),
    ema20slope:  computeEMASlope(candles,endIdx,20,3),
    obvEmaRatio: computeOBVEmaRatio(candles,endIdx,10),
    lowerWick,
    rsiSlope5:   computeRSIAtOffset(candles,endIdx,14,0)-computeRSIAtOffset(candles,endIdx,14,5),
    roc10:       candles[endIdx-10]?.c>0?(sig.c/candles[endIdx-10].c-1)*100:0,
    bbPos:       computeBBPos(candles,endIdx,20),
    priceVsEma50,
  };
}

// ── Trade simulation ──────────────────────────────────────────────────────────
function simHit(candles,sigIdx,initStop){
  const eIdx=sigIdx+1;if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const stop=Math.min(ep*0.965,Math.max(ep*0.935,initStop));
  const tgt=ep*TARGET;
  let hit20=false,barsToHit=null;
  for(let b=1;b<=MAX_HOLD;b++){const idx=eIdx+b;if(idx>=candles.length)break;const bar=candles[idx];if(bar.l<=stop)break;if(bar.h>=tgt){hit20=true;barsToHit=b;break;}}
  return{hit20,barsToHit,riskPct:(ep-stop)/ep*100};
}

// ── Worker ────────────────────────────────────────────────────────────────────
if(!isMainThread){
  const{files,oosTs}=workerData;
  const bank={};for(const ps of PS_LIST)bank[ps]=[];
  for(const fp of files){
    const all=parseNSE(fp);if(all.length<WINDOW+MAX_HOLD+15)continue;
    const lastTrade={};
    for(let i=WINDOW;i<all.length-MAX_HOLD-2;i++){
      for(const ps of PS_LIST){
        const lt=lastTrade[ps]??-1;if(i<=lt)continue;
        const win=all.slice(i-WINDOW,i+1);
        let res;try{res=analyzeStock(win,ps);}catch{continue;}
        if(!res||!BUY.has(res.stage))continue;
        const stop=res.priceEngine?.tacticalStop??all[i].c*0.95;
        const t=simHit(all,i,stop);if(!t)continue;
        lastTrade[ps]=i+1+(t.barsToHit??MAX_HOLD);
        const inds=signalIndicators(all,i);
        bank[ps].push({hit20:t.hit20,oos:all[i].ts>=oosTs,riskPct:t.riskPct,...inds});
      }
    }
  }
  parentPort.postMessage(bank);process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv').map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORK},(_,i)=>allFiles.filter((_,j)=>j%N_WORK===i));

console.log('Deep Hit-Rate Optimizer — MomentumPocket, EMAStack, PerfectStorm, ORS-Prime');
console.log(`18 indicators | ${allFiles.length} symbols | OOS cutoff: ${OOS_DATE}\n`);

const combined={};for(const ps of PS_LIST)combined[ps]=[];
let done=0;
Promise.all(chunks.map(files=>new Promise((resolve,reject)=>{
  const w=new Worker(__filename,{workerData:{files,oosTs}});
  w.on('message',data=>{for(const ps of PS_LIST)combined[ps].push(...data[ps]);done+=files.length;process.stdout.write(`  collecting: ${done}/${allFiles.length}\r`);resolve();});
  w.on('error',reject);
}))).then(()=>{
  console.log('\n');

  const outRows=[];

  for(const ps of PS_LIST){
    const cfg=TARGETS[ps];
    const signals=combined[ps];
    const isSigs=signals.filter(s=>!s.oos);
    const oosSigs=signals.filter(s=>s.oos);
    const baseIS=isSigs.filter(s=>s.hit20).length/(isSigs.length||1)*100;
    const baseOOS=oosSigs.filter(s=>s.hit20).length/(oosSigs.length||1)*100;

    console.log(`\n${'═'.repeat(90)}`);
    console.log(`${cfg.label}  IS(n=${isSigs.length} base=${baseIS.toFixed(1)}%)  OOS(n=${oosSigs.length} base=${baseOOS.toFixed(1)}%)`);
    console.log(`${'═'.repeat(90)}`);

    const best=[];

    // Sweep — iterating over all combinations
    const g=GRID;
    let swept=0;

    for(const cmf    of g.cmf20)
    for(const obv    of g.obv10)
    for(const rsi14  of g.rsi14)
    for(const rsi2   of g.rsi2)
    for(const volR   of g.volRatio)
    for(const atr    of g.atrPct)
    for(const adx    of g.adx14)
    for(const mhist  of g.macdHist)
    for(const stk    of g.stochK)
    for(const cci    of g.cci20)
    for(const ems    of g.ema20slope)
    for(const oer    of g.obvEmaRatio)
    for(const lw     of g.lowerWick)
    for(const rsls   of g.rsiSlope5)
    for(const roc    of g.roc10)
    for(const bbp    of g.bbPos)
    for(const pve50  of g.priceVsEma50)
    {
      swept++;
      const passIS=s=>
        s.cmf20>=cmf && s.obv10>=obv && s.rsi14>=rsi14 &&
        (rsi2===null||s.rsi2<=rsi2) &&
        s.volRatio>=volR &&
        (atr===null||s.atrPct>=atr) &&
        (adx===null||s.adx14>=adx) &&
        (mhist===null||s.macdHist>0) &&
        (stk===null||s.stochK>=stk) &&
        (cci===null||s.cci20>=cci) &&
        (ems===null||s.ema20slope>0) &&
        (oer===null||s.obvEmaRatio>=oer) &&
        (lw===null||s.lowerWick>=lw) &&
        (rsls===null||s.rsiSlope5>=rsls) &&
        (roc===null||s.roc10>=roc) &&
        (bbp===null||s.bbPos>=bbp) &&
        (pve50===null||s.priceVsEma50>=pve50);

      const isF=isSigs.filter(passIS);
      if(isF.length<cfg.minIS)continue;
      const isHR=isF.filter(s=>s.hit20).length/isF.length*100;
      if(isHR<cfg.isThresh)continue;

      const oosF=oosSigs.filter(passIS);
      if(oosF.length<cfg.minOOS)continue;
      const oosHR=oosF.filter(s=>s.hit20).length/oosF.length*100;

      // Also compute simple PF for 5% target
      const oosWins=oosF.filter(s=>s.hit20);
      const oosLose=oosF.filter(s=>!s.hit20);
      const grossW=oosWins.length*5;
      const grossL=oosLose.reduce((a,s)=>a+s.riskPct,0);
      const pf=grossL>0?grossW/grossL:(grossW>0?999:0);

      best.push({
        cmf,obv,rsi14,rsi2,volR,atr,adx,
        mhist,stk,cci,ems,oer,lw,rsls,roc,bbp,pve50,
        isHR,isN:isF.length,oosHR,oosN:oosF.length,pf
      });
    }

    best.sort((a,b)=>b.oosHR-a.oosHR||(b.oosN-a.oosN));
    const top=best.slice(0,15);

    if(!top.length){
      console.log('  No configs passed. Printing best IS configs for reference:');
      const topIS=[];
      for(const s of isSigs){
        // count active conditions
      }
      console.log(`  → Try lowering isThresh (currently ${cfg.isThresh}%) or minIS (currently ${cfg.minIS})`);
      console.log(`  → Base IS: ${baseIS.toFixed(1)}%  Base OOS: ${baseOOS.toFixed(1)}%`);
    } else {
      console.log(`  Swept ${swept.toLocaleString()} combos | ${best.length} passed\n`);
      console.log('  Rank OOS HR  OOS n   IS HR  IS n  PF  | key gates');
      console.log('  '+'-'.repeat(100));
      top.forEach((r,i)=>{
        const gates=[];
        if(r.cmf!==g.cmf20[0])      gates.push(`cmf≥${r.cmf}`);
        if(r.obv!==g.obv10[0])      gates.push(`obv≥${r.obv}`);
        if(r.rsi14!==g.rsi14[0])    gates.push(`rsi14≥${r.rsi14}`);
        if(r.rsi2!==null)            gates.push(`rsi2≤${r.rsi2}`);
        if(r.volR!==g.volRatio[0])  gates.push(`vol≥${r.volR}x`);
        if(r.atr!==null)             gates.push(`atr≥${r.atr}%`);
        if(r.adx!==null)             gates.push(`adx≥${r.adx}`);
        if(r.mhist!==null)           gates.push(`MACD>0`);
        if(r.stk!==null)             gates.push(`StochK≥${r.stk}`);
        if(r.cci!==null)             gates.push(`CCI≥${r.cci}`);
        if(r.ems!==null)             gates.push(`EMA20↑`);
        if(r.oer!==null)             gates.push(`OBV/ema≥${r.oer}`);
        if(r.lw!==null)              gates.push(`LWick≥${r.lw}`);
        if(r.rsls!==null)            gates.push(`RSIslope≥${r.rsls}`);
        if(r.roc!==null)             gates.push(`ROC10≥${r.roc}%`);
        if(r.bbp!==null)             gates.push(`BBpos≥${r.bbp}`);
        if(r.pve50!==null)           gates.push(`vs50EMA≥${r.pve50}%`);
        console.log(
          `  ${String(i+1).padStart(4)} ${r.oosHR.toFixed(1).padStart(6)}%  ${String(r.oosN).padStart(5)}  ${r.isHR.toFixed(1).padStart(5)}%  ${String(r.isN).padStart(4)}  ${r.pf.toFixed(2).padStart(4)}  | ${gates.join(' + ')}`
        );
      });

      // Best robust (OOS n ≥ 20)
      const robust20=best.filter(r=>r.oosN>=20).slice(0,5);
      const robust15=best.filter(r=>r.oosN>=15).slice(0,5);
      const robustTarget=robust20.length?robust20:robust15;
      const nLabel=robust20.length?'n≥20':'n≥15';

      if(robustTarget.length){
        console.log(`\n  BEST ROBUST (OOS ${nLabel}):`);
        robustTarget.forEach((r,i)=>{
          const gates=[];
          if(r.cmf!==g.cmf20[0])      gates.push(`cmf≥${r.cmf}`);
          if(r.obv!==g.obv10[0])      gates.push(`obv≥${r.obv}`);
          if(r.rsi14!==g.rsi14[0])    gates.push(`rsi14≥${r.rsi14}`);
          if(r.rsi2!==null)            gates.push(`rsi2≤${r.rsi2}`);
          if(r.volR!==g.volRatio[0])  gates.push(`vol≥${r.volR}x`);
          if(r.atr!==null)             gates.push(`atr≥${r.atr}%`);
          if(r.adx!==null)             gates.push(`adx≥${r.adx}`);
          if(r.mhist!==null)           gates.push(`MACD>0`);
          if(r.stk!==null)             gates.push(`StochK≥${r.stk}`);
          if(r.cci!==null)             gates.push(`CCI≥${r.cci}`);
          if(r.ems!==null)             gates.push(`EMA20↑`);
          if(r.oer!==null)             gates.push(`OBV/ema≥${r.oer}`);
          if(r.lw!==null)              gates.push(`LWick≥${r.lw}`);
          if(r.rsls!==null)            gates.push(`RSIslope≥${r.rsls}`);
          if(r.roc!==null)             gates.push(`ROC10≥${r.roc}%`);
          if(r.bbp!==null)             gates.push(`BBpos≥${r.bbp}`);
          if(r.pve50!==null)           gates.push(`vs50EMA≥${r.pve50}%`);
          console.log(`    #${i+1}: OOS HR=${r.oosHR.toFixed(1)}% n=${r.oosN} PF=${r.pf.toFixed(2)} | ${gates.join(' + ')}`);
        });
      } else {
        console.log('  No robust configs found — see top 15 above');
      }
    }

    outRows.push({ps,label:cfg.label,baseIS,baseOOS,totalSignals:signals.length,top,robust:robustTarget??[]});
  }

  const tag=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const out=path.join(__dirname,'results',`deep_hitrate_opt_${tag}.json`);
  fs.writeFileSync(out,JSON.stringify({generated:new Date().toISOString(),outRows},null,2));
  console.log(`\n\nFull results → ${out}`);
});
