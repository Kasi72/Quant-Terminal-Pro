// ADAPTIVE vs UNION Stop — backtest on 29 OHLCV files
// Approach A: Dynamically SELECT the best filter per candle situation
// Approach B: UNION — stop only if ALL 3 methods agree (consensus)
// Approach C: CASCADING — apply M6 first, then M9, then M12 as layers

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const closes20=[];for(let j=Math.max(0,i-20);j<=i;j++)closes20.push(c[j].c);
    const mean20=closes20.reduce((s,v)=>s+v,0)/closes20.length;
    const std20=Math.sqrt(closes20.reduce((s,v)=>s+(v-mean20)**2,0)/closes20.length);
    let obv=0;for(let j=Math.max(1,i-14);j<=i;j++)obv+=c[j].c>c[j-1].c?c[j].v:c[j].c<c[j-1].c?-c[j].v:0;
    const future=[];let prevOBV=obv;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const zScore=std20>0?(fc.c-entry)/std20:0;
      const closeATR=a[d]>0?(fc.c-entry)/a[d]:0;
      prevOBV+=fc.c>c[d-1].c?fc.v:fc.c<c[d-1].c?-fc.v:0;
      const obvChange=prevOBV-obv;
      const lwPct=range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;
      let consecRed=0;for(let k=d;k>=Math.max(i+1,d-4);k--){if(c[k].c<c[k].o)consecRed++;else break;}
      let rsiG=0,rsiL=0;if(d>=2){const ch1=c[d].c-c[d-1].c,ch2=c[d-1].c-c[d-2].c;rsiG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;rsiL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;}
      const rsi2=rsiL<0.001?100:100-100/(1+rsiG/rsiL);
      future.push({day,o:fc.o,h:fc.h,l:fc.l,c:fc.c,v:fc.v,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        isGreen:fc.c>fc.o,closeLoc,lwPct,volR:v20>0?fc.v/v20:1,
        zScore,closeATR,obvChange,consecRed,rsi2});
    }
    let mfe=0,mae=0;for(const f of future){if(f.pctH>mfe)mfe=f.pctH;if(f.pctL<mae)mae=f.pctL;}
    ALL.push({sym,date:c[i].date,entry,atrVal,zoneLow,v20,stopPct,t1Pct,future,mfe,mae,std20});
  }
}
ALL.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const winners=ALL.filter(s=>s.mfe>=5).length;
console.log(`Signals: ${ALL.length} | Winners: ${winners}\n`);

function sim(signals, name, checkFn){
  let wins=0,losses=0,falseStops=0,winR=0,lossR=0;
  const falseList=[],stoppedList=[];
  for(const s of signals){
    let stopped=false,t1Hit=false,stDay=0,method='';
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      const result=checkFn(s,f);
      if(result){stopped=true;stDay=f.day;method=typeof result==='string'?result:'stop';break;}
    }
    const isFalse=stopped&&s.mfe>=5;
    if(stopped){losses++;lossR+=-1;if(isFalse){falseStops++;falseList.push({...s,stDay,method});}stoppedList.push({...s,stDay,method,isFalse});}
    else if(t1Hit){wins++;winR+=s.t1Pct/s.stopPct;}
  }
  const decided=wins+losses;
  return{name,wins,losses,falseStops,decided,winRate:decided>0?wins/decided*100:0,
    expectancy:decided>0?(winR+lossR)/decided:0,totalR:winR+lossR,falseList,stoppedList};
}

// ═══ BASE FILTERS ═══
function tripleBase(s,f){
  if(f.pctC>-s.stopPct)return false;
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen&&f.closeLoc>=50)return false;
  return true;
}

