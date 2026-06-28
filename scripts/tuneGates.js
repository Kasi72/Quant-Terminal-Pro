// 10-GATE CASCADE ULTRA-TUNING — Grid search every gate threshold
// Full simulation on 14,445 breakout signals across 77 stocks
// Each gate has tunable parameters — find the optimal combination

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({c,atr:a14(c)});}}
console.log('Stocks: '+SD.length);

// Collect breakout signals with 20 days of forward candle data
const signals = [];
for(const{c,atr}of SD){const n=c.length;
for(let i=130;i<n-25;i++){
  if(atr[i]<=0||c[i].c<=0)continue;
  const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
  let zone=null;
  for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
    for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>1.0)ok=false;}
    if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>20)continue;
    const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
    for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
    for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
    if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
    zone={zH,zL:zLo};break;}
  if(!zone||s.c<=zone.zH*1.001)continue;

  const rawSD=(s.c-(zone.zL-0.5*atr[i]))/s.c*100;
  const riskPct=Math.max(4,Math.min(6.5,rawSD));
  const stopPrice=s.c*(1-riskPct/100);
  const atrPct=atr[i]/s.c*100;
  const t1Pct=Math.max(4,Math.min(12,2.15*atrPct));
  const t1Price=s.c*(1+t1Pct/100);
  let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;

  const fwd=[];
  for(let d=1;d<=20&&i+d<n;d++){
    const cd=c[i+d];
    fwd.push({h:cd.h,l:cd.l,c:cd.c,o:cd.o||cd.c,v:cd.v,vr:v20>0?cd.v/v20:0});
  }
  signals.push({entry:s.c,stopPrice,t1Price,riskPct,t1Pct,fwd});
}}
console.log('Signals: '+signals.length);

// Simulate with configurable gate thresholds
function simGates(G) {
  let wins=0,stops=0,falseStops=0,totalPnl=0;
  for(const s of signals){
    let out='exp',hT1=false;
    for(let d=0;d<Math.min(20,s.fwd.length);d++){
      const cd=s.fwd[d];
      if(cd.h>=s.t1Price)hT1=true;
      if(cd.c<=s.stopPrice&&!hT1){
        const rng=cd.h-cd.l||1;
        const cL=(cd.c-cd.l)/rng*100;
        const isGreen=cd.c>(cd.o||cd.c);
        const lwPct=((Math.min(cd.o||cd.c,cd.c)-cd.l)/rng)*100;
        const dipPct=s.stopPrice>0?(s.stopPrice-cd.c)/s.stopPrice*100:0;
        const prev=d>0?s.fwd[d-1]:null;
        const prevPrev=d>1?s.fwd[d-2]:null;

        // RSI-2 approx
        const ch1=prev?cd.c-prev.c:0;
        const ch2=prev&&prevPrev?prev.c-prevPrev.c:0;
        const rsiG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;
        const rsiL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
        const rsi2=rsiL<0.001?100:100-100/(1+rsiG/rsiL);

        let blocked=false;

        // G0: Spring Shield
        if(G.g0&&dipPct<G.g0Depth)blocked=true;
        // G1: RSI oversold
        if(!blocked&&G.g1&&rsi2<G.g1Thr)blocked=true;
        // G2: 2-day confirm
        if(!blocked&&G.g2){
          const prevAbove=!prev||prev.c>s.stopPrice;
          const stabilizing=prev?cd.c>=prev.c:false;
          const lowVol=cd.v!=null&&prev?.v!=null&&cd.v<prev.v*G.g2VolMult;
          if(prevAbove||stabilizing||lowVol)blocked=true;
        }
        // G3: Hammer
        if(!blocked&&G.g3&&lwPct>=G.g3LwPct&&cL>=G.g3CL)blocked=true;
        // G4: Green recovery
        if(!blocked&&G.g4&&isGreen&&cL>=G.g4CL)blocked=true;
        // G5: Close position
        if(!blocked&&G.g5&&cL>=G.g5CL)blocked=true;
        // G6: OBV
        if(!blocked&&G.g6&&prev&&cd.c>(prevPrev?.c||s.entry))blocked=true;
        // G7: Consecutive red
        if(!blocked&&G.g7&&(!prev||(prev.o||prev.c)<=prev.c))blocked=true;

        if(!blocked){out='stop';break;}
      }
    }
    if(out!=='stop')out=hT1?'hit':'exp';
    if(out==='hit'){wins++;totalPnl+=s.t1Pct;}
    else if(out==='stop'){
      stops++;totalPnl-=s.riskPct;
      let mfe=0;for(const f of s.fwd){const hp=(f.h-s.entry)/s.entry*100;if(hp>mfe)mfe=hp;}
      if(mfe>=3)falseStops++;
    }
    else{const lc=s.fwd[s.fwd.length-1]?.c||s.entry;totalPnl+=(lc-s.entry)/s.entry*100;}
  }
  const n=signals.length;
  return{wins,stops,falseStops,wr:wins/n*100,fsr:stops>0?falseStops/stops*100:0,avgPnl:totalPnl/n,stopRate:stops/n*100};
}

