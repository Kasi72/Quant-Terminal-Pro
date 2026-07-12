// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE CALIBRATION 2 — MOM Score · PCA · Stats Composite · Monster v2 · CandleDNA
// 1,617 NSE stocks × breakout-context signals
//
// Implements ALL sub-components in pure Node.js matching the TypeScript source:
//   stockEngine.ts  → MOM Score, Monster Move v2
//   statsEngine.ts  → Stats Composite (RSI14, Hurst, CCI34, TTM, Guppy, etc.)
//   page.tsx        → PCA Score weights/species
//   stockEngine.ts  → CandleDNA (recalibrated formula)
//
// Usage: node scripts/featureCalibration2.js [section]
//   section: all | mom | pca | stats | monster | dna  (default: all)
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const SECTION  = process.argv[2] || 'all';

// ─── CSV parse ───────────────────────────────────────────────────────────────
function parseCSV(fp) {
  try {
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      if (p.length < 6) continue;
      const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
      if (!c || c <= 0 || isNaN(c)) continue;
      out.push({ d: p[0], o: +o||c, h: Math.max(h,o,c), l: Math.min(l,o,c), c, v: v||0 });
    }
    return out;
  } catch { return []; }
}

// ─── Core indicators ─────────────────────────────────────────────────────────
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
  a[14] = s/14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
    a[i] = (a[i-1]*13+tr)/14;
  }
  return a;
}

function computeEMA(c, period) {
  const e = new Array(c.length).fill(0);
  if (c.length < period) return e;
  let s = 0;
  for (let i = 0; i < period; i++) s += c[i].c;
  e[period-1] = s/period;
  const k = 2/(period+1);
  for (let i = period; i < c.length; i++) e[i] = c[i].c*k + e[i-1]*(1-k);
  return e;
}

function computeSMA(c, period) {
  const s = new Array(c.length).fill(0);
  for (let i = period-1; i < c.length; i++) {
    let sum = 0; for (let j = i-period+1; j <= i; j++) sum += c[j].c;
    s[i] = sum/period;
  }
  return s;
}

function computeRSI(c, period) {
  const r = new Array(c.length).fill(50);
  if (c.length < period+1) return r;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i].c - c[i-1].c;
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains/period, al = losses/period;
  r[period] = al === 0 ? 100 : 100 - 100/(1+ag/al);
  for (let i = period+1; i < c.length; i++) {
    const d = c[i].c - c[i-1].c;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag*(period-1)+g)/period;
    al = (al*(period-1)+l)/period;
    r[i] = al === 0 ? 100 : 100 - 100/(1+ag/al);
  }
  return r;
}

function computeRSI2(c) {
  // 2-period RSI (Wilder EMA)
  const r = new Array(c.length).fill(50);
  if (c.length < 3) return r;
  const d = c[2].c - c[1].c;
  let ag = d > 0 ? d : 0, al = d < 0 ? -d : 0;
  r[2] = al === 0 ? 100 : 100 - 100/(1+ag/al);
  for (let i = 3; i < c.length; i++) {
    const dd = c[i].c - c[i-1].c;
    const g = dd > 0 ? dd : 0, l = dd < 0 ? -dd : 0;
    ag = (ag+g)/2; al = (al+l)/2;
    r[i] = al === 0 ? 100 : 100 - 100/(1+ag/al);
  }
  return r;
}

function computeCCI(c, period) {
  const cc = new Array(c.length).fill(0);
  for (let i = period-1; i < c.length; i++) {
    const tps = [];
    for (let j = i-period+1; j <= i; j++) tps.push((c[j].h+c[j].l+c[j].c)/3);
    const tp = c[i].c; // current
    const sma = tps.reduce((s,v)=>s+v,0)/period;
    const mad = tps.reduce((s,v)=>s+Math.abs(v-sma),0)/period;
    cc[i] = mad > 0 ? ((c[i].h+c[i].l+c[i].c)/3 - sma)/(0.015*mad) : 0;
  }
  return cc;
}

function computeOBV(c) {
  const obv = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    if (c[i].c > c[i-1].c) obv[i] = obv[i-1]+c[i].v;
    else if (c[i].c < c[i-1].c) obv[i] = obv[i-1]-c[i].v;
    else obv[i] = obv[i-1];
  }
  return obv;
}

function linRegSlope(arr) {
  const n = arr.length;
  if (n < 3) return 0;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i=0;i<n;i++){sx+=i;sy+=arr[i];sxy+=i*arr[i];sx2+=i*i;}
  const d=n*sx2-sx*sx;
  return Math.abs(d)<1e-10?0:(n*sxy-sx*sy)/d;
}

function computeOBVSlope10(obv, idx) {
  if (idx < 10) return 0;
  const slice = [];
  for (let i = idx-10; i <= idx; i++) slice.push(obv[i]);
  const slope = linRegSlope(slice);
  const mean = slice.reduce((s,v)=>s+v,0)/slice.length;
  return mean !== 0 ? slope/Math.abs(mean)*100 : 0;
}

function computeADX14(c) {
  const adx = new Array(c.length).fill(20);
  if (c.length < 30) return adx;
  let smoothDM_p=0, smoothDM_m=0, smoothATR=0;
  for (let i=1;i<=14;i++){
    const upM = c[i].h-c[i-1].h, dnM = c[i-1].l-c[i].l;
    smoothDM_p += (upM>dnM&&upM>0)?upM:0;
    smoothDM_m += (dnM>upM&&dnM>0)?dnM:0;
    smoothATR += Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
  }
  let dx=0;
  if(smoothATR>0){
    const p=smoothDM_p/smoothATR*100, m=smoothDM_m/smoothATR*100;
    const ppm=p+m; dx=ppm>0?Math.abs(p-m)/ppm*100:0;
  }
  let adx14=dx;
  for(let i=15;i<c.length;i++){
    const upM=c[i].h-c[i-1].h, dnM=c[i-1].l-c[i].l;
    const dm_p=(upM>dnM&&upM>0)?upM:0;
    const dm_m=(dnM>upM&&dnM>0)?dnM:0;
    const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
    smoothDM_p=smoothDM_p-smoothDM_p/14+dm_p;
    smoothDM_m=smoothDM_m-smoothDM_m/14+dm_m;
    smoothATR=smoothATR-smoothATR/14+tr;
    const p=smoothATR>0?smoothDM_p/smoothATR*100:0;
    const m=smoothATR>0?smoothDM_m/smoothATR*100:0;
    const ppm=p+m; const dxi=ppm>0?Math.abs(p-m)/ppm*100:0;
    adx14=(adx14*13+dxi)/14;
    adx[i]=adx14;
  }
  return adx;
}

function computeHurst(c, idx) {
  // Simplified R/S analysis
  if (idx < 50) return 0.5;
  const closes = [];
  for (let j = idx-49; j <= idx; j++) closes.push(Math.log(c[j].c/c[j-1>0?j-1:0].c));
  const lags = [4,8,16,32];
  const logRS=[], logN=[];
  for (const lag of lags) {
    if (closes.length < lag*2) continue;
    const series = closes.slice(0,lag);
    const m = series.reduce((s,v)=>s+v,0)/lag;
    let cumDev=0, maxD=-Infinity, minD=Infinity, stdSum=0;
    for (const v of series) { cumDev+=v-m; maxD=Math.max(maxD,cumDev); minD=Math.min(minD,cumDev); stdSum+=(v-m)**2; }
    const std=Math.sqrt(stdSum/lag);
    if(std>0&&(maxD-minD)>0){logRS.push(Math.log(maxD-minD)/Math.log(std));logN.push(Math.log(lag));}
  }
  if(logRS.length<2) return 0.5;
  return linRegSlope(logRS);
}

