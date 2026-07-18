'use strict';
const fs   = require('fs');
const path = require('path');

const ENGINE_DIR  = path.join(__dirname, '_compiled_current');
const PARAMS_FILE = path.join(__dirname, 'goldenParams.json');

if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('❌  _compiled_current/stockEngine.js missing. Run: npm run compile');
  process.exit(1);
}

const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8')); // validate exists

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

const PS_LABEL = {
  optimized_deployable_20plus:    'VolumeFootprint   ',
  optimized_highprecision_15plus: 'CompressionCoil   ',
  optimized_elite_10plus:         'MomentumPocket    ',
  optimized_ultraselective_8plus: 'EMAStack          ',
  sniper_95plus:                  'PerfectStorm      ',
};

const DATA_DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV', fmt: 'nse'   },
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio',     fmt: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50',         fmt: 'nse'   },
];

const SKIP    = new Set(['ALL_SYMBOLS_OHLCV.csv']);
const BUY     = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
// Fixed window: always pass exactly WINDOW candles to the engine (faster than growing slices)
const WINDOW  = 220;
const STEP    = 5;    // scan every 5th bar
const COOL    = 5;    // cooldown bars between entries per symbol
const MAX_H   = 20;
const MIN_C   = WINDOW + MAX_H + 5;

// ── parsers ──────────────────────────────────────────────────────────────────
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts: Date.parse(p[0]) || i * 86400000, o: +p[1], h: +p[2], l: +p[3], c, v: +p[5] || 0 });
  }
  return out;
}

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const off = lines[0].toLowerCase().startsWith('symbol') ? 1 : 0;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 5 + off) continue;
    const c = +p[4 + off]; if (!c || c <= 0) continue;
    out.push({ ts: Date.parse(p[off]) || i * 86400000, o: +p[1+off], h: +p[2+off], l: +p[3+off], c, v: +p[5+off] || 0 });
  }
  return out;
}

// ── trade sim ────────────────────────────────────────────────────────────────
function simulate(candles, sigIdx, stop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;
  const ep = candles[eIdx].o;
  if (!ep || ep <= 0) return null;
  const t1 = ep * 1.05, t2 = ep * 1.07, t3 = ep * 1.10;
  let rem = 1, pnl = 0, mae = 0, mfe = 0;
  for (let b = 1; b <= MAX_H; b++) {
    const idx = eIdx + b;
    if (idx >= candles.length) { pnl += rem * (candles[candles.length-1].c - ep) / ep * 100; rem = 0; break; }
    const bar = candles[idx];
    mae = Math.min(mae, (bar.l - ep) / ep * 100);
    mfe = Math.max(mfe, (bar.h - ep) / ep * 100);
    if (bar.l <= stop) { pnl += rem * (stop - ep) / ep * 100; rem = 0; break; }
    if (rem >= 0.99 && bar.c >= t1) { pnl += 0.50 * (bar.c - ep) / ep * 100; rem -= 0.50; }
    if (rem >= 0.29 && bar.c >= t2) { pnl += 0.30 * (bar.c - ep) / ep * 100; rem -= 0.30; }
    if (rem >  0   && bar.c >= t3) { pnl += rem  * (bar.c - ep) / ep * 100; rem  = 0;    }
    if (b === MAX_H && rem > 0)    { pnl += rem  * (bar.c - ep) / ep * 100; rem  = 0;    }
  }
  return { pnl, mae: Math.abs(mae), mfe, win: pnl > 0.1 };
}

