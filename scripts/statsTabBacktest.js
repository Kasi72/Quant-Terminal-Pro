// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS TAB BACKTEST — Fine-tune Stats/VolZ/BB%/Hurst/TTM/Mom/RSI14/CCI34/
// 52WH%/52WL%/Sharpe/InsBr on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// For every breakout-context candle, compute all 12 indicators exactly as
// statsEngine.ts does, bucket-test each against forward returns, then grid
// search the optimal composite Stats Score weighting.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
function mean(a) { return a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0; }
function stdDev(a) { if (a.length<2) return 0; const m=mean(a); return Math.sqrt(mean(a.map(v=>(v-m)**2))*a.length/(a.length-1)); }
function safe(v, f=0) { return Number.isFinite(v) ? v : f; }

function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)); a[i] = (a[i-1] * 13 + tr) / 14; }
  return a;
}
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; } return n > 0 ? s / n : 1;
}

// ─── #1 VolZ ───
function computeVolZ(c, idx) {
  const vols = []; for (let i = Math.max(0, idx-20); i < idx; i++) vols.push(c[i].v);
  const sigVol = c[idx].v, m = mean(vols), sd = stdDev(vols);
  const z = sd > 0 ? (sigVol - m) / sd : 0;
  return { z: safe(z), sig: z >= 2.0 };
}

// ─── #2 BB Width % ───
function bbWidthAt(c, idx) {
  if (idx < 20) return 0;
  const closes = []; for (let i = idx-19; i <= idx; i++) closes.push(c[i].c);
  const sma = mean(closes), sd = stdDev(closes);
  return sma > 0 ? (4*sd)/sma : 0;
}
function computeBBSqueeze(c, idx) {
  if (idx < 20) return { width: 0, pctl: 50, squeeze: false };
  const width = bbWidthAt(c, idx);
  const hist = []; const start = Math.max(20, idx-120);
  for (let e = start; e < idx; e++) hist.push(bbWidthAt(c, e));
  const pctl = hist.length ? hist.filter(v=>v<width).length/hist.length*100 : 50;
  return { width, pctl: safe(pctl,50), squeeze: pctl <= 10 };
}

// ─── #10 Hurst ───
function computeHurst(c, idx) {
  const start = Math.max(1, idx-100);
  const returns = [];
  for (let i = start; i <= idx; i++) { if (c[i-1].c>0) returns.push(Math.log(c[i].c/c[i-1].c)); }
  if (returns.length < 20) return { h: 0.5, trending: false };
  const sizes = [10,15,20,30,50].filter(s=>s<=returns.length);
  if (sizes.length < 2) return { h: 0.5, trending: false };
  const logRS = [], logN = [];
  for (const n of sizes) {
    const chunks = Math.floor(returns.length/n);
    if (chunks===0) continue;
    let rsSum = 0;
    for (let cI=0; cI<chunks; cI++) {
      const chunk = returns.slice(cI*n,(cI+1)*n);
      const m = mean(chunk), sd = stdDev(chunk);
      if (sd < 1e-10) continue;
      let cum=0, maxCum=-Infinity, minCum=Infinity;
      for (const r of chunk) { cum += r-m; if (cum>maxCum) maxCum=cum; if (cum<minCum) minCum=cum; }
      rsSum += (maxCum-minCum)/sd;
    }
    const avgRS = chunks>0 ? rsSum/chunks : 0;
    if (chunks>0 && avgRS>0) { logRS.push(Math.log(avgRS)); logN.push(Math.log(n)); }
  }
  if (logRS.length < 2) return { h: 0.5, trending: false };
  const mX = mean(logN), mY = mean(logRS);
  let num=0, den=0;
  for (let i=0;i<logN.length;i++) { num += (logN[i]-mX)*(logRS[i]-mY); den += (logN[i]-mX)**2; }
  const h = den>0 ? num/den : 0.5;
  const hC = Math.max(0, Math.min(1, safe(h,0.5)));
  return { h: hC, trending: hC > 0.55 };
}

