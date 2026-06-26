// REGIME DETECTION + INDIA VIX BACKTEST
// Tests: MF without VIX vs MF with VIX (multiple VIX integration methods)
// 10 years of Nifty 50 + India VIX daily data

const fs=require('fs');

// Load Nifty
const nLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv','utf8').trim().split('\n');
const nifty=[];for(let i=1;i<nLines.length;i++){const[date,o,h,l,c,v]=nLines[i].split(',');nifty.push({date,o:+o,h:+h,l:+l,c:+c,v:+v});}

// Load VIX
const vLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/indiavix_daily.csv','utf8').trim().split('\n');
const vixMap={};for(let i=1;i<vLines.length;i++){const[date,o,h,l,c]=vLines[i].split(',');vixMap[date]={vix:+c,vixH:+h,vixL:+l,vixO:+o};}

// Merge
const merged=nifty.map(n=>({...n,vix:vixMap[n.date]?.vix||null,vixH:vixMap[n.date]?.vixH||null,vixL:vixMap[n.date]?.vixL||null})).filter(m=>m.vix!==null);
console.log(`Merged data: ${merged.length} days with both Nifty + VIX\n`);

// VIX statistics
const vixArr=merged.map(m=>m.vix);
const vixMean=vixArr.reduce((s,v)=>s+v,0)/vixArr.length;
const vixStd=Math.sqrt(vixArr.reduce((s,v)=>s+(v-vixMean)**2,0)/vixArr.length);
console.log(`VIX Stats: Mean=${vixMean.toFixed(2)} Std=${vixStd.toFixed(2)} Min=${Math.min(...vixArr).toFixed(2)} Max=${Math.max(...vixArr).toFixed(2)} Current=${vixArr[vixArr.length-1].toFixed(2)}\n`);

// VIX regime zones (from Indian market research)
console.log('═══ VIX REGIME ZONES (India-specific) ═══\n');
const vixZones=[
  {name:'Deep Complacency',lo:0,hi:12,meaning:'Extremely low fear — potential complacency top',color:'🟡'},
  {name:'Low Fear',lo:12,hi:16,meaning:'Normal bull market conditions',color:'🟢'},
  {name:'Moderate',lo:16,hi:22,meaning:'Healthy caution — typical market',color:'🟢'},
  {name:'Elevated',lo:22,hi:30,meaning:'Rising anxiety — correction possible',color:'🟡'},
  {name:'High Fear',lo:30,hi:45,meaning:'Significant stress — bear market conditions',color:'🔴'},
  {name:'Extreme Panic',lo:45,hi:100,meaning:'Capitulation — contrarian buy zone',color:'💀'},
];
for(const z of vixZones){
  const count=vixArr.filter(v=>v>=z.lo&&v<z.hi).length;
  console.log(`  ${z.color} ${z.name.padEnd(20)} VIX ${z.lo}-${z.hi}: ${count} days (${(count/vixArr.length*100).toFixed(1)}%) — ${z.meaning}`);
}

// ═══ BASE: Multi-Factor WITHOUT VIX ═══
function mfBase(data){
  const results=[];
  for(let i=50;i<data.length;i++){
    const c=data[i];
    const ret20=(c.c-data[i-20].c)/data[i-20].c*100;
    let greenDays=0;for(let j=i-19;j<=i;j++)if(data[j].c>data[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-retMean)**2,0)/rets.length);
    const ret10a=(data[i].c-data[i-10].c)/data[i-10].c*100;
    const ret10b=(data[i-10].c-data[i-20].c)/data[i-20].c*100;
    const accel=ret10a-ret10b;
    let e200=data[0].c;for(let j=1;j<=i;j++)e200=data[j].c*(2/201)+e200*(1-2/201);
    const distEma200=((c.c-e200)/e200)*100;
    const rets50=[];for(let j=i-49;j<=i;j++)rets50.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const vol50=Math.sqrt(rets50.reduce((s,v)=>s+(v-rets50.reduce((a,b)=>a+b,0)/50)**2,0)/50);
    const volRatio=vol50>0?vol/vol50:1;

    let score=0;
    if(ret20>5)score+=25;else if(ret20>2)score+=15;else if(ret20>0)score+=5;else if(ret20>-2)score+=-5;else if(ret20>-5)score+=-15;else score+=-25;
    if(breadth>60)score+=20;else if(breadth>52)score+=10;else if(breadth>45)score+=-5;else if(breadth>38)score+=-15;else score+=-20;
    if(vol<0.8)score+=15;else if(vol<1.2)score+=8;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-8;else score+=-15;
    if(accel>2)score+=15;else if(accel>0.5)score+=8;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-8;else score+=-15;
    if(distEma200>5)score+=15;else if(distEma200>0)score+=8;else if(distEma200>-3)score+=-5;else if(distEma200>-8)score+=-10;else score+=-15;
    if(volRatio<0.8)score+=10;else if(volRatio>1.3)score+=-10;else score+=0;

    let state,sizing;
    if(score>=40){state='strong_bull';sizing=1.25;}
    else if(score>=15){state='bull';sizing=1.0;}
    else if(score>=-15){state='neutral';sizing=0.75;}
    else if(score>=-40){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}
    results.push({date:c.date,state,score,sizing,close:c.c,vix:c.vix});
  }
  return results;
}

