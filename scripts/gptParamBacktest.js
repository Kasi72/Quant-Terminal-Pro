'use strict';
/**
 * GPT Luna Param Validation Backtest — v2
 *
 * Key finding from diagnostic: ADX≥45 + maxBsc≤3 are mutually exclusive in NSE data.
 * ADX takes 10-20 bars to climb from 25→45; DI+ cross at bar 0 means ADX is still low.
 * After all other conditions, 34 bars/200 symbols pass but NONE hit ADX≥45 simultaneously.
 *
 * Running THREE variants to understand what GPT's params actually achieve:
 *   A: GPT params WITH ADX thresholds, NO maxBsc constraint (maybe ADX was the intent)
 *   B: GPT params WITH maxBsc≤3, ADX lowered to realistic level (maybe timing was the intent)
 *   C: Hybrid — keep GPT's structural filters (dd52W zone, EMA align, etc.) but use
 *      our engine's ADX/bsc tuning
 *
 * Archetypes: VolumeFootprint, CompressionCoil, MomentumPocket, EMAStack, PerfectStorm
 */

const fs      = require('fs');
const path    = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const WINDOW     = 300;
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const VARIANTS = ['A','B','C'];
const ARCHETYPES = ['VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','PerfectStorm'];
const MAX_HOLD_EMA = 10;
const MAX_HOLD_STD = 20;
const ATR_MULT = { VolumeFootprint:3.5, CompressionCoil:2.5, MomentumPocket:3.0, EMAStack:3.5, PerfectStorm:1.5 };

const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s=s.trim();
  if (s.includes('-')) { const p=s.split('-'); if (p[0].length===4) return Date.UTC(+p[0],+p[1]-1,+p[2]); const m=MON[p[1]]; if(m!==undefined) return Date.UTC(+p[2],m,+p[0]); }
  const d=new Date(s); return isNaN(d.getTime())?0:d.getTime();
}
function parseNSE(fp) {
  const lines=fs.readFileSync(fp,'utf8').trim().split('\n'); const out=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}
  return out;
}