// ─── TTM Squeeze ───
function computeTTM(c, idx) {
  const bbP=20, bbM=2.0, kcP=20, kcM=1.5;
  if (idx < Math.max(bbP,kcP)+14) return { squeezeOn:false, squeezeFired:false, momentum:0, momentumRising:false };
  const bbCloses=[]; for (let i=idx-bbP+1;i<=idx;i++) bbCloses.push(c[i].c);
  const bbSMA=mean(bbCloses), bbSD=stdDev(bbCloses);
  const bbU=bbSMA+bbM*bbSD, bbL=bbSMA-bbM*bbSD;
  let ema=c[0].c; const k=2/(kcP+1);
  for (let i=1;i<=idx;i++) ema=c[i].c*k+ema*(1-k);
  let atr=0; for (let i=idx-9;i<=idx;i++) { if(i<1) continue; atr+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)); }
  atr/=10;
  const kcU=ema+kcM*atr, kcL=ema-kcM*atr;
  const squeezeOn = bbL>kcL && bbU<kcU;
  let prevOn=false;
  if (idx > bbP+1) {
    const pbb=[]; for (let i=idx-bbP;i<idx;i++) pbb.push(c[i].c);
    const pSMA=mean(pbb), pSD=stdDev(pbb);
    const pBBU=pSMA+bbM*pSD, pBBL=pSMA-bbM*pSD;
    let pEma=c[0].c; for (let i=1;i<idx;i++) pEma=c[i].c*k+pEma*(1-k);
    let pAtr=0; for (let i=idx-10;i<idx;i++) { if(i<1) continue; pAtr+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)); }
    pAtr/=10;
    const pKCU=pEma+kcM*pAtr, pKCL=pEma-kcM*pAtr;
    prevOn = pBBL>pKCL && pBBU<pKCU;
  }
  const squeezeFired = prevOn && !squeezeOn;
  const momValues=[];
  for (let bar=idx-bbP+1; bar<=idx; bar++) {
    let hh=-Infinity, ll=Infinity;
    for (let j=bar-bbP+1;j<=bar;j++) { if(j>=0){ if(c[j].h>hh) hh=c[j].h; if(c[j].l<ll) ll=c[j].l; } }
    const dMid=(hh+ll)/2;
    let smaSum=0, smaCnt=0;
    for (let j=bar-bbP+1;j<=bar;j++) { if(j>=0){smaSum+=c[j].c;smaCnt++;} }
    const smaMid = smaCnt>0?smaSum/smaCnt:c[bar].c;
    const ref=(dMid+smaMid)/2;
    momValues.push(c[bar].c-ref);
  }
  const n=momValues.length;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i=0;i<n;i++) { sx+=i; sy+=momValues[i]; sxy+=i*momValues[i]; sx2+=i*i; }
  const dn=n*sx2-sx*sx;
  const slope = dn!==0 ? (n*sxy-sx*sy)/dn : 0;
  const intercept=(sy-slope*sx)/n;
  const momentum=intercept+slope*(n-1);
  const prevMom = n>1 ? intercept+slope*(n-2) : 0;
  return { squeezeOn, squeezeFired, momentum: safe(momentum), momentumRising: momentum>prevMom };
}

// ─── RSI14 (Wilder) ───
function computeRSI14(c, idx) {
  const period=14, needed=period+20;
  if (idx < needed) return 50;
  const start = idx-needed;
  let gains=0, losses=0;
  for (let i=start+1;i<=start+period;i++) { const d=c[i].c-c[i-1].c; if(d>0) gains+=d; else losses+=Math.abs(d); }
  let avgG=gains/period, avgL=losses/period;
  for (let i=start+period+1;i<=idx;i++) { const d=c[i].c-c[i-1].c; avgG=(avgG*(period-1)+(d>0?d:0))/period; avgL=(avgL*(period-1)+(d<0?Math.abs(d):0))/period; }
  if (avgL < 1e-10) return avgG<1e-10?50:100;
  return safe(100-100/(1+avgG/avgL));
}

// ─── CCI34 ───
function computeCCI34(c, idx) {
  const period=34;
  if (idx < period) return 0;
  const tps=[]; for (let i=idx-period+1;i<=idx;i++) tps.push((c[i].h+c[i].l+c[i].c)/3);
  const smaTP=mean(tps);
  let md=0; for (const tp of tps) md+=Math.abs(tp-smaTP); md/=period;
  if (md<1e-10) return 0;
  return safe((tps[tps.length-1]-smaTP)/(0.015*md));
}

