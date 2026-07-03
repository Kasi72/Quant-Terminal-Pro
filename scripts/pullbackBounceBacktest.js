// ══════════════════════════════════════════════════════════════════════════════
// PULLBACK BOUNCE BACKTEST
// Hypothesis: Stocks that fall ~10% from swing high bounce ~5%
//             Stocks that fall ~20% from swing high bounce ~10%
//
// Tests:
//   - Swing high definition: 20-day, 50-day rolling high
//   - Pullback zones: 8-12% (≈10%), 18-22% (≈20%) from swing high
//   - Forward windows: 5, 10, 20 trading days
//   - Hit rate: does it touch the bounce target at ANY point in the window?
//   - Avg forward return (exit at EOW or target, whichever first)
//   - Breakdown: by year, by trend context (above/below 50-day SMA)
//   - IS / OOS split: 60% / 40% chronological
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
           Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
function normDate(d){
  if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
  const m=d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m?`${m[3]}-${MON[m[2]]||'01'}-${m[1].padStart(2,'0')}`:d;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function sma(c, idx, period) {
  if (idx < period - 1) return null;
  let s = 0;
  for (let j = idx - period + 1; j <= idx; j++) s += c[j].c;
  return s / period;
}
function swingHigh(c, idx, period) {
  // Highest HIGH in the last `period` candles (not including today)
  let h = -Infinity;
  for (let j = Math.max(0, idx - period); j < idx; j++) h = Math.max(h, c[j].h);
  return h;
}

function stats(arr) {
  if (arr.length === 0) return { n: 0, wr: 0, avgRet: 0, medRet: 0, pf: 0 };
  const n = arr.length;
  const wins = arr.filter(x => x > 0);
  const wr = wins.length / n * 100;
  const avgRet = arr.reduce((s, x) => s + x, 0) / n;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medRet = sorted.length % 2 === 0 ? (sorted[mid-1]+sorted[mid])/2 : sorted[mid];
  const gW = wins.reduce((s, x) => s + x, 0);
  const gL = Math.abs(arr.filter(x => x <= 0).reduce((s, x) => s + x, 0));
  const pf = gL > 0 ? gW / gL : (gW > 0 ? 999 : 0);
  return { n, wr, avgRet, medRet, pf };
}
function bootstrapCI(arr, B=1000) {
  if (arr.length < 5) return { loWR: 0, hiWR: 100, loRet: 0, hiRet: 0 };
  const wrs = [], rets = [];
  for (let b = 0; b < B; b++) {
    let w = 0, s = 0;
    for (let i = 0; i < arr.length; i++) {
      const x = arr[Math.floor(Math.random() * arr.length)];
      if (x > 0) w++;
      s += x;
    }
    wrs.push(w / arr.length * 100);
    rets.push(s / arr.length);
  }
  wrs.sort((a,b)=>a-b); rets.sort((a,b)=>a-b);
  return { loWR: wrs[25], hiWR: wrs[974], loRet: rets[25], hiRet: rets[974] };
}

// ─── LOAD STOCKS ─────────────────────────────────────────────────────────────
const stocks = [];
if (fs.existsSync(DATA_DIR)) {
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith('.csv')) continue;
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf8').trim().split('\n');
      const c = [];
      for (let i = 1; i < raw.length; i++) {
        const p = raw[i].split(',');
        if (p.length < 5 || isNaN(+p[4]) || +p[4] <= 0) continue;
        c.push({ d: normDate(p[0].trim()), o:+p[1], h:+p[2], l:+p[3], c:+p[4], v:+p[5]||0 });
      }
      if (c.length >= 200) stocks.push({ sym: f.replace(/\.csv$/i,''), c });
    } catch {}
  }
}
console.log(`Loaded ${stocks.length} stocks\n`);

// ─── SIMULATION PARAMETERS ───────────────────────────────────────────────────
// Pullback zones (from swing high): [lo%, hi%] drawdown
const ZONES = [
  { name: '5–8%',  lo:  5, hi:  8 },   // mild dip
  { name: '8–12%', lo:  8, hi: 12 },   // ~10% pullback
  { name:'12–17%', lo: 12, hi: 17 },   // intermediate
  { name:'17–23%', lo: 17, hi: 23 },   // ~20% pullback
  { name:'23–30%', lo: 23, hi: 30 },   // deep correction
];

// Bounce targets measured from entry close
const TARGETS = [3, 5, 7, 10, 15]; // %

const SWING_PERIODS = [20, 50]; // days for rolling high
const FORWARD_DAYS  = 20;       // max holding period