function computeGuppy(c, idx) {
  const periods=[3,5,8,10,12,15,30,35,40,45,50,60];
  const emas=[];
  for(const p of periods){
    let e=0, k=2/(p+1);
    const start=Math.max(0,idx-p*3);
    let sum=0, cnt=0;
    for(let j=start;j<=Math.min(start+p-1,idx);j++){sum+=c[j].c;cnt++;}
    e=cnt>0?sum/cnt:c[idx].c;
    for(let j=start+cnt;j<=idx;j++) e=c[j].c*k+e*(1-k);
    emas.push(e);
  }
  const price=c[idx].c;
  const spread=Math.max(...emas)-Math.min(...emas);
  const spreadPct=price>0?spread/price*100:99;
  const shortEMAs=emas.slice(0,6), longEMAs=emas.slice(6);
  const avgShort=shortEMAs.reduce((s,v)=>s+v,0)/6;
  const avgLong=longEMAs.reduce((s,v)=>s+v,0)/6;
  const cleanBullishFan=shortEMAs.every(e=>e>Math.min(...longEMAs));
  const groupGapPct=avgLong>0?(avgShort-avgLong)/avgLong*100:0;
  // Compress days: how many of last 10 days had spread<2%
  let compressDays=0;
  for(let back=1;back<=Math.min(10,idx);back++){
    const bIdx=idx-back;
    const bEmas=[];
    for(const p of periods){
      let e=0,k=2/(p+1),s2=Math.max(0,bIdx-p*3),sum=0,cnt=0;
      for(let j=s2;j<=Math.min(s2+p-1,bIdx);j++){sum+=c[j].c;cnt++;}
      e=cnt>0?sum/cnt:c[bIdx].c;
      for(let j=s2+cnt;j<=bIdx;j++) e=c[j].c*k+e*(1-k);
      bEmas.push(e);
    }
    const bSpread=Math.max(...bEmas)-Math.min(...bEmas);
    const bPct=c[bIdx].c>0?bSpread/c[bIdx].c*100:99;
    if(bPct<2) compressDays++;
  }
  const coiledRelease=compressDays>=8&&spreadPct<=5&&cleanBullishFan&&groupGapPct>=1;
  return {spreadPct,cleanBullishFan,groupGapPct,compressDays,coiledRelease};
}

function computeBB(c, idx, period=20, mult=2) {
  if(idx<period-1) return {upper:c[idx].c,lower:c[idx].c,width:0,pctl:50,squeeze:false};
  let sum=0;
  for(let j=idx-period+1;j<=idx;j++) sum+=c[j].c;
  const sma=sum/period;
  let variance=0;
  for(let j=idx-period+1;j<=idx;j++) variance+=(c[j].c-sma)**2;
  const sd=Math.sqrt(variance/period);
  const upper=sma+mult*sd, lower=sma-mult*sd;
  const width=sma>0?(upper-lower)/sma*100:0;
  // percentile of width vs last 50 bars
  const widths=[];
  for(let k=Math.max(period-1,idx-50);k<idx;k++){
    let s2=0;for(let j=k-period+1;j<=k;j++){if(j>=0)s2+=c[j].c;}
    const sm=s2/period;let v2=0;
    for(let j=k-period+1;j<=k;j++){if(j>=0)v2+=(c[j].c-sm)**2;}
    const sd2=Math.sqrt(v2/period);
    const w2=sm>0?(sm+mult*sd2-(sm-mult*sd2))/sm*100:0;
    widths.push(w2);
  }
  const pctl=widths.length>0?widths.filter(w=>w<=width).length/widths.length*100:50;
  return {upper,lower,width,pctl,squeeze:pctl<=20};
}

function computeKeltner(c, atr, idx) {
  if(idx<20) return {upper:c[idx].c,lower:c[idx].c};
  let sum=0;for(let j=idx-19;j<=idx;j++) sum+=c[j].c;
  const ema20=sum/20;
  const upper=ema20+2*atr[idx], lower=ema20-2*atr[idx];
  return {upper,lower};
}

function computeVolDryUp(c, idx) {
  let score=0;
  if(idx<5) return score;
  for(let k=0;k<5;k++){
    if(c[idx-k].v<c[idx-k-1].v) score++;
  }
  return score;
}

function computeHigherLow(c, idx) {
  if(idx<20) return false;
  // Find 2 recent swing lows
  const swings=[];
  for(let j=idx-2;j>=Math.max(1,idx-20);j--){
    if(c[j].l<c[j-1].l&&c[j].l<(c[j+1]||c[j]).l) swings.push(c[j].l);
    if(swings.length>=2) break;
  }
  return swings.length>=2&&swings[0]>swings[1];
}

function findZone(c, atr, idx) {
  const zone=[];
  for(let j=idx-1;j>=Math.max(1,idx-30);j--){
    if(atr[j]<=0) break;
    if((c[j].h-c[j].l)/atr[j]>1.0) break;
    zone.unshift(j);
  }
  if(zone.length<6) return null;
  let zH=-Infinity,zL=Infinity;
  for(const j of zone){zH=Math.max(zH,c[j].h);zL=Math.min(zL,c[j].l);}
  const zt=zL>0?(zH-zL)/zL*100:999;
  if(zt>20) return null;
  return {zH,zL,len:zone.length,zt};
}

function volAvg(c,idx,n){let s=0,ct=0;for(let j=Math.max(0,idx-n);j<idx;j++){s+=c[j].v;ct++;}return ct>0?s/ct:1;}
function prevolAvg(c,idx){let s=0,ct=0;for(let j=Math.max(0,idx-6);j<idx-1;j++){s+=c[j].v;ct++;}return ct>0?s/ct:1;}

// ─── Load stocks ─────────────────────────────────────────────────────────────
console.log('════════════════════════════════════════════════════════════════════════════');
console.log('  FEATURE CALIBRATION 2 — MOM · PCA · Stats · Monster v2 · CandleDNA');
console.log('════════════════════════════════════════════════════════════════════════════\n');

const files=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv'));
console.log(`Loading ${files.length} CSV files...`);
const allStocks=[];
for(const f of files){
  const c=parseCSV(path.join(DATA_DIR,f));
  if(c.length<250) continue;
  const atr=computeATR14(c);
  allStocks.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr});
}
console.log(`Usable: ${allStocks.length} stocks\n`);
console.log('Building signal dataset (ETA ~90 seconds)...\n');

