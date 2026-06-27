// D20+ DEEP WIN-RATE OPTIMIZATION — 78 OHLCV files
// Goal: Enhance WR from 46% while keeping signal count viable (min 50+)
// Strategy: 5-pass convergence + 2-param interaction + 3-param combos
// Scoring: WR-heavy but penalizes dropping below 50 signals

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function parseYahoo(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function parseNSE(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}r[i]=l===0?100:100-100/(1+g/2/(l/2));}return r;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?parseNSE(path.join(dir,f)):parseYahoo(path.join(dir,f));if(c.length<80)continue;SD.push({c,a:atr14(c),rsi:rsi2(c)});}}

function sim(P){
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
      if(cd.h>=s.c*(1+t1P/100))hT1=true;if(cd.h>=s.c*(1+t2P/100))hT2=true;}
    if(out!=='stop')out=hT1?'hit':'exp';
    sigs++;totalMfe+=mfe;totalMae+=mae;
    if(out==='hit'){wins++;totalPnl+=t1P;}else if(out==='stop'){stops++;totalPnl-=stPct;if(mfe>=3)falseSt++;}
    else{totalPnl+=(c[Math.min(i+10,n-1)].c-s.c)/s.c*100;}
    if(hT1)t1h++;if(hT2)t2h++;
  }}
  if(sigs===0)return{sigs:0,wr:0,pf:0,exp:0,t1r:0,t2r:0,mfe:0,mae:0,fs:0,score:-9999,avgPnl:0};
  const wr=wins/sigs*100,avgPnl=totalPnl/sigs;
  const avgW=wins>0?Math.abs(totalPnl>0?totalPnl/wins:3):0;
  const avgL=stops>0?Math.abs(totalPnl<0?totalPnl/stops:3.5):3.5;
  const pf=stops>0?(wins*avgW)/(stops*avgL):wins>0?99:0;
  const exp=(wr/100)*avgW-(1-wr/100)*avgL;
  const t1r=t1h/sigs*100,t2r=t2h/sigs*100,mfe=totalMfe/sigs,mae=totalMae/sigs;
  const fs=stops>0?falseSt/stops*100:0;
  // D20+ scoring: WR-heavy but MUST keep 50+ signals
  const sigPenalty = sigs < 50 ? -200 : sigs < 100 ? -50 : 0;
  const score = wr*3 + pf*Math.sqrt(sigs) + t1r*2 + exp*25 - fs*0.5 + sigPenalty;
  return{sigs,wins,stops,wr,pf,exp,t1r,t2r,mfe,mae,fs,score,avgPnl};
}

console.log('█'.repeat(90));
console.log(`  D20+ DEEP WIN-RATE OPTIMIZATION — ${SD.length} stocks`);
console.log('  Constraint: MUST keep 50+ signals (wide net role)');
console.log('█'.repeat(90));

const D20_CURRENT = {minZone:4,maxZone:25,maxRangeATR:1.0,maxTightness:15,maxPre10AvgRangeATR:0.85,maxExpansionCount:3,minExactRangeATR:0.8,minExactVolRatio:1.2,minExactVolVsPre5:1.5,minCloseLoc:55,maxUpperWick:45,minBody:25,rsi2Max:92,minUPS:20,minCandleQuality:2};
const cur = sim(D20_CURRENT);
console.log(`\n  Current D20+: ${cur.sigs}sig ${cur.wr.toFixed(1)}%WR PF${cur.pf.toFixed(2)} T1:${cur.t1r.toFixed(0)}% Exp${(cur.exp>=0?'+':'')+cur.exp.toFixed(2)} FS${cur.fs.toFixed(0)}%\n`);

const grid = {
  minZone:           [3,4,5,6,7,8],
  maxTightness:      [8,10,12,14,15,18,20],
  maxPre10AvgRangeATR:[0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90],
  maxExpansionCount: [0,1,2,3,4],
  minExactRangeATR:  [0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4],
  minExactVolRatio:  [0.8,1.0,1.2,1.4,1.6,1.8],
  minExactVolVsPre5: [1.0,1.2,1.5,1.8,2.0,2.5,3.0],
  minCloseLoc:       [50,55,60,65,70,75],
  maxUpperWick:      [25,30,35,40,45,50],
  minBody:           [15,20,25,30,35,40,45],
  rsi2Max:           [78,80,82,85,88,90,92,95],
  minUPS:            [10,15,20,25,30,35,40],
  minCandleQuality:  [1,2,3,4],
};