// ── Indicators ──────────────────────────────────────────────────────────────
function computeEMAArr(candles,period){const alpha=2/(period+1),out=new Array(candles.length).fill(0);let ema=candles[0].c;for(let i=0;i<candles.length;i++){ema=alpha*candles[i].c+(1-alpha)*ema;out[i]=ema;}return out;}
function computeATR14Arr(candles){const out=new Array(candles.length).fill(0);let atr=candles[0].h-candles[0].l;for(let i=1;i<candles.length;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));atr=atr/14*13+tr/14;out[i]=atr;}out[0]=out[1]||(candles[0].h-candles[0].l);return out;}
function computeRSIArr(candles,period){const out=new Array(candles.length).fill(50);let aG=0,aL=0;for(let i=1;i<=period;i++){const d=candles[i].c-candles[i-1].c;if(d>0)aG+=d;else aL-=d;}aG/=period;aL/=period;for(let i=period;i<candles.length;i++){if(i>period){const d=candles[i].c-candles[i-1].c;const g=d>0?d:0,l=d<0?-d:0;aG=aG*(period-1)/period+g/period;aL=aL*(period-1)/period+l/period;}out[i]=aL>0?100-100/(1+aG/aL):(aG>0?100:50);}return out;}
function computeDMIArr(candles,period){const n=candles.length;const diPlus=new Array(n).fill(0),diMinus=new Array(n).fill(0),adx=new Array(n).fill(0);let smP=0,smM=0,smTR=0,smDX=0,adxInit=false;for(let i=1;i<n;i++){const c=candles[i],p=candles[i-1];const uM=c.h-p.h,dM=p.l-c.l;const pDM=uM>dM&&uM>0?uM:0,mDM=dM>uM&&dM>0?dM:0;const tr=Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c));if(i<period){smP+=pDM;smM+=mDM;smTR+=tr;}else{smP=smP-smP/period+pDM;smM=smM-smM/period+mDM;smTR=smTR-smTR/period+tr;const diP=smTR>0?smP/smTR*100:0,diM=smTR>0?smM/smTR*100:0;diPlus[i]=diP;diMinus[i]=diM;const dx=(diP+diM)>0?Math.abs(diP-diM)/(diP+diM)*100:0;if(!adxInit){smDX=dx;adxInit=true;}else smDX=smDX*(period-1)/period+dx/period;adx[i]=smDX;}}return{diPlus,diMinus,adx};}
function cmf20(candles,i){const n=Math.min(20,i+1);let mfv=0,vol=0;for(let j=i-n+1;j<=i;j++){const b=candles[j],r=b.h-b.l;const mf=r>0?((b.c-b.l)-(b.h-b.c))/r*b.v:0;mfv+=mf;vol+=b.v;}return vol>0?mfv/vol:0;}
function obvSlope10(candles,i){let obv=0;const start=Math.max(1,i-10);for(let j=start;j<=i;j++){const d=candles[j].c-candles[j-1].c;obv+=d>0?candles[j].v:d<0?-candles[j].v:0;}let vS=0,vN=0;for(let j=Math.max(0,i-20);j<i;j++){vS+=candles[j].v;vN++;}const vA=vN>0?vS/vN:1;return vA>0?obv/(vA*10):0;}
function volAvg20(candles,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=candles[j].v;n++;}return n>0?s/n:0;}
function turnover20(candles,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=candles[j].c*candles[j].v;n++;}return n>0?s/n:0;}
function hi20excl(candles,i){let h=0;for(let j=Math.max(0,i-20);j<i;j++)if(candles[j].h>h)h=candles[j].h;return h;}
function hi52W(candles,i){let h=0;for(let j=Math.max(0,i-252);j<i;j++)if(candles[j].h>h)h=candles[j].h;return h;}
function pricePos20(candles,i){let lo=Infinity,hi=0;for(let j=Math.max(0,i-20);j<=i;j++){if(candles[j].l<lo)lo=candles[j].l;if(candles[j].h>hi)hi=candles[j].h;}return(hi>lo)?(candles[i].c-lo)/(hi-lo)*100:50;}
function compressionBars(candles,i,atr14Arr){let n=0;for(let j=i-1;j>=Math.max(0,i-15);j--){if((candles[j].h-candles[j].l)<0.7*(atr14Arr[j]||1))n++;else break;}return n;}
function volDeclineDays(candles,i){let n=0;for(let j=i-1;j>=Math.max(1,i-5);j--){if(candles[j].v<candles[j-1].v)n++;else break;}return n;}
function stabBars(candles,i){let n=0,rL=candles[i].l;for(let j=i-1;j>=Math.max(0,i-8);j--){if(candles[j].l>rL*0.985){n++;rL=Math.min(rL,candles[j].l);}else break;}return n;}
function bbWidthPctl(candles,i){const period=20,widths=[];for(let k=Math.max(period,i-59);k<=i;k++){let s=0;for(let j=k-period+1;j<=k;j++)s+=candles[j].c;const mean=s/period;let vr=0;for(let j=k-period+1;j<=k;j++)vr+=(candles[j].c-mean)**2;widths.push(mean>0?(4*Math.sqrt(vr/period)/mean)*100:0);}if(!widths.length)return 50;const cur=widths[widths.length-1];return widths.filter(w=>w<=cur).length/widths.length*100;}
function barsSinceDICross(diPlus,diMinus,i,lookback){if(i>=1&&diPlus[i]>diMinus[i]&&diPlus[i-1]<=diMinus[i-1])return 0;for(let b=1;b<=lookback;b++){const j=i-b;if(j<1)break;if(diPlus[j]>diMinus[j]&&diPlus[j-1]<=diMinus[j-1])return b;}return 99;}
function maxRSI2Last5(rsi2Arr,i){let mx=0;for(let j=Math.max(0,i-4);j<=i;j++)if(rsi2Arr[j]>mx)mx=rsi2Arr[j];return mx;}

// ── Signal Detectors — 3 variants per archetype ────────────────────────────
// Each returns true/false for the given variant
//
// Variant A: GPT structural filters + ADX thresholds, maxBsc removed
// Variant B: GPT structural filters + maxBsc≤3, ADX lowered to our engine's thresholds
// Variant C: GPT structural filters only (dd52W zone, EMA align, vol, RSI gate) — no DMI constraints

