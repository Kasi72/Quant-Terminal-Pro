// DAY 2 CONFIRMATION RESEARCH — Scientific acceleration + volume checks
// Find the optimal combination of Day 2 conditions that separates
// genuine breakdowns from shakeouts with zero false stops

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect all breakout signals with rich Day 1/Day 2 below-stop data
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    // OBV at signal
    let obv0=0;for(let j=Math.max(1,i-20);j<=i;j++)obv0+=c[j].c>c[j-1].c?c[j].v:c[j].c<c[j-1].c?-c[j].v:0;
    const future=[];let prevOBV=obv0;
    for(let d=i+1;d<=Math.min(i+12,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      prevOBV+=fc.c>c[d-1].c?fc.v:fc.c<c[d-1].c?-fc.v:0;
      future.push({day,c:fc.c,h:fc.h,l:fc.l,o:fc.o,v:fc.v,
        pctC:(fc.c-entry)/entry*100,pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,
        isGreen:fc.o<fc.c,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,
        bodyPct:range>0?Math.abs(fc.c-fc.o)/range*100:0,
        volR:v20>0?fc.v/v20:1,obvDelta:prevOBV-obv0,
        // Selling pressure = (high-close)/(high-low) — 1.0 = closed at low, 0 = closed at high
        sellPressure:range>0?(fc.h-fc.c)/range:0.5,
      });
    }
    let mfe=0;for(const f of future.slice(0,10))if(f.pctH>mfe)mfe=f.pctH;
    ALL.push({sym,date:c[i].date,entry,atrVal,stopPct,t1Pct,future,mfe,h5:mfe>=5,v20});
  }
}
console.log(`Signals: ${ALL.length} | Winners: ${ALL.filter(s=>s.h5).length}\n`);

// Extract all Day1-below-stop + Day2-below-stop events with rich metrics
const events=[];
for(const s of ALL){
  for(let fi=1;fi<Math.min(10,s.future.length);fi++){
    const d2=s.future[fi]; // Day 2 (current candle below stop)
    const d1=s.future[fi-1]; // Day 1 (previous candle — also below stop?)
    if(d2.pctC>-s.stopPct)continue; // Day 2 close NOT below stop
    if(d1.pctC>-s.stopPct)continue; // Day 1 close NOT below stop (need consecutive)
    // Both Day 1 and Day 2 closed below stop — now analyze Day 2's characteristics
    // ACCELERATION measures
    const closeAccel=d2.pctC-d1.pctC; // negative = accelerating down, positive = decelerating
    const lowAccel=d2.pctL-d1.pctL; // how much deeper is today's low?
    const rangeAccel=(d2.h-d2.l)-(d1.h-d1.l); // expanding or contracting range?
    // VOLUME measures on Day 2
    const volRatio=d2.volR; // Day 2 volume vs 20d avg
    const volVsD1=d1.v>0?d2.v/d1.v:1; // Day 2 vol vs Day 1 vol
    const volDecreasing=d2.v<d1.v; // selling exhaustion?
    // SELLING PRESSURE
    const sp2=d2.sellPressure; // Day 2 selling pressure
    const sp1=d1.sellPressure; // Day 1 selling pressure
    const spAccel=sp2-sp1; // increasing or decreasing selling pressure
    // OBV
    const obvDecline=d2.obvDelta<0; // OBV below signal day
    const obvAccel=fi>=2?d2.obvDelta-d1.obvDelta:0; // OBV accelerating down?
    // CANDLE QUALITY on Day 2
    const isRedDay2=!d2.isGreen;
    const closeLowDay2=d2.closeLoc<40;
    const bigBodyDay2=d2.bodyPct>40;
    // Was this a TRUE breakdown or a shakeout that recovered?
    const isWinner=s.h5;
    // Check if this specific stop would have been a FALSE stop
    let hitT1Before=false;
    for(let j=0;j<fi;j++)if(s.future[j].pctH>=s.t1Pct)hitT1Before=true;
    if(hitT1Before)continue; // T1 already hit — not relevant

    events.push({sym:s.sym,date:s.date,isWinner,stopPct:s.stopPct,
      closeAccel,lowAccel,rangeAccel,volRatio,volVsD1,volDecreasing,
      sp2,sp1,spAccel,obvDecline,obvAccel,isRedDay2,closeLowDay2,bigBodyDay2,
      d2Close:d2.pctC,d1Close:d1.pctC,d2CloseLoc:d2.closeLoc,d2LwPct:d2.lwPct,d2BodyPct:d2.bodyPct});
    break; // only first event per signal
  }
}
const trueBreakdowns=events.filter(e=>!e.isWinner);
const falseBreakdowns=events.filter(e=>e.isWinner); // these are shakeouts (winners we shouldn't stop)
console.log(`Day1+Day2 below-stop events: ${events.length}`);
console.log(`True breakdowns (losers): ${trueBreakdowns.length}`);
console.log(`FALSE breakdowns (winners/shakeouts we should NOT stop): ${falseBreakdowns.length}\n`);