// ═══ METHOD A: MF + VIX Level Factor ═══
function mfVixLevel(data){
  const results=[];
  for(let i=50;i<data.length;i++){
    const c=data[i];
    const ret20=(c.c-data[i-20].c)/data[i-20].c*100;
    let greenDays=0;for(let j=i-19;j<=i;j++)if(data[j].c>data[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-retMean)**2,0)/rets.length);
    const accel=((data[i].c-data[i-10].c)/data[i-10].c*100)-((data[i-10].c-data[i-20].c)/data[i-20].c*100);
    let e200=data[0].c;for(let j=1;j<=i;j++)e200=data[j].c*(2/201)+e200*(1-2/201);
    const distEma200=((c.c-e200)/e200)*100;
    const rets50=[];for(let j=i-49;j<=i;j++)rets50.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const vol50=Math.sqrt(rets50.reduce((s,v)=>s+(v-rets50.reduce((a,b)=>a+b,0)/50)**2,0)/50);
    const volRatio=vol50>0?vol/vol50:1;

    let score=0;
    if(ret20>5)score+=20;else if(ret20>2)score+=12;else if(ret20>0)score+=4;else if(ret20>-2)score+=-4;else if(ret20>-5)score+=-12;else score+=-20;
    if(breadth>60)score+=18;else if(breadth>52)score+=9;else if(breadth>45)score+=-4;else if(breadth>38)score+=-12;else score+=-18;
    if(vol<0.8)score+=12;else if(vol<1.2)score+=6;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-6;else score+=-12;
    if(accel>2)score+=12;else if(accel>0.5)score+=6;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-6;else score+=-12;
    if(distEma200>5)score+=12;else if(distEma200>0)score+=6;else if(distEma200>-3)score+=-4;else if(distEma200>-8)score+=-8;else score+=-12;
    if(volRatio<0.8)score+=8;else if(volRatio>1.3)score+=-8;else score+=0;

    // VIX FACTOR (weight: 18 — significant but not dominant)
    const vix=c.vix;
    if(vix<12)score+=10; // complacency — slightly bullish but watch for reversal
    else if(vix<16)score+=18; // low fear — ideal bull conditions
    else if(vix<22)score+=8; // moderate — normal
    else if(vix<30)score+=-8; // elevated — caution
    else if(vix<45)score+=-18; // high fear — bearish
    else score+=5; // extreme panic — CONTRARIAN bullish (capitulation buy)

    let state,sizing;
    if(score>=40){state='strong_bull';sizing=1.25;}
    else if(score>=15){state='bull';sizing=1.0;}
    else if(score>=-15){state='neutral';sizing=0.75;}
    else if(score>=-40){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}
    results.push({date:c.date,state,score,sizing,close:c.c,vix});
  }
  return results;
}

