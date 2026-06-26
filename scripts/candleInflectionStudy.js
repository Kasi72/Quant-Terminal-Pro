// CANDLE INFLECTION POINT STUDY — What candle type heralds ULTRA STRONG BUY?
// Analyzes the signal candle AND the 3 candles preceding every winning breakout
// on 29 OHLCV files to find the earliest inflection point patterns

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Candle pattern classifier
function classifyCandle(c, prev, atr) {
  const range = c.h - c.l;
  if (range <= 0) return { type: 'FLAT', props: {} };
  const body = Math.abs(c.c - c.o);
  const bodyPct = body / range * 100;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;
  const uwPct = upperWick / range * 100;
  const lwPct = lowerWick / range * 100;
  const closeLoc = (c.c - c.l) / range * 100;
  const isGreen = c.c > c.o;
  const rangeATR = atr > 0 ? range / atr : 1;
  const gapUp = prev ? (c.o - prev.c) / prev.c * 100 : 0;
  const gapDown = prev ? (prev.c - c.o) / prev.c * 100 : 0;
  const changePct = prev ? (c.c - prev.c) / prev.c * 100 : 0;

  let type = 'OTHER';
  // Marubozu — large body, tiny wicks
  if (bodyPct >= 70 && isGreen && closeLoc >= 80) type = 'BULL_MARUBOZU';
  else if (bodyPct >= 70 && !isGreen && closeLoc <= 20) type = 'BEAR_MARUBOZU';
  // Engulfing
  else if (isGreen && prev && c.c > prev.o && c.o < prev.c && !prev.c > prev.o && bodyPct >= 50) type = 'BULL_ENGULF';
  else if (!isGreen && prev && c.c < prev.o && c.o > prev.c && prev.c > prev.o && bodyPct >= 50) type = 'BEAR_ENGULF';
  // Hammer — small body, long lower wick
  else if (lwPct >= 50 && bodyPct <= 35 && uwPct <= 15 && closeLoc >= 60) type = 'HAMMER';
  // Inverted Hammer
  else if (uwPct >= 50 && bodyPct <= 35 && lwPct <= 15 && closeLoc <= 40) type = 'INV_HAMMER';
  // Doji — very small body
  else if (bodyPct <= 10) type = lwPct > 40 ? 'DRAGONFLY_DOJI' : uwPct > 40 ? 'GRAVESTONE_DOJI' : 'DOJI';
  // Spinning top
  else if (bodyPct <= 30 && uwPct >= 25 && lwPct >= 25) type = 'SPINNING_TOP';
  // Strong body with close at high
  else if (isGreen && bodyPct >= 50 && closeLoc >= 75 && uwPct <= 15) type = 'STRONG_CLOSE';
  // Three Line Strike
  else if (isGreen && bodyPct >= 45 && closeLoc >= 65) type = 'BULL_THRUST';
  // R-EN (range expansion)
  else if (rangeATR >= 1.5 && isGreen && closeLoc >= 60) type = 'RANGE_EXPANSION';
  // Wide range bar
  else if (rangeATR >= 2.0) type = isGreen ? 'WIDE_GREEN' : 'WIDE_RED';
  // Narrow range (NR4/NR7 proxy)
  else if (rangeATR <= 0.5) type = 'NARROW_RANGE';
  // Inside bar
  if (prev && c.h <= prev.h && c.l >= prev.l) type = 'INSIDE_BAR';

  return {
    type, isGreen, bodyPct, uwPct, lwPct, closeLoc, rangeATR,
    gapUp, changePct, range, body,
    volExpansion: 0, // computed externally
  };
}