// ─── Build signal dataset ─────────────────────────────────────────────────────
const points=[];
for(const {sym,c,atr} of allStocks){
  // Pre-compute indicators once per stock
  const ema20=computeEMA(c,20), ema50=computeEMA(c,50), sma50=computeSMA(c,50);
  const obv=computeOBV(c);
  const rsi14=computeRSI(c,14), rsi2=computeRSI2(c);
  const cci34=computeCCI(c,34);
  const adx=computeADX14(c);

  for(let i=220;i<c.length-22;i++){
    const s=c[i];
    if(!s||s.c<=0||atr[i]<=0) continue;
    const rng=s.h-s.l; if(rng<=0) continue;

    // Breakout context: close > prior 20-bar high with compression zone
    let p20H=0;for(let j=i-20;j<i;j++)if(j>=0&&c[j].h>p20H)p20H=c[j].h;
    if(s.c<p20H*0.998) continue;
    const zone=findZone(c,atr,i); if(!zone) continue;
    const avgV20=volAvg(c,i,20); if(avgV20<=0||s.v<avgV20*0.8) continue;

    // ── CandleDNA features ──
    const bodySize=Math.abs(s.c-s.o);
    const upperWickAbs=s.h-Math.max(s.c,s.o);
    const lowerWickAbs=Math.min(s.c,s.o)-s.l;
    const upperWickATR=upperWickAbs/atr[i];
    const lowerWickATR=lowerWickAbs/atr[i];
    const closeLoc=rng>0?(s.c-s.l)/rng*100:50;
    const cl1=i>=1?(()=>{const p=c[i-1];const r=p.h-p.l;return r>0?(p.c-p.l)/r*100:50;})():closeLoc;
    const cl2=i>=2?(()=>{const p=c[i-2];const r=p.h-p.l;return r>0?(p.c-p.l)/r*100:50;})():closeLoc;
    const avgCL3=(closeLoc+cl1+cl2)/3;
    const upperWickPct=upperWickAbs/rng*100;
    const bodyPct=bodySize/rng*100;
    const eRA=rng/atr[i];
    const bodyATR=bodySize/atr[i];
    const marubozuScore=Math.max(0,100-(upperWickPct+(lowerWickAbs/rng*100)));
    const ULRatio=lowerWickAbs>0.001?upperWickAbs/lowerWickAbs:(upperWickAbs>0.001?99:1);

    // ── MOM Score components ──
    const emaAligned=s.c>ema20[i]&&ema20[i]>ema50[i];
    const higherLow=computeHigherLow(c,i);
    const volDryUp=computeVolDryUp(c,i);
    const obvSlope=computeOBVSlope10(obv,i);
    const adxVal=adx[i];
    const adxInRange=adxVal>=20&&adxVal<=40;
    // Gap-adjusted RR approximation: use ATR-based target
    const target5=s.c+3*atr[i];
    const stop=s.c-1.5*atr[i];
    const gapRR=stop<s.c?(target5-s.c)/(s.c-stop):0;
    let momScore=0;
    if(emaAligned) momScore+=25;
    if(higherLow) momScore+=20;
    if(volDryUp>=3) momScore+=15;
    if(obvSlope>=0.5) momScore+=15;
    if(adxInRange) momScore+=10;
    if(gapRR>=2) momScore+=10;
    if(volDryUp>=4) momScore+=5;

    // ── PCA Score components (zone+candle+volume features) ──
    const pre10Ranges=[];
    for(let j=Math.max(1,i-11);j<i-1;j++) if(atr[j]>0) pre10Ranges.push((c[j].h-c[j].l)/atr[j]);
    const pre10AvgRangeATR=pre10Ranges.length>0?pre10Ranges.reduce((s,v)=>s+v,0)/pre10Ranges.length:1;
    const vr20=s.v/avgV20;
    const pv5=prevolAvg(c,i);
    const vp5=pv5>0?s.v/pv5:0;
    // PCA raw score (from page.tsx weights)
    const pcaMeans=[6.84,1.34,1.92,2.41,0.62,24.18];
    const pcaStds=[4.92,0.58,1.41,2.05,0.21,14.62];
    const pcaWeights=[0.04,-0.16,-0.19,-0.07,0.10,-0.10];
    const rawPCA=[zone.zt,eRA,vr20,vp5,pre10AvgRangeATR,upperWickPct];
    let pcaScore=0;
    for(let k=0;k<6;k++) pcaScore+=pcaWeights[k]*((rawPCA[k]-pcaMeans[k])/pcaStds[k]);

    // ── Stats Composite components ──
    const rsi14v=rsi14[i];
    const rsi2v=rsi2[i];
    const cci34v=cci34[i];
    const hurstV=computeHurst(c,i);
    const hurstTrending=hurstV>0.55;
    const bb=computeBB(c,i);
    const kelt=computeKeltner(c,atr,i);
    const keltSqueeze=bb.upper<kelt.upper&&bb.lower>kelt.lower;
    const ttmSqueezeOn=keltSqueeze&&bb.squeeze;
    // TTM momentum: close - midpoint of (highest high + lowest low)/2 over 20 bars
    let hh20=-Infinity,ll20=Infinity;
    for(let j=Math.max(0,i-19);j<=i;j++){hh20=Math.max(hh20,c[j].h);ll20=Math.min(ll20,c[j].l);}
    const ttmMom=s.c-(hh20+ll20)/2;
    const ttmMomPrev=i>=1?c[i-1].c-((()=>{let h=-Infinity,l=Infinity;for(let j=Math.max(0,i-20);j<i;j++){h=Math.max(h,c[j].h);l=Math.min(l,c[j].l);}return(h+l)/2;})()):ttmMom;
    const ttmMomRising=ttmMom>ttmMomPrev;
    // 52-week metrics
    let high52=-Infinity,low52=Infinity;
    for(let j=Math.max(0,i-252);j<i;j++){high52=Math.max(high52,c[j].h);low52=Math.min(low52,c[j].l);}
    const ddFromHigh=high52>0?(s.c-high52)/high52*100:0; // negative = below 52wh
    const pctFromLow=low52>0?(s.c-low52)/low52*100:0;
    // Vol z-score
    const volMean=avgV20;
    let volStdSum=0;for(let j=Math.max(0,i-20);j<i;j++) volStdSum+=(c[j].v-volMean)**2;
    const volStd=Math.sqrt(volStdSum/20);
    const volZ=volStd>0?(s.v-volMean)/volStd:0;
    const volZSig=volZ>=2;
    // Guppy (computed once for this bar)
    const guppy=computeGuppy(c,i);
    // Sharpe 20-day
    const rets=[];for(let j=Math.max(1,i-19);j<=i;j++) rets.push((c[j].c-c[j-1].c)/c[j-1].c);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    let retVar=0;for(const r of rets) retVar+=(r-retMean)**2;
    const retStd=Math.sqrt(retVar/rets.length);
    const sharpe20=retStd>0?retMean/retStd*Math.sqrt(252):0;
    // Vol profile skew: green-day vol minus red-day vol bias
    let gVol=0,gN=0,rVol=0,rN=0;
    for(let j=Math.max(0,i-20);j<i;j++){
      if(c[j].c>=c[j].o){gVol+=c[j].v;gN++;}else{rVol+=c[j].v;rN++;}
    }
    const volSkew=volMean>0?((gN>0?gVol/gN:0)-(rN>0?rVol/rN:0))/volMean:0;
    // Stats score
    let statsScore=0;
    if(rsi14v>=80) statsScore+=14;
    else if(rsi14v>=70) statsScore+=9;
    else if(rsi14v>=60) statsScore+=5;
    if(hurstTrending) statsScore+=12;
    if(cci34v>=150&&cci34v<=300) statsScore+=6;
    if(pctFromLow>=80) statsScore+=6;
    if(ddFromHigh>=-10) statsScore+=6;
    if(ttmSqueezeOn&&ttmMomRising) statsScore+=8;
    if(volZSig) statsScore+=5; else if(volZ>=1.5) statsScore+=3;
    if(bb.squeeze) statsScore+=6; else if(bb.pctl<=20) statsScore+=3;
    if(keltSqueeze) statsScore+=4;
    if(keltSqueeze&&bb.squeeze) statsScore+=3;
    if(sharpe20>2.5) statsScore+=4;
    if(volSkew>0.2) statsScore+=3;
    if(guppy.coiledRelease) statsScore+=8;
    else if(guppy.cleanBullishFan) statsScore+=3;
    statsScore=Math.min(statsScore,100);

    // ── Monster Move v2 components ──
    const mom5=i>=5?(s.c-c[i-5].c)/c[i-5].c*100:0;
    const aboveSMA50=s.c>sma50[i]&&sma50[i]>0;
    let high50=-Infinity;for(let j=Math.max(0,i-50);j<i;j++) if(c[j].h>high50) high50=c[j].h;
    const swingDist=high50>0?(s.c-high50)/high50*100:0;
    const pre10VR=pre10Ranges.reduce((s,v)=>s+v,0)/(pre10Ranges.length||1)/avgV20; // rough
    // pre10 avg vol ratio
    let p10vSum=0,p10vN=0;
    for(let j=Math.max(0,i-11);j<i-1;j++){const av=volAvg(c,j,20);if(av>0){p10vSum+=c[j].v/av;p10vN++;}}
    const pre10AvgVR=p10vN>0?p10vSum/p10vN:1;
    const atrPct=s.c>0?atr[i]/s.c*100:0;
    const monMOM=mom5>=7&&eRA>=1.2&&vr20>=1.0&&atrPct>=4.5&&aboveSMA50;
    const monMRV=swingDist<=-30&&rsi2v<=60&&pre10AvgVR<=0.3;

    // ── Forward outcomes ──
    let mfe20=0,mdd10=0,fwd5=0,fwd10=0,fwd20=0;
    for(let j=1;j<=20&&i+j<c.length;j++){
      const ret=(c[i+j].h-s.c)/s.c*100;
      if(ret>mfe20) mfe20=ret;
      if(j<=10){const dd=(s.c-c[i+j].l)/s.c*100;if(dd>mdd10)mdd10=dd;}
      if(j===5) fwd5=(c[i+5].c-s.c)/s.c*100;
      if(j===10) fwd10=(c[i+10].c-s.c)/s.c*100;
      if(j===20) fwd20=(c[i+20].c-s.c)/s.c*100;
    }

    points.push({
      sym, i, fwd5, fwd10, fwd20, mfe20, mdd10,
      // CandleDNA
      upperWickATR, lowerWickATR, avgCL3, closeLoc, bodyATR, eRA, marubozuScore, ULRatio, bodyPct, upperWickPct,
      // MOM Score
      emaAligned, higherLow, volDryUp, obvSlope, adxVal, adxInRange, gapRR, momScore,
      // PCA
      pcaScore, zone_zt: zone.zt, zone_len: zone.len, pre10AvgRangeATR, vr20, vp5,
      // Stats
      statsScore, rsi14v, cci34v, hurstTrending, hurstV, ttmSqueezeOn, ttmMomRising,
      ddFromHigh, pctFromLow, bb_squeeze: bb.squeeze, bb_pctl: bb.pctl, keltSqueeze,
      guppy_coiled: guppy.coiledRelease, guppy_fan: guppy.cleanBullishFan,
      sharpe20, volSkew, volZ, volZSig,
      // Monster
      mom5, aboveSMA50, swingDist, rsi2v, pre10AvgVR, atrPct, monMOM, monMRV,
    });
  }
}

