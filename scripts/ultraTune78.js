// ULTRA HYPER-TUNING — All 4 param sets on 78 OHLCV files (Portfolio + Nifty 50)
// Scoring: PF × sqrt(signals) + WR × 2 + T1HitRate × 1.5 + Expectancy × 20
// Uses latest engine: CLOSE-ONLY stop [3%,7%], no descending zones

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function parseYahoo(fp) { const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c; }
function parseNSE(fp) { const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c; }
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}r[i]=l===0?100:100-100/(1+g/2/(l/2));}return r;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?parseNSE(path.join(dir,f)):parseYahoo(path.join(dir,f));if(c.length<80)continue;SD.push({c,a:atr14(c),rsi:rsi2(c)});}}

function sim(P) {
  let sigs=0,wins=0,stops=0,t1h=0,t2h=0,totalPnl=0,totalMfe=0,totalMae=0,falseSt=0;
  for(const{c,a,rsi}of SD){const n=c.length;
  for(let i=30;i<n-11;i++){
    if(a[i]<=0||c[i].c<=0)continue;const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
    const eRA=rng/a[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100;
    let v20=0;for(let j=i-20;j<i;j++){if(j>=0)v20+=c[j].v;}v20/=20;
    let v5=0;for(let j=i-5;j<i;j++){if(j>=0)v5+=c[j].v;}v5/=5;
    const eVR=v20>0?s.v/v20:0,eVP5=v5>0?s.v/v5:0;
    let p10R=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;p10R+=(c[j].h-c[j].l)/(a[j]||1);if((c[j].h-c[j].l)/(a[j]||1)>1.1)p10E++;}p10R/=10;
    let zone=null;
    for(let zL=P.maxZone;zL>=P.minZone;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>P.maxRangeATR)ok=false;}
      if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>P.maxTightness)continue;
      const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
      zone={zH,zL:zLo,len:zL,t};break;}
    if(!zone||s.c<=zone.zH*1.001)continue;
    let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
    if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP5>=4)ups+=20;else if(eVP5>=2)ups+=12;
    if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
    let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP5>=2.5)cq++;if(eRA>=1.5)cq++;
    if(eRA<P.minExactRangeATR||eVR<P.minExactVolRatio||eVP5<P.minExactVolVsPre5)continue;
    if(cL<P.minCloseLoc||uW>P.maxUpperWick||bP<P.minBody)continue;
    if(p10R>P.maxPre10AvgRangeATR||p10E>P.maxExpansionCount)continue;
    if(rsi[i]>P.rsi2Max||ups<P.minUPS||cq<P.minCandleQuality)continue;
    const rawSt=zone.zL-0.5*a[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
    const aP=a[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP)),t2P=Math.min(5.65,2.80*aP);
    let mfe=0,mae=0,out='exp',hT1=false,hT2=false;
    for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100,lp=(cd.l-s.c)/s.c*100;
      if(hp>mfe)mfe=hp;if(lp<mae)mae=lp;
      if(cd.c<=stP&&!hT1){out='stop';break;}
      if(cd.h>=s.c*(1+t1P/100))hT1=true;
      if(cd.h>=s.c*(1+t2P/100))hT2=true;}
    if(out!=='stop'){out=hT1?'hit':'exp';}
    sigs++;totalMfe+=mfe;totalMae+=mae;
    if(out==='hit'){wins++;totalPnl+=t1P;}
    else if(out==='stop'){stops++;totalPnl-=stPct;if(mfe>=3)falseSt++;}
    else{totalPnl+=(c[Math.min(i+10,n-1)].c-s.c)/s.c*100;}
    if(hT1)t1h++;if(hT2)t2h++;
  }}
  if(sigs===0)return{sigs:0,wr:0,pf:0,exp:0,t1r:0,t2r:0,mfe:0,mae:0,fs:0,score:-9999};
  const wr=wins/sigs*100,avgPnl=totalPnl/sigs;
  const gW=wins>0?totalPnl:0;// approximate
  const avgW=wins>0?totalPnl/wins:0,avgL=stops>0?Math.abs((sigs-wins)*avgPnl<0?(totalPnl-wins*avgW)/stops:3):3;
  const pf=stops>0&&avgL>0?(wins*avgW)/(stops*avgL):wins>0?99:0;
  const exp=(wr/100)*Math.abs(avgW)-(1-wr/100)*avgL;
  const t1r=t1h/sigs*100,t2r=t2h/sigs*100;
  const mfe=totalMfe/sigs,mae=totalMae/sigs;
  const fs=stops>0?falseSt/stops*100:0;
  // Composite score: balance WR, PF, signals, expectancy, T1 rate
  const score=sigs>=15?pf*Math.sqrt(sigs)+wr*2+t1r*1.5+exp*20-fs*0.5:sigs>=5?pf*Math.sqrt(sigs)+wr*1.5+exp*15:-9999;
  return{sigs,wins,stops,wr,pf,exp,t1r,t2r,mfe,mae,fs,score,avgPnl};
}