function checkVolumeFootprint(candles,i,ind,variant){
  if(i<50)return false;
  const sig=candles[i],prev=candles[i-1],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const closeLoc=(sig.c-sig.l)/range*100,upperWick=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const volRatio=ind.vAvg>0?sig.v/ind.vAvg:0;
  const hi20=hi20excl(candles,i),rangeATR=ind.atr14>0?range/ind.atr14:0;
  const noGapDown=sig.o>=prev.c;
  const closeAbvEMA20=(sig.c/ind.ema20-1)*100>=0,ema20AbvEMA50=(ind.ema20/ind.ema50-1)*100>=0;
  const bsc=barsSinceDICross(ind.diPlus,ind.diMinus,i,10),adxV=ind.adx[i];
  const diBull=ind.diPlus[i]>ind.diMinus[i];

  const base=(volRatio>=5&&closeLoc>=60&&upperWick<=25&&hi20>0&&sig.c>=hi20*0.82&&rangeATR>=3&&noGapDown&&ind.cmf20>=0.15&&ind.obvSlope10>=0.5&&closeAbvEMA20&&ema20AbvEMA50&&diBull);
  if(!base)return false;
  if(variant==='A')return adxV>=45;           // ADX only, no bsc
  if(variant==='B')return bsc<=3&&adxV>=25;   // bsc timing + realistic ADX
  if(variant==='C')return adxV>=25;            // structural only + basic ADX
  return false;
}

function checkCompressionCoil(candles,i,ind,variant){
  if(i<60)return false;
  const sig=candles[i],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const closeLoc=(sig.c-sig.l)/range*100,bodyPct=Math.abs(sig.c-sig.o)/range*100;
  const volRatio=ind.vAvg>0?sig.v/ind.vAvg:0;
  const rangeATR=ind.atr14>0?range/ind.atr14:0;
  const cbars=compressionBars(candles,i,ind.atr14Arr),vDays=volDeclineDays(candles,i);
  const pp20=pricePos20(candles,i),bbPctl=bbWidthPctl(candles,i);
  const closeVsEMA20=(sig.c/ind.ema20-1)*100,ema20Vs50=(ind.ema20/ind.ema50-1)*100;
  const bsc=barsSinceDICross(ind.diPlus,ind.diMinus,i,10),adxV=ind.adx[i];

  const base=(cbars>=10&&cbars<=12&&vDays>=1&&pp20>=50&&bbPctl<=25&&rangeATR<=1.1&&closeLoc>=40&&bodyPct>=20&&ind.cmf20>=0.10&&ind.obvSlope10>=-1.0&&volRatio>=2.5&&closeVsEMA20>=1.0&&ema20Vs50>=1.0&&adxV>=25);
  if(!base)return false;
  if(variant==='A')return true;               // no additional ADX beyond 25 (no bsc)
  if(variant==='B')return bsc<=3;             // add timing
  if(variant==='C')return true;               // same as A
  return false;
}

function checkMomentumPocket(candles,i,ind,variant){
  if(i<60)return false;
  const sig=candles[i],range=sig.h-sig.l;
  if(range<=0)return false;
  const closeLoc=(sig.c-sig.l)/range*100,bodyPct=Math.abs(sig.c-sig.o)/range*100;
  const upperWick=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const volRatio=ind.vAvg>0?sig.v/ind.vAvg:0;
  const hh52=hi52W(candles,i),dd52=hh52>0?(hh52-sig.c)/hh52*100:0;
  const sb=stabBars(candles,i),ema20Vs50=(ind.ema20/ind.ema50-1)*100;
  const bsc=barsSinceDICross(ind.diPlus,ind.diMinus,i,10),adxV=ind.adx[i];

  const archOk=(dd52>=15&&dd52<=40&&sb>=5&&closeLoc>=60&&bodyPct>=15&&upperWick<=30&&volRatio>=1.6&&ind.rsi14[i]>=20&&ind.rsi14[i]<=55&&ind.cmf20>=-0.1&&ind.obvSlope10>=-1.0);
  if(!archOk)return false;

  const gateOk=(ind.rsi14[i]>=45&&ind.rsi14[i]<=55&&ind.rsi2[i]<=40&&volRatio>=2.5&&ema20Vs50>=0.5&&adxV>=20);
  if(!gateOk)return false;

  if(variant==='A')return true;              // GPT structural + gate, no bsc
  if(variant==='B')return bsc<=3;           // add loose timing (3 bars instead of 0)
  if(variant==='C')return bsc<=5;           // same as our engine's current bsc
  return false;
}