// 5-pass convergence
console.log('═══ PASS 1-5: CONVERGENCE (50+ signal constraint) ═══\n');
let best = { ...D20_CURRENT };
for (let round = 1; round <= 5; round++) {
  let improved = false;
  for (const [param, values] of Object.entries(grid)) {
    let bestVal = best[param], bestScore = sim(best).score;
    for (const val of values) {
      const test = { ...best, [param]: val };
      const r = sim(test);
      if (r.sigs >= 50 && r.score > bestScore) { bestScore = r.score; bestVal = val; improved = true; }
    }
    best[param] = bestVal;
  }
  const r = sim(best);
  console.log(`  Round ${round}: ${r.sigs}sig ${r.wr.toFixed(1)}%WR PF${r.pf.toFixed(2)} T1:${r.t1r.toFixed(0)}% Exp${(r.exp>=0?'+':'')+r.exp.toFixed(2)} FS${r.fs.toFixed(0)}%${improved?'':' (converged)'}`);
  if (!improved) break;
}

// 2-param interaction on the 6 most impactful params
console.log('\n═══ 2-PARAM INTERACTION SEARCH ═══\n');
const keyParams = ['maxPre10AvgRangeATR','minExactRangeATR','minExactVolVsPre5','minCloseLoc','maxUpperWick','rsi2Max','maxExpansionCount','minBody'];
let bestScore = sim(best).score;
for (let a = 0; a < keyParams.length; a++) {
  for (let b = a + 1; b < keyParams.length; b++) {
    const pA = keyParams[a], pB = keyParams[b];
    const valsA = grid[pA] || [], valsB = grid[pB] || [];
    for (const vA of valsA) {
      for (const vB of valsB) {
        const test = { ...best, [pA]: vA, [pB]: vB };
        const r = sim(test);
        if (r.sigs >= 50 && r.score > bestScore) {
          bestScore = r.score;
          best = { ...test };
        }
      }
    }
  }
}
const afterInteraction = sim(best);
console.log(`  After interaction: ${afterInteraction.sigs}sig ${afterInteraction.wr.toFixed(1)}%WR PF${afterInteraction.pf.toFixed(2)} T1:${afterInteraction.t1r.toFixed(0)}% Exp${(afterInteraction.exp>=0?'+':'')+afterInteraction.exp.toFixed(2)}`);

// Final convergence pass
for (let round = 1; round <= 3; round++) {
  let improved = false;
  for (const [param, values] of Object.entries(grid)) {
    let bestVal = best[param], bs = sim(best).score;
    for (const val of values) {
      const test = { ...best, [param]: val };
      const r = sim(test);
      if (r.sigs >= 50 && r.score > bs) { bs = r.score; bestVal = val; improved = true; }
    }
    best[param] = bestVal;
  }
  if (!improved) break;
}

const finalR = sim(best);

// Also test at 100+ signal threshold
console.log('\n═══ ALTERNATIVE: 100+ signal constraint ═══\n');
let best100 = { ...D20_CURRENT };
for (let round = 1; round <= 5; round++) {
  let improved = false;
  for (const [param, values] of Object.entries(grid)) {
    let bestVal = best100[param], bs = sim(best100).score;
    for (const val of values) {
      const test = { ...best100, [param]: val };
      const r = sim(test);
      // For 100+ variant, require 100 signals
      const score100 = r.sigs >= 100 ? r.wr*3 + r.pf*Math.sqrt(r.sigs) + r.t1r*2 + r.exp*25 - r.fs*0.5 : -9999;
      const curScore100 = sim(best100).sigs >= 100 ? sim(best100).wr*3 + sim(best100).pf*Math.sqrt(sim(best100).sigs) + sim(best100).t1r*2 + sim(best100).exp*25 : -9999;
      if (score100 > curScore100) { bestVal = val; improved = true; }
    }
    best100[param] = bestVal;
  }
  if (!improved) break;
}
const r100 = sim(best100);
console.log(`  100+ variant: ${r100.sigs}sig ${r100.wr.toFixed(1)}%WR PF${r100.pf.toFixed(2)} T1:${r100.t1r.toFixed(0)}% Exp${(r100.exp>=0?'+':'')+r100.exp.toFixed(2)}`);

