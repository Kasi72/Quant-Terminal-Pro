// FINAL COMPREHENSIVE BACKTEST: TRIPLE Dynamic Stop v5-WLB
// Tests on ALL 29 OHLCV files with full 10-day simulation
// Compares OLD stop vs NEW TRIPLE stop across every metric

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
    // Old stop
    const oldStopPct=Math.max(2,Math.min(3.5,0.75*atrVal/entry*100));
    // New stop: ZoneLow-0.5ATR [3.5%,8%]
    const newStopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const newStopPct=Math.max(3.5,Math.min(8,newStopRaw));
    // Future candles
    const future=[];
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i;
      const range=fc.h-fc.l;
      future.push({day,o:fc.o,h:fc.h,l:fc.l,c:fc.c,v:fc.v,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        isGreen:fc.c>fc.o,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,
        volR:v20>0?fc.v/v20:1});
    }
    let mfe=0,mae=0;for(const f of future){if(f.pctH>mfe)mfe=f.pctH;if(f.pctL<mae)mae=f.pctL;}
    ALL.push({sym,date:c[i].date,entry,atrVal,zoneLow,v20,oldStopPct,newStopPct,t1Pct,future,mfe,mae});
  }
}

function simOld(signals){
  let wins=0,losses=0,falseStops=0,winR=0,lossR=0,expired=0;
  const trades=[];
  for(const s of signals){
    let stopped=false,t1Hit=false,stDay=0,t1Day=0;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;t1Day=f.day;break;}
      if(f.pctL<=-s.oldStopPct){stopped=true;stDay=f.day;break;}
    }
    const isFalse=stopped&&s.mfe>=5;
    if(stopped){losses++;lossR+=-1;if(isFalse)falseStops++;trades.push({...s,outcome:'STOPPED',day:stDay,pnlR:-1,isFalse});}
    else if(t1Hit){wins++;const r=s.t1Pct/s.oldStopPct;winR+=r;trades.push({...s,outcome:'T1_HIT',day:t1Day,pnlR:r,isFalse:false});}
    else{expired++;trades.push({...s,outcome:'EXPIRED',day:10,pnlR:0,isFalse:false});}
  }
  const decided=wins+losses;
  return{wins,losses,falseStops,expired,decided,winRate:decided>0?wins/decided*100:0,
    avgWinR:wins>0?winR/wins:0,expectancy:decided>0?(winR+lossR)/decided:0,totalR:winR+lossR,trades};
}

function simTriple(signals){
  let wins=0,losses=0,falseStops=0,winR=0,lossR=0,expired=0;
  const trades=[];
  for(const s of signals){
    let stopped=false,t1Hit=false,stDay=0,t1Day=0;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;t1Day=f.day;break;}
      // TRIPLE: close below + not hammer + not green recovery
      if(f.pctC<=-s.newStopPct){
        const isHammer=f.lwPct>=40&&f.closeLoc>=50;
        const isRecovery=f.isGreen&&f.closeLoc>=50;
        if(!isHammer&&!isRecovery){stopped=true;stDay=f.day;break;}
      }
    }
    const isFalse=stopped&&s.mfe>=5;
    if(stopped){losses++;lossR+=-1;if(isFalse)falseStops++;trades.push({...s,outcome:'STOPPED',day:stDay,pnlR:-1,isFalse});}
    else if(t1Hit){wins++;const r=s.t1Pct/s.newStopPct;winR+=r;trades.push({...s,outcome:'T1_HIT',day:t1Day,pnlR:r,isFalse:false});}
    else{expired++;trades.push({...s,outcome:'EXPIRED',day:10,pnlR:0,isFalse:false});}
  }
  const decided=wins+losses;
  return{wins,losses,falseStops,expired,decided,winRate:decided>0?wins/decided*100:0,
    avgWinR:wins>0?winR/wins:0,expectancy:decided>0?(winR+lossR)/decided:0,totalR:winR+lossR,trades};
}

const old=simOld(ALL),tri=simTriple(ALL);
const winners=ALL.filter(s=>s.mfe>=5).length;

console.log('█'.repeat(80));
console.log('  FINAL BACKTEST: OLD STOP vs TRIPLE DYNAMIC STOP');
console.log('  29 OHLCV files · '+ALL.length+' breakout signals · 10-day timeframe');
console.log('█'.repeat(80));

