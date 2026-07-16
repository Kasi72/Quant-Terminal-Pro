'use strict';
// Signal frequency audit — runs the compiled live engine on all stocks,
// counts how many BUY/STRONG_BUY/ULTRA_STRONG_BUY signals fire per day
// for each of the 6 param sets, then reports weekly averages.
//
// Usage: node scripts/signalFrequencyAudit.js [--days N]
//   --days N: look back N trading days (default 252 = ~1 year)

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');

const daysArg = process.argv.indexOf('--days');
const LOOKBACK_DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 252;
const HISTORY_WINDOW = 320;
const MIN_HISTORY    = 220;

const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseDate(raw) {
  const s = String(raw||'').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd,mon,yyyy] = s.split('-');
    const mm = String((MONTHS[mon]??0)+1).padStart(2,'0');
    return `${yyyy}-${mm}-${dd.padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return '';
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp,'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const h = lines[0].split(',').map(x=>x.trim().toLowerCase());
  const [iDate,iOpen,iHigh,iLow,iClose,iVol] = ['date','open','high','low','close','volume'].map(n=>h.indexOf(n));
  if ([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i=>i<0)) return [];
  const out = [];
  for (let i=1;i<lines.length;i++) {
    const p = lines[i].split(',');
    const date = parseDate(p[iDate]);
    const o=+p[iOpen], hgh=+p[iHigh], lo=+p[iLow], c=+p[iClose], v=+p[iVol];
    if (!date||!Number.isFinite(o)||!Number.isFinite(c)||c<=0||hgh<lo) continue;
    out.push({ date, o, h:hgh, l:lo, c, v:Number.isFinite(v)?v:0,
               ts: Math.floor(Date.parse(`${date}T00:00:00Z`)/1000) });
  }
  out.sort((a,b)=>a.ts-b.ts);
  return out;
}

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const LABELS = {
  optimized_deployable_20plus:   'Deployable',
  optimized_highprecision_15plus:'HighPrecision',
  optimized_elite_10plus:        'Elite',
  optimized_ultraselective_8plus:'UltraSelective',
  sniper_95plus:                 'Sniper',
  ors_prime_reversal:            'ORS-Prime',
};
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// Load engine
const { analyzeStock, PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

// Load all symbols
console.log('Loading data...');
const files = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv'));
const allCandles = {};
for (const f of files) {
  const candles = parseCSV(path.join(DATA_DIR, f));
  if (candles.length >= MIN_HISTORY) allCandles[f.replace(/\.csv$/i,'')] = candles;
}
const symbols = Object.keys(allCandles);
console.log(`Loaded ${symbols.length} symbols\n`);

// Determine date range: use the most recent LOOKBACK_DAYS trading dates
// Find all unique dates from a sample of stocks
const allDates = new Set();
for (const sym of symbols.slice(0, 200)) {
  for (const c of allCandles[sym]) allDates.add(c.date);
}
const sortedDates = [...allDates].sort();
const cutoffDate = sortedDates[Math.max(0, sortedDates.length - LOOKBACK_DAYS)];
console.log(`Scanning ${LOOKBACK_DAYS} trading days from ${cutoffDate} to ${sortedDates[sortedDates.length-1]}`);
console.log(`Symbols: ${symbols.length}\n`);

// Per-day signal counts per param set
const dayCounts = {}; // date -> { paramKey -> count }

let processed = 0;
const total = symbols.length;

for (const sym of symbols) {
  processed++;
  if (processed % 200 === 0) process.stdout.write(`\r  Progress: ${processed}/${total} symbols...`);

  const candles = allCandles[sym];
  // Find bar indices after cutoff
  for (let i = MIN_HISTORY; i < candles.length; i++) {
    const date = candles[i].date;
    if (date < cutoffDate) continue;

    const window = candles.slice(Math.max(0, i - HISTORY_WINDOW + 1), i + 1);

    for (const key of PARAM_KEYS) {
      try {
        const r = analyzeStock(window, key);
        if (!BUY_STAGES.has(r.stage)) continue;
        if (!dayCounts[date]) dayCounts[date] = {};
        dayCounts[date][key] = (dayCounts[date][key] || 0) + 1;
      } catch {}
    }
  }
}
console.log('\n');

// Aggregate
const dates = Object.keys(dayCounts).sort();
const totalDays = dates.length;
const weeks = totalDays / 5;

const totals = {};
const weeklyBuckets = {}; // paramKey -> Map<weekKey, count>
for (const key of PARAM_KEYS) {
  totals[key] = 0;
  weeklyBuckets[key] = {};
}

for (const date of dates) {
  // ISO week key (Monday-based)
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  const weekKey = monday.toISOString().slice(0,10);

  for (const key of PARAM_KEYS) {
    const cnt = dayCounts[date]?.[key] || 0;
    totals[key] += cnt;
    weeklyBuckets[key][weekKey] = (weeklyBuckets[key][weekKey]||0) + cnt;
  }
}

// Per-set stats
const stats = {};
for (const key of PARAM_KEYS) {
  const counts = Object.values(weeklyBuckets[key]);
  const nonZeroWeeks = counts.filter(c=>c>0).length;
  const allWeeks = Object.keys(weeklyBuckets[key]).length || 1;
  const avg = totals[key] / Math.max(1, weeks);
  const max = counts.length ? Math.max(...counts) : 0;
  const min = counts.length ? Math.min(...counts) : 0;
  stats[key] = {
    totalSignals: totals[key],
    avgPerDay: totals[key] / Math.max(1, totalDays),
    avgPerWeek: avg,
    maxPerWeek: max,
    minPerWeek: min,
    weeksWithSignals: nonZeroWeeks,
    totalWeeks: allWeeks,
    pctWeeksActive: nonZeroWeeks / allWeeks * 100,
  };
}

// Print report
console.log('='.repeat(90));
console.log(`SIGNAL FREQUENCY REPORT — ${LOOKBACK_DAYS}d lookback (~${weeks.toFixed(0)} weeks), ${symbols.length} symbols`);
console.log('='.repeat(90));
console.log(`${'Param Set'.padEnd(22)} ${'Total'.padStart(6)} ${'Avg/Day'.padStart(8)} ${'Avg/Wk'.padStart(8)} ${'Min/Wk'.padStart(8)} ${'Max/Wk'.padStart(8)} ${'Wks Active'.padStart(12)} Notes`);
console.log('-'.repeat(90));

for (const key of PARAM_KEYS) {
  const s = stats[key];
  const freq = s.avgPerWeek < 0.5 ? '⚠ RARE' : s.avgPerWeek < 2 ? '⚡ LOW' : s.avgPerWeek < 5 ? '✓ OK' : '★ HIGH';
  console.log(
    `${LABELS[key].padEnd(22)} ${String(s.totalSignals).padStart(6)} ${s.avgPerDay.toFixed(2).padStart(8)} ${s.avgPerWeek.toFixed(1).padStart(8)} ${String(s.minPerWeek).padStart(8)} ${String(s.maxPerWeek).padStart(8)} ${(s.weeksWithSignals+'/'+s.totalWeeks).padStart(12)} ${freq}`
  );
}

console.log('='.repeat(90));
console.log('\nWeekly signal count breakdown (last 8 weeks):');
const last8Weeks = [...new Set(Object.values(weeklyBuckets).flatMap(b=>Object.keys(b)))].sort().slice(-8);
console.log(`${'Week'.padEnd(12)}` + PARAM_KEYS.map(k=>LABELS[k].padStart(14)).join(''));
console.log('-'.repeat(12 + PARAM_KEYS.length*14));
for (const wk of last8Weeks) {
  const row = PARAM_KEYS.map(k=>String(weeklyBuckets[k][wk]||0).padStart(14)).join('');
  console.log(`${wk.padEnd(12)}${row}`);
}
console.log('');
