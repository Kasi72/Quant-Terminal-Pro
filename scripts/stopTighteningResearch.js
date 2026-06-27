// STOP TIGHTENING RESEARCH — Solve the 8% stop / sub-1.0 R:R problem
// The insight: if a breakout survives 2-3 days, it's very likely a winner
// Solution: START wide (for shakeout protection) then TIGHTEN aggressively

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL,zoneHigh=bZ.zH;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const atrPct=atrVal/entry*100;
    // Current wide stop
    const wideStopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const wideStopPct=Math.max(3.5,Math.min(8,wideStopRaw));
    // Zone-relative metrics
    const zoneWidth=((zoneHigh-zoneLow)/entry)*100;
    const closeAboveZone=((entry-zoneHigh)/entry)*100;
    // Future candles
    const future=[];
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      future.push({day,h:fc.h,l:fc.l,c:fc.c,o:fc.o,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        highWater:0}); // will compute below
    }
    // High water mark
    let hw=entry;
    for(const f of future){if(f.h>hw)hw=f.h;f.highWater=(hw-entry)/entry*100;}
    let mfe=0,mae=0,h5=false,d5=99;
    for(const f of future){if(f.pctH>mfe)mfe=f.pctH;if(f.pctL<mae)mae=f.pctL;if(!h5&&f.pctH>=5){h5=true;d5=f.day;}}

    ALL.push({sym,date:c[i].date,entry,atrVal,atrPct,zoneLow,zoneHigh,wideStopPct,t1Pct,
      zoneWidth,closeAboveZone,future,mfe,mae,h5,d5,v20});
  }
}
ALL.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const W=ALL.filter(s=>s.h5).length;
console.log(`Signals: ${ALL.length} | Winners: ${W} | Stocks: ${[...new Set(ALL.map(s=>s.sym))].length}\n`);

// First: understand the problem
console.log('█'.repeat(85));
console.log('  THE R:R PROBLEM — Current stop distribution');
console.log('█'.repeat(85));
const rrDist={};
for(const s of ALL){
  const rr=s.t1Pct/s.wideStopPct;
  const bucket=rr<0.5?'<0.5':rr<0.7?'0.5-0.7':rr<0.9?'0.7-0.9':rr<1.0?'0.9-1.0':rr<1.5?'1.0-1.5':'1.5+';
  if(!rrDist[bucket])rrDist[bucket]={n:0,w:0};rrDist[bucket].n++;if(s.h5)rrDist[bucket].w++;
}
console.log('\n  R:R Bucket │ Signals │ Hit Rate │ % of total');
console.log('  ───────────┼─────────┼──────────┼───────────');
for(const[b,d]of Object.entries(rrDist).sort()){
  console.log(`  ${b.padEnd(10)} │ ${String(d.n).padStart(7)} │ ${(d.w/d.n*100).toFixed(1).padStart(7)}% │ ${(d.n/ALL.length*100).toFixed(1)}%`);
}
console.log(`\n  Average stop: ${(ALL.reduce((s,t)=>s+t.wideStopPct,0)/ALL.length).toFixed(2)}%`);
console.log(`  Average T1:   ${(ALL.reduce((s,t)=>s+t.t1Pct,0)/ALL.length).toFixed(2)}%`);
console.log(`  Average R:R:  ${(ALL.reduce((s,t)=>s+t.t1Pct/t.wideStopPct,0)/ALL.length).toFixed(3)}`);

// How quickly do winners show themselves?
console.log('\n═══ HOW QUICKLY DO WINNERS SHOW? ═══\n');
const winners=ALL.filter(s=>s.h5);
console.log('  Day │ % winners with MFE>0% │ % with MFE>1% │ % with MFE>2% │ % at +5% already');
console.log('  ────┼───────────────────────┼───────────────┼───────────────┼──────────────────');
for(let d=1;d<=5;d++){
  const above0=winners.filter(s=>s.future.find(f=>f.day===d)?.pctH>0).length;
  const above1=winners.filter(s=>s.future.find(f=>f.day===d)?.pctH>1).length;
  const above2=winners.filter(s=>s.future.find(f=>f.day===d)?.pctH>2).length;
  const hit5=winners.filter(s=>s.d5<=d).length;
  console.log(`  ${String(d).padStart(3)} │ ${(above0/winners.length*100).toFixed(0).padStart(21)}% │ ${(above1/winners.length*100).toFixed(0).padStart(13)}% │ ${(above2/winners.length*100).toFixed(0).padStart(13)}% │ ${(hit5/winners.length*100).toFixed(0).padStart(16)}%`);
}

// ═══ SOLUTION APPROACHES ═══
console.log('\n' + '█'.repeat(85));
console.log('  6 SCIENTIFIC APPROACHES TO SOLVE THE R:R PROBLEM');
console.log('█'.repeat(85));

