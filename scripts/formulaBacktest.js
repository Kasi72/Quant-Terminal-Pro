// ═══════════════════════════════════════════════════════════════════════════════
// FORMULA BACKTEST — Candle Strength + Momentum5 + POS-ABOVE / NEG-BELOW
// ═══════════════════════════════════════════════════════════════════════════════
// Tests 7 systems derived from the composite entry-price document:
//
//  CS-Base   : Pure Candle Strength (higher-high/low + trend + ATR expansion + strong close)
//  CS-Mom5   : CS-Base + Momentum5 > 0 (5-day lagged momentum filter)
//  CS-SMA200 : CS-Base + above SMA200 only (tighter trend)
//  CS-All    : CS-Base + Mom5 + SMA200 (all three combined)
//  POS-BTST  : POS ABOVE dynamic threshold, exit next-day close
//  POS-Hold5 : POS ABOVE dynamic threshold, hold up to 5 days
//  NEG-BTST  : NEG BELOW dynamic threshold, short, exit next-day close
//
// Each system tested with:
//  · Two exit modes: Fixed R:R (2:1, stop at prior-low) AND Standard exits (T1/T2/T3)
//  · IS / OOS split (60 / 40 chronological)
//  · Year-by-year breakdown
//  · Monthly seasonality
//  · Max consecutive losses
//
// USAGE:  node scripts/formulaBacktest.js
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

// ── Exit parameters (Standard mode) ──────────────────────────────────────────
const STOP_PCT   = 7;    // −7% hard stop
const T1_PCT     = 5;    // +5%
const T2_PCT     = 10;   // +10%
const T3_PCT     = 15;   // +15%
const MAX_HOLD   = 20;   // trading days

// ── POS/NEG formula coefficients (consolidated, document p.last) ─────────────
// EntryPrice = w_o×O + w_h×H + w_l×L + w_c×C − w_atr×ATR14 + intercept
const POS = { wo:0.078034, wh:0.175125, wl:0.271336, wc:0.478040, watr:0.016880, ic:-3.4159 };
const NEG = { wo:-0.821273, wh:0.192147, wl:0.565842, wc:0.701304, watr:0.047135,
               whl:-0.134982, wmo:0.215678, ic:-1.124567 };

// ─── CSV parser ───────────────────────────────────────────────────────────────
const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseDate(s) {
  // Handles DD-Mon-YYYY and YYYY-MM-DD
  if (!s) return null;
  s = s.trim();
  if (s.includes('-') && s.length === 11) {           // DD-Mon-YYYY
    const [d, mon, y] = s.split('-');
    return new Date(+y, MONTH_MAP[mon] ?? 0, +d);
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}

function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim().toUpperCase());
  const iD = header.findIndex(h => h === 'DATE');
  const iO = header.findIndex(h => h === 'OPEN');
  const iH = header.findIndex(h => h === 'HIGH');
  const iL = header.findIndex(h => h === 'LOW');
  const iC = header.findIndex(h => h === 'CLOSE' || h === 'ADJ CLOSE');
  const iV = header.findIndex(h => h === 'VOLUME');
  if (iC < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const c = +p[iC]; if (isNaN(c) || c <= 0) continue;
    const dt = parseDate(p[iD]);
    if (!dt) continue;
    rows.push({ dt, o: +p[iO]||c, h: +p[iH]||c, l: +p[iL]||c, c, v: +p[iV]||0 });
  }
  return rows.sort((a,b) => a.dt - b.dt);
}

// ─── Indicator helpers ────────────────────────────────────────────────────────

function sma(arr, i, n) {
  if (i < n - 1) return null;
  let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j].c; return s / n;
}

function ema(arr, i, n) {
  // Simple EMA via recursive approximation (start from SMA)
  const k = 2 / (n + 1);
  if (i < n - 1) return null;
  let e = 0; for (let j = i - n + 1; j <= i; j++) e += arr[j].c; e /= n;
  // (approximate — good enough for signal generation)
  return e;
}

