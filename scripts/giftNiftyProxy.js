// GIFT NIFTY PROXY RESEARCH
// Gift Nifty isn't on Yahoo Finance, but we can derive its information from:
// 1. Nifty 50 overnight gaps (open vs prev close = Gift Nifty influence)
// 2. Nifty 50 pre-market direction (first 15min candle direction)
// 3. Global sentiment proxy via correlation analysis
//
// The question: Does the OVERNIGHT GAP (which reflects Gift Nifty/SGX Nifty)
// predict the day's direction? And can it enhance regime detection?

const fs=require('fs');
const nLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv','utf8').trim().split('\n');
const nifty=[];for(let i=1;i<nLines.length;i++){const[date,o,h,l,c,v]=nLines[i].split(',');nifty.push({date,o:+o,h:+h,l:+l,c:+c,v:+v});}
const vLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/indiavix_daily.csv','utf8').trim().split('\n');
const vixMap={};for(let i=1;i<vLines.length;i++){const[date,,,,c]=vLines[i].split(',');vixMap[date]={vix:+c};}

console.log(`Nifty: ${nifty.length} days | VIX data available\n`);

// ═══ PART 1: Overnight Gap Analysis (Gift Nifty Proxy) ═══
console.log('█'.repeat(80));
console.log('  OVERNIGHT GAP ANALYSIS — Gift Nifty Proxy');
console.log('  Gap = Today Open - Yesterday Close (what Gift Nifty predicts)');
console.log('█'.repeat(80));

const gaps=[];
for(let i=1;i<nifty.length;i++){
  const gapPct=((nifty[i].o-nifty[i-1].c)/nifty[i-1].c)*100;
  const dayReturn=((nifty[i].c-nifty[i].o)/nifty[i].o)*100; // intraday return after gap
  const fullReturn=((nifty[i].c-nifty[i-1].c)/nifty[i-1].c)*100;
  const gapFilled=gapPct>0?nifty[i].l<=nifty[i-1].c:nifty[i].h>=nifty[i-1].c;
  const vix=vixMap[nifty[i].date]?.vix||0;
  gaps.push({date:nifty[i].date,gapPct,dayReturn,fullReturn,gapFilled,vix,close:nifty[i].c});
}

// Gap direction vs day direction correlation
const gapUpDayUp=gaps.filter(g=>g.gapPct>0&&g.dayReturn>0).length;
const gapUpDayDown=gaps.filter(g=>g.gapPct>0&&g.dayReturn<0).length;
const gapDownDayUp=gaps.filter(g=>g.gapPct<0&&g.dayReturn>0).length;
const gapDownDayDown=gaps.filter(g=>g.gapPct<0&&g.dayReturn<0).length;

console.log('\n═══ Gap Direction vs Day Direction ═══\n');
console.log(`  Gap Up + Day Up:     ${gapUpDayUp} (${(gapUpDayUp/gaps.length*100).toFixed(1)}%) — gap confirms trend`);
console.log(`  Gap Up + Day Down:   ${gapUpDayDown} (${(gapUpDayDown/gaps.length*100).toFixed(1)}%) — gap reversal`);
console.log(`  Gap Down + Day Up:   ${gapDownDayUp} (${(gapDownDayUp/gaps.length*100).toFixed(1)}%) — gap reversal`);
console.log(`  Gap Down + Day Down: ${gapDownDayDown} (${(gapDownDayDown/gaps.length*100).toFixed(1)}%) — gap confirms trend`);
const gapConfirmRate=(gapUpDayUp+gapDownDayDown)/gaps.length*100;
console.log(`\n  Gap CONFIRMATION rate: ${gapConfirmRate.toFixed(1)}%`);
console.log(`  Gap REVERSAL rate:    ${(100-gapConfirmRate).toFixed(1)}%`);

// Gap size buckets
console.log('\n═══ Gap Size vs Day Outcome ═══\n');
console.log('  Gap Range      │ Count │ Day follows gap │ Confirm% │ Avg day return │ Insight');
console.log('  ───────────────┼───────┼─────────────────┼──────────┼────────────────┼────────');
for(const[lo,hi,label]of[[-5,-1,'Large gap down'],[-1,-0.3,'Moderate gap down'],[-0.3,0,'Small gap down'],[0,0.3,'Small gap up'],[0.3,1,'Moderate gap up'],[1,5,'Large gap up']]){
  const grp=gaps.filter(g=>g.gapPct>=lo&&g.gapPct<hi);if(grp.length<10)continue;
  const follows=grp.filter(g=>(g.gapPct>0&&g.dayReturn>0)||(g.gapPct<0&&g.dayReturn<0)).length;
  const avgDayRet=grp.reduce((s,g)=>s+g.dayReturn,0)/grp.length;
  const insight=follows/grp.length>0.55?'TREND':'MEAN-REVERT';
  console.log(`  ${label.padEnd(15)} │ ${String(grp.length).padStart(5)} │ ${String(follows).padStart(15)} │ ${(follows/grp.length*100).toFixed(1).padStart(7)}% │ ${(avgDayRet>=0?'+':'')+avgDayRet.toFixed(3).padStart(13)}% │ ${insight}`);
}

