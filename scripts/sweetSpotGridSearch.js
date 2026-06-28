// SWEETEST SPOT GRID SEARCH — Stop clamp × T1 multiplier × T1 clamp × Verdict
// Exhaustive search on 14,457 signals across 77 stocks
// Scoring: Expectancy × sqrt(T1_hits) + WR_bonus

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

// Collect raw signal data with ALL forward prices for flexible re-simulation
const raw = [];
for(const{c,atr}of SD){const n=c.length;
for(let i=130;i<n-21;i++){
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

  const atrPct = atr[i] / s.c * 100;
  const rawStopDist = (s.c - (zone.zL - 0.5 * atr[i])) / s.c * 100;

  // Collect forward 20-day high/low/close for each day
  const fwd = [];
  for(let d=1;d<=20&&i+d<n;d++){
    fwd.push({h:c[i+d].h,l:c[i+d].l,c:c[i+d].c});
  }
  raw.push({entry:s.c,atrPct,rawStopDist,fwd});
}}
console.log('Raw signals: '+raw.length);

// Simulate with configurable stop clamp, T1 mult, T1 clamp
function simulate(stopFloor, stopCap, t1Mult, t1Floor, t1Cap, holdDays) {
  let wins=0,stops=0,expired=0,totalPnl=0,totalT1Pct=0;
  for(const s of raw) {
    const riskPct = Math.max(stopFloor, Math.min(stopCap, s.rawStopDist));
    const stopPrice = s.entry * (1 - riskPct / 100);
    const t1Pct = Math.max(t1Floor, Math.min(t1Cap, t1Mult * s.atrPct));
    const t1Price = s.entry * (1 + t1Pct / 100);
    const rr = riskPct > 0 ? t1Pct / riskPct : 0;

    let out = 'exp', hitT1 = false;
    const days = Math.min(holdDays, s.fwd.length);
    for(let d=0;d<days;d++){
      if(s.fwd[d].c <= stopPrice && !hitT1) { out = 'stop'; break; }
      if(s.fwd[d].h >= t1Price) hitT1 = true;
    }
    if(out !== 'stop') out = hitT1 ? 'hit' : 'exp';

    if(out === 'hit') { wins++; totalPnl += t1Pct; totalT1Pct += t1Pct; }
    else if(out === 'stop') { stops++; totalPnl -= riskPct; }
    else { expired++; const lastC = s.fwd[days-1]?.c || s.entry; totalPnl += (lastC - s.entry) / s.entry * 100; }
  }
  const n = raw.length;
  const wr = wins/n*100;
  const avgPnl = totalPnl/n;
  const avgWin = wins > 0 ? totalT1Pct / wins : 0;
  const avgLoss = stops > 0 ? riskPct => 0 : 0; // approximate
  const stopRate = stops/n*100;
  return { wins, stops, expired, wr, avgPnl, stopRate, avgWin: wins>0?totalT1Pct/wins:0 };
}

// More precise simulate
function simPrecise(sf, sc, tm, tf, tc, hd) {
  let wins=0,stops=0,totalPnl=0,totalWinPnl=0,totalLossPnl=0;
  for(const s of raw) {
    const rp = Math.max(sf, Math.min(sc, s.rawStopDist));
    const sp = s.entry * (1 - rp / 100);
    const t1p = Math.max(tf, Math.min(tc, tm * s.atrPct));
    const t1pr = s.entry * (1 + t1p / 100);
    let out = 'exp', hT1 = false;
    const days = Math.min(hd, s.fwd.length);
    for(let d=0;d<days;d++){
      if(s.fwd[d].c <= sp && !hT1) { out = 'stop'; break; }
      if(s.fwd[d].h >= t1pr) hT1 = true;
    }
    if(out !== 'stop') out = hT1 ? 'hit' : 'exp';
    if(out === 'hit') { wins++; totalPnl += t1p; totalWinPnl += t1p; }
    else if(out === 'stop') { stops++; totalPnl -= rp; totalLossPnl += rp; }
    else { const lc = s.fwd[days-1]?.c || s.entry; totalPnl += (lc - s.entry) / s.entry * 100; }
  }
  const n = raw.length;
  return {
    n, wins, stops, exp: n-wins-stops,
    wr: (wins/n*100),
    t1hr: (wins/n*100),
    avgPnl: totalPnl/n,
    avgWin: wins > 0 ? totalWinPnl/wins : 0,
    avgLoss: stops > 0 ? totalLossPnl/stops : 0,
    pf: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : wins > 0 ? 99 : 0,
    expectancy: totalPnl/n,
    stopRate: stops/n*100,
  };
}

