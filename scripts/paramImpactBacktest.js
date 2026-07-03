'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// PARAM IMPACT BACKTEST — CURRENT vs PROPOSED (multi-worker)
// Run: node scripts/paramImpactBacktest.js
// ═══════════════════════════════════════════════════════════════════════════════

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR  = path.join(__dirname, '_compiled');
const SUMMARY_OUT = path.join(__dirname, 'paramImpact_summary.txt');
const N_WORKERS   = 8;

const DATE_FROM = '2019-01-01';
const STOP_PCT  = 7;
const T1_PCT    = 5;
const T2_PCT    = 10;
const T3_PCT    = 15;
const MAX_HOLD  = 20;
const IS_SPLIT_PCT = 0.60;

const PARAM_SET_KEYS = [
  'optimized_deployable_20plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  // HiPrec excluded — generates 1600+ signals per run causing extreme runtime
];

const LABELS = {
  optimized_deployable_20plus:    'Deployable',
  optimized_highprecision_15plus: 'HiPrec',
  optimized_elite_10plus:         'Elite',
  optimized_ultraselective_8plus: 'Ultra',
  sniper_95plus:                  'Sniper',
};

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// Proposed overrides — keyed by param set
const PROPOSED_OVERRIDES = {
  optimized_deployable_20plus: {
    maxPre10RedVolBias:          1.30,
    minExactVolRatio20:          1.20,
    maxUpperWickPct:             18,
    minCloseLoc:                 65,
    maxPre10HighVolCount:        2,
    maxCloseAboveZonePct:        4.0,
  },
  optimized_highprecision_15plus: {
    maxPre10RedVolBias:          1.15,
    minVolatilityExpansionRatio: 1.50,
    maxUpperWickPct:             25,
    minCloseLoc:                 60,
    minZoneLen:                  7,
    maxATRPct14Pctl120:          65,
  },
  optimized_elite_10plus: {
    maxPre10RedVolBias:          1.10,
    minVolatilityExpansionRatio: 1.40,
    minCloseLoc:                 55,
    minBodyPct:                  35,
    maxZoneTightnessPct:         12,
    maxPre10ExpansionCount:      2,
    minZoneLen:                  8,
    maxCloseAboveZonePct:        8.0,
  },
  optimized_ultraselective_8plus: {
    maxPre10RedVolBias:          1.00,
    minExactVolRatio20:          1.20,
    minExactRangeATR14:          1.60,
    maxUpperWickPct:             15,
    minCloseLoc:                 70,
    minBodyPct:                  40,
    minZoneLen:                  10,
    maxCloseAboveZonePct:        3.0,
  },
  sniper_95plus: {
    maxPre10RedVolBias:          0.90,
    minVolatilityExpansionRatio: 2.00,
    maxUpperWickPct:             20,
    minCloseLoc:                 75,
    maxCloseAboveZonePct:        5.0,
  },
};

