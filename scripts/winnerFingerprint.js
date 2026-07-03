'use strict';
// Winner Fingerprinting — data-driven param tuning for HiPrec & Ultra
// For every IS BUY signal: capture outcome (W/L) via actual target5/tacticalStop,
// then compute winner-mean vs loser-mean per param to find discriminators.
//
// Run: node scripts/winnerFingerprint.js

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled');
const DATE_FROM  = '2019-01-01';

const { analyzeStock, PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

const TARGET_KEYS = [
  'optimized_highprecision_15plus',
  'optimized_ultraselective_8plus',
];

const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDate(s) {
  s = s.trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [d, mon, y] = s.split('-');
    const iso = `${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
    return { iso, ts: Math.floor(new Date(iso).getTime()/1000) };
  }
  const ts = Math.floor(new Date(s).getTime()/1000);
  return { iso: s.slice(0,10), ts: isNaN(ts) ? 0 : ts };
}

function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const hdr   = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iDate = hdr.indexOf('date'), iOpen = hdr.indexOf('open');
  const iHigh = hdr.indexOf('high'), iLow  = hdr.indexOf('low');
  const iClose = hdr.findIndex(h => h === 'close' || h === 'adj close');
  const iVol   = hdr.findIndex(h => h === 'volume');
  if (iClose < 0 || iVol < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]?.trim() ?? '');
    if (iso < DATE_FROM || ts === 0) continue;
    const c = +p[iClose], o = +p[iOpen]||c, h = +p[iHigh]||c, l = +p[iLow]||c, v = +p[iVol]||0;
    if (isNaN(c) || c <= 0) continue;
    out.push({ ts, date: iso, o, h, l, c, v });
  }
  return out;
}

// Extract all param values from an AnalysisResult for fingerprinting
function extractFeatures(r) {
  return {
    closeLoc:                r.closeLoc,
    upperWickPct:            r.upperWickPct,
    bodyPct:                 r.bodyPct,
    exactRangeATR14:         r.exactRangeATR14,
    exactVolRatio20:         r.exactVolRatio20,
    exactVolVsPre5:          r.exactVolVsPre5,
    ultraPrecisionScore:     r.ultraPrecisionScore,
    volatilityExpansionRatio:r.volatilityExpansionRatio,
    candleQualityScore:      r.candleQualityScore,
    rsi2:                    r.rsi2,
    signalRangePct:          r.signalRangePct,
    pre10AvgRangeATR:        r.pre10AvgRangeATR,
    pre10ExpansionCount:     r.pre10ExpansionCount,
    pre10AvgVolRatio:        r.pre10AvgVolRatio,
    pre5AvgVolRatio:         r.pre5AvgVolRatio,
    pre10HighVolCount:       r.pre10HighVolCount,
    pre10RedVolBias:         r.pre10RedVolBias,
    atrPct14Pctl120:         r.atrPct14Pctl120,
    zoneTightnessPct:        r.zone?.zoneTightnessPct ?? null,
    zoneLen:                 r.zone?.windowLength ?? null,
    rewardRisk:              r.priceEngine?.rewardRisk ?? null,
    tacticalRiskPct:         r.priceEngine?.tacticalRiskPct ?? null,
    inflectionScore:         r.inflectionScore,
    conditionsMet:           r.conditionsMet,
  };
}

// Determine trade outcome: simple forward return (5% gain vs 3% stop, 10-day window)
// This avoids dependency on tradeValid/target being set correctly and gives more trades.
function getOutcome(candles, signalIdx) {
  const entry = candles[signalIdx].c;
  const target = entry * 1.05;
  const stop   = entry * 0.97;
  for (let j = signalIdx + 1; j < Math.min(signalIdx + 11, candles.length); j++) {
    if (candles[j].l <= stop)  return 'LOSS';
    if (candles[j].h >= target) return 'WIN';
  }
  // Timeout: close vs entry at day 10
  const finalClose = candles[Math.min(signalIdx + 10, candles.length - 1)].c;
  return finalClose >= entry * 1.01 ? 'WIN' : 'LOSS';
}

// Collect trades for one stock on one param set (FULL dataset — max signal count)
function collectTrades(candles, key) {
  const trades = [];
  // Leave 10 forward candles for outcome + 10 buffer at start
  for (let i = 50; i < candles.length - 10; i++) {
    const slice = candles.slice(Math.max(0, i - 299), i + 1);
    let r;
    try { r = analyzeStock(slice, key); } catch { continue; }
    if (!r || !ACTIONABLE.has(r.stage)) continue;
    const outcome = getOutcome(candles, i);
    trades.push({ outcome, features: extractFeatures(r) });
  }
  return trades;
}

// Compute mean of an array, ignoring nulls
function mean(arr) {
  const valid = arr.filter(x => x !== null && x !== undefined && isFinite(x));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Standard deviation
function std(arr) {
  const valid = arr.filter(x => x !== null && x !== undefined && isFinite(x));
  if (valid.length < 2) return 0;
  const m = mean(valid);
  return Math.sqrt(valid.reduce((s, x) => s + (x - m) ** 2, 0) / valid.length);
}

// Cohen's d effect size (normalized separation)
function cohensD(wins, losses, feat) {
  const wVals = wins.map(t => t.features[feat]).filter(x => x !== null && isFinite(x));
  const lVals = losses.map(t => t.features[feat]).filter(x => x !== null && isFinite(x));
  if (wVals.length < 2 || lVals.length < 2) return 0;
  const wm = mean(wVals), lm = mean(lVals);
  const pooledStd = Math.sqrt((std(wVals) ** 2 + std(lVals) ** 2) / 2);
  return pooledStd > 0 ? (wm - lm) / pooledStd : 0;
}

// Percentile of a value in array
function percentile(arr, pct) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(s.length * pct / 100);
  return s[Math.min(idx, s.length - 1)];
}

function analyzeFingerprint(allTrades, key) {
  const wins   = allTrades.filter(t => t.outcome === 'WIN');
  const losses = allTrades.filter(t => t.outcome === 'LOSS');

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${key}  —  ${allTrades.length} IS trades  |  ${wins.length} W  ${losses.length} L  (${(wins.length/allTrades.length*100).toFixed(1)}% WR)`);
  console.log('═'.repeat(70));

  if (wins.length < 3 || losses.length < 3) {
    console.log('  ⚠  Insufficient trades for fingerprinting.');
    return;
  }

  const features = Object.keys(wins[0].features);
  const rows = [];

  for (const feat of features) {
    const wVals  = wins.map(t => t.features[feat]).filter(x => x !== null && isFinite(x));
    const lVals  = losses.map(t => t.features[feat]).filter(x => x !== null && isFinite(x));
    if (wVals.length < 2 || lVals.length < 2) continue;
    const wMean  = mean(wVals);
    const lMean  = mean(lVals);
    const d      = cohensD(wins, losses, feat);
    const direction = wMean > lMean ? 'W>' : 'L>';
    rows.push({ feat, wMean, lMean, d: Math.abs(d), direction, wN: wVals.length, lN: lVals.length });
  }

  // Sort by effect size descending
  rows.sort((a, b) => b.d - a.d);

  console.log(`\n  ${'PARAM'.padEnd(28)} ${'WIN mean'.padStart(9)} ${'LOSS mean'.padStart(10)} ${'|d|'.padStart(6)}  ${'dir'.padStart(4)}  INSIGHT`);
  console.log('  ' + '─'.repeat(80));

  for (const row of rows) {
    const pct = ((row.wMean - row.lMean) / (Math.abs(row.lMean) || 1) * 100).toFixed(0);
    const bar = '█'.repeat(Math.min(Math.round(row.d * 4), 12));
    const insight = row.d > 0.5 ? (row.direction === 'W>' ? `↑ tighten min` : `↑ tighten max`) : '';
    console.log(`  ${row.feat.padEnd(28)} ${row.wMean.toFixed(2).padStart(9)} ${row.lMean.toFixed(2).padStart(10)} ${row.d.toFixed(2).padStart(6)}  ${row.direction}    ${bar} ${insight}`);
  }

  // ── Suggested new thresholds based on winner distribution ──
  console.log(`\n  SUGGESTED THRESHOLDS (based on bottom-25th percentile of winner distribution):`);
  const strongDiscriminators = rows.filter(r => r.d > 0.3 && r.direction === 'W>');
  const strongMaxDiscriminators = rows.filter(r => r.d > 0.3 && r.direction === 'L>');

  for (const row of strongDiscriminators.slice(0, 8)) {
    const wVals = wins.map(t => t.features[row.feat]).filter(x => x !== null && isFinite(x));
    const p25 = percentile(wVals, 25);
    const current = PARAM_SETS[key];
    const paramKey = `min${row.feat.charAt(0).toUpperCase()}${row.feat.slice(1)}`;
    const currentVal = current[paramKey] ?? current[`max${row.feat.charAt(0).toUpperCase()}${row.feat.slice(1)}`] ?? '?';
    console.log(`    ${row.feat.padEnd(28)} suggest min ≥ ${p25.toFixed(2).padStart(6)}  (current: ${String(currentVal).padStart(6)})  [effect d=${row.d.toFixed(2)}]`);
  }
  for (const row of strongMaxDiscriminators.slice(0, 5)) {
    const wVals = wins.map(t => t.features[row.feat]).filter(x => x !== null && isFinite(x));
    const p75 = percentile(wVals, 75);
    const paramKey = `max${row.feat.charAt(0).toUpperCase()}${row.feat.slice(1)}`;
    const current = PARAM_SETS[key];
    const currentVal = current[paramKey] ?? '?';
    console.log(`    ${row.feat.padEnd(28)} suggest max ≤ ${p75.toFixed(2).padStart(6)}  (current: ${String(currentVal).padStart(6)})  [effect d=${row.d.toFixed(2)}]`);
  }

  // ── Combo analysis: top 2 discriminators ──
  if (rows.length >= 2 && rows[0].d > 0.4 && rows[1].d > 0.4) {
    const f1 = rows[0].feat, f2 = rows[1].feat;
    const wBoth = wins.filter(t => {
      const v1 = t.features[f1], v2 = t.features[f2];
      return v1 !== null && v2 !== null;
    });
    if (wBoth.length >= 3) {
      console.log(`\n  TOP COMBO (${f1} × ${f2}):`);
      const wMed1 = percentile(wBoth.map(t => t.features[f1]).filter(isFinite), 50);
      const wMed2 = percentile(wBoth.map(t => t.features[f2]).filter(isFinite), 50);
      const highBoth = allTrades.filter(t => {
        const v1 = t.features[f1], v2 = t.features[f2];
        const dir1 = rows[0].direction === 'W>' ? v1 >= wMed1 : v1 <= wMed1;
        const dir2 = rows[1].direction === 'W>' ? v2 >= wMed2 : v2 <= wMed2;
        return dir1 && dir2;
      });
      const highBothWins = highBoth.filter(t => t.outcome === 'WIN');
      console.log(`    When BOTH at/above winner median: ${highBothWins.length}W/${highBoth.length-highBothWins.length}L = ${highBoth.length > 0 ? (highBothWins.length/highBoth.length*100).toFixed(0) : '?'}% WR (n=${highBoth.length})`);
    }
  }
}

// ── MAIN ──
const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv')).map(f => path.join(DATA_DIR, f));
console.log(`Winner Fingerprinting — ${allFiles.length} stocks, IS (first 60%), params: ${TARGET_KEYS.join(', ')}`);
console.log('Running single-threaded (fast — IS only)...\n');

const allTrades = {};
for (const key of TARGET_KEYS) allTrades[key] = [];

let done = 0;
for (const fp of allFiles) {
  const candles = parseCSV(fp);
  if (candles.length < 100) { done++; continue; }
  for (const key of TARGET_KEYS) {
    const trades = collectTrades(candles, key);
    allTrades[key].push(...trades);
  }
  done++;
  if (done % 50 === 0) process.stdout.write(`\r  Scanned ${done}/${allFiles.length} stocks...`);
}
process.stdout.write(`\r  Scanned ${done}/${allFiles.length} stocks.\n`);

for (const key of TARGET_KEYS) {
  analyzeFingerprint(allTrades[key], key);
}

console.log('\n\nDone. Use the suggested thresholds to update PARAM_SETS in lib/stockEngine.ts.');
