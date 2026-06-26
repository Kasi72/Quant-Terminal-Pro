// Scientific Drawdown Reduction Engine — 8 methods backtested on 29 OHLCV files
// Goal: reduce max DD from 7.2% without killing expectancy

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect all signals with TRIPLE stop simulation
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
    const newStopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,newStopRaw));
    const atrPct=atrVal/entry*100;
    // Signal quality score (for tiering)
    const cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100;
    const vR=v20>0?s.v/v20:1;
    let quality=0;if(cl>=75)quality+=2;else if(cl>=65)quality+=1;if(bp>=45)quality+=2;else if(bp>=35)quality+=1;
    if(uw<=25)quality+=2;else if(uw<=35)quality+=1;if(vR>=2.0)quality+=2;else if(vR>=1.5)quality+=1;
    // Future simulation with TRIPLE
    const future=[];
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],range=fc.h-fc.l;
      future.push({day:d-i,h:fc.h,l:fc.l,c:fc.c,o:fc.o,v:fc.v,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        isGreen:fc.c>fc.o,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,volR:v20>0?fc.v/v20:1});
    }
    let outcome='EXPIRED',pnlR=0,exitDay=10,exitPct=0;
    for(const f of future){
      if(f.pctH>=t1Pct){outcome='T1_HIT';pnlR=t1Pct/stopPct;exitDay=f.day;exitPct=t1Pct;break;}
      if(f.pctC<=-stopPct){
        const isH=f.lwPct>=40&&f.closeLoc>=50,isR=f.isGreen&&f.closeLoc>=50;
        if(!isH&&!isR){outcome='STOPPED';pnlR=-1;exitDay=f.day;exitPct=-stopPct;break;}
      }
    }
    // Day-by-day P&L for time-decay analysis
    const dayPnl=future.map(f=>f.pctC);
    // Max favorable excursion by day 3/5
    let mfe3=0,mfe5=0,mfe10=0;
    for(const f of future){if(f.pctH>mfe10)mfe10=f.pctH;if(f.day<=5&&f.pctH>mfe5)mfe5=f.pctH;if(f.day<=3&&f.pctH>mfe3)mfe3=f.pctH;}

    ALL.push({sym,date:c[i].date,ts:s.ts,entry,atrVal,atrPct,stopPct,t1Pct,quality,
      outcome,pnlR,exitDay,exitPct,dayPnl,mfe3,mfe5,mfe10,future,cl,bp,uw,vR});
  }
}
// Sort by date for sequential simulation
ALL.sort((a,b)=>a.ts-b.ts);
console.log(`Total signals (time-sorted): ${ALL.length}\n`);

function runEquityCurve(trades, riskFn) {
  let equity=1000000, peak=1000000, maxDD=0, maxDDpct=0;
  let wins=0,losses=0,consecLoss=0,maxConsecLoss=0,totalR=0;
  const curve=[];
  for(let i=0;i<trades.length;i++){
    const t=trades[i];
    if(t.outcome==='EXPIRED')continue;
    const riskPct = riskFn(i, trades, equity, peak, consecLoss, t);
    if(riskPct <= 0) continue; // skip trade
    const riskAmt = equity * riskPct / 100;
    const pnl = t.pnlR * riskAmt;
    equity += pnl;
    totalR += t.pnlR;
    if(t.pnlR>0){wins++;consecLoss=0;}else{losses++;consecLoss++;if(consecLoss>maxConsecLoss)maxConsecLoss=consecLoss;}
    if(equity>peak)peak=equity;
    const dd=(peak-equity)/peak*100;if(dd>maxDDpct)maxDDpct=dd;
    curve.push({i,equity,dd,pnlR:t.pnlR,riskPct});
  }
  const decided=wins+losses;
  return{equity,peak,maxDDpct,wins,losses,decided,maxConsecLoss,totalR,
    winRate:decided>0?wins/decided*100:0,expectancy:decided>0?totalR/decided:0,
    returnPct:(equity-1000000)/1000000*100,curve};
}

// ═══ METHODS ═══

