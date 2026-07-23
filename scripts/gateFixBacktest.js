// Gate Fix Backtest — runs 40 backup trades through the FIXED autoValidator.js
// Fetches candle data from Yahoo Finance, compares NEW vs STORED outcomes
// Run: node scripts/gateFixBacktest.js

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const { validateTrade } = require('./_compiled_current/autoValidator.js');
const BACKUP_PATH = 'C:/Users/drkkr/Downloads/DrKKR_Trades_Backup_2026-07-23.json';
const CSV_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';

// ─── CSV loader (local candle cache) ────────────────────────────────────────
function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const [date, o, h, lo, cl, v] = p;
    const [d, m, y] = date.split('-');
    const M = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    if (!M.hasOwnProperty(m)) continue;
    const ts = new Date(+y, M[m], +d).getTime() / 1000;
    c.push({ ts, o:+o, h:+h, l:+lo, c:+cl, v:+v, d: date });
  }
  return c.sort((a, b) => a.ts - b.ts);
}

// ─── Yahoo Finance fetcher ───────────────────────────────────────────────────
function fetchYahoo(symbol, startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = json?.chart?.result?.[0];
          if (!result) { resolve([]); return; }
          const ts = result.timestamp ?? [];
          const q = result.indicators?.quote?.[0] ?? {};
          const candles = [];
          for (let i = 0; i < ts.length; i++) {
            const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
            if (!h || !l || !c) continue;
            const dateStr = new Date(ts[i] * 1000).toISOString().slice(0, 10);
            candles.push({ ts: ts[i], o: o ?? c, h, l, c, v: v ?? 0, d: dateStr });
          }
          resolve(candles.sort((a, b) => a.ts - b.ts));
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
  });
}