console.log(`\n  Metric                    │ OLD (0.75ATR [2%,3.5%])  │ TRIPLE (ZoneLow-0.5ATR [3.5%,8%])`);
console.log('  ──────────────────────────┼──────────────────────────┼───────────────────────────────────');
console.log(`  T1 Winners                │ ${String(old.wins).padStart(24)} │ ${String(tri.wins).padStart(33)}`);
console.log(`  Stopped (losses)          │ ${String(old.losses).padStart(24)} │ ${String(tri.losses).padStart(33)}`);
console.log(`  Expired (no decision)     │ ${String(old.expired).padStart(24)} │ ${String(tri.expired).padStart(33)}`);
console.log(`  FALSE stops (winners killed)│ ${String(old.falseStops).padStart(22)} │ ${String(tri.falseStops).padStart(33)}`);
console.log(`  False stop rate           │ ${(old.falseStops/winners*100).toFixed(1).padStart(23)}% │ ${(tri.falseStops/winners*100).toFixed(1).padStart(32)}%`);
console.log(`  Win rate (decided)        │ ${old.winRate.toFixed(1).padStart(23)}% │ ${tri.winRate.toFixed(1).padStart(32)}%`);
console.log(`  Avg Win R                 │ ${old.avgWinR.toFixed(2).padStart(23)}R │ ${tri.avgWinR.toFixed(2).padStart(32)}R`);
console.log(`  Expectancy per trade      │ ${old.expectancy.toFixed(3).padStart(23)}R │ ${tri.expectancy.toFixed(3).padStart(32)}R`);
console.log(`  Total R (all decided)     │ ${old.totalR.toFixed(1).padStart(23)}R │ ${tri.totalR.toFixed(1).padStart(32)}R`);

// Improvement summary
console.log('\n  ═══ IMPROVEMENT SUMMARY ═══');
console.log(`  Winners rescued:      +${tri.wins - old.wins} trades now hit T1 instead of being stopped`);
console.log(`  False stops eliminated: ${old.falseStops - tri.falseStops} (${old.falseStops}→${tri.falseStops}, -${((1-tri.falseStops/old.falseStops)*100).toFixed(0)}%)`);
console.log(`  Win rate gain:        +${(tri.winRate - old.winRate).toFixed(1)}% (${old.winRate.toFixed(1)}%→${tri.winRate.toFixed(1)}%)`);
console.log(`  Expectancy gain:      ${(tri.expectancy-old.expectancy)>=0?'+':''}${(tri.expectancy-old.expectancy).toFixed(3)}R per trade`);

// Per-stock breakdown
console.log('\n' + '═'.repeat(80));
console.log('  PER-STOCK RESULTS');
console.log('═'.repeat(80));
const stocks=[...new Set(ALL.map(s=>s.sym))].sort();
console.log('\n  Stock        │ Signals │ OLD:Wins/Stop/False │ TRIPLE:Wins/Stop/False │ Δ Wins');
console.log('  ─────────────┼─────────┼─────────────────────┼────────────────────────┼──────');
for(const sym of stocks){
  const sigs=ALL.filter(s=>s.sym===sym);
  const oT=simOld(sigs),tT=simTriple(sigs);
  console.log(`  ${sym.padEnd(12)} │ ${String(sigs.length).padStart(7)} │ ${String(oT.wins).padStart(4)}/${String(oT.losses).padStart(4)}/${String(oT.falseStops).padStart(4)}        │ ${String(tT.wins).padStart(4)}/${String(tT.losses).padStart(4)}/${String(tT.falseStops).padStart(4)}          │ ${(tT.wins-oT.wins>=0?'+':'')+String(tT.wins-oT.wins).padStart(4)}`);
}

// Day-by-day analysis
console.log('\n' + '═'.repeat(80));
console.log('  DAY-BY-DAY STOP DISTRIBUTION');
console.log('═'.repeat(80));
console.log('\n  Day │ OLD:Stops │ OLD:False │ TRIPLE:Stops │ TRIPLE:False │ Reduction');
console.log('  ────┼──────────┼───────────┼──────────────┼──────────────┼─────────');
for(let d=1;d<=10;d++){
  const oS=old.trades.filter(t=>t.outcome==='STOPPED'&&t.day===d).length;
  const oF=old.trades.filter(t=>t.outcome==='STOPPED'&&t.day===d&&t.isFalse).length;
  const tS=tri.trades.filter(t=>t.outcome==='STOPPED'&&t.day===d).length;
  const tF=tri.trades.filter(t=>t.outcome==='STOPPED'&&t.day===d&&t.isFalse).length;
  const red=oS>0?((1-tS/oS)*100).toFixed(0)+'%':'—';
  console.log(`  ${String(d).padStart(3)} │ ${String(oS).padStart(8)} │ ${String(oF).padStart(9)} │ ${String(tS).padStart(12)} │ ${String(tF).padStart(12)} │ ${red.padStart(8)}`);
}

