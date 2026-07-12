// UT Bot Grid Search — MA type × length × ATR length × sensitivity
// Measures: (1) avg lag from 20-bar low to buy signal (earliness)
//           (2) >5% hit within 10 bars (precision)
//           (3) lift when Advanced Features (VRAM+FER) are co-present
// Usage: node scripts/utBotGridSearch.js

'use strict';
const fs   = require('fs');
const path = require('path');

const CSV_DIR    = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_BARS   = 120;
const FWD        = 10;   // bars forward for >5% check
const BOTTOM_LB  = 20;  // lookback to find local bottom

// Grid
const MA_TYPES   = ['SMA','EMA','WMA','HMA','DEMA','TEMA','ZLEMA','VWMA'];
const MA_LENS    = [10, 14, 21, 34, 55];
const ATR_LENS   = [7, 10, 14, 20];
const SENSIBLITY = [0.5, 1.0, 1.5, 2.0, 3.0];

// ── CSV ───────────────────────────────────────────────────────────────────────
const MO={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function loadCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const o=[],h=[],l=[],c=[],v=[];
  for (let i=1;i<lines.length;i++){
    const p=lines[i].split(',');
    const hv=+p[2],lv=+p[3],cv=+p[4];
    if(!isFinite(cv)||cv<=0||!isFinite(hv)||!isFinite(lv)||hv<lv) continue;
    o.push(+p[1]);h.push(hv);l.push(lv);c.push(cv);v.push(+p[5]);
  }
  return {o,h,l,c,v,n:c.length};
}

// ── MA helpers ────────────────────────────────────────────────────────────────
function sma(c,n){
  const out=new Float64Array(c.length).fill(NaN); let s=0;
  for(let i=0;i<c.length;i++){s+=c[i];if(i>=n)s-=c[i-n];if(i>=n-1)out[i]=s/n;}
  return out;
}
function ema(c,n,start=0){
  const k=2/(n+1),out=new Float64Array(c.length).fill(NaN);
  let val=c[start]; out[start]=val;
  for(let i=start+1;i<c.length;i++){val=c[i]*k+val*(1-k);out[i]=val;}
  return out;
}
function wma(c,n){
  const out=new Float64Array(c.length).fill(NaN),d=n*(n+1)/2;
  for(let i=n-1;i<c.length;i++){let s=0;for(let j=0;j<n;j++)s+=c[i-j]*(n-j);out[i]=s/d;}
  return out;
}
function hma(c,n){
  const w1=wma(c,Math.floor(n/2)),w2=wma(c,n);
  const d=c.map((_,i)=>isNaN(w1[i])||isNaN(w2[i])?NaN:2*w1[i]-w2[i]);
  return wma(d,Math.round(Math.sqrt(n)));
}
function dema(c,n){
  const e1=ema(c,n,0),e2=ema(e1,n,n-1),out=new Float64Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++)if(!isNaN(e1[i])&&!isNaN(e2[i]))out[i]=2*e1[i]-e2[i];
  return out;
}
function tema(c,n){
  const e1=ema(c,n,0),e2=ema(e1,n,n-1),e3=ema(e2,n,2*(n-1)),out=new Float64Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++)if(!isNaN(e1[i])&&!isNaN(e2[i])&&!isNaN(e3[i]))out[i]=3*e1[i]-3*e2[i]+e3[i];
  return out;
}
function zlema(c,n){
  const lag=Math.floor((n-1)/2);
  const adj=c.map((_,i)=>i>=lag?c[i]+(c[i]-c[i-lag]):NaN);
  return ema(adj,n,lag);
}
function vwma_fn(c,vol,n){
  const out=new Float64Array(c.length).fill(NaN);let pv=0,sv=0;
  for(let i=0;i<c.length;i++){pv+=c[i]*vol[i];sv+=vol[i];
    if(i>=n){pv-=c[i-n]*vol[i-n];sv-=vol[i-n];}
    if(i>=n-1)out[i]=sv>0?pv/sv:c[i];}
  return out;
}

