'use strict';
/**
 * Smart Hit-Rate Optimizer — Two-Phase Approach
 *
 * Phase 1: Rank each of 18 indicators solo (find best threshold per indicator)
 * Phase 2: Combine the top-N indicators from Phase 1 and grid-search only those
 *
 * This avoids the combinatorial explosion of a full 18-indicator sweep.
 * Target archetypes: MomentumPocket, EMAStack, PerfectStorm, ORS-Prime
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW   = 300;
const MAX_HOLD = 20;
const TARGET   = 1.05;
const OOS_DATE = '2025-05-05';
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORK   = 10;

const TARGETS = {
  'optimized_elite_10plus':         { label: 'MomentumPocket', isThresh: 50, minIS: 10, minOOS: 7  },
  'optimized_ultraselective_8plus': { label: 'EMAStack',       isThresh: 57, minIS: 10, minOOS: 7  },
  'sniper_95plus':                  { label: 'PerfectStorm',   isThresh: 40, minIS: 5,  minOOS: 5  },
  'ors_prime_reversal':             { label: 'ORS-Prime',      isThresh: 68, minIS: 12, minOOS: 7  },
};
const PS_LIST = Object.keys(TARGETS);
const BUY = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// ── Date helpers ──────────────────────────────────────────────────────────────
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){s=s.trim();if(s.includes('-')){const p=s.split('-');if(p.length===3){if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}}const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();}
function parseNSE(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}return out;}

// ── Indicators ────────────────────────────────────────────────────────────────
function emaVal(candles,endIdx,period){const start=Math.max(0,endIdx-period*3);const k=2/(period+1);let e=candles[start].c;for(let i=start+1;i<=endIdx;i++)e=candles[i].c*k+e*(1-k);return e;}
function computeCMF(candles,endIdx,period=20){let s=0,v=0;for(let i=Math.max(0,endIdx-period+1);i<=endIdx;i++){const{h,l,c,cv}={h:candles[i].h,l:candles[i].l,c:candles[i].c,cv:candles[i].v};const r=h-l;if(r>0&&cv>0){s+=((c-l)-(h-c))/r*cv;v+=cv;}}return v>0?s/v:0;}
function computeOBVSlope(candles,endIdx,period=10){const start=Math.max(1,endIdx-period);if(endIdx-start<3)return 0;let obv=0;const obvV=[],vols=[];for(let i=start;i<=endIdx;i++){if(candles[i].c>candles[i-1].c)obv+=candles[i].v;else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;obvV.push(obv);vols.push(candles[i].v);}const n=obvV.length,mv=vols.reduce((a,b)=>a+b,0)/n||1;let sx=0,sy=0,sxy=0,sx2=0;for(let i=0;i<n;i++){sx+=i;sy+=obvV[i];sxy+=i*obvV[i];sx2+=i*i;}const d=n*sx2-sx*sx;return Math.abs(d)<1e-10?0:(n*sxy-sx*sy)/d/mv;}
function computeRSI(candles,endIdx,period=14,offset=0){const idx=endIdx-offset;if(idx<period+1)return 50;const start=Math.max(1,idx-period*3);let g=0,l=0;for(let i=start;i<=idx;i++){const d=candles[i].c-candles[i-1].c;if(d>0)g+=d;else l-=d;}const n=idx-start;if(!n)return 50;g/=n;l/=n;return l===0?100:100-100/(1+g/l);}
function computeATR(candles,endIdx,period=14){let atr=0,sum=0;for(let i=Math.max(1,endIdx-period*2);i<=endIdx;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));sum+=tr;}return sum/(Math.min(endIdx,period*2)||1);}
function computeADX(candles,endIdx,period=14){const start=Math.max(1,endIdx-period*2);let pDM=0,mDM=0,tr=0;for(let i=start;i<=endIdx;i++){const h=candles[i].h,l=candles[i].l,ph=candles[i-1].h,pl=candles[i-1].l,pc=candles[i-1].c;const t=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));const up=h-ph,dn=pl-l;pDM+=(up>dn&&up>0)?up:0;mDM+=(dn>up&&dn>0)?dn:0;tr+=t;}if(!tr)return 0;const di_p=pDM/tr*100,di_m=mDM/tr*100,denom=di_p+di_m;return denom>0?Math.abs(di_p-di_m)/denom*100:0;}
function computeMACD(candles,endIdx){const k12=2/13,k26=2/27,k9=2/10;const start=Math.max(0,endIdx-60);let e12=candles[start].c,e26=candles[start].c;const macds=[];for(let i=start+1;i<=endIdx;i++){e12=candles[i].c*k12+e12*(1-k12);e26=candles[i].c*k26+e26*(1-k26);macds.push(e12-e26);}if(macds.length<2)return 0;let sig=macds[0];for(let i=1;i<macds.length;i++)sig=macds[i]*k9+sig*(1-k9);return macds[macds.length-1]-sig;}
function computeStochK(candles,endIdx,period=14,smooth=3){const ks=[];for(let i=endIdx-smooth+1;i<=endIdx;i++){const s=Math.max(0,i-period+1);let hi=-Infinity,lo=Infinity;for(let j=s;j<=i;j++){hi=Math.max(hi,candles[j].h);lo=Math.min(lo,candles[j].l);}const rng=hi-lo;ks.push(rng>0?(candles[i].c-lo)/rng*100:50);}return ks.reduce((a,b)=>a+b,0)/ks.length;}
function computeCCI(candles,endIdx,period=20){const start=Math.max(0,endIdx-period+1);const tps=[];let mean=0;for(let i=start;i<=endIdx;i++){const tp=(candles[i].h+candles[i].l+candles[i].c)/3;tps.push(tp);mean+=tp;}mean/=tps.length;let mad=0;for(const tp of tps)mad+=Math.abs(tp-mean);mad/=tps.length;return mad>0?(((candles[endIdx].h+candles[endIdx].l+candles[endIdx].c)/3-mean)/(0.015*mad)):0;}
function computeBBPos(candles,endIdx,period=20){const start=Math.max(0,endIdx-period+1);let sum=0,cnt=0;for(let i=start;i<=endIdx;i++){sum+=candles[i].c;cnt++;}const sma=sum/cnt;let vv=0;for(let i=start;i<=endIdx;i++)vv+=Math.pow(candles[i].c-sma,2);const std=Math.sqrt(vv/cnt);const upper=sma+2*std,lower=sma-2*std;return upper>lower?(candles[endIdx].c-lower)/(upper-lower):0.5;}
function computeOBVEmaRatio(candles,endIdx,period=10){const start=Math.max(1,endIdx-period*3);let obv=0;const obvArr=[];for(let i=start;i<=endIdx;i++){if(candles[i].c>candles[i-1].c)obv+=candles[i].v;else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;obvArr.push(obv);}if(obvArr.length<2)return 1;const k=2/(period+1);let obvEma=obvArr[0];for(let i=1;i<obvArr.length;i++)obvEma=obvArr[i]*k+obvEma*(1-k);const cur=obvArr[obvArr.length-1];return Math.abs(obvEma)>0?cur/Math.abs(obvEma):0;}

function computeIndicators(candles,endIdx){
  const sig=candles[endIdx];const rng=sig.h-sig.l;
  const bodyPct=rng>0?Math.abs(sig.c-sig.o)/rng:0;
  const closeLoc=rng>0?(sig.c-sig.l)/rng:0.5;
  const lowerWick=rng>0?(Math.min(sig.o,sig.c)-sig.l)/rng:0;
  let vSum=0,vCnt=0;for(let j=Math.max(0,endIdx-20);j<endIdx;j++){vSum+=candles[j].v;vCnt++;}
  const vAvg=vCnt>0?vSum/vCnt:1;const volRatio=sig.v/vAvg;
  const ema20=emaVal(candles,endIdx,20);const ema50=emaVal(candles,endIdx,50);
  const atrVal=computeATR(candles,endIdx,14);
  const atrPct=sig.c>0?atrVal/sig.c*100:0;
  const ema20slope=endIdx>=3?((ema20-emaVal(candles,endIdx-3,20))/ema20*100):0;
  const pve50=ema50>0?(sig.c-ema50)/ema50*100:0;
  const rsi14now=computeRSI(candles,endIdx,14,0);
  const rsiSlope5=rsi14now-computeRSI(candles,endIdx,14,5);
  const roc10=endIdx>=10&&candles[endIdx-10].c>0?(sig.c/candles[endIdx-10].c-1)*100:0;
  return {
    cmf20:  computeCMF(candles,endIdx,20),
    obv10:  computeOBVSlope(candles,endIdx,10),
    rsi14:  rsi14now,
    rsi2:   computeRSI(candles,endIdx,2,0),
    volRatio,atrPct,
    adx14:  computeADX(candles,endIdx,14),
    bodyPct,closeLoc,lowerWick,
    macdHist: computeMACD(candles,endIdx),
    stochK:   computeStochK(candles,endIdx,14,3),
    cci20:    computeCCI(candles,endIdx,20),
    ema20slope,
    obvEmaRatio: computeOBVEmaRatio(candles,endIdx,10),
    rsiSlope5,roc10,
    bbPos:   computeBBPos(candles,endIdx,20),
    pve50,
  };
}

// ── Trade sim ─────────────────────────────────────────────────────────────────
function simHit(candles,sigIdx,initStop){
  const eIdx=sigIdx+1;if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const stop=Math.min(ep*0.965,Math.max(ep*0.935,initStop));const tgt=ep*TARGET;
  let hit20=false;for(let b=1;b<=MAX_HOLD;b++){const idx=eIdx+b;if(idx>=candles.length)break;const bar=candles[idx];if(bar.l<=stop)break;if(bar.h>=tgt){hit20=true;break;}}
  return{hit20,riskPct:(ep-stop)/ep*100};
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
        const win=all.slice(i-WINDOW,i+1);let res;
        try{res=analyzeStock(win,ps);}catch{continue;}
        if(!res||!BUY.has(res.stage))continue;
        const stop=res.priceEngine?.tacticalStop??all[i].c*0.95;
        const t=simHit(all,i,stop);if(!t)continue;
        lastTrade[ps]=i+MAX_HOLD;
        bank[ps].push({hit20:t.hit20,oos:all[i].ts>=oosTs,riskPct:t.riskPct,...computeIndicators(all,i)});
      }
    }
  }
  parentPort.postMessage(bank);process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv').map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORK},(_,i)=>allFiles.filter((_,j)=>j%N_WORK===i));

console.log('Smart Hit-Rate Optimizer — Phase 1 solo ranking → Phase 2 top-indicator combo');
console.log(`18 indicators | ${allFiles.length} symbols | OOS cutoff: ${OOS_DATE}\n`);

const combined={};for(const ps of PS_LIST)combined[ps]=[];
let done=0;
Promise.all(chunks.map(files=>new Promise((resolve,reject)=>{
  const w=new Worker(__filename,{workerData:{files,oosTs}});
  w.on('message',data=>{for(const ps of PS_LIST)combined[ps].push(...data[ps]);done+=files.length;process.stdout.write(`  collecting: ${done}/${allFiles.length}\r`);resolve();});
  w.on('error',reject);
}))).then(()=>{
  console.log('\n');

  // Indicator definitions: name, thresholds, pass function (receives signal s and threshold)
  const INDS = [
    { name:'cmf20',       thresh:[-0.05,0,0.05,0.08,0.10,0.12,0.15], fn:(s,t)=>s.cmf20>=t },
    { name:'obv10',       thresh:[-1.0,-0.5,0,0.5,1.0],               fn:(s,t)=>s.obv10>=t },
    { name:'rsi14',       thresh:[40,45,50,55],                        fn:(s,t)=>s.rsi14>=t },
    { name:'rsi2≤',       thresh:[50,60,70,80,90],                     fn:(s,t)=>s.rsi2<=t, isUpper:true },
    { name:'volRatio',    thresh:[1.5,2.0,2.5,3.0],                    fn:(s,t)=>s.volRatio>=t },
    { name:'atrPct',      thresh:[1.0,1.5,2.0,2.5,3.0],               fn:(s,t)=>s.atrPct>=t },
    { name:'adx14',       thresh:[15,20,25,30],                        fn:(s,t)=>s.adx14>=t },
    { name:'bodyPct',     thresh:[0.2,0.3,0.4,0.5],                    fn:(s,t)=>s.bodyPct>=t },
    { name:'closeLoc',    thresh:[0.5,0.6,0.7],                        fn:(s,t)=>s.closeLoc>=t },
    { name:'macdHist>0',  thresh:[0],                                   fn:(s,t)=>s.macdHist>0 },
    { name:'stochK',      thresh:[20,30,40,50],                        fn:(s,t)=>s.stochK>=t },
    { name:'cci20',       thresh:[0,50,100],                           fn:(s,t)=>s.cci20>=t },
    { name:'ema20slope↑', thresh:[0],                                   fn:(s,t)=>s.ema20slope>0 },
    { name:'obvEmaRatio', thresh:[1.0],                                 fn:(s,t)=>s.obvEmaRatio>=t },
    { name:'lowerWick',   thresh:[0.1,0.2,0.3],                        fn:(s,t)=>s.lowerWick>=t },
    { name:'rsiSlope5',   thresh:[0,2,5],                              fn:(s,t)=>s.rsiSlope5>=t },
    { name:'roc10',       thresh:[0,2,5],                              fn:(s,t)=>s.roc10>=t },
    { name:'bbPos',       thresh:[0.3,0.5,0.7],                        fn:(s,t)=>s.bbPos>=t },
    { name:'pve50',       thresh:[0,2,5],                              fn:(s,t)=>s.pve50>=t },
  ];

  const allOutRows = [];

  for(const ps of PS_LIST){
    const cfg=TARGETS[ps];
    const signals=combined[ps];
    const isSigs=signals.filter(s=>!s.oos);
    const oosSigs=signals.filter(s=>s.oos);
    const baseIS=isSigs.filter(s=>s.hit20).length/(isSigs.length||1)*100;
    const baseOOS=oosSigs.filter(s=>s.hit20).length/(oosSigs.length||1)*100;

    console.log(`\n${'═'.repeat(88)}`);
    console.log(`${cfg.label}  IS(n=${isSigs.length} base=${baseIS.toFixed(1)}%)  OOS(n=${oosSigs.length} base=${baseOOS.toFixed(1)}%)`);
    console.log(`${'═'.repeat(88)}`);

    // ── Phase 1: Solo ranking ──────────────────────────────────────────────────
    console.log('\n  PHASE 1: Solo indicator impact (OOS hit-rate lift, n≥minIS retained)\n');
    const soloResults=[];
    for(const ind of INDS){
      let bestOosHR=0,bestThresh=null,bestN=0;
      for(const t of ind.thresh){
        const isF=isSigs.filter(s=>ind.fn(s,t));if(isF.length<cfg.minIS)continue;
        const isHR=isF.filter(s=>s.hit20).length/isF.length*100;if(isHR<cfg.isThresh-5)continue;
        const oosF=oosSigs.filter(s=>ind.fn(s,t));if(oosF.length<cfg.minOOS)continue;
        const oosHR=oosF.filter(s=>s.hit20).length/oosF.length*100;
        if(oosHR>bestOosHR){bestOosHR=oosHR;bestThresh=t;bestN=oosF.length;}
      }
      const lift=bestOosHR-baseOOS;
      soloResults.push({name:ind.name,fn:ind.fn,bestThresh,oosHR:bestOosHR,n:bestN,lift});
    }
    soloResults.sort((a,b)=>b.lift-a.lift);

    console.log('  Indicator          Best thresh   OOS HR    OOS n   Lift vs base');
    console.log('  '+'-'.repeat(70));
    for(const r of soloResults){
      if(r.bestThresh===null){console.log(`  ${r.name.padEnd(20)}  ${'—'.padEnd(12)}  ${'—'.padStart(6)}    ${'—'.padStart(5)}   —`);continue;}
      console.log(`  ${r.name.padEnd(20)}  ${String(r.bestThresh).padEnd(12)}  ${r.oosHR.toFixed(1).padStart(5)}%    ${String(r.n).padStart(5)}   ${r.lift>=0?'+':''}${r.lift.toFixed(1)}%`);
    }

    // ── Phase 2: Combine top-5 indicators ─────────────────────────────────────
    const top5=soloResults.filter(r=>r.bestThresh!==null&&r.lift>0).slice(0,5);
    if(!top5.length){console.log('\n  No indicators improved OOS HR. Archetype may already be fully optimised.\n');continue;}

    console.log(`\n  PHASE 2: Combining top ${top5.length} indicators (${top5.map(r=>r.name).join(', ')})\n`);

    // Build refined threshold sets for each top indicator (3 values around best)
    const phase2Grid=top5.map(ind=>{
      const origInd=INDS.find(i=>i.name===ind.name);
      const allT=origInd.thresh;
      const idx=allT.indexOf(ind.bestThresh);
      const subset=[...new Set([
        idx>0?allT[idx-1]:null,
        ind.bestThresh,
        idx<allT.length-1?allT[idx+1]:null,
      ].filter(x=>x!==null))];
      return{name:ind.name,fn:ind.fn,thresholds:subset};
    });

    const comboBest=[];
    function sweep(idx,selected){
      if(idx===phase2Grid.length){
        const passAll=s=>selected.every(({fn,t})=>fn(s,t));
        const isF=isSigs.filter(passAll);if(isF.length<cfg.minIS)return;
        const isHR=isF.filter(s=>s.hit20).length/isF.length*100;if(isHR<cfg.isThresh)return;
        const oosF=oosSigs.filter(passAll);if(oosF.length<cfg.minOOS)return;
        const oosHR=oosF.filter(s=>s.hit20).length/oosF.length*100;
        const oosW=oosF.filter(s=>s.hit20).length*5;
        const oosL=oosF.filter(s=>!s.hit20).reduce((a,s)=>a+s.riskPct,0);
        const pf=oosL>0?oosW/oosL:(oosW>0?999:0);
        comboBest.push({selected:[...selected],isHR,isN:isF.length,oosHR,oosN:oosF.length,pf});
        return;
      }
      const{fn,thresholds}=phase2Grid[idx];
      for(const t of thresholds)sweep(idx+1,[...selected,{fn,t,name:phase2Grid[idx].name}]);
    }
    sweep(0,[]);

    comboBest.sort((a,b)=>b.oosHR-a.oosHR||(b.oosN-a.oosN));
    const top=comboBest.slice(0,10);

    if(!top.length){console.log('  No multi-indicator combo passed filters.\n');continue;}

    console.log(`  ${comboBest.length} combos tested\n`);
    console.log('  Rank  OOS HR   OOS n   IS HR   IS n   PF    Gates');
    console.log('  '+'-'.repeat(90));
    top.forEach((r,i)=>{
      const gateStr=r.selected.map(s=>`${s.name}=${s.t}`).join(' + ');
      console.log(`  ${String(i+1).padStart(4)}  ${r.oosHR.toFixed(1).padStart(6)}%  ${String(r.oosN).padStart(5)}   ${r.isHR.toFixed(1).padStart(5)}%  ${String(r.isN).padStart(4)}  ${r.pf.toFixed(2).padStart(5)}  ${gateStr}`);
    });

    // Robust
    const robust=comboBest.filter(r=>r.oosN>=15).slice(0,5);
    if(robust.length){
      console.log(`\n  BEST ROBUST (OOS n≥15):`);
      robust.forEach((r,i)=>{
        const gateStr=r.selected.map(s=>`${s.name}=${s.t}`).join(' + ');
        console.log(`    #${i+1}: OOS HR=${r.oosHR.toFixed(1)}% n=${r.oosN} PF=${r.pf.toFixed(2)} | ${gateStr}`);
      });
    }

    allOutRows.push({ps,label:cfg.label,baseIS,baseOOS,soloResults,top,robust});
  }

  const tag=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const out=path.join(__dirname,'results',`smart_hitrate_opt_${tag}.json`);
  fs.writeFileSync(out,JSON.stringify({generated:new Date().toISOString(),allOutRows},null,2));
  console.log(`\n\nFull results → ${out}`);
});
