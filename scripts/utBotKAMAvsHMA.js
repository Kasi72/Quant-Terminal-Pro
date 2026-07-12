'use strict';
// Targeted comparison: KAMA and HMA vs TEMA for UT Bot early signals
// Tests the same params the grid search used for TEMA (EARLY mode: ATR7, Sens1.0)
// Adds KAMA which was missing from the original grid search

const fs   = require('fs');
const path = require('path');
const CSV_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';

const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function loadCSV(file) {
  const lines = fs.readFileSync(file,'utf8').trim().split('\n');
  const bars = [];
  for (let i=1;i<lines.length;i++){
    const [date,o,h,l,c,v]=lines[i].split(',');
    const close=+c,high=+h,low=+l,vol=+v;
    if (!isFinite(close)||close<=0||high<low||high<close||low>close) continue;
    const [d,m,y]=date.split('-');
    bars.push({ts:new Date(+y,MONTHS[m],+d).getTime()/1000,h:high,l:low,c:close,v:vol});
  }
  return bars;
}

// ── MAs ──────────────────────────────────────────────────────────────────────
function ema(c, n) {
  const k=2/(n+1), out=new Float64Array(c.length);
  out[0]=c[0];
  for (let i=1;i<c.length;i++) out[i]=c[i]*k+out[i-1]*(1-k);
  return out;
}
function wma(c, n) {
  const out=new Float64Array(c.length), d=n*(n+1)/2;
  for (let i=0;i<c.length;i++){
    if (i<n-1){out[i]=c[i];continue;}
    let s=0; for(let j=0;j<n;j++) s+=c[i-j]*(n-j);
    out[i]=s/d;
  }
  return out;
}
function hma(c, n) {
  const w1=wma(c,Math.floor(n/2)), w2=wma(c,n);
  const d=c.map((_,i)=>2*w1[i]-w2[i]);
  return wma(d, Math.round(Math.sqrt(n)));
}
function tema(c, n) {
  const e1=ema(c,n), e2=ema(e1,n), e3=ema(e2,n);
  return e1.map((_,i)=>3*e1[i]-3*e2[i]+e3[i]);
}
function dema(c, n) {
  const e1=ema(c,n), e2=ema(e1,n);
  return e1.map((_,i)=>2*e1[i]-e2[i]);
}
function zlema(c, n) {
  const lag=Math.floor((n-1)/2);
  const adj=c.map((v,i)=>i>=lag?v+(v-c[i-lag]):v);
  return ema(adj,n);
}

// KAMA — Kaufman's Adaptive Moving Average
// Pine Script: ta.kama(src, length, fast, slow) — default fast=2, slow=30
function kama(c, n, fast=2, slow=30) {
  const fastSC = 2/(fast+1);
  const slowSC = 2/(slow+1);
  const out = new Float64Array(c.length);
  out[0] = c[0];
  for (let i=1;i<c.length;i++){
    if (i<n){ out[i]=c[i]; continue; }
    // Efficiency Ratio
    const change = Math.abs(c[i] - c[i-n]);
    let noise = 0;
    for (let j=0;j<n;j++) noise += Math.abs(c[i-j] - c[i-j-1 < 0 ? 0 : i-j-1]);
    const er = noise === 0 ? 0 : change / noise;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    out[i] = out[i-1] + sc * (c[i] - out[i-1]);
  }
  return out;
}

// ATR (Wilder's RMA)
function atrRMA(bars, n) {
  const out = new Float64Array(bars.length);
  for (let i=1;i<bars.length;i++){
    const tr=Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-bars[i-1].c),Math.abs(bars[i].l-bars[i-1].c));
    out[i] = i===1 ? tr : (out[i-1]*(n-1)+tr)/n;
  }
  return out;
}

// UT Bot trailing stop + signals
function utBot(src, atr, sens) {
  const n=src.length, stop=new Float64Array(n);
  let buys=0, lagSum=0, hitSum=0, hits3=0, hitSum20=0;
  // Forward returns need bars so we track raw indices
  return { stop, buys: 0, lagSum: 0, hitSum: 0 }; // placeholder — see below
}