// ─── WORKER ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, engineDir, dateFrom, stopPct, t1Pct, t2Pct, t3Pct, maxHold,
          paramOverrides } = workerData;

  const engineModule = require(path.join(engineDir, 'stockEngine.js'));
  const analyzeStock = engineModule.analyzeStock;
  const PARAM_SETS   = engineModule.PARAM_SETS;

  // Save originals and apply overrides
  const originals = {};
  for (const key of Object.keys(paramOverrides)) {
    originals[key] = {};
    for (const p of Object.keys(paramOverrides[key])) {
      originals[key][p] = PARAM_SETS[key][p];
      PARAM_SETS[key][p] = paramOverrides[key][p];
    }
  }

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
    const candles = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const { iso, ts } = parseDate(p[iDate]?.trim() ?? '');
      if (iso < dateFrom || ts === 0) continue;
      const c = +p[iClose], o = +p[iOpen]||c, h = +p[iHigh]||c, l = +p[iLow]||c, v = +p[iVol]||0;
      if (isNaN(c) || c <= 0) continue;
      candles.push({ ts, date: iso, o, h, l, c, v });
    }
    return candles;
  }

  function simulateTrade(candles, idx) {
    if (idx >= candles.length) return null;
    const ep = candles[idx].o > 0 ? candles[idx].o : candles[idx].c;
    if (ep <= 0) return null;
    const stop=ep*(1-stopPct/100), t1=ep*(1+t1Pct/100), t2=ep*(1+t2Pct/100), t3=ep*(1+t3Pct/100);
    let t1Hit=false, t2Hit=false, trail=stop;
    for (let d=0; d<maxHold; d++) {
      const ci = idx+d;
      if (ci >= candles.length) {
        const cp = (candles[candles.length-1].c - ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*cp, exitType:'time_t2', days:d };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*cp, exitType:'time_t1', days:d };
        return { pnl:cp, exitType:'time', days:d };
      }
      const bar=candles[ci], open=bar.o>0?bar.o:bar.c;
      if (open<=trail) {
        const fp=(open-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*fp, exitType:'stop_gap_t2', days:d };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*fp, exitType:'stop_gap_t1', days:d };
        return { pnl:fp, exitType:'stop_gap', days:d };
      }
      if (bar.l<=trail) {
        const fp=(trail-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*fp, exitType:'stop_t2', days:d };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*fp, exitType:'stop_t1', days:d };
        return { pnl:fp, exitType:'stop', days:d };
      }
      if (t2Hit && bar.h>=t3) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*t3Pct, exitType:'t3', days:d+1 };
      if (t1Hit && !t2Hit && bar.h>=t2) { t2Hit=true; trail=t1; }
      if (!t1Hit && bar.h>=t1) { t1Hit=true; trail=ep; }
      if (d===maxHold-1) {
        const cp=(bar.c-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*cp, exitType:'time_t2', days:d+1 };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*cp, exitType:'time_t1', days:d+1 };
        return { pnl:cp, exitType:'time', days:d+1 };
      }
    }
    return null;
  }

  // Run CURRENT (originals already saved — PARAM_SETS now has proposed values)
  // We need to run CURRENT first, so reset to originals
  for (const key of Object.keys(originals)) {
    for (const p of Object.keys(originals[key])) {
      PARAM_SETS[key][p] = originals[key][p];
    }
  }

  function runScan(label) {
    const trades = {};
    for (const key of PARAM_SET_KEYS) trades[key] = [];
    let done = 0;
    for (const fp of files) {
      const sym     = path.basename(fp).replace(/_NS_OHLCV\.csv$/,'').replace(/\.csv$/,'');
      const candles = parseCSV(fp);
      if (candles.length >= 100) {
        for (const key of PARAM_SET_KEYS) {
          let i = 60;
          let callCount = 0;
          const maxCalls = candles.length * 2; // safety cap — never more than 2× candle count
          while (i < candles.length - 1 && callCount < maxCalls) {
            let r;
            callCount++;
            try { r = analyzeStock(candles.slice(Math.max(0, i-299), i+1), key); } catch { i++; continue; }
            if (ACTIONABLE.has(r.stage)) {
              const t = simulateTrade(candles, i+1);
              if (t) { trades[key].push({ sym, date: candles[i].date, ...t }); i += maxHold; continue; }
            }
            i++;
          }
        }
      }
      done++;
      if (done % 20 === 0) parentPort.postMessage({ type: 'progress', label, done, total: files.length });
    }
    return trades;
  }

  const currentTrades = runScan('CURRENT');

  // Now apply proposed overrides
  for (const key of Object.keys(paramOverrides)) {
    for (const p of Object.keys(paramOverrides[key])) {
      PARAM_SETS[key][p] = paramOverrides[key][p];
    }
  }

  const proposedTrades = runScan('PROPOSED');

  parentPort.postMessage({ type: 'done', currentTrades, proposedTrades });
  return;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('❌  Compiled engine not found.'); process.exit(1);
}

const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

