'use strict';
// Backtest v11 proposed params against NIFTY 500
// Uses _compiled_proposed/ engine (v11 params baked in)
// Run: node scripts/proposedBacktest.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR  = path.join(__dirname, '_compiled_proposed');
const RESULTS_FILE = path.join(__dirname, 'proposed_results.json');
const SUMMARY_FILE = path.join(__dirname, 'proposed_summary.txt');
const N_WORKERS   = 8;

const DATE_FROM = '2019-01-01';
const STOP_PCT  = 7;
const T1_PCT    = 5;
const T2_PCT    = 10;
const T3_PCT    = 15;
const MAX_HOLD  = 20;

const PARAM_SET_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const LABELS = {
  optimized_deployable_20plus:    'Deployable v11',
  optimized_highprecision_15plus: 'HiPrec v11',
  optimized_elite_10plus:         'Elite v11',
  optimized_ultraselective_8plus: 'Ultra v11',
  sniper_95plus:                  'Sniper v11',
};
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// ─── WORKER ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, config } = workerData;
  const { analyzeStock } = require(path.join(config.engineDir, 'stockEngine.js'));

  const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  function parseDate(s) {
    s = s.trim();
    if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
      const [d, mon, y] = s.split('-');
      const iso = `${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
      return { iso, ts: Math.floor(new Date(iso).getTime()/1000) };
    }
    const ts = Math.floor(new Date(s).getTime()/1000);
    return { iso: s, ts: isNaN(ts) ? 0 : ts };
  }

  function parseCSV(fp) {
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    if (lines.length < 2) return [];
    const hdr    = lines[0].split(',').map(h => h.trim().toLowerCase());
    const iDate  = hdr.indexOf('date');
    const iOpen  = hdr.indexOf('open');
    const iHigh  = hdr.indexOf('high');
    const iLow   = hdr.indexOf('low');
    const iClose = hdr.findIndex(h => h === 'close' || h === 'adj close');
    const iVol   = hdr.findIndex(h => h === 'volume');
    if (iClose < 0 || iVol < 0) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const { iso, ts } = parseDate(p[iDate]?.trim() ?? '');
      if (iso < config.dateFrom || ts === 0) continue;
      const c = +p[iClose], o = +p[iOpen]||c, h = +p[iHigh]||c, l = +p[iLow]||c, v = +p[iVol]||0;
      if (isNaN(c) || c <= 0) continue;
      out.push({ ts, date: iso, o, h, l, c, v });
    }
    return out;
  }

  function simulateTrade(candles, idx) {
    if (idx >= candles.length) return null;
    const ep = candles[idx].o > 0 ? candles[idx].o : candles[idx].c;
    if (ep <= 0) return null;
    const stop=ep*(1-config.stopPct/100), t1=ep*(1+config.t1Pct/100),
          t2=ep*(1+config.t2Pct/100), t3=ep*(1+config.t3Pct/100);
    let t1Hit=false, t2Hit=false, trail=stop;
    for (let d=0; d<config.maxHold; d++) {
      const ci=idx+d;
      if (ci>=candles.length) {
        const cp=(candles[candles.length-1].c-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*config.t1Pct+0.3*config.t2Pct+0.2*cp, exitType:'time_t2', days:d };
        if (t1Hit) return { pnl:0.5*config.t1Pct+0.5*cp, exitType:'time_t1', days:d };
        return { pnl:cp, exitType:'time', days:d };
      }
      const bar=candles[ci], open=bar.o>0?bar.o:bar.c;
      if (open<=trail) {
        const fp=(open-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*config.t1Pct+0.3*config.t2Pct+0.2*fp, exitType:'stop_gap_t2', days:d };
        if (t1Hit) return { pnl:0.5*config.t1Pct+0.5*fp, exitType:'stop_gap_t1', days:d };
        return { pnl:fp, exitType:'stop_gap', days:d };
      }
      if (bar.l<=trail) {
        const fp=(trail-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*config.t1Pct+0.3*config.t2Pct+0.2*fp, exitType:'stop_t2', days:d };
        if (t1Hit) return { pnl:0.5*config.t1Pct+0.5*fp, exitType:'stop_t1', days:d };
        return { pnl:fp, exitType:'stop', days:d };
      }
      if (t2Hit && bar.h>=t3) return { pnl:0.5*config.t1Pct+0.3*config.t2Pct+0.2*config.t3Pct, exitType:'t3', days:d+1 };
      if (t1Hit && !t2Hit && bar.h>=t2) { t2Hit=true; trail=t1; }
      if (!t1Hit && bar.h>=t1) { t1Hit=true; trail=ep; }
      if (d===config.maxHold-1) {
        const cp=(bar.c-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*config.t1Pct+0.3*config.t2Pct+0.2*cp, exitType:'time_t2', days:d+1 };
        if (t1Hit) return { pnl:0.5*config.t1Pct+0.5*cp, exitType:'time_t1', days:d+1 };
        return { pnl:cp, exitType:'time', days:d+1 };
      }
    }
    return null;
  }

  const trades = {};
  for (const k of PARAM_SET_KEYS) trades[k] = [];

  let done = 0;
  for (const fp of files) {
    const sym     = path.basename(fp).replace(/_NS_OHLCV\.csv$/,'').replace(/\.csv$/,'');
    const candles = parseCSV(fp);
    if (candles.length >= 100) {
      for (const key of PARAM_SET_KEYS) {
        let i = 60;
        while (i < candles.length - 1) {
          let r;
          try { r = analyzeStock(candles.slice(Math.max(0, i-299), i+1), key); } catch { i++; continue; }
          if (ACTIONABLE.has(r.stage)) {
            const t = simulateTrade(candles, i+1);
            if (t) { trades[key].push({ sym, date: candles[i].date, stage: r.stage, ...t }); i += config.maxHold; continue; }
          }
          i++;
        }
      }
    }
    done++;
    if (done % 10 === 0) parentPort.postMessage({ type: 'progress', done, total: files.length });
  }
  parentPort.postMessage({ type: 'done', trades });
  return;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('❌  _compiled_proposed/stockEngine.js not found. Did compilation succeed?');
  process.exit(1);
}

const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'))
  .map(f => path.join(DATA_DIR, f));

console.log('═'.repeat(80));
console.log('  PROPOSED v11 PARAMS BACKTEST — NIFTY 500');
console.log('═'.repeat(80));
console.log(`📁  ${DATA_DIR}`);
console.log(`📊  ${allFiles.length} CSVs  |  ${N_WORKERS} workers`);
console.log(`🎯  Stop −${STOP_PCT}%  T1 +${T1_PCT}%  T2 +${T2_PCT}%  T3 +${T3_PCT}%  Hold ${MAX_HOLD}d`);
console.log();

const chunks = Array.from({ length: N_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % N_WORKERS].push(f));

const config = { engineDir: ENGINE_DIR, dateFrom: DATE_FROM, stopPct: STOP_PCT, t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD };

const startTime = Date.now();
let workersLeft = N_WORKERS;
let totalDone = 0;
const allTrades = {};
for (const k of PARAM_SET_KEYS) allTrades[k] = [];

chunks.map((files, wi) => {
  const w = new Worker(__filename, { workerData: { files, config } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      totalDone += msg.done - (totalDone % Math.ceil(allFiles.length / N_WORKERS) || 0);
      process.stdout.write(`\r  Progress: ~${Math.min(100, Math.round(totalDone / allFiles.length * 100))}%   `);
    } else if (msg.type === 'done') {
      for (const k of PARAM_SET_KEYS) allTrades[k].push(...msg.trades[k]);
      workersLeft--;
      if (workersLeft === 0) finish();
    }
  });
  w.on('error', e => { console.error(`Worker ${wi} error:`, e.message); workersLeft--; if (workersLeft===0) finish(); });
});

function calcStats(trades) {
  if (!trades.length) return { n:0, wr:0, pf:0, avgPnl:0, expectancy:0 };
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const gross  = wins.reduce((s,t) => s+t.pnl, 0);
  const loss   = Math.abs(losses.reduce((s,t) => s+t.pnl, 0));
  const wr     = wins.length / trades.length;
  const avgW   = wins.length   ? gross / wins.length : 0;
  const avgL   = losses.length ? loss  / losses.length : 0;
  return {
    n:          trades.length,
    wr:         wr * 100,
    pf:         loss > 0 ? gross/loss : gross > 0 ? 99 : 0,
    avgPnl:     trades.reduce((s,t) => s+t.pnl, 0) / trades.length,
    expectancy: (wr * avgW) - ((1-wr) * avgL),
  };
}

function finish() {
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n\n✅  Done in ${elapsed} min\n`);

  // IS = before cutoff (60%), OOS = after
  function splitISOS(trades) {
    const sorted = [...trades].sort((a,b) => a.date.localeCompare(b.date));
    if (!sorted.length) return { is:[], oos:[] };
    const cut = sorted[Math.floor(sorted.length * 0.6)].date;
    return { is: sorted.filter(t => t.date < cut), oos: sorted.filter(t => t.date >= cut) };
  }

  const lines = [];
  const out = s => { lines.push(s); console.log(s); };

  // Also load current v10 summary for comparison
  const v10File = path.join(__dirname, 'backtest1980_summary.txt');
  const hasV10  = fs.existsSync(v10File);

  out('═'.repeat(90));
  out('  v11 PROPOSED PARAMS — FULL RESULTS (NIFTY 500, IS 60% / OOS 40%)');
  out('═'.repeat(90));
  out('');
  out('  Set            │   N  │ IS WR  │ IS PF  │ IS AvgPnL │ OOS N │ OOS WR │ OOS PF │ OOS AvgPnL │ Expectancy');
  out('  ──────────────────────────────────────────────────────────────────────────────────────────────────────');

  const summary = {};
  for (const key of PARAM_SET_KEYS) {
    const { is, oos } = splitISOS(allTrades[key]);
    const isS  = calcStats(is);
    const oosS = calcStats(oos);
    summary[key] = { isS, oosS };
    const lbl = LABELS[key].padEnd(14);
    out(`  ${lbl} │ ${String(isS.n).padStart(4)} │ ${isS.wr.toFixed(1).padStart(5)}% │ ${isS.pf.toFixed(2).padStart(5)} │ ${isS.avgPnl.toFixed(2).padStart(8)}% │ ${String(oosS.n).padStart(5)} │ ${oosS.wr.toFixed(1).padStart(5)}% │ ${oosS.pf.toFixed(2).padStart(5)} │ ${oosS.avgPnl.toFixed(2).padStart(9)}% │ ${oosS.expectancy.toFixed(2).padStart(9)}%`);
  }

  out('');
  out('═'.repeat(90));
  out('  OOS IS/OOS DEGRADATION (lower = less overfit)');
  out('═'.repeat(90));
  out('');
  out('  Set            │ IS WR  │ OOS WR │  ΔWR   │ IS PF  │ OOS PF │  ΔPF  │ Overfit?');
  out('  ───────────────────────────────────────────────────────────────────────────────');
  for (const key of PARAM_SET_KEYS) {
    const { isS, oosS } = summary[key];
    const dWR = oosS.wr - isS.wr;
    const dPF = oosS.pf - isS.pf;
    const overfit = dWR < -10 ? '🔴 HIGH' : dWR < -5 ? '🟠 MODERATE' : dWR < 0 ? '🟡 LOW' : '✅ NONE';
    const lbl = LABELS[key].padEnd(14);
    out(`  ${lbl} │ ${isS.wr.toFixed(1).padStart(5)}% │ ${oosS.wr.toFixed(1).padStart(5)}% │ ${(dWR>=0?'+':'')+dWR.toFixed(1).padStart(5)}% │ ${isS.pf.toFixed(2).padStart(5)} │ ${oosS.pf.toFixed(2).padStart(5)} │ ${(dPF>=0?'+':'')+dPF.toFixed(2).padStart(5)} │ ${overfit}`);
  }

  out('');
  out('═'.repeat(90));
  out('  EXIT TYPE BREAKDOWN (OOS trades only)');
  out('═'.repeat(90));
  out('');
  out('  Set            │  T3  │  T2  │  T1  │ Stop │ Time │ Stop% │ T3 rate');
  out('  ────────────────────────────────────────────────────────────────────');
  for (const key of PARAM_SET_KEYS) {
    const { is, oos } = splitISOS(allTrades[key]);
    const counts = { t3:0, t2:0, t1:0, stop:0, time:0 };
    for (const t of oos) {
      if (t.exitType?.startsWith('t3'))   counts.t3++;
      else if (t.exitType?.startsWith('t2') || t.exitType?.includes('_t2')) counts.t2++;
      else if (t.exitType?.startsWith('t1') || t.exitType?.includes('_t1')) counts.t1++;
      else if (t.exitType?.startsWith('stop')) counts.stop++;
      else counts.time++;
    }
    const n = oos.length || 1;
    const lbl = LABELS[key].padEnd(14);
    out(`  ${lbl} │ ${String(counts.t3).padStart(4)} │ ${String(counts.t2).padStart(4)} │ ${String(counts.t1).padStart(4)} │ ${String(counts.stop).padStart(4)} │ ${String(counts.time).padStart(4)} │ ${(counts.stop/n*100).toFixed(0).padStart(4)}% │ ${(counts.t3/n*100).toFixed(0).padStart(6)}%`);
  }

  out('');
  out('═'.repeat(90));
  out('  YEARLY BREAKDOWN (OOS trades by year)');
  out('═'.repeat(90));
  const years = ['2022','2023','2024','2025','2026'];
  out('');
  out(`  Set            │ ${'Year'.padEnd(6)} │   N  │  WR   │  PF`);
  out('  ────────────────────────────────────────');
  for (const key of PARAM_SET_KEYS) {
    const { oos } = splitISOS(allTrades[key]);
    const lbl = LABELS[key].padEnd(14);
    let first = true;
    for (const yr of years) {
      const yt = oos.filter(t => t.date?.startsWith(yr));
      if (!yt.length) continue;
      const s = calcStats(yt);
      out(`  ${first ? lbl : ' '.repeat(14)} │ ${yr}  │ ${String(s.n).padStart(4)} │ ${s.wr.toFixed(1).padStart(4)}% │ ${s.pf.toFixed(2)}`);
      first = false;
    }
    out('  ' + '─'.repeat(45));
  }

  out('');
  out('  Key thresholds: OOS WR > 55% = good | PF > 1.2 = edge | ΔWR < −8% = overfit concern');
  out('');

  fs.writeFileSync(SUMMARY_FILE, lines.join('\n'), 'utf8');
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(allTrades, null, 2), 'utf8');
  console.log(`📄  Summary → ${SUMMARY_FILE}`);
  console.log(`📊  Trades  → ${RESULTS_FILE}`);
}