console.log(`Total signals: ${points.length.toLocaleString()}\n`);

// ─── Stats helpers ────────────────────────────────────────────────────────────
function avg(arr){return arr.length>0?arr.reduce((s,v)=>s+v,0)/arr.length:0;}
function pct(arr,fn){return arr.length>0?arr.filter(fn).length/arr.length*100:0;}
function pearsonR(xs,ys){
  const n=xs.length,mx=avg(xs),my=avg(ys);
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){num+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}
  return dx>0&&dy>0?num/Math.sqrt(dx*dy):0;
}
function stars(r){const a=Math.abs(r);return a>0.06?'★★★★':a>0.04?'★★★':a>0.025?'★★':a>0.012?'★':'';}
function fmtPct(v,w=7){return((v>=0?'+':'')+v.toFixed(2)+'%').padStart(w);}
function row(pts){
  if(pts.length<10) return null;
  return {
    n:pts.length,
    a5:avg(pts.map(p=>p.fwd5)), a10:avg(pts.map(p=>p.fwd10)), a20:avg(pts.map(p=>p.fwd20)),
    mfe:avg(pts.map(p=>p.mfe20)), mdd:avg(pts.map(p=>p.mdd10)),
    win:pct(pts,p=>p.fwd20>0), gt3:pct(pts,p=>p.fwd20>3), gt5:pct(pts,p=>p.fwd20>5),
  };
}
function printTable(rows,col='Bucket'){
  const hdr=`  ${col.padEnd(22)}│ Count │ Avg5d  │ Avg10d │ Avg20d │ MFE20d │ Win%  │ >3%  │ >5%`;
  const sep='  '+'─'.repeat(22)+'┼'+'───────┼'.repeat(7)+'──────';
  console.log(hdr); console.log(sep);
  for(const [label,r] of rows){
    if(!r) continue;
    console.log(`  ${label.padEnd(22)}│${String(r.n).padStart(6)} │${fmtPct(r.a5)} │${fmtPct(r.a10)} │${fmtPct(r.a20)} │${fmtPct(r.mfe)} │${r.win.toFixed(1).padStart(4)}% │${r.gt3.toFixed(1).padStart(4)}% │${r.gt5.toFixed(1).padStart(4)}%`);
  }
  console.log('');
}
const fwd20=points.map(p=>p.fwd20);
const baseline=row(points);
console.log(`Baseline (all ${points.length.toLocaleString()} signals): Avg20d=${fmtPct(baseline.a20)} | MFE=${fmtPct(baseline.mfe)} | Win=${baseline.win.toFixed(1)}% | >5%=${baseline.gt5.toFixed(1)}%\n`);

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: MOM SCORE
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'||SECTION==='mom'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 1: MOM SCORE CALIBRATION                                           ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

console.log('── 1A: Component Correlations (r vs fwd20d) ──\n');
const momFeatures=[
  ['emaAligned (binary)',  p=>p.emaAligned?1:0],
  ['higherLow (binary)',   p=>p.higherLow?1:0],
  ['volDryUp (0-5)',       p=>p.volDryUp],
  ['obvSlope10',           p=>Math.max(-5,Math.min(5,p.obvSlope))],
  ['adxVal',               p=>p.adxVal],
  ['adxInRange (binary)',  p=>p.adxInRange?1:0],
  ['gapRR',                p=>Math.min(p.gapRR,5)],
  ['momScore (composite)', p=>p.momScore],
];
console.log('  Feature             │  r vs fwd20 │ Stars');
console.log('  ──────────────────-─┼─────────────┼──────');
for(const [name,fn] of momFeatures){
  const r=pearsonR(points.map(fn),fwd20);
  console.log(`  ${name.padEnd(22)}│  ${(r>=0?'+':'')+r.toFixed(4).padStart(7)}   │ ${stars(r)}`);
}
console.log('');

console.log('── 1B: MomScore Tier Buckets (current: ≥70 strong, ≥40 ok, <40 weak) ──\n');
printTable([
  ['0 (no signals)',    row(points.filter(p=>p.momScore===0))],
  ['1-20',             row(points.filter(p=>p.momScore>=1&&p.momScore<=20))],
  ['21-35',            row(points.filter(p=>p.momScore>=21&&p.momScore<=35))],
  ['36-45',            row(points.filter(p=>p.momScore>=36&&p.momScore<=45))],
  ['46-55',            row(points.filter(p=>p.momScore>=46&&p.momScore<=55))],
  ['56-65',            row(points.filter(p=>p.momScore>=56&&p.momScore<=65))],
  ['66-75',            row(points.filter(p=>p.momScore>=66&&p.momScore<=75))],
  ['76-90',            row(points.filter(p=>p.momScore>=76&&p.momScore<=90))],
  ['91-100',           row(points.filter(p=>p.momScore>=91))],
],'MomScore bucket');

console.log('── 1C: Individual Component ON vs OFF ──\n');
for(const [name,fn,threshold] of [
  ['emaAligned',    p=>p.emaAligned,   null],
  ['higherLow',     p=>p.higherLow,    null],
  ['volDryUp ≥3',   p=>p.volDryUp>=3,  null],
  ['obvSlope ≥0.5', p=>p.obvSlope>=0.5,null],
  ['adxInRange',    p=>p.adxInRange,   null],
  ['gapRR ≥2',      p=>p.gapRR>=2,     null],
]){
  const on=row(points.filter(fn));
  const off=row(points.filter(p=>!fn(p)));
  if(!on||!off) continue;
  const edge=on.a20-off.a20;
  console.log(`  ${name.padEnd(16)} │ ON  (${String(on.n).padStart(5)}): Avg20d ${fmtPct(on.a20)}, Win ${on.win.toFixed(1)}%, >5% ${on.gt5.toFixed(1)}%`);
  console.log(`                   │ OFF (${String(off.n).padStart(5)}): Avg20d ${fmtPct(off.a20)}, Win ${off.win.toFixed(1)}%, >5% ${off.gt5.toFixed(1)}%  ← EDGE: ${fmtPct(edge)}`);
}
console.log('');

