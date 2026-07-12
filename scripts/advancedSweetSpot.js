// Advanced Features — Fine-grained Sweet Spot Sweep
// Narrow bins around each feature's promising range to find exact cutoffs.
// Usage: node scripts/advancedSweetSpot.js

const fs = require('fs');
const path = require('path');

const CSV_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_CANDLES = 100;

// ── CSV Parser ───────────────────────────────────────────────────────────────
function loadCSV(file) {
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    const open=parseFloat(o),high=parseFloat(h),low=parseFloat(l),close=parseFloat(c),volume=parseFloat(v);
    if (!isFinite(close)||close<=0||!isFinite(high)||!isFinite(low)||!isFinite(open)||!isFinite(volume)) continue;
    if (high<low||high<close||low>close) continue;
    const [d,m,y]=date.split('-');
    candles.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:open,h:high,l:low,c:close,v:volume});
  }
  return candles;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function safe(v,fb=0){return isFinite(v)?v:fb;}
function mean(arr){return arr.length===0?0:arr.reduce((a,b)=>a+b,0)/arr.length;}
function std(arr,m){if(arr.length<2)return 0;const mu=m??mean(arr);return Math.sqrt(arr.reduce((s,x)=>s+(x-mu)**2,0)/(arr.length-1));}
function olsBeta(x,y){const n=Math.min(x.length,y.length);if(n<3)return 0;const mx=mean(x.slice(0,n)),my=mean(y.slice(0,n));let num=0,den=0;for(let i=0;i<n;i++){num+=(x[i]-mx)*(y[i]-my);den+=(x[i]-mx)**2;}return den===0?0:num/den;}
function pctRank(sorted,v){if(sorted.length===0)return 0.5;let lo=0,hi=sorted.length;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<v)lo=m+1;else hi=m;}return lo/sorted.length;}

function computeATR14(candles){
  const atr=new Array(candles.length).fill(0);
  for(let i=1;i<candles.length;i++){
    const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
    atr[i]=i===1?tr:(atr[i-1]*13+tr)/14;
  }
  return atr;
}

// ── Feature computations (same as advancedEngine.ts) ────────────────────────

function getFER(candles,endIdx){
  if(endIdx<20)return null;
  const start=endIdx-20;
  const netMove=Math.abs(candles[endIdx].c-candles[start].c);
  let pathLen=0;
  for(let i=start+1;i<=endIdx;i++)pathLen+=Math.abs(candles[i].c-candles[i-1].c);
  return pathLen>0?safe(netMove/pathLen):0;
}

function getCUSUM(candles,endIdx,atr14){
  if(endIdx<20)return null;
  const close=candles[endIdx].c;
  const atrPct=close>0?atr14/close:0;
  const threshold=0.5*atrPct;
  let sPos=0;
  const startIdx=Math.max(1,endIdx-60);
  for(let i=startIdx;i<=endIdx;i++){
    const ret=candles[i-1].c>0?(candles[i].c-candles[i-1].c)/candles[i-1].c:0;
    sPos=Math.max(0,sPos+ret-threshold);
  }
  return safe(sPos);
}

function getMWC(candles,endIdx){
  if(endIdx<8)return null;
  const c=candles[endIdx].c;
  const roc5 =endIdx>=5 &&candles[endIdx-5].c >0?(c/candles[endIdx-5].c -1)*100:0;
  const roc20=endIdx>=20&&candles[endIdx-20].c>0?(c/candles[endIdx-20].c-1)*100:0;
  const roc60=endIdx>=60&&candles[endIdx-60].c>0?(c/candles[endIdx-60].c-1)*100:0;
  let slope=0;
  if(endIdx>=8){const prev5Base=candles[endIdx-8].c,prev5End=candles[endIdx-3].c;const roc5p=prev5Base>0?(prev5End/prev5Base-1)*100:0;if(roc5>roc5p)slope=1;}
  return (roc5>roc20?1:0)+(roc20>roc60?1:0)+(roc5>0?1:0)+slope;
}