function simulate(signals, stopFn) {
  let wins=0,losses=0,falseStops=0,winPnl=0,lossPnl=0;
  for(const s of signals){
    let stopped=false,t1Hit=false,stopDay=0,stopPctUsed=s.wideStopPct;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      const dynamicStop=stopFn(s,f);
      if(f.pctL<=-dynamicStop){stopped=true;stopDay=f.day;stopPctUsed=dynamicStop;break;}
    }
    if(stopped){losses++;lossPnl+=stopPctUsed;if(s.h5)falseStops++;}
    else if(t1Hit){wins++;winPnl+=s.t1Pct;}
  }
  const decided=wins+losses;const avgStopUsed=losses>0?lossPnl/losses:0;
  const avgRR=decided>0?((winPnl/Math.max(wins,1))/(lossPnl/Math.max(losses,1))):0;
  return{wins,losses,falseStops,decided,winRate:decided>0?wins/decided*100:0,
    avgStopUsed,avgRR,expectancy:decided>0?(winPnl-lossPnl)/decided:0};
}

const approaches=[
  // A0: Current — fixed wide stop
  {name:'A0: Current (fixed 3.5-8%)',fn:(s,f)=>s.wideStopPct},
  // A1: Time-decay tightening — wide for 2 days, tighten each day after
  {name:'A1: Time-decay (Day1-2: full, Day3+: halve)',fn:(s,f)=>{
    if(f.day<=2)return s.wideStopPct;
    return Math.max(3.5, s.wideStopPct * 0.5);
  }},
  // A2: Trailing from high water mark — once stock moves +1%, trail from there
  {name:'A2: Trail from HWM after +1% (trail 3.5%)',fn:(s,f)=>{
    if(f.highWater<1.0)return s.wideStopPct; // haven't moved +1% yet
    return Math.max(2.0, f.highWater - 3.5); // trail 3.5% from highest point
  }},
  // A3: Breakeven after Day 3 if profitable — most aggressive
  {name:'A3: Breakeven after Day3 if in profit',fn:(s,f)=>{
    if(f.day<=3)return s.wideStopPct;
    if(f.highWater>0)return Math.max(0.5, -f.pctC+0.5); // near breakeven
    return s.wideStopPct;
  }},
  // A4: ATR-adaptive — use CURRENT ATR not entry ATR
  {name:'A4: 1×currentATR clamped [2.5%,5%]',fn:(s,f)=>{
    return Math.max(2.5, Math.min(5.0, s.atrPct));
  }},
  // A5: Zone-width proportional — tight zone = tight stop
  {name:'A5: Zone-proportional (zoneWidth×1.5 + 1%)',fn:(s,f)=>{
    return Math.max(2.5, Math.min(6.0, s.zoneWidth * 1.5 + 1.0));
  }},
  // A6: Hybrid time-decay + trailing
  {name:'A6: Hybrid (Day1-2 wide, then trail 2.5% from HWM)',fn:(s,f)=>{
    if(f.day<=2)return s.wideStopPct;
    if(f.highWater>=1.0)return Math.max(2.0, f.highWater - 2.5);
    return Math.max(3.0, s.wideStopPct * 0.6);
  }},
  // A7: Progressive tightening
  {name:'A7: Progressive (Day1:100%, Day2:80%, Day3:60%, Day4+:40%)',fn:(s,f)=>{
    const mult=f.day<=1?1.0:f.day<=2?0.8:f.day<=3?0.6:0.4;
    return Math.max(2.5, s.wideStopPct * mult);
  }},
  // A8: Trail from zone high (not entry) — tighter reference
  {name:'A8: Trail from zone high (3% below zoneHigh)',fn:(s,f)=>{
    const fromZH=((s.entry-s.zoneHigh)/s.entry)*100 + 3.0;
    return Math.max(2.5, Math.min(6.0, fromZH));
  }},
  // A9: The SCIENTIFIC approach — Bayesian tightening based on survival probability
  // After each day of survival, the probability of being a winner INCREASES
  // So the stop should tighten proportionally to the updated probability
  {name:'A9: Bayesian survival tightening',fn:(s,f)=>{
    // P(winner|survived N days) increases with N
    // Day 1: 45% → full stop needed
    // Day 2: ~60% → can tighten
    // Day 3: ~70% → tighten more
    // Day 4+: ~80% → tight stop OK
    const survivalMult=f.day<=1?1.0:f.day<=2?0.75:f.day<=3?0.55:0.40;
    // Also factor in: if stock is up, tighten more
    const profitAdj=f.highWater>1.5?0.7:f.highWater>0.5?0.85:1.0;
    return Math.max(2.0, s.wideStopPct * survivalMult * profitAdj);
  }},
  // A10: ULTIMATE — Bayesian + Trail + Zone-proportional
  {name:'A10: ULTIMATE (Bayesian + Trail + Zone)',fn:(s,f)=>{
    // Base: zone-proportional (tight zone = tight stop)
    const zoneStop=Math.max(2.5, Math.min(6.0, s.zoneWidth * 1.5 + 1.0));
    // Bayesian survival decay
    const survMult=f.day<=1?1.0:f.day<=2?0.75:f.day<=3?0.55:0.40;
    let stop=zoneStop*survMult;
    // Trail from HWM if profitable
    if(f.highWater>=1.5)stop=Math.min(stop,Math.max(1.5,f.highWater-2.5));
    return Math.max(1.5, stop);
  }},
];