// ═══ APPROACH A: ADAPTIVE SELECTOR ═══
// Reads the candle situation and picks the BEST filter for that context
function adaptiveSelector(s,f){
  if(f.pctC>-s.stopPct)return false; // close must be below stop

  // Gate 1 — M6: RSI-2 Oversold Shield
  // If RSI-2 < 10, the stock is deeply oversold — DON'T stop, bounce is coming
  if(f.rsi2 < 10) return false;

  // Gate 2 — M9: 2-Day Confirmation
  // If this is the FIRST day closing below stop, wait for confirmation
  const prev=s.future.find(x=>x.day===f.day-1);
  if(!prev || prev.pctC > -s.stopPct) return false; // first day below — don't stop yet

  // Gate 3 — M12: Full statistical battery
  // Now we know: RSI not oversold + 2nd consecutive close below stop
  // Apply remaining M12 filters
  if(f.lwPct>=40&&f.closeLoc>=50)return false; // hammer rejection
  if(f.isGreen&&f.closeLoc>=50)return false; // green recovery
  if(f.closeLoc>=45)return false; // close not in lower portion
  if(f.obvChange>0)return false; // OBV still rising = accumulation
  if(f.volR>3.0&&f.closeLoc>25)return false; // volume climax with recovery

  return 'ADAPTIVE'; // all gates passed — genuine breakdown
}

// ═══ APPROACH B: UNION (all 3 must agree) ═══
function unionFilter(s,f){
  if(f.pctC>-s.stopPct)return false;
  // M6 says stop?
  const m6Stop = f.rsi2 >= 10; // M6 blocks if RSI<10
  // M9 says stop?
  const prev=s.future.find(x=>x.day===f.day-1);
  const m9Stop = prev && prev.pctC <= -s.stopPct; // M9 blocks if first day
  // M12 says stop?
  const m12Stop = !(f.lwPct>=40&&f.closeLoc>=50) && !(f.isGreen&&f.closeLoc>=50)
    && f.closeLoc<45 && f.obvChange<=0 && !(f.volR>3.0&&f.closeLoc>25);
  // ALL 3 must agree
  if(!m6Stop || !m9Stop || !m12Stop) return false;
  return 'UNION';
}

// ═══ APPROACH C: CASCADING GATES ═══
// Same as Adaptive but with explicit gate labeling and slightly different thresholds
function cascadingGates(s,f){
  if(f.pctC>-s.stopPct)return false;

  // GATE 1: RSI-2 Oversold Shield (bounces are near-certain when RSI2<8)
  if(f.rsi2 < 8) return false;

  // GATE 2: Single-Day Shakeout Shield (require 2 consecutive closes below)
  const prev=s.future.find(x=>x.day===f.day-1);
  if(!prev || prev.pctC > -s.stopPct) return false;

  // GATE 3: Candle Rejection Shield
  if(f.lwPct>=40&&f.closeLoc>=50)return false; // hammer
  if(f.isGreen&&f.closeLoc>=50)return false; // green recovery

  // GATE 4: Close Position (must show genuine weakness)
  if(f.closeLoc>=45)return false;

  // GATE 5: OBV Confirmation (volume must confirm selling)
  if(f.obvChange>0)return false;

  // GATE 6: Capitulation Detection (extreme volume + recovery = exhaustion)
  if(f.volR>3.0&&f.closeLoc>25)return false;

  return 'CASCADE';
}

// ═══ APPROACH D: PROBABILITY-WEIGHTED ═══
// Score each factor 0-1, sum up, threshold at 5/8
function probabilityWeighted(s,f){
  if(f.pctC>-s.stopPct)return false;
  let score=0;
  if(!f.isGreen) score+=1;                    // red candle
  if(f.closeLoc<40) score+=1;                 // close in lower 40%
  if(f.rsi2>=10) score+=1;                    // not oversold
  if(f.obvChange<=0) score+=1;                // OBV confirms
  if(f.lwPct<35) score+=1;                    // no hammer
  const prev=s.future.find(x=>x.day===f.day-1);
  if(prev&&prev.pctC<=-s.stopPct) score+=1;   // 2nd day below
  if(f.consecRed>=2) score+=1;                // consecutive reds
  if(f.volR>=0.5) score+=1;                   // not ultra-low volume
  if(score<6) return false;                   // need 6 of 8 (75%)
  return 'PROB_WT';
}