// ═══ METHOD B: MF + VIX Trend (rate of change) ═══
function mfVixTrend(data){
  const results=[];
  for(let i=50;i<data.length;i++){
    const c=data[i];
    // Same base factors...
    const ret20=(c.c-data[i-20].c)/data[i-20].c*100;
    let greenDays=0;for(let j=i-19;j<=i;j++)if(data[j].c>data[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-retMean)**2,0)/rets.length);
    const accel=((data[i].c-data[i-10].c)/data[i-10].c*100)-((data[i-10].c-data[i-20].c)/data[i-20].c*100);
    let e200=data[0].c;for(let j=1;j<=i;j++)e200=data[j].c*(2/201)+e200*(1-2/201);
    const distEma200=((c.c-e200)/e200)*100;

    let score=0;
    if(ret20>5)score+=20;else if(ret20>2)score+=12;else if(ret20>0)score+=4;else if(ret20>-2)score+=-4;else if(ret20>-5)score+=-12;else score+=-20;
    if(breadth>60)score+=18;else if(breadth>52)score+=9;else if(breadth>45)score+=-4;else if(breadth>38)score+=-12;else score+=-18;
    if(vol<0.8)score+=12;else if(vol<1.2)score+=6;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-6;else score+=-12;
    if(accel>2)score+=12;else if(accel>0.5)score+=6;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-6;else score+=-12;
    if(distEma200>5)score+=12;else if(distEma200>0)score+=6;else if(distEma200>-3)score+=-4;else score+=-12;

    // VIX Level (weight: 10)
    const vix=c.vix;
    if(vix<12)score+=6;else if(vix<16)score+=10;else if(vix<22)score+=4;else if(vix<30)score+=-6;else if(vix<45)score+=-10;else score+=4;

    // VIX TREND — 5-day rate of change (weight: 10)
    const vix5=i>=5?data[i-5].vix:vix;
    const vixROC=vix5>0?((vix-vix5)/vix5*100):0;
    if(vixROC<-15)score+=10; // VIX crashing = fear subsiding rapidly = bullish
    else if(vixROC<-5)score+=6;
    else if(vixROC<5)score+=0;
    else if(vixROC<15)score+=-6;
    else score+=-10; // VIX spiking = panic = bearish

    // VIX TERM STRUCTURE PROXY — VIX vs its 20-day SMA (weight: 8)
    let vixSma=0;for(let j=i-19;j<=i;j++)vixSma+=data[j].vix;vixSma/=20;
    const vixVsSma=((vix-vixSma)/vixSma)*100;
    if(vixVsSma<-15)score+=8; // VIX well below avg = complacency/calm
    else if(vixVsSma<-5)score+=4;
    else if(vixVsSma<5)score+=0;
    else if(vixVsSma<15)score+=-4;
    else score+=-8; // VIX spike above avg = danger

    let state,sizing;
    if(score>=40){state='strong_bull';sizing=1.25;}
    else if(score>=15){state='bull';sizing=1.0;}
    else if(score>=-15){state='neutral';sizing=0.75;}
    else if(score>=-40){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}
    results.push({date:c.date,state,score,sizing,close:c.c,vix,vixROC,vixVsSma});
  }
  return results;
}

// Run all methods
const base=mfBase(merged);
const vixLevel=mfVixLevel(merged);
const vixTrend=mfVixTrend(merged);

// ═══ EQUITY SIMULATION ═══
function simEquity(data,regimeData,name){
  let eq=1000000,peak=1000000,maxDD=0;
  const startIdx=data.findIndex(c=>c.date===regimeData[0]?.date)||50;
  for(let i=Math.max(startIdx+1,51);i<data.length;i++){
    const ret=(data[i].c-data[i-1].c)/data[i-1].c;
    const regime=regimeData.find(r=>r.date===data[i].date);
    eq*=(1+ret*(regime?.sizing??1));
    if(eq>peak)peak=eq;
    const dd=(peak-eq)/peak*100;if(dd>maxDD)maxDD=dd;
  }
  return{name,eq,ret:(eq-1000000)/1000000*100,maxDD};
}

// Smoothed versions (3-day confirmation)
function smooth(regimeData,days=3){
  const smoothed=[...regimeData];
  for(let i=days;i<smoothed.length;i++){
    const prev=smoothed[i-1].state;
    const curr=regimeData[i].state;
    if(curr!==prev){
      let confirmed=true;
      for(let j=1;j<days;j++){if(i+j>=regimeData.length||regimeData[i+j].state!==curr){confirmed=false;break;}}
      if(!confirmed)smoothed[i]={...smoothed[i],state:prev,sizing:smoothed[i-1].sizing};
    }
  }
  return smoothed;
}

const baseSmooth=smooth(base);
const vixLevelSmooth=smooth(vixLevel);
const vixTrendSmooth=smooth(vixTrend);

console.log('█'.repeat(85));
console.log('  REGIME + VIX BACKTEST: 10 YEARS (2016-2026)');
console.log('█'.repeat(85));

console.log('\n═══ EQUITY SIMULATION RESULTS ═══\n');
console.log('Method                            │ Final Equity │ Return   │ Max DD  │ Ret/DD │ Transitions');
console.log('──────────────────────────────────┼──────────────┼──────────┼─────────┼────────┼────────────');

