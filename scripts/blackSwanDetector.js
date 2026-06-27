// BLACK SWAN EARLY WARNING SYSTEM RESEARCH
// Can we detect COVID-like events BEFORE the crash using VIX + market data?
// Study: What VIX/market patterns preceded the 5 biggest Nifty crashes (2016-2026)

const fs=require('fs');
const nLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv','utf8').trim().split('\n');
const nifty=[];for(let i=1;i<nLines.length;i++){const[date,o,h,l,c,v]=nLines[i].split(',');nifty.push({date,o:+o,h:+h,l:+l,c:+c,v:+v});}
const vLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/indiavix_daily.csv','utf8').trim().split('\n');
const vixMap={};for(let i=1;i<vLines.length;i++){const[date,,,,c]=vLines[i].split(',');vixMap[date]={vix:+c};}
const D=nifty.map(n=>({...n,vix:vixMap[n.date]?.vix||0})).filter(m=>m.vix>0);
console.log(`Data: ${D.length} days\n`);

// Compute rolling metrics
for(let i=20;i<D.length;i++){
  // VIX metrics
  D[i].vixROC5=D[i-5].vix>0?((D[i].vix-D[i-5].vix)/D[i-5].vix*100):0;
  D[i].vixROC10=D[i-10].vix>0?((D[i].vix-D[i-10].vix)/D[i-10].vix*100):0;
  let vixSma=0;for(let j=i-19;j<=i;j++)vixSma+=D[j].vix;D[i].vixSma20=vixSma/20;
  D[i].vixVsSma=D[i].vixSma20>0?((D[i].vix-D[i].vixSma20)/D[i].vixSma20*100):0;
  // Nifty metrics
  D[i].niftyROC5=D[i-5].c>0?((D[i].c-D[i-5].c)/D[i-5].c*100):0;
  D[i].niftyROC10=D[i-10].c>0?((D[i].c-D[i-10].c)/D[i-10].c*100):0;
  D[i].niftyROC20=D[i-20].c>0?((D[i].c-D[i-20].c)/D[i-20].c*100):0;
  // Breadth proxy (consecutive red days)
  let redDays=0;for(let j=i;j>=Math.max(i-9,0);j--){if(D[j].c<D[j].o)redDays++;else break;}
  D[i].consecRed=redDays;
  // Daily range expansion
  const range=(D[i].h-D[i].l)/D[i].c*100;
  let avgRange=0;for(let j=i-19;j<=i;j++)avgRange+=(D[j].h-D[j].l)/D[j].c*100;avgRange/=20;
  D[i].rangeExpansion=avgRange>0?range/avgRange:1;
  // Gap
  D[i].gap=D[i-1].c>0?((D[i].o-D[i-1].c)/D[i-1].c*100):0;
}

console.log('█'.repeat(80));
console.log('  BLACK SWAN EARLY WARNING RESEARCH');
console.log('  10 years of Nifty + India VIX');
console.log('█'.repeat(80));

// ═══ PART 1: Identify the major crashes ═══
console.log('\n═══ PART 1: MAJOR CRASHES IN NIFTY (2016-2026) ═══\n');
// Find 20-day drawdowns > 10%
const crashes=[];
for(let i=20;i<D.length;i++){
  const dd20=D[i-20].c>0?((D[i].c-D[i-20].c)/D[i-20].c*100):0;
  if(dd20<-10&&(!crashes.length||i-crashes[crashes.length-1].idx>30)){
    crashes.push({idx:i,date:D[i].date,nifty:D[i].c,dd20,vix:D[i].vix});
  }
}
console.log('  Date       │ Nifty  │ 20d DD  │ VIX   │ Event');
console.log('  ───────────┼────────┼─────────┼───────┼──────');
const events=[
  {date:'2020-03-23',name:'COVID Crash'},
  {date:'2020-03-16',name:'COVID Crash'},
  {date:'2020-03-12',name:'COVID Crash'},
  {date:'2022-06-17',name:'Ukraine/Inflation'},
  {date:'2024-11-04',name:'Election Correction'},
  {date:'2025-03-03',name:'2025 Correction'},
];
for(const cr of crashes.sort((a,b)=>a.dd20-b.dd20).slice(0,10)){
  const ev=events.find(e=>Math.abs(new Date(e.date)-new Date(cr.date.split('-').reverse().join('-')))<30*86400*1000);
  console.log(`  ${cr.date} │ ${cr.nifty.toFixed(0).padStart(6)} │ ${cr.dd20.toFixed(1).padStart(6)}% │ ${cr.vix.toFixed(1).padStart(5)} │ ${ev?.name||'—'}`);
}

// ═══ PART 2: What happened to VIX BEFORE each crash? ═══
console.log('\n═══ PART 2: VIX BEHAVIOR BEFORE CRASHES ═══\n');
console.log('  Look for early warning signals 5-20 days BEFORE the crash bottom\n');