// ─── COLLECT SIGNALS ─────────────────────────────────────────────────────────
// For each stock, each bar: compute drawdown from rolling high, flag zone entry
// Signal: first bar where price enters a zone (not previously in it)
// Exit: holds for FORWARD_DAYS days; record max high reached and day-20 close return

console.log('Scanning signals...\n');

// Structure: results[swingPeriod][zoneName] = array of { ret20, hitPct, year, splitTag, trendAbove50 }
// hitPct: largest bounce from entry (max high in window / entry close - 1) * 100
const results = {};
for (const sp of SWING_PERIODS) {
  results[sp] = {};
  for (const z of ZONES) results[sp][z.name] = [];
}

for (const { sym, c } of stocks) {
  const splitIdx = Math.floor(c.length * 0.60);

  for (const sp of SWING_PERIODS) {
    const minLookback = Math.max(sp, 55); // need 50-day SMA too

    // Track whether stock was in each zone on previous bar (avoid double-counting)
    const wasInZone = {};
    for (const z of ZONES) wasInZone[z.name] = false;

    for (let i = minLookback; i < c.length - FORWARD_DAYS - 1; i++) {
      const sh = swingHigh(c, i, sp);
      if (sh <= 0) continue;
      const entry = c[i].c;
      const dd = (sh - entry) / sh * 100; // drawdown from swing high

      const sma50 = sma(c, i, 50);
      const trendAbove50 = sma50 !== null && entry > sma50;
      const year = c[i].d.slice(0, 7);
      const splitTag = i < splitIdx ? 'IS' : 'OOS';

      // Max high and day-N close in forward window
      let maxHigh = entry;
      let ret20 = 0;
      for (let d = 1; d <= FORWARD_DAYS; d++) {
        const ci = i + d;
        if (ci >= c.length) break;
        maxHigh = Math.max(maxHigh, c[ci].h);
        if (d === FORWARD_DAYS) ret20 = (c[ci].c - entry) / entry * 100;
      }
      const maxBounce = (maxHigh - entry) / entry * 100;

      for (const z of ZONES) {
        const inZone = dd >= z.lo && dd < z.hi;
        if (inZone && !wasInZone[z.name]) {
          // New entry into this zone
          results[sp][z.name].push({ ret20, maxBounce, year, splitTag, trendAbove50 });
        }
        wasInZone[z.name] = inZone;
      }
    }
  }
}

