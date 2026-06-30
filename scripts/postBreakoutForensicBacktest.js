// ═══════════════════════════════════════════════════════════════════════════════
// POST-BREAKOUT FORENSIC BACKTEST — "did the screener see it coming?"
// ═══════════════════════════════════════════════════════════════════════════════
// For every genuine single-day monster-move breakout (>=7% close-to-close on
// >=3x avg volume) found across the Nifty 500 dataset, this truncates each
// stock's history to END 1/2/3 trading days BEFORE the breakout candle, then
// runs the REAL production engine (compiled from lib/stockEngine.ts — not a
// reimplementation, so it reflects the current inflectionScore fix etc.)
// across all 5 param sets. Tabulates: was the stock on the radar (BUY+,
// PRE_BREAKOUT, EARLY_INFLECTION, COMPRESSION_WATCH) or fully missed
// (NO_SIGNAL) the day(s) before the move actually happened.
//
// USAGE (two steps — compile the real engine first, then run this):
//   node_modules/.bin/tsc lib/stockEngine.ts lib/statsEngine.ts lib/candlePatterns.ts \
//     --target ES2020 --module CommonJS --outDir scripts/_compiled \
//     --esModuleInterop --skipLibCheck --moduleResolution node --strict false
//   node scripts/postBreakoutForensicBacktest.js
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled');

if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('Compiled engine not found. Run this first:\n');
  console.error('  node_modules/.bin/tsc lib/stockEngine.ts lib/statsEngine.ts lib/candlePatterns.ts \\');
  console.error('    --target ES2020 --module CommonJS --outDir scripts/_compiled \\');
  console.error('    --esModuleInterop --skipLibCheck --moduleResolution node --strict false\n');
  process.exit(1);
}
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const ON_RADAR = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH']);
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ ts: 0, date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  POST-BREAKOUT FORENSIC BACKTEST — does the screener see monster moves coming?');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'));
console.log(`Scanning ${files.length} Nifty 500 stocks for genuine monster-move breakout candles...\n`);

// ── Step 1: find breakout events (single-day >=7% close-to-close, >=3x avg volume) ──
const events = [];
for (const f of files) {
  const candles = parseYahoo(path.join(DATA_DIR, f));
  if (candles.length < 150) continue;
  const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');

  for (let i = 60; i < candles.length - 1; i++) {
    const prev = candles[i - 1], cur = candles[i];
    if (prev.c <= 0) continue;
    const chgPct = (cur.c - prev.c) / prev.c * 100;
    if (chgPct < 7) continue;

    // split-guard: skip clearly fake corporate-action jumps
    if (chgPct > 80) continue;

    let v20 = 0, n = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0) { v20 += candles[j].v; n++; } }
    v20 = n > 0 ? v20 / n : 0;
    if (v20 <= 0 || cur.v < v20 * 3) continue; // require genuine volume confirmation, not just a quiet gap

    events.push({ sym, idx: i, date: cur.date, chgPct, volMult: cur.v / v20, candles });
    i += 10; // skip ahead so a multi-day move doesn't get counted as several events
  }
}
console.log(`Found ${events.length} genuine monster-move breakout events (>=7% close-to-close, >=3x avg volume)\n`);

// ── Step 2: for each event, truncate to N days before and run the REAL engine ──
const LOOKBACKS = [1, 2, 3]; // trading days before the breakout candle
const results = { 1: [], 2: [], 3: [] };

let processed = 0;
for (const ev of events) {
  for (const lb of LOOKBACKS) {
    const cutIdx = ev.idx - lb; // last candle included = breakout_idx - lb
    if (cutIdx < 60) continue;
    const truncated = ev.candles.slice(0, cutIdx + 1);

    // Best stage achieved across all 5 param sets at this snapshot
    let bestStage = 'NO_SIGNAL';
    let bestSet = null;
    let anyZone = false;
    const stageRank = { ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4, EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1 };
    for (const key of PARAM_SETS) {
      let r;
      try { r = analyzeStock(truncated, key); } catch { continue; }
      if (r.zone) anyZone = true;
      if (stageRank[r.stage] > stageRank[bestStage]) { bestStage = r.stage; bestSet = key; }
    }
    results[lb].push({ sym: ev.sym, date: ev.date, chgPct: ev.chgPct, volMult: ev.volMult, bestStage, bestSet, anyZone });
  }
  processed++;
  if (processed % 50 === 0) console.log(`  ...processed ${processed}/${events.length} events`);
}

