// RSI < 8 vs NO RSI GATE — Ultra thorough comparison
// Tests on My Portfolio 28 stocks with FULL system (param filters + Cascading Gates)
// Measures everything: false stops, win rate, expectancy, MAE, MFE, equity, drawdown

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
  D20:{minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.75,minCQS:3},
  HP15:{minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minRSI:50,minVE:null,minCQS:null,maxCAZ:6},
  E10:{minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:5,minZL:8,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3},
  US8:{minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null},
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

// Build all PARAM-QUALIFYING signals with full future data
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-21;i++){
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
    const features={to,apctl,p10A,p10E,zLen:bZ.len,zt:bZ.zt,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:50,vE,caz};
    const passAny=testParam(features,PARAMS.D20)||testParam(features,PARAMS.HP15)||testParam(features,PARAMS.E10)||testParam(features,PARAMS.US8);

    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const t2Pct=Math.min(5.65,2.80*atrVal/entry*100);
    const t3Pct=ap<1.5?5:ap<=3?7:10;

    const future=[];
    for(let d=i+1;d<=Math.min(i+20,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const prevC=d>=i+2?c[d-1]:null;const ppC=d>=i+3?c[d-2]:null;
      const ch1=prevC?fc.c-prevC.c:0;const ch2=prevC&&ppC?prevC.c-ppC.c:0;
      const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
      const rsi2=rL<0.001?100:100-100/(1+rG/rL);
      let cRed=0;for(let k=d;k>=Math.max(i+1,d-5);k--){if(c[k].c<c[k].o)cRed++;else break;}
      future.push({day,c:fc.c,h:fc.h,l:fc.l,o:fc.o,v:fc.v,
        pctC:(fc.c-entry)/entry*100,pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,
        isGreen:fc.o<fc.c,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,
        rsi2,volR:v20>0?fc.v/v20:1,consecRed:cRed,
        prevBelowStop:prevC?(prevC.c-entry)/entry*100<=-stopPct:false,
        accel:prevC?fc.c<prevC.c:false,prevGreen:prevC?(prevC.o||prevC.c)<prevC.c:false,
        prevC:prevC?.c||entry,ppC:ppC?.c||entry});
    }
    let mfe=0,mae=0;for(const f of future.slice(0,10)){if(f.pctH>mfe)mfe=f.pctH;if(f.pctL<mae)mae=f.pctL;}
    ALL.push({sym,date:c[i].date,entry,stopPct,t1Pct,t2Pct,t3Pct,future,mfe,mae,h5:mfe>=5,passAny});
  }
}
const qualifying=ALL.filter(s=>s.passAny);
console.log(`All breakouts: ${ALL.length} | Param-qualifying: ${qualifying.length} | Winners: ${qualifying.filter(s=>s.h5).length}\n`);

// Full simulation with Cascading Gates
function simulate(signals, rsiGateFn, label) {
  let wins=0,losses=0,falseStops=0,expired=0;
  let winPnl=0,lossPnl=0;
  let t1=0,t2=0,t3=0;
  const trades=[];
  for(const s of signals){
    let stopped=false,hitT1=false,hitT2=false,hitT3=false,exitDay=10,stopDay=0;
    let tradeMAE=0;
    for(const f of s.future){
      if(f.pctL<tradeMAE)tradeMAE=f.pctL;
      if(!hitT1&&f.pctH>=s.t1Pct){hitT1=true;t1++;exitDay=f.day;}
      if(hitT1&&!hitT2&&f.pctH>=s.t2Pct){hitT2=true;t2++;exitDay=f.day;}
      if(hitT2&&!hitT3&&f.pctH>=s.t3Pct){hitT3=true;t3++;exitDay=f.day;break;}
      // Cascading Gates (pre-T1, day 1-10)
      if(!hitT1&&f.day<=10&&f.pctC<=-s.stopPct){
        // Gate 1: RSI (configurable)
        if(rsiGateFn(f))continue;
        // Gate 2: Smart 2-day
        if(!f.prevBelowStop)continue;
        if(!f.accel)continue;
        if(f.volR<0.8)continue;
        // Gate 3: Hammer
        if(f.lwPct>=40&&f.closeLoc>=50)continue;
        // Gate 4: Green recovery
        if(f.isGreen&&f.closeLoc>=50)continue;
        // Gate 5: Close position
        if(f.closeLoc>=35)continue;
        // Gate 6: OBV proxy
        if(f.c>f.ppC)continue;
        // Gate 7: Consecutive red
        if(f.prevGreen)continue;
        stopped=true;stopDay=f.day;break;
      }
      if(hitT1&&!hitT2&&f.day<=20&&f.pctL<=0)break;
      if(f.day>10&&!hitT1)break;
    }
    let pnlPct=0;
    if(stopped){losses++;lossPnl+=s.stopPct;if(s.h5)falseStops++;pnlPct=-s.stopPct;}
    else if(hitT1){wins++;pnlPct=hitT3?s.t1Pct*0.5+s.t2Pct*0.3+s.t3Pct*0.2:hitT2?s.t1Pct*0.5+s.t2Pct*0.3:s.t1Pct*0.5;winPnl+=pnlPct;}
    else{expired++;pnlPct=0;}
    trades.push({...s,outcome:stopped?'STOPPED':hitT1?'T1+':'EXPIRED',pnlPct,tradeMAE,stopDay});
  }
  const decided=wins+losses;
  return{label,wins,losses,falseStops,expired,t1,t2,t3,decided,
    winRate:decided>0?wins/decided*100:0,
    avgPnl:decided>0?(winPnl-lossPnl)/decided:0,
    expectancy:decided>0?(winPnl-lossPnl)/decided:0,
    avgMAE:trades.length>0?trades.reduce((s,t)=>s+t.tradeMAE,0)/trades.length:0,
    avgMFE:trades.length>0?trades.reduce((s,t)=>s+t.mfe,0)/trades.length:0,
    trades};
}