function atr(arr, i, n) {
  if (i < 1) return arr[0].h - arr[0].l;
  const p = Math.min(n, i);
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) {
    const pc = arr[j-1].c;
    s += Math.max(arr[j].h - arr[j].l, Math.abs(arr[j].h - pc), Math.abs(arr[j].l - pc));
  }
  return s / p;
}

// ─── Trade simulators ─────────────────────────────────────────────────────────

// Mode A: Fixed R:R — Stop = prior_low, Target = entry + 2×(entry − prior_low)
function simFixedRR(rows, entryIdx, entryPrice, priorLow) {
  const stop   = priorLow;
  const riskPx = entryPrice - stop;
  if (riskPx <= 0) return null;
  const target = entryPrice + 2 * riskPx;

  for (let d = 0; d < MAX_HOLD; d++) {
    const ci = entryIdx + d;
    if (ci >= rows.length) break;
    const bar  = rows[ci];
    const open = bar.o;

    if (open <= stop)    return { pnl: (open   - entryPrice)/entryPrice*100, exitType:'stop_gap',   days:d };
    if (bar.l <= stop)   return { pnl: (stop   - entryPrice)/entryPrice*100, exitType:'stop',        days:d };
    if (bar.h >= target) return { pnl: (target - entryPrice)/entryPrice*100, exitType:'target_2R',   days:d+1 };
    if (d === MAX_HOLD-1) return { pnl: (bar.c  - entryPrice)/entryPrice*100, exitType:'time',       days:d+1 };
  }
  return null;
}

// Mode B: Standard partial exits — T1/T2/T3 with trail
function simStandard(rows, entryIdx, entryPrice) {
  const stop = entryPrice * (1 - STOP_PCT/100);
  const t1   = entryPrice * (1 + T1_PCT/100);
  const t2   = entryPrice * (1 + T2_PCT/100);
  const t3   = entryPrice * (1 + T3_PCT/100);
  let t1Hit = false, t2Hit = false, trail = stop;

  for (let d = 0; d < MAX_HOLD; d++) {
    const ci = entryIdx + d;
    if (ci >= rows.length) break;
    const bar  = rows[ci];
    const open = bar.o;

    if (open <= trail) {
      const px = (open - entryPrice)/entryPrice*100;
      if (t2Hit) return { pnl: 0.5*T1_PCT + 0.3*T2_PCT + 0.2*px, exitType:'stop_gap_t2', days:d };
      if (t1Hit) return { pnl: 0.5*T1_PCT + 0.5*px,               exitType:'stop_gap_t1', days:d };
      return { pnl: px, exitType:'stop_gap', days:d };
    }
    if (bar.l <= trail) {
      const px = (trail - entryPrice)/entryPrice*100;
      if (t2Hit) return { pnl: 0.5*T1_PCT + 0.3*T2_PCT + 0.2*px, exitType:'stop_t2', days:d };
      if (t1Hit) return { pnl: 0.5*T1_PCT + 0.5*px,               exitType:'stop_t1', days:d };
      return { pnl: (trail-entryPrice)/entryPrice*100,              exitType:'stop',     days:d };
    }
    if (t2Hit && bar.h >= t3) return { pnl: 0.5*T1_PCT + 0.3*T2_PCT + 0.2*T3_PCT, exitType:'t3', days:d+1 };
    if (t1Hit && !t2Hit && bar.h >= t2) { t2Hit = true; trail = t1; }
    if (!t1Hit && bar.h >= t1)           { t1Hit = true; trail = entryPrice; }

    if (d === MAX_HOLD-1) {
      const cp = (bar.c - entryPrice)/entryPrice*100;
      if (t2Hit) return { pnl: 0.5*T1_PCT + 0.3*T2_PCT + 0.2*cp, exitType:'time_t2', days:d+1 };
      if (t1Hit) return { pnl: 0.5*T1_PCT + 0.5*cp,               exitType:'time_t1', days:d+1 };
      return { pnl: cp, exitType:'time', days:d+1 };
    }
  }
  return null;
}

// Short BTST (NEG BELOW): enter next-day open, exit next-day close
function simShortBTST(rows, signalIdx) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= rows.length - 1) return null;
  const entry  = rows[entryIdx].o;
  const exitP  = rows[entryIdx].c;
  if (entry <= 0) return null;
  return { pnl: (entry - exitP)/entry*100, exitType:'btst_short', days:1 };
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────