function getTRAM(candles,endIdx){
  if(endIdx<60)return null;
  const returns=[];
  for(let i=endIdx-59;i<=endIdx;i++){if(i>=1&&candles[i-1].c>0)returns.push((candles[i].c-candles[i-1].c)/candles[i-1].c*100);}
  if(returns.length<10)return null;
  returns.sort((a,b)=>a-b);
  const cutoff=Math.max(1,Math.floor(returns.length*0.05));
  const cvar95=mean(returns.slice(0,cutoff));
  const roc20=candles[endIdx-20].c>0?(candles[endIdx].c/candles[endIdx-20].c-1)*100:0;
  return Math.abs(cvar95)>0.001?safe(roc20/Math.abs(cvar95)):0;
}

function getCleanMom(candles,endIdx){
  if(endIdx<20)return null;
  const roc20=candles[endIdx-20].c>0?(candles[endIdx].c/candles[endIdx-20].c-1)*100:0;
  let peak=candles[endIdx-20].h,maxDD=0;
  for(let i=endIdx-19;i<=endIdx;i++){if(candles[i].h>peak)peak=candles[i].h;const dd=peak>0?(candles[i].l-peak)/peak*100:0;if(dd<maxDD)maxDD=dd;}
  return safe(roc20+maxDD);
}

function getDurRatio(candles,endIdx,atr14){
  if(endIdx<30)return null;
  const close=candles[endIdx].c;
  const threshold=close>0?atr14/close:0.015;
  const runs=[];let inRun=false,runLen=0;
  for(let i=5;i<=endIdx;i++){
    const ret=candles[i-5].c>0?(candles[i].c/candles[i-5].c-1):0;
    if(ret>threshold){if(!inRun){inRun=true;runLen=1;}else runLen++;}
    else{if(inRun&&runLen>=3)runs.push(runLen);inRun=false;runLen=0;}
  }
  const regimeDays=inRun?runLen:0;
  const avgRunLen=runs.length>=3?mean(runs):10;
  return{regimeDays,durationRatio:avgRunLen>0?safe(regimeDays/avgRunLen):0,inRun};
}

function getVRAM(candles,endIdx){
  if(endIdx<80)return null;
  const atrPcts=[];let prevC=candles[0].c;
  for(let i=1;i<=endIdx;i++){
    const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-prevC),Math.abs(candles[i].l-prevC));
    atrPcts.push(candles[i].c>0?tr/candles[i].c*100:0);prevC=candles[i].c;
  }
  const window=atrPcts.slice(Math.max(0,endIdx-120),endIdx);
  const sorted=[...window].sort((a,b)=>a-b);
  const rank=pctRank(sorted,atrPcts[endIdx-1]);
  const volRegime=rank<0.33?'LOW':rank<0.67?'MID':'HIGH';
  const regimeROCs=[];
  for(let i=20;i<endIdx;i++){
    const hr=pctRank(sorted,atrPcts[i-1]);
    const hReg=hr<0.33?'LOW':hr<0.67?'MID':'HIGH';
    if(hReg===volRegime&&candles[i-20].c>0)regimeROCs.push((candles[i].c/candles[i-20].c-1)*100);
  }
  if(regimeROCs.length<10)return null;
  const currentROC20=candles[endIdx-20].c>0?(candles[endIdx].c/candles[endIdx-20].c-1)*100:0;
  const mu=mean(regimeROCs),sigma=std(regimeROCs,mu);
  return sigma>0?safe((currentROC20-mu)/sigma):null;
}

function getPIC(candles,endIdx){
  const period=20;if(endIdx<period+1)return null;
  const sv=[],dr=[];
  for(let i=endIdx-period+1;i<=endIdx;i++){
    const ret=candles[i-1].c>0?(candles[i].c-candles[i-1].c)/candles[i-1].c:0;
    sv.push(candles[i].v*(ret>0?1:ret<0?-1:0));dr.push(ret);
  }
  const mav=mean(sv.map(Math.abs))||1;
  return safe(olsBeta(sv.map(v=>v/mav),dr)*1000);
}

