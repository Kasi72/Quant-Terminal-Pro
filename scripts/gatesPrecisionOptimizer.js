// CASCADING GATES PRECISION OPTIMIZER
// Grid-search every gate threshold + test 8 new scientific gates
// on ALL OHLCV files (29 original + 50 Nifty = ~79 stocks)

const fs=require('fs'),path=require('path');
const DIRS=['C:/Users/drkkr/Downloads/Portfolio'];
const allFiles=[];
for(const dir of DIRS){
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')&&!f.includes('(1)'));
  for(const f of files)allFiles.push(path.join(dir,f));
}
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect ALL breakout signals with rich future candle data
const ALL=[];
for(const fp of allFiles){
  const c=parseCSV(fp);if(c.length<60)continue;
  const sym=path.basename(fp).replace('_NS_OHLCV.csv','');
  const a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    // OBV at signal
    let obv=0;for(let j=Math.max(1,i-20);j<=i;j++)obv+=c[j].c>c[j-1].c?c[j].v:c[j].c<c[j-1].c?-c[j].v:0;
    // Future candles
    const future=[];let prevOBV=obv;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const openP=fc.o,isGreen=openP<fc.c;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;
      const lwPct=range>0?(Math.min(openP,fc.c)-fc.l)/range*100:0;
      const uwPct=range>0?(fc.h-Math.max(openP,fc.c))/range*100:0;
      const bodyPct=range>0?Math.abs(fc.c-openP)/range*100:0;
      const pctC=(fc.c-entry)/entry*100;
      const pctH=(fc.h-entry)/entry*100;
      const pctL=(fc.l-entry)/entry*100;
      // RSI-2 at this candle
      const ch1=d>=i+1?fc.c-(c[d-1]?.c||entry):0;
      const ch2=d>=i+2?(c[d-1]?.c||entry)-(c[d-2]?.c||entry):0;
      const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;
      const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
      const rsi2=rL<0.001?100:100-100/(1+rG/rL);
      // Volume ratio
      const volR=v20>0?fc.v/v20:1;
      // OBV change
      prevOBV+=fc.c>c[d-1].c?fc.v:fc.c<c[d-1].c?-fc.v:0;
      const obvChange=prevOBV-obv;
      // ATR-normalized close distance
      const closeATR=a[d]>0?(fc.c-entry)/a[d]:0;
      // Prev day close
      const prevClose=d>i+1?(c[d-1].c-entry)/entry*100:0;
      // Consecutive red
      let consecRed=0;for(let k=d;k>=Math.max(i+1,d-5);k--){if(c[k].c<c[k].o)consecRed++;else break;}
      // Buying pressure
      const buyP=range>0?(fc.c-fc.l)/range:0.5;

      future.push({day,pctC,pctH,pctL,isGreen,closeLoc,lwPct,uwPct,bodyPct,rsi2,volR,obvChange,closeATR,prevClose,consecRed,buyP,range});
    }
    let mfe=0;for(const f of future)if(f.pctH>mfe)mfe=f.pctH;
    const h5=mfe>=5;
    ALL.push({sym,entry,stopPct,t1Pct,future,mfe,h5,atrVal,zoneLow});
  }
}
const winners=ALL.filter(s=>s.mfe>=5).length;
console.log(`Total signals: ${ALL.length} | Winners: ${winners} | Stocks: ${[...new Set(ALL.map(s=>s.sym))].length}\n`);

// Simulation engine
function simulate(signals, checkFn){
  let falseStops=0,correctStops=0,wins=0,winR=0;
  for(const s of signals){
    let stopped=false,t1Hit=false;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      if(checkFn(s,f)){stopped=true;break;}
    }
    if(stopped){if(s.mfe>=5)falseStops++;else correctStops++;}
    else if(t1Hit){wins++;winR+=s.t1Pct/s.stopPct;}
  }
  const decided=wins+falseStops+correctStops;
  return{falseStops,correctStops,wins,decided,
    winRate:decided>0?wins/decided*100:0,
    expectancy:decided>0?(winR-(falseStops+correctStops))/decided:0,
    totalR:winR-(falseStops+correctStops)};
}

// Current Cascading Gates
const CURRENT=(s,f)=>{
  if(f.pctC>-s.stopPct)return false;
  if(f.rsi2<8)return false; // Gate 1
  if(!s.future.find(x=>x.day===f.day-1)||s.future.find(x=>x.day===f.day-1).pctC>-s.stopPct)return false; // Gate 2
  if(f.lwPct>=40&&f.closeLoc>=50)return false; // Gate 3
  if(f.isGreen&&f.closeLoc>=50)return false; // Gate 4
  if(f.closeLoc>=45)return false; // Gate 5
  return true;
};
const baseline=simulate(ALL,CURRENT);
console.log('█'.repeat(85));
console.log('  CASCADING GATES PRECISION OPTIMIZER');
console.log(`  ${ALL.length} signals · ${winners} winners · ${[...new Set(ALL.map(s=>s.sym))].length} stocks`);
console.log('█'.repeat(85));
console.log(`\n  CURRENT: ${baseline.falseStops} false stops, ${baseline.wins}W, ${baseline.winRate.toFixed(1)}% WR, ${baseline.expectancy.toFixed(3)}R exp\n`);

