// HYPER-TUNE WITH FULL ACCURATE FILTER PIPELINE
// Uses EVERY filter from stockEngine.ts — no simplifications
// Target: >80% WR, minimum false stops
// 77 stocks, 491,931 candle-days

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function computeATR14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function computeRSI2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}const ag=g/2,al=l/2;r[i]=al===0?100:100-100/(1+ag/al);}return r;}
function atrPctl120(c,atr,idx){if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;let below=0;for(let j=idx-120;j<idx;j++){const v=c[j].c>0?atr[j]/c[j].c*100:0;if(v<cur)below++;}return below/120*100;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr:computeATR14(c),rsi:computeRSI2(c)});}}
console.log('Stocks: ' + SD.length);

function sim(P) {
  const trades = [];
  for(const{sym,c,atr,rsi}of SD){const n=c.length;
  for(let i=130;i<n-11;i++){
    if(atr[i]<=0||c[i].c<=0)continue;
    const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
    let avgTO=0;for(let j=i-20;j<i;j++)avgTO+=c[j].c*c[j].v;avgTO/=20;
    if(avgTO<P.minAvgTurnover)continue;
    if(atrPctl120(c,atr,i)>P.maxATRPctl)continue;
    const eRA=rng/atr[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100,sigR=rng/s.c*100;
    let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;
    let v5=0;for(let j=i-5;j<i;j++)v5+=c[j].v;v5/=5;
    const eVR=v20>0?s.v/v20:0,eVP=v5>0?s.v/v5:0;
    let p10R=0,p10E=0,p10V=0,p10HV=0,p10RB=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;const rA=(c[j].h-c[j].l)/(atr[j]||1);p10R+=rA;if(rA>P.expM)p10E++;const vr=v20>0?c[j].v/v20:0;p10V+=vr;if(vr>P.hvM)p10HV++;if(c[j].c<c[j].o)p10RB+=vr;}
    p10R/=10;p10V/=10;p10RB/=10;
    let p5V=0;for(let j=i-5;j<i;j++){if(j>=0)p5V+=(v20>0?c[j].v/v20:0);}p5V/=5;
    const vER=p10R>0?eRA/p10R:0;
    if(p10R>P.maxP10Range)continue;
    if(p10E>P.maxP10Exp)continue;
    if(p10V>P.maxP10Vol)continue;
    if(p5V>P.maxP5Vol)continue;
    if(p10HV>P.maxP10HV)continue;
    if(p10RB>P.maxRB)continue;
    if(eRA<P.minERA||eRA>P.maxERA)continue;
    if(eVR<P.minEVR)continue;
    if(eVP<P.minEVP)continue;
    if(cL<P.minCL)continue;
    if(uW>P.maxUW)continue;
    if(bP<P.minBP)continue;
    if(sigR>P.maxSR)continue;
    if(P.minVER!=null&&vER<P.minVER)continue;
    let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP>=2.5)cq++;if(eRA>=1.5)cq++;
    if(P.minCQ!=null&&cq<P.minCQ)continue;
    if(rsi[i]<P.minRSI)continue;
    let zone=null;
    for(let zL=P.maxZ;zL>=P.minZ;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>P.zRA)ok=false;}
      if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>P.maxT)continue;
      const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
      zone={zH,zL:zLo,len:zL,t};break;}
    if(!zone)continue;
    if(s.c<=zone.zH*1.001)continue;
    if(P.maxCAZ!=null){const cabp=zone.zH>0?(s.c-zone.zH)/zone.zH*100:0;if(cabp>P.maxCAZ)continue;}
    let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
    if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP>=4)ups+=20;else if(eVP>=2)ups+=12;
    if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
    if(ups<P.minUPS)continue;

    const rawSt=zone.zL-0.5*atr[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
    const aP=atr[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP));
    let mfe=0,out='exp',hT1=false;
    for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100;if(hp>mfe)mfe=hp;
      if(cd.c<=stP&&!hT1){out='stop';break;}if(cd.h>=s.c*(1+t1P/100))hT1=true;}
    if(out!=='stop')out=hT1?'hit':'exp';
    trades.push({out,mfe,pnl:out==='stop'?-stPct:out==='hit'?t1P:(c[Math.min(i+10,n-1)].c-s.c)/s.c*100});
  }}
  if(trades.length===0)return{sigs:0,wr:0,pf:0,fs:0,avgPnl:0,score:-9999};
  const w=trades.filter(t=>t.out==='hit'),st=trades.filter(t=>t.out==='stop');
  const wr=w.length/trades.length*100;
  const gW=w.reduce((s,t)=>s+t.pnl,0),gL=Math.abs(st.reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:w.length>0?99:0;
  const fs=st.length>0?st.filter(t=>t.mfe>=3).length/st.length*100:0;
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/trades.length;
  // Score: WR-heavy, penalize <10 signals, penalize false stops
  const score=trades.length>=10?wr*4+pf*Math.sqrt(trades.length)+avgPnl*20-fs*0.5:trades.length>=5?wr*3+pf*2:-9999;
  return{sigs:trades.length,wins:w.length,stops:st.length,wr,pf,fs,avgPnl,score};
}

