// REGIME DETECTION BACKTEST on 10 years of Nifty 50 daily OHLCV (2016-2026)
// Compares: Current EMA method vs Multi-Factor 5-State model
// Validates against known market events (COVID crash, 2021 bull, 2022 correction, 2024 rally)

const fs=require('fs');
const lines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv','utf8').trim().split('\n');
const candles=[];
for(let i=1;i<lines.length;i++){
  const[date,o,h,l,c,v]=lines[i].split(',');
  candles.push({date,o:+o,h:+h,l:+l,c:+c,v:+v});
}
console.log(`Nifty 50 data: ${candles.length} candles (${candles[0].date} to ${candles[candles.length-1].date})\n`);

// ═══ METHOD 1: Current EMA50/200 (baseline) ═══
function emaMethod(candles){
  const k50=2/51,k200=2/201;
  let e50=candles[0].c,e200=candles[0].c;
  return candles.map((c,i)=>{
    e50=c.c*k50+e50*(1-k50);e200=c.c*k200+e200*(1-k200);
    const above200=c.c>e200,e50above200=e50>e200;
    let state;
    if(above200&&e50above200)state='bull';
    else if(!above200&&!e50above200)state='bear';
    else state='neutral';
    return{date:c.date,state,close:c.c,e50,e200,sizing:state==='bull'?1.0:state==='bear'?0:0.5};
  });
}

// ═══ METHOD 2: Multi-Factor 5-State ═══
function multiFactor(candles){
  const results=[];
  for(let i=50;i<candles.length;i++){
    const c=candles[i];
    // Factor 1: MOMENTUM — 20-day return
    const ret20=(c.c-candles[i-20].c)/candles[i-20].c*100;
    // Factor 2: BREADTH PROXY — % of last 20 days that were green
    let greenDays=0;for(let j=i-19;j<=i;j++)if(candles[j].c>candles[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    // Factor 3: VOLATILITY — 20-day realized vol (std of daily returns)
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((candles[j].c-candles[j-1].c)/candles[j-1].c*100);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-retMean)**2,0)/rets.length);
    // Factor 4: ACCELERATION — 10d return minus prev 10d return
    const ret10a=(candles[i].c-candles[i-10].c)/candles[i-10].c*100;
    const ret10b=(candles[i-10].c-candles[i-20].c)/candles[i-20].c*100;
    const accel=ret10a-ret10b;
    // Factor 5: VOL RATIO — current 20d vol vs 50d vol
    const rets50=[];for(let j=i-49;j<=i;j++)rets50.push((candles[j].c-candles[j-1].c)/candles[j-1].c*100);
    const retMean50=rets50.reduce((s,v)=>s+v,0)/rets50.length;
    const vol50=Math.sqrt(rets50.reduce((s,v)=>s+(v-retMean50)**2,0)/rets50.length);
    const volRatio=vol50>0?vol/vol50:1;
    // Factor 6: DISTANCE FROM 200 EMA
    let e200=candles[0].c;const k200=2/201;
    for(let j=1;j<=i;j++)e200=candles[j].c*k200+e200*(1-k200);
    const distEma200=((c.c-e200)/e200)*100;
    // Factor 7: ATR TREND — is ATR expanding or contracting?
    let atr20=0;for(let j=i-19;j<=i;j++)atr20+=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));
    atr20/=20;
    let atr50=0;for(let j=i-49;j<=i;j++)atr50+=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));
    atr50/=50;
    const atrRatio=atr50>0?atr20/atr50:1;

    // Composite score (-100 to +100)
    let score=0;
    // Momentum (weight: 25)
    if(ret20>5)score+=25;else if(ret20>2)score+=15;else if(ret20>0)score+=5;else if(ret20>-2)score+=-5;else if(ret20>-5)score+=-15;else score+=-25;
    // Breadth (weight: 20)
    if(breadth>60)score+=20;else if(breadth>52)score+=10;else if(breadth>45)score+=-5;else if(breadth>38)score+=-15;else score+=-20;
    // Volatility (weight: 15)
    if(vol<0.8)score+=15;else if(vol<1.2)score+=8;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-8;else score+=-15;
    // Acceleration (weight: 15)
    if(accel>2)score+=15;else if(accel>0.5)score+=8;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-8;else score+=-15;
    // EMA200 distance (weight: 15)
    if(distEma200>5)score+=15;else if(distEma200>0)score+=8;else if(distEma200>-3)score+=-5;else if(distEma200>-8)score+=-10;else score+=-15;
    // Vol ratio (weight: 10)
    if(volRatio<0.8)score+=10;else if(volRatio>1.3)score+=-10;else score+=0;

    let state,sizing;
    if(score>=40){state='strong_bull';sizing=1.25;}
    else if(score>=15){state='bull';sizing=1.0;}
    else if(score>=-15){state='neutral';sizing=0.75;}
    else if(score>=-40){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}

    results.push({date:c.date,state,score,sizing,close:c.c,ret20,breadth,vol,accel,distEma200,volRatio,atrRatio});
  }
  return results;
}

const ema=emaMethod(candles);
const mf=multiFactor(candles);

