'use strict';
// WR OPTIMIZER — push each param set towards 80% OOS win rate
// Uses _compiled_proposed (v11) as base, grid-searches key params per set
// One worker per param set (5 parallel). Min 10 OOS trades.
// Run: node scripts/wrOptimizer.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled_proposed');
const OUT_FILE   = path.join(__dirname, 'wrOptimizer_results.txt');

const DATE_FROM  = '2019-01-01';
const STOP_PCT   = 7;
const T1_PCT     = 5;
const T2_PCT     = 10;
const T3_PCT     = 15;
const MAX_HOLD   = 20;
const MIN_OOS_N  = 10;   // minimum OOS trades to consider a combo valid

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// ─── SEARCH GRIDS (per set, 3 key params × 3-4 values = ~27-64 combos each) ─
const GRIDS = {
  optimized_deployable_20plus: {
    maxPre10RedVolBias:  [1.00, 1.10, 1.20, 1.30, 1.50],
    minCloseLoc:         [55, 60, 65, 70],
    maxUpperWickPct:     [15, 18, 20, 22],
  },
  optimized_highprecision_15plus: {
    maxATRPct14Pctl120:  [60, 65, 70, 75, 80],
    maxPre10RedVolBias:  [1.05, 1.10, 1.15, 1.30, 1.50],
    maxUpperWickPct:     [20, 25, 30, 35],
    minCloseLoc:         [55, 58, 60, 65],
  },
  optimized_elite_10plus: {
    maxPre10RedVolBias:  [1.00, 1.05, 1.10, 1.20],
    minCloseLoc:         [45, 50, 55, 60],
    minBodyPct:          [20, 25, 30, 35],
    maxZoneTightnessPct: [10, 12, 15, 18],
  },
  optimized_ultraselective_8plus: {
    minCloseLoc:         [45, 50, 55, 60, 65, 70],
    minExactRangeATR14:  [0.6, 0.8, 1.0, 1.2, 1.4, 1.6],
    minBodyPct:          [15, 20, 25, 30, 35, 40],
  },
  sniper_95plus: {
    maxPre10RedVolBias:         [0.75, 0.80, 0.85, 0.90, 0.95],
    minCloseLoc:                [60, 65, 70, 75],
    minVolatilityExpansionRatio:[1.5, 1.8, 2.0, 2.5],
  },
};

// Generate all combinations for a grid
function gridCombos(grid) {
  const keys   = Object.keys(grid);
  const values = keys.map(k => grid[k]);
  const combos = [];
  function recurse(i, cur) {
    if (i === keys.length) { combos.push({ ...cur }); return; }
    for (const v of values[i]) { cur[keys[i]] = v; recurse(i+1, cur); }
  }
  recurse(0, {});
  return combos;
}