// ═══ PART 2: Gap Streak as Regime Indicator ═══
console.log('\n═══ Gap Streak Analysis — Does consecutive gap direction predict regime? ═══\n');
// Count consecutive gap-up or gap-down days
let streak=0,streakDir=0;
const streaks=[];
for(let i=0;i<gaps.length;i++){
  const dir=gaps[i].gapPct>0?1:-1;
  if(dir===streakDir){streak++;}else{if(streak>=2)streaks.push({endIdx:i-1,len:streak,dir:streakDir});streak=1;streakDir=dir;}
}
// After 3+ consecutive gap-ups, what happens?
console.log('  Streak              │ Occurrences │ Next day follows │ Follow% │ Avg next day');
console.log('  ────────────────────┼─────────────┼──────────────────┼─────────┼────────────');
for(const[minLen,label]of[[3,'3+ gap-ups'],[3,'3+ gap-downs'],[5,'5+ gap-ups'],[5,'5+ gap-downs']]){
  const dir=label.includes('up')?1:-1;
  const matching=streaks.filter(s=>s.len>=minLen&&s.dir===dir);
  let follows=0,totalNext=0;
  for(const s of matching){
    const nextIdx=s.endIdx+1;if(nextIdx>=gaps.length)continue;
    const nextGap=gaps[nextIdx].gapPct;
    if((dir>0&&nextGap>0)||(dir<0&&nextGap<0))follows++;
    totalNext++;
  }
  const avgNext=matching.length>0?matching.reduce((s,m)=>{const n=gaps[m.endIdx+1];return s+(n?n.fullReturn:0);},0)/matching.length:0;
  console.log(`  ${label.padEnd(20)} │ ${String(matching.length).padStart(11)} │ ${String(follows).padStart(16)} │ ${(totalNext>0?(follows/totalNext*100).toFixed(1):'—').padStart(7)}% │ ${(avgNext>=0?'+':'')+avgNext.toFixed(3)+'%'}`);
}

// ═══ PART 3: Gap + VIX Combo — Predictive power ═══
console.log('\n═══ Gap + VIX Combination — Enhanced predictive power ═══\n');
const combos=[
  {name:'Gap up + VIX<15 (calm bull)',fn:g=>g.gapPct>0&&g.vix<15&&g.vix>0},
  {name:'Gap up + VIX 15-22 (normal)',fn:g=>g.gapPct>0&&g.vix>=15&&g.vix<22},
  {name:'Gap up + VIX>22 (anxious)',fn:g=>g.gapPct>0&&g.vix>=22},
  {name:'Gap down + VIX<15 (complacent)',fn:g=>g.gapPct<0&&g.vix<15&&g.vix>0},
  {name:'Gap down + VIX 15-22 (normal)',fn:g=>g.gapPct<0&&g.vix>=15&&g.vix<22},
  {name:'Gap down + VIX>22 (fear)',fn:g=>g.gapPct<0&&g.vix>=22},
  {name:'Large gap up >0.5% + low VIX<15',fn:g=>g.gapPct>0.5&&g.vix<15&&g.vix>0},
  {name:'Large gap down <-0.5% + high VIX>20',fn:g=>g.gapPct<-0.5&&g.vix>20},
];
console.log('  Combo                                 │ Count │ Day follows │ Confirm% │ Avg full return');
console.log('  ──────────────────────────────────────┼───────┼────────────┼──────────┼───────────────');
for(const c of combos){
  const grp=gaps.filter(c.fn);if(grp.length<10)continue;
  const follows=grp.filter(g=>(g.gapPct>0&&g.fullReturn>0)||(g.gapPct<0&&g.fullReturn<0)).length;
  const avgRet=grp.reduce((s,g)=>s+g.fullReturn,0)/grp.length;
  console.log(`  ${c.name.padEnd(38)} │ ${String(grp.length).padStart(5)} │ ${String(follows).padStart(10)} │ ${(follows/grp.length*100).toFixed(1).padStart(7)}% │ ${(avgRet>=0?'+':'')+avgRet.toFixed(3)+'%'}`);
}

// ═══ PART 4: 5-Day Rolling Gap Score ═══
console.log('\n═══ 5-Day Rolling Gap Score — Regime signal ═══\n');
// Sum of last 5 days' gaps — positive = bullish overnight sentiment, negative = bearish
const gapScores=[];
for(let i=5;i<gaps.length;i++){
  let score=0;for(let j=i-4;j<=i;j++)score+=gaps[j].gapPct;
  const nextDayReturn=i+1<gaps.length?gaps[i+1].fullReturn:0;
  gapScores.push({date:gaps[i].date,score,nextDayReturn,close:gaps[i].close});
}