console.log('\n'+'='.repeat(90));
console.log('EXHAUSTIVE GRID SEARCH — Stop × T1 Multiplier × T1 Clamp × Hold Days');
console.log(raw.length + ' signals');
console.log('='.repeat(90));

// Current baseline
const cur = simPrecise(3, 7, 2.5, 3, 6, 10);
console.log('\nCurrent: Stop[3,7] T1:2.5×ATR[3,6] Hold:10d');
console.log(`  WR ${cur.wr.toFixed(1)}% | Wins ${cur.wins} | Stops ${cur.stops} | PF ${cur.pf.toFixed(2)} | AvgWin +${cur.avgWin.toFixed(1)}% | AvgLoss -${cur.avgLoss.toFixed(1)}% | Expect ${cur.expectancy>=0?'+':''}${cur.expectancy.toFixed(3)}%`);

// Exhaustive grid
let best = { score: -999, params: {} };
const topResults = [];

for(const sf of [2, 2.5, 3, 3.5, 4]) {
for(const sc of [4, 4.5, 5, 5.5, 6, 6.5, 7]) {
  if(sf >= sc) continue;
for(const tm of [1.5, 1.8, 2.0, 2.15, 2.5, 2.8, 3.0, 3.5]) {
for(const tf of [2, 3, 4, 5]) {
for(const tc of [5, 6, 7, 8, 10, 12]) {
  if(tf >= tc) continue;
for(const hd of [7, 10, 12, 15, 20]) {
  const r = simPrecise(sf, sc, tm, tf, tc, hd);
  // Score: expectancy × sqrt(wins) + WR bonus - stop penalty
  const score = r.expectancy * Math.sqrt(r.wins) + r.wr * 0.5 + r.pf * 2 - r.stopRate * 0.3;
  if(score > best.score) {
    best = { score, params: {sf,sc,tm,tf,tc,hd}, result: r };
  }
  if(r.expectancy > 1.0 && r.wins > 500) {
    topResults.push({ params: {sf,sc,tm,tf,tc,hd}, result: r, score });
  }
}
}}}}}

topResults.sort((a,b) => b.score - a.score);

console.log('\n'+'='.repeat(90));
console.log('TOP 10 CONFIGURATIONS by composite score');
console.log('='.repeat(90));
console.log('  # | Stop     | T1 Mult | T1 Clamp | Hold | WR    | Wins  | Stops | PF    | AvgWin | AvgLoss | Expect  | Score');
console.log('  --+----------+---------+----------+------+-------+-------+-------+-------+--------+---------+---------+------');
for(let i=0;i<Math.min(10,topResults.length);i++){
  const t=topResults[i], p=t.params, r=t.result;
  console.log(`  ${String(i+1).padStart(2)} | [${p.sf},${p.sc}]${' '.repeat(3-String(p.sc).length)} | ${p.tm}×ATR | [${p.tf}%,${p.tc}%]${' '.repeat(4-String(p.tc).length)} | ${String(p.hd).padStart(3)}d | ${r.wr.toFixed(1).padStart(4)}% | ${String(r.wins).padStart(5)} | ${String(r.stops).padStart(5)} | ${r.pf.toFixed(2).padStart(5)} | +${r.avgWin.toFixed(1).padStart(4)}% | -${r.avgLoss.toFixed(1).padStart(4)}% | ${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(3).padStart(6)}% | ${t.score.toFixed(0).padStart(5)}`);
}

console.log('\n'+'='.repeat(90));
console.log('BEST OVERALL');
console.log('='.repeat(90));
const b=best, bp=b.params, br=b.result;
console.log(`\n  Stop: [${bp.sf}%, ${bp.sc}%]`);
console.log(`  T1: ${bp.tm}×ATR [${bp.tf}%, ${bp.tc}%]`);
console.log(`  Hold: ${bp.hd} days`);
console.log(`\n  WR:        ${br.wr.toFixed(1)}%`);
console.log(`  Wins:      ${br.wins} / ${br.n}`);
console.log(`  Stops:     ${br.stops} (${br.stopRate.toFixed(1)}%)`);
console.log(`  PF:        ${br.pf.toFixed(2)}`);
console.log(`  Avg Win:   +${br.avgWin.toFixed(2)}%`);
console.log(`  Avg Loss:  -${br.avgLoss.toFixed(2)}%`);
console.log(`  Expect:    ${(br.expectancy>=0?'+':'')+br.expectancy.toFixed(3)}%`);
console.log(`  R:R ratio: ${br.avgLoss > 0 ? (br.avgWin/br.avgLoss).toFixed(2) : '∞'}`);