// ─── WORKER ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { paramSetKey, combos, files, engineDir, dateFrom, stopPct, t1Pct, t2Pct, t3Pct, maxHold } = workerData;

  const engineMod  = require(path.join(engineDir, 'stockEngine.js'));
  const analyzeStock = engineMod.analyzeStock;
  const PARAM_SETS   = engineMod.PARAM_SETS;

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
      if (iso < dateFrom || ts === 0) continue;
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
    const stop=ep*(1-stopPct/100), t1=ep*(1+t1Pct/100), t2=ep*(1+t2Pct/100), t3=ep*(1+t3Pct/100);
    let t1Hit=false, t2Hit=false, trail=stop;
    for (let d=0; d<maxHold; d++) {
      const ci=idx+d;
      if (ci>=candles.length) {
        const cp=(candles[candles.length-1].c-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*cp };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*cp };
        return { pnl:cp };
      }
      const bar=candles[ci], open=bar.o>0?bar.o:bar.c;
      if (open<=trail) {
        const fp=(open-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*fp };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*fp };
        return { pnl:fp };
      }
      if (bar.l<=trail) {
        const fp=(trail-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*fp };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*fp };
        return { pnl:fp };
      }
      if (t2Hit && bar.h>=t3) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*t3Pct };
      if (t1Hit && !t2Hit && bar.h>=t2) { t2Hit=true; trail=t1; }
      if (!t1Hit && bar.h>=t1) { t1Hit=true; trail=ep; }
      if (d===maxHold-1) {
        const cp=(bar.c-ep)/ep*100;
        if (t2Hit) return { pnl:0.5*t1Pct+0.3*t2Pct+0.2*cp };
        if (t1Hit) return { pnl:0.5*t1Pct+0.5*cp };
        return { pnl:cp };
      }
    }
    return null;
  }

  // Pre-load all candles once
  const allCandles = [];
  for (const fp of files) {
    const c = parseCSV(fp);
    if (c.length >= 100) allCandles.push(c);
  }

  // Save original params
  const orig = { ...PARAM_SETS[paramSetKey] };

  const results = [];

  for (let ci = 0; ci < combos.length; ci++) {
    const override = combos[ci];

    // Apply override
    Object.assign(PARAM_SETS[paramSetKey], orig, override);

    // Collect trades
    const trades = [];
    for (const candles of allCandles) {
      let i = 60;
      while (i < candles.length - 1) {
        let r;
        try { r = analyzeStock(candles.slice(Math.max(0, i-299), i+1), paramSetKey); } catch { i++; continue; }
        if (ACTIONABLE.has(r.stage)) {
          const t = simulateTrade(candles, i+1);
          if (t) { trades.push({ date: candles[i].date, pnl: t.pnl }); i += maxHold; continue; }
        }
        i++;
      }
    }

    // IS/OOS split
    trades.sort((a,b) => a.date.localeCompare(b.date));
    if (trades.length < 4) { if (ci % 10 === 0) parentPort.postMessage({ type:'progress', ci, total:combos.length }); continue; }
    const cut  = trades[Math.floor(trades.length * 0.6)].date;
    const is   = trades.filter(t => t.date < cut);
    const oos  = trades.filter(t => t.date >= cut);
    if (oos.length < MIN_OOS_N) { if (ci % 10 === 0) parentPort.postMessage({ type:'progress', ci, total:combos.length }); continue; }

    const oosWins = oos.filter(t => t.pnl > 0).length;
    const oosWR   = oosWins / oos.length * 100;
    const oosGross = oos.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const oosLoss  = Math.abs(oos.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
    const oosPF    = oosLoss > 0 ? oosGross/oosLoss : oosGross > 0 ? 99 : 0;
    const isWins   = is.filter(t => t.pnl > 0).length;
    const isWR     = is.length ? isWins/is.length*100 : 0;

    results.push({ override, isN:is.length, isWR, oosN:oos.length, oosWR, oosPF });

    if (ci % 10 === 0) parentPort.postMessage({ type:'progress', ci, total:combos.length });
  }

  // Restore
  Object.assign(PARAM_SETS[paramSetKey], orig);

  parentPort.postMessage({ type:'done', paramSetKey, results });
  return;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('❌  _compiled_proposed/stockEngine.js not found.'); process.exit(1);
}

const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'))
  .map(f => path.join(DATA_DIR, f));

console.log('═'.repeat(80));
console.log('  WR OPTIMIZER — targeting 80% OOS win rate per param set');
console.log('═'.repeat(80));
console.log(`📁  ${DATA_DIR}  (${allFiles.length} CSVs)`);
console.log(`🔢  Min OOS trades: ${MIN_OOS_N}  |  Base: v11 proposed params`);
console.log();

const PARAM_SET_KEYS = Object.keys(GRIDS);
const LABELS = {
  optimized_deployable_20plus:    'Deployable',
  optimized_highprecision_15plus: 'HiPrec',
  optimized_elite_10plus:         'Elite',
  optimized_ultraselective_8plus: 'Ultra',
  sniper_95plus:                  'Sniper',
};

const startTime = Date.now();
const allResults = {};

// Run param sets sequentially — avoids RAM exhaustion from 5× parallel CSV loads
function runNext(idx) {
  if (idx >= PARAM_SET_KEYS.length) { printResults(); return; }
  const key    = PARAM_SET_KEYS[idx];
  const combos = gridCombos(GRIDS[key]);
  console.log(`\n  ▶ ${LABELS[key]} — ${combos.length} combos`);

  const w = new Worker(__filename, {
    workerData: {
      paramSetKey: key,
      combos,
      files: allFiles,
      engineDir: ENGINE_DIR,
      dateFrom: DATE_FROM,
      stopPct: STOP_PCT, t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD,
    }
  });

  w.on('message', msg => {
    if (msg.type === 'progress') {
      process.stdout.write(`\r    ${msg.ci}/${msg.total} combos tested...   `);
    } else if (msg.type === 'done') {
      allResults[msg.paramSetKey] = msg.results;
      console.log(`\r  ✅ ${LABELS[key]} done — ${msg.results.length} valid combos (≥${MIN_OOS_N} OOS trades)`);
      runNext(idx + 1);
    }
  });
  w.on('error', e => {
    console.error(`\n❌ Worker error (${LABELS[key]}):`, e.message);
    allResults[key] = [];
    runNext(idx + 1);
  });
}

