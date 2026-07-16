/**
 * ORS-Prime v3 vs v4 — MAE / MFE comparison
 * Scans all signals for both param sets, tracks per-trade MFE and MAE
 * MAE = max adverse excursion (biggest intra-trade drawdown before exit)
 * MFE = max favorable excursion (biggest intra-trade gain before exit)
 * Also: win/loss split of MFE/MAE, distribution percentiles, and R-multiple analysis
 */
'use strict';
const path = require('path');
const fs   = require('fs');

const DATA_DIR   = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_HIST   = 260;
const IS_SPLIT   = 0.70;

// ─── PARAM SETS ──────────────────────────────────────────────────────────────
const VERSIONS = {
  v3: {
    maxRSI2: 15, maxRSI14: 45, maxCloseLoc: 50, minBodyPct: 55, maxUpperWickPct: 25,
    minRangePct: 6, maxDistEMA20: -5.0, minDdSwingHigh: 30,
    requireSwingLow: false, requireRedCandle: false, minOrsScore: 72,
    tpPct: 4, slAtrMult: 2.0, maxHoldBars: 15,
  },
  v4: {
    maxRSI2: 15, maxRSI14: 35, maxCloseLoc: 50, minBodyPct: 55, maxUpperWickPct: 25,
    minRangePct: 8, maxDistEMA20: -10.0, minDdSwingHigh: 30,
    requireSwingLow: false, requireRedCandle: false, minOrsScore: 80,
    tpPct: 3, slAtrMult: 3.0, maxHoldBars: 20,
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(raw) {
  const s = String(raw||'').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd,mon,yyyy]=s.split('-'), mm=String((MONTHS[mon.toLowerCase()]??0)+1).padStart(2,'0');
    return { iso:`${yyyy}-${mm}-${dd.padStart(2,'0')}`, ts:Math.floor(Date.UTC(+yyyy,+mm-1,+dd)/1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const iso=s.slice(0,10); return {iso,ts:Math.floor(Date.parse(`${iso}T00:00:00Z`)/1000)}; }
  const t=Date.parse(s); return Number.isFinite(t)?{iso:new Date(t).toISOString().slice(0,10),ts:Math.floor(t/1000)}:{iso:'',ts:0};
}
function parseCSV(fp) {
  const lines=fs.readFileSync(fp,'utf8').trim().split(/\r?\n/);
  const h=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const [iDate,iOpen,iHigh,iLow,iClose,iVol]=['date','open','high','low','close','volume'].map(n=>h.indexOf(n));
  if([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i=>i<0)) return[];
  const out=[];
  for(let i=1;i<lines.length;i++){
    const p=lines[i].split(',');
    const {iso,ts}=parseDate(p[iDate]);
    const o=+p[iOpen],hh=+p[iHigh],lo=+p[iLow],c=+p[iClose],v=+p[iVol];
    if(!iso||!ts||!isFinite(o)||!isFinite(hh)||!isFinite(lo)||!isFinite(c)||c<=0||hh<lo) continue;
    out.push({ts,date:iso,o,h:hh,l:lo,c,v:isFinite(v)?v:0});
  }
  out.sort((a,b)=>a.ts-b.ts); return out;
}
function computeEMA(candles,period){
  const k=2/(period+1); const arr=new Float64Array(candles.length);
  let ema=candles[0].c; arr[0]=ema;
  for(let i=1;i<candles.length;i++){ema=candles[i].c*k+ema*(1-k); arr[i]=ema;}
  return arr;
}
function computeATR14(candles){
  const arr=new Float64Array(candles.length);
  for(let i=1;i<candles.length;i++){
    const hi=candles[i].h,lo=candles[i].l,pc=candles[i-1].c;
    const tr=Math.max(hi-lo,Math.abs(hi-pc),Math.abs(lo-pc));
    arr[i]=i<14?tr:arr[i-1]*13/14+tr/14;
  }
  arr[0]=candles[0].h-candles[0].l; return arr;
}
function computeOrsScore({rsi2,rsi14,rPct,distE20,bodyPct,upWick,isSwLo,volDryUp,ddFromSwHi,zScore}){
  let s=0;
  if(rsi2<=3)s+=30;else if(rsi2<=5)s+=25;else if(rsi2<=10)s+=20;else if(rsi2<=15)s+=12;
  if(rsi14<=30)s+=15;else if(rsi14<=38)s+=10;else if(rsi14<=45)s+=5;
  if(rPct>=5)s+=10;else if(rPct>=3.5)s+=7;else if(rPct>=2.4)s+=4;
  if(distE20<=-8)s+=10;else if(distE20<=-5)s+=7;else if(distE20<=-2)s+=4;
  if(bodyPct>=60)s+=8;else if(bodyPct>=45)s+=5;else if(bodyPct>=35)s+=2;
  if(upWick<=10)s+=7;else if(upWick<=20)s+=5;else if(upWick<=30)s+=2;
  if(isSwLo)s+=5;
  if(volDryUp<=0.70)s+=5;else if(volDryUp<=0.85)s+=3;
  if(ddFromSwHi>=30)s+=10;else if(ddFromSwHi>=25)s+=8;else if(ddFromSwHi>=20)s+=6;else if(ddFromSwHi>=15)s+=3;
  if(zScore<=-3.0)s+=12;else if(zScore<=-2.5)s+=8;else if(zScore<=-2.0)s+=5;
  return Math.min(s,100);
}
function pctile(arr,p){
  if(!arr.length)return 0;
  const s=[...arr].sort((a,b)=>a-b);
  const idx=(p/100)*(s.length-1);
  const lo=Math.floor(idx),hi=Math.ceil(idx);
  return s[lo]+(s[hi]-s[lo])*(idx-lo);
}
function avg(arr){ return arr.length?arr.reduce((a,v)=>a+v,0)/arr.length:0; }

// ─── TRADE ANALYSIS ──────────────────────────────────────────────────────────
function analyzeTrade(candles, sigIdx, a14, p) {
  const entry = candles[sigIdx].c;
  if(entry<=0) return null;
  const tp = entry*(1+p.tpPct/100);
  const sl = Math.max(0, entry - p.slAtrMult*a14);
  const riskPct = (entry-sl)/entry*100;

  let maxFav=0, maxAdv=0, exitPct=0, exitBar=sigIdx;
  let hitTP=false, hitSL=false;

  for(let j=sigIdx+1;j<=Math.min(candles.length-1,sigIdx+p.maxHoldBars);j++){
    const bar=candles[j];
    const hiPct=(bar.h-entry)/entry*100;
    const loPct=(bar.l-entry)/entry*100;
    if(hiPct>maxFav) maxFav=hiPct;
    if(loPct<maxAdv) maxAdv=loPct; // negative

    if(bar.l<=sl&&sl<entry){ hitSL=true; exitPct=(sl-entry)/entry*100; exitBar=j; break; }
    if(bar.h>=tp){ hitTP=true; exitPct=(tp-entry)/entry*100; exitBar=j; break; }
  }
  if(!hitTP&&!hitSL){
    exitBar=Math.min(candles.length-1,sigIdx+p.maxHoldBars);
    exitPct=(candles[exitBar].c-entry)/entry*100;
  }
  const won=hitTP||(exitPct>0);
  return { won, exitPct, mfe:maxFav, mae:maxAdv, riskPct, hitTP, hitSL, rMultiple: riskPct>0?exitPct/riskPct:0 };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const csvFiles = fs.readdirSync(DATA_DIR).filter(f=>f.toLowerCase().endsWith('.csv')&&!f.toLowerCase().includes('_all')&&!f.toLowerCase().includes('all_symbols'));
console.log(`Loaded ${csvFiles.length} symbols from ${DATA_DIR}\n`);

const allSignals = { v3:[], v4:[] }; // {ts, trade}
let processed=0;

for(const csvFile of csvFiles){
  const candles=parseCSV(path.join(DATA_DIR,csvFile));
  if(!Array.isArray(candles)||candles.length<MIN_HIST){ continue; }

  const atr14Arr=computeATR14(candles);
  const ema20Arr=computeEMA(candles,20);

  const zAt=(i)=>{
    const start=Math.max(0,i-251); let sum=0,cnt=0;
    for(let j=start;j<=i;j++){sum+=candles[j].c;cnt++;}
    const mean=sum/cnt; let vSum=0;
    for(let j=start;j<=i;j++){const d=candles[j].c-mean;vSum+=d*d;}
    const std=cnt>1?Math.sqrt(vSum/(cnt-1)):0;
    return std>0?(candles[i].c-mean)/std:0;
  };

  for(let i=10;i<candles.length-1;i++){
    const c=candles[i];
    const range=c.h-c.l;
    if(range<=0||c.c<=0) continue;
    // Liquidity
    let tSum=0,tCnt=0;
    for(let j=Math.max(0,i-20);j<i;j++){tSum+=candles[j].c*candles[j].v;tCnt++;}
    if(!tCnt||tSum/tCnt<10_000_000) continue;

    const bodyPct=Math.abs(c.c-c.o)/range*100;
    const upWick=(c.h-Math.max(c.o,c.c))/range*100;
    const closeLoc=(c.c-c.l)/range*100;
    const rPct=range/c.c*100;
    const red=c.c<c.o;

    // RSI2
    let g2=0,l2=0;
    for(let j=Math.max(1,i-1);j<=i;j++){const d=candles[j].c-candles[j-1].c;if(d>0)g2+=d;else l2-=d;}
    const rsi2=l2===0?100:100-100/(1+g2/l2);
    if(rsi2>25) continue; // broad pre-filter

    // RSI14
    let g14=0,l14=0;
    for(let j=Math.max(1,i-13);j<=i;j++){const d=candles[j].c-candles[j-1].c;if(d>0)g14+=d;else l14-=d;}
    const rsi14=l14===0?100:100-100/(1+g14/l14);
    if(rsi14>55) continue;

    const e20=ema20Arr[i];
    const distE20=e20>0?(c.c-e20)/e20*100:0;
    if(distE20>-1) continue;

    let swHi=-Infinity;
    for(let j=Math.max(0,i-60);j<i;j++) if(candles[j].h>swHi) swHi=candles[j].h;
    const ddFromSwHi=swHi>0?(swHi-c.c)/swHi*100:0;

    let minLo=Infinity;
    for(let j=Math.max(0,i-6);j<i;j++) if(candles[j].l<minLo) minLo=candles[j].l;
    const isSwLo=c.l<=minLo;

    let v20s=0,v20c=0;
    for(let j=Math.max(0,i-20);j<i;j++){v20s+=candles[j].v;v20c++;}
    const vAvg20=v20c?v20s/v20c:1;
    let v5s=0,v5c=0;
    for(let j=Math.max(0,i-5);j<i;j++){v5s+=candles[j].v;v5c++;}
    const volDryUp=v5c?(v5s/v5c)/vAvg20:1;

    const zScore=zAt(i);
    const orsScore=computeOrsScore({rsi2,rsi14,rPct,distE20,bodyPct,upWick,isSwLo,volDryUp,ddFromSwHi,zScore});

    for(const [ver,p] of Object.entries(VERSIONS)){
      if((!p.requireRedCandle||red)&&
         rsi2<=p.maxRSI2&&rsi14<=p.maxRSI14&&closeLoc<=p.maxCloseLoc&&
         bodyPct>=p.minBodyPct&&upWick<=p.maxUpperWickPct&&rPct>=p.minRangePct&&
         distE20<=p.maxDistEMA20&&ddFromSwHi>=p.minDdSwingHigh&&
         (!p.requireSwingLow||isSwLo)&&orsScore>=p.minOrsScore){
        const trade=analyzeTrade(candles,i,atr14Arr[i],p);
        if(trade) allSignals[ver].push({ts:c.ts,trade});
      }
    }
  }
  processed++;
  if(processed%400===0) process.stdout.write(`  ${processed}/${csvFiles.length} symbols...\r`);
}
console.log(`\nCollection complete.\n`);

// ─── REPORT ──────────────────────────────────────────────────────────────────
for(const [ver,signals] of Object.entries(allSignals)){
  const p=VERSIONS[ver];
  signals.sort((a,b)=>a.ts-b.ts);
  const isCut=Math.floor(signals.length*IS_SPLIT);
  const oosSignals=signals.slice(isCut).map(s=>s.trade);
  const isSignals=signals.slice(0,isCut).map(s=>s.trade);

  const report=(trades,label)=>{
    const wins=trades.filter(t=>t.won);
    const losses=trades.filter(t=>!t.won);
    const mfe=trades.map(t=>t.mfe);
    const mae=trades.map(t=>t.mae);
    const winMfe=wins.map(t=>t.mfe);
    const lossMfe=losses.map(t=>t.mfe);
    const winMae=wins.map(t=>t.mae);
    const lossMae=losses.map(t=>t.mae);
    const exitPcts=trades.map(t=>t.exitPct);
    const rMult=trades.map(t=>t.rMultiple);

    console.log(`  ${label}  n=${trades.length}  WR=${(wins.length/trades.length*100).toFixed(1)}%`);
    console.log(`  TP=${p.tpPct}%  SL=${p.slAtrMult}×ATR  hold=${p.maxHoldBars}d`);
    console.log(`  Exit avg=${avg(exitPcts).toFixed(2)}%  R-mult avg=${avg(rMult).toFixed(2)}`);
    console.log(`  ── MFE (max gain during trade) ──────────────────────`);
    console.log(`     All:    avg=${avg(mfe).toFixed(2)}%  p25=${pctile(mfe,25).toFixed(1)}%  p50=${pctile(mfe,50).toFixed(1)}%  p75=${pctile(mfe,75).toFixed(1)}%  p90=${pctile(mfe,90).toFixed(1)}%`);
    console.log(`     Winners:avg=${avg(winMfe).toFixed(2)}%  p50=${pctile(winMfe,50).toFixed(1)}%  p90=${pctile(winMfe,90).toFixed(1)}%`);
    console.log(`     Losers: avg=${avg(lossMfe).toFixed(2)}%  p50=${pctile(lossMfe,50).toFixed(1)}%  p90=${pctile(lossMfe,90).toFixed(1)}%`);
    console.log(`  ── MAE (max drawdown during trade) ──────────────────`);
    console.log(`     All:    avg=${avg(mae).toFixed(2)}%  p25=${pctile(mae,25).toFixed(1)}%  p50=${pctile(mae,50).toFixed(1)}%  p75=${pctile(mae,75).toFixed(1)}%  p10=${pctile(mae,10).toFixed(1)}%`);
    console.log(`     Winners:avg=${avg(winMae).toFixed(2)}%  p50=${pctile(winMae,50).toFixed(1)}%  p10=${pctile(winMae,10).toFixed(1)}%`);
    console.log(`     Losers: avg=${avg(lossMae).toFixed(2)}%  p50=${pctile(lossMae,50).toFixed(1)}%  p10=${pctile(lossMae,10).toFixed(1)}%`);
    const tpHits=trades.filter(t=>t.hitTP).length;
    const slHits=trades.filter(t=>t.hitSL).length;
    const timeouts=trades.length-tpHits-slHits;
    console.log(`  ── Exit reason ───────────────────────────────────────`);
    console.log(`     TP hit: ${tpHits} (${(tpHits/trades.length*100).toFixed(1)}%)  SL hit: ${slHits} (${(slHits/trades.length*100).toFixed(1)}%)  Time: ${timeouts} (${(timeouts/trades.length*100).toFixed(1)}%)`);
    console.log('');
  };

  console.log(`${'═'.repeat(70)}`);
  console.log(`ORS-Prime ${ver.toUpperCase()}   Total signals: ${signals.length}  OOS cutoff: ${new Date(signals[isCut]?.ts*1000).toISOString().slice(0,10)}`);
  console.log(`${'═'.repeat(70)}`);
  report(isSignals,  'IS  (70%)');
  report(oosSignals, 'OOS (30%)');
}