console.log('── 1D: Best MomScore threshold (grid search) ──\n');
const momThresholds=[0,15,25,35,45,55,65,75,85];
for(const t of momThresholds){
  const hi=row(points.filter(p=>p.momScore>=t));
  const lo=row(points.filter(p=>p.momScore<t));
  if(!hi||!lo) continue;
  console.log(`  Score ≥${String(t).padStart(3)}: N=${String(hi.n).padStart(5)} │ Avg20d ${fmtPct(hi.a20)} | Win ${hi.win.toFixed(1)}% | >5% ${hi.gt5.toFixed(1)}%`);
}
console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: PCA SCORE
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'||SECTION==='pca'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 2: PCA SUPER-SCORE CALIBRATION                                     ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

console.log('── 2A: PCA Input Feature Correlations ──\n');
const pcaFeatures=[
  ['zoneTight (lower=better)',   p=>-p.zone_zt],
  ['eRA (range÷ATR)',            p=>-p.eRA],
  ['vr20 (vol÷20avg)',           p=>-p.vr20],
  ['vp5 (vol÷pre5)',             p=>-p.vp5],
  ['pre10AvgRangeATR',           p=>p.pre10AvgRangeATR],
  ['upperWickPct (lower=better)',p=>-p.upperWickPct],
  ['pcaScore (composite)',        p=>p.pcaScore],
];
console.log('  Feature (neg=inverted)   │  r vs fwd20 │ Stars');
console.log('  ────────────────────────-┼─────────────┼──────');
for(const [name,fn] of pcaFeatures){
  const r=pearsonR(points.map(fn),fwd20);
  console.log(`  ${name.padEnd(26)}│  ${(r>=0?'+':'')+r.toFixed(4).padStart(7)}   │ ${stars(r)}`);
}
console.log('');

// Percentile rank by PCA score
const sorted=[...points].sort((a,b)=>b.pcaScore-a.pcaScore);
const n=sorted.length;
console.log('── 2B: PCA Score Decile Analysis ──\n');
console.log('  Decile │ Score range │  N  │ Avg20d │ Win%  │ >5%');
console.log('  ───────┼─────────────┼─────┼────────┼───────┼────');
for(let d=0;d<10;d++){
  const lo=Math.floor(d*n/10), hi=Math.floor((d+1)*n/10);
  const slice=sorted.slice(lo,hi);
  const r=row(slice);
  if(!r) continue;
  const minS=slice[slice.length-1]?.pcaScore??0, maxS=slice[0]?.pcaScore??0;
  console.log(`   D${d+1} (${d===0?'top':'   '})│ ${minS.toFixed(2).padStart(5)}–${maxS.toFixed(2).padStart(5)} │${String(r.n).padStart(5)}│${fmtPct(r.a20)} │${r.win.toFixed(1).padStart(4)}% │${r.gt5.toFixed(1).padStart(3)}%`);
}
console.log('');

console.log('── 2C: PCA Tier Performance (current: S top-10%, A 75-90%, B 55-75%, C 35-55%, D 15-35%, F bot-15%) ──\n');
printTable([
  ['S (top 10%)',    row(sorted.slice(0,Math.floor(n*0.1)))],
  ['A (10-25%)',     row(sorted.slice(Math.floor(n*0.1),Math.floor(n*0.25)))],
  ['B (25-45%)',     row(sorted.slice(Math.floor(n*0.25),Math.floor(n*0.45)))],
  ['C (45-65%)',     row(sorted.slice(Math.floor(n*0.45),Math.floor(n*0.65)))],
  ['D (65-85%)',     row(sorted.slice(Math.floor(n*0.65),Math.floor(n*0.85)))],
  ['F (bot 15%)',    row(sorted.slice(Math.floor(n*0.85)))],
],'PCA Tier');

console.log('── 2D: PCA Weight Grid Search — Optimal weights for 6 components ──\n');
// Test sign combinations and magnitudes
const zoneW=[0.02,0.06,-0.02];
const eraW=[-0.10,-0.16,-0.20,-0.25];
const vr20W=[-0.10,-0.19,-0.25,-0.30];
const p10W=[0.05,0.10,0.15,0.20];
const uwW=[-0.05,-0.10,-0.15,-0.20];
const pcaMeansG=[6.84,1.34,1.92,2.41,0.62,24.18];
const pcaStdsG=[4.92,0.58,1.41,2.05,0.21,14.62];
let bestPCA=[];
for(const zw of zoneW){
  for(const ew of eraW){
    for(const vw of vr20W){
      for(const pw of p10W){
        for(const uw2 of uwW){
          const newWeights=[zw,ew,vw,-0.07,pw,uw2];
          const scored=points.map(p=>{
            let sc=0;
            const raw=[p.zone_zt,p.eRA,p.vr20,p.vp5,p.pre10AvgRangeATR,p.upperWickPct];
            for(let k=0;k<6;k++) sc+=newWeights[k]*((raw[k]-pcaMeansG[k])/pcaStdsG[k]);
            return {p,sc};
          }).sort((a,b)=>b.sc-a.sc);
          const topQ=scored.slice(0,Math.floor(scored.length*0.25)).map(x=>x.p);
          const r=row(topQ); if(!r||r.n<30) continue;
          const rAll=row(scored.slice(Math.floor(scored.length*0.75)).map(x=>x.p));
          if(!rAll) continue;
          const spread=r.a20-(rAll.a20);
          bestPCA.push({zw,ew,vw,pw,uw2,topA20:r.a20,topWin:r.win,topGT5:r.gt5,spread});
        }
      }
    }
  }
}
const pcaMeans2=[6.84,1.34,1.92,2.41,0.62,24.18];
const pcaStds2=[4.92,0.58,1.41,2.05,0.21,14.62];
bestPCA.sort((a,b)=>b.topA20-a.topA20);
console.log('  Top-10 weight combos (top-25% vs bottom-25% spread):');
console.log('  Rk│  zt  │  eRA │  vr20│  p10R│   uw  │ TopAvg20d │ TopWin │ >5% │ Spread');
console.log('  ──┼──────┼──────┼──────┼──────┼───────┼───────────┼────────┼─────┼───────');
for(let i=0;i<Math.min(10,bestPCA.length);i++){
  const b=bestPCA[i];
  console.log(`  ${String(i+1).padStart(2)}│${b.zw.toFixed(2).padStart(5)} │${b.ew.toFixed(2).padStart(5)} │${b.vw.toFixed(2).padStart(5)} │${b.pw.toFixed(2).padStart(5)} │${b.uw2.toFixed(2).padStart(6)} │${fmtPct(b.topA20,10)} │ ${b.topWin.toFixed(1).padStart(5)}% │${b.topGT5.toFixed(1).padStart(4)}% │${fmtPct(b.spread,7)}`);
}
console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: STATS COMPOSITE
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'||SECTION==='stats'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 3: STATS COMPOSITE CALIBRATION                                     ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

console.log('── 3A: Stats Component Correlations (r vs fwd20d) ──\n');
console.log('  Component               │  r vs fwd20 │ Stars');
console.log('  ────────────────────────┼─────────────┼──────');
const statsFeatures=[
  ['rsi14 (raw)',         p=>p.rsi14v],
  ['cci34 (raw)',         p=>p.cci34v],
  ['hurstTrending',       p=>p.hurstTrending?1:0],
  ['hurstH (raw)',        p=>p.hurstV],
  ['ddFromHigh (inv)',    p=>-p.ddFromHigh],
  ['pctFromLow (raw)',    p=>p.pctFromLow],
  ['ttmSqueeze+momRise',  p=>(p.ttmSqueezeOn&&p.ttmMomRising)?1:0],
  ['bb_squeeze',          p=>p.bb_squeeze?1:0],
  ['bb_pctl (low=good)',  p=>-p.bb_pctl],
  ['keltSqueeze',         p=>p.keltSqueeze?1:0],
  ['dblSqueeze',          p=>(p.keltSqueeze&&p.bb_squeeze)?1:0],
  ['volZ',                p=>p.volZ],
  ['volZSig',             p=>p.volZSig?1:0],
  ['sharpe20',            p=>Math.min(p.sharpe20,8)],
  ['volSkew (>0.2=accum)',p=>p.volSkew],
  ['guppy_coiled',        p=>p.guppy_coiled?1:0],
  ['guppy_fan',           p=>p.guppy_fan?1:0],
  ['statsScore (0-100)',  p=>p.statsScore],
];
for(const [name,fn] of statsFeatures){
  const r=pearsonR(points.map(fn),fwd20);
  console.log(`  ${name.padEnd(26)}│  ${(r>=0?'+':'')+r.toFixed(4).padStart(7)}   │ ${stars(r)}`);
}
console.log('');

