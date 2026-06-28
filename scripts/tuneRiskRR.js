// RISK% and R:R SCIENTIFIC RE-STRATIFICATION
// Backtest on 78 OHLCVs — what Risk% and R:R actually predict outcomes?

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

const signals = [];
for(const{c,atr}of SD){const n=c.length;
for(let i=130;i<n-11;i++){
  if(atr[i]<=0||c[i].c<=0)continue;
  const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
  // Zone detection
  let zone=null;
  for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
    for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>1.0)ok=false;}
    if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>20)continue;
    const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
    for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
    for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
    if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
    zone={zH,zL:zLo,len:zL,t};break;}
  if(!zone||s.c<=zone.zH*1.001)continue;

  // Stop: ZoneLow - 0.5×ATR [3%,7%]
  const rawStop = zone.zL - 0.5 * atr[i];
  const riskPct = Math.max(3, Math.min(7, (s.c - rawStop) / s.c * 100));
  const stopPrice = s.c * (1 - riskPct / 100);
  const riskPerShare = s.c - stopPrice;

  // Targets: T1 2.5×ATR [3%,6%]
  const atrPct = atr[i] / s.c * 100;
  const t1Pct = Math.max(3, Math.min(6, 2.5 * atrPct));
  const t1Price = s.c * (1 + t1Pct / 100);
  const t2Pct = Math.min(5.65, 2.80 * atrPct);
  const t3Pct = atrPct < 1.5 ? 5 : atrPct <= 3 ? 7 : 10;

  // R:R = T1 reward / risk
  const rr = riskPerShare > 0 ? (t1Price - s.c) / riskPerShare : 0;

  // Forward simulation
  let mfe=0,mae=0,h5=false,h8=false,out='exp',hitT1=false,hitT2=false,hitT3=false;
  for(let d=1;d<=10&&i+d<n;d++){
    const cd=c[i+d];
    const hp=(cd.h-s.c)/s.c*100,lp=(cd.l-s.c)/s.c*100;
    if(hp>mfe)mfe=hp;if(lp<mae)mae=lp;
    if(hp>=5)h5=true;if(hp>=8)h8=true;
    if(cd.c<=stopPrice&&!hitT1){out='stop';break;}
    if(cd.h>=t1Price)hitT1=true;
    if(cd.h>=s.c*(1+t2Pct/100))hitT2=true;
    if(cd.h>=s.c*(1+t3Pct/100))hitT3=true;
  }
  if(out!=='stop')out=hitT1?'hit':'exp';
  const pnl = out === 'stop' ? -riskPct : hitT1 ? t1Pct : (c[Math.min(i+10,n-1)].c - s.c)/s.c*100;

  signals.push({riskPct,rr,t1Pct,t2Pct,t3Pct,atrPct,mfe,mae,h5,h8,out,hitT1,hitT2,hitT3,pnl});
}}
console.log('Breakout signals: '+signals.length);

function stats(arr,label){
  if(arr.length<10)return;
  const wins=arr.filter(s=>s.out==='hit'),stops=arr.filter(s=>s.out==='stop');
  const wr=wins.length/arr.length*100;
  const h5r=arr.filter(s=>s.h5).length/arr.length*100;
  const avgMfe=arr.reduce((s,v)=>s+v.mfe,0)/arr.length;
  const avgPnl=arr.reduce((s,v)=>s+v.pnl,0)/arr.length;
  const t1r=arr.filter(s=>s.hitT1).length/arr.length*100;
  const t2r=arr.filter(s=>s.hitT2).length/arr.length*100;
  console.log(`  ${label.padEnd(28)} | ${String(arr.length).padStart(5)} | ${wr.toFixed(1).padStart(5)}% | ${h5r.toFixed(1).padStart(5)}% | ${t1r.toFixed(0).padStart(4)}% | ${t2r.toFixed(0).padStart(4)}% | ${('+'+avgMfe.toFixed(1)).padStart(6)} | ${(avgPnl>=0?'+':'')+avgPnl.toFixed(2).padStart(5)} | ${stops.length.toString().padStart(4)}`);
}

// ═══ RISK% DISTRIBUTION ═══
console.log('\n'+'='.repeat(90));
console.log('RISK% — What stop distances produce best outcomes?');
console.log('='.repeat(90));
console.log('  Range                        | Count | WR    | +5%HR | T1Hit | T2Hit | MFE    | PnL   | Stops');
console.log('  -----------------------------+-------+-------+-------+-------+-------+--------+-------+------');
for(const[lo,hi,label]of[[3,3.5,'Risk 3.0-3.5%'],[3.5,4,'Risk 3.5-4.0%'],[4,4.5,'Risk 4.0-4.5%'],[4.5,5,'Risk 4.5-5.0%'],[5,5.5,'Risk 5.0-5.5%'],[5.5,6,'Risk 5.5-6.0%'],[6,6.5,'Risk 6.0-6.5%'],[6.5,7.01,'Risk 6.5-7.0%']]){
  stats(signals.filter(s=>s.riskPct>=lo&&s.riskPct<hi),label);
}
stats(signals,'ALL (baseline)');

