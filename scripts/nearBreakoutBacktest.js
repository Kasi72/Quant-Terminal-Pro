// ═══════════════════════════════════════════════════════════════════════════════
// NEAR BREAKOUT BACKTEST — Ultra-deep stratification on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// For every candle sitting INSIDE a compression zone (not yet broken out),
// measure its % distance below the zone high, then track FORWARD:
//   - Does it break out within 1/3/5/10 trading days?
//   - When it breaks out, is the breakout quality good (positive 10d/20d fwd return)
//     or a fakeout (breaks out then reverses)?
// Stratify by distance-from-zoneHigh % to find the optimal "Near Breakout" zone.
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

// Zone detection (mirrors stockEngine.ts findCompressionZone, using D20-ish params)
const ZP = { zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 15.0, minAvgTurnover20: 10e6 };
function findZone(c, atr, sigIdx) {
  const zC = [];
  for (let j = sigIdx - 1; j >= Math.max(0, sigIdx - ZP.maxZoneLen); j--) {
    if (atr[j] <= 0) break; if ((c[j].h - c[j].l) / atr[j] > ZP.zoneRangeATRThreshold) break; zC.unshift(j);
  }
  if (zC.length < ZP.minZoneLen) return null;
  let zH = -Infinity, zL = Infinity;
  for (const j of zC) { zH = Math.max(zH, c[j].h); zL = Math.min(zL, c[j].l); }
  const zt = zL > 0 ? (zH - zL) / zL * 100 : 999;
  if (zt > ZP.maxZoneTightnessPct) return null;
  return { zoneHigh: zH, zoneLow: zL, zoneLen: zC.length, zoneTightnessPct: zt, startIdx: zC[0] };
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  NEAR BREAKOUT BACKTEST — Ultra-deep stratification on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: For every "in-zone, not-yet-broken-out" candle, measure distance to
// zoneHigh and track forward outcomes
// ═══════════════════════════════════════════════════════════════════════════════
const observations = [];

for (const { sym, c, atr } of stockData) {
  for (let i = 130; i < c.length - 25; i++) {
    if (atr[i] <= 0 || c[i].c <= 0) continue;

    // Liquidity filter
    let to = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) to += c[j].c * c[j].v; } to /= 20;
    if (to < ZP.minAvgTurnover20) continue;

    const zone = findZone(c, atr, i);
    if (!zone) continue;

    const s = c[i];
    // Must be BELOW the zone high (not yet broken out) — this candle's CLOSE is the observation point
    if (s.c > zone.zoneHigh * 1.001) continue; // already broken out, skip (handled as a separate "day 0" elsewhere)
    if (s.c < zone.zoneLow * 0.98) continue; // fell out the bottom — not a valid "near breakout" observation

    const distPct = (zone.zoneHigh - s.c) / s.c * 100; // % the price needs to rise to hit zone high
    if (distPct < 0 || distPct > 15) continue; // sanity bound

    // Volume context at observation point
    const v20 = volAvg(c, i, 20);
    const volRatio = v20 > 0 ? s.v / v20 : 0;

    // Forward tracking: find first day where close > zoneHigh*1.001 (breakout), within next 15 days
    let breakoutDay = -1, breakoutClose = 0;
    for (let d = 1; d <= 15; d++) {
      const j = i + d; if (j >= c.length) break;
      if (c[j].c > zone.zoneHigh * 1.001) { breakoutDay = d; breakoutClose = c[j].c; break; }
    }

    let fwd10FromBreakout = null, fwd20FromBreakout = null, maxHFromBreakout = null, fakeout = null;
    if (breakoutDay > 0) {
      const bIdx = i + breakoutDay;
      const f10Idx = Math.min(bIdx + 10, c.length - 1);
      const f20Idx = Math.min(bIdx + 20, c.length - 1);
      fwd10FromBreakout = (c[f10Idx].c - breakoutClose) / breakoutClose * 100;
      fwd20FromBreakout = (c[f20Idx].c - breakoutClose) / breakoutClose * 100;
      let maxH = 0;
      for (let j = bIdx + 1; j <= Math.min(bIdx + 20, c.length - 1); j++) {
        const hPct = (c[j].h - breakoutClose) / breakoutClose * 100;
        if (hPct > maxH) maxH = hPct;
      }
      maxHFromBreakout = maxH;
      // Fakeout: broke out but closed back below zoneHigh within 5 days of breakout
      let closedBack = false;
      for (let j = bIdx + 1; j <= Math.min(bIdx + 5, c.length - 1); j++) {
        if (c[j].c < zone.zoneHigh) { closedBack = true; break; }
      }
      fakeout = closedBack;
    }

    observations.push({
      sym, idx: i, distPct, volRatio, zoneTightnessPct: zone.zoneTightnessPct, zoneLen: zone.zoneLen,
      breakoutDay, fwd10FromBreakout, fwd20FromBreakout, maxHFromBreakout, fakeout,
    });

    i += 1; // dense sampling within zones (don't skip — want every day's distance)
  }
}
console.log(`Total in-zone observations: ${observations.length.toLocaleString()}\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, fn) { return arr.length > 0 ? arr.filter(fn).length / arr.length * 100 : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Stratify by distance % — find where breakouts actually happen
// ═══════════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 2: Breakout Probability by Distance from Zone High                  ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const distBuckets = [
  [0, 0.5, '0-0.5%'], [0.5, 1.0, '0.5-1%'], [1.0, 1.5, '1-1.5%'], [1.5, 2.0, '1.5-2%'],
  [2.0, 2.5, '2-2.5%'], [2.5, 3.0, '2.5-3%'], [3.0, 4.0, '3-4%'], [4.0, 5.0, '4-5%'],
  [5.0, 7.0, '5-7%'], [7.0, 10.0, '7-10%'], [10.0, 15.0, '10-15%'],
];

console.log('  Distance   │ Count  │ BrkOut1d│ BrkOut3d│ BrkOut5d│ BrkOut10d│ BrkOut15d│ AvgBrkDay');
console.log('  ───────────┼────────┼─────────┼─────────┼─────────┼──────────┼──────────┼──────────');
for (const [lo, hi, label] of distBuckets) {
  const bucket = observations.filter(o => o.distPct >= lo && o.distPct < hi);
  if (bucket.length < 30) continue;
  const b1 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 1);
  const b3 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 3);
  const b5 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 5);
  const b10 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 10);
  const b15 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 15);
  const avgDay = avg(bucket.filter(o => o.breakoutDay > 0).map(o => o.breakoutDay));
  console.log(`  ${label.padEnd(11)}│ ${String(bucket.length).padStart(6)} │ ${b1.toFixed(1).padStart(6)}%│ ${b3.toFixed(1).padStart(6)}%│ ${b5.toFixed(1).padStart(6)}%│ ${b10.toFixed(1).padStart(7)}%│ ${b15.toFixed(1).padStart(7)}%│ ${avgDay.toFixed(1).padStart(8)}d`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Breakout QUALITY by distance % — when it breaks, is it a good breakout?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 3: Breakout QUALITY by Distance — Fwd Returns + Fakeout Rate       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

console.log('  Distance   │ Brkouts │ Fakeout%│ AvgFwd10%│ AvgFwd20%│ AvgMFE% │ Win%(fwd20>0)');
console.log('  ───────────┼─────────┼─────────┼──────────┼──────────┼─────────┼──────────────');
for (const [lo, hi, label] of distBuckets) {
  const bucket = observations.filter(o => o.distPct >= lo && o.distPct < hi && o.breakoutDay > 0);
  if (bucket.length < 15) continue;
  const fakeoutRate = pct(bucket, o => o.fakeout);
  const a10 = avg(bucket.map(o => o.fwd10FromBreakout));
  const a20 = avg(bucket.map(o => o.fwd20FromBreakout));
  const aMFE = avg(bucket.map(o => o.maxHFromBreakout));
  const winRate = pct(bucket, o => o.fwd20FromBreakout > 0);
  console.log(`  ${label.padEnd(11)}│ ${String(bucket.length).padStart(7)} │ ${fakeoutRate.toFixed(1).padStart(6)}%│ ${(a10>=0?'+':'')+a10.toFixed(2).padStart(7)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(7)}%│ ${('+'+aMFE.toFixed(1)).padStart(6)}%│ ${winRate.toFixed(1).padStart(12)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Volume context — does pre-breakout volume at this distance matter?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 4: Volume Ratio at Observation Point — does it predict breakout?    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const volBuckets = [[0,0.5,'<0.5x'],[0.5,0.8,'0.5-0.8x'],[0.8,1.2,'0.8-1.2x'],[1.2,1.8,'1.2-1.8x'],[1.8,3.0,'1.8-3x'],[3.0,999,'>3x']];
console.log('  VolRatio    │ Count  │ BrkOut5d│ BrkOut10d│ Fakeout%(of brkouts)');
console.log('  ────────────┼────────┼─────────┼──────────┼──────────────────────');
for (const [lo, hi, label] of volBuckets) {
  const bucket = observations.filter(o => o.volRatio >= lo && o.volRatio < hi && o.distPct <= 3.0);
  if (bucket.length < 20) continue;
  const b5 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 5);
  const b10 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 10);
  const brkouts = bucket.filter(o => o.breakoutDay > 0);
  const fakeoutRate = brkouts.length > 0 ? pct(brkouts, o => o.fakeout) : 0;
  console.log(`  ${label.padEnd(12)}│ ${String(bucket.length).padStart(6)} │ ${b5.toFixed(1).padStart(6)}%│ ${b10.toFixed(1).padStart(7)}%│ ${fakeoutRate.toFixed(1).padStart(20)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Zone Tightness at observation point — does tighter zone = faster/better breakout?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 5: Zone Tightness — does it affect near-breakout quality?          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const ztBuckets = [[0,3,'0-3%'],[3,6,'3-6%'],[6,9,'6-9%'],[9,12,'9-12%'],[12,15,'12-15%']];
console.log('  ZoneTight   │ Count  │ BrkOut5d│ BrkOut10d│ AvgFwd20%(post-brk)│ Fakeout%');
console.log('  ────────────┼────────┼─────────┼──────────┼────────────────────┼─────────');
for (const [lo, hi, label] of ztBuckets) {
  const bucket = observations.filter(o => o.zoneTightnessPct >= lo && o.zoneTightnessPct < hi && o.distPct <= 3.0);
  if (bucket.length < 20) continue;
  const b5 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 5);
  const b10 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 10);
  const brkouts = bucket.filter(o => o.breakoutDay > 0);
  const a20 = avg(brkouts.map(o => o.fwd20FromBreakout));
  const fakeoutRate = brkouts.length > 0 ? pct(brkouts, o => o.fakeout) : 0;
  console.log(`  ${label.padEnd(12)}│ ${String(bucket.length).padStart(6)} │ ${b5.toFixed(1).padStart(6)}%│ ${b10.toFixed(1).padStart(7)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(17)}%│ ${fakeoutRate.toFixed(1).padStart(6)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Grid search — optimal combined "Near Breakout" filter
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 6: Grid Search — Optimal Near-Breakout Filter                       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const distVals = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
const volVals = [0, 0.5, 0.8, 1.0, 1.2];
const ztVals = [3, 6, 9, 15, 999];

let combos = [];
for (const dMax of distVals) {
  for (const vMin of volVals) {
    for (const ztMax of ztVals) {
      const bucket = observations.filter(o => o.distPct <= dMax && o.volRatio >= vMin && o.zoneTightnessPct <= ztMax);
      if (bucket.length < 50) continue;
      const b5 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 5);
      const b10 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 10);
      const brkouts = bucket.filter(o => o.breakoutDay > 0);
      const fakeoutRate = brkouts.length > 0 ? pct(brkouts, o => o.fakeout) : 0;
      const a20 = avg(brkouts.map(o => o.fwd20FromBreakout));
      combos.push({ dMax, vMin, ztMax, n: bucket.length, b5, b10, fakeoutRate, a20, nBrk: brkouts.length });
    }
  }
}
combos.sort((a,b) => b.b5 - a.b5);
console.log(`Tested ${combos.length} combos (min 50 observations)\n`);
console.log('Top 15 by 5-day breakout probability:');
console.log('  Dist≤ │Vol≥ │ZT≤  │ Count │ BrkOut5d│ BrkOut10d│ Fakeout%│ AvgFwd20%');
console.log('  ──────┼─────┼─────┼───────┼─────────┼──────────┼─────────┼──────────');
for (let i = 0; i < Math.min(15, combos.length); i++) {
  const c = combos[i];
  console.log(`  ${c.dMax.toFixed(1).padStart(5)} │${c.vMin.toFixed(1).padStart(4)} │${(c.ztMax>=999?'  ∞':String(c.ztMax)).padStart(4)} │ ${String(c.n).padStart(5)} │ ${c.b5.toFixed(1).padStart(6)}%│ ${c.b10.toFixed(1).padStart(7)}%│ ${c.fakeoutRate.toFixed(1).padStart(6)}%│ ${(c.a20>=0?'+':'')+c.a20.toFixed(2)}%`);
}

console.log('\nTop 10 by LOWEST fakeout rate (min 30 breakouts):');
const byFakeout = combos.filter(c => c.nBrk >= 30).sort((a,b) => a.fakeoutRate - b.fakeoutRate);
console.log('  Dist≤ │Vol≥ │ZT≤  │ Count │ BrkOut5d│ BrkOut10d│ Fakeout%│ AvgFwd20%');
console.log('  ──────┼─────┼─────┼───────┼─────────┼──────────┼─────────┼──────────');
for (let i = 0; i < Math.min(10, byFakeout.length); i++) {
  const c = byFakeout[i];
  console.log(`  ${c.dMax.toFixed(1).padStart(5)} │${c.vMin.toFixed(1).padStart(4)} │${(c.ztMax>=999?'  ∞':String(c.ztMax)).padStart(4)} │ ${String(c.n).padStart(5)} │ ${c.b5.toFixed(1).padStart(6)}%│ ${c.b10.toFixed(1).padStart(7)}%│ ${c.fakeoutRate.toFixed(1).padStart(6)}%│ ${(c.a20>=0?'+':'')+c.a20.toFixed(2)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL: Proposed tiered stratification
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  PROPOSED TIERED STRATIFICATION                                           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const tiers = [
  [0, 1.0, 'IMMINENT'],
  [1.0, 2.5, 'NEAR'],
  [2.5, 5.0, 'WATCH'],
  [5.0, 10.0, 'EARLY'],
];
console.log('  Tier         │ Distance  │ Count  │ BrkOut5d│ BrkOut10d│ Fakeout%│ AvgFwd20%(post-brk)');
console.log('  ─────────────┼───────────┼────────┼─────────┼──────────┼─────────┼─────────────────────');
for (const [lo, hi, label] of tiers) {
  const bucket = observations.filter(o => o.distPct >= lo && o.distPct < hi);
  if (bucket.length === 0) continue;
  const b5 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 5);
  const b10 = pct(bucket, o => o.breakoutDay > 0 && o.breakoutDay <= 10);
  const brkouts = bucket.filter(o => o.breakoutDay > 0);
  const fakeoutRate = brkouts.length > 0 ? pct(brkouts, o => o.fakeout) : 0;
  const a20 = avg(brkouts.map(o => o.fwd20FromBreakout));
  console.log(`  ${label.padEnd(13)}│ [${lo},${hi})%`.padEnd(12) + `│ ${String(bucket.length).padStart(6)} │ ${b5.toFixed(1).padStart(6)}%│ ${b10.toFixed(1).padStart(7)}%│ ${fakeoutRate.toFixed(1).padStart(6)}%│ ${(a20>=0?'+':'')+a20.toFixed(2).padStart(18)}%`);
}

console.log('\n═══ NEAR BREAKOUT BACKTEST COMPLETE ═══');