console.log('═'.repeat(80));
console.log('  PARAM IMPACT BACKTEST — CURRENT vs PROPOSED | NIFTY 500');
console.log('═'.repeat(80));
console.log(`📁  ${DATA_DIR}`);
console.log(`📊  ${allFiles.length} CSVs  |  ${N_WORKERS} workers  |  IS/OOS 60/40`);
console.log(`🎯  Stop −${STOP_PCT}%  T1 +${T1_PCT}%  T2 +${T2_PCT}%  T3 +${T3_PCT}%  Hold ${MAX_HOLD}d`);
console.log();

// Split files across workers
const chunks = Array.from({ length: N_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % N_WORKERS].push(f));

const startTime = Date.now();
let workersLeft = N_WORKERS;
const allCurrentTrades  = {};
const allProposedTrades = {};
for (const k of PARAM_SET_KEYS) { allCurrentTrades[k] = []; allProposedTrades[k] = []; }

const workers = chunks.map((files, wi) => {
  const w = new Worker(__filename, {
    workerData: {
      files, engineDir: ENGINE_DIR,
      dateFrom: DATE_FROM, stopPct: STOP_PCT,
      t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD,
      paramOverrides: PROPOSED_OVERRIDES,
    }
  });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      process.stdout.write(`\r  Worker ${wi+1}: [${msg.label}] ${msg.done}/${msg.total}   `);
    } else if (msg.type === 'done') {
      for (const k of PARAM_SET_KEYS) {
        allCurrentTrades[k].push(...msg.currentTrades[k]);
        allProposedTrades[k].push(...msg.proposedTrades[k]);
      }
      workersLeft--;
      if (workersLeft === 0) printResults();
    }
  });
  w.on('error', e => { console.error(`Worker ${wi} error:`, e); workersLeft--; });
  return w;
});

function calcStats(trades) {
  if (!trades.length) return { n:0, wr:0, pf:0, avgPnl:0 };
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const gross  = wins.reduce((s,t) => s+t.pnl, 0);
  const loss   = Math.abs(losses.reduce((s,t) => s+t.pnl, 0));
  return {
    n:      trades.length,
    wr:     wins.length / trades.length * 100,
    pf:     loss > 0 ? gross/loss : gross > 0 ? 99 : 0,
    avgPnl: trades.reduce((s,t) => s+t.pnl, 0) / trades.length,
  };
}

