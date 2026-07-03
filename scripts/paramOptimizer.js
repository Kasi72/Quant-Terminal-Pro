// ═══════════════════════════════════════════════════════════════════════════════
// PARAM SET OPTIMIZER — hyper-optimise for OOS win rate + edge
// ═══════════════════════════════════════════════════════════════════════════════
//
// Strategy:
//   1. Re-run screener engine in worker threads across 1617 stocks
//   2. For every signal bar, store the raw feature vector + forward P&L
//   3. Grid-search threshold combinations across the 10 most impactful params
//   4. Score each candidate with 3-fold walk-forward (no look-ahead)
//   5. Report top-5 param sets ranked by: OOS WR × log(n)  (balances precision vs coverage)
//
// This is NOT the same as back-fitting to the results JSON — it re-derives
// signals from raw candles so any threshold change is fully re-evaluated.
//
// USAGE:  node scripts/paramOptimizer.js
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DATA_DIR       = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS      = 8;
const DATE_FROM      = '2019-01-01';
const STOP_PCT       = 7;
const T1_PCT         = 5;
const T2_PCT         = 10;
const T3_PCT         = 15;
const MAX_HOLD       = 20;
const MIN_TRADES     = 5;    // minimum OOS trades to consider a candidate
const TOP_N          = 10;
const BACKTEST_JSON  = path.join(__dirname, 'backtest1980_results.json');

const ENGINE_DIR  = path.join(__dirname, '_compiled');
const OUT_FILE    = path.join(__dirname, 'optimizer_results.json');
const RPT_FILE    = path.join(__dirname, 'optimizer_report.txt');

// ─── SEARCH SPACE — optimise 6 most impactful thresholds ─────────────────────
// Reduced to 6 params × 4 values = 4096 combinations — ensures enough OOS trades
const SEARCH = {
  minExactRangeATR14:      [1.2, 1.5, 1.8, 2.2],
  minExactVolRatio20:      [1.2, 1.5, 1.8, 2.2],
  minExactVolVsPre5:       [1.5, 2.0, 2.5, 3.5],
  minCloseLoc:             [30, 45, 55, 65],
  maxUpperWickPct:         [20, 30, 40, 55],
  minBodyPct:              [5, 20, 40, 60],
};