// ═══ R:R DISTRIBUTION ═══
console.log('\n'+'='.repeat(90));
console.log('R:R — What reward-to-risk ratios predict success?');
console.log('='.repeat(90));
console.log('  Range                        | Count | WR    | +5%HR | T1Hit | T2Hit | MFE    | PnL   | Stops');
console.log('  -----------------------------+-------+-------+-------+-------+-------+--------+-------+------');
for(const[lo,hi,label]of[[0,0.3,'R:R 0-0.3 (terrible)'],[0.3,0.5,'R:R 0.3-0.5'],[0.5,0.7,'R:R 0.5-0.7'],[0.7,0.9,'R:R 0.7-0.9'],[0.9,1.2,'R:R 0.9-1.2'],[1.2,1.5,'R:R 1.2-1.5'],[1.5,2.0,'R:R 1.5-2.0'],[2.0,3.0,'R:R 2.0-3.0'],[3.0,5.0,'R:R 3.0-5.0'],[5.0,999,'R:R 5.0+']]){
  stats(signals.filter(s=>s.rr>=lo&&s.rr<hi),label);
}

// ═══ R:R vs OUTCOME CORRELATION ═══
console.log('\n'+'='.repeat(90));
console.log('R:R — Correlation with win rate');
console.log('='.repeat(90));
let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
for(const s of signals){const x=s.rr,y=s.out==='hit'?1:0;sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;sy2+=y*y;}
const corrRR=(signals.length*sxy-sx*sy)/Math.sqrt((signals.length*sx2-sx*sx)*(signals.length*sy2-sy*sy)||1);
console.log('  Correlation (R:R vs Win): '+corrRR.toFixed(4));
console.log('  Interpretation: '+(Math.abs(corrRR)>0.15?'MODERATE':'WEAK')+' predictor');

// ═══ RISK% vs OUTCOME CORRELATION ═══
sx=0;sy=0;sxy=0;sx2=0;sy2=0;
for(const s of signals){const x=s.riskPct,y=s.out==='hit'?1:0;sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;sy2+=y*y;}
const corrRisk=(signals.length*sxy-sx*sy)/Math.sqrt((signals.length*sx2-sx*sx)*(signals.length*sy2-sy*sy)||1);
console.log('  Correlation (Risk% vs Win): '+corrRisk.toFixed(4));

// ═══ OPTIMAL VERDICT THRESHOLDS ═══
console.log('\n'+'='.repeat(90));
console.log('OPTIMAL VERDICT THRESHOLDS — Grid search');
console.log('='.repeat(90));

// Find R:R thresholds that maximize separation between tiers
console.log('\n  R:R Threshold | Pass Count | WR     | +5% HR | Stop Rate | T1→T2  | Avg PnL');
console.log('  --------------+------------+--------+--------+-----------+--------+--------');
for(const thr of [0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.2,1.5,2.0,2.5,3.0]){
  const pass=signals.filter(s=>s.rr>=thr);
  if(pass.length<20)continue;
  const wr=pass.filter(s=>s.out==='hit').length/pass.length*100;
  const h5r=pass.filter(s=>s.h5).length/pass.length*100;
  const stopR=pass.filter(s=>s.out==='stop').length/pass.length*100;
  const t1t2=pass.filter(s=>s.hitT1).length>0?pass.filter(s=>s.hitT2).length/pass.filter(s=>s.hitT1).length*100:0;
  const avgPnl=pass.reduce((s,v)=>s+v.pnl,0)/pass.length;
  console.log(`  R:R ≥ ${String(thr).padStart(4)}   | ${String(pass.length).padStart(10)} | ${wr.toFixed(1).padStart(5)}% | ${h5r.toFixed(1).padStart(5)}% | ${stopR.toFixed(1).padStart(8)}% | ${t1t2.toFixed(0).padStart(5)}% | ${(avgPnl>=0?'+':'')+avgPnl.toFixed(2)}`);
}

// Same for Risk%
console.log('\n  Risk% Threshold | Pass Count | WR     | +5% HR | Stop Rate | Avg PnL');
console.log('  ----------------+------------+--------+--------+-----------+--------');
for(const thr of [3.0,3.5,4.0,4.5,5.0,5.5,6.0,6.5,7.0]){
  const pass=signals.filter(s=>s.riskPct<=thr);
  if(pass.length<20)continue;
  const wr=pass.filter(s=>s.out==='hit').length/pass.length*100;
  const h5r=pass.filter(s=>s.h5).length/pass.length*100;
  const stopR=pass.filter(s=>s.out==='stop').length/pass.length*100;
  const avgPnl=pass.reduce((s,v)=>s+v.pnl,0)/pass.length;
  console.log(`  Risk ≤ ${String(thr).padStart(4)}%  | ${String(pass.length).padStart(10)} | ${wr.toFixed(1).padStart(5)}% | ${h5r.toFixed(1).padStart(5)}% | ${stopR.toFixed(1).padStart(8)}% | ${(avgPnl>=0?'+':'')+avgPnl.toFixed(2)}`);
}