// ─── Build candle array: local CSV if available, else Yahoo Finance ──────────
async function getCandles(symbol, startDate) {
  const bare = symbol.replace('.NS', '').replace('.BO', '');
  const csvPath = path.join(CSV_DIR, `${bare}_NS_OHLCV.csv`);
  let allCandles = [];

  if (fs.existsSync(csvPath)) {
    allCandles = parseCSV(csvPath);
  } else {
    // Fetch 60 days before entry for ATR seeding + 35 days after
    const from = offsetDate(startDate, -60);
    const to = offsetDate(startDate, 35);
    allCandles = await fetchYahoo(symbol, from, to);
  }

  if (allCandles.length === 0) return null;

  // Find entry date index
  const entryTs = new Date(startDate).getTime() / 1000;
  const entryIdx = allCandles.findIndex(c => c.ts >= entryTs - 43200); // within 12h
  if (entryIdx < 0) return null;

  // Prepend up to 20 pre-entry candles for ATR seeding, then entry onwards
  const preStart = Math.max(0, entryIdx - 20);
  return allCandles.slice(preStart);
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Status display helpers ──────────────────────────────────────────────────
function outcomeLabel(status) {
  if (!status) return 'open';
  return {
    stopped:      'STOPPED',
    hit_t1:       'T1',
    hit_t2:       'T2',
    hit_t3:       'T3',
    closed_early: 'CLOSED',
    open:         'OPEN',
  }[status] ?? status.toUpperCase();
}

function changed(oldStatus, newStatus) {
  if (!oldStatus || oldStatus === 'open' || oldStatus === 'closed_early') return false;
  return outcomeLabel(oldStatus) !== outcomeLabel(newStatus);
}

// ─── Main backtest ───────────────────────────────────────────────────────────
async function main() {
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  console.log(`\n${'═'.repeat(90)}`);
  console.log('  GATE FIX BACKTEST — Fixed autoValidator.js on 40 Live Trades');
  console.log(`${'═'.repeat(90)}`);
  console.log(`  Backup: ${backup.length} trades | Comparing OLD stored outcomes vs NEW fixed gates\n`);

  const results = [];
  let fetched = 0, skipped = 0;

  for (const trade of backup) {
    const sym = trade.symbol;
    const entryDate = trade.entryDate;
    if (!entryDate || !trade.entryPrice) { skipped++; continue; }

    process.stdout.write(`  [${String(fetched + skipped + 1).padStart(2)}] ${sym.padEnd(18)} entry=${entryDate} ... `);

    const candles = await getCandles(sym, entryDate);
    if (!candles || candles.length < 3) {
      process.stdout.write('NO DATA\n');
      skipped++;
      continue;
    }

    // Find which index is actually the entry date (may be offset by pre-entry candles)
    const entryTs = new Date(entryDate).getTime() / 1000;
    const entryOffset = candles.findIndex(c => c.ts >= entryTs - 43200);

    // Build a minimal trade object for the validator
    const tradeInput = {
      symbol: sym,
      entryDate: entryDate,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      target1: trade.target1,
      target2: trade.target2,
      target3: trade.target3,
      sw5LowAtEntry: trade.stopLoss * 1.003, // approximate: use initial stop as proxy
    };

    // entryDate in backup = signal detection date (T+0 close).
    // The trade executes at T+1 open, so monitoring starts from the NEXT session.
    // Pass candles from entryOffset+1 onwards so i=0 = first full trading day after entry.
    const monitorStart = entryOffset >= 0 ? entryOffset + 1 : 1;
    const candlesSinceEntry = candles.slice(monitorStart);

    const newResult = validateTrade(tradeInput, candlesSinceEntry);
    const newStatus = newResult.status;
    const oldStatus = trade.status;

    const isChanged = changed(oldStatus, newStatus);
    const flag = isChanged ? ' ◄ CHANGED' : '';

    const oldLabel = outcomeLabel(oldStatus);
    const newLabel = outcomeLabel(newStatus);
    const gateCount = newResult.gateLog?.length ?? 0;

    process.stdout.write(
      `OLD=${oldLabel.padEnd(7)} NEW=${newLabel.padEnd(7)} pnlR=${
        newResult.pnlR?.toFixed(2)?.padStart(5) ?? '  n/a'
      } days=${String(newResult.daysHeld ?? 0).padStart(2)} gates=${gateCount}${flag}\n`
    );

    fetched++;
    results.push({
      symbol: sym, entryDate, oldStatus, newStatus,
      oldPnlR: trade.pnlR,
      newPnlR: newResult.pnlR,
      oldPnlPct: trade.pnlPct,
      newPnlPct: newResult.pnlPct,
      daysHeld: newResult.daysHeld,
      gateLog: newResult.gateLog,
      changed: isChanged,
      conviction: trade.conviction,
      sector: trade.sector,
    });

    // Small delay to avoid Yahoo rate limiting
    await new Promise(r => setTimeout(r, 120));
  }

  // ─── Summary statistics ───────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(90)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(90)}`);
  console.log(`  Trades analysed: ${fetched} | Skipped (no data): ${skipped}`);

  const closed = results.filter(r => r.oldStatus && r.oldStatus !== 'open');
  const oldStopped   = closed.filter(r => r.oldStatus === 'stopped').length;
  const newStopped   = results.filter(r => r.newStatus === 'stopped').length;
  const oldWins      = closed.filter(r => r.oldStatus !== 'stopped' && r.oldStatus !== 'closed_early').length;
  const newWins      = results.filter(r => ['hit_t1','hit_t2','hit_t3'].includes(r.newStatus)).length;
  const changed_list = results.filter(r => r.changed);

  const oldWinRate = closed.length ? (oldWins / closed.length * 100).toFixed(1) : 'n/a';
  const newDecided = results.filter(r => r.newStatus !== 'open');
  const newWinRate = newDecided.length ? (newWins / newDecided.length * 100).toFixed(1) : 'n/a';

  console.log(`\n  STOP RATE:  OLD=${(oldStopped / closed.length * 100).toFixed(1)}%  NEW=${newDecided.length ? (newStopped / newDecided.length * 100).toFixed(1) : 'n/a'}%`);
  console.log(`  WIN RATE:   OLD=${oldWinRate}%  NEW=${newWinRate}%`);
  console.log(`  Changed outcomes: ${changed_list.length}`);

  // ─── Changed trades detail ────────────────────────────────────────────────
  if (changed_list.length > 0) {
    console.log(`\n${'─'.repeat(90)}`);
    console.log('  CHANGED OUTCOMES (old → new):');
    console.log(`${'─'.repeat(90)}`);
    for (const r of changed_list) {
      const pnlDiff = (r.newPnlR ?? 0) - (r.oldPnlR ?? 0);
      const dir = pnlDiff > 0 ? '▲' : pnlDiff < 0 ? '▼' : '=';
      console.log(
        `  ${r.symbol.padEnd(18)} ${outcomeLabel(r.oldStatus).padEnd(8)}→ ${outcomeLabel(r.newStatus).padEnd(8)}` +
        `  pnlR: ${(r.oldPnlR ?? 0).toFixed(2)}→${(r.newPnlR ?? 0).toFixed(2)} (${dir}${Math.abs(pnlDiff).toFixed(2)}R)` +
        `  days=${r.daysHeld}`
      );
      // Show the gate that made the difference
      const lastGate = r.gateLog?.[r.gateLog.length - 1];
      if (lastGate) {
        const finalGate = lastGate.gatesTested?.[lastGate.gatesTested.length - 1];
        if (finalGate) {
          console.log(`    └─ Day ${lastGate.day}: ${finalGate.gate} — ${finalGate.reason?.slice(0, 80)}`);
        }
      }
    }
  }

  // ─── Gate trigger breakdown ───────────────────────────────────────────────
  console.log(`\n${'─'.repeat(90)}`);
  console.log('  GATE TRIGGER BREAKDOWN (across all shield events):');
  console.log(`${'─'.repeat(90)}`);
  const gateCounts = {};
  for (const r of results) {
    for (const entry of (r.gateLog ?? [])) {
      if (entry.result !== 'SHIELDED') continue;
      const g = entry.gatesTested?.find(g => g.passed);
      if (g) {
        gateCounts[g.gate] = (gateCounts[g.gate] ?? 0) + 1;
      }
    }
  }
  const sortedGates = Object.entries(gateCounts).sort((a, b) => b[1] - a[1]);
  if (sortedGates.length === 0) {
    console.log('  No shields triggered.');
  } else {
    for (const [gate, count] of sortedGates) {
      console.log(`  ${gate.padEnd(32)} ${count} shields`);
    }
  }

  // ─── P&L distribution (new) ───────────────────────────────────────────────
  console.log(`\n${'─'.repeat(90)}`);
  console.log('  NEW P&L DISTRIBUTION (closed trades):');
  console.log(`${'─'.repeat(90)}`);
  const buckets = { 'T3 (>2R)':0, 'T2 (1-2R)':0, 'T1 (0-1R)':0, 'Hollow (0-0.3R)':0, 'BE (near 0)':0, 'Loss (<0)':0 };
  for (const r of results) {
    const R = r.newPnlR ?? 0;
    if (r.newStatus === 'open') continue;
    if (R > 2) buckets['T3 (>2R)']++;
    else if (R > 1) buckets['T2 (1-2R)']++;
    else if (R > 0.3) buckets['T1 (0-1R)']++;
    else if (R > 0.05) buckets['Hollow (0-0.3R)']++;
    else if (R >= -0.1) buckets['BE (near 0)']++;
    else buckets['Loss (<0)']++;
  }
  for (const [b, n] of Object.entries(buckets)) {
    const bar = '█'.repeat(n);
    console.log(`  ${b.padEnd(18)} ${String(n).padStart(3)} ${bar}`);
  }

  // ─── R-multiple comparison ────────────────────────────────────────────────
  const closedResults = results.filter(r => r.newStatus !== 'open');
  if (closedResults.length > 0) {
    const avgOldR = results.filter(r => r.oldPnlR != null).reduce((s, r) => s + (r.oldPnlR ?? 0), 0) /
                    results.filter(r => r.oldPnlR != null).length;
    const avgNewR = closedResults.reduce((s, r) => s + (r.newPnlR ?? 0), 0) / closedResults.length;
    console.log(`\n  Avg R-Multiple:  OLD=${avgOldR.toFixed(2)}R  NEW=${avgNewR.toFixed(2)}R`);
  }

  console.log(`\n${'═'.repeat(90)}\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