console.log('█'.repeat(85));
console.log('  DAY 2 CONFIRMATION — Scientific metrics to separate shakeout from breakdown');
console.log('█'.repeat(85));

// ═══ PART 1: What's DIFFERENT about shakeouts vs breakdowns on Day 2? ═══
console.log('\n═══ PART 1: Day 2 DNA — True breakdowns vs shakeouts ═══\n');
const metrics=[
  ['Close acceleration (D2-D1 close%)',    'closeAccel'],
  ['Low acceleration (D2-D1 low%)',         'lowAccel'],
  ['Day 2 volume ratio (vs 20d avg)',       'volRatio'],
  ['Day 2 vol vs Day 1 vol',               'volVsD1'],
  ['Day 2 selling pressure (0-1)',          'sp2'],
  ['Selling pressure change (D2-D1)',       'spAccel'],
  ['Day 2 close location (%)',             'd2CloseLoc'],
  ['Day 2 body %',                          'd2BodyPct'],
  ['Day 2 lower wick %',                    'd2LwPct'],
];
console.log('  Metric                              │ Breakdowns │ Shakeouts │ Delta   │ Cohen d │ Use as gate?');
console.log('  ────────────────────────────────────┼────────────┼───────────┼─────────┼─────────┼────────────');
for(const[name,field]of metrics){
  const bVals=trueBreakdowns.map(e=>e[field]).filter(v=>Number.isFinite(v));
  const sVals=falseBreakdowns.map(e=>e[field]).filter(v=>Number.isFinite(v));
  const bM=bVals.reduce((s,v)=>s+v,0)/bVals.length;
  const sM=sVals.reduce((s,v)=>s+v,0)/sVals.length;
  const d=bM-sM;
  const pooled=Math.sqrt(((bVals.reduce((s,v)=>s+(v-bM)**2,0)+sVals.reduce((s,v)=>s+(v-sM)**2,0))/(bVals.length+sVals.length-2)));
  const cd=pooled>0?Math.abs(d)/pooled:0;
  const useAs=cd>=0.3?'★ YES':cd>=0.15?'Maybe':'No';
  console.log(`  ${name.padEnd(37)} │ ${bM.toFixed(3).padStart(10)} │ ${sM.toFixed(3).padStart(9)} │ ${(d>=0?'+':'')+d.toFixed(3).padStart(7)} │ ${cd.toFixed(2).padStart(7)} │ ${useAs}`);
}