for(const cr of crashes.sort((a,b)=>a.dd20-b.dd20).slice(0,5)){
  console.log(`  ── ${cr.date} (Nifty ${cr.nifty.toFixed(0)}, DD ${cr.dd20.toFixed(1)}%) ──`);
  console.log('  Day offset │ Nifty  │ VIX   │ VIX 5d ROC │ VIX vs SMA │ Nifty 5d │ Red days │ Gap');
  console.log('  ───────────┼────────┼───────┼────────────┼────────────┼──────────┼──────────┼────');
  for(let offset=-20;offset<=0;offset+=1){
    const idx=cr.idx+offset;if(idx<20||idx>=D.length)continue;
    const d=D[idx];if(!d.vixROC5)continue;
    const marker=d.vix>30?'⚠':d.vixROC5>30?'🔴':d.vixROC5>15?'🟡':'';
    console.log(`  ${String(offset).padStart(10)} │ ${d.c.toFixed(0).padStart(6)} │ ${d.vix.toFixed(1).padStart(5)} │ ${(d.vixROC5>=0?'+':'')+d.vixROC5.toFixed(0).padStart(10)}% │ ${(d.vixVsSma>=0?'+':'')+d.vixVsSma.toFixed(0).padStart(10)}% │ ${(d.niftyROC5>=0?'+':'')+d.niftyROC5.toFixed(1).padStart(7)}% │ ${String(d.consecRed).padStart(8)} │ ${(d.gap>=0?'+':'')+d.gap.toFixed(1)+'%'} ${marker}`);
  }
  console.log('');
}

// ═══ PART 3: Define Black Swan Warning Levels ═══
console.log('═══ PART 3: BLACK SWAN WARNING LEVEL DEFINITIONS ═══\n');

// Test various warning thresholds
const warnings=[
  // Level 1: ELEVATED — early warning
  {name:'ELEVATED',fn:d=>d.vix>=18&&d.vixROC5>=15&&d.niftyROC5<-2,color:'🟡'},
  // Level 2: HIGH — serious concern
  {name:'HIGH',fn:d=>d.vix>=22&&d.vixROC5>=25&&d.niftyROC5<-3,color:'🟠'},
  // Level 3: SEVERE — imminent danger
  {name:'SEVERE',fn:d=>d.vix>=30&&(d.vixROC5>=30||d.vixROC10>=50)&&d.niftyROC5<-5,color:'🔴'},
  // Level 4: EXTREME — black swan in progress
  {name:'EXTREME',fn:d=>d.vix>=45&&d.niftyROC10<-10,color:'💀'},
  // Alternative: VIX spike + gap down combo
  {name:'VIX SPIKE + GAP',fn:d=>d.vixROC5>=20&&d.gap<-1.0,color:'⚡'},
  // Alternative: VIX above 2× its SMA
  {name:'VIX 2× SMA',fn:d=>d.vixVsSma>=80,color:'🔥'},
  // Composite: multiple signals
  {name:'COMPOSITE (3+ signals)',fn:d=>{let s=0;if(d.vix>=20)s++;if(d.vixROC5>=15)s++;if(d.niftyROC5<-2)s++;if(d.gap<-0.5)s++;if(d.consecRed>=3)s++;if(d.vixVsSma>=30)s++;return s>=3;},color:'⚠'},
];

console.log('  Level          │ Triggers │ During crash? │ False alarms │ Precision │ Lead time');
console.log('  ───────────────┼──────────┼───────────────┼──────────────┼───────────┼──────────');
for(const w of warnings){
  const triggered=D.filter((d,i)=>i>=20&&w.fn(d));
  // Check if any trigger was within 30 days before a crash
  let duringCrash=0,falseAlarm=0;
  for(const t of triggered){
    const tDate=new Date(t.date.split('-').reverse().join('-')).getTime();
    let nearCrash=false;
    for(const cr of crashes){
      const crDate=new Date(cr.date.split('-').reverse().join('-')).getTime();
      if(tDate>=crDate-30*86400*1000&&tDate<=crDate+5*86400*1000){nearCrash=true;break;}
    }
    if(nearCrash)duringCrash++;else falseAlarm++;
  }
  const precision=triggered.length>0?(duringCrash/triggered.length*100):0;
  console.log(`  ${(w.color+' '+w.name).padEnd(16)} │ ${String(triggered.length).padStart(8)} │ ${String(duringCrash).padStart(13)} │ ${String(falseAlarm).padStart(12)} │ ${precision.toFixed(0).padStart(8)}% │ ${triggered.length>0?'varies':'—'}`);
}