function checkEMAStack(candles,i,ind,variant){
  if(i<60)return false;
  const sig=candles[i],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const bodyPct=Math.abs(sig.c-sig.o)/range*100,upperWick=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const volRatio=ind.vAvg>0?sig.v/ind.vAvg:0;
  const ema10VsEma20=(ind.ema10[i]/ind.ema20-1)*100;
  const closeVsEMA20=(sig.c/ind.ema20-1)*100,ema20Vs50=(ind.ema20/ind.ema50-1)*100;
  const mxRsi2=maxRSI2Last5(ind.rsi2,i);
  const bsc=barsSinceDICross(ind.diPlus,ind.diMinus,i,10),adxV=ind.adx[i];
  let hadCrossover=false;
  for(let j=Math.max(0,i-5);j<i;j++){if(ind.ema10[j]<ind.ema20Arr[j]){hadCrossover=true;break;}}

  const base=(hadCrossover&&ema10VsEma20>=0.2&&bodyPct>=50&&upperWick<=15&&volRatio>=0.8&&mxRsi2<=60&&ind.cmf20>=0.15&&ind.obvSlope10>=0.5&&closeVsEMA20>=-0.5&&ema20Vs50>=1.0);
  if(!base)return false;
  if(variant==='A')return adxV>=35;           // ADX only, no bsc
  if(variant==='B')return bsc<=3&&adxV>=25;   // timing + realistic ADX
  if(variant==='C')return adxV>=25;            // structural + basic ADX
  return false;
}

function countFires(candles,i,ind,variant){
  let n=0;
  if(checkVolumeFootprint(candles,i,ind,variant))n++;
  if(checkCompressionCoil(candles,i,ind,variant))n++;
  if(checkMomentumPocket(candles,i,ind,variant))n++;
  if(checkEMAStack(candles,i,ind,variant))n++;
  return n;
}
function checkPerfectStorm(candles,i,ind,variant){
  if(countFires(candles,i,ind,variant)<2)return false;
  const sig=candles[i];
  return ind.adx[i]>=30&&ind.cmf20>=0.15&&ind.obvSlope10>=-0.5&&(sig.c/ind.ema20-1)*100>=0;
}

// ── Simulation ───────────────────────────────────────────────────────────────
function simulateTrade(candles,sigIdx,atr14,archetype){
  const eIdx=sigIdx+1;
  const maxHold=archetype==='EMAStack'?MAX_HOLD_EMA:MAX_HOLD_STD;
  if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;
  if(!ep||ep<=0)return null;
  const rawStop=ep-ATR_MULT[archetype]*atr14;
  const floorStop=ep*(1-3.5/100),capStop=ep*(1-6.5/100);
  const stop=Math.min(floorStop,Math.max(capStop,rawStop));
  const target=ep*(1+TARGET_PCT/100);
  let hitTarget=false,hitStop=false,barsToTarget=null,mfe=0,maeBeforeTarget=0,targetReached=false;
  for(let b=1;b<=maxHold;b++){
    const idx=eIdx+b;if(idx>=candles.length)break;
    const bar=candles[idx];
    const bH=(bar.h-ep)/ep*100;if(bH>mfe)mfe=bH;
    if(!targetReached){const bL=(ep-bar.l)/ep*100;if(bL>maeBeforeTarget)maeBeforeTarget=bL;}
    if(bar.l<=stop){hitStop=true;break;}
    if(bar.h>=target){hitTarget=true;targetReached=true;barsToTarget=b;break;}
  }
  const riskPct=(ep-stop)/ep*100;
  return{ep,stop,riskPct,hitTarget,hitStop,hit10:hitTarget&&barsToTarget!==null&&barsToTarget<=10,hit20:hitTarget,barsToTarget,mfe,maeBeforeTarget:hitTarget?maeBeforeTarget:null,pnl:hitTarget?TARGET_PCT:(hitStop?-riskPct:0),win:hitTarget};
}

