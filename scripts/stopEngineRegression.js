const assert = require('node:assert/strict');
const { validateTrade, applyValidation } = require('./_compiled_current/autoValidator.js');
const { deriveTradeEventRows } = require('./_compiled_current/tradeEvents.js');
const {
  computeWinRateStats,
  getFivePctObjectivePnlPct,
} = require('./_compiled_current/tradeOps.js');

function candle(d, o, h, l, c, v = 100000) {
  return { d, o, h, l, c, v };
}

function warmup() {
  const bars = [];
  for (let i = 1; i <= 30; i++) {
    const c = 99.8 + i * 0.01;
    bars.push(candle(`2026-05-${String(i).padStart(2, '0')}`, c, c + 1, c - 1, c, 100000 + i * 100));
  }
  return bars;
}

function trade(overrides = {}) {
  return {
    symbol: 'TEST.NS',
    stage: 'BUY',
    entryPrice: 100,
    entryDate: '2026-06-01',
    stopLoss: 95,
    disasterStop: 90,
    target1: 105,
    target2: 110,
    target3: 115,
    paramSetKey: 'optimized_deployable_20plus',
    sector: 'TEST',
    conviction: 70,
    status: 'open',
    sw5LowAtEntry: 93,
    atr14AtEntry: 2,
    maxHoldBars: 20,
    ...overrides,
  };
}

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    throw error;
  }
}

const pre = warmup();

run('hard disaster stop is stop-first when T1 is also inside the daily range', () => {
  const result = validateTrade(
    trade({ target1: 110, target2: 120, target3: 130 }),
    [candle('2026-06-02', 100, 115, 89, 108)],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'stopped');
  assert.equal(result.closedPrice, 90);
  assert.equal(result.closedDate, '2026-06-02');
  assert.equal(result.targetLog, undefined);
  assert.equal(result.gateLog[0].stopKind, 'hard');
});

run('first post-entry session receives no unconditional fortress exemption', () => {
  const result = validateTrade(
    trade(),
    [
      candle('2026-06-02', 100, 100.5, 94, 94.5, 140000),
      candle('2026-06-03', 93, 94, 92, 93.5, 150000),
    ],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'stopped');
  assert.equal(result.closedPrice, 93);
  assert.equal(result.closedDate, '2026-06-03');
  assert.equal(result.gateLog[0].result, 'EXIT_PENDING');
  assert.equal(result.gateLog[0].day, 1);
  assert.equal(result.gateLog[1].triggerType, 'review_open');
  assert.equal(result.gateLog[1].day, 2);
});

run('review-stop wick that closes above the level is retained as a shield', () => {
  const result = validateTrade(
    trade({ target1: 110, target2: 120, target3: 130 }),
    [candle('2026-06-02', 100, 102, 94, 99, 90000)],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'open');
  assert.equal(result.gateLog[0].result, 'SHIELDED');
  assert.equal(result.closedDate, '');
});

run('missing entry structure cannot auto-shield a below-stop close', () => {
  const result = validateTrade(
    trade({ sw5LowAtEntry: undefined }),
    [candle('2026-06-02', 100, 100.5, 94, 94.5, 140000)],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'open');
  assert.equal(result.gateLog[0].result, 'EXIT_PENDING');
  const structureGate = result.gateLog[0].gatesTested.find(g => g.gate === 'G9 Structure OK');
  assert.equal(structureGate.passed, false);
  assert.match(structureGate.reason, /unavailable/i);
});

run('post-T1 breakeven is a hard protective exit with weighted P&L', () => {
  const result = validateTrade(
    trade(),
    [
      candle('2026-06-02', 100, 106, 96, 104, 120000),
      candle('2026-06-03', 102, 103, 99, 100, 100000),
    ],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'hit_t1');
  assert.equal(result.closedPrice, 100);
  assert.equal(result.closedDate, '2026-06-03');
  assert.equal(result.pnlPct, 2.5);
  assert.equal(result.gateLog.at(-1).stopKind, 'trail');
});

run('expiry uses the frozen holding horizon rather than all supplied future bars', () => {
  const result = validateTrade(
    trade({
      stopLoss: 80,
      disasterStop: 70,
      target1: 120,
      target2: 130,
      target3: 140,
      maxHoldBars: 2,
    }),
    [
      candle('2026-06-02', 100, 102, 98, 101),
      candle('2026-06-03', 101, 103, 99, 102),
      candle('2026-06-04', 102, 110, 101, 109),
      candle('2026-06-05', 109, 115, 108, 114),
    ],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'expired');
  assert.equal(result.daysHeld, 2);
  assert.equal(result.closedDate, '2026-06-03');
  assert.equal(result.closedPrice, 102);
});