runNext(0);

function printResults() {
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✅  All done in ${elapsed} min\n`);

  const lines = [];
  const out = s => { lines.push(s); console.log(s); };

  out('═'.repeat(100));
  out('  WR OPTIMIZER RESULTS — TOP 5 COMBOS PER PARAM SET (sorted by OOS WR)');
  out('  Min OOS trades: ' + MIN_OOS_N + '  |  Base: v11 params  |  IS/OOS: 60/40');
  out('═'.repeat(100));

  for (const key of PARAM_SET_KEYS) {
    const results = allResults[key] || [];
    const sorted  = results.sort((a,b) => b.oosWR - a.oosWR);
    const top5    = sorted.slice(0, 5);
    const label   = LABELS[key];

    out('');
    out(`┌─ ${label.toUpperCase()} — ${results.length} valid combos (≥${MIN_OOS_N} OOS trades) ─────────────────────────`);

    if (!top5.length) {
      out(`│  ⚠️  No combos met the minimum ${MIN_OOS_N} OOS trade threshold`);
      out(`└${'─'.repeat(80)}`);
      continue;
    }

    // Header
    const paramKeys = Object.keys(GRIDS[key]);
    const paramHdr  = paramKeys.map(k => k.replace('max','').replace('min','').replace('Pre10','').padEnd(14)).join(' │ ');
    out(`│  ${paramHdr} │ IS N │ IS WR │ OOS N │ OOS WR │ OOS PF │`);
    out(`│  ${'─'.repeat(paramKeys.length * 17 + 40)}`);

    for (const r of top5) {
      const paramVals = paramKeys.map(k => String(r.override[k]).padEnd(14)).join(' │ ');
      const star = r.oosWR >= 80 ? ' ⭐' : r.oosWR >= 70 ? ' ✅' : '';
      out(`│  ${paramVals} │ ${String(r.isN).padStart(4)} │ ${r.isWR.toFixed(1).padStart(4)}% │ ${String(r.oosN).padStart(5)} │ ${r.oosWR.toFixed(1).padStart(5)}%${star} │ ${r.oosPF.toFixed(2).padStart(5)}  │`);
    }

    // Best overall
    const best = top5[0];
    out(`│`);
    out(`│  🏆 BEST OOS WR: ${best.oosWR.toFixed(1)}%  (PF ${best.oosPF.toFixed(2)}, n=${best.oosN})`);
    out(`│  📋 PARAMS: ${paramKeys.map(k => `${k}=${best.override[k]}`).join(', ')}`);
    out(`└${'─'.repeat(80)}`);
  }

  out('');
  out('═'.repeat(100));
  out('  RECOMMENDED FINAL PARAMS (best OOS WR with sufficient trades)');
  out('═'.repeat(100));
  out('');

  for (const key of PARAM_SET_KEYS) {
    const results = allResults[key] || [];
    const sorted  = results.sort((a,b) => b.oosWR - a.oosWR);
    // Prefer highest WR that has ≥ 15 trades, else best available
    const best = sorted.find(r => r.oosN >= 15) || sorted[0];
    if (!best) { out(`  ${LABELS[key]}: no valid combo found`); continue; }
    const params = Object.keys(GRIDS[key]).map(k => `${k}: ${best.override[k]}`).join(' | ');
    out(`  ${LABELS[key].padEnd(12)}: OOS WR ${best.oosWR.toFixed(1)}%  PF ${best.oosPF.toFixed(2)}  n=${best.oosN}`);
    out(`  ${''.padEnd(12)}  ${params}`);
    out('');
  }

  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log(`\n📄  Results → ${OUT_FILE}`);
}