function runMode(bars, srcArr, atrArr, sens, bottom20, FWD=10) {
  const n=bars.length, stop=new Float64Array(n);
  let totalSigs=0, hitSum=0, hitSum3=0, hitSum20=0, lagSum=0;
  for (let i=1;i<n;i++){
    const ps=stop[i-1],pSrc=srcArr[i-1],cSrc=srcArr[i];
    const loss=sens*atrArr[i];
    if (cSrc>ps&&pSrc>ps)       stop[i]=Math.max(ps,cSrc-loss);
    else if (cSrc<ps&&pSrc<ps)  stop[i]=Math.min(ps,cSrc+loss);
    else                         stop[i]=cSrc>ps?cSrc-loss:cSrc+loss;

    // Buy signal
    if (i>=60 && srcArr[i]>stop[i] && srcArr[i-1]<=stop[i-1] && i+20<n){
      totalSigs++;
      const entry=bars[i].c;
      let mxH10=0,mxH3=0,mxH20=0;
      for(let f=i+1;f<=i+FWD&&f<n;f++)   mxH10=Math.max(mxH10,(bars[f].h-entry)/entry*100);
      for(let f=i+1;f<=i+3&&f<n;f++)     mxH3 =Math.max(mxH3, (bars[f].h-entry)/entry*100);
      for(let f=i+1;f<=i+20&&f<n;f++)    mxH20=Math.max(mxH20,(bars[f].h-entry)/entry*100);
      if(mxH10>=5) hitSum++;
      if(mxH3>=5)  hitSum3++;
      if(mxH20>=5) hitSum20++;
      lagSum += bottom20[i];
    }
  }
  return { n: totalSigs, wr10: totalSigs>0?hitSum/totalSigs*100:0,
           wr3: totalSigs>0?hitSum3/totalSigs*100:0,
           wr20: totalSigs>0?hitSum20/totalSigs*100:0,
           lag: totalSigs>0?lagSum/totalSigs:0 };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(CSV_DIR).filter(f=>f.endsWith('.csv'));

// Accumulators for each MA type × ATR length combo
// Test EARLY params: ATR7/Sens1, ATR10/Sens1, ATR14/Sens1
const ATR_LENS=[7,10,14];
const MA_TYPES=['TEMA','DEMA','HMA','ZLEMA','KAMA'];
const LENS=[10,14,21];

const acc={};
for(const mt of MA_TYPES) for(const ml of LENS) for(const al of ATR_LENS)
  acc[`${mt}_${ml}_${al}`]={n:0,wr10:0,wr3:0,wr20:0,lag:0};

let done=0;
for (const file of files){
  if(done%200===0) process.stdout.write(`  ${done}/${files.length}\r`);
  done++;
  const bars=loadCSV(path.join(CSV_DIR,file));
  if(bars.length<120) continue;
  const c=bars.map(b=>b.c);

  // rolling 20-bar bottom lag helper
  const bottom20=new Float64Array(bars.length);
  for(let i=20;i<bars.length;i++){
    let mn=Infinity; for(let j=i-20;j<=i;j++) mn=Math.min(mn,bars[j].l);
    bottom20[i]= bars[i].l===mn ? 0 : bars.slice(i-20,i+1).reverse().findIndex((b,k)=>b.l===mn);
  }

  const maCache={};
  function getMA(mt,ml){
    const key=`${mt}_${ml}`;
    if(!maCache[key]){
      if(mt==='TEMA') maCache[key]=tema(c,ml);
      else if(mt==='DEMA') maCache[key]=dema(c,ml);
      else if(mt==='HMA') maCache[key]=hma(c,ml);
      else if(mt==='ZLEMA') maCache[key]=zlema(c,ml);
      else if(mt==='KAMA') maCache[key]=kama(c,ml);
    }
    return maCache[key];
  }
  const atrCache={};
  for(const al of ATR_LENS){
    if(!atrCache[al]) atrCache[al]=atrRMA(bars,al);
  }

  for(const mt of MA_TYPES) for(const ml of LENS) for(const al of ATR_LENS){
    const src=getMA(mt,ml);
    const atr=atrCache[al];
    const r=runMode(bars,src,atr,1.0,bottom20);
    const k=`${mt}_${ml}_${al}`;
    acc[k].n+=r.n; acc[k].wr10+=r.wr10*r.n; acc[k].wr3+=r.wr3*r.n;
    acc[k].wr20+=r.wr20*r.n; acc[k].lag+=r.lag*r.n;
  }
}

// Compute averages and sort
const rows=[];
for(const [k,v] of Object.entries(acc)){
  if(v.n===0) continue;
  const [mt,ml,al]=k.split('_');
  rows.push({mt,ml:+ml,al:+al,n:v.n,
    wr10:v.wr10/v.n,wr3:v.wr3/v.n,wr20:v.wr20/v.n,lag:v.lag/v.n,
    score:(v.wr10/v.n)/(v.lag/v.n+1) });
}
rows.sort((a,b)=>b.wr10-a.wr10);

console.log('\n\n══════════════════════════════════════════════════════════════════════════════════════');
console.log('  KAMA vs HMA vs TEMA vs DEMA vs ZLEMA  —  Early-signal params (Sens=1.0)');
console.log('  Entry = signal bar close, WR = max high in next N bars > entry+5%');
console.log('══════════════════════════════════════════════════════════════════════════════════════');
console.log(`  ${'MA'.padEnd(6)} ${'Len'.padStart(4)} ${'ATR'.padStart(4)} ${'Sigs'.padStart(8)} ${'WR10%'.padStart(7)} ${'WR3d%'.padStart(7)} ${'WR20%'.padStart(7)} ${'AvgLag'.padStart(8)} ${'Score'.padStart(7)}`);
console.log('  '+'─'.repeat(80));
for(const r of rows){
  console.log(`  ${r.mt.padEnd(6)} ${String(r.ml).padStart(4)} ${String(r.al).padStart(4)} ${String(r.n).padStart(8)} ${r.wr10.toFixed(2).padStart(6)}% ${r.wr3.toFixed(2).padStart(6)}% ${r.wr20.toFixed(2).padStart(6)}% ${r.lag.toFixed(1).padStart(8)} ${r.score.toFixed(2).padStart(7)}`);
}

// Per-MA-type summary
console.log('\n\n══════════════════════════════════════════════════════════════════════════════════════');
console.log('  PER MA TYPE AVERAGE  (averaged across all length × ATR combos)');
console.log('══════════════════════════════════════════════════════════════════════════════════════');
console.log(`  ${'MA'.padEnd(8)} ${'Avg WR10%'.padStart(11)} ${'Avg WR3d%'.padStart(11)} ${'Avg WR20%'.padStart(11)} ${'Avg Lag'.padStart(9)} ${'Verdict'}`);
console.log('  '+'─'.repeat(80));
for(const mt of MA_TYPES){
  const sub=rows.filter(r=>r.mt===mt);
  if(!sub.length) continue;
  const wr10=sub.reduce((s,r)=>s+r.wr10,0)/sub.length;
  const wr3=sub.reduce((s,r)=>s+r.wr3,0)/sub.length;
  const wr20=sub.reduce((s,r)=>s+r.wr20,0)/sub.length;
  const lag=sub.reduce((s,r)=>s+r.lag,0)/sub.length;
  const best=sub.sort((a,b)=>b.score-a.score)[0];
  const verdict=mt==='TEMA'?'← baseline (current)':
    wr10>57&&lag<10?'✓ BETTER than TEMA':
    wr10>56&&lag<11?'≈ SIMILAR to TEMA':
    wr10>55?'CLOSE, slightly worse':
    '✗ WORSE than TEMA';
  console.log(`  ${mt.padEnd(8)} ${wr10.toFixed(2).padStart(10)}% ${wr3.toFixed(2).padStart(10)}% ${wr20.toFixed(2).padStart(10)}% ${lag.toFixed(1).padStart(9)} ${verdict}`);
}
console.log('\n  Score = WR10% / (AvgLag+1)  — rewards high precision AND early signal together');