console.log('── 3B: Stats Score Tier Buckets ──\n');
printTable([
  ['0-14',     row(points.filter(p=>p.statsScore<=14))],
  ['15-24',    row(points.filter(p=>p.statsScore>=15&&p.statsScore<=24))],
  ['25-34',    row(points.filter(p=>p.statsScore>=25&&p.statsScore<=34))],
  ['35-44',    row(points.filter(p=>p.statsScore>=35&&p.statsScore<=44))],
  ['45-54',    row(points.filter(p=>p.statsScore>=45&&p.statsScore<=54))],
  ['55-64',    row(points.filter(p=>p.statsScore>=55&&p.statsScore<=64))],
  ['65-74',    row(points.filter(p=>p.statsScore>=65&&p.statsScore<=74))],
  ['75-84',    row(points.filter(p=>p.statsScore>=75&&p.statsScore<=84))],
  ['85+',      row(points.filter(p=>p.statsScore>=85))],
],'StatsScore bucket');

console.log('── 3C: RSI14 Fine Buckets (current scoring: ≥80→14pts, ≥70→9pts, ≥60→5pts, 50-60 unscored as worst) ──\n');
printTable([
  ['<30 (oversold)',     row(points.filter(p=>p.rsi14v<30))],
  ['30-45',             row(points.filter(p=>p.rsi14v>=30&&p.rsi14v<45))],
  ['45-55',             row(points.filter(p=>p.rsi14v>=45&&p.rsi14v<55))],
  ['55-60',             row(points.filter(p=>p.rsi14v>=55&&p.rsi14v<60))],
  ['60-65',             row(points.filter(p=>p.rsi14v>=60&&p.rsi14v<65))],
  ['65-70',             row(points.filter(p=>p.rsi14v>=65&&p.rsi14v<70))],
  ['70-75',             row(points.filter(p=>p.rsi14v>=70&&p.rsi14v<75))],
  ['75-80',             row(points.filter(p=>p.rsi14v>=75&&p.rsi14v<80))],
  ['80-85',             row(points.filter(p=>p.rsi14v>=80&&p.rsi14v<85))],
  ['85-90',             row(points.filter(p=>p.rsi14v>=85&&p.rsi14v<90))],
  ['≥90 (very hot)',    row(points.filter(p=>p.rsi14v>=90))],
],'RSI14 bucket');

console.log('── 3D: Hurst Exponent (current: >0.55 = trending = +12pts) ──\n');
printTable([
  ['<0.45 (mean-rev)',   row(points.filter(p=>p.hurstV<0.45))],
  ['0.45-0.50',          row(points.filter(p=>p.hurstV>=0.45&&p.hurstV<0.50))],
  ['0.50-0.55',          row(points.filter(p=>p.hurstV>=0.50&&p.hurstV<0.55))],
  ['0.55-0.60',          row(points.filter(p=>p.hurstV>=0.55&&p.hurstV<0.60))],
  ['0.60-0.65',          row(points.filter(p=>p.hurstV>=0.60&&p.hurstV<0.65))],
  ['0.65-0.70',          row(points.filter(p=>p.hurstV>=0.65&&p.hurstV<0.70))],
  ['≥0.70 (strong)',     row(points.filter(p=>p.hurstV>=0.70))],
],'Hurst Exponent');

console.log('── 3E: CCI34 Buckets (current: 150-300 sweet spot = +6pts) ──\n');
printTable([
  ['<-100 (oversold)',  row(points.filter(p=>p.cci34v<-100))],
  ['-100 to 0',        row(points.filter(p=>p.cci34v>=-100&&p.cci34v<0))],
  ['0-100',            row(points.filter(p=>p.cci34v>=0&&p.cci34v<100))],
  ['100-150',          row(points.filter(p=>p.cci34v>=100&&p.cci34v<150))],
  ['150-200',          row(points.filter(p=>p.cci34v>=150&&p.cci34v<200))],
  ['200-300',          row(points.filter(p=>p.cci34v>=200&&p.cci34v<300))],
  ['300-400',          row(points.filter(p=>p.cci34v>=300&&p.cci34v<400))],
  ['>400 (extreme)',   row(points.filter(p=>p.cci34v>=400))],
],'CCI34 bucket');

console.log('── 3F: Guppy Coiled Release (current: +8pts, cleanBullishFan +3pts) ──\n');
printTable([
  ['Neither',          row(points.filter(p=>!p.guppy_coiled&&!p.guppy_fan))],
  ['CleanFan only',    row(points.filter(p=>!p.guppy_coiled&&p.guppy_fan))],
  ['Coiled Release',   row(points.filter(p=>p.guppy_coiled))],
],'Guppy state');

console.log('── 3G: Grid Search — Optimal Stats Score threshold ──\n');
for(const t of [10,20,30,40,50,55,60,65,70,75]){
  const hi=row(points.filter(p=>p.statsScore>=t));
  const lo=row(points.filter(p=>p.statsScore<t));
  if(!hi||!lo||hi.n<30) continue;
  console.log(`  Score ≥${String(t).padStart(3)}: N=${String(hi.n).padStart(5)} │ Avg20d ${fmtPct(hi.a20)} | Win ${hi.win.toFixed(1)}% | >5% ${hi.gt5.toFixed(1)}% │ Edge vs below: ${fmtPct(hi.a20-lo.a20)}`);
}
console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: MONSTER MOVE v2
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'||SECTION==='monster'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 4: MONSTER MOVE DETECTOR v2 CALIBRATION                            ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

console.log('── 4A: MOM Badge Component Correlations ──\n');
const monFeatures=[
  ['mom5 (5d return)',       p=>Math.max(-20,Math.min(30,p.mom5))],
  ['eRA (range÷ATR)',        p=>p.eRA],
  ['vr20 (vol÷20avg)',       p=>Math.min(p.vr20,10)],
  ['atrPct (ADR%)',          p=>p.atrPct],
  ['aboveSMA50 (binary)',    p=>p.aboveSMA50?1:0],
  ['monMOM (all 5 ON)',      p=>p.monMOM?1:0],
];
console.log('  Feature             │  r vs fwd20 │ Stars');
console.log('  ──────────────────-─┼─────────────┼──────');
for(const [name,fn] of monFeatures){
  const r=pearsonR(points.map(fn),fwd20);
  console.log(`  ${name.padEnd(24)}│  ${(r>=0?'+':'')+r.toFixed(4).padStart(7)}   │ ${stars(r)}`);
}
console.log('');

console.log('── 4B: MOM Badge — mom5 Threshold Grid (current ≥7%) ──\n');
for(const t of [-5,-2,0,2,3,5,7,10,15,20,25]){
  const pts=points.filter(p=>p.mom5>=t);
  const r=row(pts); if(!r) continue;
  console.log(`  mom5 ≥${String(t).padStart(3)}%: N=${String(r.n).padStart(5)} │ Avg20d ${fmtPct(r.a20)} | Win ${r.win.toFixed(1)}% | >5% ${r.gt5.toFixed(1)}%`);
}
console.log('');