const METHODS = [
  // 0: Baseline — fixed 1% risk
  { name: 'BASELINE: Fixed 1% risk',
    fn: () => 1.0 },

  // 1: Half-Kelly — risk = 0.5 × (WR×avgWin - (1-WR)×avgLoss) / avgWin
  // Computed from rolling 20-trade window
  { name: 'M1: Half-Kelly sizing',
    fn: (i, trades) => {
      const lookback = trades.slice(Math.max(0,i-20),i).filter(t=>t.outcome!=='EXPIRED');
      if(lookback.length<5)return 0.5;
      const w=lookback.filter(t=>t.pnlR>0),l=lookback.filter(t=>t.pnlR<=0);
      const wr=w.length/lookback.length;
      const avgW=w.length>0?w.reduce((s,t)=>s+t.pnlR,0)/w.length:1;
      const avgL=l.length>0?Math.abs(l.reduce((s,t)=>s+t.pnlR,0)/l.length):1;
      const kelly=avgL>0?(wr*avgW-(1-wr)*avgL)/avgW:0;
      return Math.max(0.25, Math.min(2.0, kelly*50)); // half-kelly as %
    }},

  // 2: Anti-martingale — reduce size after consecutive losses
  { name: 'M2: Anti-martingale (reduce on loss streak)',
    fn: (i, trades, eq, pk, consecLoss) => {
      if(consecLoss>=3) return 0.25;
      if(consecLoss>=2) return 0.5;
      if(consecLoss>=1) return 0.75;
      return 1.0;
    }},

  // 3: Equity curve filter — skip trades when equity < 10-trade SMA of equity
  { name: 'M3: Equity curve trading (skip below EMA)',
    fn: (i, trades, eq, pk, cl, t) => {
      if(i<10)return 1.0;
      // Compute rolling equity avg from curve
      const recent=trades.slice(Math.max(0,i-10),i).filter(t=>t.outcome!=='EXPIRED');
      if(recent.length<5)return 1.0;
      const recentPnl=recent.reduce((s,t)=>s+t.pnlR,0);
      if(recentPnl<-2)return 0; // equity declining — skip
      return 1.0;
    }},

  // 4: Signal quality tiering — stronger signals get bigger position
  { name: 'M4: Quality-tiered sizing',
    fn: (i, trades, eq, pk, cl, t) => {
      if(t.quality>=7)return 1.5;  // elite signal
      if(t.quality>=5)return 1.0;  // good signal
      if(t.quality>=3)return 0.5;  // average signal
      return 0.25;                  // weak signal
    }},

  // 5: Volatility-scaled — lower risk% when ATR is high (more volatile)
  { name: 'M5: Volatility-scaled risk (lower size on high ATR)',
    fn: (i, trades, eq, pk, cl, t) => {
      if(t.atrPct >= 5.0)return 0.5;  // very volatile
      if(t.atrPct >= 3.5)return 0.75; // moderate
      if(t.atrPct >= 2.0)return 1.0;  // normal
      return 1.25;                     // low vol — can size up
    }},

  // 6: Time-decay exit — if no +1.5% progress by Day 3, exit at market
  { name: 'M6: Time-decay exit (exit Day3 if no progress)',
    fn: () => 1.0 }, // same sizing, but we modify the trades

  // 7: Drawdown throttle — reduce to 0.5% when DD > 3%, pause at DD > 5%
  { name: 'M7: Drawdown throttle (reduce at 3%DD, pause at 5%DD)',
    fn: (i, trades, eq, pk) => {
      const dd = pk > 0 ? (pk-eq)/pk*100 : 0;
      if(dd >= 5.0) return 0;     // pause trading
      if(dd >= 3.0) return 0.5;   // half size
      return 1.0;
    }},

  // 8: COMBO — Anti-martingale + Quality tier + DD throttle
  { name: '★ M8: COMBO (anti-mart + quality + DD throttle)',
    fn: (i, trades, eq, pk, consecLoss, t) => {
      let base = 1.0;
      // Quality tier
      if(t.quality>=7)base=1.25;else if(t.quality>=5)base=1.0;else if(t.quality>=3)base=0.6;else base=0.3;
      // Anti-martingale
      if(consecLoss>=3)base*=0.25;else if(consecLoss>=2)base*=0.5;else if(consecLoss>=1)base*=0.75;
      // DD throttle
      const dd=pk>0?(pk-eq)/pk*100:0;
      if(dd>=5)return 0;if(dd>=3)base*=0.5;
      return Math.max(0.1, Math.min(2.0, base));
    }},
];

