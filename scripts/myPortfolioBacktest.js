// DR KKR PORTFOLIO BACKTEST — 28 stocks × 4 param sets × Cascading Gates v3
const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}
function wilson(n,h){if(n<2)return 0;const p=h/n,z=1.96;return(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100;}

const PARAMS={
  D20:{name:'D20+ Deployable',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.75,minCQS:3},
  HP15:{name:'HP15+ HighPrec',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minRSI:50,minVE:null,minCQS:null,maxCAZ:6},
  E10:{name:'E10+ Elite',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:5,minZL:8,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3},
  US8:{name:'US8+ UltraSel',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null},
};
function testParam(s,p){
  if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
  if(s.p10E>p.maxEC)return false;if(s.zLen<(p.minZL||6)||s.zLen>(p.maxZL||20))return false;
  if(s.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
  if(s.rvb>p.maxRVB)return false;if(s.ra<(p.minRA||1)||s.ra>(p.maxRA||5))return false;
  if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
  if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
  if(s.uV<p.minUPS)return false;
  if(p.minVE!=null&&s.vE<p.minVE)return false;if(p.minCQS!=null&&s.cV<p.minCQS)return false;
  if(p.maxCAZ!=null&&s.caz>p.maxCAZ)return false;return true;
}

console.log(`Loading ${files.length} stocks from My Portfolio...\n`);
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    const ap=(a[i]/s.c)*100;const w120=[];for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w120.push((a[j]/c[j].c)*100);}
    const apctl=pR(w120,ap);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=c[j].c*c[j].v;const to=tS/Math.max(i-Math.max(0,i-20),1);
    let p10R=0,p10C=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;const t=Math.max(c[j].h-c[j].l,Math.abs(c[j].h-c[j-1].c),Math.abs(c[j].l-c[j-1].c));const x=t/a[j];p10R+=x;p10C++;if(x>1.1)p10E++;}
    const p10A=p10C>0?p10R/p10C:1;const vE=p10A>0?ra/p10A:1;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=c[j].v;v5/=Math.max(i-Math.max(0,i-5),1);const vP=v5>0?s.v/v5:0;
    let p10VS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VS+=(v20>0?c[j].v/v20:0);p10VC++;}const p10V=p10VC>0?p10VS/p10VC:1;
    let p5VS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VS+=(v20>0?c[j].v/v20:0);p5VC++;}const p5V=p5VC>0?p5VS/p5VC:1;
    let rVol=0,gVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(c[j].c<c[j].o)rVol+=c[j].v;else gVol+=c[j].v;}const rvb=gVol>0?rVol/gVol:(rVol>0?10:1);
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqsC(cl,uw,bp,vP,vE);
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const t2Pct=Math.min(5.65,2.80*atrVal/entry*100);
    const t3Pct=ap<1.5?5:ap<=3?7:10;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    // Cascading Gates v3 simulation
    let outcome='EXPIRED',exitDay=10,t1Hit=false,t2Hit=false,t3Hit=false,stopped=false;
    let mfe=0,mae=0;
    for(let d=i+1;d<=Math.min(i+20,c.length-1);d++){
      const fc=c[d],day=d-i;
      const pH=(fc.h-entry)/entry*100,pL=(fc.l-entry)/entry*100,pC=(fc.c-entry)/entry*100;
      if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;
      if(!t1Hit&&pH>=t1Pct){t1Hit=true;outcome='T1_HIT';exitDay=day;}
      if(t1Hit&&!t2Hit&&pH>=t2Pct){t2Hit=true;outcome='T2_HIT';exitDay=day;}
      if(t2Hit&&!t3Hit&&pH>=t3Pct){t3Hit=true;outcome='T3_HIT';exitDay=day;break;}
      // Cascading Gates v3 (pre-T1, within 10 days)
      if(!t1Hit&&day<=10&&pC<=-stopPct){
        const range2=fc.h-fc.l;const openP=fc.o;const isGreen=openP<fc.c;
        const closeLoc2=range2>0?(fc.c-fc.l)/range2*100:50;
        const lwPct2=range2>0?(Math.min(openP,fc.c)-fc.l)/range2*100:0;
        const prevC=d>=i+2?c[d-1]:null;const ppC=d>=i+3?c[d-2]:null;
        // Gate 1: RSI-2 < 15
        const ch1=prevC?fc.c-prevC.c:0;const ch2=prevC&&ppC?prevC.c-ppC.c:0;
        const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
        const rsi2=rL<0.001?100:100-100/(1+rG/rL);
        if(rsi2<15)continue;
        // Gate 2a: prev day also below stop
        if(!prevC||(prevC.c-entry)/entry*100>-stopPct)continue;
        // Gate 2b: acceleration (today worse than yesterday)
        if(fc.c>=prevC.c)continue;
        // Gate 2c: volume >= 0.8× prev volume
        if(fc.v<prevC.v*0.8)continue;
        // Gate 3: hammer
        if(lwPct2>=40&&closeLoc2>=50)continue;
        // Gate 4: green recovery
        if(isGreen&&closeLoc2>=50)continue;
        // Gate 5: close in lower 35%
        if(closeLoc2>=35)continue;
        // Gate 6: OBV proxy declining
        if(ppC&&fc.c>(ppC.c||entry))continue;
        // Gate 7: prev candle was red
        if(prevC&&(prevC.o||prevC.c)<=prevC.c)continue;
        stopped=true;outcome='STOPPED';exitDay=day;break;
      }
      if(t1Hit&&!t2Hit&&day<=20&&pL<=0){outcome='T1_HIT';break;}
      if(day>10&&!t1Hit)break;
    }
    let pnlPct=0;
    if(outcome==='STOPPED')pnlPct=-stopPct;
    else if(outcome==='T1_HIT')pnlPct=t1Pct*0.5;
    else if(outcome==='T2_HIT')pnlPct=t1Pct*0.5+t2Pct*0.3;
    else if(outcome==='T3_HIT')pnlPct=t1Pct*0.5+t2Pct*0.3+t3Pct*0.2;
    const features={to,apctl,p10A,p10E,zLen:bZ.len,zt:bZ.zt,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:50,vE,caz};
    ALL.push({sym,date:c[i].date,entry,outcome,exitDay,pnlPct,mfe,mae,t1Hit,t2Hit,t3Hit,stopped,stopPct,t1Pct,
      passD20:testParam(features,PARAMS.D20),passHP:testParam(features,PARAMS.HP15),
      passE10:testParam(features,PARAMS.E10),passUS:testParam(features,PARAMS.US8),
      passAny:testParam(features,PARAMS.D20)||testParam(features,PARAMS.HP15)||testParam(features,PARAMS.E10)||testParam(features,PARAMS.US8)});
  }
}
ALL.sort((a,b)=>(a.date||'').localeCompare(b.date||''));

