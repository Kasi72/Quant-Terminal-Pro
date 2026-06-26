// Zone Explosion V4 Precision Max Backtest on 29 OHLCV files
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const c = [];
  for (let i=1;i<lines.length;i++){
    const [date,o,h,l,cl,v]=lines[i].split(',');
    const [d,m,y]=date.split('-');
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});
  }
  return c;
}

function computeATR14(candles) {
  const a=new Array(candles.length).fill(0);
  if(candles.length<15)return a;
  let s=0;
  for(let i=1;i<=14;i++) s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
  a[14]=s/14;
  for(let i=15;i<candles.length;i++){
    const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
    a[i]=(a[i-1]*13+tr)/14;
  }
  return a;
}

const results = [];
let totalSignals = 0;

for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv','');
  const atr = computeATR14(candles);

  for (let i = 40; i < candles.length - 21; i++) {
    const sig = candles[i];
    if (sig.c <= 0 || atr[i] <= 0) continue;
    const r = sig.h - sig.l;
    if (r <= 0) continue;

    // ═══ ZONE DETECTION (5-25 candles) ═══
    let bestZone = null;
    for (let zLen = 25; zLen >= 5; zLen--) {
      const zStart = i - zLen;
      if (zStart < 1) continue;
      let zH = -Infinity, zL = Infinity;
      let compressedCount = 0, totalInZone = 0;
      let zoneRangeATRSum = 0;
      for (let j = zStart; j < i; j++) {
        zH = Math.max(zH, candles[j].h);
        zL = Math.min(zL, candles[j].l);
        totalInZone++;
        const jr = candles[j].h - candles[j].l;
        const jAtr = atr[j] || 1;
        const jRangeATR = jr / jAtr;
        zoneRangeATRSum += jRangeATR;
        if (jRangeATR <= 0.75) compressedCount++;
      }
      if (totalInZone < 5) continue;
      const zoneTightness = zL > 0 ? ((zH - zL) / zL) * 100 : 99;
      const zoneAvgRangeATR = zoneRangeATRSum / totalInZone;
      const compressedRatio = compressedCount / totalInZone;

      if (zoneTightness <= 20 && zoneAvgRangeATR <= 0.75 && compressedRatio >= 0.75) {
        bestZone = { zH, zL, len: zLen, tightness: zoneTightness, avgRangeATR: zoneAvgRangeATR, compressedRatio };
        break;
      }
    }
    if (!bestZone) continue;

    // ═══ SIGNAL CANDLE CHECKS ═══
    const rangeATR = r / atr[i];
    const closeLoc = (sig.c - sig.l) / r * 100;
    const bodyPct = Math.abs(sig.c - sig.o) / r * 100;
    const uwPct = (sig.h - Math.max(sig.o, sig.c)) / r * 100;
    const isGreen = sig.c > sig.o;
    const closeAboveZonePct = bestZone.zH > 0 ? ((sig.c - bestZone.zH) / bestZone.zH) * 100 : 0;

    // Pre-10 avg range ATR (for vol expansion ratio)
    let pre10Sum = 0, pre10Cnt = 0;
    for (let j = i-10; j < i; j++) {
      if (j < 1) continue;
      const tr = Math.max(candles[j].h-candles[j].l, Math.abs(candles[j].h-candles[j-1].c), Math.abs(candles[j].l-candles[j-1].c));
      pre10Sum += tr / (atr[j]||1);
      pre10Cnt++;
    }
    const pre10AvgRangeATR = pre10Cnt > 0 ? pre10Sum / pre10Cnt : 1;
    const volExpansionRatio = pre10AvgRangeATR > 0 ? rangeATR / pre10AvgRangeATR : 1;

    // ADR20% (ATR as % of close)
    const adrPct = (atr[i] / sig.c) * 100;

    // Pre-10 avg volume ratio
    let pre10VolSum = 0, pre10VolCnt = 0;
    let volAvg20 = 0;
    for (let j = Math.max(0, i-20); j < i; j++) { volAvg20 += candles[j].v; }
    volAvg20 /= Math.max(i - Math.max(0, i-20), 1);
    for (let j = i-10; j < i; j++) {
      if (j < 0) continue;
      pre10VolSum += volAvg20 > 0 ? candles[j].v / volAvg20 : 0;
      pre10VolCnt++;
    }
    const pre10AvgVolRatio = pre10VolCnt > 0 ? pre10VolSum / pre10VolCnt : 1;

    // ═══ V4 PRECISION MAX FILTER ═══
    if (!(bestZone.tightness <= 20)) continue;
    if (!(bestZone.len >= 5 && bestZone.len <= 25)) continue;
    if (!(bestZone.avgRangeATR <= 0.75)) continue;
    if (!(bestZone.compressedRatio >= 0.75)) continue;
    if (!(closeAboveZonePct >= 0.75 && closeAboveZonePct <= 4.00)) continue;
    if (!(rangeATR >= 1.00 && rangeATR <= 4.00)) continue;
    if (!(volExpansionRatio >= 1.25)) continue;
    if (!(adrPct >= 3.50 && adrPct <= 7.50)) continue;
    if (!(pre10AvgVolRatio <= 1.10)) continue;
    if (!(closeLoc >= 75)) continue;
    if (!(bodyPct >= 25)) continue;
    if (!(uwPct <= 35)) continue;
    if (!isGreen) continue;

    totalSignals++;

    // ═══ FUTURE PERFORMANCE (10 and 20 days) ═══
    let mfe10 = 0, mae10 = 0, hit5 = false, daysTo5 = 99;
    let mfe20 = 0, mae20 = 0;
    for (let d = i+1; d <= Math.min(i+10, candles.length-1); d++) {
      const pct = (candles[d].h - sig.c) / sig.c * 100;
      const drop = (candles[d].l - sig.c) / sig.c * 100;
      if (pct > mfe10) mfe10 = pct;
      if (drop < mae10) mae10 = drop;
      if (!hit5 && pct >= 5) { hit5 = true; daysTo5 = d - i; }
    }
    for (let d = i+1; d <= Math.min(i+20, candles.length-1); d++) {
      const pct = (candles[d].h - sig.c) / sig.c * 100;
      const drop = (candles[d].l - sig.c) / sig.c * 100;
      if (pct > mfe20) mfe20 = pct;
      if (drop < mae20) mae20 = drop;
    }

    results.push({ sym, date: candles[i].date || new Date(sig.ts*1000).toISOString().slice(0,10),
      entry: sig.c, zoneTight: bestZone.tightness, zoneLen: bestZone.len,
      zoneAvgR: bestZone.avgRangeATR, compRatio: bestZone.compressedRatio,
      closeAboveZone: closeAboveZonePct, rangeATR, volExp: volExpansionRatio,
      adrPct, pre10VolR: pre10AvgVolRatio, closeLoc, bodyPct, uwPct,
      mfe10, mae10, mfe20, mae20, hit5, daysTo5 });
  }
}