console.log('█'.repeat(90));
console.log(`  ULTRA HYPER-TUNING — ${SD.length} OHLCV files`);
console.log('█'.repeat(90));

// Current params
const CURRENT = {
  'D20+': {minZone:4,maxZone:25,maxRangeATR:1.0,maxTightness:15,maxPre10AvgRangeATR:0.85,maxExpansionCount:3,minExactRangeATR:0.8,minExactVolRatio:1.2,minExactVolVsPre5:1.5,minCloseLoc:55,maxUpperWick:45,minBody:25,rsi2Max:92,minUPS:20,minCandleQuality:2},
  'HP15+': {minZone:5,maxZone:25,maxRangeATR:1.0,maxTightness:12,maxPre10AvgRangeATR:0.80,maxExpansionCount:2,minExactRangeATR:1.0,minExactVolRatio:1.4,minExactVolVsPre5:2.0,minCloseLoc:60,maxUpperWick:40,minBody:30,rsi2Max:90,minUPS:30,minCandleQuality:3},
  'E10+': {minZone:4,maxZone:25,maxRangeATR:0.95,maxTightness:12,maxPre10AvgRangeATR:0.80,maxExpansionCount:2,minExactRangeATR:1.2,minExactVolRatio:1.2,minExactVolVsPre5:2.0,minCloseLoc:55,maxUpperWick:35,minBody:25,rsi2Max:90,minUPS:25,minCandleQuality:2},
  'US8+': {minZone:7,maxZone:25,maxRangeATR:0.90,maxTightness:8,maxPre10AvgRangeATR:0.70,maxExpansionCount:1,minExactRangeATR:1.4,minExactVolRatio:1.8,minExactVolVsPre5:3.0,minCloseLoc:70,maxUpperWick:30,minBody:40,rsi2Max:85,minUPS:50,minCandleQuality:4},
};

// Baseline
console.log('\n═══ BASELINE (current params + latest engine) ═══\n');
console.log('  Set   │ Sigs │ WR    │ PF    │ T1Hit │ T1→T2 │ MFE   │ MAE   │ FalseStop │ Expect │ Score');
console.log('  ──────┼──────┼───────┼───────┼───────┼───────┼───────┼───────┼───────────┼────────┼──────');
for(const[n,p]of Object.entries(CURRENT)){const r=sim(p);
  console.log(`  ${n.padEnd(5)} │ ${String(r.sigs).padStart(4)} │ ${r.wr.toFixed(1).padStart(4)}% │ ${r.pf.toFixed(2).padStart(5)} │ ${r.t1r.toFixed(0).padStart(4)}% │ ${(r.t1r>0?(r.t2r/r.t1r*100).toFixed(0):'—').padStart(4)}% │ ${('+'+r.mfe.toFixed(1)).padStart(5)} │ ${r.mae.toFixed(1).padStart(5)} │ ${r.fs.toFixed(0).padStart(8)}% │ ${(r.exp>=0?'+':'')+r.exp.toFixed(2).padStart(5)} │ ${r.score.toFixed(0).padStart(5)}`);}