// ─── PRINT RESULTS ───────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  PULLBACK BOUNCE BACKTEST — NIFTY 500 Universe');
console.log('  Entry: first close in pullback zone from N-day swing high');
console.log('  Exit: hold 20 days (day-20 close return) + track max intraday bounce');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const sp of SWING_PERIODS) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  SWING HIGH PERIOD: ${sp} days`);
  console.log(`${'─'.repeat(80)}\n`);

  console.log(`  ${'Zone'.padEnd(9)} │ ${'n'.padStart(6)} │ ${'Day-20 WR'.padStart(9)} │ ${'Day-20 Avg'.padStart(10)} │ ${'Max Bounce'.padStart(10)} │ ${'Hit ≥5%'.padStart(8)} │ ${'Hit ≥10%'.padStart(9)} │ ${'PF'.padStart(5)} │ Note`);
  console.log('  '+'-'.repeat(98));

  for (const z of ZONES) {
    const data = results[sp][z.name];
    const s20 = stats(data.map(d => d.ret20));
    const maxB = stats(data.map(d => d.maxBounce));
    const hit5  = data.filter(d => d.maxBounce >= 5).length;
    const hit10 = data.filter(d => d.maxBounce >= 10).length;
    const h5pct = data.length > 0 ? hit5 / data.length * 100 : 0;
    const h10pct= data.length > 0 ? hit10 / data.length * 100 : 0;
    const note = maxB.avgRet >= z.hi/2 ? '✅' : maxB.avgRet >= z.lo/3 ? '🟡' : '🔴';
    console.log(`  ${z.name.padEnd(9)} │ ${String(s20.n).padStart(6)} │ ${(s20.wr.toFixed(1)+'%').padStart(9)} │ ${((s20.avgRet>=0?'+':'')+s20.avgRet.toFixed(2)+'%').padStart(10)} │ ${('+'+maxB.avgRet.toFixed(2)+'%').padStart(10)} │ ${(h5pct.toFixed(0)+'%').padStart(8)} │ ${(h10pct.toFixed(0)+'%').padStart(9)} │ ${s20.pf.toFixed(2).padStart(5)} │ ${note}`);
  }

  // IS vs OOS breakdown for the two key zones
  console.log(`\n  IS vs OOS split (key zones with ${sp}-day swing high):`);
  console.log(`  ${'Zone'.padEnd(9)} │ ${'Period'.padEnd(4)} │ ${'n'.padStart(5)} │ ${'Day-20 WR'.padStart(9)} │ ${'Day-20 Avg'.padStart(10)} │ ${'Hit ≥5%'.padStart(8)} │ ${'Hit ≥10%'.padStart(9)} │ ${'CI lo WR'.padStart(9)}`);
  console.log('  '+'-'.repeat(88));

  for (const z of ZONES.filter(z => ['8–12%','17–23%'].includes(z.name))) {
    for (const tag of ['IS', 'OOS']) {
      const data = results[sp][z.name].filter(d => d.splitTag === tag);
      const s20 = stats(data.map(d => d.ret20));
      const maxB = stats(data.map(d => d.maxBounce));
      const hit5  = data.length > 0 ? data.filter(d => d.maxBounce >= 5).length / data.length * 100 : 0;
      const hit10 = data.length > 0 ? data.filter(d => d.maxBounce >= 10).length / data.length * 100 : 0;
      const ci = bootstrapCI(data.map(d => d.ret20));
      console.log(`  ${z.name.padEnd(9)} │ ${tag.padEnd(4)} │ ${String(s20.n).padStart(5)} │ ${(s20.wr.toFixed(1)+'%').padStart(9)} │ ${((s20.avgRet>=0?'+':'')+s20.avgRet.toFixed(2)+'%').padStart(10)} │ ${(hit5.toFixed(0)+'%').padStart(8)} │ ${(hit10.toFixed(0)+'%').padStart(9)} │ ${(ci.loRet>=0?'+':'')+ci.loRet.toFixed(2)+'%'}`);
    }
  }

  // Trend context: above vs below 50-day SMA
  console.log(`\n  TREND CONTEXT (${sp}-day swing, 8–12% and 17–23% zones):`);
  console.log(`  ${'Zone'.padEnd(9)} │ ${'Trend'.padEnd(12)} │ ${'n'.padStart(5)} │ ${'Day-20 WR'.padStart(9)} │ ${'Day-20 Avg'.padStart(10)} │ ${'Hit ≥5%'.padStart(8)} │ ${'Hit ≥10%'.padStart(9)}`);
  console.log('  '+'-'.repeat(76));
  for (const z of ZONES.filter(z => ['8–12%','17–23%'].includes(z.name))) {
    for (const above of [true, false]) {
      const data = results[sp][z.name].filter(d => d.trendAbove50 === above);
      const s20 = stats(data.map(d => d.ret20));
      const maxB = stats(data.map(d => d.maxBounce));
      const hit5  = data.length > 0 ? data.filter(d => d.maxBounce >= 5).length / data.length * 100 : 0;
      const hit10 = data.length > 0 ? data.filter(d => d.maxBounce >= 10).length / data.length * 100 : 0;
      const trendLabel = above ? 'Above SMA50' : 'Below SMA50';
      console.log(`  ${z.name.padEnd(9)} │ ${trendLabel.padEnd(12)} │ ${String(s20.n).padStart(5)} │ ${(s20.wr.toFixed(1)+'%').padStart(9)} │ ${((s20.avgRet>=0?'+':'')+s20.avgRet.toFixed(2)+'%').padStart(10)} │ ${(hit5.toFixed(0)+'%').padStart(8)} │ ${(hit10.toFixed(0)+'%').padStart(9)}`);
    }
  }
}

// ─── TARGET HIT RATE TABLE ────────────────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════════════════════════');
console.log('  TARGET HIT RATES — does the bounce TARGET get touched within 20 days?');
console.log('  (For each pullback zone, % of entries that hit each bounce target)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const sp of SWING_PERIODS) {
  console.log(`  ${sp}-day swing high:`);
  const header = `  ${'Zone'.padEnd(9)} │ ${'n'.padStart(6)}` + TARGETS.map(t => ` │ ${'≥'+t+'%'.padStart(4)} hit`).join('') + ' │ Avg max bounce';
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));
  for (const z of ZONES) {
    const data = results[sp][z.name];
    const hits = TARGETS.map(t => data.length > 0 ? (data.filter(d => d.maxBounce >= t).length / data.length * 100).toFixed(0)+'%' : 'n/a');
    const avgMaxB = data.length > 0 ? (data.reduce((s,d)=>s+d.maxBounce,0)/data.length).toFixed(2)+'%' : 'n/a';
    console.log(`  ${z.name.padEnd(9)} │ ${String(data.length).padStart(6)}` + hits.map(h=>' │ '+h.padStart(6)).join('') + ` │ +${avgMaxB}`);
  }
  console.log();
}

// ─── YEAR-BY-YEAR (OOS period only, key zones) ───────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  YEAR-BY-YEAR (OOS only, 20-day swing, key zones)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const oosByYear = {};
for (const z of ZONES.filter(z=>['8–12%','17–23%'].includes(z.name))) {
  for (const d of results[20][z.name].filter(x=>x.splitTag==='OOS')) {
    const yrKey = d.year.slice(0,4);
    if (!oosByYear[yrKey]) oosByYear[yrKey] = { '8–12%':[], '17–23%':[] };
    oosByYear[yrKey][z.name].push(d);
  }
}
console.log(`  Year │ ${'8–12% zone'.padEnd(38)} │ ${'17–23% zone'.padEnd(38)}`);
console.log(`       │ ${'n'.padStart(4)}  ${'WR'.padStart(6)}  ${'Avg'.padStart(8)}  ${'Hit≥5%'.padStart(7)}  ${'Hit≥10%'.padStart(8)} │ ${'n'.padStart(4)}  ${'WR'.padStart(6)}  ${'Avg'.padStart(8)}  ${'Hit≥5%'.padStart(7)}  ${'Hit≥10%'.padStart(8)}`);
console.log('  ' + '-'.repeat(92));

for (const yr of Object.keys(oosByYear).sort()) {
  const row = [];
  for (const zn of ['8–12%','17–23%']) {
    const data = oosByYear[yr][zn] || [];
    if (data.length === 0) { row.push('   —    —       —       —        —   '); continue; }
    const s = stats(data.map(d=>d.ret20));
    const h5 = (data.filter(d=>d.maxBounce>=5).length/data.length*100).toFixed(0)+'%';
    const h10= (data.filter(d=>d.maxBounce>=10).length/data.length*100).toFixed(0)+'%';
    row.push(`${String(s.n).padStart(4)}  ${(s.wr.toFixed(0)+'%').padStart(6)}  ${((s.avgRet>=0?'+':'')+s.avgRet.toFixed(2)+'%').padStart(8)}  ${h5.padStart(7)}  ${h10.padStart(8)}`);
  }
  console.log(`  ${yr} │ ${row[0]} │ ${row[1]}`);
}

// ─── FINAL VERDICT ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  VERDICT — Is the pullback bounce hypothesis supported?');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// Test hypothesis specifically: 10% pullback → 5% bounce, 20% pullback → 10% bounce
for (const sp of SWING_PERIODS) {
  console.log(`  ${sp}-day swing high:`);
  const z10 = results[sp]['8–12%'];
  const z20 = results[sp]['17–23%'];
  if (z10.length > 0) {
    const hit5  = z10.filter(d=>d.maxBounce>=5).length / z10.length * 100;
    const hit3  = z10.filter(d=>d.maxBounce>=3).length / z10.length * 100;
    const ci = bootstrapCI(z10.map(d=>d.ret20));
    console.log(`  ~10% pullback zone (8–12%): n=${z10.length}  Hit≥5% bounce: ${hit5.toFixed(0)}%  Hit≥3%: ${hit3.toFixed(0)}%  avg max bounce: +${(z10.reduce((s,d)=>s+d.maxBounce,0)/z10.length).toFixed(2)}%`);
    console.log(`    Day-20 return CI: [${ci.loRet>=0?'+':''}${ci.loRet.toFixed(2)}%, +${ci.hiRet.toFixed(2)}%]  ${hit5>=60?'✅ Hypothesis SUPPORTED':'hit rate <60% — 🟡 PARTIAL or 🔴 NOT supported'}`);
  }
  if (z20.length > 0) {
    const hit10 = z20.filter(d=>d.maxBounce>=10).length / z20.length * 100;
    const hit5  = z20.filter(d=>d.maxBounce>=5).length / z20.length * 100;
    const ci = bootstrapCI(z20.map(d=>d.ret20));
    console.log(`  ~20% pullback zone (17–23%): n=${z20.length}  Hit≥10% bounce: ${hit10.toFixed(0)}%  Hit≥5%: ${hit5.toFixed(0)}%  avg max bounce: +${(z20.reduce((s,d)=>s+d.maxBounce,0)/z20.length).toFixed(2)}%`);
    console.log(`    Day-20 return CI: [${ci.loRet>=0?'+':''}${ci.loRet.toFixed(2)}%, +${ci.hiRet.toFixed(2)}%]  ${hit10>=60?'✅ Hypothesis SUPPORTED':'hit rate <60% — 🟡 PARTIAL or 🔴 NOT supported'}`);
  }
  console.log();
}