// ═══ REPORT ═══
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ZONE EXPLOSION V4 PRECISION MAX — BACKTEST ON 29 OHLCV FILES');
console.log('═══════════════════════════════════════════════════════════════\n');

const hits = results.filter(r => r.hit5);
console.log(`Total signals found:  ${results.length}`);
console.log(`+5% hits (10 days):   ${hits.length}`);
console.log(`Hit rate:             ${results.length > 0 ? (hits.length/results.length*100).toFixed(2) : 0}%`);

// Wilson lower bound
if (results.length > 0) {
  const n = results.length, p = hits.length / n, z = 1.96;
  const wlb = (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)) / (1 + z*z/n);
  console.log(`Wilson lower bound:   ${(wlb*100).toFixed(2)}%`);
}

const avgMfe10 = results.length > 0 ? results.reduce((s,r) => s+r.mfe10, 0) / results.length : 0;
const avgMae10 = results.length > 0 ? results.reduce((s,r) => s+r.mae10, 0) / results.length : 0;
const avgMfe20 = results.length > 0 ? results.reduce((s,r) => s+r.mfe20, 0) / results.length : 0;
const avgDays = hits.length > 0 ? hits.reduce((s,r) => s+r.daysTo5, 0) / hits.length : 0;
const symbols = [...new Set(results.map(r => r.sym))];

console.log(`Avg MFE (10 days):    ${avgMfe10.toFixed(2)}%`);
console.log(`Avg MAE (10 days):    ${avgMae10.toFixed(2)}%`);
console.log(`Avg MFE (20 days):    ${avgMfe20.toFixed(2)}%`);
console.log(`Avg days to +5%:      ${avgDays.toFixed(2)} sessions`);
console.log(`Symbols:              ${symbols.length} (${symbols.join(', ')})`);

// Non-overlap trades (skip if within 10 days of previous signal for same symbol)
const nonOverlap = [];
const lastSignal = {};
for (const r of results) {
  const key = r.sym;
  if (lastSignal[key] && r.entry && lastSignal[key].entry) {
    // skip if too close in time
    const daysDiff = Math.abs(results.indexOf(r) - results.indexOf(lastSignal[key]));
    if (daysDiff < 10) continue;
  }
  nonOverlap.push(r);
  lastSignal[key] = r;
}
const noHits = nonOverlap.filter(r => r.hit5);
console.log(`\nNon-overlap trades:   ${nonOverlap.length}`);
console.log(`Non-overlap +5% hits: ${noHits.length}`);
console.log(`Non-overlap hit rate: ${nonOverlap.length > 0 ? (noHits.length/nonOverlap.length*100).toFixed(2) : 0}%`);

if (nonOverlap.length > 0) {
  const n = nonOverlap.length, p = noHits.length / n, z = 1.96;
  const wlb = (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)) / (1 + z*z/n);
  console.log(`Non-overlap Wilson LB: ${(wlb*100).toFixed(2)}%`);
}

// Individual trades
console.log('\n═══ INDIVIDUAL TRADES ═══');
console.log('Symbol       | Date       | Entry   | Zone%  | ClAbv% | RngATR | VolExp | ADR%   | +5%Hit | MFE10  | MAE10  | Days5');
for (const r of results) {
  console.log(`${r.sym.padEnd(12)} | ${(r.date||'—').padEnd(10)} | ${r.entry.toFixed(0).padStart(7)} | ${r.zoneTight.toFixed(1).padStart(5)}% | ${r.closeAboveZone.toFixed(1).padStart(5)}% | ${r.rangeATR.toFixed(2).padStart(6)} | ${r.volExp.toFixed(2).padStart(6)} | ${r.adrPct.toFixed(1).padStart(5)}% | ${r.hit5?'YES':'NO '.padStart(6)} | ${r.mfe10.toFixed(1).padStart(5)}% | ${r.mae10.toFixed(1).padStart(5)}% | ${r.hit5?String(r.daysTo5).padStart(5):'  —'}`);
}