// Multi-pass optimization: tune each param 3 rounds (convergence)
function optimizeSet(name, base, grid, minSigs) {
  let best = { ...base };
  for (let round = 1; round <= 3; round++) {
    let improved = false;
    for (const [param, values] of Object.entries(grid)) {
      let bestVal = best[param], bestScore = sim(best).score;
      for (const val of values) {
        const test = { ...best, [param]: val };
        const r = sim(test);
        if (r.sigs >= minSigs && r.score > bestScore) { bestScore = r.score; bestVal = val; improved = true; }
      }
      best[param] = bestVal;
    }
    if (!improved) break;
  }
  return best;
}

// D20+ ultra-tune
console.log('\n═══ D20+ ULTRA HYPER-TUNING (3-pass convergence) ═══\n');
const d20Grid = {
  minZone:[3,4,5,6],maxTightness:[10,12,14,15,18,20],maxPre10AvgRangeATR:[0.65,0.70,0.75,0.80,0.85,0.90],
  maxExpansionCount:[1,2,3,4],minExactRangeATR:[0.6,0.7,0.8,0.9,1.0,1.1,1.2],
  minExactVolRatio:[0.8,1.0,1.2,1.4,1.6],minExactVolVsPre5:[1.0,1.2,1.5,1.8,2.0,2.5],
  minCloseLoc:[50,55,60,65,70],maxUpperWick:[30,35,40,45,50],minBody:[15,20,25,30,35,40],
  rsi2Max:[82,85,88,90,92,95,98],minUPS:[10,15,20,25,30,35],minCandleQuality:[1,2,3,4]
};
const optD20=optimizeSet('D20+',CURRENT['D20+'],d20Grid,20);
const curD20=sim(CURRENT['D20+']),newD20=sim(optD20);
console.log(`  Current: ${curD20.sigs}sig ${curD20.wr.toFixed(1)}%WR PF${curD20.pf.toFixed(2)} T1:${curD20.t1r.toFixed(0)}% Exp${(curD20.exp>=0?'+':'')+curD20.exp.toFixed(2)} FS${curD20.fs.toFixed(0)}%`);
console.log(`  Tuned:   ${newD20.sigs}sig ${newD20.wr.toFixed(1)}%WR PF${newD20.pf.toFixed(2)} T1:${newD20.t1r.toFixed(0)}% Exp${(newD20.exp>=0?'+':'')+newD20.exp.toFixed(2)} FS${newD20.fs.toFixed(0)}%`);
console.log('  Changes:');
for(const[k,v]of Object.entries(optD20)){if(v!==CURRENT['D20+'][k])console.log(`    ${k.padEnd(24)} ${CURRENT['D20+'][k]} → ${v}`);}

// HP15+ ultra-tune
console.log('\n═══ HP15+ ULTRA HYPER-TUNING ═══\n');
const hpGrid = {
  minZone:[4,5,6,7],maxTightness:[8,10,12,15,18],maxPre10AvgRangeATR:[0.65,0.70,0.75,0.80,0.85,0.90],
  maxExpansionCount:[1,2,3],minExactRangeATR:[0.8,0.9,1.0,1.1,1.2,1.3],
  minExactVolRatio:[0.8,1.0,1.2,1.4,1.6],minExactVolVsPre5:[1.2,1.5,1.8,2.0,2.5],
  minCloseLoc:[50,55,60,65,70],maxUpperWick:[30,35,40,45],minBody:[20,25,30,35],
  rsi2Max:[85,88,90,92,95],minUPS:[15,20,25,30,35],minCandleQuality:[1,2,3,4]
};
const optHP=optimizeSet('HP15+',CURRENT['HP15+'],hpGrid,10);
const curHP=sim(CURRENT['HP15+']),newHP=sim(optHP);
console.log(`  Current: ${curHP.sigs}sig ${curHP.wr.toFixed(1)}%WR PF${curHP.pf.toFixed(2)} T1:${curHP.t1r.toFixed(0)}% Exp${(curHP.exp>=0?'+':'')+curHP.exp.toFixed(2)}`);
console.log(`  Tuned:   ${newHP.sigs}sig ${newHP.wr.toFixed(1)}%WR PF${newHP.pf.toFixed(2)} T1:${newHP.t1r.toFixed(0)}% Exp${(newHP.exp>=0?'+':'')+newHP.exp.toFixed(2)}`);
console.log('  Changes:');
for(const[k,v]of Object.entries(optHP)){if(v!==CURRENT['HP15+'][k])console.log(`    ${k.padEnd(24)} ${CURRENT['HP15+'][k]} → ${v}`);}

