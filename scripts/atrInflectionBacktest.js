// ATR Percentile + Inflection Candle Deep Backtest
// Finds the EXACT ATR compression zone where explosive momentum starts
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const c = [];
  for (let i=1;i<lines.length;i++){
    const [date,o,h,l,cl,v]=lines[i].split(',');
    const [d,m,y]=date.split('-');
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v});
  }
  return c;
}

function computeATR14(candles) {
  const a=new Array(candles.length).fill(0);
  if(candles.length<15)return a;
  let s=0;
  for(let i=1;i<=14;i++) s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
  a[14]=s/14;
  for(let i=15;i<candles.length;i++){
    const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
    a[i]=(a[i-1]*13+tr)/14;
  }
  return a;
}

function percentileRank(window, value) {
  if(window.length===0)return 50;
  return (window.filter(v=>v<value).length/window.length)*100;
}

// Collect ALL candles with computed features
const allCandles = [];

for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 150) continue;
  const sym = file.replace('_NS_OHLCV.csv','');
  const atr = computeATR14(candles);

  for (let i = 140; i < candles.length - 11; i++) {
    const sig = candles[i], prev = candles[i-1];
    if (sig.c <= 0 || atr[i] <= 0) continue;
    const r = sig.h - sig.l;
    if (r <= 0) continue;

    // ATR% and percentile
    const atrPct = (atr[i]/sig.c)*100;
    const atrPctPrev = (atr[i-1]/prev.c)*100;

    // ATR percentile over prior 120 candles (PRE-signal = use i-1)
    const window120 = [];
    for (let j = Math.max(14, i-121); j < i-1; j++) {
      if (candles[j].c > 0 && atr[j] > 0) window120.push((atr[j]/candles[j].c)*100);
    }
    const preSignalAtrPctl = percentileRank(window120, atrPctPrev);

    // Signal candle features
    const rangeATR = r / atr[i];
    const closeLoc = (sig.c - sig.l) / r * 100;
    const bodyPct = Math.abs(sig.c - sig.o) / r * 100;
    const uwPct = (sig.h - Math.max(sig.o, sig.c)) / r * 100;

    // Pre-10 avg range ATR
    let pre10Sum=0,pre10Cnt=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;const tr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));pre10Sum+=tr/atr[j];pre10Cnt++;}
    const pre10AvgRangeATR = pre10Cnt>0?pre10Sum/pre10Cnt:1;
    const volExpRatio = pre10AvgRangeATR>0?rangeATR/pre10AvgRangeATR:1;

    // Volume features
    let v20Sum=0; for(let j=Math.max(0,i-20);j<i;j++) v20Sum+=candles[j].v;
    const volAvg20=v20Sum/Math.max(i-Math.max(0,i-20),1);
    const volRatio20=volAvg20>0?sig.v/volAvg20:0;
    let v5Sum=0; for(let j=Math.max(0,i-5);j<i;j++) v5Sum+=candles[j].v;
    const volVsPre5=(v5Sum/Math.max(i-Math.max(0,i-5),1))>0?sig.v/(v5Sum/Math.max(i-Math.max(0,i-5),1)):0;

    // Pre-10 red volume bias
    let redVol=0,greenVol=0;
    for(let j=i-10;j<i;j++){if(j<0)continue;if(candles[j].c<candles[j].o)redVol+=candles[j].v;else greenVol+=candles[j].v;}
    const redVolBias=greenVol>0?redVol/greenVol:(redVol>0?10:1);

    // Compression check
    let compressed=true;
    for(let j=i-6;j<i;j++){if(j<1){compressed=false;break;}const pTr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));if(pTr/atr[j]>1.0){compressed=false;break;}}

    // Zone
    let zH=-Infinity,zL=Infinity;
    for(let j=i-6;j<i;j++){if(j<0)continue;zH=Math.max(zH,candles[j].h);zL=Math.min(zL,candles[j].l);}
    const breakout = sig.c > zH * 1.001;
    const closeAboveZonePct = zH>0?((sig.c-zH)/zH)*100:0;
    const isGreen = sig.c > sig.o;

    // Future MFE/MAE (10 days)
    let mfe=0, mae=0, hit5=false, daysTo5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){
      const pct=(candles[d].h-sig.c)/sig.c*100;
      const drop=(candles[d].l-sig.c)/sig.c*100;
      if(pct>mfe)mfe=pct;
      if(drop<mae)mae=drop;
      if(!hit5&&pct>=5){hit5=true;daysTo5=d-i;}
    }

    allCandles.push({sym,i,preSignalAtrPctl,atrPct,rangeATR,closeLoc,bodyPct,uwPct,
      volRatio20,volVsPre5,volExpRatio,pre10AvgRangeATR,redVolBias,
      compressed,breakout,closeAboveZonePct,isGreen,mfe,mae,hit5,daysTo5});
  }
}