console.log('── 4C: MOM Badge — ATR% Threshold Grid (current ≥4.5%) ──\n');
for(const t of [2.0,2.5,3.0,3.5,4.0,4.5,5.0,5.5,6.0,7.0]){
  const pts=points.filter(p=>p.atrPct>=t&&p.mom5>=7&&p.eRA>=1.2&&p.vr20>=1.0&&p.aboveSMA50);
  const r=row(pts); if(!r||r.n<15) continue;
  console.log(`  atrPct ≥${t.toFixed(1)}%: N=${String(r.n).padStart(4)} │ Avg20d ${fmtPct(r.a20)} | Win ${r.win.toFixed(1)}% | >5% ${r.gt5.toFixed(1)}%`);
}
console.log('');

console.log('── 4D: MOM Badge Full Grid Search (optimizing Avg20d) ──\n');
const mom5Thresh=[3,5,7,10];
const eRAThresh=[1.0,1.2,1.5];
const vr20Thresh=[0.8,1.0,1.2];
const atrThresh=[3.0,3.5,4.0,4.5,5.0];
let monCombos=[];
for(const mt of mom5Thresh){
  for(const et of eRAThresh){
    for(const vt of vr20Thresh){
      for(const at of atrThresh){
        const pts=points.filter(p=>p.mom5>=mt&&p.eRA>=et&&p.vr20>=vt&&p.atrPct>=at&&p.aboveSMA50);
        const r=row(pts); if(!r||r.n<20) continue;
        monCombos.push({mt,et,vt,at,n:r.n,a20:r.a20,mfe:r.mfe,gt5:r.gt5,win:r.win});
      }
    }
  }
}
monCombos.sort((a,b)=>b.a20-a.a20);
console.log('  Rk│mom5≥│eRA≥│vr20≥│atr≥│  N  │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ──┼─────┼────┼─────┼────┼─────┼────────┼───────┼──────┼────');
for(let i=0;i<Math.min(12,monCombos.length);i++){
  const b=monCombos[i];
  console.log(`  ${String(i+1).padStart(2)}│  ${String(b.mt).padStart(3)}│${b.et.toFixed(1).padStart(4)}│ ${b.vt.toFixed(1).padStart(3)} │${b.at.toFixed(1).padStart(4)}│${String(b.n).padStart(5)}│${fmtPct(b.a20)} │${fmtPct(b.mfe,6)} │${b.win.toFixed(1).padStart(4)}% │${b.gt5.toFixed(1).padStart(3)}%`);
}
console.log('');

console.log('── 4E: MRV Badge (current: swingDist≤-30%, rsi2≤60, pre10VR≤0.3) ──\n');
const mrv=row(points.filter(p=>p.monMRV));
const noMrv=row(points.filter(p=>!p.monMRV));
if(mrv) console.log(`  MRV ON : N=${mrv.n} | Avg20d ${fmtPct(mrv.a20)} | MFE ${fmtPct(mrv.mfe)} | Win ${mrv.win.toFixed(1)}% | >5% ${mrv.gt5.toFixed(1)}%`);
if(noMrv) console.log(`  MRV OFF: N=${noMrv.n} | Avg20d ${fmtPct(noMrv.a20)} | MFE ${fmtPct(noMrv.mfe)} | Win ${noMrv.win.toFixed(1)}%\n`);

console.log('── 4F: swingDist from 50-bar high (current MRV requires ≤-30%) ──\n');
printTable([
  ['>+5% (above high)',     row(points.filter(p=>p.swingDist>5))],
  ['0 to +5%',             row(points.filter(p=>p.swingDist>=0&&p.swingDist<=5))],
  ['-5 to 0%',             row(points.filter(p=>p.swingDist>=-5&&p.swingDist<0))],
  ['-15 to -5%',           row(points.filter(p=>p.swingDist>=-15&&p.swingDist<-5))],
  ['-30 to -15%',          row(points.filter(p=>p.swingDist>=-30&&p.swingDist<-15))],
  ['<-30% (depressed)',    row(points.filter(p=>p.swingDist<-30))],
],'swingDist from 50H');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: CANDLE DNA (NEW FORMULA VALIDATION)
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'||SECTION==='dna'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 5: CANDLE DNA FORMULA VALIDATION                                   ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

// New formula
function newDNAScore(p){
  let uq=0;
  if(p.upperWickATR<0.05) uq=40;
  else if(p.upperWickATR<0.10) uq=28;
  else if(p.upperWickATR<0.15) uq=18;
  else if(p.upperWickATR<0.25) uq=10;
  else if(p.upperWickATR<0.50) uq=4;
  let cq=0;
  if(p.avgCL3>85) cq=35;
  else if(p.avgCL3>75) cq=28;
  else if(p.avgCL3>65) cq=20;
  else if(p.avgCL3>55) cq=12;
  else if(p.avgCL3>45) cq=5;
  let st=0;
  if(p.lowerWickATR>0.40) st=25;
  else if(p.lowerWickATR>0.25) st=18;
  else if(p.lowerWickATR>0.15) st=12;
  else if(p.lowerWickATR>0.08) st=6;
  return Math.min(100,uq+cq+st);
}

// Old formula
function oldDNAScore(p){
  let bs=p.bodyATR>=1.5?35:p.bodyATR>=1.0?26:p.bodyATR>=0.6?16:p.bodyATR>=0.3?6:0;
  let wc=(p.ULRatio<=0.5?18:p.ULRatio<=1.0?11:p.ULRatio<=2.0?5:0)+(p.marubozuScore>=80?17:p.marubozuScore>=70?11:p.marubozuScore>=55?5:0);
  let re=p.eRA>=2.0?30:p.eRA>=1.5?22:p.eRA>=1.0?13:p.eRA>=0.6?5:0;
  return Math.min(100,bs+wc+re);
}

console.log('── 5A: Old vs New Formula Tier Comparison ──\n');
printTable([
  ['OLD WEAK (<35)',    row(points.filter(p=>oldDNAScore(p)<35))],
  ['OLD GOOD (35-54)', row(points.filter(p=>oldDNAScore(p)>=35&&oldDNAScore(p)<55))],
  ['OLD STRONG (55-74)',row(points.filter(p=>oldDNAScore(p)>=55&&oldDNAScore(p)<75))],
  ['OLD ELITE (75+)',  row(points.filter(p=>oldDNAScore(p)>=75))],
],'Old Formula Tier');
printTable([
  ['NEW WEAK (<35)',    row(points.filter(p=>newDNAScore(p)<35))],
  ['NEW GOOD (35-54)', row(points.filter(p=>newDNAScore(p)>=35&&newDNAScore(p)<55))],
  ['NEW STRONG (55-74)',row(points.filter(p=>newDNAScore(p)>=55&&newDNAScore(p)<75))],
  ['NEW ELITE (75+)',  row(points.filter(p=>newDNAScore(p)>=75))],
],'New Formula Tier');

console.log('── 5B: upperWickATR Fine Buckets — find exact tier boundaries ──\n');
printTable([
  ['<0.02',     row(points.filter(p=>p.upperWickATR<0.02))],
  ['0.02-0.05', row(points.filter(p=>p.upperWickATR>=0.02&&p.upperWickATR<0.05))],
  ['0.05-0.08', row(points.filter(p=>p.upperWickATR>=0.05&&p.upperWickATR<0.08))],
  ['0.08-0.12', row(points.filter(p=>p.upperWickATR>=0.08&&p.upperWickATR<0.12))],
  ['0.12-0.18', row(points.filter(p=>p.upperWickATR>=0.12&&p.upperWickATR<0.18))],
  ['0.18-0.25', row(points.filter(p=>p.upperWickATR>=0.18&&p.upperWickATR<0.25))],
  ['0.25-0.40', row(points.filter(p=>p.upperWickATR>=0.25&&p.upperWickATR<0.40))],
  ['0.40-0.60', row(points.filter(p=>p.upperWickATR>=0.40&&p.upperWickATR<0.60))],
  ['0.60-1.00', row(points.filter(p=>p.upperWickATR>=0.60&&p.upperWickATR<1.00))],
  ['≥1.00',     row(points.filter(p=>p.upperWickATR>=1.00))],
],'upperWickATR');