console.log('\n  Approach                                     │FalseStop│ Wins │ WR%   │ AvgStop │ AvgR:R │ Exp/R');
console.log('  ─────────────────────────────────────────────┼─────────┼──────┼───────┼─────────┼────────┼──────');
const results=[];
for(const a of approaches){
  const r=simulate(ALL,a.fn);results.push({...a,...r});
  console.log(`  ${a.name.padEnd(45)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(5)}% │ ${r.avgStopUsed.toFixed(2).padStart(6)}% │ ${r.avgRR.toFixed(2).padStart(6)} │ ${r.expectancy.toFixed(2).padStart(5)}%`);
}

// Rank by R:R (higher = better risk management) with positive expectancy
console.log('\n═══ RANKED BY R:R (with positive expectancy) ═══\n');
const ranked=results.filter(r=>r.expectancy>0).sort((a,b)=>b.avgRR-a.avgRR);
console.log('  Rank │ Approach                                     │ AvgR:R │ AvgStop │ FalseStop │ WR%   │ Exp');
console.log('  ─────┼──────────────────────────────────────────────┼────────┼─────────┼───────────┼───────┼─────');
for(let i=0;i<ranked.length;i++){
  const r=ranked[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(44)} │ ${r.avgRR.toFixed(2).padStart(6)} │ ${r.avgStopUsed.toFixed(2).padStart(6)}% │ ${String(r.falseStops).padStart(9)} │ ${r.winRate.toFixed(1).padStart(5)}% │ ${r.expectancy.toFixed(2)}%`);
}

// Deep dive on top 3
for(const r of ranked.slice(0,3)){
  console.log(`\n  ═══ ${r.name} ═══`);
  // Show stop % distribution
  const stopDist=[];
  for(const s of ALL){
    for(const f of s.future){
      const stop=r.fn(s,f);
      stopDist.push({day:f.day,stop});
    }
  }
  console.log('  Day-by-day average stop %:');
  for(let d=1;d<=5;d++){
    const dayStops=stopDist.filter(s=>s.day===d);
    const avg=dayStops.reduce((s,t)=>s+t.stop,0)/dayStops.length;
    console.log(`    Day ${d}: ${avg.toFixed(2)}%`);
  }
}

// Walk-forward on top approach
console.log('\n═══ WALK-FORWARD (70/30) ═══\n');
const sp=Math.floor(ALL.length*0.70);
for(const r of ranked.slice(0,3)){
  const isR=simulate(ALL.slice(0,sp),r.fn);
  const oosR=simulate(ALL.slice(sp),r.fn);
  console.log(`  ${r.name}`);
  console.log(`    IS:  WR ${isR.winRate.toFixed(1)}%, R:R ${isR.avgRR.toFixed(2)}, Exp ${isR.expectancy.toFixed(2)}%, False ${isR.falseStops}`);
  console.log(`    OOS: WR ${oosR.winRate.toFixed(1)}%, R:R ${oosR.avgRR.toFixed(2)}, Exp ${oosR.expectancy.toFixed(2)}%, False ${oosR.falseStops}`);
}

// What R:R would each approach give for a typical stock?
console.log('\n═══ EXAMPLE: TYPICAL STOCK (ATR 3%, Zone width 5%, T1 4%) ═══\n');
const example={wideStopPct:8,t1Pct:4,atrPct:3,zoneWidth:5,zoneHigh:100,entry:105};
console.log('  Day │ Current │ Bayesian │ ULTIMATE │ T1 target │ R:R(Current) │ R:R(ULTIMATE)');
console.log('  ────┼─────────┼──────────┼──────────┼───────────┼──────────────┼──────────────');
for(let d=1;d<=5;d++){
  const f={day:d,highWater:d*0.5,pctC:d*0.3,pctH:d*0.5,pctL:-1};
  const cur=approaches[0].fn(example,f);
  const bay=approaches[9].fn(example,f);
  const ult=approaches[10].fn(example,f);
  console.log(`  ${String(d).padStart(3)} │ ${cur.toFixed(1).padStart(6)}% │ ${bay.toFixed(1).padStart(7)}% │ ${ult.toFixed(1).padStart(7)}% │ ${example.t1Pct.toFixed(1).padStart(8)}% │ ${(example.t1Pct/cur).toFixed(2).padStart(12)} │ ${(example.t1Pct/ult).toFixed(2).padStart(12)}`);
}