console.log('█'.repeat(85));
console.log('  REGIME BACKTEST: 10 YEARS OF NIFTY 50 (2016-2026)');
console.log('█'.repeat(85));

// ═══ PART 1: Validate against known events ═══
console.log('\n═══ VALIDATION AGAINST KNOWN MARKET EVENTS ═══\n');
const events=[
  {date:'2020-03-23',name:'COVID Crash Bottom',expected:'strong_bear'},
  {date:'2020-04-01',name:'COVID Recovery Start',expected:'bear'},
  {date:'2020-11-02',name:'Vaccine Rally',expected:'bull'},
  {date:'2021-10-18',name:'Nifty All-Time High 18600',expected:'strong_bull'},
  {date:'2022-06-17',name:'Bear Market (Ukraine/Rates)',expected:'bear'},
  {date:'2023-01-02',name:'New Year Recovery',expected:'neutral'},
  {date:'2023-07-03',name:'Mid-2023 Rally',expected:'bull'},
  {date:'2023-12-01',name:'Year-End Rally',expected:'strong_bull'},
  {date:'2024-09-27',name:'Nifty ATH 26277',expected:'strong_bull'},
  {date:'2024-11-04',name:'Post-Election Correction',expected:'bear'},
  {date:'2025-03-03',name:'2025 Correction',expected:'bear'},
  {date:'2025-06-02',name:'Recovery Rally',expected:'bull'},
];

console.log('Event                        │ Expected     │ EMA Result   │ MF Result    │ MF Score │ EMA ✓/✗ │ MF ✓/✗');
console.log('─────────────────────────────┼──────────────┼──────────────┼──────────────┼──────────┼─────────┼──────');
let emaCorrect=0,mfCorrect=0;
for(const ev of events){
  // Find nearest date
  const emaR=ema.reduce((best,r)=>Math.abs(new Date(r.date)-new Date(ev.date))<Math.abs(new Date(best.date)-new Date(ev.date))?r:best);
  const mfR=mf.reduce((best,r)=>Math.abs(new Date(r.date)-new Date(ev.date))<Math.abs(new Date(best.date)-new Date(ev.date))?r:best);
  const emaMatch=emaR.state===ev.expected||(ev.expected.includes('bull')&&emaR.state==='bull')||(ev.expected.includes('bear')&&emaR.state==='bear');
  const mfMatch=mfR.state===ev.expected;
  if(emaMatch)emaCorrect++;if(mfMatch)mfCorrect++;
  console.log(`${ev.name.padEnd(28)} │ ${ev.expected.padEnd(12)} │ ${emaR.state.padEnd(12)} │ ${mfR.state.padEnd(12)} │ ${(mfR.score>=0?'+':'')+String(mfR.score).padStart(6)} │ ${emaMatch?'  ✓  ':'  ✗  '} │ ${mfMatch?'  ✓  ':'  ✗  '}`);
}
console.log(`\nAccuracy: EMA ${emaCorrect}/${events.length} (${(emaCorrect/events.length*100).toFixed(0)}%) | MF ${mfCorrect}/${events.length} (${(mfCorrect/events.length*100).toFixed(0)}%)`);

// ═══ PART 2: Regime distribution ═══
console.log('\n═══ REGIME DISTRIBUTION (10 years) ═══\n');
for(const[name,data]of[['EMA (current)',ema],['Multi-Factor',mf]]){
  const dist={};data.forEach(d=>{dist[d.state]=(dist[d.state]||0)+1;});
  console.log(`${name}:`);
  for(const[state,count]of Object.entries(dist).sort((a,b)=>b[1]-a[1])){
    const pct=(count/data.length*100).toFixed(1);
    const bar='█'.repeat(Math.round(count/data.length*40));
    console.log(`  ${state.padEnd(15)} ${String(count).padStart(5)} days (${pct.padStart(5)}%) ${bar}`);
  }
  console.log('');
}

// ═══ PART 3: Transition analysis — how often does regime change? ═══
console.log('═══ REGIME STABILITY (fewer transitions = less whipsaw) ═══\n');
for(const[name,data]of[['EMA',ema],['Multi-Factor',mf]]){
  let transitions=0;
  for(let i=1;i<data.length;i++)if(data[i].state!==data[i-1].state)transitions++;
  console.log(`${name}: ${transitions} transitions in ${data.length} days (avg ${(data.length/transitions).toFixed(0)} days per regime)`);
}

// ═══ PART 4: Equity simulation — does regime-based sizing improve returns? ═══
console.log('\n═══ EQUITY SIMULATION: Regime-Based Sizing vs Buy-and-Hold ═══\n');

function simEquity(candles, regimeData, name){
  let equity=1000000,peak=1000000,maxDD=0;
  const startIdx=regimeData.length>0?candles.findIndex(c=>c.date===regimeData[0].date):50;
  for(let i=Math.max(startIdx+1,51);i<candles.length;i++){
    const ret=(candles[i].c-candles[i-1].c)/candles[i-1].c;
    const regime=regimeData.find(r=>r.date===candles[i].date);
    const sizing=regime?regime.sizing:1.0;
    equity*=(1+ret*sizing);
    if(equity>peak)peak=equity;
    const dd=(peak-equity)/peak*100;if(dd>maxDD)maxDD=dd;
  }
  const totalRet=(equity-1000000)/1000000*100;
  return{equity,totalRet,maxDD,name};
}