console.log(`Total candles analyzed: ${allCandles.length}\n`);

// ═══ TEST 1: ATR Percentile ranges (all candles) ═══
console.log('=== ATR PERCENTILE vs +5% HIT RATE (all candles) ===');
const pctlRanges = [[0,10],[10,20],[20,30],[30,40],[40,50],[50,60],[60,70],[70,80],[80,90],[90,100]];
console.log('ATR Pctl  | Count  | +5% Hit | Hit Rate | Avg MFE  | Avg MAE');
for(const [lo,hi] of pctlRanges){
  const subset=allCandles.filter(c=>c.preSignalAtrPctl>=lo&&c.preSignalAtrPctl<hi);
  const hits=subset.filter(c=>c.hit5);
  const avgMfe=subset.length>0?subset.reduce((s,c)=>s+c.mfe,0)/subset.length:0;
  const avgMae=subset.length>0?subset.reduce((s,c)=>s+c.mae,0)/subset.length:0;
  console.log(`${lo}-${hi}`.padEnd(9)+` | ${String(subset.length).padStart(6)} | ${String(hits.length).padStart(7)} | ${subset.length>0?(hits.length/subset.length*100).toFixed(1)+'%':'—'.padStart(8)} | ${avgMfe.toFixed(2).padStart(8)}% | ${avgMae.toFixed(2)}%`);
}

// ═══ TEST 2: Compression breakout candles only ═══
console.log('\n=== COMPRESSION BREAKOUT CANDLES + ATR PERCENTILE ===');
const breakouts=allCandles.filter(c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=60);
console.log(`Breakout candles: ${breakouts.length}\n`);
console.log('ATR Pctl  | Count | +5% Hit | Rate   | Avg MFE | AvgDays5');
for(const [lo,hi] of [[20,40],[30,50],[40,60],[50,70],[60,80],[65,85],[65,95],[70,90],[70,95],[40,95]]){
  const sub=breakouts.filter(c=>c.preSignalAtrPctl>=lo&&c.preSignalAtrPctl<hi);
  const hits=sub.filter(c=>c.hit5);
  const avgMfe=sub.length>0?sub.reduce((s,c)=>s+c.mfe,0)/sub.length:0;
  const avgDays=hits.length>0?hits.reduce((s,c)=>s+c.daysTo5,0)/hits.length:0;
  console.log(`${lo}-${hi}`.padEnd(9)+` | ${String(sub.length).padStart(5)} | ${String(hits.length).padStart(7)} | ${sub.length>0?(hits.length/sub.length*100).toFixed(1)+'%':'—'.padStart(6)} | ${avgMfe.toFixed(1).padStart(7)}% | ${avgDays.toFixed(1)}`);
}