// Collect all breakout signals with candle context
const ALL = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv', ''), a = atr14(c);
  for (let i = 40; i < c.length - 11; i++) {
    const s = c[i]; if (s.c <= 0 || a[i] <= 0) continue; const r = s.h - s.l; if (r <= 0) continue;
    let bZ = null; for (let zL = 25; zL >= 4; zL--) { const zS = i - zL; if (zS < 1) continue; let zH = -Infinity, zLo = Infinity, ok = true; for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false; } if (!ok) continue; bZ = { zH, zL: zLo, len: zL }; break; }
    if (!bZ || s.c <= bZ.zH * 1.001) continue;

    const entry = s.c;
    let v20 = 0; for (let j = Math.max(0, i - 20); j < i; j++) v20 += c[j].v; v20 /= Math.max(i - Math.max(0, i - 20), 1);
    const volExp = v20 > 0 ? s.v / v20 : 1;

    // Classify signal candle and 5 preceding candles
    const signalCandle = classifyCandle(s, c[i - 1], a[i]);
    signalCandle.volExpansion = volExp;
    const priorCandles = [];
    for (let j = 1; j <= 5; j++) {
      if (i - j < 1) break;
      const pc = classifyCandle(c[i - j], c[i - j - 1] || c[i - j], a[i - j]);
      const pv20t = []; for (let k = Math.max(0, i - j - 20); k < i - j; k++) pv20t.push(c[k].v);
      const pv20 = pv20t.length > 0 ? pv20t.reduce((a, b) => a + b, 0) / pv20t.length : 1;
      pc.volExpansion = pv20 > 0 ? c[i - j].v / pv20 : 1;
      priorCandles.push({ daysBefore: j, ...pc, date: c[i - j].date });
    }

    // Future performance
    let mfe = 0, mae = 0, h5 = false, d5 = 99;
    for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) {
      const pH = (c[d].h - entry) / entry * 100;
      const pL = (c[d].l - entry) / entry * 100;
      if (pH > mfe) mfe = pH; if (pL < mae) mae = pL;
      if (!h5 && pH >= 5) { h5 = true; d5 = d - i; }
    }

    ALL.push({ sym, date: s.date, entry, signalCandle, priorCandles, mfe, mae, h5, d5, volExp,
      atrPct: (a[i] / s.c * 100) });
  }
}

const winners = ALL.filter(s => s.h5);
const losers = ALL.filter(s => !s.h5);
console.log(`Total breakouts: ${ALL.length} | Winners: ${winners.length} | Losers: ${losers.length}\n`);

// ═══ PART 1: Signal Candle Type Distribution ═══
console.log('█'.repeat(85));
console.log('  PART 1: SIGNAL CANDLE TYPE — Which candle type FIRES the breakout?');
console.log('█'.repeat(85));

const typeDist = {};
for (const s of ALL) {
  const t = s.signalCandle.type;
  if (!typeDist[t]) typeDist[t] = { total: 0, wins: 0, mfeSum: 0, maeSum: 0, d5Sum: 0 };
  typeDist[t].total++;
  if (s.h5) { typeDist[t].wins++; typeDist[t].d5Sum += s.d5; }
  typeDist[t].mfeSum += s.mfe;
  typeDist[t].maeSum += s.mae;
}

console.log('\n  Candle Type        │ Total │ Wins │ HitRate │ Avg MFE │ Avg MAE │ Avg D5  │ Signal');
console.log('  ───────────────────┼───────┼──────┼─────────┼─────────┼─────────┼─────────┼────────');
const sortedTypes = Object.entries(typeDist).sort((a, b) => b[1].total - a[1].total);
for (const [type, d] of sortedTypes) {
  const rate = (d.wins / d.total * 100).toFixed(1);
  const mfe = (d.mfeSum / d.total).toFixed(1);
  const mae = (d.maeSum / d.total).toFixed(1);
  const d5 = d.wins > 0 ? (d.d5Sum / d.wins).toFixed(1) : '—';
  const signal = d.wins / d.total >= 0.6 ? 'STRONG' : d.wins / d.total >= 0.45 ? 'GOOD' : 'WEAK';
  console.log(`  ${type.padEnd(19)} │ ${String(d.total).padStart(5)} │ ${String(d.wins).padStart(4)} │ ${rate.padStart(6)}% │ ${('+' + mfe + '%').padStart(7)} │ ${(mae + '%').padStart(7)} │ ${d5.padStart(5)}d  │ ${signal}`);
}

// ═══ PART 2: Signal Candle Properties (continuous) — Winners vs Losers ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 2: SIGNAL CANDLE PROPERTIES — Winners vs Losers');
console.log('█'.repeat(85));

function stats(arr) { const n = arr.length; const m = arr.reduce((s, v) => s + v, 0) / n; return { mean: m, median: arr.sort((a, b) => a - b)[Math.floor(n / 2)], n }; }

const props = ['bodyPct', 'uwPct', 'lwPct', 'closeLoc', 'rangeATR', 'volExpansion', 'gapUp'];
console.log('\n  Property          │ Winners Mean │ Losers Mean │ Delta  │ Edge');
console.log('  ──────────────────┼──────────────┼─────────────┼────────┼─────');
for (const p of props) {
  const wVals = winners.map(s => s.signalCandle[p]).filter(v => Number.isFinite(v));
  const lVals = losers.map(s => s.signalCandle[p]).filter(v => Number.isFinite(v));
  const wM = wVals.reduce((s, v) => s + v, 0) / wVals.length;
  const lM = lVals.reduce((s, v) => s + v, 0) / lVals.length;
  const delta = wM - lM;
  const edge = Math.abs(delta) > 3 ? (delta > 0 ? 'HIGHER wins' : 'LOWER wins') : 'Similar';
  console.log(`  ${p.padEnd(19)} │ ${wM.toFixed(1).padStart(12)} │ ${lM.toFixed(1).padStart(11)} │ ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(5)} │ ${edge}`);
}

