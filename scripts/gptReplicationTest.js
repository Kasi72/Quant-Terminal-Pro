'use strict';
/**
 * GPT Replication Test
 *
 * GPT claims n=66 VF, n=38 CC, n=78 MP, n=31 EMA, n=15 PS on OOS period.
 * Our compiled engine gets n=2 VF, n=4 CC, n=19 EMA.
 * Signal gap 33× for VF — GPT must NOT be enforcing ADX≥45+maxBsc≤3 at signal level.
 *
 * Strategy: test GPT's STRUCTURAL conditions only (vol, candle, EMA, zone filters)
 * with ADX/bsc removed, to find which combination matches their n counts.
 *
 * Variants per archetype:
 *   full   — all GPT params including ADX/bsc
 *   noADX  — drop ADX/bsc constraint only
 *   struct — structural candle/vol/EMA filters only (no DMI/ADX at all)
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

const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){s=s.trim();if(s.includes('-')){const p=s.split('-');if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();}
function parseNSE(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}return out;}

// ── Indicators ──────────────────────────────────────────────────────────────
function ema(c,p){const a=2/(p+1);let e=c[0].c;const o=new Array(c.length);for(let i=0;i<c.length;i++){e=a*c[i].c+(1-a)*e;o[i]=e;}return o;}
function atr14(c){const o=new Array(c.length);let a=c[0].h-c[0].l;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a=a/14*13+tr/14;o[i]=a;}o[0]=o[1]||(c[0].h-c[0].l);return o;}
function rsi(c,p){const o=new Array(c.length).fill(50);let aG=0,aL=0;for(let i=1;i<=p;i++){const d=c[i].c-c[i-1].c;if(d>0)aG+=d;else aL-=d;}aG/=p;aL/=p;for(let i=p;i<c.length;i++){if(i>p){const d=c[i].c-c[i-1].c;const g=d>0?d:0,l=d<0?-d:0;aG=aG*(p-1)/p+g/p;aL=aL*(p-1)/p+l/p;}o[i]=aL>0?100-100/(1+aG/aL):(aG>0?100:50);}return o;}
function dmi(c,p){const n=c.length,diP=new Array(n).fill(0),diM=new Array(n).fill(0),adx=new Array(n).fill(0);let sP=0,sM=0,sT=0,sDX=0,init=false;for(let i=1;i<n;i++){const b=c[i],pb=c[i-1];const uM=b.h-pb.h,dM=pb.l-b.l;const pDM=uM>dM&&uM>0?uM:0,mDM=dM>uM&&dM>0?dM:0;const tr=Math.max(b.h-b.l,Math.abs(b.h-pb.c),Math.abs(b.l-pb.c));if(i<p){sP+=pDM;sM+=mDM;sT+=tr;}else{sP=sP-sP/p+pDM;sM=sM-sM/p+mDM;sT=sT-sT/p+tr;const dP=sT>0?sP/sT*100:0,dMv=sT>0?sM/sT*100:0;diP[i]=dP;diM[i]=dMv;const dx=(dP+dMv)>0?Math.abs(dP-dMv)/(dP+dMv)*100:0;if(!init){sDX=dx;init=true;}else sDX=sDX*(p-1)/p+dx/p;adx[i]=sDX;}}return{diP,diM,adx};}
function cmf(c,i){const n=Math.min(20,i+1);let mfv=0,vol=0;for(let j=i-n+1;j<=i;j++){const b=c[j],r=b.h-b.l;mfv+=r>0?((b.c-b.l)-(b.h-b.c))/r*b.v:0;vol+=b.v;}return vol>0?mfv/vol:0;}
function obvSlope(c,i){let o=0;for(let j=Math.max(1,i-10);j<=i;j++){const d=c[j].c-c[j-1].c;o+=d>0?c[j].v:d<0?-c[j].v:0;}let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=c[j].v;n++;}const va=n>0?s/n:1;return va>0?o/(va*10):0;}
function vAvg20(c,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=c[j].v;n++;}return n>0?s/n:0;}
function turn20(c,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=c[j].c*c[j].v;n++;}return n>0?s/n:0;}
function hi20excl(c,i){let h=0;for(let j=Math.max(0,i-20);j<i;j++)if(c[j].h>h)h=c[j].h;return h;}
function hi52W(c,i){let h=0;for(let j=Math.max(0,i-252);j<i;j++)if(c[j].h>h)h=c[j].h;return h;}
function bsc(diP,diM,i,lb){if(i>=1&&diP[i]>diM[i]&&diP[i-1]<=diM[i-1])return 0;for(let b=1;b<=lb;b++){const j=i-b;if(j<1)break;if(diP[j]>diM[j]&&diP[j-1]<=diM[j-1])return b;}return 99;}
function comprBars(c,i,a){let n=0;for(let j=i-1;j>=Math.max(0,i-20);j--){if((c[j].h-c[j].l)<0.7*a[j])n++;else break;}return n;}
function volDecl(c,i){let n=0;for(let j=i-1;j>=Math.max(1,i-5);j--){if(c[j].v<c[j-1].v)n++;else break;}return n;}
function pPos20(c,i){let lo=Infinity,hi=0;for(let j=Math.max(0,i-20);j<=i;j++){if(c[j].l<lo)lo=c[j].l;if(c[j].h>hi)hi=c[j].h;}return(hi>lo)?(c[i].c-lo)/(hi-lo)*100:50;}
function bbWPctl(c,i){const p=20,ws=[];for(let k=Math.max(p,i-59);k<=i;k++){let s=0;for(let j=k-p+1;j<=k;j++)s+=c[j].c;const m=s/p;let v=0;for(let j=k-p+1;j<=k;j++)v+=(c[j].c-m)**2;ws.push(m>0?(4*Math.sqrt(v/p)/m)*100:0);}if(!ws.length)return 50;const cu=ws[ws.length-1];return ws.filter(w=>w<=cu).length/ws.length*100;}
function stabBars(c,i){let n=0,rL=c[i].l;for(let j=i-1;j>=Math.max(0,i-8);j--){if(c[j].l>rL*0.985){n++;rL=Math.min(rL,c[j].l);}else break;}return n;}
function maxRsi2L5(r2,i){let mx=0;for(let j=Math.max(0,i-4);j<=i;j++)if(r2[j]>mx)mx=r2[j];return mx;}

// ── Archetype conditions — 3 levels each ────────────────────────────────────
// full   = all GPT params (ADX + bsc included)
// noADX  = drop only ADX≥45 and maxBsc≤3
// struct = structural candle/vol/EMA only, no DMI at all

function vf(c,i,ind,level){
  const sig=c[i],prev=c[i-1],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const cl=(sig.c-sig.l)/range*100,uw=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const vr=ind.va>0?sig.v/ind.va:0;
  const hi20=hi20excl(c,i),rATR=ind.a14>0?range/ind.a14:0;
  const atrPct=sig.c>0?ind.a14/sig.c*100:0;
  const struct=(sig.c>=sig.o&&vr>=5.5&&cl>=68&&uw<=25&&hi20>0&&sig.c>=hi20*0.92&&rATR>=3.5&&sig.o>=prev.c&&ind.cmf>=0.15&&ind.obv>=0.5&&(sig.c/ind.e20-1)*100>=0.5&&(ind.e20/ind.e50-1)*100>=0&&atrPct>=2.5);
  if(!struct)return false;
  if(level==='struct')return true;
  if(level==='noADX')return true;
  return ind.bsc<=3&&ind.adx>=45;
}
function cc(c,i,ind,level){
  const sig=c[i],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const cl=(sig.c-sig.l)/range*100,bpct=Math.abs(sig.c-sig.o)/range*100;
  const vr=ind.va>0?sig.v/ind.va:0,rATR=ind.a14>0?range/ind.a14:0;
  const cbars=comprBars(c,i,ind.a14Arr),vdays=volDecl(c,i);
  const pp20=pPos20(c,i),bbpctl=bbWPctl(c,i);
  const struct=(cbars>=9&&cbars<=16&&vdays>=1&&pp20>=60&&bbpctl<=40&&rATR<=1.1&&cl>=55&&bpct>=20&&ind.cmf>=0.15&&vr>=3&&(sig.c/ind.e20-1)*100>=1&&(ind.e20/ind.e50-1)*100>=0);
  if(!struct)return false;
  if(level==='struct')return true;
  if(level==='noADX')return true;
  return ind.bsc<=3&&ind.adx>=45;
}
function mp(c,i,ind,r14,r2,level){
  const sig=c[i],range=sig.h-sig.l;
  if(range<=0)return false;
  const cl=(sig.c-sig.l)/range*100,bpct=Math.abs(sig.c-sig.o)/range*100;
  const uw=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const vr=ind.va>0?sig.v/ind.va:0;
  const hh52=hi52W(c,i),dd52=hh52>0?(hh52-sig.c)/hh52*100:0;
  const sb=stabBars(c,i);
  const struct=(dd52>=15&&dd52<=40&&sb>=5&&cl>=60&&bpct>=15&&uw<=30&&vr>=1.6&&r14[i]>=20&&r14[i]<=55&&ind.cmf>=-0.1);
  if(!struct)return false;
  if(level==='struct')return true;
  // gate: rsi14 45-55, rsi2≤40, vol≥2.5, ema20-50 aligned
  const gateOk=(r14[i]>=45&&r14[i]<=55&&r2[i]<=40&&vr>=2.5&&(ind.e20/ind.e50-1)*100>=0.5);
  if(!gateOk)return false;
  if(level==='noADX')return true;
  return ind.bsc<=0&&ind.adx>=20;
}
function ema_arch(c,i,ind,r14,r2,level){
  const sig=c[i],range=sig.h-sig.l;
  if(range<=0||sig.c<sig.o)return false;
  const bpct=Math.abs(sig.c-sig.o)/range*100,uw=(sig.h-Math.max(sig.o,sig.c))/range*100;
  const vr=ind.va>0?sig.v/ind.va:0;
  const e10e20=(ind.e10[i]/ind.e20-1)*100;
  let hadCross=false;
  for(let j=Math.max(0,i-5);j<i;j++){if(ind.e10[j]<ind.e20Arr[j]){hadCross=true;break;}}
  const mxR2=maxRsi2L5(r2,i);
  const struct=(hadCross&&e10e20>=0.2&&bpct>=40&&uw<=12&&vr>=1.6&&mxR2<=40&&ind.cmf>=0.1&&ind.obv>=0.5&&(sig.c/ind.e20-1)*100>=-0.5&&(ind.e20/ind.e50-1)*100>=0);
  if(!struct)return false;
  if(level==='struct')return true;
  if(level==='noADX')return true;
  return ind.bsc<=0&&ind.adx>=15;
}
function ps(c,i,ind,r14,level){
  // PerfectStorm: ≥2 of VF/CC/MP/EMA fire + adx≥25 + cmf≥0.1 + atrPct 3-6
  const atrPct=ind.a14>0&&c[i].c>0?ind.a14/c[i].c*100:0;
  if(atrPct<3||atrPct>6)return false;
  if(ind.cmf<0.1)return false;
  if((ind.e20/ind.e50-1)*100<0.5)return false;
  let fires=0;
  if(vf(c,i,ind,'struct'))fires++;
  if(cc(c,i,ind,'struct'))fires++;
  if(mp(c,i,ind,r14,new Array(c.length).fill(50),'struct'))fires++;
  if(ema_arch(c,i,ind,r14,new Array(c.length).fill(50),'struct'))fires++;
  if(fires<2)return false;
  if(level==='struct')return true;
  if(level==='noADX')return true;
  return ind.adx>=25;
}

const VARIANTS=[
  {key:'VF_full',    arch:'VF',  level:'full',   maxH:20,label:'VolumeFootprint FULL (ADX≥45+BSC≤3)'},
  {key:'VF_noADX',  arch:'VF',  level:'noADX',  maxH:20,label:'VolumeFootprint NO_ADX (struct+no bsc)'},
  {key:'VF_struct',  arch:'VF',  level:'struct', maxH:20,label:'VolumeFootprint STRUCT only'},
  {key:'CC_full',    arch:'CC',  level:'full',   maxH:20,label:'CompressionCoil FULL (ADX≥45+BSC≤3)'},
  {key:'CC_noADX',  arch:'CC',  level:'noADX',  maxH:20,label:'CompressionCoil NO_ADX'},
  {key:'CC_struct',  arch:'CC',  level:'struct', maxH:20,label:'CompressionCoil STRUCT only'},
  {key:'MP_full',    arch:'MP',  level:'full',   maxH:20,label:'MomentumPocket FULL (BSC=0+ADX≥20)'},
  {key:'MP_noADX',  arch:'MP',  level:'noADX',  maxH:20,label:'MomentumPocket NO_ADX (struct+gate)'},
  {key:'MP_struct',  arch:'MP',  level:'struct', maxH:20,label:'MomentumPocket STRUCT only (dd52 15-40)'},
  {key:'EMA_full',   arch:'EMA', level:'full',   maxH:20,label:'EMAStack FULL (BSC=0+ADX≥15)'},
  {key:'EMA_noADX', arch:'EMA', level:'noADX',  maxH:20,label:'EMAStack NO_ADX'},
  {key:'EMA_struct', arch:'EMA', level:'struct', maxH:20,label:'EMAStack STRUCT only'},
  {key:'PS_struct',  arch:'PS',  level:'struct', maxH:20,label:'PerfectStorm STRUCT (≥2 fires+atrPct 3-6+cmf)'},
];

function sim(c,si,a14,maxH){
  const ei=si+1;if(ei>=c.length-1)return null;
  const ep=c[ei].o;if(!ep||ep<=0)return null;
  const ATR_M=3.5;
  const rawS=ep-ATR_M*a14,flS=ep*(1-3.5/100),caS=ep*(1-6.5/100);
  const stop=Math.min(flS,Math.max(caS,rawS)),tgt=ep*(1+TARGET_PCT/100);
  let ht=false,hs=false,bt=null;
  for(let b=1;b<=maxH;b++){const idx=ei+b;if(idx>=c.length)break;const bar=c[idx];if(bar.l<=stop){hs=true;break;}if(bar.h>=tgt){ht=true;bt=b;break;}}
  const rPct=(ep-stop)/ep*100;
  return{hitTarget:ht,hitStop:hs,barsToTarget:bt,riskPct:rPct,pnl:ht?TARGET_PCT:(hs?-rPct:0)};
}
function agg(trades){
  if(!trades.length)return null;
  const n=trades.length,w=trades.filter(t=>t.hitTarget),l=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const gW=w.length*TARGET_PCT,gL=l.reduce((s,t)=>s+t.riskPct,0);
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  return{n,hit5Pct:(w.length/n*100).toFixed(1),pf:pf.toFixed(2),avgPnl:avgPnl.toFixed(2)};
}

if(!isMainThread){
  const{files,oosTs}=workerData;
  const buckets={};for(const v of VARIANTS)buckets[v.key]={is:[],oos:[]};

  for(const fp of files){
    const c=parseNSE(fp);if(c.length<WINDOW+25)continue;
    const a14Arr=atr14(c),e10Arr=ema(c,10),e20Arr=ema(c,20),e50Arr=ema(c,50);
    const r14=rsi(c,14),r2=rsi(c,2),dmiv=dmi(c,14);
    const lt={};for(const v of VARIANTS)lt[v.key]=-1;

    for(let i=WINDOW;i<c.length-22;i++){
      if(turn20(c,i)<MIN_TURN)continue;
      const ind={a14:a14Arr[i],a14Arr,e10:e10Arr,e20Arr,e20:e20Arr[i],e50:e50Arr[i],
        va:vAvg20(c,i),cmf:cmf(c,i),obv:obvSlope(c,i),
        adx:dmiv.adx[i],bsc:bsc(dmiv.diP,dmiv.diM,i,10)};

      for(const v of VARIANTS){
        if(i<=lt[v.key])continue;
        let sig=false;
        try{
          if(v.arch==='VF')sig=vf(c,i,ind,v.level);
          else if(v.arch==='CC')sig=cc(c,i,ind,v.level);
          else if(v.arch==='MP')sig=mp(c,i,ind,r14,r2,v.level);
          else if(v.arch==='EMA')sig=ema_arch(c,i,ind,r14,r2,v.level);
          else if(v.arch==='PS')sig=ps(c,i,ind,r14,v.level);
        }catch{continue;}
        if(!sig)continue;
        const trade=sim(c,i,a14Arr[i],v.maxH);if(!trade)continue;
        lt[v.key]=i+1+(trade.barsToTarget??v.maxH);
        const bucket=c[i].ts<oosTs?'is':'oos';
        buckets[v.key][bucket].push(trade);
      }
    }
  }
  parentPort.postMessage(buckets);
  process.exit(0);
}

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
  console.log('\n\n=== GPT Replication — Signal Count & Hit Rate by Constraint Level ===\n');
  console.log(`GPT claimed: VF n=66 71.2% | CC n=38 81.6% | MP n=78 60.3% | EMA n=31 74.2% | PS n=15 80.0%\n`);
  console.log(`${'Variant'.padEnd(48)}  ${'Full n'.padStart(7)}  ${'Full H5%'.padStart(9)}  |  ${'OOS n'.padStart(6)}  ${'OOS H5%'.padStart(8)}  ${'OOS PF'.padStart(7)}  ${'AvgPnL'.padStart(7)}`);
  console.log('─'.repeat(106));
  let lastArch='';
  for(const v of VARIANTS){
    if(v.arch!==lastArch){console.log('');lastArch=v.arch;}
    const all=agg([...combined[v.key].is,...combined[v.key].oos]);
    const oos=agg(combined[v.key].oos);
    const allStr=all?`${String(all.n).padStart(7)}  ${(all.hit5Pct+'%').padStart(9)}`:'      —          —';
    const oosStr=oos?`${String(oos.n).padStart(6)}  ${(oos.hit5Pct+'%').padStart(8)}  ${oos.pf.padStart(7)}  ${('+'+oos.avgPnl+'%').padStart(7)}`:'     —         —        —       —';
    console.log(`${v.label.padEnd(48)}  ${allStr}  |  ${oosStr}`);
  }
  console.log('\n→ Match GPT n counts to find which level they used');
});