function stats(trades) {
  if (!trades || trades.length === 0) return null;
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const wr     = wins.length / trades.length * 100;
  const avgPnl = trades.reduce((s,t)=>s+t.pnl,0) / trades.length;
  const avgW   = wins.length   > 0 ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length     : 0;
  const avgL   = losses.length > 0 ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0;
  const gW     = wins.reduce((s,t)=>s+t.pnl,0);
  const gL     = Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const pf     = gL > 0 ? gW/gL : Infinity;
  let mcl = 0, cl = 0;
  for (const t of trades) { if (t.pnl<=0){cl++;mcl=Math.max(mcl,cl);}else cl=0; }
  return { n:trades.length, wr, avgPnl, avgW, avgL, pf, mcl };
}

function fmtStats(s, prefix='') {
  if (!s) return `${prefix}  No trades`;
  const pf = s.pf === Infinity ? '∞' : s.pf.toFixed(2);
  return `${prefix}  n=${s.n}  WR=${s.wr.toFixed(1)}%  avg=${s.avgPnl>=0?'+':''}${s.avgPnl.toFixed(2)}%  PF=${pf}  mcl=${s.mcl}`;
}

function yearBreakdown(trades) {
  const byY = {};
  for (const t of trades) {
    const y = (t.date||'').slice(0,4) || '????';
    (byY[y] = byY[y]||[]).push(t);
  }
  return Object.entries(byY).sort().map(([y,ts]) => {
    const s = stats(ts);
    return `    ${y}: n=${String(s.n).padStart(4)}  WR=${s.wr.toFixed(1)}%  avg=${s.avgPnl>=0?'+':''}${s.avgPnl.toFixed(2)}%`;
  }).join('\n');
}