// Current param sets
const CURRENT = {
  'D20+': {minAvgTurnover:10000000,maxATRPctl:85,maxP10Range:0.80,maxP10Exp:1,expM:1.1,zRA:1.0,minZ:6,maxZ:25,maxT:18,maxP10Vol:0.90,maxP5Vol:0.95,maxP10HV:4,hvM:1.35,maxRB:2.00,minERA:1.1,maxERA:5.0,minEVR:0.80,minEVP:2.00,minCL:75,maxUW:45,minBP:25,maxSR:8.5,minUPS:60,minRSI:50,minVER:1.75,minCQ:2,maxCAZ:null},
  'HP15+': {minAvgTurnover:10000000,maxATRPctl:85,maxP10Range:0.80,maxP10Exp:3,expM:1.1,zRA:1.0,minZ:4,maxZ:25,maxT:18,maxP10Vol:0.85,maxP5Vol:1.10,maxP10HV:4,hvM:1.35,maxRB:2.00,minERA:1.1,maxERA:5.0,minEVR:0.80,minEVP:2.00,minCL:50,maxUW:40,minBP:30,maxSR:13,minUPS:50,minRSI:50,minVER:null,minCQ:null,maxCAZ:6.0},
  'E10+': {minAvgTurnover:20000000,maxATRPctl:60,maxP10Range:0.80,maxP10Exp:3,expM:1.1,zRA:0.95,minZ:6,maxZ:25,maxT:18,maxP10Vol:0.90,maxP5Vol:1.00,maxP10HV:2,hvM:1.2,maxRB:2.00,minERA:1.5,maxERA:6.0,minEVR:1.60,minEVP:2.00,minCL:75,maxUW:35,minBP:25,maxSR:8.5,minUPS:25,minRSI:50,minVER:1.25,minCQ:2,maxCAZ:null},
  'US8+': {minAvgTurnover:10000000,maxATRPctl:95,maxP10Range:0.80,maxP10Exp:0,expM:1.1,zRA:0.95,minZ:8,maxZ:25,maxT:6,maxP10Vol:0.90,maxP5Vol:0.95,maxP10HV:4,hvM:1.5,maxRB:2.00,minERA:1.4,maxERA:6.0,minEVR:1.60,minEVP:3.50,minCL:70,maxUW:30,minBP:40,maxSR:8.5,minUPS:45,minRSI:50,minVER:1.50,minCQ:4,maxCAZ:null},
};

// Grid for each tunable param
const GRID = {
  maxATRPctl:    [50,60,70,80,85,90,95],
  maxP10Range:   [0.60,0.65,0.70,0.75,0.80,0.85,0.90],
  maxP10Exp:     [0,1,2,3,4],
  maxT:          [5,6,8,10,12,15,18,20],
  maxP10Vol:     [0.70,0.80,0.85,0.90,0.95,1.00],
  maxP5Vol:      [0.80,0.85,0.90,0.95,1.00,1.10],
  maxP10HV:      [1,2,3,4,5],
  maxRB:         [1.00,1.10,1.50,2.00,2.50],
  minERA:        [0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6],
  minEVR:        [0.6,0.8,1.0,1.2,1.4,1.6,1.8,2.0],
  minEVP:        [1.5,2.0,2.5,3.0,3.5,4.0],
  minCL:         [55,60,65,70,75,80,85],
  maxUW:         [20,25,30,35,40,45,50],
  minBP:         [20,25,30,35,40,45],
  maxSR:         [6,7,8,8.5,10,12],
  minUPS:        [20,25,30,35,40,45,50,55,60,65],
  minVER:        [null,1.0,1.25,1.50,1.75,2.00,2.25],
  minCQ:         [null,1,2,3,4],
  minZ:          [4,5,6,7,8,10],
  maxZ:          [15,20,25],
};

