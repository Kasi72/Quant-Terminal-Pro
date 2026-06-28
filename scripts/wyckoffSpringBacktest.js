// WYCKOFF SPRING SHIELD BACKTEST
// Tests: Can we detect springs (false stops) vs real breakdowns?
// 78 OHLCVs, 14,445 breakout signals

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr:a14(c)});}}
console.log('Stocks: '+SD.length);

// Collect all breakout signals with full forward data
const signals = [];
for(const{sym,c,atr}of SD){const n=c.length;
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

  const rawStopDist=(s.c-(zone.zL-0.5*atr[i]))/s.c*100;
  const riskPct=Math.max(4,Math.min(6.5,rawStopDist));
  const stopPrice=s.c*(1-riskPct/100);
  const atrPct=atr[i]/s.c*100;
  const t1Pct=Math.max(4,Math.min(12,2.15*atrPct));
  const t1Price=s.c*(1+t1Pct/100);

  // Collect 20 days of forward data with volume
  let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;
  const fwd=[];
  for(let d=1;d<=20&&i+d<n;d++){
    fwd.push({h:c[i+d].h,l:c[i+d].l,c:c[i+d].c,o:c[i+d].o,v:c[i+d].v,vRatio:v20>0?c[i+d].v/v20:0});
  }
  signals.push({sym,entry:s.c,stopPrice,t1Price,riskPct,t1Pct,v20,fwd,zoneLow:zone.zL});
}}
console.log('Breakout signals: '+signals.length);

// ═══ PART 1: Profile of stopped trades ═══
console.log('\n'+'='.repeat(80));
console.log('PART 1: PROFILE OF STOPPED TRADES');
console.log('='.repeat(80));

// Current method: CLOSE-ONLY stop
let curWins=0,curStops=0,curFalseStops=0;
const stoppedTrades=[];
for(const s of signals){
  let out='exp',hT1=false,stopDay=-1,stopVol=0;
  for(let d=0;d<Math.min(20,s.fwd.length);d++){
    if(s.fwd[d].c<=s.stopPrice&&!hT1){out='stop';stopDay=d+1;stopVol=s.fwd[d].vRatio;break;}
    if(s.fwd[d].h>=s.t1Price)hT1=true;
  }
  if(out!=='stop')out=hT1?'hit':'exp';
  if(out==='hit')curWins++;
  if(out==='stop'){
    curStops++;
    // Check if it was a false stop (MFE ≥3% after entry)
    let mfe=0;
    for(let d=0;d<Math.min(20,s.fwd.length);d++){
      const hp=(s.fwd[d].h-s.entry)/s.entry*100;
      if(hp>mfe)mfe=hp;
    }
    const isFalse=mfe>=3;
    if(isFalse)curFalseStops++;
    stoppedTrades.push({...s,stopDay,stopVol,mfe,isFalse,
      recoveredNext: stopDay<s.fwd.length && s.fwd[stopDay]?.c > s.stopPrice,
      recoveredIn2: stopDay+1<s.fwd.length && (s.fwd[stopDay]?.c>s.stopPrice || s.fwd[stopDay+1]?.c>s.stopPrice),
      nextGreen: stopDay<s.fwd.length && s.fwd[stopDay]?.c > s.fwd[stopDay]?.o,
    });
  }
}

console.log(`\nCurrent method (CLOSE-ONLY):`);
console.log(`  Wins: ${curWins} | Stops: ${curStops} | False stops: ${curFalseStops} (${(curFalseStops/curStops*100).toFixed(0)}%)`);
console.log(`  WR: ${(curWins/signals.length*100).toFixed(1)}%`);

// Analyze stopped trades
console.log(`\nStopped trade characteristics:`);
const falseStops=stoppedTrades.filter(t=>t.isFalse);
const realStops=stoppedTrades.filter(t=>!t.isFalse);

console.log(`  FALSE stops (had +3% MFE but got stopped): ${falseStops.length}`);
console.log(`    Avg volume on stop candle: ${(falseStops.reduce((s,t)=>s+t.stopVol,0)/falseStops.length).toFixed(2)}×`);
console.log(`    Recovered next day: ${falseStops.filter(t=>t.recoveredNext).length} (${(falseStops.filter(t=>t.recoveredNext).length/falseStops.length*100).toFixed(0)}%)`);
console.log(`    Recovered in 2 days: ${falseStops.filter(t=>t.recoveredIn2).length} (${(falseStops.filter(t=>t.recoveredIn2).length/falseStops.length*100).toFixed(0)}%)`);
console.log(`    Next candle green: ${falseStops.filter(t=>t.nextGreen).length} (${(falseStops.filter(t=>t.nextGreen).length/falseStops.length*100).toFixed(0)}%)`);
console.log(`    Avg MFE after entry: +${(falseStops.reduce((s,t)=>s+t.mfe,0)/falseStops.length).toFixed(1)}%`);
console.log(`    Avg stop day: ${(falseStops.reduce((s,t)=>s+t.stopDay,0)/falseStops.length).toFixed(1)}`);