console.log('  5-Day Gap Score │ Count │ Next day +ve │ Predict% │ Avg next day │ Signal');
console.log('  ────────────────┼───────┼──────────────┼──────────┼──────────────┼───────');
for(const[lo,hi,label]of[[-10,-1,'Strong negative'],[-1,-0.3,'Moderate negative'],[-0.3,0.3,'Neutral'],[0.3,1,'Moderate positive'],[1,10,'Strong positive']]){
  const grp=gapScores.filter(g=>g.score>=lo&&g.score<hi);if(grp.length<20)continue;
  const posNext=grp.filter(g=>g.nextDayReturn>0).length;
  const avgNext=grp.reduce((s,g)=>s+g.nextDayReturn,0)/grp.length;
  const signal=posNext/grp.length>0.55?'BULLISH':posNext/grp.length<0.45?'BEARISH':'NEUTRAL';
  console.log(`  ${label.padEnd(16)} │ ${String(grp.length).padStart(5)} │ ${String(posNext).padStart(12)} │ ${(posNext/grp.length*100).toFixed(1).padStart(7)}% │ ${(avgNext>=0?'+':'')+avgNext.toFixed(3).padStart(11)}% │ ${signal}`);
}

// ═══ PART 5: Can overnight gap improve our 8-factor regime? ═══
console.log('\n═══ PART 5: Regime Enhancement Test ═══\n');
// Build regime scores with and without gap factor
function regimeWithGap(niftyArr, gapArr, useGap) {
  let equity=1000000,peak=1000000,maxDD=0;
  for(let i=51;i<niftyArr.length;i++){
    const ret=(niftyArr[i].c-niftyArr[i-1].c)/niftyArr[i-1].c;
    // Simple regime: 20d return + gap score
    const ret20=(niftyArr[i].c-niftyArr[i-20].c)/niftyArr[i-20].c*100;
    let sizing=ret20>2?1.0:ret20>0?0.75:ret20>-2?0.5:0.25;
    if(useGap&&i-1<gapArr.length){
      const gapScore=gapArr.slice(Math.max(0,i-6),i-1).reduce((s,g)=>s+g.gapPct,0);
      if(gapScore>0.5)sizing=Math.min(1.25,sizing+0.25);
      else if(gapScore<-0.5)sizing=Math.max(0,sizing-0.25);
    }
    equity*=(1+ret*sizing);
    if(equity>peak)peak=equity;const dd=(peak-equity)/peak*100;if(dd>maxDD)maxDD=dd;
  }
  return{equity,ret:(equity-1000000)/1000000*100,maxDD};
}
const withoutGap=regimeWithGap(nifty,gaps,false);
const withGap=regimeWithGap(nifty,gaps,true);
console.log(`  Without gap factor: Rs.${(withoutGap.equity/100000).toFixed(1)}L (+${withoutGap.ret.toFixed(0)}%) MaxDD ${withoutGap.maxDD.toFixed(1)}%`);
console.log(`  With gap factor:    Rs.${(withGap.equity/100000).toFixed(1)}L (+${withGap.ret.toFixed(0)}%) MaxDD ${withGap.maxDD.toFixed(1)}%`);
console.log(`  Improvement:        ${withGap.ret>withoutGap.ret?'+':''}${(withGap.ret-withoutGap.ret).toFixed(0)}% return, ${(withGap.maxDD-withoutGap.maxDD).toFixed(1)}% DD change`);

// Correlation coefficient
const n=Math.min(gaps.length-1,nifty.length-2);
let sumXY=0,sumX=0,sumY=0,sumX2=0,sumY2=0;
for(let i=0;i<n;i++){
  const x=gaps[i].gapPct;const y=gaps[i].fullReturn;
  sumXY+=x*y;sumX+=x;sumY+=y;sumX2+=x*x;sumY2+=y*y;
}
const corr=(n*sumXY-sumX*sumY)/Math.sqrt((n*sumX2-sumX*sumX)*(n*sumY2-sumY*sumY));
console.log(`\n  Pearson correlation (gap vs full-day return): ${corr.toFixed(4)}`);
console.log(`  Interpretation: ${Math.abs(corr)>0.3?'MODERATE':Math.abs(corr)>0.1?'WEAK':'NEGLIGIBLE'} correlation`);

// Final verdict
console.log(`\n${'█'.repeat(80)}`);
console.log('  VERDICT: Should Gift Nifty (overnight gap) be added to regime?');
console.log('█'.repeat(80));
console.log(`
  CORRELATION: ${corr.toFixed(4)} — ${Math.abs(corr)>0.3?'worth adding':'too weak to be useful'}
  CONFIRMATION RATE: ${gapConfirmRate.toFixed(1)}% — ${gapConfirmRate>55?'meaningful signal':'barely better than coin flip'}
  REGIME IMPROVEMENT: ${withGap.ret>withoutGap.ret?'YES +'+((withGap.ret-withoutGap.ret).toFixed(0))+'%':'NO improvement'} return
  MAX DD IMPACT: ${(withGap.maxDD-withoutGap.maxDD).toFixed(1)}% change

  RECOMMENDATION: ${corr>0.15&&gapConfirmRate>52?'ADD as minor factor (weight 5-8 pts)':'DO NOT ADD — insufficient predictive power'}
`);