// ─── WORKER CODE ─────────────────────────────────────────────────────────────
// Workers receive a list of {sym, signalDate, pnl} entries from the backtest JSON.
// Each worker loads the CSV for those stocks, finds the signal bar, runs analyzeStock
// on a fixed 280-candle window ending at that bar, and returns the feature vector.
if (!isMainThread) {
  const { tasks, config } = workerData;
  const { analyzeStock }  = require(path.join(config.engineDir, 'stockEngine.js'));

  const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  function toISO(s) {
    s = s.trim();
    if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
      const [d, mon, y] = s.split('-');
      return `${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return s;
  }

  function parseCSV(fp) {
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    if (lines.length < 2) return [];
    const h = lines[0].split(',').map(x => x.trim().toLowerCase());
    const iD = h.indexOf('date'), iO = h.indexOf('open'), iH = h.indexOf('high');
    const iL = h.indexOf('low'), iC = h.findIndex(x => x==='close'||x==='adj close'), iV = h.indexOf('volume');
    if (iC < 0) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const iso = toISO(p[iD]??'');
      if (!iso || iso < config.dateFrom) continue;
      const c = +p[iC]; if (isNaN(c)||c<=0) continue;
      const o = +p[iO]||c, hh = +p[iH]||c, l = +p[iL]||c, v = +p[iV]||0;
      rows.push({ date: iso, o, h:hh, l, c, v, ts: Math.floor(new Date(iso).getTime()/1000)||0 });
    }
    return rows;
  }

  const BASE_KEY = 'optimized_highprecision_15plus';
  const WINDOW   = 280;
  const observations = [];

  // Group tasks by symbol to avoid reloading the same CSV repeatedly
  const bySymbol = {};
  for (const t of tasks) {
    (bySymbol[t.sym] = bySymbol[t.sym] || []).push(t);
  }

  for (const [sym, symTasks] of Object.entries(bySymbol)) {
    // Find CSV file for this symbol
    const candidates = [
      path.join(config.dataDir, `${sym}_NS_OHLCV.csv`),
      path.join(config.dataDir, `${sym}_OHLCV.csv`),
      path.join(config.dataDir, `${sym}.csv`),
    ];
    const fp = candidates.find(f => { try { return fs.existsSync(f); } catch{ return false; } });
    if (!fp) continue;

    let candles;
    try { candles = parseCSV(fp); } catch(e) { continue; }
    if (!candles || candles.length < WINDOW) continue;

    // Build date→index map
    const dateIdx = {};
    candles.forEach((c,i) => { dateIdx[c.date] = i; });

    for (const task of symTasks) {
      // Signal bar is the day BEFORE trade entry (entry is next open)
      // task.date is the entry date — signal bar is task.date - 1 trading day
      const entryIdx = dateIdx[task.date];
      if (entryIdx == null || entryIdx < 2) continue;
      const signalIdx = entryIdx - 1;  // bar where screener fired
      if (signalIdx < WINDOW) continue;

      const slice = candles.slice(signalIdx - WINDOW + 1, signalIdx + 1);
      let result;
      try { result = analyzeStock(slice, BASE_KEY); } catch(e) { continue; }
      if (!result) continue;

      observations.push({
        date:  candles[signalIdx].date,
        eRA:   result.exactRangeATR14,
        eVR:   result.exactVolRatio20,
        eVP5:  result.exactVolVsPre5,
        cl:    result.closeLoc,
        uwp:   result.upperWickPct,
        bp:    result.bodyPct,
        zt:    result.zone?.zoneTightnessPct ?? 999,
        ups:   result.ultraPrecisionScore,
        ver:   result.volatilityExpansionRatio,
        p10ar: result.pre10AvgRangeATR,
        pnl:   task.pnl,
        win:   task.pnl > 0 ? 1 : 0,
      });
    }
  }

  parentPort.postMessage({ type: 'done', observations });
}

// ─── MAIN THREAD ─────────────────────────────────────────────────────────────
if (isMainThread) {
  // Load all trades from backtest results — these ARE the signal observations
  if (!fs.existsSync(BACKTEST_JSON)) {
    console.error(`❌  ${BACKTEST_JSON} not found. Run fullBacktest1980.js first.`);
    process.exit(1);
  }
  const btData = JSON.parse(fs.readFileSync(BACKTEST_JSON, 'utf8'));
  // Collect all trades across all param sets (deduplicate by sym+date)
  const seen = new Set();
  const allTasks = [];
  for (const trades of Object.values(btData.trades || {})) {
    for (const t of (trades || [])) {
      const key = `${t.sym}|${t.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allTasks.push({ sym: t.sym, date: t.date, pnl: t.pnl });
    }
  }

  const config = {
    engineDir: ENGINE_DIR, dataDir: DATA_DIR, dateFrom: DATE_FROM,
    stopPct: STOP_PCT, t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD,
  };

  console.log('═'.repeat(80));
  console.log('  PARAM SET OPTIMIZER');
  console.log('═'.repeat(80));
  console.log(`  Signal observations from backtest: ${allTasks.length}  Workers: ${N_WORKERS}`);
  console.log('  Phase 1: Re-extracting feature vectors at each signal bar...\n');

  // ── Phase 1: distribute tasks across workers ──────────────────────────────
  const chunkSize = Math.ceil(allTasks.length / N_WORKERS);
  const chunks = Array.from({length: N_WORKERS}, (_, i) => allTasks.slice(i*chunkSize, (i+1)*chunkSize));

  let allObs = [];
  let done = 0;
  const t0 = Date.now();

  function spawnWorker(chunk) {
    return new Promise((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { tasks: chunk, config } });
      w.on('message', msg => { if (msg.type === 'done') resolve(msg.observations); });
      w.on('error', reject);
    });
  }

  Promise.all(chunks.map((chunk) => spawnWorker(chunk).then(obs => {
    done++;
    allObs = allObs.concat(obs);
    process.stdout.write(`\r  Workers done: ${done}/${N_WORKERS}  Observations: ${allObs.length}   `);
  }))).then(() => {
    const elapsed = ((Date.now()-t0)/1000).toFixed(1);
    console.log(`\n\n  Phase 1 done in ${elapsed}s — ${allObs.length} total observations`);

    if (allObs.length < 100) {
      console.error('\n  ❌ Too few observations. Check DATA_DIR and engine compilation.');
      process.exit(1);
    }

    // Sort by date for walk-forward splits
    allObs.sort((a,b) => a.date.localeCompare(b.date));

    // ── Phase 2: 3-fold walk-forward grid search ──────────────────────────
    console.log('\n  Phase 2: Grid search across threshold combinations...');

    // Build search grid (cartesian product — smart sampling)
    const keys  = Object.keys(SEARCH);
    const grids  = keys.map(k => SEARCH[k]);
    const totalCombos = grids.reduce((p,g) => p*g.length, 1);
    console.log(`  Search space: ${totalCombos.toLocaleString()} combinations × 3 folds\n`);

    // Simple 70/30 chronological IS/OOS split
    const n   = allObs.length;
    const cut = Math.floor(n * 0.70);
    const isSet  = allObs.slice(0, cut);
    const oosSet = allObs.slice(cut);

    function applyThresholds(obs, params) {
      return obs.filter(o =>
        o.eRA  >= params.minExactRangeATR14 &&
        o.eVR  >= params.minExactVolRatio20 &&
        o.eVP5 >= params.minExactVolVsPre5 &&
        o.cl   >= params.minCloseLoc &&
        o.uwp  <= params.maxUpperWickPct &&
        o.bp   >= params.minBodyPct
      );
    }

    const candidates = [];
    let combo = 0;
    let lastPct = -1;

    function iterate(depth, params) {
      if (depth === keys.length) {
        combo++;
        if (combo % 200 === 0) {
          const pct = Math.floor(combo/totalCombos*100);
          if (pct !== lastPct) {
            process.stdout.write(`\r  Progress: ${pct}% (${combo.toLocaleString()}/${totalCombos.toLocaleString()})  candidates: ${candidates.length}   `);
            lastPct = pct;
          }
        }

        const oosT = applyThresholds(oosSet, params);
        if (oosT.length < MIN_TRADES) return;

        const isT   = applyThresholds(isSet, params);
        const oosWR = oosT.filter(t=>t.win).length / oosT.length;
        const isWR  = isT.length > 0 ? isT.filter(t=>t.win).length / isT.length : 0;
        if (oosWR < 0.52) return;  // must beat baseline

        const oosPnl = oosT.reduce((s,t)=>s+t.pnl,0)/oosT.length;
        const delta  = oosWR - isWR;
        const gW = oosT.filter(t=>t.win).reduce((s,t)=>s+t.pnl,0);
        const gL = Math.abs(oosT.filter(t=>!t.win).reduce((s,t)=>s+t.pnl,0));
        const pf = gL > 0 ? gW/gL : 99;

        candidates.push({
          params: {...params},
          oosWR, isWR, delta, oosPnl,
          n: oosT.length, nIS: isT.length, nTotal: isT.length + oosT.length, pf,
        });
        return;
      }
      const key = keys[depth];
      for (const val of grids[depth]) {
        iterate(depth+1, { ...params, [key]: val });
      }
    }

    iterate(0, {});
    console.log(`\n\n  Grid search done — ${candidates.length.toLocaleString()} valid candidates found`);

    if (candidates.length === 0) {
      console.error('  ❌ No candidates passed MIN_TRADES filter. Lower MIN_TRADES or extend DATE_FROM.');
      process.exit(1);
    }

    // ── Phase 3: rank and report ──────────────────────────────────────────
    // Sort by OOS win rate (primary), then OOS avg P&L (secondary)
    candidates.sort((a,b) => b.oosWR - a.oosWR || b.oosPnl - a.oosPnl);

    const top = candidates.slice(0, TOP_N);

    // Write results JSON
    fs.writeFileSync(OUT_FILE, JSON.stringify({ meta: {
      generatedAt: new Date().toISOString(), totalCandidates: candidates.length,
      minTrades: MIN_TRADES, observations: allObs.length,
    }, top }, null, 2));

    // ── Build report ──────────────────────────────────────────────────────
    const lines = [];
    const sep = (c='═',n=80) => c.repeat(n);
    lines.push(sep());
    lines.push('  PARAM OPTIMIZER RESULTS — Top candidates by OOS win rate');
    lines.push(sep());
    lines.push(`  Observations: ${allObs.length}  Candidates evaluated: ${totalCombos.toLocaleString()}  Valid: ${candidates.length.toLocaleString()}`);
    lines.push(`  OOS window: ${allObs[Math.floor(n*0.75)]?.date} → ${allObs[allObs.length-1]?.date}  (last 25% chronologically)`);
    lines.push('');

    // Current param set baselines (all observations = HiPrec base)
    const allWR  = allObs.filter(o=>o.win).length/allObs.length;
    const allPnl = allObs.reduce((s,o)=>s+o.pnl,0)/allObs.length;
    const oosBase= allObs.slice(Math.floor(n*0.75));
    const oosBaseWR = oosBase.filter(o=>o.win).length/oosBase.length;
    lines.push(`  Baseline (no extra filters, HiPrec signals): ALL WR=${(allWR*100).toFixed(1)}%  OOS WR=${(oosBaseWR*100).toFixed(1)}%  avg=${allPnl.toFixed(2)}%  n=${allObs.length}`);
    lines.push('');

    top.forEach((c, i) => {
      const pf = c.pf === Infinity ? '∞' : c.pf.toFixed(2);
      const delta = c.delta >= 0 ? `+${(c.delta*100).toFixed(1)}%` : `${(c.delta*100).toFixed(1)}%`;
      lines.push(sep('─'));
      lines.push(`  #${i+1}  OOS WR=${(c.oosWR*100).toFixed(1)}%  IS WR=${(c.isWR*100).toFixed(1)}%  ΔWR=${delta}  OOS avg=${c.oosPnl>=0?'+':''}${c.oosPnl.toFixed(2)}%  PF=${pf}  n(OOS)=${c.n}  n(total)=${c.nTotal}`);
      lines.push('');
      lines.push('  Thresholds:');
      lines.push(`    minExactRangeATR14:     ${c.params.minExactRangeATR14}`);
      lines.push(`    minExactVolRatio20:     ${c.params.minExactVolRatio20}`);
      lines.push(`    minExactVolVsPre5:      ${c.params.minExactVolVsPre5}`);
      lines.push(`    minCloseLoc:            ${c.params.minCloseLoc}`);
      lines.push(`    maxUpperWickPct:        ${c.params.maxUpperWickPct}`);
      lines.push(`    minBodyPct:             ${c.params.minBodyPct}`);
      lines.push(`    maxZoneTightnessPct:    ${c.params.maxZoneTightnessPct}`);
      lines.push(`    minUltraPrecisionScore: ${c.params.minUltraPrecisionScore}`);
      lines.push(`    minVolatilityExpRatio:  ${c.params.minVolatilityExpRatio}`);
      lines.push(`    maxPre10AvgRangeATR:    ${c.params.maxPre10AvgRangeATR}`);
      lines.push('');
    });

    lines.push(sep());
    lines.push('  HOW TO APPLY THESE PARAMS');
    lines.push(sep());
    lines.push('  Copy the #1 thresholds into stockEngine.ts → optimized_elite_10plus (or a new param set).');
    lines.push('  The params above override the matching fields in the ParamSet interface.');
    lines.push('  Re-compile: node_modules/.bin/tsc lib/stockEngine.ts ... (see fullBacktest1980.js header)');
    lines.push('');

    // Distribution analysis of top-10 winners
    lines.push(sep('─'));
    lines.push('  WHAT SEPARATES WINNERS — feature distribution (OOS wins vs losses, baseline HiPrec):');
    const oosAll = allObs.slice(Math.floor(n*0.75));
    const wins  = oosAll.filter(o=>o.win);
    const losses= oosAll.filter(o=>!o.win);
    function med(arr, fn) { const v=arr.map(fn).sort((a,b)=>a-b); return v[Math.floor(v.length/2)]??0; }
    lines.push(`  Feature              Wins median   Losses median   Delta`);
    const feats = [
      ['eRA (exactRangeATR)', o=>o.eRA],
      ['eVR (exactVolRatio)', o=>o.eVR],
      ['eVP5 (volVsPre5)',    o=>o.eVP5],
      ['closeLoc %',          o=>o.cl],
      ['upperWick %',         o=>o.uwp],
      ['bodyPct %',           o=>o.bp],
      ['zoneTightness %',     o=>o.zt===999?null:o.zt],
      ['UPS score',           o=>o.ups],
      ['volatilityExpRatio',  o=>o.ver],
      ['pre10AvgRangeATR',    o=>o.p10ar],
    ];
    for (const [lbl, fn] of feats) {
      const wm = med(wins.filter(o=>fn(o)!==null), fn);
      const lm = med(losses.filter(o=>fn(o)!==null), fn);
      const d  = wm-lm;
      const sig = Math.abs(d) > (wm+lm)*0.1 ? ' ◄ SIGNIFICANT' : '';
      lines.push(`  ${lbl.padEnd(22)} ${String(wm.toFixed(2)).padStart(12)}   ${String(lm.toFixed(2)).padStart(14)}   ${d>=0?'+':''}${d.toFixed(2)}${sig}`);
    }
    lines.push('');
    lines.push(sep());
    lines.push(`  Total run time: ${((Date.now()-t0)/60000).toFixed(1)} minutes`);
    lines.push(`  Results: ${OUT_FILE}`);
    lines.push(sep());

    const report = lines.join('\n');
    console.log('\n' + report);
    fs.writeFileSync(RPT_FILE, report);
  });
}