// ═══ PHASE 1: Optimize each existing gate threshold ═══
console.log('═══ PHASE 1: GATE THRESHOLD OPTIMIZATION ═══\n');

// Gate 1: RSI-2 threshold
console.log('  Gate 1: RSI-2 Oversold Shield');
console.log('  Threshold │ FalseStop │ Wins │ WinRate │ Exp/R');
console.log('  ──────────┼───────────┼──────┼─────────┼──────');
for(const thr of [3,5,8,10,12,15,20]){
  const check=(s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.rsi2<thr)return false;const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=45)return false;return true;};
  const r=simulate(ALL,check);
  console.log(`  RSI2 < ${String(thr).padStart(2)}  │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3)}R ${thr===8?'← CURRENT':''}`);
}

// Gate 2: Consecutive close days
console.log('\n  Gate 2: Consecutive Close Confirmation');
console.log('  Days    │ FalseStop │ Wins │ WinRate │ Exp/R');
console.log('  ────────┼───────────┼──────┼─────────┼──────');
for(const days of [1,2,3]){
  const check=(s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;
    for(let d=1;d<days;d++){const p=s.future.find(x=>x.day===f.day-d);if(!p||p.pctC>-s.stopPct)return false;}
    if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=45)return false;return true;};
  const r=simulate(ALL,check);
  console.log(`  ${days} day(s) │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3)}R ${days===2?'← CURRENT':''}`);
}

// Gate 3: Hammer lwPct threshold
console.log('\n  Gate 3: Hammer Lower Wick Shield');
console.log('  LW Pct  │ FalseStop │ Wins │ WinRate │ Exp/R');
console.log('  ────────┼───────────┼──────┼─────────┼──────');
for(const thr of [30,35,40,45,50]){
  const check=(s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;if(f.lwPct>=thr&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=45)return false;return true;};
  const r=simulate(ALL,check);
  console.log(`  LW≥${String(thr).padStart(2)}%  │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3)}R ${thr===40?'← CURRENT':''}`);
}

// Gate 5: Close location threshold
console.log('\n  Gate 5: Close Position Threshold');
console.log('  CloseLoc│ FalseStop │ Wins │ WinRate │ Exp/R');
console.log('  ────────┼───────────┼──────┼─────────┼──────');
for(const thr of [35,40,45,50,55]){
  const check=(s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=thr)return false;return true;};
  const r=simulate(ALL,check);
  console.log(`  CL≥${String(thr).padStart(2)}%  │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3)}R ${thr===45?'← CURRENT':''}`);
}

// ═══ PHASE 2: Test NEW scientific gates ═══
console.log('\n═══ PHASE 2: NEW SCIENTIFIC GATES (added to current 5 gates) ═══\n');

const newGates=[
  // Gate 6: OBV Confirmation — only stop if OBV declining
  {name:'G6: OBV declining (obvChange≤0)',fn:(s,f)=>{if(f.obvChange>0)return false;return true;}},
  // Gate 7: Volume confirmation — don't stop on low volume
  {name:'G7: Volume ≥ 0.5× avg',fn:(s,f)=>{if(f.volR<0.5)return false;return true;}},
  {name:'G7b: Volume ≥ 0.8× avg',fn:(s,f)=>{if(f.volR<0.8)return false;return true;}},
  // Gate 8: ATR-normalized close — must be >1 ATR below entry
  {name:'G8: Close < -0.75 ATR from entry',fn:(s,f)=>{if(f.closeATR>-0.75)return false;return true;}},
  {name:'G8b: Close < -1.0 ATR from entry',fn:(s,f)=>{if(f.closeATR>-1.0)return false;return true;}},
  // Gate 9: Consecutive red candles — require 2+ red
  {name:'G9: ≥2 consecutive red candles',fn:(s,f)=>{if(f.consecRed<2)return false;return true;}},
  {name:'G9b: ≥3 consecutive red candles',fn:(s,f)=>{if(f.consecRed<3)return false;return true;}},
  // Gate 10: Buying pressure — close must be in bottom 30%
  {name:'G10: Buying pressure < 0.30',fn:(s,f)=>{if(f.buyP>=0.30)return false;return true;}},
  {name:'G10b: Buying pressure < 0.35',fn:(s,f)=>{if(f.buyP>=0.35)return false;return true;}},
  // Gate 11: Body size — require substantial red body (not doji)
  {name:'G11: Body ≥ 30% of range',fn:(s,f)=>{if(f.bodyPct<30)return false;return true;}},
  // Gate 12: Upper wick — no upper wick (pure selling)
  {name:'G12: Upper wick ≤ 20%',fn:(s,f)=>{if(f.uwPct>20)return false;return true;}},
  // Gate 13: No volume climax (>3× = exhaustion, don't stop)
  {name:'G13: Not volume climax (vol<3×)',fn:(s,f)=>{if(f.volR>3.0&&f.closeLoc>25)return false;return true;}},
];