// For M6 (time-decay), create modified trades
const tradesM6 = ALL.map(t => {
  if(t.outcome==='T1_HIT'&&t.exitDay<=3)return t; // hit T1 fast — keep
  if(t.outcome==='STOPPED'&&t.exitDay<=3)return t; // stopped fast — keep
  // Check day 3 close
  if(t.dayPnl.length>=3){
    const day3pnl=t.dayPnl[2]; // day 3 close %
    if(day3pnl<1.5){
      // Exit at day 3 close
      return{...t,outcome:'TIME_EXIT',pnlR:day3pnl/t.stopPct,exitDay:3};
    }
  }
  return t;
});

console.log('█'.repeat(85));
console.log('  SCIENTIFIC DRAWDOWN REDUCTION — 9 METHODS BACKTESTED');
console.log('  29 OHLCV files · '+ALL.length+' signals · Rs.10L start · 10-day horizon');
console.log('█'.repeat(85));

console.log('\n  Method                                        │ Final Eq │ Return │ MaxDD  │ WR     │ Exp/R  │ MaxCL');
console.log('  ──────────────────────────────────────────────┼──────────┼────────┼────────┼────────┼────────┼──────');

const allResults = [];
for(let m=0;m<METHODS.length;m++){
  const method=METHODS[m];
  const input = m===6 ? tradesM6 : ALL; // M6 uses modified trades
  const r = runEquityCurve(input, method.fn);
  allResults.push({name:method.name,...r});
  const eq=`Rs.${(r.equity/100000).toFixed(1)}L`;
  console.log(`  ${method.name.padEnd(46)} │ ${eq.padStart(8)} │ ${(r.returnPct>=0?'+':'')+r.returnPct.toFixed(1)+'%'.padStart(6)} │ ${r.maxDDpct.toFixed(1).padStart(5)}% │ ${r.winRate.toFixed(1).padStart(5)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${String(r.maxConsecLoss).padStart(5)}`);
}