// ═══ PART 2: Test each Day 2 condition individually ═══
console.log('\n═══ PART 2: INDIVIDUAL DAY 2 CONDITIONS — Which block shakeouts? ═══\n');
const conditions=[
  // Acceleration checks
  {name:'D2 close < D1 close (accelerating)',fn:e=>e.closeAccel<0},
  {name:'D2 close < D1 close - 0.5%',fn:e=>e.closeAccel<-0.5},
  {name:'D2 close < D1 close - 1.0%',fn:e=>e.closeAccel<-1.0},
  {name:'D2 low < D1 low (deeper)',fn:e=>e.lowAccel<0},
  // Volume checks
  {name:'D2 vol ≥ 0.8× avg',fn:e=>e.volRatio>=0.8},
  {name:'D2 vol ≥ 1.0× avg',fn:e=>e.volRatio>=1.0},
  {name:'D2 vol ≥ 1.5× avg',fn:e=>e.volRatio>=1.5},
  {name:'D2 vol > D1 vol (increasing)',fn:e=>e.volVsD1>1.0},
  {name:'D2 vol > D1 vol × 1.2',fn:e=>e.volVsD1>1.2},
  {name:'D2 vol decreasing (exhaustion→block)',fn:e=>!e.volDecreasing},
  // Selling pressure
  {name:'D2 sell pressure > 0.6',fn:e=>e.sp2>0.6},
  {name:'D2 sell pressure > 0.7',fn:e=>e.sp2>0.7},
  {name:'D2 sell pressure increasing',fn:e=>e.spAccel>0},
  // OBV
  {name:'OBV declining from signal',fn:e=>e.obvDecline},
  // Candle quality
  {name:'D2 is red candle',fn:e=>e.isRedDay2},
  {name:'D2 close in lower 40%',fn:e=>e.closeLowDay2},
  {name:'D2 body ≥ 40%',fn:e=>e.bigBodyDay2},
  {name:'D2 close in lower 35%',fn:e=>e.d2CloseLoc<35},
  {name:'D2 lower wick < 30%',fn:e=>e.d2LwPct<30},
];

console.log('  Condition                            │ Pass BD │ Pass SK │ BD% │ SK% │ SK blocked │ Good gate?');
console.log('  ─────────────────────────────────────┼─────────┼─────────┼─────┼─────┼────────────┼──────────');
for(const cond of conditions){
  const bdPass=trueBreakdowns.filter(cond.fn).length;
  const skPass=falseBreakdowns.filter(cond.fn).length;
  const skBlocked=falseBreakdowns.length-skPass;
  const bdPct=(bdPass/trueBreakdowns.length*100).toFixed(0);
  const skPct=(skPass/falseBreakdowns.length*100).toFixed(0);
  const good=skBlocked>0&&bdPass/trueBreakdowns.length>0.5?'★ YES':'No';
  console.log(`  ${cond.name.padEnd(38)} │ ${String(bdPass).padStart(7)} │ ${String(skPass).padStart(7)} │ ${bdPct.padStart(3)}% │ ${skPct.padStart(3)}% │ ${String(skBlocked).padStart(10)} │ ${good}`);
}

// ═══ PART 3: Combined conditions — find zero-false-stop combos ═══
console.log('\n═══ PART 3: COMBINED DAY 2 CONDITIONS — Zero false stop search ═══\n');
const combos=[
  {name:'Baseline (2-day close only)',fn:()=>true},
  {name:'+ acceleration (D2<D1)',fn:e=>e.closeAccel<0},
  {name:'+ accel + vol≥0.8',fn:e=>e.closeAccel<0&&e.volRatio>=0.8},
  {name:'+ accel + vol>D1',fn:e=>e.closeAccel<0&&e.volVsD1>1.0},
  {name:'+ accel + OBV declining',fn:e=>e.closeAccel<0&&e.obvDecline},
  {name:'+ accel + sellP>0.6',fn:e=>e.closeAccel<0&&e.sp2>0.6},
  {name:'+ accel + red candle',fn:e=>e.closeAccel<0&&e.isRedDay2},
  {name:'+ accel + red + vol≥0.8',fn:e=>e.closeAccel<0&&e.isRedDay2&&e.volRatio>=0.8},
  {name:'+ accel + red + OBV decline',fn:e=>e.closeAccel<0&&e.isRedDay2&&e.obvDecline},
  {name:'+ accel + red + sellP>0.6 + OBV',fn:e=>e.closeAccel<0&&e.isRedDay2&&e.sp2>0.6&&e.obvDecline},
  {name:'+ vol>D1 + OBV decline',fn:e=>e.volVsD1>1.0&&e.obvDecline},
  {name:'+ vol>D1 + red + closeLoc<40',fn:e=>e.volVsD1>1.0&&e.isRedDay2&&e.closeLowDay2},
  {name:'ULTIMATE: accel + red + vol≥0.8 + OBV + sellP>0.6',fn:e=>e.closeAccel<0&&e.isRedDay2&&e.volRatio>=0.8&&e.obvDecline&&e.sp2>0.6},
  {name:'SMART: accel + (vol>D1 OR OBV decline) + red',fn:e=>e.closeAccel<0&&(e.volVsD1>1.0||e.obvDecline)&&e.isRedDay2},
  {name:'PRECISION: accel<-0.5 + red + OBV',fn:e=>e.closeAccel<-0.5&&e.isRedDay2&&e.obvDecline},
];