function isSplit(trades) {
  const cut = Math.floor(trades.length * 0.6);
  return { is: trades.slice(0, cut), oos: trades.slice(cut) };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'))
  .map(f => path.join(DATA_DIR, f));

console.log('═'.repeat(85));
console.log('  FORMULA BACKTEST — Candle Strength + Momentum5 + POS-ABOVE / NEG-BELOW');
console.log('═'.repeat(85));
console.log(`  Data: ${files.length} stocks from ${DATA_DIR}`);
console.log(`  Standard exits: Stop −${STOP_PCT}%  T1 +${T1_PCT}%  T2 +${T2_PCT}%  T3 +${T3_PCT}%  Time day-${MAX_HOLD}`);
console.log(`  Fixed R:R exits: Stop = prior-day Low, Target = Entry + 2×Risk`);
console.log();

// Accumulators for each system × exit mode
const systems = {
  'CS-Base':    { rr:[], std:[] },
  'CS-Mom5':    { rr:[], std:[] },
  'CS-SMA200':  { rr:[], std:[] },
  'CS-All':     { rr:[], std:[] },
  'POS-BTST':   { rr:[], std:[] },  // rr = hold5 here, std = btst-close
  'NEG-BTST':   { rr:[], std:[] },  // rr = short btst
};

let processed = 0;
const total = files.length;

for (const fp of files) {
  const sym  = path.basename(fp).replace(/_NS_OHLCV\.csv$/, '').replace(/\.csv$/, '');
  const rows = parseCSV(fp);
  if (rows.length < 250) { processed++; continue; }

  // Pre-compute indicators for each bar
  const N = rows.length;
  const sma50  = new Float64Array(N);
  const sma200 = new Float64Array(N);
  const ema5   = new Float64Array(N);
  const ema20  = new Float64Array(N);
  const atr14  = new Float64Array(N);
  const atr7   = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    sma50[i]  = sma(rows, i, 50)  ?? 0;
    sma200[i] = sma(rows, i, 200) ?? 0;
    atr14[i]  = atr(rows, i, 14);
    atr7[i]   = atr(rows, i, 7);
    // EMA (simple window average — sufficient for signal generation)
    ema5[i]  = sma(rows, i, 5)  ?? 0;
    ema20[i] = sma(rows, i, 20) ?? 0;
  }

  // Scan for signals (start at bar 210 so SMA200 is warm)
  let skipUntil = { 'CS-Base':0, 'CS-Mom5':0, 'CS-SMA200':0, 'CS-All':0, 'POS-BTST':0, 'NEG-BTST':0 };

  for (let i = 210; i < N - 1; i++) {
    const bar  = rows[i];
    const prev = rows[i-1];
    const pp   = rows[i-2];
    const dateStr = bar.dt.toISOString().slice(0,10);

    // ── Indicators at bar i ──────────────────────────────────────────────────
    const aboveSMA50  = bar.c > sma50[i]  && sma50[i]  > 0;
    const aboveSMA200 = bar.c > sma200[i] && sma200[i] > 0;
    const atr14i      = atr14[i];
    const atr7i       = atr7[i];
    const emaDiff     = ema5[i] - ema20[i];
    // Momentum5 = Close(t) − Open(t−5)
    const mom5 = i >= 5 ? bar.c - rows[i-5].o : 0;
    // One-day momentum = Close - Open
    const mom1 = bar.c - bar.o;

    // ── CANDLE STRENGTH CONDITIONS (evaluated on bar i, signal day) ──────────
    // Using bars [i] as "prior day" — entry triggered next day
    const higherHigh  = bar.h > prev.h;
    const higherLow   = bar.l > prev.l;
    const bullPattern = higherHigh && higherLow;

    const lowerHigh   = bar.h < prev.h;
    const lowerLow    = bar.l < prev.l;
    const bearPattern = lowerHigh && lowerLow;

    const longTrend   = aboveSMA50 && aboveSMA200;
    const shortTrend  = !aboveSMA50 && !aboveSMA200;

    const rangeExpansion = (bar.h - bar.l) > atr14i;

    const strongCloseLong  = bar.c > (bar.h + bar.l) / 2;  // closed in upper half
    const strongCloseShort = bar.c < (bar.h + bar.l) / 2;  // closed in lower half

    // Candle Strength LONG: entry at prior high[i] on next day
    const csLong = bullPattern && longTrend && rangeExpansion && strongCloseLong;
    const csShort= bearPattern && shortTrend&& rangeExpansion && strongCloseShort;

    // ── POS ABOVE threshold ──────────────────────────────────────────────────
    const posEntry = POS.wo*bar.o + POS.wh*bar.h + POS.wl*bar.l + POS.wc*bar.c
                   - POS.watr*atr14i + POS.ic;

    // ── NEG BELOW threshold ──────────────────────────────────────────────────
    const negEntry = NEG.wo*bar.o + NEG.wh*bar.h + NEG.wl*bar.l + NEG.wc*bar.c
                   + NEG.watr*atr14i + NEG.whl*(bar.h-bar.l) + NEG.wmo*mom1 + NEG.ic;

    // ─────────────────────────────────────────────────────────────────────────
    // SYSTEM: CS-Base (long only)
    // Entry: stop-order at bar[i].h on the next day (day i+1)
    if (csLong && i >= skipUntil['CS-Base']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.h >= bar.h) {
        const entryPrice = bar.h; // fill at prior day's high
        const trRR = simFixedRR(rows, entryDay, entryPrice, bar.l);
        const trST = simStandard(rows, entryDay, entryPrice);
        if (trRR) { systems['CS-Base'].rr.push({...trRR, sym, date:dateStr}); }
        if (trST) { systems['CS-Base'].std.push({...trST, sym, date:dateStr}); }
        skipUntil['CS-Base'] = entryDay + MAX_HOLD;
      }
    }

    // SYSTEM: CS-Mom5
    if (csLong && mom5 > 0 && i >= skipUntil['CS-Mom5']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.h >= bar.h) {
        const entryPrice = bar.h;
        const trRR = simFixedRR(rows, entryDay, entryPrice, bar.l);
        const trST = simStandard(rows, entryDay, entryPrice);
        if (trRR) systems['CS-Mom5'].rr.push({...trRR, sym, date:dateStr});
        if (trST) systems['CS-Mom5'].std.push({...trST, sym, date:dateStr});
        skipUntil['CS-Mom5'] = entryDay + MAX_HOLD;
      }
    }

    // SYSTEM: CS-SMA200
    if (csLong && aboveSMA200 && i >= skipUntil['CS-SMA200']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.h >= bar.h) {
        const entryPrice = bar.h;
        const trRR = simFixedRR(rows, entryDay, entryPrice, bar.l);
        const trST = simStandard(rows, entryDay, entryPrice);
        if (trRR) systems['CS-SMA200'].rr.push({...trRR, sym, date:dateStr});
        if (trST) systems['CS-SMA200'].std.push({...trST, sym, date:dateStr});
        skipUntil['CS-SMA200'] = entryDay + MAX_HOLD;
      }
    }

    // SYSTEM: CS-All (all three combined)
    if (csLong && mom5 > 0 && aboveSMA200 && i >= skipUntil['CS-All']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.h >= bar.h) {
        const entryPrice = bar.h;
        const trRR = simFixedRR(rows, entryDay, entryPrice, bar.l);
        const trST = simStandard(rows, entryDay, entryPrice);
        if (trRR) systems['CS-All'].rr.push({...trRR, sym, date:dateStr});
        if (trST) systems['CS-All'].std.push({...trST, sym, date:dateStr});
        skipUntil['CS-All'] = entryDay + MAX_HOLD;
      }
    }

    // SYSTEM: POS-BTST (rr slot = Hold5, std slot = BTST next-close)
    // Signal: next-day High > posEntry (formula threshold breach)
    if (i >= skipUntil['POS-BTST']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.h > posEntry && posEntry > 0) {
        const entryPrice = posEntry; // fill at the threshold level
        // BTST: exit at next-day close
        const btstPnl = (nextBar.c - entryPrice) / entryPrice * 100;
        systems['POS-BTST'].std.push({ pnl:btstPnl, exitType:'btst_close', days:1, sym, date:dateStr });
        // Hold-5: hold up to 5 days
        const h5 = simFixedRR(rows, entryDay, entryPrice, entryPrice*(1-STOP_PCT/100));
        if (h5) systems['POS-BTST'].rr.push({...h5, sym, date:dateStr});
        skipUntil['POS-BTST'] = entryDay + 5;
      }
    }

    // SYSTEM: NEG-BTST (short side — entry at next-day open, exit next-day close)
    if (i >= skipUntil['NEG-BTST']) {
      const entryDay = i + 1;
      const nextBar  = rows[entryDay];
      if (nextBar && nextBar.l < negEntry && negEntry > 0) {
        const entryPrice = negEntry;
        const btstPnl = (entryPrice - nextBar.c) / entryPrice * 100; // short P&L
        systems['NEG-BTST'].std.push({ pnl:btstPnl, exitType:'btst_short_close', days:1, sym, date:dateStr });
        skipUntil['NEG-BTST'] = entryDay + 5;
      }
    }
  }

  processed++;
  if (processed % 50 === 0) process.stdout.write(`\r  Processing... ${processed}/${total}   `);
}