// ═══ PART 3: Pre-Breakout Candle Sequence — The Inflection Point ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 3: PRE-BREAKOUT SEQUENCE — What happens 1-5 days BEFORE breakout?');
console.log('█'.repeat(85));

for (let daysBefore = 1; daysBefore <= 5; daysBefore++) {
  console.log(`\n  ═══ ${daysBefore} DAY(S) BEFORE BREAKOUT ═══`);
  const preDist = {};
  for (const s of winners) {
    const pc = s.priorCandles.find(p => p.daysBefore === daysBefore);
    if (!pc) continue;
    const t = pc.type;
    if (!preDist[t]) preDist[t] = { count: 0, totalMfe: 0 };
    preDist[t].count++;
    preDist[t].totalMfe += s.mfe;
  }
  const sorted = Object.entries(preDist).sort((a, b) => b[1].count - a[1].count);
  console.log('  Type              │ Count │  %   │ Avg MFE');
  console.log('  ──────────────────┼───────┼──────┼────────');
  for (const [type, d] of sorted.slice(0, 8)) {
    console.log(`  ${type.padEnd(19)} │ ${String(d.count).padStart(5)} │ ${(d.count / winners.length * 100).toFixed(1).padStart(4)}% │ +${(d.totalMfe / d.count).toFixed(1)}%`);
  }
}

// ═══ PART 4: The INFLECTION SEQUENCE — What 2-3 candle pattern predicts breakout? ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 4: 2-CANDLE SEQUENCES BEFORE BREAKOUT (pattern→signal)');
console.log('█'.repeat(85));

const seqDist = {};
for (const s of ALL) {
  const p1 = s.priorCandles.find(p => p.daysBefore === 1);
  if (!p1) continue;
  const key = `${p1.type} → ${s.signalCandle.type}`;
  if (!seqDist[key]) seqDist[key] = { total: 0, wins: 0, mfeSum: 0 };
  seqDist[key].total++;
  if (s.h5) { seqDist[key].wins++; seqDist[key].mfeSum += s.mfe; }
}

console.log('\n  Sequence (day-1 → signal)          │ Total │ Wins │ HitRate │ Avg MFE');
console.log('  ───────────────────────────────────┼───────┼──────┼─────────┼────────');
const seqSorted = Object.entries(seqDist).filter(([, d]) => d.total >= 3).sort((a, b) => b[1].wins / b[1].total - a[1].wins / a[1].total);
for (const [seq, d] of seqSorted.slice(0, 20)) {
  const rate = (d.wins / d.total * 100).toFixed(1);
  const mfe = d.total > 0 ? (d.mfeSum / d.total).toFixed(1) : '0';
  console.log(`  ${seq.padEnd(35)} │ ${String(d.total).padStart(5)} │ ${String(d.wins).padStart(4)} │ ${rate.padStart(6)}% │ +${mfe}%`);
}

// ═══ PART 5: 3-Candle sequences ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 5: 3-CANDLE SEQUENCES (day-2 → day-1 → signal)');
console.log('█'.repeat(85));

const seq3Dist = {};
for (const s of ALL) {
  const p1 = s.priorCandles.find(p => p.daysBefore === 1);
  const p2 = s.priorCandles.find(p => p.daysBefore === 2);
  if (!p1 || !p2) continue;
  const key = `${p2.type} → ${p1.type} → ${s.signalCandle.type}`;
  if (!seq3Dist[key]) seq3Dist[key] = { total: 0, wins: 0, mfeSum: 0 };
  seq3Dist[key].total++;
  if (s.h5) { seq3Dist[key].wins++; seq3Dist[key].mfeSum += s.mfe; }
}

console.log('\n  3-Candle Sequence                              │ Total │ Wins │ HitRate │ Avg MFE');
console.log('  ───────────────────────────────────────────────┼───────┼──────┼─────────┼────────');
const seq3Sorted = Object.entries(seq3Dist).filter(([, d]) => d.total >= 3 && d.wins / d.total >= 0.5).sort((a, b) => b[1].wins / b[1].total - a[1].wins / a[1].total);
for (const [seq, d] of seq3Sorted.slice(0, 15)) {
  console.log(`  ${seq.padEnd(47)} │ ${String(d.total).padStart(5)} │ ${String(d.wins).padStart(4)} │ ${(d.wins / d.total * 100).toFixed(1).padStart(6)}% │ +${(d.mfeSum / d.total).toFixed(1)}%`);
}

// ═══ PART 6: Volume pattern before breakout ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 6: VOLUME PATTERN — Volume expansion timeline before breakout');
console.log('█'.repeat(85));