// ═══ FINAL ═══
console.log('\n' + '█'.repeat(90));
console.log('  D20+ FINAL COMPARISON');
console.log('█'.repeat(90) + '\n');
console.log('  Metric      │ Current │ Deep-Tuned(50+) │ Variant(100+) │ Δ (50+)');
console.log('  ────────────┼─────────┼─────────────────┼───────────────┼────────');
console.log(`  Signals     │ ${String(cur.sigs).padStart(7)} │ ${String(finalR.sigs).padStart(15)} │ ${String(r100.sigs).padStart(13)} │ ${finalR.sigs-cur.sigs>=0?'+':''}${finalR.sigs-cur.sigs}`);
console.log(`  Win Rate    │ ${cur.wr.toFixed(1).padStart(6)}% │ ${finalR.wr.toFixed(1).padStart(14)}% │ ${r100.wr.toFixed(1).padStart(12)}% │ ${(finalR.wr-cur.wr>=0?'+':'')+(finalR.wr-cur.wr).toFixed(1)}%`);
console.log(`  PF          │ ${cur.pf.toFixed(2).padStart(7)} │ ${finalR.pf.toFixed(2).padStart(15)} │ ${r100.pf.toFixed(2).padStart(13)} │ ${(finalR.pf-cur.pf>=0?'+':'')+(finalR.pf-cur.pf).toFixed(2)}`);
console.log(`  T1 Hit      │ ${cur.t1r.toFixed(0).padStart(6)}% │ ${finalR.t1r.toFixed(0).padStart(14)}% │ ${r100.t1r.toFixed(0).padStart(12)}% │ ${(finalR.t1r-cur.t1r>=0?'+':'')+(finalR.t1r-cur.t1r).toFixed(0)}%`);
console.log(`  MFE         │ ${('+'+cur.mfe.toFixed(1)).padStart(7)} │ ${('+'+finalR.mfe.toFixed(1)).padStart(15)} │ ${('+'+r100.mfe.toFixed(1)).padStart(13)} │ ${(finalR.mfe-cur.mfe>=0?'+':'')+(finalR.mfe-cur.mfe).toFixed(1)}`);
console.log(`  MAE         │ ${cur.mae.toFixed(1).padStart(7)} │ ${finalR.mae.toFixed(1).padStart(15)} │ ${r100.mae.toFixed(1).padStart(13)} │ ${(finalR.mae-cur.mae>=0?'+':'')+(finalR.mae-cur.mae).toFixed(1)}`);
console.log(`  FalseStop   │ ${cur.fs.toFixed(0).padStart(6)}% │ ${finalR.fs.toFixed(0).padStart(14)}% │ ${r100.fs.toFixed(0).padStart(12)}% │ ${(finalR.fs-cur.fs>=0?'+':'')+(finalR.fs-cur.fs).toFixed(0)}%`);
console.log(`  Expectancy  │ ${(cur.exp>=0?'+':'')+cur.exp.toFixed(2).padStart(6)} │ ${(finalR.exp>=0?'+':'')+finalR.exp.toFixed(2).padStart(14)} │ ${(r100.exp>=0?'+':'')+r100.exp.toFixed(2).padStart(12)} │ ${(finalR.exp-cur.exp>=0?'+':'')+(finalR.exp-cur.exp).toFixed(2)}`);
console.log(`  Avg PnL     │ ${(cur.avgPnl>=0?'+':'')+cur.avgPnl.toFixed(2).padStart(6)} │ ${(finalR.avgPnl>=0?'+':'')+finalR.avgPnl.toFixed(2).padStart(14)} │ ${(r100.avgPnl>=0?'+':'')+r100.avgPnl.toFixed(2).padStart(12)} │ ${(finalR.avgPnl-cur.avgPnl>=0?'+':'')+(finalR.avgPnl-cur.avgPnl).toFixed(2)}`);

console.log('\n  Changes (50+ variant):');
for (const [k, v] of Object.entries(best)) { if (v !== D20_CURRENT[k]) console.log(`    ${k.padEnd(24)} ${D20_CURRENT[k]} → ${v}`); }
if (Object.entries(best100).some(([k,v]) => v !== D20_CURRENT[k])) {
  console.log('\n  Changes (100+ variant):');
  for (const [k, v] of Object.entries(best100)) { if (v !== D20_CURRENT[k]) console.log(`    ${k.padEnd(24)} ${D20_CURRENT[k]} → ${v}`); }
}

console.log('\n═══ RECOMMENDED D20+ PARAMS ═══\n');
console.log('  {');
for (const [k, v] of Object.entries(best)) console.log(`    ${k}: ${v},`);
console.log('  }');