const METHODS = [
  ['CURRENT TRIPLE', (s,f)=>tripleBase(s,f)?'TRIPLE':false],
  ['M6 only: RSI-2 Oversold', (s,f)=>{if(!tripleBase(s,f))return false;if(f.rsi2<10)return false;return 'M6';}],
  ['M9 only: 2-Day Confirm', (s,f)=>{if(f.pctC>-s.stopPct)return false;const p=s.future.find(x=>x.day===f.day-1);if(!p||p.pctC>-s.stopPct)return false;if(f.isGreen&&f.closeLoc>=50)return false;return 'M9';}],
  ['M12 only: ULTIMATE', (s,f)=>{if(f.pctC>-s.stopPct)return false;if(f.lwPct>=40&&f.closeLoc>=50)return false;if(f.isGreen&&f.closeLoc>=50)return false;if(f.closeLoc>=45)return false;if(f.obvChange>0)return false;if(f.rsi2<8)return false;if(f.volR>3.0&&f.closeLoc>25)return false;return 'M12';}],
  ['A: ADAPTIVE SELECTOR', adaptiveSelector],
  ['B: UNION (all 3 agree)', unionFilter],
  ['C: CASCADING GATES', cascadingGates],
  ['D: PROBABILITY-WEIGHTED (6/8)', probabilityWeighted],
];

console.log('█'.repeat(90));
console.log('  ADAPTIVE STOP BACKTEST — 4 COMBINATION APPROACHES');
console.log('█'.repeat(90));
console.log('\n  Method                          │FalseStop│ Wins │ Losses │ WinRate│  Exp/R │ TotalR');
console.log('  ────────────────────────────────┼─────────┼──────┼────────┼────────┼────────┼──────');
const results=[];
for(const[name,fn]of METHODS){
  const r=sim(ALL,name,fn);results.push(r);
  console.log(`  ${name.padEnd(32)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(6)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${r.totalR.toFixed(0).padStart(5)}`);
}

// Detailed comparison of the 4 new approaches
console.log('\n' + '═'.repeat(90));
console.log('  DETAILED COMPARISON');
console.log('═'.repeat(90));
const combo = results.filter(r=>['A: ADAPTIVE SELECTOR','B: UNION (all 3 agree)','C: CASCADING GATES','D: PROBABILITY-WEIGHTED (6/8)'].includes(r.name));
const triple = results.find(r=>r.name==='CURRENT TRIPLE');

console.log(`\n  Metric              │ TRIPLE    │ ADAPTIVE  │ UNION     │ CASCADE   │ PROB-WT`);
console.log('  ────────────────────┼───────────┼───────────┼───────────┼───────────┼─────────');
console.log(`  False stops         │ ${String(triple.falseStops).padStart(9)} │ ${combo.map(c=>String(c.falseStops).padStart(9)).join(' │ ')}`);
console.log(`  Wins                │ ${String(triple.wins).padStart(9)} │ ${combo.map(c=>String(c.wins).padStart(9)).join(' │ ')}`);
console.log(`  Losses              │ ${String(triple.losses).padStart(9)} │ ${combo.map(c=>String(c.losses).padStart(9)).join(' │ ')}`);
console.log(`  Win Rate            │ ${(triple.winRate.toFixed(1)+'%').padStart(9)} │ ${combo.map(c=>(c.winRate.toFixed(1)+'%').padStart(9)).join(' │ ')}`);
console.log(`  Expectancy          │ ${(triple.expectancy.toFixed(3)+'R').padStart(9)} │ ${combo.map(c=>(c.expectancy.toFixed(3)+'R').padStart(9)).join(' │ ')}`);
console.log(`  Total R             │ ${triple.totalR.toFixed(0).padStart(9)} │ ${combo.map(c=>c.totalR.toFixed(0).padStart(9)).join(' │ ')}`);

// False stop details for each approach
for(const r of [...combo]){
  console.log(`\n  ═══ ${r.name}: ${r.falseStops} false stop(s) ═══`);
  if(r.falseList.length===0){console.log('  ★ ZERO false stops!');continue;}
  for(const f of r.falseList){
    console.log(`  ${f.sym} ${f.date} Day${f.stDay} | MFE+${f.mfe.toFixed(1)}% MAE${f.mae.toFixed(1)}% | Method: ${f.method}`);
  }
}