// ═══ TEST 3: Best inflection candle profile (breakout + volume + candle quality) ═══
console.log('\n=== INFLECTION CANDLE PROFILES ===');
const profiles = [
  {name:'Base breakout', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=60},
  {name:'+ closeLoc>=70', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=70},
  {name:'+ body>=35 wick<=35', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35},
  {name:'+ volVsPre5>=2', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35&&c.volVsPre5>=2.0},
  {name:'+ volRatio20>=2', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35&&c.volVsPre5>=2.0&&c.volRatio20>=2.0},
  {name:'+ redVolBias<=0.8', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35&&c.volVsPre5>=2.0&&c.volRatio20>=2.0&&c.redVolBias<=0.8},
  {name:'+ ATR pctl 40-95', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35&&c.volVsPre5>=2.0&&c.volRatio20>=2.0&&c.redVolBias<=0.8&&c.preSignalAtrPctl>=40&&c.preSignalAtrPctl<=95},
  {name:'+ volExp>=1.5 rng2-5', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=2.0&&c.rangeATR<=5.0&&c.closeLoc>=60&&c.bodyPct>=30&&c.uwPct<=40&&c.volVsPre5>=2.25&&c.volRatio20>=1.8&&c.redVolBias<=0.9&&c.preSignalAtrPctl>=40&&c.preSignalAtrPctl<=95&&c.volExpRatio>=1.5},
  {name:'ULTRA(v4 params)', fn:c=>c.compressed&&c.breakout&&c.rangeATR>=2.0&&c.rangeATR<=5.0&&c.closeLoc>=60&&c.bodyPct>=30&&c.uwPct<=40&&c.volVsPre5>=2.25&&c.volRatio20>=1.8&&c.redVolBias<=0.9&&c.preSignalAtrPctl>=40&&c.preSignalAtrPctl<=95&&c.volExpRatio>=1.5&&c.atrPct>=4.0&&c.atrPct<=8.0},
];

console.log('Profile                  | Count | +5%Hit | Rate   | AvgMFE  | AvgMAE  | AvgDays');
for(const p of profiles){
  const sub=allCandles.filter(p.fn);
  const hits=sub.filter(c=>c.hit5);
  const avgMfe=sub.length>0?sub.reduce((s,c)=>s+c.mfe,0)/sub.length:0;
  const avgMae=sub.length>0?sub.reduce((s,c)=>s+c.mae,0)/sub.length:0;
  const avgDays=hits.length>0?hits.reduce((s,c)=>s+c.daysTo5,0)/hits.length:0;
  console.log(`${p.name.padEnd(24)} | ${String(sub.length).padStart(5)} | ${String(hits.length).padStart(6)} | ${sub.length>0?(hits.length/sub.length*100).toFixed(1)+'%':'—'.padStart(6)} | ${avgMfe.toFixed(1).padStart(7)}% | ${avgMae.toFixed(1).padStart(7)}% | ${avgDays.toFixed(1)}`);
}

// ═══ TEST 4: Fine-grid ATR percentile for best profile ═══
console.log('\n=== FINE-GRID ATR PCTL SWEEP (best candle profile) ===');
const bestFilter = c=>c.compressed&&c.breakout&&c.rangeATR>=1.0&&c.closeLoc>=65&&c.bodyPct>=35&&c.uwPct<=35&&c.volVsPre5>=2.0&&c.volRatio20>=1.8&&c.redVolBias<=0.9;
const filtered = allCandles.filter(bestFilter);
console.log(`Filtered candles: ${filtered.length}\n`);
console.log('ATR Pctl   | Count | +5%Hit | Rate   | AvgMFE | AvgDays');
for(let lo=20;lo<=80;lo+=5){
  for(const hi of [lo+30,lo+40,lo+50,95]){
    if(hi>100)continue;
    const sub=filtered.filter(c=>c.preSignalAtrPctl>=lo&&c.preSignalAtrPctl<=hi);
    if(sub.length<5)continue;
    const hits=sub.filter(c=>c.hit5);
    const avgMfe=sub.length>0?sub.reduce((s,c)=>s+c.mfe,0)/sub.length:0;
    const avgDays=hits.length>0?hits.reduce((s,c)=>s+c.daysTo5,0)/hits.length:0;
    const rate=sub.length>0?(hits.length/sub.length*100).toFixed(1):'0';
    if(+rate>=60) console.log(`${lo}-${hi}`.padEnd(10)+` | ${String(sub.length).padStart(5)} | ${String(hits.length).padStart(6)} | ${rate.padStart(5)}% | ${avgMfe.toFixed(1).padStart(6)}% | ${avgDays.toFixed(1)}`);
  }
}
