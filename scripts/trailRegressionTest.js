// Trail-A and Trail-B regression tests for autoValidator.ts
// Run: npm run test:trail
//
// Proves:
// 1. Trail-A fires at day >= 11 (after 10 completed post-entry bars, using prior bars only)
// 2. Trail-B fires after T2 hit (Chandelier = highestCloseSinceT2 - 2.0 * ATR, prior bars only)

'use strict';
const { validateTrade } = require('./_compiled_current/autoValidator');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  PASS:', msg);
    passed++;
  } else {
    console.error('  FAIL:', msg);
    failed++;
  }
}

function candle(h, l, c, d) {
  return { h, l, c, o: c, v: 500000, d };
}

// 30 pre-entry warmup candles at ~100, ATR ≈ 2; Trail-A fires at i>=10 (day>=11)
const PRE = Array.from({ length: 30 }, (_, i) =>
  candle(101, 99, 100, `2025-01-${String(i + 1).padStart(2, '0')}`)
);

const BASE_TRADE = {
  symbol: 'TESTSTOCK',
  stage: 'PRIME',
  entryPrice: 100,
  entryDate: '2025-01-31',
  stopLoss: 96,
  disasterStop: 0,
  paramSetKey: 'test',
  sector: 'TEST',
  conviction: 80,
  atr14AtEntry: 2.0,
  maxHoldBars: 30,
  status: 'open',
};

// ─── Test 1: Trail-A fires at day ≥ 9, not before ──────────────────────────

console.log('\n[Test 1] Trail-A fires at day >= 9 (no lookahead)');
{
  // T1 set far away (110) so it never fires — isolates Trail-A behavior
  const trade = { ...BASE_TRADE, target1: 110, target2: 115, target3: 120 };

  // Post-entry: flat around 100-101, lows at 99.5 (well above stop at 96)
  // At i=10: fiveBarSwingLow(bars[5..9]) = 99.5, ATR ≈ 2
  // bufferedTrail = 99.5 - 0.45*2 = 98.6 → > dynamicStop(96), < entry(100) → fires
  const post = Array.from({ length: 20 }, (_, i) =>
    candle(101.0, 99.5, 100.5, `2025-02-${String(i + 1).padStart(2, '0')}`)
  );

  const result = validateTrade(trade, post, { preEntryCandles: PRE });
  const log = result.trailLog ?? [];

  assert(log.length > 0,
    `Trail-A fired at least once (log has ${log.length} entries)`);

  const firstDay = log.length > 0 ? log[0].day : -1;
  assert(firstDay >= 11,
    `Trail-A first fires at day >= 11, no lookahead (got day ${firstDay})`);

  if (log.length > 0) {
    const stop = log[0].newStop;
    assert(stop > 96,
      `Trail-A raised stop above hardStop 96 (got ${stop.toFixed(4)})`);
    assert(stop < 100,
      `Trail-A stop stays below entry 100 (got ${stop.toFixed(4)})`);
    assert(/swing|trail/i.test(log[0].reason),
      `Trail-A reason mentions swing/trail (got: "${log[0].reason}")`);
  }
}

// ─── Test 2: Trail-B fires after T2 via Chandelier formula ─────────────────

console.log('\n[Test 2] Trail-B fires after T2 (Chandelier = highestCloseSinceT2 - 2.0 * ATR)');
{
  const trade = { ...BASE_TRADE, target1: 102, target2: 104, target3: 109 };

  // Bars 0-7: lows at 99.5 (above stop), highs at 101 (below T1)
  // Bar 8:   high = 102.5 → T1 hits; Trail-A inactive (t1Hit=true after T1)
  // Bar 9:   high = 104.5 → T2 hits; close = 106 → highestCloseSinceT2 = 106
  // Bar 10+: Trail-B check: chandelier = 106 - 2.0*ATR ≈ 102 > dynamicStop(96), < T3(109) → fires
  const post = [
    ...Array.from({ length: 8 }, (_, i) => candle(101.0, 99.5, 100.5, `2025-02-${String(i + 1).padStart(2, '0')}`)),
    candle(102.5, 99.5, 102.2, '2025-02-09'),   // bar 8: T1 hit
    candle(104.5, 101.5, 106.0, '2025-02-10'),  // bar 9: T2 hit, highestClose = 106
    ...Array.from({ length: 10 }, (_, i) => candle(106.0, 103.5, 105.0, `2025-02-${String(i + 11).padStart(2, '0')}`)),
  ];

  const result = validateTrade(trade, post, { preEntryCandles: PRE });
  const log = result.trailLog ?? [];

  assert(['hit_t1', 'hit_t2', 'hit_t3', 'stopped'].includes(result.status),
    `Trade progressed at least to T1 (status: ${result.status})`);

  // Match "Chandelier: high close ..." but NOT "Chandelier trail starts" (T2 announcement)
  const trailB = log.filter(e =>
    /^Chandelier:/i.test(e.reason ?? '') || /trail-b/i.test(e.reason ?? '')
  );

  assert(trailB.length > 0,
    `Trail-B (Chandelier) fired at least once (log: [${log.map(e => e.reason.slice(0, 40)).join(' | ')}])`);

  if (trailB.length > 0) {
    const stop = trailB[0].newStop;
    // Chandelier = 106 - 2.0 * ATR(≈2) ≈ 102; above original stop(96) and below T3(109)
    assert(stop > 96,
      `Trail-B stop > original hardStop 96 (got ${stop.toFixed(4)})`);
    assert(stop < 109,
      `Trail-B stop < T3 109 (got ${stop.toFixed(4)})`);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Trail regression: FAILED');
  process.exit(1);
} else {
  console.log('Trail regression: PASSED');
}