console.log('── 5C: lowerWickATR Fine Buckets ──\n');
printTable([
  ['<0.03',     row(points.filter(p=>p.lowerWickATR<0.03))],
  ['0.03-0.08', row(points.filter(p=>p.lowerWickATR>=0.03&&p.lowerWickATR<0.08))],
  ['0.08-0.15', row(points.filter(p=>p.lowerWickATR>=0.08&&p.lowerWickATR<0.15))],
  ['0.15-0.25', row(points.filter(p=>p.lowerWickATR>=0.15&&p.lowerWickATR<0.25))],
  ['0.25-0.40', row(points.filter(p=>p.lowerWickATR>=0.25&&p.lowerWickATR<0.40))],
  ['0.40-0.60', row(points.filter(p=>p.lowerWickATR>=0.40&&p.lowerWickATR<0.60))],
  ['≥0.60',     row(points.filter(p=>p.lowerWickATR>=0.60))],
],'lowerWickATR');

console.log('── 5D: avgCL3 Fine Buckets ──\n');
printTable([
  ['<40',      row(points.filter(p=>p.avgCL3<40))],
  ['40-50',    row(points.filter(p=>p.avgCL3>=40&&p.avgCL3<50))],
  ['50-55',    row(points.filter(p=>p.avgCL3>=50&&p.avgCL3<55))],
  ['55-60',    row(points.filter(p=>p.avgCL3>=55&&p.avgCL3<60))],
  ['60-65',    row(points.filter(p=>p.avgCL3>=60&&p.avgCL3<65))],
  ['65-70',    row(points.filter(p=>p.avgCL3>=65&&p.avgCL3<70))],
  ['70-75',    row(points.filter(p=>p.avgCL3>=70&&p.avgCL3<75))],
  ['75-80',    row(points.filter(p=>p.avgCL3>=75&&p.avgCL3<80))],
  ['80-85',    row(points.filter(p=>p.avgCL3>=80&&p.avgCL3<85))],
  ['>85',      row(points.filter(p=>p.avgCL3>=85))],
],'avgCL3 (3-candle close loc)');

console.log('── 5E: SWEET SPOT COMBINATION — optimal DNA filter ──\n');
const dnaThresholds=[
  [0.05, 0.08, 65], [0.05, 0.10, 65], [0.05, 0.12, 60],
  [0.08, 0.08, 65], [0.08, 0.10, 60], [0.10, 0.10, 60],
  [0.08, 0.15, 55], [0.10, 0.15, 55], [0.12, 0.15, 55],
];
let dnaCombos=[];
for(const [uwMax,lwMin,clMin] of dnaThresholds){
  const pts=points.filter(p=>p.upperWickATR<=uwMax&&p.lowerWickATR>=lwMin&&p.avgCL3>=clMin);
  const r=row(pts); if(!r||r.n<20) continue;
  dnaCombos.push({uwMax,lwMin,clMin,n:r.n,a20:r.a20,mfe:r.mfe,gt5:r.gt5,win:r.win});
}
dnaCombos.sort((a,b)=>b.a20-a.a20);
console.log('  Rk│uw≤  │lw≥  │cl≥│  N  │ Avg20d │  MFE  │ Win% │ >5%');
console.log('  ──┼─────┼─────┼───┼─────┼────────┼───────┼──────┼────');
for(let i=0;i<Math.min(10,dnaCombos.length);i++){
  const b=dnaCombos[i];
  console.log(`  ${String(i+1).padStart(2)}│${b.uwMax.toFixed(2).padStart(4)} │${b.lwMin.toFixed(2).padStart(4)} │${String(b.clMin).padStart(3)}│${String(b.n).padStart(5)}│${fmtPct(b.a20)} │${fmtPct(b.mfe,6)} │${b.win.toFixed(1).padStart(4)}% │${b.gt5.toFixed(1).padStart(3)}%`);
}
console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: CROSS-FEATURE SWEET SPOT — ALL 5 COMBINED
// ════════════════════════════════════════════════════════════════════════════
if(SECTION==='all'){
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  SECTION 6: CROSS-FEATURE SWEET SPOT — ALL 5 COMBINED                       ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

function newDNATier(p){const s=newDNAScore(p);return s>=75?'ELITE':s>=55?'STRONG':s>=35?'GOOD':'WEAK';}

// Top half of each feature
const topMom=p=>p.momScore>=45;
const topPCA=p=>p.pcaScore>0; // above median
const topStats=p=>p.statsScore>=40;
const topMonster=p=>p.monMOM||p.monMRV;
const topDNA=p=>newDNATier(p)==='ELITE'||newDNATier(p)==='STRONG';

printTable([
  ['All 5 top',       row(points.filter(p=>topMom(p)&&topPCA(p)&&topStats(p)&&topMonster(p)&&topDNA(p)))],
  ['4 of 5 (no mom)', row(points.filter(p=>!topMom(p)&&topPCA(p)&&topStats(p)&&topMonster(p)&&topDNA(p)))],
  ['4 of 5 (no pca)', row(points.filter(p=>topMom(p)&&!topPCA(p)&&topStats(p)&&topMonster(p)&&topDNA(p)))],
  ['4 of 5 (no stats)',row(points.filter(p=>topMom(p)&&topPCA(p)&&!topStats(p)&&topMonster(p)&&topDNA(p)))],
  ['4 of 5 (no mon)', row(points.filter(p=>topMom(p)&&topPCA(p)&&topStats(p)&&!topMonster(p)&&topDNA(p)))],
  ['4 of 5 (no dna)', row(points.filter(p=>topMom(p)&&topPCA(p)&&topStats(p)&&topMonster(p)&&!topDNA(p)))],
  ['Mom+Stats+DNA',   row(points.filter(p=>topMom(p)&&topStats(p)&&topDNA(p)))],
  ['Mom+PCA+DNA',     row(points.filter(p=>topMom(p)&&topPCA(p)&&topDNA(p)))],
  ['Stats+DNA',       row(points.filter(p=>topStats(p)&&topDNA(p)))],
  ['None of 5',       row(points.filter(p=>!topMom(p)&&!topPCA(p)&&!topStats(p)&&!topMonster(p)&&!topDNA(p)))],
],'Feature Combination');

// Final consolidated sweet spot definition
console.log('── Summary: Signal detection rates ──\n');
console.log(`  Total signals: ${points.length.toLocaleString()} (1,617 stocks × breakout context)`);
console.log(`  MomScore ≥45:  ${points.filter(topMom).length} (${(points.filter(topMom).length/points.length*100).toFixed(1)}%)`);
console.log(`  PCA above med: ${points.filter(topPCA).length} (${(points.filter(topPCA).length/points.length*100).toFixed(1)}%)`);
console.log(`  Stats ≥40:     ${points.filter(topStats).length} (${(points.filter(topStats).length/points.length*100).toFixed(1)}%)`);
console.log(`  Monster badge: ${points.filter(topMonster).length} (${(points.filter(topMonster).length/points.length*100).toFixed(1)}%)`);
console.log(`  DNA Strong+:   ${points.filter(topDNA).length} (${(points.filter(topDNA).length/points.length*100).toFixed(1)}%)`);
console.log(`  ALL 5:         ${points.filter(p=>topMom(p)&&topPCA(p)&&topStats(p)&&topMonster(p)&&topDNA(p)).length} (${(points.filter(p=>topMom(p)&&topPCA(p)&&topStats(p)&&topMonster(p)&&topDNA(p)).length/points.length*100).toFixed(1)}%)\n`);
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  CALIBRATION 2 COMPLETE — apply findings to stockEngine.ts + statsEngine.ts');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');