// Walk-forward
console.log('\n' + '═'.repeat(90));
console.log('  WALK-FORWARD VALIDATION (70/30)');
console.log('═'.repeat(90));
const sorted=[...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
for(const[name,fn]of METHODS){
  const isR=sim(sorted.slice(0,sp),name,fn);
  const oosR=sim(sorted.slice(sp),name,fn);
  console.log(`\n  ${name}`);
  console.log(`    IS:  ${isR.wins}W/${isR.losses}L WR=${isR.winRate.toFixed(1)}% Exp=${isR.expectancy.toFixed(3)}R False=${isR.falseStops}`);
  console.log(`    OOS: ${oosR.wins}W/${oosR.losses}L WR=${oosR.winRate.toFixed(1)}% Exp=${oosR.expectancy.toFixed(3)}R False=${oosR.falseStops}`);
}

// Monte Carlo on top approaches
console.log('\n' + '═'.repeat(90));
console.log('  MONTE CARLO (500 shuffles)');
console.log('═'.repeat(90));
for(const[name,fn]of METHODS.filter(([n])=>['CURRENT TRIPLE','A: ADAPTIVE SELECTOR','B: UNION (all 3 agree)','C: CASCADING GATES','D: PROBABILITY-WEIGHTED (6/8)'].includes(n))){
  const mcFS=[],mcWR=[],mcExp=[];
  for(let mc=0;mc<500;mc++){
    const sh=[...ALL].sort(()=>Math.random()-0.5);
    const oos=sh.slice(Math.floor(sh.length*0.70));
    const r=sim(oos,name,fn);
    if(r.decided>0){mcFS.push(r.falseStops);mcWR.push(r.winRate);mcExp.push(r.expectancy);}
  }
  mcFS.sort((a,b)=>a-b);mcWR.sort((a,b)=>a-b);mcExp.sort((a,b)=>a-b);
  const p=(arr,pct)=>arr[Math.floor(arr.length*pct)];
  console.log(`\n  ${name}`);
  console.log(`    FalseStops: median=${p(mcFS,0.5)} 95th=${p(mcFS,0.95)} P(zero)=${(mcFS.filter(f=>f===0).length/mcFS.length*100).toFixed(1)}%`);
  console.log(`    WinRate:    median=${p(mcWR,0.5).toFixed(1)}% 5th=${p(mcWR,0.05).toFixed(1)}%`);
  console.log(`    Expectancy: median=${p(mcExp,0.5).toFixed(3)}R 5th=${p(mcExp,0.05).toFixed(3)}R`);
}

// Equity curve comparison
console.log('\n' + '═'.repeat(90));
console.log('  EQUITY CURVE (Rs.10L, 1% risk)');
console.log('═'.repeat(90));
for(const[name,fn]of METHODS){
  let eq=1000000,peak=1000000,maxDD=0;
  const trades=sim(sorted,name,fn);
  for(const t of trades.stoppedList.concat(
    sorted.filter(s=>{let h=false;for(const f of s.future){if(f.pctH>=s.t1Pct){h=true;break;}if(fn(s,f))break;}return h&&!trades.stoppedList.some(st=>st.sym===s.sym&&st.date===s.date);}).map(s=>({pnlR:s.t1Pct/s.stopPct,isFalse:false}))
  ).sort(()=>0)){
    // simplified — use the sim results
  }
  // Use totalR approach
  const r=trades;
  eq=1000000;peak=eq;maxDD=0;
  // Simulate sequentially
  for(const s of sorted){
    let stopped=false,t1Hit=false;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      if(fn(s,f)){stopped=true;break;}
    }
    if(!stopped&&!t1Hit)continue;
    const pnlR=stopped?-1:s.t1Pct/s.stopPct;
    const risk=eq*0.01;
    eq+=pnlR*risk;
    if(eq>peak)peak=eq;
    const dd=(peak-eq)/peak*100;if(dd>maxDD)maxDD=dd;
  }
  console.log(`  ${name.padEnd(36)} Rs.${(eq/100000).toFixed(1)}L (+${((eq-1000000)/1000000*100).toFixed(0)}%) MaxDD ${maxDD.toFixed(1)}%`);
}