function optimize(name, base, minSigs) {
  console.log('\n' + '='.repeat(70));
  console.log('TUNING: ' + name + ' (min ' + minSigs + ' signals)');
  console.log('='.repeat(70));

  const baseR = sim(base);
  console.log('Current: ' + baseR.sigs + 'sig ' + baseR.wr.toFixed(1) + '%WR PF' + baseR.pf.toFixed(2) + ' FS' + baseR.fs.toFixed(0) + '% PnL' + (baseR.avgPnl>=0?'+':'') + baseR.avgPnl.toFixed(2) + '%');

  let best = { ...base };
  // 5-pass convergence
  for (let round = 1; round <= 5; round++) {
    let improved = false;
    for (const [param, values] of Object.entries(GRID)) {
      if (best[param] === undefined) continue; // skip params not in this set
      let bestVal = best[param], bestScore = sim(best).score;
      for (const val of values) {
        const test = { ...best, [param]: val };
        const r = sim(test);
        if (r.sigs >= minSigs && r.score > bestScore) {
          bestScore = r.score;
          bestVal = val;
          improved = true;
        }
      }
      best[param] = bestVal;
    }
    const r = sim(best);
    console.log('Round ' + round + ': ' + r.sigs + 'sig ' + r.wr.toFixed(1) + '%WR PF' + r.pf.toFixed(2) + ' FS' + r.fs.toFixed(0) + '% PnL' + (r.avgPnl>=0?'+':'') + r.avgPnl.toFixed(2) + '%' + (improved ? '' : ' (converged)'));
    if (!improved) break;
  }

  const finalR = sim(best);
  console.log('\nFinal: ' + finalR.sigs + 'sig ' + finalR.wr.toFixed(1) + '%WR PF' + finalR.pf.toFixed(2) + ' FS' + finalR.fs.toFixed(0) + '% PnL' + (finalR.avgPnl>=0?'+':'') + finalR.avgPnl.toFixed(2) + '%');
  console.log('Changes:');
  for (const [k, v] of Object.entries(best)) {
    if (v !== base[k]) console.log('  ' + k.padEnd(18) + String(base[k]).padStart(6) + ' -> ' + String(v));
  }
  return { best, baseR, finalR };
}

// Optimize each set
const d20 = optimize('D20+', CURRENT['D20+'], 30);
const hp15 = optimize('HP15+', CURRENT['HP15+'], 50);
const e10 = optimize('E10+', CURRENT['E10+'], 10);
const us8 = optimize('US8+', CURRENT['US8+'], 5);

// Final comparison
console.log('\n' + '='.repeat(70));
console.log('FINAL COMPARISON');
console.log('='.repeat(70));
console.log('\nSet      | Current                          | Tuned');
console.log('---------+----------------------------------+----------------------------------');
for (const [name, res] of [['D20+', d20], ['HP15+', hp15], ['E10+', e10], ['US8+', us8]]) {
  const c = res.baseR, t = res.finalR;
  console.log(name.padEnd(9) + '| ' + (c.sigs + 'sig ' + c.wr.toFixed(1) + '%WR PF' + c.pf.toFixed(2) + ' FS' + c.fs.toFixed(0) + '%').padEnd(33) + '| ' + t.sigs + 'sig ' + t.wr.toFixed(1) + '%WR PF' + t.pf.toFixed(2) + ' FS' + t.fs.toFixed(0) + '%');
}

// Print implementation params
console.log('\n' + '='.repeat(70));
console.log('TUNED PARAMS FOR IMPLEMENTATION');
console.log('='.repeat(70));
for (const [name, res] of [['D20+', d20], ['HP15+', hp15], ['E10+', e10], ['US8+', us8]]) {
  console.log('\n' + name + ':');
  for (const [k, v] of Object.entries(res.best)) {
    console.log('  ' + k + ': ' + v + ',');
  }
}