// Remaining false stops detail
console.log('\n' + '═'.repeat(80));
console.log(`  REMAINING FALSE STOPS IN TRIPLE (${tri.falseStops} total)`);
console.log('═'.repeat(80));
const falseDetail=tri.trades.filter(t=>t.isFalse).sort((a,b)=>b.mfe-a.mfe);
if(falseDetail.length>0){
  console.log('\n  Symbol       │ Date       │ StopDay │ StopPct │ MFE    │ MAE    │ Why not filtered');
  for(const t of falseDetail){
    const f=t.future.find(f=>f.day===t.day);
    const why=f?`Close ${f.pctC.toFixed(1)}%, Vol ${f.volR.toFixed(1)}x, LW ${f.lwPct.toFixed(0)}%, ${f.isGreen?'Green':'Red'}`:'—';
    console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${String(t.day).padStart(7)} │ ${t.newStopPct.toFixed(1).padStart(6)}% │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}% │ ${why}`);
  }
} else { console.log('\n  ZERO false stops! Perfect.'); }

// Walk-forward 70/30
console.log('\n' + '═'.repeat(80));
console.log('  WALK-FORWARD VALIDATION (70/30 time split)');
console.log('═'.repeat(80));
const sorted=[...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
const isOld=simOld(sorted.slice(0,sp)),oosOld=simOld(sorted.slice(sp));
const isTri=simTriple(sorted.slice(0,sp)),oosTri=simTriple(sorted.slice(sp));
console.log(`\n                │ In-Sample (70%)                  │ Out-of-Sample (30%)`);
console.log('  ──────────────┼──────────────────────────────────┼──────────────────────');
console.log(`  OLD WR/Exp    │ ${isOld.winRate.toFixed(1)}% / ${isOld.expectancy.toFixed(3)}R (${isOld.decided} trades) │ ${oosOld.winRate.toFixed(1)}% / ${oosOld.expectancy.toFixed(3)}R (${oosOld.decided} trades)`);
console.log(`  TRIPLE WR/Exp │ ${isTri.winRate.toFixed(1)}% / ${isTri.expectancy.toFixed(3)}R (${isTri.decided} trades) │ ${oosTri.winRate.toFixed(1)}% / ${oosTri.expectancy.toFixed(3)}R (${oosTri.decided} trades)`);
console.log(`  TRIPLE OOS false stops: ${oosTri.falseStops}`);

// Monte Carlo
console.log('\n' + '═'.repeat(80));
console.log('  MONTE CARLO (1000 random 70/30 shuffles)');
console.log('═'.repeat(80));
const mcOld=[],mcTri=[];
for(let mc=0;mc<1000;mc++){
  const sh=[...ALL].sort(()=>Math.random()-0.5);
  const oos=sh.slice(Math.floor(sh.length*0.70));
  const oR=simOld(oos),tR=simTriple(oos);
  if(oR.decided>0)mcOld.push({wr:oR.winRate,exp:oR.expectancy,fs:oR.falseStops});
  if(tR.decided>0)mcTri.push({wr:tR.winRate,exp:tR.expectancy,fs:tR.falseStops});
}
mcOld.sort((a,b)=>a.wr-b.wr);mcTri.sort((a,b)=>a.wr-b.wr);
const p=(arr,pct)=>arr[Math.floor(arr.length*pct)];
console.log(`\n  Metric           │ OLD Stop              │ TRIPLE Stop`);
console.log('  ─────────────────┼───────────────────────┼────────────────────');
console.log(`  WR 5th pctl      │ ${p(mcOld,0.05).wr.toFixed(1).padStart(20)}% │ ${p(mcTri,0.05).wr.toFixed(1).padStart(18)}%`);
console.log(`  WR Median        │ ${p(mcOld,0.50).wr.toFixed(1).padStart(20)}% │ ${p(mcTri,0.50).wr.toFixed(1).padStart(18)}%`);
console.log(`  WR 95th pctl     │ ${p(mcOld,0.95).wr.toFixed(1).padStart(20)}% │ ${p(mcTri,0.95).wr.toFixed(1).padStart(18)}%`);
console.log(`  Exp 5th pctl     │ ${p(mcOld,0.05).exp.toFixed(3).padStart(20)}R │ ${p(mcTri,0.05).exp.toFixed(3).padStart(18)}R`);
console.log(`  Exp Median       │ ${p(mcOld,0.50).exp.toFixed(3).padStart(20)}R │ ${p(mcTri,0.50).exp.toFixed(3).padStart(18)}R`);
console.log(`  P(WR≥60%)        │ ${(mcOld.filter(m=>m.wr>=60).length/mcOld.length*100).toFixed(1).padStart(20)}% │ ${(mcTri.filter(m=>m.wr>=60).length/mcTri.length*100).toFixed(1).padStart(18)}%`);
console.log(`  P(WR≥70%)        │ ${(mcOld.filter(m=>m.wr>=70).length/mcOld.length*100).toFixed(1).padStart(20)}% │ ${(mcTri.filter(m=>m.wr>=70).length/mcTri.length*100).toFixed(1).padStart(18)}%`);
console.log(`  P(Exp>0)         │ ${(mcOld.filter(m=>m.exp>0).length/mcOld.length*100).toFixed(1).padStart(20)}% │ ${(mcTri.filter(m=>m.exp>0).length/mcTri.length*100).toFixed(1).padStart(18)}%`);
console.log(`  Avg false stops  │ ${(mcOld.reduce((s,m)=>s+m.fs,0)/mcOld.length).toFixed(1).padStart(21)} │ ${(mcTri.reduce((s,m)=>s+m.fs,0)/mcTri.length).toFixed(1).padStart(19)}`);

// Equity curve simulation
console.log('\n' + '═'.repeat(80));
console.log('  EQUITY CURVE (Rs.10L start, 1% risk per trade)');
console.log('═'.repeat(80));
let eqOld=1000000,eqTri=1000000;
const sortedTrades=[...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const oldTr=simOld(sortedTrades).trades.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const triTr=simTriple(sortedTrades).trades.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
let maxDdOld=0,maxDdTri=0,peakOld=eqOld,peakTri=eqTri;
for(const t of oldTr){if(t.outcome==='EXPIRED')continue;const risk=eqOld*0.01;eqOld+=t.pnlR*risk;if(eqOld>peakOld)peakOld=eqOld;const dd=(peakOld-eqOld)/peakOld*100;if(dd>maxDdOld)maxDdOld=dd;}
for(const t of triTr){if(t.outcome==='EXPIRED')continue;const risk=eqTri*0.01;eqTri+=t.pnlR*risk;if(eqTri>peakTri)peakTri=eqTri;const dd=(peakTri-eqTri)/peakTri*100;if(dd>maxDdTri)maxDdTri=dd;}
console.log(`\n  OLD Stop:    Rs.${(eqOld/100000).toFixed(1)}L (${((eqOld-1000000)/1000000*100).toFixed(1)}%) │ Max Drawdown: ${maxDdOld.toFixed(1)}%`);
console.log(`  TRIPLE Stop: Rs.${(eqTri/100000).toFixed(1)}L (${((eqTri-1000000)/1000000*100).toFixed(1)}%) │ Max Drawdown: ${maxDdTri.toFixed(1)}%`);

// Final verdict
console.log('\n' + '█'.repeat(80));
console.log('  FINAL VERDICT');
console.log('█'.repeat(80));
console.log(`\n  OLD:    ${old.wins}W / ${old.losses}L / ${old.falseStops} false stops │ WR ${old.winRate.toFixed(1)}% │ Exp ${old.expectancy.toFixed(3)}R │ Total ${old.totalR.toFixed(0)}R`);
console.log(`  TRIPLE: ${tri.wins}W / ${tri.losses}L / ${tri.falseStops} false stops │ WR ${tri.winRate.toFixed(1)}% │ Exp ${tri.expectancy.toFixed(3)}R │ Total ${tri.totalR.toFixed(0)}R`);
console.log(`\n  TRIPLE eliminates ${((1-tri.falseStops/old.falseStops)*100).toFixed(0)}% of false stops while gaining +${tri.wins-old.wins} winners.`);