console.log('█'.repeat(90));
console.log('  DR KKR PORTFOLIO BACKTEST — 28 stocks × v5-WLB + Cascading Gates v3');
console.log('█'.repeat(90));
console.log(`  Total breakouts: ${ALL.length} | Stocks loaded: ${[...new Set(ALL.map(s=>s.sym))].length}\n`);

for(const[key,p]of Object.entries(PARAMS)){
  const field=key==='D20'?'passD20':key==='HP15'?'passHP':key==='E10'?'passE10':'passUS';
  const trades=ALL.filter(s=>s[field]);
  if(trades.length===0){console.log(`\n  ${p.name}: 0 signals\n`);continue;}
  const t1=trades.filter(t=>t.t1Hit),t2=trades.filter(t=>t.t2Hit),t3=trades.filter(t=>t.t3Hit);
  const stopped=trades.filter(t=>t.stopped),expired=trades.filter(t=>t.outcome==='EXPIRED');
  const winners=trades.filter(t=>t.mfe>=5),falseStops=trades.filter(t=>t.stopped&&t.mfe>=5);
  const decided=trades.filter(t=>t.outcome!=='EXPIRED');
  const avgMfe=trades.reduce((s,t)=>s+t.mfe,0)/trades.length;
  const avgMae=trades.reduce((s,t)=>s+t.mae,0)/trades.length;
  const avgPnl=decided.length>0?decided.reduce((s,t)=>s+t.pnlPct,0)/decided.length:0;
  const avgDays=t1.length>0?t1.reduce((s,t)=>s+t.exitDay,0)/t1.length:0;
  const wlb=wilson(trades.length,winners.length);
  const syms=[...new Set(trades.map(t=>t.sym))];
  console.log(`${'═'.repeat(90)}`);
  console.log(`  ${p.name}`);
  console.log('═'.repeat(90));
  console.log(`  Signals: ${trades.length} | Stocks: ${syms.length} | Winners(MFE≥5%): ${winners.length} (${(winners.length/trades.length*100).toFixed(1)}%) | WLB: ${wlb.toFixed(1)}%`);
  console.log(`  T1 Hit: ${t1.length} (${(t1.length/trades.length*100).toFixed(1)}%) | T2: ${t2.length} (${(t2.length/trades.length*100).toFixed(1)}%) | T3: ${t3.length} (${(t3.length/trades.length*100).toFixed(1)}%)`);
  console.log(`  Stopped: ${stopped.length} (${(stopped.length/trades.length*100).toFixed(1)}%) | False stops: ${falseStops.length} | Expired: ${expired.length} (${(expired.length/trades.length*100).toFixed(1)}%)`);
  console.log(`  Win Rate (decided): ${decided.length>0?(t1.length/decided.length*100).toFixed(1):0}%`);
  console.log(`  Avg MFE: +${avgMfe.toFixed(1)}% | Avg MAE: ${avgMae.toFixed(1)}% | MFE/MAE: ${(avgMfe/Math.abs(avgMae||1)).toFixed(2)}`);
  console.log(`  Avg P&L (decided): ${avgPnl>=0?'+':''}${avgPnl.toFixed(2)}% | Avg days to T1: ${avgDays.toFixed(1)}d`);
  console.log(`\n  Top 15 trades:`);
  console.log('  Symbol       │ Date       │ Outcome │ MFE    │ MAE    │ P&L%   │ Days');
  for(const t of trades.sort((a,b)=>b.mfe-a.mfe).slice(0,15)){
    console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.outcome.padEnd(7)} │ ${('+'+t.mfe.toFixed(1)+'%').padStart(6)} │ ${t.mae.toFixed(1).padStart(5)}% │ ${(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(1)+'%'.padStart(6)} │ ${String(t.exitDay).padStart(4)}`);
  }
  console.log(`\n  Per-stock:`);
  console.log('  Symbol       │ Signals │ T1 │ T2 │ T3 │ Stop │ Expired │ HitRate');
  for(const sym of syms.sort()){
    const st=trades.filter(t=>t.sym===sym);
    console.log(`  ${sym.padEnd(12)} │ ${String(st.length).padStart(7)} │ ${String(st.filter(t=>t.t1Hit).length).padStart(2)} │ ${String(st.filter(t=>t.t2Hit).length).padStart(2)} │ ${String(st.filter(t=>t.t3Hit).length).padStart(2)} │ ${String(st.filter(t=>t.stopped).length).padStart(4)} │ ${String(st.filter(t=>t.outcome==='EXPIRED').length).padStart(7)} │ ${(st.filter(t=>t.mfe>=5).length/st.length*100).toFixed(0).padStart(5)}%`);
  }
}

// Combined
console.log(`\n${'█'.repeat(90)}`);
console.log('  COMBINED SYSTEM (any param set)');
console.log('█'.repeat(90));
const any=ALL.filter(s=>s.passAny);
if(any.length>0){
  const t1=any.filter(t=>t.t1Hit),stopped=any.filter(t=>t.stopped),expired=any.filter(t=>t.outcome==='EXPIRED');
  const winners=any.filter(t=>t.mfe>=5),falseStops=any.filter(t=>t.stopped&&t.mfe>=5);
  const decided=any.filter(t=>t.outcome!=='EXPIRED');
  const avgMfe=any.reduce((s,t)=>s+t.mfe,0)/any.length;
  const avgMae=any.reduce((s,t)=>s+t.mae,0)/any.length;
  console.log(`\n  Signals: ${any.length} | T1: ${t1.length} | T2: ${any.filter(t=>t.t2Hit).length} | T3: ${any.filter(t=>t.t3Hit).length} | Stopped: ${stopped.length} | Expired: ${expired.length}`);
  console.log(`  Hit Rate (MFE≥5%): ${(winners.length/any.length*100).toFixed(1)}% | Win Rate (decided): ${decided.length>0?(t1.length/decided.length*100).toFixed(1):0}% | Stop Rate: ${(stopped.length/any.length*100).toFixed(1)}%`);
  console.log(`  False Stops: ${falseStops.length}/${winners.length} (${(falseStops.length/Math.max(winners.length,1)*100).toFixed(1)}%)`);
  console.log(`  Avg MFE: +${avgMfe.toFixed(1)}% | Avg MAE: ${avgMae.toFixed(1)}% | MFE/MAE: ${(avgMfe/Math.abs(avgMae||1)).toFixed(2)}`);
  console.log(`  Wilson LB: ${wilson(any.length,winners.length).toFixed(1)}%`);
  console.log(`  Stocks: ${[...new Set(any.map(t=>t.sym))].sort().join(', ')}`);
}

// Walk-forward
console.log(`\n${'═'.repeat(90)}`);
console.log('  WALK-FORWARD (70/30)');
console.log('═'.repeat(90));
const sp=Math.floor(any.length*0.70);
for(const[label,set]of[['In-Sample (70%)',any.slice(0,sp)],['Out-of-Sample (30%)',any.slice(sp)]]){
  const d=set.filter(t=>t.outcome!=='EXPIRED');const w=set.filter(t=>t.t1Hit);const win=set.filter(t=>t.mfe>=5);
  console.log(`  ${label}: ${set.length} signals, WR ${d.length>0?(w.length/d.length*100).toFixed(1):'0'}%, Hit ${set.length>0?(win.length/set.length*100).toFixed(1):'0'}%, WLB ${wilson(set.length,win.length).toFixed(1)}%, False ${set.filter(t=>t.stopped&&t.mfe>=5).length}`);
}

// Equity curve
let eq=1000000,peak=1000000,maxDD=0,wins=0,losses=0;
for(const t of any){
  if(t.outcome==='EXPIRED')continue;
  const risk=eq*0.01;const pnlR=t.stopped?-1:t.t1Hit?t.t1Pct/t.stopPct:0;
  eq+=pnlR*risk;if(eq>peak)peak=eq;const dd=(peak-eq)/peak*100;if(dd>maxDD)maxDD=dd;
  if(pnlR>0)wins++;else losses++;
}
console.log(`\n  Equity: Rs.${(eq/100000).toFixed(1)}L (${((eq-1000000)/1000000*100).toFixed(1)}%) | MaxDD: ${maxDD.toFixed(1)}% | W/L: ${wins}/${losses}`);