// ═══ PART 4: The ULTIMATE Black Swan Warning System ═══
console.log('\n═══ PART 4: PROPOSED 4-LEVEL WARNING SYSTEM ═══\n');
console.log(`
  ┌─────────────────────────────────────────────────────────────────────┐
  │ LEVEL 1: 🟡 ELEVATED                                              │
  │ Triggers: VIX ≥ 18 AND VIX 5d ROC ≥ 15% AND Nifty 5d < -2%      │
  │ Action:   Reduce new positions to 50%. Tighten stops.              │
  │ Meaning:  Fear rising faster than normal. Something brewing.       │
  ├─────────────────────────────────────────────────────────────────────┤
  │ LEVEL 2: 🟠 HIGH                                                  │
  │ Triggers: VIX ≥ 22 AND VIX 5d ROC ≥ 25% AND Nifty 5d < -3%      │
  │ Action:   Stop ALL new entries. Exit weak positions.               │
  │ Meaning:  Institutional selling accelerating. Correction likely.   │
  ├─────────────────────────────────────────────────────────────────────┤
  │ LEVEL 3: 🔴 SEVERE                                                │
  │ Triggers: VIX ≥ 30 AND (VIX 5d ROC ≥ 30% OR VIX 10d ROC ≥ 50%) │
  │           AND Nifty 5d < -5%                                      │
  │ Action:   EXIT all positions. Move to 100% cash.                   │
  │ Meaning:  Crash in progress. Capital preservation mode.            │
  ├─────────────────────────────────────────────────────────────────────┤
  │ LEVEL 4: 💀 EXTREME (Black Swan)                                   │
  │ Triggers: VIX ≥ 45 AND Nifty 10d < -10%                          │
  │ Action:   Stay in cash. Wait for VIX to peak and start declining. │
  │ Meaning:  Panic. COVID-level event. Bottom not yet in.             │
  │ Recovery: Only re-enter when VIX drops below 25 for 3+ days.      │
  └─────────────────────────────────────────────────────────────────────┘
`);

// ═══ PART 5: COVID timeline — would our system have warned? ═══
console.log('═══ PART 5: COVID BACKTEST — Would this system have warned in time? ═══\n');
const covidStart=D.findIndex(d=>d.date==='2020-02-20'||(d.date.includes('Feb')&&d.date.includes('2020')&&d.c>12000));
if(covidStart>0){
  console.log('  Date       │ Nifty  │ VIX   │ 5d ROC │ vs SMA │ Nifty 5d │ WARNING LEVEL');
  console.log('  ───────────┼────────┼───────┼────────┼────────┼──────────┼──────────────');
  for(let i=Math.max(covidStart-15,20);i<Math.min(covidStart+40,D.length);i++){
    const d=D[i];if(!d.vixROC5)continue;
    let level='—';
    if(d.vix>=45&&d.niftyROC10<-10)level='💀 EXTREME';
    else if(d.vix>=30&&(d.vixROC5>=30||d.vixROC10>=50)&&d.niftyROC5<-5)level='🔴 SEVERE';
    else if(d.vix>=22&&d.vixROC5>=25&&d.niftyROC5<-3)level='🟠 HIGH';
    else if(d.vix>=18&&d.vixROC5>=15&&d.niftyROC5<-2)level='🟡 ELEVATED';
    console.log(`  ${d.date} │ ${d.c.toFixed(0).padStart(6)} │ ${d.vix.toFixed(1).padStart(5)} │ ${(d.vixROC5>=0?'+':'')+d.vixROC5.toFixed(0).padStart(5)}% │ ${(d.vixVsSma>=0?'+':'')+d.vixVsSma.toFixed(0).padStart(5)}% │ ${(d.niftyROC5>=0?'+':'')+d.niftyROC5.toFixed(1).padStart(7)}% │ ${level}`);
  }
}

// Current status
const last=D[D.length-1];
console.log(`\n═══ CURRENT STATUS (${last.date}) ═══\n`);
let currentLevel='🟢 NORMAL';
if(last.vix>=45&&last.niftyROC10<-10)currentLevel='💀 EXTREME';
else if(last.vix>=30&&(last.vixROC5>=30||last.vixROC10>=50)&&last.niftyROC5<-5)currentLevel='🔴 SEVERE';
else if(last.vix>=22&&last.vixROC5>=25&&last.niftyROC5<-3)currentLevel='🟠 HIGH';
else if(last.vix>=18&&last.vixROC5>=15&&last.niftyROC5<-2)currentLevel='🟡 ELEVATED';
console.log(`  VIX: ${last.vix.toFixed(1)} | VIX 5d ROC: ${last.vixROC5>=0?'+':''}${last.vixROC5?.toFixed(0)||0}% | Nifty 5d: ${last.niftyROC5>=0?'+':''}${last.niftyROC5?.toFixed(1)||0}%`);
console.log(`  WARNING LEVEL: ${currentLevel}`);