const configs=[
  {name:'RSI < 15 (current v3)',fn:f=>f.rsi2<15},
  {name:'RSI < 8 (original v2)',fn:f=>f.rsi2<8},
  {name:'RSI < 5',fn:f=>f.rsi2<5},
  {name:'RSI < 3',fn:f=>f.rsi2<3},
  {name:'NO RSI gate',fn:()=>false},
];

console.log('█'.repeat(85));
console.log('  RSI < 8 vs NO RSI GATE — Ultra Thorough on 28 Portfolio Stocks');
console.log('  ONLY param-qualifying signals (what you actually trade)');
console.log('█'.repeat(85));

console.log(`\n  Config            │FalseStop│ Wins │ T1  │ T2  │ T3  │ Stop │ Exp  │ WR%   │ AvgMAE │ AvgMFE`);
console.log('  ──────────────────┼─────────┼──────┼─────┼─────┼─────┼──────┼──────┼───────┼────────┼───────');
const allResults=[];
for(const cfg of configs){
  const r=simulate(qualifying,cfg.fn,cfg.name);
  allResults.push(r);
  console.log(`  ${cfg.name.padEnd(18)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.t1).padStart(3)} │ ${String(r.t2).padStart(3)} │ ${String(r.t3).padStart(3)} │ ${String(r.losses).padStart(4)} │ ${r.expectancy.toFixed(2).padStart(4)}% │ ${r.winRate.toFixed(1).padStart(5)}% │ ${r.avgMAE.toFixed(1).padStart(6)}% │ ${r.avgMFE.toFixed(1).padStart(5)}%`);
}

// Equity curve comparison
console.log('\n═══ EQUITY CURVE (Rs.10L, 1% risk per trade) ═══\n');
for(const r of allResults){
  let eq=1000000,peak=1000000,maxDD=0,w=0,l=0;
  for(const t of r.trades){
    if(t.outcome==='EXPIRED')continue;
    const risk=eq*0.01;
    if(t.outcome==='STOPPED'){eq-=risk;l++;}
    else{eq+=risk*(t.pnlPct/t.stopPct);w++;}
    if(eq>peak)peak=eq;const dd=(peak-eq)/peak*100;if(dd>maxDD)maxDD=dd;
  }
  console.log(`  ${r.label.padEnd(22)} Rs.${(eq/100000).toFixed(1)}L (${((eq-1000000)/1000000*100).toFixed(1).padStart(5)}%) | MaxDD: ${maxDD.toFixed(1)}% | W/L: ${w}/${l}`);
}

// Walk-forward
console.log('\n═══ WALK-FORWARD (70/30) ═══\n');
const sorted=[...qualifying].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
for(const cfg of configs){
  const isR=simulate(sorted.slice(0,sp),cfg.fn,cfg.name);
  const oosR=simulate(sorted.slice(sp),cfg.fn,cfg.name);
  console.log(`  ${cfg.name}`);
  console.log(`    IS:  ${isR.falseStops} false, ${isR.wins}W/${isR.losses}L, WR ${isR.winRate.toFixed(1)}%, Exp ${isR.expectancy.toFixed(2)}%`);
  console.log(`    OOS: ${oosR.falseStops} false, ${oosR.wins}W/${oosR.losses}L, WR ${oosR.winRate.toFixed(1)}%, Exp ${oosR.expectancy.toFixed(2)}%`);
}

// Monte Carlo
console.log('\n═══ MONTE CARLO (500 shuffles) ═══\n');
for(const cfg of configs){
  const mcWR=[],mcExp=[],mcFS=[];
  for(let mc=0;mc<500;mc++){
    const sh=[...qualifying].sort(()=>Math.random()-0.5);
    const oos=sh.slice(Math.floor(sh.length*0.70));
    const r=simulate(oos,cfg.fn,cfg.name);
    if(r.decided>0){mcWR.push(r.winRate);mcExp.push(r.expectancy);mcFS.push(r.falseStops);}
  }
  mcWR.sort((a,b)=>a-b);mcExp.sort((a,b)=>a-b);
  const p=(arr,pct)=>arr[Math.floor(arr.length*pct)]||0;
  console.log(`  ${cfg.name}`);
  console.log(`    WR:  5th=${p(mcWR,0.05).toFixed(1)}% median=${p(mcWR,0.50).toFixed(1)}% P(≥90%)=${(mcWR.filter(w=>w>=90).length/mcWR.length*100).toFixed(0)}%`);
  console.log(`    Exp: 5th=${p(mcExp,0.05).toFixed(2)}% median=${p(mcExp,0.50).toFixed(2)}%`);
  console.log(`    P(zero false stops)=${(mcFS.filter(f=>f===0).length/mcFS.length*100).toFixed(0)}%\n`);
}

// The STOPPED trades — what exactly gets stopped in each config?
console.log('═══ STOPPED TRADES DETAIL ═══\n');
for(const cfg of [configs[0],configs[1],configs[4]]){
  const r=simulate(qualifying,cfg.fn,cfg.name);
  const stopped=r.trades.filter(t=>t.outcome==='STOPPED');
  console.log(`  ${cfg.name}: ${stopped.length} stopped trades`);
  if(stopped.length>0){
    for(const t of stopped){
      console.log(`    ${t.sym} ${t.date} Day${t.stopDay}: MFE+${t.mfe.toFixed(1)}% MAE${t.tradeMAE.toFixed(1)}% | ${t.h5?'FALSE STOP (was winner!)':'Correct stop (loser)'}`);
    }
  }else console.log('    None');
  console.log('');
}