console.log('  New Gate (added to existing 5)         │ FalseStop │ Wins │ WinRate │ Exp/R  │ vs Current');
console.log('  ───────────────────────────────────────┼───────────┼──────┼─────────┼────────┼──────────');
const gateResults=[];
for(const g of newGates){
  const check=(s,f)=>{
    if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;
    const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;
    if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;
    if(f.closeLoc>=45)return false;
    if(!g.fn(s,f))return false; // new gate
    return true;
  };
  const r=simulate(ALL,check);
  const delta=r.falseStops-baseline.falseStops;
  gateResults.push({...g,...r,delta});
  console.log(`  ${g.name.padEnd(39)} │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${delta<=0?delta+' fewer':'+'+(delta)+' more'}`);
}

// ═══ PHASE 3: Stack the best new gates ═══
console.log('\n═══ PHASE 3: STACKED COMBINATIONS — Best new gates combined ═══\n');
const combos=[
  {name:'Current 5 gates (baseline)',gates:[]},
  {name:'+OBV declining',gates:[(s,f)=>f.obvChange<=0]},
  {name:'+OBV + consecRed≥2',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.consecRed>=2]},
  {name:'+OBV + body≥30%',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.bodyPct>=30]},
  {name:'+OBV + volClimaxBlock',gates:[(s,f)=>f.obvChange<=0,(s,f)=>!(f.volR>3.0&&f.closeLoc>25)]},
  {name:'+OBV + buyP<0.35',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.buyP<0.35]},
  {name:'+OBV + buyP<0.35 + body≥30%',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.buyP<0.35,(s,f)=>f.bodyPct>=30]},
  {name:'+OBV + consecRed≥2 + volClimaxBlock',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.consecRed>=2,(s,f)=>!(f.volR>3.0&&f.closeLoc>25)]},
  {name:'+closeATR<-0.75 + OBV',gates:[(s,f)=>f.closeATR<=-0.75,(s,f)=>f.obvChange<=0]},
  {name:'ULTIMATE: +OBV + buyP<0.35 + body≥30% + volClimaxBlock',gates:[(s,f)=>f.obvChange<=0,(s,f)=>f.buyP<0.35,(s,f)=>f.bodyPct>=30,(s,f)=>!(f.volR>3.0&&f.closeLoc>25)]},
];

console.log('  Combination                                      │ FalseStop │ Wins │ WinRate │ Exp/R  │ΔFalse');
console.log('  ─────────────────────────────────────────────────┼───────────┼──────┼─────────┼────────┼──────');
for(const c of combos){
  const check=(s,f)=>{
    if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;
    const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;
    if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;
    if(f.closeLoc>=45)return false;
    for(const g of c.gates)if(!g(s,f))return false;
    return true;
  };
  const r=simulate(ALL,check);
  console.log(`  ${c.name.padEnd(49)} │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${r.falseStops-baseline.falseStops}`);
}

// ═══ PHASE 4: Walk-forward on best combo ═══
console.log('\n═══ PHASE 4: WALK-FORWARD VALIDATION ═══\n');
const sorted=[...ALL].sort((a,b)=>(a.sym+a.entry).localeCompare(b.sym+b.entry));
const sp=Math.floor(sorted.length*0.70);
const IS=sorted.slice(0,sp),OOS=sorted.slice(sp);
for(const[name,gates]of[
  ['Current 5 gates',[]],
  ['ULTIMATE (+OBV+buyP+body+climax)',[(s,f)=>f.obvChange<=0,(s,f)=>f.buyP<0.35,(s,f)=>f.bodyPct>=30,(s,f)=>!(f.volR>3.0&&f.closeLoc>25)]],
]){
  const check=(s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.rsi2<8)return false;const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=45)return false;for(const g of gates)if(!g(s,f))return false;return true;};
  const isR=simulate(IS,check),oosR=simulate(OOS,check);
  console.log(`  ${name}`);
  console.log(`    IS:  ${isR.falseStops} false, ${isR.wins}W, WR ${isR.winRate.toFixed(1)}%, Exp ${isR.expectancy.toFixed(3)}R`);
  console.log(`    OOS: ${oosR.falseStops} false, ${oosR.wins}W, WR ${oosR.winRate.toFixed(1)}%, Exp ${oosR.expectancy.toFixed(3)}R`);
}