// ═══ T1 TARGET MULTIPLIER OPTIMIZATION ═══
console.log('\n'+'='.repeat(90));
console.log('T1 TARGET — What multiplier and clamp produces best T1 hit rate + PnL?');
console.log('='.repeat(90));
console.log('  Multiplier | Clamp    | T1 Hits | T1 HR  | Avg Win | Avg R:R | Expectancy');
console.log('  -----------+----------+---------+--------+---------+---------+-----------');

for(const mult of [1.5,1.8,2.0,2.15,2.5,2.8,3.0]){
for(const[floor,cap]of[[2,4],[2,5],[3,5],[3,6],[3,7],[4,8]]){
  let hits=0,total=0,totalPnl=0,totalRR=0;
  for(const s of signals){
    const t1=Math.max(floor,Math.min(cap,mult*s.atrPct));
    total++;
    if(s.mfe>=t1){hits++;totalPnl+=t1;totalRR+=t1/s.riskPct;}
    else{totalPnl+=(s.out==='stop'?-s.riskPct:s.pnl);}
  }
  const hr=hits/total*100;
  const avgWin=hits>0?totalPnl/hits:0;
  const avgRR=hits>0?totalRR/hits:0;
  const exp=totalPnl/total;
  if(hr<30||hr>70)continue;
  console.log(`  ${mult}×ATR   | [${floor}%,${cap}%] | ${String(hits).padStart(7)} | ${hr.toFixed(1).padStart(5)}% | ${('+'+avgWin.toFixed(1)+'%').padStart(7)} | ${avgRR.toFixed(2).padStart(7)} | ${(exp>=0?'+':'')+exp.toFixed(2)+'%'}`);
}}

// ═══ STOP CLAMP OPTIMIZATION ═══
console.log('\n'+'='.repeat(90));
console.log('STOP CLAMP — What floor/cap produces best WR + lowest false stops?');
console.log('='.repeat(90));
console.log('  Clamp    | Signals | WR     | Stops | False St | Avg Loss | Expectancy');
console.log('  ---------+---------+--------+-------+----------+----------+-----------');

for(const[floor,cap]of[[2,5],[2,6],[2.5,5],[2.5,6],[3,5],[3,6],[3,7],[3.5,6],[3.5,7],[4,7],[4,8]]){
  let wins=0,stops=0,falseStops=0,total=0,totalPnl=0,totalLoss=0;
  for(const s of signals){
    const rp=Math.max(floor,Math.min(cap,s.riskPct));
    const sp=s.mfe; // simplified: check if MFE exceeds stop
    total++;
    // Simulate with this clamp
    const aP=s.atrPct;const t1P=Math.max(3,Math.min(6,2.5*aP));
    if(s.out==='hit'){wins++;totalPnl+=t1P;}
    else if(s.out==='stop'){stops++;totalPnl-=rp;totalLoss+=rp;if(s.mfe>=3)falseStops++;}
    else{totalPnl+=s.pnl;}
  }
  const wr=wins/total*100;
  const avgLoss=stops>0?totalLoss/stops:0;
  const exp=totalPnl/total;
  console.log(`  [${floor}%,${cap}%] | ${String(total).padStart(7)} | ${wr.toFixed(1).padStart(5)}% | ${String(stops).padStart(5)} | ${(stops>0?(falseStops/stops*100).toFixed(0):'0').padStart(7)}% | ${('-'+avgLoss.toFixed(1)+'%').padStart(8)} | ${(exp>=0?'+':'')+exp.toFixed(2)+'%'}`);
}

// ═══ FINAL RECOMMENDATION ═══
console.log('\n'+'='.repeat(90));
console.log('RECOMMENDED VERDICT THRESHOLDS');
console.log('='.repeat(90));

// Find optimal R:R cut points for 5-tier verdict
const rrSorted=[...signals].sort((a,b)=>b.rr-a.rr);
// Find R:R values where win rate changes most
const wrByRR=[];
for(let rr=0.2;rr<=5;rr+=0.1){
  const above=signals.filter(s=>s.rr>=rr);
  const below=signals.filter(s=>s.rr<rr);
  if(above.length<20||below.length<20)continue;
  const wrAbove=above.filter(s=>s.out==='hit').length/above.length*100;
  const wrBelow=below.filter(s=>s.out==='hit').length/below.length*100;
  wrByRR.push({rr:rr.toFixed(1),wrAbove:wrAbove.toFixed(1),wrBelow:wrBelow.toFixed(1),delta:(wrAbove-wrBelow).toFixed(1),n:above.length});
}
console.log('\n  R:R cutoff | WR above | WR below | Δ WR  | N above');
console.log('  -----------+----------+----------+-------+--------');
for(const r of wrByRR.filter(r=>parseFloat(r.delta)>2||[0.5,0.7,0.9,1.0,1.2,1.5,2.0,3.0].includes(parseFloat(r.rr)))){
  console.log(`  ≥${r.rr.padStart(4)}     | ${r.wrAbove.padStart(7)}% | ${r.wrBelow.padStart(7)}% | ${r.delta.padStart(4)}% | ${String(r.n).padStart(6)}`);
}