function getMAs(stk, maLen) {
  const c=stk.c, vol=stk.v;
  return {
    SMA:  sma(c,maLen),
    EMA:  ema(c,maLen,0),
    WMA:  wma(c,maLen),
    HMA:  hma(c,maLen),
    DEMA: dema(c,maLen),
    TEMA: tema(c,maLen),
    ZLEMA:zlema(c,maLen),
    VWMA: vwma_fn(c,vol,maLen),
  };
}

// ── ATR ───────────────────────────────────────────────────────────────────────
function buildATR(stk, n) {
  const {h,l,c} = stk; const out=new Float64Array(c.length);
  for(let i=1;i<c.length;i++){
    const tr=Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1]));
    out[i]=i===1?tr:(out[i-1]*( n-1)+tr)/n;
  }
  return out;
}

// ── UT Bot trailing stop → buy signal bars ───────────────────────────────────
function utBotBuys(src, atr, sens) {
  const n=src.length; const stop=new Float64Array(n); const buys=[];
  for(let i=1;i<n;i++){
    if(isNaN(src[i])||isNaN(atr[i])||atr[i]===0) continue;
    const ps=stop[i-1],pSrc=src[i-1],cSrc=src[i],loss=sens*atr[i];
    let ns;
    if(cSrc>ps&&pSrc>ps)      ns=Math.max(ps,cSrc-loss);
    else if(cSrc<ps&&pSrc<ps) ns=Math.min(ps,cSrc+loss);
    else                       ns=cSrc>ps?cSrc-loss:cSrc+loss;
    stop[i]=ns;
    if(cSrc>ns&&pSrc<=ps) buys.push(i);
  }
  return buys;
}

// ── Advanced Features (fast pre-compute per stock) ────────────────────────────
function buildFER(c){
  const out=new Float64Array(c.length).fill(NaN);
  for(let i=20;i<c.length;i++){
    const net=Math.abs(c[i]-c[i-20]);let p=0;
    for(let j=i-19;j<=i;j++)p+=Math.abs(c[j]-c[j-1]);
    out[i]=p>0?net/p:0;
  }
  return out;
}

function buildVRAM(stk){
  // Fast: rolling z-score of ROC20 within vol regime (200-bar history cap)
  const {h,l,c}=stk,n=c.length;
  const out=new Float64Array(n).fill(NaN);
  const atrPct=new Float64Array(n);
  let prev=c[0];
  for(let i=1;i<n;i++){const tr=Math.max(h[i]-l[i],Math.abs(h[i]-prev),Math.abs(l[i]-prev));atrPct[i]=c[i]>0?tr/c[i]*100:0;prev=c[i];}

  const rawWin=new Float64Array(120);let rawHead=0,rawLen=0;
  const regLabel=new Int8Array(n).fill(-1);
  function bsLo(s,len,v){let lo=0,hi=len;while(lo<hi){const m=(lo+hi)>>1;if(s[m]<v)lo=m+1;else hi=m;}return lo;}
  function toReg(r){return r<0.33?0:r<0.67?1:2;}

  for(let i=1;i<n;i++){
    rawWin[rawHead%120]=atrPct[i];rawHead++;if(rawLen<120)rawLen++;
    if(i<80)continue;
    const sl=rawLen<120?rawWin.slice(0,rawLen):rawWin.slice();
    sl.sort((a,b)=>a-b);
    const rank=bsLo(sl,sl.length,atrPct[i])/sl.length;
    regLabel[i]=toReg(rank);
    const reg=regLabel[i];
    const hs=Math.max(20,i-200);
    const rocs=[];
    for(let j=hs;j<i;j++)if(regLabel[j]===reg&&j>=20&&c[j-20]>0)rocs.push((c[j]/c[j-20]-1)*100);
    if(rocs.length<10)continue;
    const mu=rocs.reduce((s,x)=>s+x,0)/rocs.length;
    const sig=Math.sqrt(rocs.reduce((s,x)=>s+(x-mu)**2,0)/(rocs.length-1));
    if(sig<=0)continue;
    const roc20=c[i-20]>0?(c[i]/c[i-20]-1)*100:NaN;
    if(!isFinite(roc20))continue;
    out[i]=(roc20-mu)/sig;
  }
  return out;
}