// ── file list ─────────────────────────────────────────────────────────────────
function collectFiles() {
  const seen = new Set(), files = [];
  for (const { dir, fmt } of DATA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const fn of fs.readdirSync(dir)) {
      if (!fn.endsWith('.csv') || SKIP.has(fn)) continue;
      const fp = path.join(dir, fn);
      if (seen.has(fp)) continue;
      seen.add(fp); files.push({ fp, fmt });
    }
  }
  return files;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const files = collectFiles();
  console.log(`\nLoaded ${files.length} symbols  |  window=${WINDOW}  step=${STEP}  maxHold=${MAX_H}\n`);

  const acc = {};
  for (const ps of PARAM_SETS)
    acc[ps] = { bars: 0, signals: 0, trades: 0, wins: 0, sumPnl: 0, sumMae: 0, sumMfe: 0, arr: [] };

  let done = 0;
  for (const { fp, fmt } of files) {
    const all = fmt === 'nse' ? parseNSE(fp) : parseYahoo(fp);
    if (all.length < MIN_C) { done++; continue; }

    for (const ps of PARAM_SETS) {
      const a = acc[ps];
      let lastEntry = -COOL - 1;

      for (let i = WINDOW; i < all.length - MAX_H - 2; i += STEP) {
        a.bars++;
        if (i - lastEntry < COOL) continue;

        // Fixed-size window — no growing slice, constant memory cost
        const win = all.slice(i - WINDOW, i + 1);

        let res;
        try { res = analyzeStock(win, ps); } catch { continue; }
        if (!res || !BUY.has(res.stage)) continue;

        a.signals++;
        const sc   = all[i].c;
        const raw  = res.priceEngine?.tacticalStop || sc * 0.95;
        const stop = Math.min(sc * 0.965, Math.max(sc * 0.935, raw));

        const t = simulate(all, i, stop);
        if (!t) continue;

        lastEntry = i;
        a.trades++;
        if (t.win) a.wins++;
        a.sumPnl += t.pnl; a.sumMae += t.mae; a.sumMfe += t.mfe;
        a.arr.push(t.pnl);
      }
    }

    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${files.length}\r`);
  }

  // ── print results ─────────────────────────────────────────────────────────
  const W = 120;
  console.log(`\n  ✓ ${done} symbols  done\n`);
  console.log('═'.repeat(W));
  console.log('  COMPREHENSIVE BACKTEST RESULTS  |  5 Momentum Archetypes  |  Nifty 500 + Portfolio');
  console.log('═'.repeat(W));
  console.log([
    'Archetype         ', 'Trades'.padStart(7), 'Signals'.padStart(8),
    'WinRate'.padStart(8), 'Hit/1kB'.padStart(8),
    'Avg P&L%'.padStart(9), 'Med P&L%'.padStart(9),
    'Avg MAE%'.padStart(9), 'Avg MFE%'.padStart(9),
    'ProfitFactor'.padStart(13),
  ].join('  '));
  console.log('─'.repeat(W));

  const rows = [];
  for (const ps of PARAM_SETS) {
    const s = acc[ps];
    if (s.trades === 0) {
      console.log(`${PS_LABEL[ps]}  ${'0'.padStart(7)}  ${String(s.signals).padStart(8)}  ${'—'.padStart(8)}  ${'—'.padStart(8)}  ${'—'.padStart(9)}  ${'—'.padStart(9)}  ${'—'.padStart(9)}  ${'—'.padStart(9)}  ${'—'.padStart(13)}`);
      rows.push({ ps, label: PS_LABEL[ps].trim(), trades: 0, signals: s.signals });
      continue;
    }
    const wr  = s.wins / s.trades * 100;
    const hit = s.bars > 0 ? s.signals / s.bars * 1000 : 0;
    const avg = s.sumPnl / s.trades;
    const mae = s.sumMae / s.trades;
    const mfe = s.sumMfe / s.trades;
    const sorted = [...s.arr].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const gW  = s.arr.filter(x => x > 0).reduce((a, b) => a + b, 0);
    const gL  = Math.abs(s.arr.filter(x => x < 0).reduce((a, b) => a + b, 0));
    const pf  = gL > 0 ? gW / gL : 999;
    rows.push({ ps, label: PS_LABEL[ps].trim(), trades: s.trades, signals: s.signals, wr, hit, avg, med, mae, mfe, pf });
    console.log([
      PS_LABEL[ps],
      String(s.trades).padStart(7),
      String(s.signals).padStart(8),
      (wr.toFixed(1)+'%').padStart(8),
      hit.toFixed(2).padStart(8),
      ((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(9),
      ((med>=0?'+':'')+med.toFixed(2)+'%').padStart(9),
      (mae.toFixed(2)+'%').padStart(9),
      ('+'+mfe.toFixed(2)+'%').padStart(9),
      (pf>=999?'∞':pf.toFixed(2)).padStart(13),
    ].join('  '));
  }

  console.log('\n  WinRate = trades with net P&L > +0.1%  |  Hit/1kB = signals per 1000 bars scanned');
  console.log('  Entry: next-bar open  |  SL: tacticalStop clamped [3.5%,6.5%] below close');
  console.log('  Exits: 50%@+5%  30%@+7%  rem@+10% or bar-20 time-stop\n');

  const out = path.join(__dirname, 'results',
    `comprehensive_backtest_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,16)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), symbols: done, window: WINDOW, step: STEP, rows }, null, 2));
  console.log(`  Saved → ${out}\n`);
}

main();