// E10+ ultra-tune
console.log('\n═══ E10+ ULTRA HYPER-TUNING ═══\n');
const eGrid = {
  minZone:[3,4,5,6],maxTightness:[8,10,12,14,16],maxPre10AvgRangeATR:[0.65,0.70,0.75,0.80,0.85,0.90],
  maxExpansionCount:[1,2,3],minExactRangeATR:[0.8,0.9,1.0,1.1,1.2,1.3],
  minExactVolRatio:[0.8,1.0,1.2,1.4],minExactVolVsPre5:[1.2,1.5,1.8,2.0,2.5],
  minCloseLoc:[50,55,60,65],maxUpperWick:[30,35,40,45],minBody:[20,25,30,35],
  rsi2Max:[85,88,90,92,95],minUPS:[15,20,25,30,35],minCandleQuality:[1,2,3]
};
const optE=optimizeSet('E10+',CURRENT['E10+'],eGrid,8);
const curE=sim(CURRENT['E10+']),newE=sim(optE);
console.log(`  Current: ${curE.sigs}sig ${curE.wr.toFixed(1)}%WR PF${curE.pf.toFixed(2)} T1:${curE.t1r.toFixed(0)}% Exp${(curE.exp>=0?'+':'')+curE.exp.toFixed(2)}`);
console.log(`  Tuned:   ${newE.sigs}sig ${newE.wr.toFixed(1)}%WR PF${newE.pf.toFixed(2)} T1:${newE.t1r.toFixed(0)}% Exp${(newE.exp>=0?'+':'')+newE.exp.toFixed(2)}`);
console.log('  Changes:');
for(const[k,v]of Object.entries(optE)){if(v!==CURRENT['E10+'][k])console.log(`    ${k.padEnd(24)} ${CURRENT['E10+'][k]} → ${v}`);}

// US8+ ultra-tune
console.log('\n═══ US8+ ULTRA HYPER-TUNING ═══\n');
const usGrid = {
  minZone:[4,5,6,7],maxTightness:[6,8,10,12,14],maxPre10AvgRangeATR:[0.60,0.65,0.70,0.75,0.80,0.85],
  maxExpansionCount:[1,2,3],minExactRangeATR:[0.8,1.0,1.2,1.4],
  minExactVolRatio:[1.0,1.2,1.4,1.6,1.8],minExactVolVsPre5:[1.5,2.0,2.5,3.0],
  minCloseLoc:[55,60,65,70],maxUpperWick:[25,30,35,40],minBody:[25,30,35,40],
  rsi2Max:[82,85,88,90,92],minUPS:[20,30,40,50],minCandleQuality:[2,3,4]
};
const optUS=optimizeSet('US8+',CURRENT['US8+'],usGrid,5);
const curUS=sim(CURRENT['US8+']),newUS=sim(optUS);
console.log(`  Current: ${curUS.sigs}sig ${curUS.wr.toFixed(1)}%WR PF${curUS.pf.toFixed(2)}`);
console.log(`  Tuned:   ${newUS.sigs}sig ${newUS.wr.toFixed(1)}%WR PF${newUS.pf.toFixed(2)} T1:${newUS.t1r.toFixed(0)}% Exp${(newUS.exp>=0?'+':'')+newUS.exp.toFixed(2)}`);
console.log('  Changes:');
for(const[k,v]of Object.entries(optUS)){if(v!==CURRENT['US8+'][k])console.log(`    ${k.padEnd(24)} ${CURRENT['US8+'][k]} → ${v}`);}