// ── Accumulator per combo ─────────────────────────────────────────────────────
// For each combo we accumulate: signals, >5% hits, sum of lags, aligned signals, aligned hits
const NCOMBOS = MA_TYPES.length * MA_LENS.length * ATR_LENS.length * SENSIBLITY.length;
// Use typed arrays for speed
const cSigs   = new Int32Array(NCOMBOS);
const cHits   = new Int32Array(NCOMBOS);
const cLagSum = new Float64Array(NCOMBOS);
const cAlgnS  = new Int32Array(NCOMBOS); // signals where VRAM<-1.1 AND FER>=0.55
const cAlgnH  = new Int32Array(NCOMBOS);
const cEither = new Int32Array(NCOMBOS); // VRAM OR FER
const cEitherH= new Int32Array(NCOMBOS);

// combo index
function cIdx(mt,ml,al,si){
  return MA_TYPES.indexOf(mt)*MA_LENS.length*ATR_LENS.length*SENSIBLITY.length
       + MA_LENS.indexOf(ml)*ATR_LENS.length*SENSIBLITY.length
       + ATR_LENS.indexOf(al)*SENSIBLITY.length
       + SENSIBLITY.indexOf(si);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files=fs.readdirSync(CSV_DIR).filter(f=>f.endsWith('.csv'));
process.stdout.write(`Grid search: ${NCOMBOS} combos × ${files.length} stocks\n`);

for(let fi=0;fi<files.length;fi++){
  if(fi%100===0)process.stdout.write(`  ${fi}/${files.length}\r`);
  const stk=loadCSV(path.join(CSV_DIR,files[fi]));
  if(stk.n<MIN_BARS+FWD+5) continue;
  const {c,h,n}=stk;

  // Pre-compute features once
  const fer = buildFER(c);
  const vram= buildVRAM(stk);

  // Pre-compute ATRs for each ATR length
  const atrMap={};
  for(const al of ATR_LENS) atrMap[al]=buildATR(stk,al);

  // Pre-compute MAs for each length
  const maMap={};
  for(const ml of MA_LENS) maMap[ml]=getMAs(stk,ml);

  // For each combo
  for(const mt of MA_TYPES){
    for(const ml of MA_LENS){
      const src=maMap[ml][mt];
      for(const al of ATR_LENS){
        const atr=atrMap[al];
        for(const sens of SENSIBLITY){
          const buys=utBotBuys(src,atr,sens);
          const ci=cIdx(mt,ml,al,sens);

          for(const si of buys){
            if(si<BOTTOM_LB||si+FWD>=n) continue;

            // lag from 20-bar rolling low
            let minC=c[si],minBar=si;
            for(let k=si-BOTTOM_LB;k<=si;k++) if(c[k]<minC){minC=c[k];minBar=k;}
            const lag=si-minBar;

            // >5% within 10 bars
            let maxH=0; for(let f=si+1;f<=si+FWD;f++) maxH=Math.max(maxH,h[f]);
            const hit=(maxH-c[si])/c[si]*100>=5?1:0;

            // advanced feature alignment
            const fv=fer[si],vv=vram[si];
            const ferOK=isFinite(fv)&&fv>=0.55;
            const vramOK=isFinite(vv)&&vv<-1.1;

            cSigs[ci]++;
            cHits[ci]+=hit;
            cLagSum[ci]+=lag;

            if(ferOK&&vramOK){cAlgnS[ci]++;cAlgnH[ci]+=hit;}
            if(ferOK||vramOK){cEither[ci]++;cEitherH[ci]+=hit;}
          }
        }
      }
    }
  }
}
process.stdout.write(`\nDone.\n\n`);

// ── Build result rows ─────────────────────────────────────────────────────────
const rows=[];
for(const mt of MA_TYPES)
  for(const ml of MA_LENS)
    for(const al of ATR_LENS)
      for(const sens of SENSIBLITY){
        const ci=cIdx(mt,ml,al,sens);
        const ns=cSigs[ci]; if(ns<50) continue;
        rows.push({
          mt,ml,al,sens,ci,
          n:ns,
          wr: cHits[ci]/ns*100,
          lag: cLagSum[ci]/ns,
          alignedN: cAlgnS[ci],
          alignedWR: cAlgnS[ci]>0?cAlgnH[ci]/cAlgnS[ci]*100:NaN,
          eitherN: cEither[ci],
          eitherWR: cEither[ci]>0?cEitherH[ci]/cEither[ci]*100:NaN,
        });
      }

// ── Table 1: Top 20 by WR (>5% in 10 bars) ───────────────────────────────────
const byWR=[...rows].sort((a,b)=>b.wr-a.wr);
console.log('═'.repeat(120));
console.log('  TOP 25 COMBOS — Ranked by >5% hit rate within 10 bars after Buy signal');
console.log('  "Lag" = avg bars from 20-bar rolling low to buy signal (lower = earlier)');
console.log('  "AlgnWR" = hit rate when VRAM<-1.1 AND FER≥0.55 also present at signal');
console.log('═'.repeat(120));
console.log('  '+'#'.padStart(3)+' '+'MA'.padEnd(7)+'Len'.padStart(4)+'ATR'.padStart(5)+'Sens'.padStart(6)+'Sigs'.padStart(8)+'WR10%'.padStart(8)+'AvgLag'.padStart(8)+'AlgnN'.padStart(8)+'AlgnWR%'.padStart(10)+'Lift'.padStart(8));
console.log('  '+'-'.repeat(115));
byWR.slice(0,25).forEach((r,i)=>{
  const lift=isFinite(r.alignedWR)?((r.alignedWR-r.wr>=0?'+':'')+( r.alignedWR-r.wr).toFixed(1)+'pp'):'n/a';
  console.log('  '+String(i+1).padStart(3)+' '+
    r.mt.padEnd(7)+String(r.ml).padStart(4)+String(r.al).padStart(5)+String(r.sens).padStart(6)+
    String(r.n).padStart(8)+r.wr.toFixed(2).padStart(7)+'%'+r.lag.toFixed(1).padStart(8)+
    String(r.alignedN).padStart(8)+
    (isFinite(r.alignedWR)?r.alignedWR.toFixed(2).padStart(9)+'%':'   n/a'.padStart(10))+
    lift.padStart(8));
});

// ── Table 2: Top 20 by Lag (earliest signals), min 55% WR ────────────────────
const byLag=[...rows].filter(r=>r.wr>=55).sort((a,b)=>a.lag-b.lag);
console.log('\n\n'+'═'.repeat(120));
console.log('  EARLIEST SIGNALS (avg lag from bottom ≤3 bars) — filtered to WR10%≥55%');
console.log('═'.repeat(120));
console.log('  '+'#'.padStart(3)+' '+'MA'.padEnd(7)+'Len'.padStart(4)+'ATR'.padStart(5)+'Sens'.padStart(6)+'Sigs'.padStart(8)+'WR10%'.padStart(8)+'AvgLag'.padStart(8)+'AlgnN'.padStart(8)+'AlgnWR%'.padStart(10)+'Lift'.padStart(8));
console.log('  '+'-'.repeat(115));
byLag.slice(0,20).forEach((r,i)=>{
  const lift=isFinite(r.alignedWR)?((r.alignedWR-r.wr>=0?'+':'')+( r.alignedWR-r.wr).toFixed(1)+'pp'):'n/a';
  console.log('  '+String(i+1).padStart(3)+' '+
    r.mt.padEnd(7)+String(r.ml).padStart(4)+String(r.al).padStart(5)+String(r.sens).padStart(6)+
    String(r.n).padStart(8)+r.wr.toFixed(2).padStart(7)+'%'+r.lag.toFixed(1).padStart(8)+
    String(r.alignedN).padStart(8)+
    (isFinite(r.alignedWR)?r.alignedWR.toFixed(2).padStart(9)+'%':'   n/a'.padStart(10))+
    lift.padStart(8));
});

// ── Table 3: Best "combined score" — WR10% × (1 / lag) normalized ─────────────
// Score = WR10% / (lag+1)  — rewards high precision AND low lag simultaneously
const byScore=[...rows].filter(r=>r.n>=100).map(r=>({...r,score:r.wr/(r.lag+1)})).sort((a,b)=>b.score-a.score);
console.log('\n\n'+'═'.repeat(120));
console.log('  SWEET SPOT COMBOS — Score = WR10% ÷ (AvgLag+1)  [high precision + early signal]');
console.log('═'.repeat(120));
console.log('  '+'#'.padStart(3)+' '+'MA'.padEnd(7)+'Len'.padStart(4)+'ATR'.padStart(5)+'Sens'.padStart(6)+'Sigs'.padStart(8)+'WR10%'.padStart(8)+'AvgLag'.padStart(8)+'Score'.padStart(8)+'AlgnWR%'.padStart(10)+'Lift'.padStart(8));
console.log('  '+'-'.repeat(115));
byScore.slice(0,20).forEach((r,i)=>{
  const lift=isFinite(r.alignedWR)?((r.alignedWR-r.wr>=0?'+':'')+( r.alignedWR-r.wr).toFixed(1)+'pp'):'n/a';
  console.log('  '+String(i+1).padStart(3)+' '+
    r.mt.padEnd(7)+String(r.ml).padStart(4)+String(r.al).padStart(5)+String(r.sens).padStart(6)+
    String(r.n).padStart(8)+r.wr.toFixed(2).padStart(7)+'%'+r.lag.toFixed(1).padStart(8)+
    r.score.toFixed(2).padStart(8)+
    (isFinite(r.alignedWR)?r.alignedWR.toFixed(2).padStart(9)+'%':'   n/a'.padStart(10))+
    lift.padStart(8));
});

// ── Parameter-level summary (collapse combos, show per-param averages) ────────
function paramSummary(key, vals){
  console.log(`\n  ${key} averages across all combos:`);
  for(const v of vals){
    const sub=rows.filter(r=>r[key]===v&&r.n>=50);
    if(!sub.length)continue;
    const avgWR=sub.reduce((s,r)=>s+r.wr,0)/sub.length;
    const avgLag=sub.reduce((s,r)=>s+r.lag,0)/sub.length;
    const avgAlgn=sub.filter(r=>r.alignedN>0).reduce((s,r)=>s+r.alignedWR,0)/Math.max(1,sub.filter(r=>r.alignedN>0).length);
    console.log(`    ${String(v).padEnd(8)}  WR10%=${avgWR.toFixed(2)}%  AvgLag=${avgLag.toFixed(1)}  AlgnWR=${avgAlgn.toFixed(2)}%`);
  }
}
console.log('\n\n'+'═'.repeat(80));
console.log('  PARAMETER-LEVEL AVERAGES (averaged across all other params)');
console.log('═'.repeat(80));
paramSummary('mt', MA_TYPES);
paramSummary('ml', MA_LENS);
paramSummary('al', ATR_LENS);
paramSummary('sens', SENSIBLITY);