console.log('  Combination                                      │ BD pass │ SK pass │ SK blocked │ FalseStops │ Verdict');
console.log('  ─────────────────────────────────────────────────┼─────────┼─────────┼────────────┼────────────┼────────');
for(const c of combos){
  const bdPass=trueBreakdowns.filter(c.fn).length;
  const skPass=falseBreakdowns.filter(c.fn).length;
  const verdict=skPass===0?'★ ZERO FALSE':skPass<=1?'EXCELLENT':skPass<=3?'GOOD':'OK';
  console.log(`  ${c.name.padEnd(49)} │ ${String(bdPass).padStart(7)} │ ${String(skPass).padStart(7)} │ ${String(falseBreakdowns.length-skPass).padStart(10)} │ ${String(skPass).padStart(10)} │ ${verdict}`);
}

// ═══ PART 4: Deep dive on the shakeout events — what makes them different? ═══
console.log('\n═══ PART 4: THE SHAKEOUTS — What do they look like on Day 2? ═══\n');
console.log('  Symbol       │ Date       │ D1 Close │ D2 Close │ Accel │ D2 Vol │ OBV   │ SellP │ Red? │ MFE');
console.log('  ─────────────┼────────────┼──────────┼──────────┼───────┼────────┼───────┼───────┼──────┼────');
for(const e of falseBreakdowns.sort((a,b)=>b.closeAccel-a.closeAccel)){
  console.log(`  ${e.sym.padEnd(12)} │ ${(e.date||'—').padEnd(10)} │ ${e.d1Close.toFixed(1).padStart(7)}% │ ${e.d2Close.toFixed(1).padStart(7)}% │ ${(e.closeAccel>=0?'+':'')+e.closeAccel.toFixed(1).padStart(5)} │ ${e.volRatio.toFixed(1).padStart(5)}x │ ${e.obvDecline?'DOWN':'UP  '} │ ${e.sp2.toFixed(2).padStart(5)} │ ${e.isRedDay2?'RED ':'GRN '} │ +${(events.find(x=>x.sym===e.sym&&x.date===e.date))||'?'}`);
}

// ═══ PART 5: Recommended implementation ═══
console.log('\n═══ PART 5: RECOMMENDED DAY 2 CONFIRMATION FORMULA ═══\n');
// Find the best combo that catches max breakdowns with zero false stops
const best=combos.filter(c=>falseBreakdowns.filter(c.fn).length===0)
  .map(c=>({...c,bdPass:trueBreakdowns.filter(c.fn).length}))
  .sort((a,b)=>b.bdPass-a.bdPass);

if(best.length>0){
  console.log(`  BEST: ${best[0].name}`);
  console.log(`  → Catches ${best[0].bdPass} of ${trueBreakdowns.length} true breakdowns (${(best[0].bdPass/trueBreakdowns.length*100).toFixed(1)}%)`);
  console.log(`  → ZERO false stops (all ${falseBreakdowns.length} shakeouts blocked)`);
  console.log(`  → Uses 2-day confirmation (NOT 3 days — 1 day faster exit)`);
}

console.log(`\n  The formula in plain English:`);
console.log(`  "Stop only if Day 2 close is WORSE than Day 1 close (price accelerating down)`);
console.log(`   AND volume confirms the selling (vol rising OR OBV declining)`);
console.log(`   AND the candle is RED (sellers in control, not a green recovery)"`);