console.log(`\n  REAL stops (genuine breakdowns): ${realStops.length}`);
console.log(`    Avg volume on stop candle: ${(realStops.reduce((s,t)=>s+t.stopVol,0)/realStops.length).toFixed(2)}×`);
console.log(`    Recovered next day: ${realStops.filter(t=>t.recoveredNext).length} (${(realStops.filter(t=>t.recoveredNext).length/realStops.length*100).toFixed(0)}%)`);
console.log(`    Next candle green: ${realStops.filter(t=>t.nextGreen).length} (${(realStops.filter(t=>t.nextGreen).length/realStops.length*100).toFixed(0)}%)`);

// Volume on stop candle distribution
console.log('\n  Volume on stop candle — False vs Real:');
console.log('  Vol ratio    | False stops | Real stops | Separation?');
console.log('  -------------+------------+------------+------------');
for(const[lo,hi,label]of[[0,0.3,'<0.3×'],[0.3,0.5,'0.3-0.5×'],[0.5,0.7,'0.5-0.7×'],[0.7,1.0,'0.7-1.0×'],[1.0,1.5,'1.0-1.5×'],[1.5,2.0,'1.5-2.0×'],[2.0,999,'2.0×+']]){
  const f=falseStops.filter(t=>t.stopVol>=lo&&t.stopVol<hi).length;
  const r=realStops.filter(t=>t.stopVol>=lo&&t.stopVol<hi).length;
  const fp=falseStops.length>0?(f/falseStops.length*100).toFixed(0):'0';
  const rp=realStops.length>0?(r/realStops.length*100).toFixed(0):'0';
  console.log(`  ${label.padEnd(13)} | ${fp.padStart(9)}% | ${rp.padStart(9)}% | ${+fp>+rp?'More false':'More real'}`);
}

// ═══ PART 2: TEST SPRING SHIELD VARIATIONS ═══
console.log('\n'+'='.repeat(80));
console.log('PART 2: SPRING SHIELD STRATEGIES');
console.log('='.repeat(80));

function testSpringShield(name, shieldFn) {
  let wins=0,stops=0,falseStops=0,shielded=0,shieldedWon=0;
  for(const s of signals){
    let out='exp',hT1=false;
    for(let d=0;d<Math.min(20,s.fwd.length);d++){
      if(s.fwd[d].c<=s.stopPrice&&!hT1){
        // Apply spring shield
        const isSpring = shieldFn(s, d);
        if(isSpring){
          shielded++;
          // Don't stop — continue trading
          // Check if it eventually won
          let laterWin=false;
          for(let d2=d+1;d2<Math.min(20,s.fwd.length);d2++){
            if(s.fwd[d2].h>=s.t1Price){laterWin=true;break;}
          }
          if(laterWin){shieldedWon++;hT1=true;}
          continue; // skip this stop
        }
        out='stop';break;
      }
      if(s.fwd[d].h>=s.t1Price)hT1=true;
    }
    if(out!=='stop')out=hT1?'hit':'exp';
    if(out==='hit')wins++;
    if(out==='stop'){
      stops++;
      let mfe=0;for(let d=0;d<Math.min(20,s.fwd.length);d++){const hp=(s.fwd[d].h-s.entry)/s.entry*100;if(hp>mfe)mfe=hp;}
      if(mfe>=3)falseStops++;
    }
  }
  const wr=wins/signals.length*100;
  const fsr=stops>0?falseStops/stops*100:0;
  console.log(`  ${name.padEnd(40)} | WR ${wr.toFixed(1).padStart(5)}% | Wins ${String(wins).padStart(5)} | Stops ${String(stops).padStart(5)} | FS ${fsr.toFixed(0).padStart(3)}% | Shielded ${String(shielded).padStart(4)} (${shieldedWon} won)`);
}

console.log('\n  Strategy                               | WR     | Wins  | Stops | FS%  | Shielded (won)');
console.log('  ----------------------------------------+--------+-------+-------+------+---------------');

// Baseline
testSpringShield('Current (no shield)', () => false);

// Shield 1: Low volume on stop candle
for(const volThr of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]){
  testSpringShield(`Low vol shield (<${volThr}× avg)`, (s,d) => s.fwd[d].vRatio < volThr);
}

// Shield 2: Require 2 consecutive closes below stop
testSpringShield('2-day confirmation', (s,d) => {
  if(d+1 >= s.fwd.length) return false;
  return s.fwd[d+1].c > s.stopPrice; // next day recovers = spring
});

