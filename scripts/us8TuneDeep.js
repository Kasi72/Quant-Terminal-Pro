// US8+ DEEP TUNING — Maximize win rate while keeping signal count viable
// Strategy: Start from the ultra-tuned base, do 5-pass convergence with
// scoring weighted heavily toward WR (WR × 3 + PF × sqrt(n) + Exp × 25)
// Also test 2-param combos for synergistic interactions

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
  if(sigs===0)return{sigs:0,wr:0,pf:0,exp:0,t1r:0,t2r:0,mfe:0,mae:0,fs:0,score:-9999};
  const wr=wins/sigs*100;
  const avgW=wins>0?totalPnl/wins:0,avgL=stops>0?Math.abs(stops>0?(totalPnl<0?totalPnl:0)/stops:0):0;
  const gW=wins>0?wins*(wins>0?totalPnl/wins:0):0;
  // Recalculate properly
  let grossWin=0,grossLoss=0;
  // We can't track individual trades here, use approximation
  grossWin=wins>0?wins*Math.abs(avgW):0;
  grossLoss=stops>0?stops*3.5:0; // approximate avg stop loss
  const pf=grossLoss>0?grossWin/grossLoss:wins>0?99:0;
  const exp=(wr/100)*Math.abs(avgW)-(1-wr/100)*(stops>0?Math.abs(totalPnl-wins*avgW)/stops:3);
  const t1r=t1h/sigs*100,t2r=t2h/sigs*100,mfe=totalMfe/sigs,mae=totalMae/sigs;
  const fs=stops>0?falseSt/stops*100:0;
  // WR-heavy scoring for US8+
  const score=sigs>=5?wr*3+pf*Math.sqrt(sigs)+t1r*2+exp*25-fs*0.3:sigs>=3?wr*2+exp*15:-9999;
  return{sigs,wins,stops,wr,pf,exp,t1r,t2r,mfe,mae,fs,score,avgPnl:totalPnl/sigs};
}

console.log('█'.repeat(90));
console.log(`  US8+ DEEP WIN-RATE OPTIMIZATION — ${SD.length} stocks`);
console.log('█'.repeat(90));

// Current US8+ v7-UT
const US_CURRENT = {minZone:4,maxZone:25,maxRangeATR:0.9,maxTightness:8,maxPre10AvgRangeATR:0.80,maxExpansionCount:2,minExactRangeATR:1.4,minExactVolRatio:1.6,minExactVolVsPre5:3.0,minCloseLoc:70,maxUpperWick:30,minBody:40,rsi2Max:92,minUPS:50,minCandleQuality:4};
const cur = sim(US_CURRENT);
console.log(`\n  Current US8+ v7-UT: ${cur.sigs}sig ${cur.wr.toFixed(1)}%WR PF${cur.pf.toFixed(2)} T1:${cur.t1r.toFixed(0)}% Exp${(cur.exp>=0?'+':'')+cur.exp.toFixed(2)}\n`);

// Expanded grid — finer granularity for US8+
const grid = {
  minZone:           [3,4,5,6,7,8],
  maxZone:           [15,20,25],
  maxRangeATR:       [0.80,0.85,0.90,0.95,1.0],
  maxTightness:      [5,6,7,8,10,12,15],
  maxPre10AvgRangeATR:[0.55,0.60,0.65,0.70,0.75,0.80,0.85],
  maxExpansionCount: [0,1,2,3],
  minExactRangeATR:  [0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6],
  minExactVolRatio:  [0.8,1.0,1.2,1.4,1.6,1.8,2.0],
  minExactVolVsPre5: [1.5,2.0,2.5,3.0,3.5,4.0],
  minCloseLoc:       [55,60,65,70,75,80],
  maxUpperWick:      [20,25,30,35,40],
  minBody:           [25,30,35,40,45,50],
  rsi2Max:           [80,82,85,88,90,92,95],
  minUPS:            [20,25,30,35,40,45,50],
  minCandleQuality:  [2,3,4,5],
};

// 5-pass convergence
console.log('═══ 5-PASS CONVERGENCE OPTIMIZATION (WR-weighted scoring) ═══\n');
let best = { ...US_CURRENT };
for (let round = 1; round <= 5; round++) {
  let improved = false;
  for (const [param, values] of Object.entries(grid)) {
    let bestVal = best[param], bestScore = sim(best).score;
    for (const val of values) {
      const test = { ...best, [param]: val };
      const r = sim(test);
      if (r.sigs >= 5 && r.score > bestScore) { bestScore = r.score; bestVal = val; improved = true; }
    }
    best[param] = bestVal;
  }
  const r = sim(best);
  console.log(`  Round ${round}: ${r.sigs}sig ${r.wr.toFixed(1)}%WR PF${r.pf.toFixed(2)} T1:${r.t1r.toFixed(0)}% Exp${(r.exp>=0?'+':'')+r.exp.toFixed(2)} Score:${r.score.toFixed(0)}${improved?'':' (converged)'}`);
  if (!improved) break;
}

const optR = sim(best);
console.log(`\n  Optimized: ${optR.sigs}sig ${optR.wr.toFixed(1)}%WR PF${optR.pf.toFixed(2)} T1:${optR.t1r.toFixed(0)}% MFE+${optR.mfe.toFixed(1)}% MAE${optR.mae.toFixed(1)}% Exp${(optR.exp>=0?'+':'')+optR.exp.toFixed(2)}`);
console.log('  Changes:');
for (const [k, v] of Object.entries(best)) { if (v !== US_CURRENT[k]) console.log(`    ${k.padEnd(24)} ${US_CURRENT[k]} → ${v}`); }