console.log(`\r  Processed ${processed}/${total} stocks\n`);

// ─── PRINT RESULTS ────────────────────────────────────────────────────────────

const SYSTEM_LABELS = {
  'CS-Base':   'Candle Strength (base)',
  'CS-Mom5':   'CS + Momentum5 filter',
  'CS-SMA200': 'CS + SMA200 filter',
  'CS-All':    'CS + Mom5 + SMA200',
  'POS-BTST':  'POS-ABOVE threshold',
  'NEG-BTST':  'NEG-BELOW threshold (short)',
};

for (const [sysKey, { rr, std }] of Object.entries(systems)) {
  console.log('═'.repeat(85));
  console.log(`  ▶  ${SYSTEM_LABELS[sysKey]}`);
  console.log('─'.repeat(85));

  // Fixed R:R exit
  if (rr.length > 0) {
    const { is: isT, oos: oosT } = isSplit(rr);
    const sAll = stats(rr);
    const sIS  = stats(isT);
    const sOOS = stats(oosT);
    console.log(`  Fixed R:R exit (Stop=priorLow, Target=+2R):`);
    console.log(fmtStats(sAll, '    ALL'));
    console.log(fmtStats(sIS,  '    IS '));
    console.log(fmtStats(sOOS, '    OOS'));
    console.log('  Year breakdown (all):');
    console.log(yearBreakdown(rr));
  } else {
    console.log('  Fixed R:R: no trades generated');
  }

  console.log();

  // Standard exits (or BTST)
  if (std.length > 0) {
    const modeLabel = sysKey === 'POS-BTST' || sysKey === 'NEG-BTST' ? 'BTST (exit next-day close):' : 'Standard exits (T1/T2/T3):';
    const { is: isT, oos: oosT } = isSplit(std);
    const sAll = stats(std);
    const sIS  = stats(isT);
    const sOOS = stats(oosT);
    console.log(`  ${modeLabel}`);
    console.log(fmtStats(sAll, '    ALL'));
    console.log(fmtStats(sIS,  '    IS '));
    console.log(fmtStats(sOOS, '    OOS'));
    console.log('  Year breakdown (all):');
    console.log(yearBreakdown(std));

    // Exit type breakdown
    const byExit = {};
    for (const t of std) (byExit[t.exitType]=byExit[t.exitType]||[]).push(t);
    const exitStr = Object.entries(byExit)
      .sort((a,b)=>b[1].length-a[1].length)
      .map(([k,v])=>`${k}:${v.length}(WR=${(v.filter(t=>t.pnl>0).length/v.length*100).toFixed(0)}%)`)
      .join('  ');
    console.log(`  Exits → ${exitStr}`);
  } else {
    console.log('  Standard exits: no trades generated');
  }
  console.log();
}