// Also find best by highest expectancy
const byExpect = topResults.sort((a,b) => b.result.expectancy - a.result.expectancy);
console.log('\n'+'='.repeat(90));
console.log('TOP 5 BY PURE EXPECTANCY');
console.log('='.repeat(90));
for(let i=0;i<Math.min(5,byExpect.length);i++){
  const t=byExpect[i], p=t.params, r=t.result;
  console.log(`  Stop[${p.sf},${p.sc}] T1:${p.tm}×[${p.tf},${p.tc}] Hold:${p.hd}d → WR ${r.wr.toFixed(1)}% PF ${r.pf.toFixed(2)} Exp ${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(3)}% Wins:${r.wins} AvgW:+${r.avgWin.toFixed(1)}% AvgL:-${r.avgLoss.toFixed(1)}%`);
}

// Best by WR
const byWR = topResults.sort((a,b) => b.result.wr - a.result.wr);
console.log('\n'+'='.repeat(90));
console.log('TOP 5 BY WIN RATE');
console.log('='.repeat(90));
for(let i=0;i<Math.min(5,byWR.length);i++){
  const t=byWR[i], p=t.params, r=t.result;
  console.log(`  Stop[${p.sf},${p.sc}] T1:${p.tm}×[${p.tf},${p.tc}] Hold:${p.hd}d → WR ${r.wr.toFixed(1)}% PF ${r.pf.toFixed(2)} Exp ${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(3)}% Wins:${r.wins}`);
}

// Best by PF
const byPF = topResults.sort((a,b) => b.result.pf - a.result.pf);
console.log('\n'+'='.repeat(90));
console.log('TOP 5 BY PROFIT FACTOR');
console.log('='.repeat(90));
for(let i=0;i<Math.min(5,byPF.length);i++){
  const t=byPF[i], p=t.params, r=t.result;
  console.log(`  Stop[${p.sf},${p.sc}] T1:${p.tm}×[${p.tf},${p.tc}] Hold:${p.hd}d → WR ${r.wr.toFixed(1)}% PF ${r.pf.toFixed(2)} Exp ${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(3)}% Wins:${r.wins}`);
}

// Compare current vs best
console.log('\n'+'='.repeat(90));
console.log('CURRENT vs BEST');
console.log('='.repeat(90));
console.log(`\n  Metric      | Current            | Best`);
console.log(`  ------------+--------------------+--------------------`);
console.log(`  Stop clamp  | [3%, 7%]           | [${bp.sf}%, ${bp.sc}%]`);
console.log(`  T1 formula  | 2.5×ATR [3%, 6%]   | ${bp.tm}×ATR [${bp.tf}%, ${bp.tc}%]`);
console.log(`  Hold days   | 10                 | ${bp.hd}`);
console.log(`  Win Rate    | ${cur.wr.toFixed(1)}%              | ${br.wr.toFixed(1)}%`);
console.log(`  Wins        | ${cur.wins}              | ${br.wins}`);
console.log(`  Stops       | ${cur.stops}              | ${br.stops}`);
console.log(`  PF          | ${cur.pf.toFixed(2)}              | ${br.pf.toFixed(2)}`);
console.log(`  Avg Win     | +${cur.avgWin.toFixed(1)}%            | +${br.avgWin.toFixed(1)}%`);
console.log(`  Avg Loss    | -${cur.avgLoss.toFixed(1)}%            | -${br.avgLoss.toFixed(1)}%`);
console.log(`  R:R ratio   | ${cur.avgLoss>0?(cur.avgWin/cur.avgLoss).toFixed(2):'—'}              | ${br.avgLoss>0?(br.avgWin/br.avgLoss).toFixed(2):'—'}`);
console.log(`  Expectancy  | ${(cur.expectancy>=0?'+':'')+cur.expectancy.toFixed(3)}%          | ${(br.expectancy>=0?'+':'')+br.expectancy.toFixed(3)}%`);