for(const[name,data,raw]of[
  ['Buy & Hold',null,null],
  ['MF Base (no VIX)',base,base],
  ['MF Base + 3d smooth',baseSmooth,base],
  ['MF + VIX Level',vixLevel,vixLevel],
  ['MF + VIX Level + 3d smooth',vixLevelSmooth,vixLevel],
  ['MF + VIX Trend+Structure',vixTrend,vixTrend],
  ['★ MF + VIX Trend + 3d smooth',vixTrendSmooth,vixTrend],
]){
  if(!data){
    let eq=1000000,pk=1000000,mdd=0;
    for(let i=51;i<merged.length;i++){const r=(merged[i].c-merged[i-1].c)/merged[i-1].c;eq*=(1+r);if(eq>pk)pk=eq;const dd=(pk-eq)/pk*100;if(dd>mdd)mdd=dd;}
    console.log(`${name.padEnd(33)} │ Rs.${(eq/100000).toFixed(1)}L     │ +${((eq-1000000)/1000000*100).toFixed(0).padStart(5)}% │ ${mdd.toFixed(1).padStart(6)}% │ ${(((eq-1000000)/1000000*100)/mdd).toFixed(1).padStart(5)} │          —`);
    continue;
  }
  const r=simEquity(merged,data,name);
  let trans=0;for(let i=1;i<data.length;i++)if(data[i].state!==data[i-1].state)trans++;
  console.log(`${name.padEnd(33)} │ Rs.${(r.eq/100000).toFixed(1)}L     │ +${r.ret.toFixed(0).padStart(5)}% │ ${r.maxDD.toFixed(1).padStart(6)}% │ ${(r.ret/r.maxDD).toFixed(1).padStart(5)} │ ${String(trans).padStart(10)}`);
}

// COVID deep dive with VIX
console.log('\n═══ COVID CRASH: VIX-Enhanced Detection ═══\n');
console.log('Date       │ Nifty  │ VIX   │ MF Base    │ MF+VIX     │ VIX ROC │ Key');
console.log('───────────┼────────┼───────┼────────────┼────────────┼─────────┼────');
const covidDates=['2020-02-20','2020-02-24','2020-02-26','2020-02-28','2020-03-06','2020-03-12','2020-03-16','2020-03-23','2020-04-01','2020-04-09','2020-04-20','2020-04-30','2020-05-18','2020-06-01'];
for(const dt of covidDates){
  const b=base.find(r=>r.date===dt);
  const v=vixTrend.find(r=>r.date===dt);
  const m=merged.find(r=>r.date===dt);
  if(!b||!v||!m)continue;
  const key=m.vix>45?'PANIC':m.vix>30?'HIGH FEAR':m.vix>22?'ELEVATED':'';
  console.log(`${dt} │ ${m.c.toFixed(0).padStart(6)} │ ${m.vix.toFixed(1).padStart(5)} │ ${(b.state+'('+b.score+')').padEnd(10)} │ ${(v.state+'('+v.score+')').padEnd(10)} │ ${(v.vixROC>=0?'+':'')+v.vixROC.toFixed(0).padStart(6)}% │ ${key}`);
}

// 2024-2025 correction with VIX
console.log('\n═══ 2025 CORRECTION + RECOVERY: VIX-Enhanced ═══\n');
const dates2025=['2024-09-27','2024-11-04','2024-12-02','2025-01-06','2025-02-03','2025-03-03','2025-04-07','2025-05-05','2025-06-02','2025-06-25'];
for(const dt of dates2025){
  const b=base.find(r=>r.date===dt);
  const v=vixTrend.find(r=>r.date===dt);
  const m=merged.find(r=>r.date===dt);
  if(!b||!v||!m)continue;
  console.log(`${dt} │ ${m.c.toFixed(0).padStart(6)} │ ${m.vix.toFixed(1).padStart(5)} │ ${(b.state+'('+b.score+')').padEnd(14)} │ ${(v.state+'('+v.score+')').padEnd(14)} │ ${(v.vixROC>=0?'+':'')+v.vixROC.toFixed(0).padStart(6)}%`);
}

// Current
const latest=vixTrendSmooth[vixTrendSmooth.length-1];
const latestRaw=vixTrend[vixTrend.length-1];
console.log(`\n${'█'.repeat(85)}`);
console.log('  TODAY\'S REGIME (VIX-Enhanced Multi-Factor)');
console.log('█'.repeat(85));
console.log(`\n  State: ${latest.state.toUpperCase()} (score ${latest.score>=0?'+':''}${latest.score})`);
console.log(`  Nifty: ${latest.close.toFixed(0)} | VIX: ${latest.vix.toFixed(2)}`);
console.log(`  VIX 5d ROC: ${latestRaw.vixROC>=0?'+':''}${latestRaw.vixROC.toFixed(1)}%`);
console.log(`  VIX vs 20d SMA: ${latestRaw.vixVsSma>=0?'+':''}${latestRaw.vixVsSma.toFixed(1)}%`);
console.log(`  Position sizing: ×${latest.sizing}`);