// ── Sweep-style accumulator: raw value → forward returns ─────────────────────
// We store every (featureValue, fwd20, fwd10, fwd5) pair, then bin finely at the end.

function makeStore(){return{vals:[],fwd5:[],fwd10:[],fwd20:[]};}
function addStore(s,v,f5,f10,f20){s.vals.push(v);s.fwd5.push(f5);s.fwd10.push(f10);s.fwd20.push(f20);}

// Quantile-based fine binning at the end
function buildFineReport(store,featureName,nBins=20,trimPct=0.01){
  const n=store.vals.length;
  if(n<200)return;
  // Sort by feature value
  const idx=Array.from({length:n},(_,i)=>i).sort((a,b)=>store.vals[a]-store.vals[b]);
  // Trim outliers
  const lo=Math.floor(n*trimPct),hi=Math.ceil(n*(1-trimPct));
  const trimmed=idx.slice(lo,hi);
  const tn=trimmed.length;
  const bSize=Math.floor(tn/nBins);
  if(bSize<30)return;

  const rows=[];
  for(let b=0;b<nBins;b++){
    const start=b*bSize;
    const end=b===nBins-1?tn:start+bSize;
    const chunk=trimmed.slice(start,end);
    const vMin=store.vals[chunk[0]];
    const vMax=store.vals[chunk[chunk.length-1]];
    const vMid=store.vals[chunk[Math.floor(chunk.length/2)]];
    let w5=0,w10=0,w20=0,s5=0,s10=0,s20=0,cnt=0;
    for(const i of chunk){
      const f5=store.fwd5[i],f10=store.fwd10[i],f20=store.fwd20[i];
      if(f5!==null&&f10!==null&&f20!==null){
        cnt++;
        s5+=f5;s10+=f10;s20+=f20;
        if(f5>0)w5++;if(f10>0)w10++;if(f20>0)w20++;
      }
    }
    if(cnt<20)continue;
    rows.push({vMin,vMax,vMid,n:cnt,wr5:w5/cnt*100,wr10:w10/cnt*100,wr20:w20/cnt*100,avg5:s5/cnt,avg10:s10/cnt,avg20:s20/cnt});
  }

  // Compute baseline
  const allWR20=rows.reduce((s,r)=>s+r.wr20*r.n,0)/rows.reduce((s,r)=>s+r.n,0);

  console.log(`\n${'═'.repeat(105)}`);
  console.log(`  ${featureName}  (baseline WR20 = ${allWR20.toFixed(2)}%)`);
  console.log(`${'═'.repeat(105)}`);
  console.log(`  ${'Range'.padEnd(26)} ${'N'.padStart(6)} ${'WR5%'.padStart(6)} ${'WR10%'.padStart(7)} ${'WR20%'.padStart(7)} ${'Avg20%'.padStart(8)} ${'Edge20'.padStart(8)}`);
  console.log(`  ${'-'.repeat(100)}`);

  // Highlight best 3 rows
  const sorted=[...rows].sort((a,b)=>b.wr20-a.wr20);
  const top3=new Set(sorted.slice(0,3).map(r=>r.vMid));

  for(const r of rows){
    const edge=r.wr20-allWR20;
    const mark=top3.has(r.vMid)?(edge>0?'◀★':'  '):'  ';
    console.log(
      `  ${`[${r.vMin.toFixed(3)}, ${r.vMax.toFixed(3)}]`.padEnd(26)} ${String(r.n).padStart(6)} ${r.wr5.toFixed(1).padStart(6)} ${r.wr10.toFixed(1).padStart(7)} ${r.wr20.toFixed(1).padStart(7)} ${r.avg20.toFixed(2).padStart(8)} ${((edge>=0?'+':'')+edge.toFixed(2)+'pp').padStart(8)} ${mark}`
    );
  }

  // Find sweet spot: consecutive bins above baseline with highest avg WR20
  let bestBlock={wr20:-999,vMin:0,vMax:0,n:0,edge:0};
  for(let size=1;size<=5;size++){
    for(let s=0;s+size<=rows.length;s++){
      const block=rows.slice(s,s+size);
      const bn=block.reduce((x,r)=>x+r.n,0);
      const bw=block.reduce((x,r)=>x+r.wr20*r.n,0)/bn;
      if(bw>bestBlock.wr20){bestBlock={wr20:bw,vMin:block[0].vMin,vMax:block[block.length-1].vMax,n:bn,edge:bw-allWR20};}
    }
  }
  console.log(`\n  ➤ SWEET SPOT: [${bestBlock.vMin.toFixed(3)}, ${bestBlock.vMax.toFixed(3)}]  WR20=${bestBlock.wr20.toFixed(2)}%  Edge=${bestBlock.edge>=0?'+':''}${bestBlock.edge.toFixed(2)}pp  N=${bestBlock.n}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const stores={
  fer:makeStore(), cusum:makeStore(), mwc:makeStore(),
  tram:makeStore(), cm:makeStore(), dur:makeStore(),
  vram:makeStore(), pic:makeStore(),
};

const files=fs.readdirSync(CSV_DIR).filter(f=>f.endsWith('.csv'));
let totalObs=0;

process.stdout.write(`Processing ${files.length} stocks...\n`);

for(let fi=0;fi<files.length;fi++){
  if(fi%200===0)process.stdout.write(`  ${fi}/${files.length}\r`);
  const candles=loadCSV(path.join(CSV_DIR,files[fi]));
  if(candles.length<MIN_CANDLES)continue;
  const atr14arr=computeATR14(candles);

  // Sample every 3 bars for finer granularity (more obs per bin)
  for(let idx=80;idx<candles.length-20;idx+=3){
    const atr14=atr14arr[idx]||0.0001;
    const f5 =idx+5 <candles.length&&candles[idx].c>0?(candles[idx+5].c /candles[idx].c-1)*100:null;
    const f10=idx+10<candles.length&&candles[idx].c>0?(candles[idx+10].c/candles[idx].c-1)*100:null;
    const f20=idx+20<candles.length&&candles[idx].c>0?(candles[idx+20].c/candles[idx].c-1)*100:null;
    if(f5===null||f10===null||f20===null)continue;
    totalObs++;

    const fer=getFER(candles,idx);        if(fer!==null)addStore(stores.fer,fer,f5,f10,f20);
    const cu=getCUSUM(candles,idx,atr14); if(cu!==null)addStore(stores.cusum,cu,f5,f10,f20);
    const mwc=getMWC(candles,idx);        if(mwc!==null)addStore(stores.mwc,mwc,f5,f10,f20);
    const tram=getTRAM(candles,idx);      if(tram!==null)addStore(stores.tram,tram,f5,f10,f20);
    const cm=getCleanMom(candles,idx);    if(cm!==null)addStore(stores.cm,cm,f5,f10,f20);
    const dur=getDurRatio(candles,idx,atr14);if(dur!==null)addStore(stores.dur,dur.durationRatio,f5,f10,f20);
    const vram=getVRAM(candles,idx);      if(vram!==null)addStore(stores.vram,vram,f5,f10,f20);
    const pic=getPIC(candles,idx);        if(pic!==null)addStore(stores.pic,pic,f5,f10,f20);
  }
}

process.stdout.write(`\nDone. ${totalObs} observations.\n`);

// Print fine-grained tables
buildFineReport(stores.fer,  'FER — Fractal Efficiency Ratio (0→1)', 20);
buildFineReport(stores.cusum,'CUSUM — Cumulative S+ (% return units)', 20);
buildFineReport(stores.mwc,  'MWC — Momentum Wave Convergence (0-4)', 5, 0); // ordinal
buildFineReport(stores.tram, 'TRAM — Tail-Risk Adjusted Momentum', 20);
buildFineReport(stores.cm,   'CleanMom — ROC20 − MaxDD20 (%)', 20);
buildFineReport(stores.dur,  'DurationRatio — current/avg run', 20);
buildFineReport(stores.vram, 'VRAM — z-score within vol regime', 20);
buildFineReport(stores.pic,  'PIC — Price Impact Coefficient ×1000', 20);