console.log('\n  Days Before │ Winner Vol Exp │ Loser Vol Exp │ Delta');
console.log('  ────────────┼────────────────┼───────────────┼──────');
for (let d = 0; d <= 5; d++) {
  let wSum = 0, wN = 0, lSum = 0, lN = 0;
  if (d === 0) {
    for (const s of winners) { wSum += s.signalCandle.volExpansion; wN++; }
    for (const s of losers) { lSum += s.signalCandle.volExpansion; lN++; }
  } else {
    for (const s of winners) { const p = s.priorCandles.find(x => x.daysBefore === d); if (p) { wSum += p.volExpansion; wN++; } }
    for (const s of losers) { const p = s.priorCandles.find(x => x.daysBefore === d); if (p) { lSum += p.volExpansion; lN++; } }
  }
  const wAvg = wN > 0 ? wSum / wN : 0, lAvg = lN > 0 ? lSum / lN : 0;
  const label = d === 0 ? 'Signal day' : `Day -${d}`;
  console.log(`  ${label.padEnd(12)} │ ${wAvg.toFixed(2).padStart(14)}x │ ${lAvg.toFixed(2).padStart(13)}x │ ${((wAvg - lAvg) >= 0 ? '+' : '') + (wAvg - lAvg).toFixed(2)}`);
}

// ═══ PART 7: THE EARLIEST INFLECTION CANDLE ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 7: THE EARLIEST INFLECTION — What candle FIRST signals the breakout is coming?');
console.log('█'.repeat(85));

// For each winner, find the earliest day (1-5 before) where a notable candle appeared
const inflectionDays = [];
for (const s of winners) {
  let earliest = 0; // 0 = signal day itself
  for (let d = 5; d >= 1; d--) {
    const pc = s.priorCandles.find(p => p.daysBefore === d);
    if (!pc) continue;
    // Notable = not a doji/narrow/flat — something with momentum character
    if (['HAMMER', 'DRAGONFLY_DOJI', 'BULL_ENGULF', 'STRONG_CLOSE', 'BULL_THRUST', 'INSIDE_BAR', 'NARROW_RANGE'].includes(pc.type)) {
      earliest = d;
      break;
    }
  }
  inflectionDays.push({ ...s, earliestInflection: earliest });
}

const inflDist = {};
for (const s of inflectionDays) {
  const d = s.earliestInflection;
  if (!inflDist[d]) inflDist[d] = { count: 0, types: {} };
  inflDist[d].count++;
  if (d > 0) {
    const pc = s.priorCandles.find(p => p.daysBefore === d);
    if (pc) { inflDist[d].types[pc.type] = (inflDist[d].types[pc.type] || 0) + 1; }
  } else {
    inflDist[d].types[s.signalCandle.type] = (inflDist[d].types[s.signalCandle.type] || 0) + 1;
  }
}

console.log('\n  Earliest Inflection │ Count │  %   │ Most common candle type');
console.log('  ────────────────────┼───────┼──────┼────────────────────────');
for (let d = 5; d >= 0; d--) {
  const data = inflDist[d] || { count: 0, types: {} };
  const topType = Object.entries(data.types).sort((a, b) => b[1] - a[1])[0];
  const label = d === 0 ? 'Signal day (none earlier)' : `${d} days before`;
  console.log(`  ${label.padEnd(21)} │ ${String(data.count).padStart(5)} │ ${(data.count / winners.length * 100).toFixed(1).padStart(4)}% │ ${topType ? `${topType[0]} (${topType[1]})` : '—'}`);
}

// ═══ PART 8: GOLDEN SEQUENCE — The highest-conviction pre-breakout pattern ═══
console.log('\n' + '█'.repeat(85));
console.log('  PART 8: GOLDEN SEQUENCES — Highest win-rate 2-candle patterns');
console.log('█'.repeat(85));

console.log('\n  Top patterns with >=60% hit rate and >=5 occurrences:');
console.log('\n  Pattern                                │ Total │ Wins │ HitRate │ Avg MFE │ Verdict');
console.log('  ───────────────────────────────────────┼───────┼──────┼─────────┼─────────┼────────');
const golden = Object.entries(seqDist)
  .filter(([, d]) => d.total >= 5 && d.wins / d.total >= 0.5)
  .sort((a, b) => b[1].wins / b[1].total - a[1].wins / a[1].total);
for (const [seq, d] of golden.slice(0, 15)) {
  const rate = d.wins / d.total * 100;
  const verdict = rate >= 65 ? 'GOLDEN' : rate >= 55 ? 'STRONG' : 'GOOD';
  console.log(`  ${seq.padEnd(39)} │ ${String(d.total).padStart(5)} │ ${String(d.wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │ +${(d.mfeSum / d.total).toFixed(1).padStart(5)}% │ ${verdict}`);
}