// ═══ 2-PARAM INTERACTION SEARCH ═══
console.log('\n═══ 2-PARAM INTERACTION SEARCH (top combos) ═══\n');
const keyParams = ['minExactRangeATR','minExactVolVsPre5','minCloseLoc','maxUpperWick','minBody','rsi2Max','maxPre10AvgRangeATR','maxTightness'];
let bestCombo = { ...best }, bestComboScore = sim(best).score;
for (let a = 0; a < keyParams.length; a++) {
  for (let b = a + 1; b < keyParams.length; b++) {
    const pA = keyParams[a], pB = keyParams[b];
    for (const vA of grid[pA] || []) {
      for (const vB of grid[pB] || []) {
        const test = { ...best, [pA]: vA, [pB]: vB };
        const r = sim(test);
        if (r.sigs >= 5 && r.score > bestComboScore) {
          bestComboScore = r.score;
          bestCombo = { ...test };
        }
      }
    }
  }
}
const comboR = sim(bestCombo);
console.log(`  Best combo: ${comboR.sigs}sig ${comboR.wr.toFixed(1)}%WR PF${comboR.pf.toFixed(2)} T1:${comboR.t1r.toFixed(0)}% Exp${(comboR.exp>=0?'+':'')+comboR.exp.toFixed(2)}`);
console.log('  Additional changes from interaction search:');
for (const [k, v] of Object.entries(bestCombo)) { if (v !== best[k]) console.log(`    ${k.padEnd(24)} ${best[k]} → ${v}`); }

// Final pass on combo result
let final = { ...bestCombo };
for (let round = 1; round <= 3; round++) {
  let improved = false;
  for (const [param, values] of Object.entries(grid)) {
    let bestVal = final[param], bestScore = sim(final).score;
    for (const val of values) {
      const test = { ...final, [param]: val };
      const r = sim(test);
      if (r.sigs >= 5 && r.score > bestScore) { bestScore = r.score; bestVal = val; improved = true; }
    }
    final[param] = bestVal;
  }
  if (!improved) break;
}

const finalR = sim(final);

// ═══ FINAL ═══
console.log('\n' + '█'.repeat(90));
console.log('  US8+ FINAL COMPARISON');
console.log('█'.repeat(90) + '\n');
console.log('  Metric      │ Current v7-UT │ Deep-Tuned │ Δ');
console.log('  ────────────┼───────────────┼────────────┼──────');
console.log(`  Signals     │ ${String(cur.sigs).padStart(13)} │ ${String(finalR.sigs).padStart(10)} │ ${finalR.sigs - cur.sigs >= 0 ? '+' : ''}${finalR.sigs - cur.sigs}`);
console.log(`  Win Rate    │ ${cur.wr.toFixed(1).padStart(12)}% │ ${finalR.wr.toFixed(1).padStart(9)}% │ ${(finalR.wr - cur.wr >= 0 ? '+' : '') + (finalR.wr - cur.wr).toFixed(1)}%`);
console.log(`  PF          │ ${cur.pf.toFixed(2).padStart(13)} │ ${finalR.pf.toFixed(2).padStart(10)} │ ${(finalR.pf - cur.pf >= 0 ? '+' : '') + (finalR.pf - cur.pf).toFixed(2)}`);
console.log(`  T1 Hit      │ ${cur.t1r.toFixed(0).padStart(12)}% │ ${finalR.t1r.toFixed(0).padStart(9)}% │ ${(finalR.t1r - cur.t1r >= 0 ? '+' : '') + (finalR.t1r - cur.t1r).toFixed(0)}%`);
console.log(`  MFE         │ ${('+' + cur.mfe.toFixed(1)).padStart(13)} │ ${('+' + finalR.mfe.toFixed(1)).padStart(10)} │ ${(finalR.mfe - cur.mfe >= 0 ? '+' : '') + (finalR.mfe - cur.mfe).toFixed(1)}`);
console.log(`  MAE         │ ${cur.mae.toFixed(1).padStart(13)} │ ${finalR.mae.toFixed(1).padStart(10)} │ ${(finalR.mae - cur.mae >= 0 ? '+' : '') + (finalR.mae - cur.mae).toFixed(1)}`);
console.log(`  FalseStop   │ ${cur.fs.toFixed(0).padStart(12)}% │ ${finalR.fs.toFixed(0).padStart(9)}% │ ${(finalR.fs - cur.fs >= 0 ? '+' : '') + (finalR.fs - cur.fs).toFixed(0)}%`);
console.log(`  Expectancy  │ ${(cur.exp >= 0 ? '+' : '') + cur.exp.toFixed(2).padStart(12)} │ ${(finalR.exp >= 0 ? '+' : '') + finalR.exp.toFixed(2).padStart(9)} │ ${(finalR.exp - cur.exp >= 0 ? '+' : '') + (finalR.exp - cur.exp).toFixed(2)}`);
console.log(`  Avg PnL     │ ${(cur.avgPnl >= 0 ? '+' : '') + cur.avgPnl.toFixed(2).padStart(12)} │ ${(finalR.avgPnl >= 0 ? '+' : '') + finalR.avgPnl.toFixed(2).padStart(9)} │ ${(finalR.avgPnl - cur.avgPnl >= 0 ? '+' : '') + (finalR.avgPnl - cur.avgPnl).toFixed(2)}`);

console.log('\n═══ FINAL US8+ PARAMS FOR IMPLEMENTATION ═══\n');
console.log('  {');
for (const [k, v] of Object.entries(final)) console.log(`    ${k}: ${v},`);
console.log('  }');