// ═══ FINAL COMPARISON ═══
console.log('\n'+'█'.repeat(90));
console.log('  FINAL COMPARISON — Current vs Ultra-Tuned');
console.log('█'.repeat(90)+'\n');
console.log('  Set   │ Metric    │ Current │ Ultra-Tuned │ Δ');
console.log('  ──────┼───────────┼─────────┼─────────────┼──────');
for(const[n,cur,opt]of[['D20+',curD20,newD20],['HP15+',curHP,newHP],['E10+',curE,newE],['US8+',curUS,newUS]]){
  console.log(`  ${n.padEnd(5)} │ Signals   │ ${String(cur.sigs).padStart(7)} │ ${String(opt.sigs).padStart(11)} │ ${opt.sigs-cur.sigs>=0?'+':''}${opt.sigs-cur.sigs}`);
  console.log(`  ${' '.repeat(5)} │ WinRate   │ ${cur.wr.toFixed(1).padStart(6)}% │ ${opt.wr.toFixed(1).padStart(10)}% │ ${(opt.wr-cur.wr>=0?'+':'')+(opt.wr-cur.wr).toFixed(1)}%`);
  console.log(`  ${' '.repeat(5)} │ PF        │ ${cur.pf.toFixed(2).padStart(7)} │ ${opt.pf.toFixed(2).padStart(11)} │ ${(opt.pf-cur.pf>=0?'+':'')+(opt.pf-cur.pf).toFixed(2)}`);
  console.log(`  ${' '.repeat(5)} │ T1 Hit    │ ${cur.t1r.toFixed(0).padStart(6)}% │ ${opt.t1r.toFixed(0).padStart(10)}% │ ${(opt.t1r-cur.t1r>=0?'+':'')+(opt.t1r-cur.t1r).toFixed(0)}%`);
  console.log(`  ${' '.repeat(5)} │ MFE       │ ${('+'+cur.mfe.toFixed(1)).padStart(7)} │ ${('+'+opt.mfe.toFixed(1)).padStart(11)} │ ${(opt.mfe-cur.mfe>=0?'+':'')+(opt.mfe-cur.mfe).toFixed(1)}`);
  console.log(`  ${' '.repeat(5)} │ MAE       │ ${cur.mae.toFixed(1).padStart(7)} │ ${opt.mae.toFixed(1).padStart(11)} │ ${(opt.mae-cur.mae>=0?'+':'')+(opt.mae-cur.mae).toFixed(1)}`);
  console.log(`  ${' '.repeat(5)} │ FalseStop │ ${cur.fs.toFixed(0).padStart(6)}% │ ${opt.fs.toFixed(0).padStart(10)}% │ ${(opt.fs-cur.fs>=0?'+':'')+(opt.fs-cur.fs).toFixed(0)}%`);
  console.log(`  ${' '.repeat(5)} │ Expect    │ ${(cur.exp>=0?'+':'')+cur.exp.toFixed(2).padStart(6)} │ ${(opt.exp>=0?'+':'')+opt.exp.toFixed(2).padStart(10)} │ ${(opt.exp-cur.exp>=0?'+':'')+(opt.exp-cur.exp).toFixed(2)}`);
  console.log('  ──────┼───────────┼─────────┼─────────────┼──────');
}

// Print implementation-ready params
console.log('\n═══ ULTRA-TUNED PARAMS FOR IMPLEMENTATION ═══\n');
for(const[n,p]of[['D20+',optD20],['HP15+',optHP],['E10+',optE],['US8+',optUS]]){
  console.log(`  ${n}: {`);
  for(const[k,v]of Object.entries(p))console.log(`    ${k}: ${v},`);
  console.log('  },\n');
}