// Current gate config
const CURRENT = {g0:true,g0Depth:2.0,g1:true,g1Thr:8,g2:true,g2VolMult:0.8,g3:true,g3LwPct:40,g3CL:50,g4:true,g4CL:50,g5:true,g5CL:35,g6:true,g7:true};

console.log('\n'+'='.repeat(80));
console.log('CURRENT 10-GATE CASCADE');
console.log('='.repeat(80));
const cur=simGates(CURRENT);
console.log(`  WR ${cur.wr.toFixed(1)}% | Wins ${cur.wins} | Stops ${cur.stops} | FS ${cur.fsr.toFixed(0)}% | StopRate ${cur.stopRate.toFixed(1)}% | PnL ${(cur.avgPnl>=0?'+':'')+cur.avgPnl.toFixed(3)}%`);

// Test each gate independently
console.log('\n'+'='.repeat(80));
console.log('GATE-BY-GATE IMPACT — What happens when each gate is DISABLED?');
console.log('='.repeat(80));
console.log('\n  Gate disabled              | WR     | Wins  | Stops | FS%  | StopRate | ΔWR    | Impact');
console.log('  ---------------------------+--------+-------+-------+------+----------+--------+-------');

const gateNames = [
  ['g0','G0 Spring Shield'],['g1','G1 RSI Oversold'],['g2','G2 2-Day Confirm'],
  ['g3','G3 Hammer'],['g4','G4 Green Recovery'],['g5','G5 Close Position'],
  ['g6','G6 OBV Check'],['g7','G7 Consec Red']
];
for(const[key,name]of gateNames){
  const test={...CURRENT,[key]:false};
  const r=simGates(test);
  const dwr=r.wr-cur.wr;
  const impact=dwr<-1?'★★★ CRITICAL':dwr<-0.5?'★★ Important':dwr<-0.1?'★ Minor':'Negligible';
  console.log(`  ${name.padEnd(27)} | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${r.stopRate.toFixed(1).padStart(7)}% | ${(dwr>=0?'+':'')+dwr.toFixed(1).padStart(5)}% | ${impact}`);
}

// All gates disabled (raw CLOSE-ONLY stop)
const noGates={g0:false,g1:false,g2:false,g3:false,g4:false,g5:false,g6:false,g7:false};
const raw=simGates(noGates);
console.log(`  ALL gates disabled           | ${raw.wr.toFixed(1).padStart(5)}% | ${String(raw.wins).padStart(5)} | ${String(raw.stops).padStart(5)} | ${raw.fsr.toFixed(0).padStart(3)}% | ${raw.stopRate.toFixed(1).padStart(7)}% | ${((raw.wr-cur.wr)>=0?'+':'')+(raw.wr-cur.wr).toFixed(1).padStart(5)}% | Baseline`);

// ═══ GRID SEARCH EACH GATE'S THRESHOLD ═══
console.log('\n'+'='.repeat(80));
console.log('GATE THRESHOLD GRID SEARCH');
console.log('='.repeat(80));

// G0: Spring depth threshold
console.log('\n  G0 Spring Shield — optimal depth threshold:');
console.log('  Depth   | WR     | Wins  | Stops | FS%  | PnL');
console.log('  --------+--------+-------+-------+------+------');
for(const d of [0.5,1.0,1.5,2.0,2.5,3.0,4.0,5.0]){
  const r=simGates({...CURRENT,g0Depth:d});
  console.log(`  <${String(d).padEnd(4)}%  | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}`);
}

// G1: RSI threshold
console.log('\n  G1 RSI Oversold — optimal threshold:');
console.log('  RSI <   | WR     | Wins  | Stops | FS%  | PnL');
console.log('  --------+--------+-------+-------+------+------');
for(const t of [3,5,8,10,12,15,20,25,30]){
  const r=simGates({...CURRENT,g1Thr:t});
  console.log(`  <${String(t).padEnd(5)}  | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}`);
}

// G2: Volume multiplier
console.log('\n  G2 2-Day Confirm — volume multiplier:');
console.log('  Vol <   | WR     | Wins  | Stops | FS%  | PnL');
console.log('  --------+--------+-------+-------+------+------');
for(const v of [0.5,0.6,0.7,0.8,0.9,1.0,1.2]){
  const r=simGates({...CURRENT,g2VolMult:v});
  console.log(`  <${String(v).padEnd(4)}×  | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}`);
}