// ── Aggregate ───────────────────────────────────────────────────────────────
function aggregate(trades){
  if(!trades.length)return null;
  const n=trades.length,winners=trades.filter(t=>t.hitTarget),losers=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const mfes=trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const medMFE=mfes[Math.floor(mfes.length/2)]??0;
  const maes=winners.filter(t=>t.maeBeforeTarget!==null).map(t=>t.maeBeforeTarget);
  const avgMAE=maes.length?maes.reduce((a,b)=>a+b,0)/maes.length:0;
  const days=winners.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  const avgDays=days.length?days.reduce((a,b)=>a+b,0)/days.length:0;
  const gW=winners.length*TARGET_PCT,gL=losers.reduce((s,t)=>s+t.riskPct,0);
  const pf5=gL>0?gW/gL:(gW>0?999:0);
  return{n,hit5_10_pct:(trades.filter(t=>t.hit10).length/n*100).toFixed(1),hit5_20_pct:(winners.length/n*100).toFixed(1),medMFE:medMFE.toFixed(2),avgMAE:avgMAE.toFixed(2),avgDays:avgDays.toFixed(1),pf5:pf5.toFixed(2),avgRisk:(trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2),nWinners:winners.length,nLosers:losers.length};
}

// ── Worker ───────────────────────────────────────────────────────────────────
if(!isMainThread){
  const{files,oosTs}=workerData;
  const results={};
  for(const v of VARIANTS)for(const a of ARCHETYPES)results[`${v}_${a}`]={all:[],is:[],oos:[]};

  for(const fp of files){
    const candles=parseNSE(fp);
    if(candles.length<WINDOW+25)continue;
    const atr14Arr=computeATR14Arr(candles);
    const ema10Arr=computeEMAArr(candles,10);
    const ema20Arr=computeEMAArr(candles,20);
    const ema50Arr=computeEMAArr(candles,50);
    const rsi14Arr=computeRSIArr(candles,14);
    const rsi2Arr=computeRSIArr(candles,2);
    const dmi=computeDMIArr(candles,14);

    const lastTrade={};
    for(const v of VARIANTS)for(const a of ARCHETYPES)lastTrade[`${v}_${a}`]=-1;

    for(let i=WINDOW;i<candles.length-22;i++){
      if(turnover20(candles,i)<MIN_TURN)continue;
      const ind={atr14:atr14Arr[i],atr14Arr,ema10:ema10Arr,ema20:ema20Arr[i],ema20Arr,ema50:ema50Arr[i],rsi14:rsi14Arr,rsi2:rsi2Arr,diPlus:dmi.diPlus,diMinus:dmi.diMinus,adx:dmi.adx,vAvg:volAvg20(candles,i),cmf20:cmf20(candles,i),obvSlope10:obvSlope10(candles,i)};

      for(const variant of VARIANTS){
        for(const archetype of ARCHETYPES){
          const key=`${variant}_${archetype}`;
          if(i<=lastTrade[key])continue;
          let signal=false;
          try{
            switch(archetype){
              case'VolumeFootprint':signal=checkVolumeFootprint(candles,i,ind,variant);break;
              case'CompressionCoil':signal=checkCompressionCoil(candles,i,ind,variant);break;
              case'MomentumPocket':signal=checkMomentumPocket(candles,i,ind,variant);break;
              case'EMAStack':signal=checkEMAStack(candles,i,ind,variant);break;
              case'PerfectStorm':signal=checkPerfectStorm(candles,i,ind,variant);break;
            }
          }catch{continue;}
          if(!signal)continue;
          const trade=simulateTrade(candles,i,atr14Arr[i],archetype);
          if(!trade)continue;
          const maxH=archetype==='EMAStack'?MAX_HOLD_EMA:MAX_HOLD_STD;
          lastTrade[key]=i+1+(trade.barsToTarget??maxH);
          const bucket=candles[i].ts<oosTs?'is':'oos';
          results[key].all.push(trade);
          results[key][bucket].push(trade);
        }
      }
    }
  }
  parentPort.postMessage(results);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv').map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORKERS},(_,i)=>allFiles.filter((_,j)=>j%N_WORKERS===i));

console.log(`GPT Luna Param Validation — 3 Variants`);
console.log(`A: GPT structural + ADX thresholds, no maxBsc (fixes ADX/bsc conflict)`);
console.log(`B: GPT structural + maxBsc≤3, realistic ADX (≥25-35) — timing precision`);
console.log(`C: GPT structural filters only + ADX≥25 — cleanest comparison`);
console.log(`Files: ${allFiles.length} | OOS: ${OOS_DATE} | Target: +${TARGET_PCT}%\n`);

const combined={};
for(const v of VARIANTS)for(const a of ARCHETYPES)combined[`${v}_${a}`]={all:[],is:[],oos:[]};

let done=0;
const workers=chunks.map(files=>new Promise((resolve,reject)=>{
  const w=new Worker(__filename,{workerData:{files,oosTs}});
  w.on('message',data=>{
    for(const v of VARIANTS)for(const a of ARCHETYPES){const k=`${v}_${a}`;combined[k].all.push(...data[k].all);combined[k].is.push(...data[k].is);combined[k].oos.push(...data[k].oos);}
    done+=files.length;process.stdout.write(`  processed ${done}/${allFiles.length}\r`);resolve();
  });
  w.on('error',reject);
}));

Promise.all(workers).then(()=>{
  console.log('\n');
  const LINE='─'.repeat(100);
  const rows=[];

  for(const archetype of ARCHETYPES){
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`${archetype}   (EMAStack hold=10 bars, others 20 bars)`);
    console.log('═'.repeat(80));
    console.log(`${'Variant'.padEnd(12)}  ${'Full-N'.padStart(7)}  ${'H5/20'.padStart(7)}  ${'MedMFE'.padStart(8)}  ${'PF_5%'.padStart(7)}  |  ${'OOS-N'.padStart(6)}  ${'OOS H5/20'.padStart(10)}  ${'OOS PF'.padStart(7)}`);
    console.log(LINE);
    const variantRows=[];
    for(const variant of VARIANTS){
      const key=`${variant}_${archetype}`;
      const all=aggregate(combined[key].all);
      const oos=aggregate(combined[key].oos);
      const lbl=variant==='A'?'A (ADX only)':variant==='B'?'B (bsc+ADX)':'C (structure)';
      if(!all){console.log(`${lbl.padEnd(12)}  (no signals)`);continue;}
      console.log([lbl.padEnd(12),(String(all.n)).padStart(7),(all.hit5_20_pct+'%').padStart(7),(all.medMFE+'%').padStart(8),all.pf5.padStart(7),'|',oos?(String(oos.n)).padStart(6):'     -',oos?(oos.hit5_20_pct+'%').padStart(10):'         -',oos?oos.pf5.padStart(7):'      -'].join('  '));
      variantRows.push({variant,all,oos:oos??null});
    }
    console.log(`${'GPT published'.padEnd(12)}  ${'?'.padStart(7)}  ${'?'.padStart(7)}  ${'?'.padStart(8)}  ${'?'.padStart(7)}  |  ${({VolumeFootprint:'n=94',CompressionCoil:'n=50',MomentumPocket:'n=78',EMAStack:'n=34',PerfectStorm:'n=34'}[archetype]||'').padStart(6)}  ${({VolumeFootprint:'67.0%',CompressionCoil:'66.0%',MomentumPocket:'60.3%',EMAStack:'67.7%',PerfectStorm:'52.9%'}[archetype]||'').padStart(10)}  ${'?'.padStart(7)}`);
    rows.push({archetype,variants:variantRows});
  }

  const tag=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const outJson=path.join(__dirname,'results',`gpt_param_validation_${tag}.json`);
  fs.writeFileSync(outJson,JSON.stringify({generated:new Date().toISOString(),variants:{A:'GPT structural + ADX, no maxBsc',B:'GPT structural + maxBsc≤3, realistic ADX',C:'GPT structural + ADX≥25'},rows},null,2));
  console.log(`\nJSON → ${outJson}`);
});