function splitISOS(trades) {
  const sorted = [...trades].sort((a,b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { is:[], oos:[] };
  const cutoff = sorted[Math.floor(sorted.length * IS_SPLIT_PCT)].date;
  return { is: sorted.filter(t => t.date < cutoff), oos: sorted.filter(t => t.date >= cutoff) };
}

function printResults() {
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n\n✅  Done in ${elapsed} min\n`);

  const lines = [];
  const out = s => { lines.push(s); console.log(s); };

  out('═'.repeat(112));
  out('  CURRENT vs PROPOSED — OOS RESULTS (NIFTY 500)');
  out('═'.repeat(112));
  out('');
  out('  Set          │ Cur IS WR │ Cur OOS WR │ Cur OOS PF │ Prop IS WR │ Prop OOS WR │ Prop OOS PF │  ΔWR   │  ΔPF  │ Verdict');
  out('  ─────────────┼───────────┼────────────┼────────────┼────────────┼─────────────┼─────────────┼────────┼───────┼────────');

  const summary = {};
  for (const key of PARAM_SET_KEYS) {
    const label = LABELS[key];
    const { is: cIS, oos: cOOS } = splitISOS(allCurrentTrades[key]);
    const { is: pIS, oos: pOOS } = splitISOS(allProposedTrades[key]);
    const cIs  = calcStats(cIS);
    const cOos = calcStats(cOOS);
    const pIs  = calcStats(pIS);
    const pOos = calcStats(pOOS);
    summary[key] = { label, cIs, cOos, pIs, pOos };

    const dWR = pOos.wr - cOos.wr;
    const dPF = pOos.pf - cOos.pf;
    const verdict = dWR > 4 && dPF > 0.3  ? '✅ CLEAR WIN'
                  : dWR > 1.5 && dPF > 0  ? '✅ WIN'
                  : dWR > 0 && dPF > 0    ? '🟡 MARGINAL'
                  : dWR < -3 || dPF < -0.3 ? '❌ WORSE'
                  : '🟠 MIXED';

    const p  = s => String(s).padStart(6);
    const pf = v => v.toFixed(2).padStart(6);
    const pw = v => v.toFixed(1).padStart(5) + '%';

    out(`  ${label.padEnd(13)} │   ${pw(cIs.wr)}  │    ${pw(cOos.wr)}  │    ${pf(cOos.pf)}  │   ${pw(pIs.wr)}  │     ${pw(pOos.wr)}  │     ${pf(pOos.pf)}  │ ${(dWR>=0?'+':'')+dWR.toFixed(1)}% │ ${(dPF>=0?'+':'')+dPF.toFixed(2)} │ ${verdict}`);
  }

  out('');
  out('═'.repeat(112));
  out('  TRADE COUNT COMPARISON');
  out('═'.repeat(112));
  out('');
  out('  Set          │ Cur IS N │ Cur OOS N │ Prop IS N │ Prop OOS N │  ΔN (OOS) │ Selectivity');
  out('  ─────────────┼──────────┼───────────┼───────────┼────────────┼───────────┼────────────');
  for (const key of PARAM_SET_KEYS) {
    const { label, cIs, cOos, pIs, pOos } = summary[key];
    const dN  = pOos.n - cOos.n;
    const pct = cOos.n > 0 ? (dN / cOos.n * 100).toFixed(0) : '—';
    const sel = dN < 0 ? `More selective (${pct}% fewer signals)` : dN > 0 ? `More permissive (+${pct}%)` : 'Same';
    out(`  ${label.padEnd(13)} │ ${String(cIs.n).padStart(8)} │ ${String(cOos.n).padStart(9)} │ ${String(pIs.n).padStart(9)} │ ${String(pOos.n).padStart(10)} │ ${(dN>=0?'+':'')+String(dN).padStart(9)} │ ${sel}`);
  }

  out('');
  out('═'.repeat(112));
  out('  KEY CHANGES APPLIED');
  out('═'.repeat(112));
  const changes = [
    ['Deployable', 'maxRedVolBias 2.0→1.30 | minVolRatio20 0.7→1.2 | maxUpperWick 22→18 | minCloseLoc 55→65 | maxHighVolCount 4→2 | +maxChaseAboveZone 4%'],
    ['HiPrec',     'maxRedVolBias 2.0→1.15 | minVER 0.75→1.50 | maxUpperWick 40→25 | minCloseLoc 55→60 | minZoneLen 5→7 | maxATRPctl 85→65'],
    ['Elite',      'maxRedVolBias 2.0→1.10 | minVER 0.60→1.40 | minCloseLoc 35→55 | minBodyPct 10→35 | maxZoneTight 20→12 | maxExpansions 3→2 | +maxChaseAboveZone 8%'],
    ['Ultra',      'maxRedVolBias 2.0→1.00 | minVolRatio20 1.1→1.2 | minERA 0.4→1.6 | maxUpperWick 25→15 | minCloseLoc 30→70 | minBodyPct 5→40 | +maxChaseAboveZone 3%'],
    ['Sniper',     'maxRedVolBias 2.0→0.90 | minVER 0.70→2.00 | maxUpperWick 50→20 | minCloseLoc 55→75 | +maxChaseAboveZone 5%'],
  ];
  out('');
  for (const [lbl, ch] of changes) out(`  ${lbl.padEnd(12)}: ${ch}`);
  out('');

  fs.writeFileSync(SUMMARY_OUT, lines.join('\n'), 'utf8');
  console.log(`\n📄  Summary → ${SUMMARY_OUT}`);
}