// Rank by lowest MaxDD with positive return
console.log('\n' + '═'.repeat(85));
console.log('  RANKED BY LOWEST MAX DRAWDOWN (positive return required)');
console.log('═'.repeat(85));
const ranked=allResults.filter(r=>r.returnPct>0).sort((a,b)=>a.maxDDpct-b.maxDDpct);
console.log('\n  Rank │ Method                                        │ MaxDD  │ Return │ Exp/R');
console.log('  ─────┼───────────────────────────────────────────────┼────────┼────────┼──────');
for(let i=0;i<ranked.length;i++){
  const r=ranked[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(45)} │ ${r.maxDDpct.toFixed(1).padStart(5)}% │ ${('+'+r.returnPct.toFixed(1)+'%').padStart(6)} │ ${r.expectancy.toFixed(3)}R`);
}

// Deep dive on top 3
for(const r of ranked.slice(0,3)){
  console.log(`\n  ═══ ${r.name} ═══`);
  console.log(`  Equity: Rs.${(r.equity/100000).toFixed(1)}L | Return: +${r.returnPct.toFixed(1)}% | MaxDD: ${r.maxDDpct.toFixed(1)}% | WR: ${r.winRate.toFixed(1)}% | Wins: ${r.wins} | Losses: ${r.losses}`);
  // DD episodes
  let inDD=false,ddStart=0,episodes=[];
  for(let i=0;i<r.curve.length;i++){
    if(r.curve[i].dd>1&&!inDD){inDD=true;ddStart=i;}
    if(r.curve[i].dd<0.5&&inDD){inDD=false;episodes.push({start:ddStart,end:i,maxDD:Math.max(...r.curve.slice(ddStart,i+1).map(c=>c.dd)),len:i-ddStart});}
  }
  if(episodes.length>0){
    console.log(`  Drawdown episodes >1%: ${episodes.length}`);
    episodes.sort((a,b)=>b.maxDD-a.maxDD);
    for(const ep of episodes.slice(0,5)){
      console.log(`    DD ${ep.maxDD.toFixed(1)}% lasting ${ep.len} trades`);
    }
  }
}

// Walk-forward on COMBO
console.log('\n' + '═'.repeat(85));
console.log('  WALK-FORWARD: COMBO method (70/30 split)');
console.log('═'.repeat(85));
const sp=Math.floor(ALL.length*0.70);
const isR=runEquityCurve(ALL.slice(0,sp), METHODS[8].fn);
const oosR=runEquityCurve(ALL.slice(sp), METHODS[8].fn);
console.log(`  IS:  Return +${isR.returnPct.toFixed(1)}%, MaxDD ${isR.maxDDpct.toFixed(1)}%, WR ${isR.winRate.toFixed(1)}%`);
console.log(`  OOS: Return +${oosR.returnPct.toFixed(1)}%, MaxDD ${oosR.maxDDpct.toFixed(1)}%, WR ${oosR.winRate.toFixed(1)}%`);

// Monte Carlo on COMBO — 1000 shuffles
console.log('\n' + '═'.repeat(85));
console.log('  MONTE CARLO: COMBO method (1000 shuffles)');
console.log('═'.repeat(85));
const mcDD=[],mcRet=[];
for(let mc=0;mc<1000;mc++){
  const sh=[...ALL].sort(()=>Math.random()-0.5);
  const r=runEquityCurve(sh, METHODS[8].fn);
  mcDD.push(r.maxDDpct);mcRet.push(r.returnPct);
}
mcDD.sort((a,b)=>a-b);mcRet.sort((a,b)=>a-b);
const pctl=(arr,p)=>arr[Math.floor(arr.length*p)];
console.log(`  MaxDD 5th pctl:  ${pctl(mcDD,0.05).toFixed(1)}%`);
console.log(`  MaxDD Median:    ${pctl(mcDD,0.50).toFixed(1)}%`);
console.log(`  MaxDD 95th pctl: ${pctl(mcDD,0.95).toFixed(1)}%`);
console.log(`  MaxDD Mean:      ${(mcDD.reduce((s,v)=>s+v,0)/mcDD.length).toFixed(1)}%`);
console.log(`  Return Median:   +${pctl(mcRet,0.50).toFixed(1)}%`);
console.log(`  P(DD<5%):        ${(mcDD.filter(d=>d<5).length/mcDD.length*100).toFixed(1)}%`);
console.log(`  P(DD<3%):        ${(mcDD.filter(d=>d<3).length/mcDD.length*100).toFixed(1)}%`);
console.log(`  P(Return>100%):  ${(mcRet.filter(r=>r>100).length/mcRet.length*100).toFixed(1)}%`);

// Compare baseline vs COMBO vs best
console.log('\n' + '█'.repeat(85));
console.log('  FINAL COMPARISON: Baseline vs COMBO');
console.log('█'.repeat(85));
const base=allResults[0],combo=allResults[8];
console.log(`\n  Metric          │ Baseline (1% fixed)   │ ★ COMBO`);
console.log('  ────────────────┼───────────────────────┼─────────────────────');
console.log(`  Max Drawdown    │ ${base.maxDDpct.toFixed(1).padStart(20)}% │ ${combo.maxDDpct.toFixed(1).padStart(19)}%`);
console.log(`  Return          │ ${('+'+base.returnPct.toFixed(1)+'%').padStart(21)} │ ${('+'+combo.returnPct.toFixed(1)+'%').padStart(20)}`);
console.log(`  Win Rate        │ ${base.winRate.toFixed(1).padStart(20)}% │ ${combo.winRate.toFixed(1).padStart(19)}%`);
console.log(`  Expectancy      │ ${base.expectancy.toFixed(3).padStart(20)}R │ ${combo.expectancy.toFixed(3).padStart(19)}R`);
console.log(`  Max Consec Loss │ ${String(base.maxConsecLoss).padStart(21)} │ ${String(combo.maxConsecLoss).padStart(20)}`);
console.log(`  DD Reduction    │                       │ ${((1-combo.maxDDpct/base.maxDDpct)*100).toFixed(0)}%`);