// G3: Hammer thresholds
console.log('\n  G3 Hammer — lower wick % threshold:');
console.log('  LwPct≥  | WR     | Wins  | Stops | FS%  | PnL');
console.log('  --------+--------+-------+-------+------+------');
for(const lw of [25,30,35,40,45,50,60]){
  const r=simGates({...CURRENT,g3LwPct:lw});
  console.log(`  ≥${String(lw).padEnd(4)}%  | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}`);
}

// G5: Close position threshold
console.log('\n  G5 Close Position — close location threshold:');
console.log('  CL≥     | WR     | Wins  | Stops | FS%  | PnL');
console.log('  --------+--------+-------+-------+------+------');
for(const cl of [20,25,30,35,40,45,50]){
  const r=simGates({...CURRENT,g5CL:cl});
  console.log(`  ≥${String(cl).padEnd(4)}%  | ${r.wr.toFixed(1).padStart(5)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.fsr.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}`);
}

// ═══ COMBINED OPTIMIZATION ═══
console.log('\n'+'='.repeat(80));
console.log('COMBINED OPTIMIZATION — 5-pass convergence on all gate thresholds');
console.log('='.repeat(80));

const grid = {
  g0Depth: [1.0,1.5,2.0,2.5,3.0,4.0],
  g1Thr: [5,8,10,15,20],
  g2VolMult: [0.6,0.7,0.8,0.9,1.0],
  g3LwPct: [30,35,40,45,50],
  g3CL: [40,45,50,55],
  g4CL: [40,45,50,55],
  g5CL: [25,30,35,40,45],
};

let best = {...CURRENT};
for(let round=1;round<=5;round++){
  let improved=false;
  for(const[param,values]of Object.entries(grid)){
    let bestVal=best[param],bestScore=-999;
    const curR=simGates(best);
    bestScore=curR.wr*3+curR.avgPnl*20-curR.fsr*0.5-curR.stopRate*0.3;
    for(const val of values){
      const test={...best,[param]:val};
      const r=simGates(test);
      const score=r.wr*3+r.avgPnl*20-r.fsr*0.5-r.stopRate*0.3;
      if(score>bestScore){bestScore=score;bestVal=val;improved=true;}
    }
    best[param]=bestVal;
  }
  const r=simGates(best);
  console.log(`  Round ${round}: WR ${r.wr.toFixed(1)}% | Wins ${r.wins} | Stops ${r.stops} | FS ${r.fsr.toFixed(0)}% | PnL ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(3)}%${improved?'':' (converged)'}`);
  if(!improved)break;
}

const final=simGates(best);
console.log('\n'+'='.repeat(80));
console.log('FINAL COMPARISON');
console.log('='.repeat(80));
console.log(`\n  Metric      | Current    | Optimized  | Δ`);
console.log(`  ------------+------------+------------+--------`);
console.log(`  WR          | ${cur.wr.toFixed(1).padStart(9)}% | ${final.wr.toFixed(1).padStart(9)}% | ${((final.wr-cur.wr)>=0?'+':'')+(final.wr-cur.wr).toFixed(1)}%`);
console.log(`  Wins        | ${String(cur.wins).padStart(10)} | ${String(final.wins).padStart(10)} | ${final.wins-cur.wins>=0?'+':''}${final.wins-cur.wins}`);
console.log(`  Stops       | ${String(cur.stops).padStart(10)} | ${String(final.stops).padStart(10)} | ${final.stops-cur.stops>=0?'+':''}${final.stops-cur.stops}`);
console.log(`  False Stop% | ${cur.fsr.toFixed(0).padStart(9)}% | ${final.fsr.toFixed(0).padStart(9)}% | ${((final.fsr-cur.fsr)>=0?'+':'')+(final.fsr-cur.fsr).toFixed(0)}%`);
console.log(`  Stop Rate   | ${cur.stopRate.toFixed(1).padStart(9)}% | ${final.stopRate.toFixed(1).padStart(9)}% | ${((final.stopRate-cur.stopRate)>=0?'+':'')+(final.stopRate-cur.stopRate).toFixed(1)}%`);
console.log(`  Avg PnL     | ${(cur.avgPnl>=0?'+':'')+cur.avgPnl.toFixed(3).padStart(8)}% | ${(final.avgPnl>=0?'+':'')+final.avgPnl.toFixed(3).padStart(8)}% | ${((final.avgPnl-cur.avgPnl)>=0?'+':'')+(final.avgPnl-cur.avgPnl).toFixed(3)}%`);

console.log('\n  Optimized thresholds:');
for(const[k,v]of Object.entries(best)){
  if(v!==CURRENT[k])console.log(`    ${k.padEnd(12)}: ${CURRENT[k]} → ${v}`);
}
console.log('\n  Full config: '+JSON.stringify(best));