// Shield 3: Low volume + recovery
for(const volThr of [0.6, 0.7, 0.8]){
  testSpringShield(`LowVol(<${volThr}×) + next recovers`, (s,d) => {
    if(s.fwd[d].vRatio >= volThr) return false; // high vol = real breakdown
    if(d+1 >= s.fwd.length) return false;
    return s.fwd[d+1].c > s.stopPrice; // recovers = spring
  });
}

// Shield 4: Green recovery candle
testSpringShield('Next candle is green', (s,d) => {
  if(d+1 >= s.fwd.length) return false;
  return s.fwd[d+1].c > s.fwd[d+1].o; // green = recovery
});

// Shield 5: Low volume + green recovery
testSpringShield('LowVol(<0.7×) + green recovery', (s,d) => {
  if(s.fwd[d].vRatio >= 0.7) return false;
  if(d+1 >= s.fwd.length) return false;
  return s.fwd[d+1].c > s.fwd[d+1].o;
});

// Shield 6: Shallow dip (close barely below stop)
for(const depthThr of [0.5, 1.0, 1.5, 2.0]){
  testSpringShield(`Shallow dip (<${depthThr}% below stop)`, (s,d) => {
    const dipPct = (s.stopPrice - s.fwd[d].c) / s.stopPrice * 100;
    return dipPct < depthThr;
  });
}

// Shield 7: Combined — shallow + low vol + recovery
testSpringShield('Shallow(<1%) + LowVol(<0.8×) + recovers', (s,d) => {
  const dipPct = (s.stopPrice - s.fwd[d].c) / s.stopPrice * 100;
  if(dipPct >= 1.0) return false;
  if(s.fwd[d].vRatio >= 0.8) return false;
  if(d+1 >= s.fwd.length) return false;
  return s.fwd[d+1].c > s.stopPrice;
});

// Shield 8: Combined — low vol + close near stop + green recovery
testSpringShield('LowVol(<0.8×) + shallow(<1.5%) + green', (s,d) => {
  const dipPct = (s.stopPrice - s.fwd[d].c) / s.stopPrice * 100;
  if(dipPct >= 1.5) return false;
  if(s.fwd[d].vRatio >= 0.8) return false;
  if(d+1 >= s.fwd.length) return false;
  return s.fwd[d+1].c > s.fwd[d+1].o;
});

// ═══ PART 3: SPRING DETECTION BADGE ═══
console.log('\n'+'='.repeat(80));
console.log('PART 3: POST-SPRING BREAKOUT — Do stocks that survive a spring win more?');
console.log('='.repeat(80));

// For each signal, check if there was a spring (dip below zone low then recovery) BEFORE the breakout
let springBreakouts=0,springWins=0,noSpringBreakouts=0,noSpringWins=0;
for(const{sym,c,atr}of SD){const n=c.length;
for(let i=130;i<n-21;i++){
  if(atr[i]<=0||c[i].c<=0)continue;
  const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
  let zone=null;
  for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
    for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>1.0)ok=false;}
    if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>20)continue;
    zone={zH,zL:zLo,len:zL};break;}
  if(!zone||s.c<=zone.zH*1.001)continue;

  // Check if there was a spring in the zone period (wick or close below zone low then recovery)
  let hadSpring=false;
  for(let j=i-zone.len;j<i;j++){
    if(j<1)continue;
    if(c[j].l<zone.zL*0.99 && c[j].c>zone.zL){ // wick below, close above = spring
      hadSpring=true;break;
    }
    if(c[j].c<zone.zL && j+1<i && c[j+1].c>zone.zL){ // close below, next recovers = spring
      hadSpring=true;break;
    }
  }

  // Forward T1 check
  const atrPct=atr[i]/s.c*100;
  const t1Pct=Math.max(4,Math.min(12,2.15*atrPct));
  let hitT1=false;
  for(let d=1;d<=20&&i+d<n;d++){
    if((c[i+d].h-s.c)/s.c*100>=t1Pct){hitT1=true;break;}
  }

  if(hadSpring){springBreakouts++;if(hitT1)springWins++;}
  else{noSpringBreakouts++;if(hitT1)noSpringWins++;}
}}

console.log(`\n  Post-Spring breakouts: ${springBreakouts} signals, ${(springWins/springBreakouts*100).toFixed(1)}% T1 hit rate`);
console.log(`  No-Spring breakouts:  ${noSpringBreakouts} signals, ${(noSpringWins/noSpringBreakouts*100).toFixed(1)}% T1 hit rate`);
console.log(`  Spring premium: ${((springWins/springBreakouts - noSpringWins/noSpringBreakouts)*100).toFixed(1)}% higher WR`);

console.log('\n'+'='.repeat(80));
console.log('VERDICT');
console.log('='.repeat(80));