// Buy and hold
let bhEquity=1000000,bhPeak=1000000,bhMaxDD=0;
for(let i=51;i<candles.length;i++){
  const ret=(candles[i].c-candles[i-1].c)/candles[i-1].c;
  bhEquity*=(1+ret);if(bhEquity>bhPeak)bhPeak=bhEquity;
  const dd=(bhPeak-bhEquity)/bhPeak*100;if(dd>bhMaxDD)bhMaxDD=dd;
}

const emaEq=simEquity(candles,ema,'EMA Regime');
const mfEq=simEquity(candles,mf,'Multi-Factor');

console.log('Strategy         │ Final Equity │ Return   │ Max DD  │ Return/DD');
console.log('─────────────────┼──────────────┼──────────┼─────────┼──────────');
console.log(`Buy & Hold        │ Rs.${(bhEquity/100000).toFixed(1)}L     │ +${((bhEquity-1000000)/1000000*100).toFixed(0)}%    │ ${bhMaxDD.toFixed(1)}%   │ ${(((bhEquity-1000000)/1000000*100)/bhMaxDD).toFixed(2)}`);
console.log(`EMA Regime        │ Rs.${(emaEq.equity/100000).toFixed(1)}L     │ +${emaEq.totalRet.toFixed(0)}%    │ ${emaEq.maxDD.toFixed(1)}%   │ ${(emaEq.totalRet/emaEq.maxDD).toFixed(2)}`);
console.log(`Multi-Factor      │ Rs.${(mfEq.equity/100000).toFixed(1)}L     │ +${mfEq.totalRet.toFixed(0)}%    │ ${mfEq.maxDD.toFixed(1)}%   │ ${(mfEq.totalRet/mfEq.maxDD).toFixed(2)}`);

// ═══ PART 5: COVID crash deep dive ═══
console.log('\n═══ COVID CRASH TIMELINE (Feb-Jun 2020) ═══\n');
console.log('Date       │ Nifty  │ EMA State  │ MF State     │ MF Score │ MF Sizing');
console.log('───────────┼────────┼────────────┼──────────────┼──────────┼─────────');
const covidDates=mf.filter(d=>d.date>='2020-02-01'&&d.date<='2020-06-30');
for(const d of covidDates){
  const e=ema.find(r=>r.date===d.date);
  console.log(`${d.date} │ ${d.close.toFixed(0).padStart(6)} │ ${(e?.state||'—').padEnd(10)} │ ${d.state.padEnd(12)} │ ${(d.score>=0?'+':'')+String(d.score).padStart(7)} │ ×${d.sizing}`);
}

// ═══ PART 6: Recent 3 months ═══
console.log('\n═══ RECENT 3 MONTHS ═══\n');
console.log('Date       │ Nifty  │ EMA State  │ MF State     │ MF Score │ Ret20  │ Breadth │ Vol');
console.log('───────────┼────────┼────────────┼──────────────┼──────────┼────────┼─────────┼────');
const recent=mf.slice(-65);
for(const d of recent){
  const e=ema.find(r=>r.date===d.date);
  console.log(`${d.date} │ ${d.close.toFixed(0).padStart(6)} │ ${(e?.state||'—').padEnd(10)} │ ${d.state.padEnd(12)} │ ${(d.score>=0?'+':'')+String(d.score).padStart(7)} │ ${(d.ret20>=0?'+':'')+d.ret20.toFixed(1).padStart(5)}% │ ${d.breadth.toFixed(0).padStart(5)}% │ ${d.vol.toFixed(1)}`);
}

// Final stats
const latest=mf[mf.length-1];
const latestEma=ema[ema.length-1];
console.log(`\n${'█'.repeat(85)}`);
console.log('  TODAY\'S REGIME');
console.log('█'.repeat(85));
console.log(`\n  EMA method:        ${latestEma.state.toUpperCase()} (Nifty ${latestEma.close.toFixed(0)}, EMA50 ${latestEma.e50.toFixed(0)}, EMA200 ${latestEma.e200.toFixed(0)})`);
console.log(`  Multi-Factor:      ${latest.state.toUpperCase()} (score ${latest.score>=0?'+':''}${latest.score})`);
console.log(`    Momentum (20d):  ${latest.ret20>=0?'+':''}${latest.ret20.toFixed(2)}%`);
console.log(`    Breadth:         ${latest.breadth.toFixed(0)}% green days`);
console.log(`    Volatility:      ${latest.vol.toFixed(2)}%`);
console.log(`    Acceleration:    ${latest.accel>=0?'+':''}${latest.accel.toFixed(2)}%`);
console.log(`    Dist from EMA200:${latest.distEma200>=0?'+':''}${latest.distEma200.toFixed(2)}%`);
console.log(`    Position sizing: ×${latest.sizing}`);