// ── Step 3: tabulate ──
function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }

for (const lb of LOOKBACKS) {
  const rs = results[lb];
  console.log('\n' + '═'.repeat(90));
  console.log(`  ${lb} TRADING DAY${lb > 1 ? 'S' : ''} BEFORE THE BREAKOUT  (n=${rs.length} events)`);
  console.log('═'.repeat(90));

  const actionable = rs.filter(r => ACTIONABLE.has(r.bestStage));
  const preBreakout = rs.filter(r => r.bestStage === 'PRE_BREAKOUT');
  const earlyInfl = rs.filter(r => r.bestStage === 'EARLY_INFLECTION');
  const compression = rs.filter(r => r.bestStage === 'COMPRESSION_WATCH');
  const onRadar = rs.filter(r => ON_RADAR.has(r.bestStage));
  const missed = rs.filter(r => r.bestStage === 'NO_SIGNAL');
  const hadZone = rs.filter(r => r.anyZone);

  console.log(`  Caught as BUY/STRONG_BUY/ULTRA_STRONG_BUY (actionable signal): ${actionable.length} (${pct(actionable.length, rs.length)}%)`);
  console.log(`  PRE_BREAKOUT (right at the edge):                              ${preBreakout.length} (${pct(preBreakout.length, rs.length)}%)`);
  console.log(`  EARLY_INFLECTION (coiling, pre-conditions clean):              ${earlyInfl.length} (${pct(earlyInfl.length, rs.length)}%)`);
  console.log(`  COMPRESSION_WATCH (zone found, environment not fully clean):   ${compression.length} (${pct(compression.length, rs.length)}%)`);
  console.log(`  ── On radar in ANY form (BUY+ through COMPRESSION_WATCH):      ${onRadar.length} (${pct(onRadar.length, rs.length)}%)`);
  console.log(`  MISSED ENTIRELY (NO_SIGNAL — no zone, no signal at all):       ${missed.length} (${pct(missed.length, rs.length)}%)`);
  console.log(`  (Of which, had a compression zone detected at all: ${hadZone.length} (${pct(hadZone.length, rs.length)}%))`);

  if (actionable.length > 0) {
    console.log(`\n  Sample actionable catches:`);
    for (const r of actionable.slice(0, 8)) console.log(`    ${r.sym.padEnd(14)} ${r.date}  +${r.chgPct.toFixed(1)}% move, ${r.volMult.toFixed(1)}x vol  →  ${r.bestStage} (${r.bestSet})`);
  }
}

// ── Step 4: breakdown by move size — does the screener do better on bigger moves? ──
console.log('\n' + '═'.repeat(90));
console.log('  BREAKDOWN BY MOVE SIZE (1 day before, n=' + results[1].length + ')');
console.log('═'.repeat(90));
const buckets = [[7, 10], [10, 15], [15, 25], [25, 999]];
for (const [lo, hi] of buckets) {
  const bucket = results[1].filter(r => r.chgPct >= lo && r.chgPct < hi);
  if (bucket.length === 0) continue;
  const onR = bucket.filter(r => ON_RADAR.has(r.bestStage)).length;
  const act = bucket.filter(r => ACTIONABLE.has(r.bestStage)).length;
  console.log(`  ${lo}-${hi === 999 ? '∞' : hi}%: n=${bucket.length}  On-radar=${pct(onR, bucket.length)}%  Actionable=${pct(act, bucket.length)}%`);
}

console.log('\n═══ POST-BREAKOUT FORENSIC BACKTEST COMPLETE ═══');