// ─── 52W high/low ───
function compute52W(c, idx) {
  const start=Math.max(0, idx-252);
  let h52=-Infinity, l52=Infinity;
  for (let i=start;i<=idx;i++) { if(c[i].h>h52) h52=c[i].h; if(c[i].l<l52) l52=c[i].l; }
  const close=c[idx].c;
  return { ddFromHigh: safe(h52>0?(h52-close)/h52*100:0), pctFromLow: safe(l52>0?(close-l52)/l52*100:0) };
}

// ─── Sharpe20 ───
function computeSharpe20(c, idx) {
  const start=Math.max(1, idx-20);
  const returns=[]; for (let i=start;i<=idx;i++) { if(c[i-1].c>0) returns.push((c[i].c-c[i-1].c)/c[i-1].c); }
  if (returns.length<5) return 0;
  const m=mean(returns), sd=stdDev(returns);
  return sd>0 ? safe((m/sd)*Math.sqrt(252)) : 0;
}

// ─── Inside bars ───
function computeInsideBars(c, idx) {
  let count=0;
  for (let i=idx-1; i>Math.max(0,idx-10); i--) {
    if (i<1) break;
    const inside = c[i].h<=c[i-1].h && c[i].l>=c[i-1].l;
    if (inside) count++; else break;
  }
  return count;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  STATISTICS TAB BACKTEST — 12 indicators on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 280) continue; // need 252+ for 52W calcs
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ─── Build dataset: breakout-context candles ───
const points = [];
let processed = 0;
for (const { sym, c, atr } of stockData) {
  for (let i = 260; i < c.length - 21; i += 3) { // step 3 to control compute cost (Hurst is expensive)
    const s = c[i];
    if (s.c <= 0 || atr[i] <= 0) continue;
    const rng = s.h - s.l;
    if (rng <= 0) continue;
    let prior20High = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0 && c[j].h > prior20High) prior20High = c[j].h; }
    if (s.c <= prior20High * 1.001) continue;
    const v20 = volAvg(c, i, 20);
    const evr20 = v20 > 0 ? s.v / v20 : 0;
    if (evr20 < 1.0) continue;

    const volz = computeVolZ(c, i);
    const bb = computeBBSqueeze(c, i);
    const hurst = computeHurst(c, i);
    const ttm = computeTTM(c, i);
    const rsi14 = computeRSI14(c, i);
    const cci34 = computeCCI34(c, i);
    const w52 = compute52W(c, i);
    const sharpe = computeSharpe20(c, i);
    const insideBars = computeInsideBars(c, i);

    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd5 = (c[Math.min(i+5, c.length-1)].c - s.c) / s.c * 100;
    const fwd10 = (c[Math.min(i+10, c.length-1)].c - s.c) / s.c * 100;
    const fwd20 = (c[Math.min(i+20, c.length-1)].c - s.c) / s.c * 100;
    const win = fwd20 > 0;

    points.push({
      sym, idx: i, fwd5, fwd10, fwd20, maxH, win,
      volz: volz.z, bbPctl: bb.pctl, hurst: hurst.h,
      ttmOn: ttm.squeezeOn, ttmFired: ttm.squeezeFired, ttmMom: ttm.momentum, ttmRising: ttm.momentumRising,
      rsi14, cci34, ddFromHigh: w52.ddFromHigh, pctFromLow: w52.pctFromLow, sharpe, insideBars,
    });
  }
  processed++;
  if (processed % 100 === 0) console.log(`  ...processed ${processed}/${stockData.length} stocks`);
}
console.log(`\nTotal breakout-context candles: ${points.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }
function pearsonR(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]-mx)*(ys[i]-my); dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx*dy) : 0;
}

function bucketReport(label, fn, buckets) {
  console.log(`── ${label} ──`);
  console.log('  Bucket          │ Count  │ WR%    │ Avg20d%│ AvgMFE%│ >5%Rate');
  console.log('  ────────────────┼────────┼────────┼────────┼────────┼────────');
  for (const [lo, hi, bl] of buckets) {
    const bucket = points.filter(p => { const v = fn(p); return v != null && v >= lo && v < hi; });
    if (bucket.length < 15) continue;
    const wr = pct(bucket, p => p.win);
    const a20 = avg(bucket.map(p => p.fwd20));
    const aMFE = avg(bucket.map(p => p.maxH));
    const gt5 = pct(bucket, p => p.fwd20 > 5);
    console.log(`  ${bl.padEnd(16)}│ ${String(bucket.length).padStart(6)} │ ${wr.toFixed(1).padStart(6)}│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(5)}%│ ${('+'+aMFE.toFixed(1)).padStart(5)}%│ ${gt5.toFixed(1).padStart(6)}%`);
  }
  console.log('');
}

// ═══ Bucket analysis for each indicator ═══
bucketReport('VolZ Score', p => p.volz, [[-99,0,'<0'],[0,1,'0-1'],[1,1.5,'1-1.5'],[1.5,2,'1.5-2'],[2,3,'2-3 (sig)'],[3,99,'>3']]);
bucketReport('BB Width Percentile', p => p.bbPctl, [[0,5,'0-5%'],[5,10,'5-10%'],[10,20,'10-20%'],[20,40,'20-40%'],[40,70,'40-70%'],[70,100,'70-100%']]);
bucketReport('Hurst Exponent', p => p.hurst, [[0,0.4,'<0.4'],[0.4,0.45,'0.4-0.45'],[0.45,0.5,'0.45-0.5'],[0.5,0.55,'0.5-0.55'],[0.55,0.6,'0.55-0.6'],[0.6,0.65,'0.6-0.65'],[0.65,1.0,'>0.65']]);
bucketReport('RSI14', p => p.rsi14, [[0,30,'<30'],[30,40,'30-40'],[40,50,'40-50'],[50,60,'50-60'],[60,70,'60-70'],[70,80,'70-80'],[80,100,'>80']]);
bucketReport('CCI34', p => p.cci34, [[-999,-100,'<-100'],[-100,0,'-100-0'],[0,100,'0-100'],[100,150,'100-150'],[150,200,'150-200'],[200,300,'200-300'],[300,9999,'>300']]);
bucketReport('Drawdown from 52WH %', p => p.ddFromHigh, [[0,5,'0-5%'],[5,10,'5-10%'],[10,20,'10-20%'],[20,30,'20-30%'],[30,50,'30-50%'],[50,999,'>50%']]);
bucketReport('% from 52WL', p => p.pctFromLow, [[0,10,'0-10%'],[10,20,'10-20%'],[20,40,'20-40%'],[40,80,'40-80%'],[80,150,'80-150%'],[150,9999,'>150%']]);
bucketReport('Sharpe20', p => p.sharpe, [[-99,0,'<0'],[0,0.5,'0-0.5'],[0.5,1.0,'0.5-1.0'],[1.0,1.5,'1.0-1.5'],[1.5,2.5,'1.5-2.5'],[2.5,99,'>2.5']]);
bucketReport('Inside Bars', p => p.insideBars, [[0,1,'0'],[1,2,'1'],[2,3,'2'],[3,5,'3-4'],[5,99,'5+']]);

console.log('── TTM Squeeze State ──');
for (const [label, fn] of [['Squeeze ON', p=>p.ttmOn], ['Squeeze FIRED', p=>p.ttmFired], ['Squeeze OFF (neither)', p=>!p.ttmOn && !p.ttmFired]]) {
  const g = points.filter(fn);
  if (g.length < 15) continue;
  console.log(`  ${label.padEnd(22)}│ n=${String(g.length).padStart(6)} │ WR=${pct(g,p=>p.win).toFixed(1)}% │ Avg20d=${avg(g.map(p=>p.fwd20)).toFixed(2)}% │ MFE=${avg(g.map(p=>p.maxH)).toFixed(1)}%`);
}
console.log('\n── TTM Momentum Rising ──');
for (const [label, fn] of [['Rising', p=>p.ttmRising], ['Falling', p=>!p.ttmRising]]) {
  const g = points.filter(fn);
  console.log(`  ${label.padEnd(22)}│ n=${String(g.length).padStart(6)} │ WR=${pct(g,p=>p.win).toFixed(1)}% │ Avg20d=${avg(g.map(p=>p.fwd20)).toFixed(2)}% │ MFE=${avg(g.map(p=>p.maxH)).toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Correlation summary — rank all 12 by predictive power
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  CORRELATION SUMMARY vs Forward 20d Return                               ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const fwd20Arr = points.map(p => p.fwd20);
const feats = [
  ['volz', p=>p.volz], ['bbPctl', p=>p.bbPctl], ['hurst', p=>p.hurst], ['rsi14', p=>p.rsi14],
  ['cci34', p=>p.cci34], ['ddFromHigh', p=>p.ddFromHigh], ['pctFromLow', p=>p.pctFromLow],
  ['sharpe', p=>p.sharpe], ['insideBars', p=>p.insideBars], ['ttmMom', p=>p.ttmMom],
];
const corrs = feats.map(([name,fn]) => ({ name, r: pearsonR(points.map(fn), fwd20Arr) }));
corrs.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of corrs) {
  const strength = Math.abs(c.r) > 0.05 ? '★★★' : Math.abs(c.r) > 0.03 ? '★★' : Math.abs(c.r) > 0.015 ? '★' : '';
  console.log(`  ${c.name.padEnd(14)}│ r = ${(c.r>=0?'+':'')+c.r.toFixed(4)}  ${strength}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Grid search — best combined Stats filter
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  GRID SEARCH — Optimal Combined Stats Filter                              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const rsiVals = [[0,999],[50,999],[55,999],[60,999],[40,70],[45,65]];
const hurstVals = [[0,1],[0.5,1],[0.55,1],[0.45,0.6]];
const sharpeVals = [[-99,99],[0,99],[0.5,99],[1.0,99]];
const ddVals = [[0,999],[0,10],[0,20],[5,30]];

let combos = [];
for (const [rLo,rHi] of rsiVals) for (const [hLo,hHi] of hurstVals) for (const [sLo,sHi] of sharpeVals) for (const [dLo,dHi] of ddVals) {
  const filtered = points.filter(p => p.rsi14>=rLo && p.rsi14<rHi && p.hurst>=hLo && p.hurst<hHi && p.sharpe>=sLo && p.sharpe<sHi && p.ddFromHigh>=dLo && p.ddFromHigh<dHi);
  if (filtered.length < 50) continue;
  const wr = pct(filtered, p=>p.win);
  const a20 = avg(filtered.map(p=>p.fwd20));
  combos.push({ rLo,rHi,hLo,hHi,sLo,sHi,dLo,dHi, n: filtered.length, wr, a20 });
}
combos.sort((a,b)=>b.wr-a.wr);
console.log(`Tested ${combos.length} combos (min 50 signals)\n`);
console.log('Top 12 by WR:');
console.log('  RSI14      │Hurst    │Sharpe   │DD52WH   │ Count │ WR%    │ Avg20d%');
console.log('  ───────────┼─────────┼─────────┼─────────┼───────┼────────┼────────');
for (let i=0;i<Math.min(12,combos.length);i++) {
  const c=combos[i];
  console.log(`  [${c.rLo},${c.rHi}]`.padEnd(13)+`│[${c.hLo},${c.hHi}]`.padEnd(11)+`│[${c.sLo},${c.sHi}]`.padEnd(11)+`│[${c.dLo},${c.dHi}]`.padEnd(11)+`│ ${String(c.n).padStart(5)} │ ${c.wr.toFixed(1).padStart(6)}│ ${(c.a20>=0?'+':'')+c.a20.toFixed(2)}%`);
}

const baseline = { wr: pct(points,p=>p.win), a20: avg(points.map(p=>p.fwd20)) };
console.log(`\nBASELINE: WR ${baseline.wr.toFixed(1)}%, Avg20d ${baseline.a20.toFixed(2)}%`);
if (combos.length>0) console.log(`BEST EDGE: +${(combos[0].wr-baseline.wr).toFixed(1)}pp WR vs baseline`);

console.log('\n═══ STATISTICS TAB BACKTEST COMPLETE ═══');