run('a confirmed review exit remains pending until a next-session open exists', () => {
  const result = validateTrade(
    trade(),
    [candle('2026-06-02', 100, 100.5, 94, 94.5, 140000)],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'open');
  assert.equal(result.closedDate, '');
  assert.equal(result.gateLog.at(-1).result, 'EXIT_PENDING');
});

run('a trade without a frozen stop remains unresolved', () => {
  const result = validateTrade(
    trade({ stopLoss: 0, disasterStop: 0 }),
    [candle('2026-06-02', 100, 130, 95, 125)],
    { preEntryCandles: pre },
  );
  assert.equal(result.status, 'open');
  assert.equal(result.daysHeld, 0);
  assert.equal(result.targetLog, undefined);
});

run('active T1/T2 milestones do not persist a false terminal exit', () => {
  const original = trade();
  const result = validateTrade(
    original,
    [candle('2026-06-02', 100, 106, 96, 104)],
    { preEntryCandles: pre },
  );
  const updated = applyValidation(original, result);
  assert.equal(updated.status, 'hit_t1');
  assert.equal(updated.closedDate, undefined);
  assert.equal(updated.closedPrice, undefined);
  assert.equal(updated.currentPrice, 104);
});

run('chandelier stop uses only prior completed candles', () => {
  const baseBars = [
    candle('2026-06-02', 100, 111, 98, 110, 120000),
    candle('2026-06-03', 110, 150, 105.5, 149, 160000),
  ];
  const variantBars = [
    baseBars[0],
    candle('2026-06-03', 110, 120, 105.5, 119, 160000),
  ];
  const config = trade({ target3: 200 });
  const first = validateTrade(config, baseBars, { preEntryCandles: pre });
  const second = validateTrade(config, variantBars, { preEntryCandles: pre });
  assert.equal(first.status, 'hit_t2');
  assert.equal(first.closedDate, '2026-06-03');
  assert.equal(first.gateLog.at(-1).stopKind, 'trail');
  assert.equal(first.closedPrice, second.closedPrice);
  assert.ok(first.closedPrice > 105);
});

run('Trade Log records +5%, T1, T2, and T3 when the daily high clears all levels', () => {
  const completedTrade = trade({
    status: 'hit_t3',
    closedPrice: 115,
    closedDate: '2026-06-02',
    mfe: 16,
  });
  const rows = deriveTradeEventRows(completedTrade, [{
    date: '2026-06-02',
    dayNum: 1,
    open: 100,
    high: 116,
    low: 98,
    close: 114,
  }]);
  assert.deepEqual(
    rows[0].events.map(event => event.type),
    ['hit_5pct', 'hit_t1', 'hit_t2', 'hit_t3'],
  );
  assert.equal(rows[0].terminal, true);
});

run('Trade Log suppresses same-bar targets when the canonical hard stop wins', () => {
  const stoppedTrade = trade({
    status: 'stopped',
    closedPrice: 90,
    closedDate: '2026-06-02',
    gateLog: [{
      day: 1,
      date: '2026-06-02',
      close: 108,
      low: 89,
      stopLevel: 90,
      dipPct: 0,
      triggerType: 'intraday_low',
      gatesTested: [{ gate: 'HARD Disaster Stop', passed: true, reason: 'stop-first fill' }],
      result: 'STOPPED',
      stopKind: 'hard',
    }],
  });
  const rows = deriveTradeEventRows(stoppedTrade, [{
    date: '2026-06-02',
    dayNum: 1,
    open: 100,
    high: 120,
    low: 89,
    close: 108,
  }]);
  assert.deepEqual(rows[0].events.map(event => event.type), ['stopped']);
  assert.match(rows[0].events[0].detail, /Hard stop/);
});

run('5% objective analytics value winners at +5%, not at future MFE', () => {
  const winner = trade({
    status: 'stopped',
    closedDate: '2026-06-10',
    closedPrice: 90,
    pnlPct: -10,
    pnlR: -1,
    mfe: 20,
  });
  const loser = trade({
    symbol: 'LOSS.NS',
    status: 'stopped',
    closedDate: '2026-06-11',
    closedPrice: 95,
    pnlPct: -5,
    pnlR: -0.5,
    mfe: 2,
  });
  const stats = computeWinRateStats([winner, loser]);
  assert.equal(getFivePctObjectivePnlPct(winner), 5);
  assert.equal(stats.avgWinPct, 5);
  assert.equal(stats.profitFactor, 1);
  assert.equal(stats.expectancy, 0);
});

process.stdout.write('All canonical stop-engine regression tests passed.\n');