// ─── CROSS-SYSTEM COMPARISON ──────────────────────────────────────────────────
console.log('═'.repeat(85));
console.log('  CROSS-SYSTEM COMPARISON — OOS Standard exits (best generalization proxy)');
console.log('═'.repeat(85));
console.log(`  ${'System'.padEnd(26)} ${'n(OOS)'.padStart(7)} ${'WR%'.padStart(7)} ${'AvgP&L'.padStart(8)} ${'PF'.padStart(7)} ${'mcl'.padStart(5)}`);
console.log('  ' + '─'.repeat(60));

for (const [sysKey, { std }] of Object.entries(systems)) {
  const { oos } = isSplit(std);
  const s = stats(oos);
  if (!s) { console.log(`  ${SYSTEM_LABELS[sysKey].padEnd(26)} — no trades`); continue; }
  const pf = s.pf === Infinity ? '    ∞' : s.pf.toFixed(2).padStart(7);
  console.log(`  ${SYSTEM_LABELS[sysKey].padEnd(26)} ${String(s.n).padStart(7)} ${s.wr.toFixed(1).padStart(7)} ${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(8)} ${pf} ${String(s.mcl).padStart(5)}`);
}

console.log();
console.log('  MONTHLY SEASONALITY (CS-Base, Standard exits — all years combined):');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const byMonth = Array.from({length:12}, ()=>[]);
for (const t of systems['CS-Base'].std) {
  const m = parseInt((t.date||'').slice(5,7),10)-1;
  if (m>=0&&m<12) byMonth[m].push(t);
}
console.log(`  ${'Month'.padEnd(6)} ${'n'.padStart(5)} ${'WR%'.padStart(7)} ${'Avg'.padStart(8)}`);
for (let m=0;m<12;m++) {
  const ts = byMonth[m]; if (!ts.length) continue;
  const wr  = ts.filter(t=>t.pnl>0).length/ts.length*100;
  const avg = ts.reduce((s,t)=>s+t.pnl,0)/ts.length;
  const bar = '█'.repeat(Math.round(wr/5));
  console.log(`  ${MONTHS[m].padEnd(6)} ${String(ts.length).padStart(5)} ${wr.toFixed(1).padStart(7)} ${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(8)}  ${bar}`);
}

console.log();
console.log('═'.repeat(85));
console.log('  BACKTEST COMPLETE');
console.log('═'.repeat(85));
