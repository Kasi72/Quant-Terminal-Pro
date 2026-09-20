'use strict';
// tp_sl_grid.js
// Grid search: optimize TP%, SL×ATR, maxHold per param set
// Workers collect raw signal bar-slices; main thread replays all combos in-memory.
// Grid: TP=[3,4,5,6,7,8,10,12,15]  SL=[1.5,2,2.5,3,4,5]  maxHold=[10,15,20]
// Output: scripts/results/tp_sl_grid.txt

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const WORKERS    = Number(process.env.WORKERS || Math.min(os.cpus().length, 12));
const OOS_START  = Date.parse('2023-01-01') / 1000;
const WINDOW     = 300;
const MIN_BARS   = 150;
const MAX_HOLD_STORE = 22; // store this many bars after signal (covers maxHold=20 + buffer)

// ─── param set config ────────────────────────────────────────────────────────
const ALL7 = [
  { key: 'optimized_deployable_20plus',    label: 'VF Scout',     baseTP: 8,  baseSL: 4.0, baseHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },
  { key: 'optimized_highprecision_15plus', label: 'CC Precision', baseTP: 5,  baseSL: 4.0, baseHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },
  { key: 'optimized_elite_10plus',         label: 'MP Elite',     baseTP: 5,  baseSL: 3.0, baseHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },
  { key: 'optimized_ultraselective_8plus', label: 'EMA Stack',    baseTP: 3,  baseSL: 4.0, baseHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },
  { key: 'sniper_95plus',                  label: 'Sniper PS',    baseTP: 5,  baseSL: 5.0, baseHold: 20,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']) },
  { key: 'ors_prime_reversal',             label: 'ORS Reversal', baseTP: 3,  baseSL: 2.0, baseHold: 12,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT','EARLY_INFLECTION']) },
  { key: 'circuit_breaker_v2',             label: 'Cir.Breaker',  baseTP: 6,  baseSL: 4.0, baseHold: 20,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']) },
];

// Grid parameters
const TP_GRID      = [3, 4, 5, 6, 7, 8, 10, 12, 15];
const SL_GRID      = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const HOLD_GRID    = [10, 15, 20];
const MIN_SIGNALS  = 15; // skip combos with too few signals

// ─── helpers ─────────────────────────────────────────────────────────────────
const W = 120;
const sep = (c='═') => c.repeat(W);

function parseCSV(fp){
  const raw=fs.readFileSync(fp,'utf8').replace(/^\uFEFF/,'').trim();
  if(!raw)return[];
  const lines=raw.split(/\r?\n/),out=[];
  for(let i=1;i<lines.length;i++){
    const p=lines[i].split(',').map(x=>x.trim());
    if(p.length<5)continue;
    const ts=Date.parse(p[0]),o=+p[1],h=+p[2],l=+p[3],c=+p[4],v=+(p[5]||0);
    if(!Number.isFinite(ts)||o<=0||h<l)continue;
    out.push({ts:Math.floor(ts/1000),o,h,l,c,v:Math.max(0,v)});
  }
  out.sort((a,b)=>a.ts-b.ts);
  const d=[];
  for(const x of out){if(d.length&&d[d.length-1].ts===x.ts)d[d.length-1]=x;else d.push(x);}
  return d;
}

function atr14Array(c){
  const out=new Array(c.length).fill(0);
  if(c.length<2)return out;
  const tr=[0];
  for(let i=1;i<c.length;i++)
    tr.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  if(c.length<=14){for(let i=1;i<c.length;i++)out[i]=tr[i];return out;}
  let s=0;for(let i=1;i<=14;i++)s+=tr[i];out[14]=s/14;
  for(let i=15;i<c.length;i++)out[i]=(out[i-1]*13+tr[i])/14;
  return out;
}

// Replay simulation from stored bar slice (bars[0] = entry bar, bars[1] = first bar after signal)
function replaySim(bars, atr, tpPct, slAtr, maxHold){
  if(!bars||bars.length<2||atr<=0)return null;
  const entry = bars[1].o; // next bar open
  if(entry<=0)return null;
  const stop = entry - slAtr * atr;
  const tp   = entry * (1 + tpPct / 100);
  const maxEnd = Math.min(bars.length - 1, maxHold); // bars[0] is signal bar, bars[1..maxHold] = hold
  let exitPx = bars[maxEnd].c, hitTP = false;
  for(let j = 1; j <= maxEnd; j++){
    const b = bars[j];
    if(b.o <= stop){ exitPx = b.o; break; }
    if(b.l <= stop){ exitPx = stop; break; }
    if(b.h >= tp){ exitPx = tp; hitTP = true; break; }
  }
  return { pnl: (exitPx - entry) / entry * 100, hitTP };
}

// ─── Worker: collect raw signals ─────────────────────────────────────────────
if(!isMainThread){
  const engine = require(path.join(workerData.engineDir, 'stockEngine.js'));
  const signals = [];

  for(const file of workerData.files){
    let c;
    try{ c = parseCSV(file.fp); } catch{ continue; }
    if(c.length < MIN_BARS) continue;
    const atr14 = atr14Array(c);

    for(const ps of ALL7){
      let lastExit = -1;
      for(let i = WINDOW - 1; i < c.length - 1; i++){
        if(i <= lastExit) continue;
        if(c[i].ts < OOS_START) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try{ r = engine.analyzeStock(w, ps.key); } catch{ continue; }
        if(!r || !ps.stages.has(r.stage)) continue;

        const atrSig = atr14[i] || c[i].c * 0.02;
        // Store signal bar + next MAX_HOLD_STORE bars for replay
        const bars = c.slice(i, i + MAX_HOLD_STORE + 1);
        if(bars.length < 2) continue;

        signals.push({
          key:   ps.key,
          label: ps.label,
          stage: r.stage,
          uc:    Math.round(r.ucScore ?? 0),
          atr:   atrSig,
          bars,
        });
        lastExit = i + ps.baseHold; // use baseHold spacing to avoid overlap
      }
    }
  }
  parentPort.postMessage({ type: 'done', signals });
  process.exit(0);
}

// ─── Main thread ─────────────────────────────────────────────────────────────
function runMain(){
  const outFile = path.join(__dirname, 'results', 'tp_sl_grid.txt');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const csvFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(f => ({ fp: path.join(DATA_DIR, f) }));

  console.log(sep());
  console.log('  TP/SL GRID SEARCH — ALL 7 PARAM SETS');
  console.log(`  Universe: ${csvFiles.length} stocks  OOS: 2023-2026  Workers: ${WORKERS}`);
  console.log(`  Grid: TP=${JSON.stringify(TP_GRID)}  SL=${JSON.stringify(SL_GRID)}  Hold=${JSON.stringify(HOLD_GRID)}`);
  console.log(`  Total combos per param set: ${TP_GRID.length * SL_GRID.length * HOLD_GRID.length}`);
  console.log(sep());

  // Distribute files across workers
  const chunks = Array.from({ length: WORKERS }, () => []);
  csvFiles.forEach((f, i) => chunks[i % WORKERS].push(f));

  const allSignals = [];
  let done = 0;

  const workers = chunks.filter(ch => ch.length > 0).map(ch => new Promise((res, rej) => {
    const w = new Worker(__filename, {
      workerData: { files: ch, engineDir: ENGINE_DIR },
    });
    w.on('message', msg => {
      if(msg.type === 'done'){
        allSignals.push(...msg.signals);
        done++;
        process.stdout.write(`\r  Collecting signals... ${done}/${WORKERS} workers done  `);
      }
    });
    w.on('error', rej);
    w.on('exit', code => { if(code !== 0) rej(new Error(`Worker exit ${code}`)); else res(); });
  }));

  Promise.all(workers).then(() => {
    console.log(`\n  Total signals collected: ${allSignals.length}`);
    runGridSearch(allSignals, outFile);
  }).catch(err => { console.error(err); process.exit(1); });
}

function runGridSearch(allSignals, outFile){
  const lines = [];
  const log = s => { console.log(s); lines.push(s); };

  log('');
  log(sep());
  log('  PHASE 2: GRID REPLAY');
  log(sep());

  // Group signals by param set
  const byKey = {};
  for(const ps of ALL7) byKey[ps.key] = [];
  for(const s of allSignals) if(byKey[s.key]) byKey[s.key].push(s);

  // Print signal counts
  for(const ps of ALL7)
    log(`  ${ps.label.padEnd(16)}: ${byKey[ps.key].length} signals`);
  log('');

  const bestPerSet = {};

  for(const ps of ALL7){
    const sigs = byKey[ps.key];
    log(sep());
    log(`  ── ${ps.label}  (base: TP=${ps.baseTP}% SL=${ps.baseSL}×ATR hold=${ps.baseHold})`);
    log(`     N=${sigs.length} signals`);
    log('');

    if(sigs.length < MIN_SIGNALS){
      log('  (too few signals for grid search)');
      continue;
    }

    // Compute base metrics first
    const baseResults = [];
    for(const s of sigs){
      const r = replaySim(s.bars, s.atr, ps.baseTP, ps.baseSL, ps.baseHold);
      if(r) baseResults.push(r);
    }
    const baseStats = calcStats(baseResults);

    log(`  Base (current): N=${baseStats.n}  WR=${baseStats.wr.toFixed(1)}%  PF=${baseStats.pf.toFixed(2)}  avg=${baseStats.avgPnl.toFixed(2)}%`);
    log('');

    const minWR = Math.max(50, baseStats.wr - 8); // allow WR to drop up to 8pp but not below 50%

    // Grid search
    const candidates = [];
    for(const tp of TP_GRID){
      for(const sl of SL_GRID){
        for(const hold of HOLD_GRID){
          const results = [];
          for(const s of sigs){
            const r = replaySim(s.bars, s.atr, tp, sl, hold);
            if(r) results.push(r);
          }
          const st = calcStats(results);
          if(!st || st.n < MIN_SIGNALS) continue;
          if(st.wr < minWR) continue; // WR guard
          candidates.push({ tp, sl, hold, ...st });
        }
      }
    }

    // Sort by PF desc, then avg% as tiebreak
    candidates.sort((a, b) => b.pf - a.pf || b.avgPnl - a.avgPnl);

    // Print top 15
    const W2 = 'TP'.padEnd(5) + 'SL'.padStart(6) + 'Hold'.padStart(6) +
               'N'.padStart(7) + 'WR%'.padStart(8) + 'PF'.padStart(7) +
               'avg%'.padStart(8) + '  vs base';
    log('  ' + W2);
    log('  ' + '─'.repeat(W2.length));

    const top = candidates.slice(0, 15);
    for(const c of top){
      const pfDelta = c.pf - baseStats.pf;
      const avgDelta = c.avgPnl - baseStats.avgPnl;
      const flag = (pfDelta > 0.1 && avgDelta > 0) ? ' ★' :
                   (pfDelta > 0)                    ? ' ▲' : '';
      log(
        '  ' +
        String(c.tp+'%').padEnd(5) +
        String(c.sl+'×').padStart(6) +
        String(c.hold).padStart(6) +
        String(c.n).padStart(7) +
        (c.wr.toFixed(1)+'%').padStart(8) +
        c.pf.toFixed(2).padStart(7) +
        ((c.avgPnl >= 0 ? '+' : '') + c.avgPnl.toFixed(2) + '%').padStart(8) +
        `  PF${pfDelta >= 0 ? '+' : ''}${pfDelta.toFixed(2)} avg${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(2)}%${flag}`
      );
    }

    if(candidates.length === 0){
      log('  (no combo passed WR guard)');
    } else {
      bestPerSet[ps.key] = { label: ps.label, base: baseStats, best: candidates[0], ps };
    }
    log('');
  }

  // ─── Summary: best combo per param set ──────────────────────────────────────
  log(sep());
  log('  OPTIMAL SETTINGS SUMMARY (best PF, WR≥base-8pp, N≥' + MIN_SIGNALS + ')');
  log(sep());
  log('');
  log('  ' +
    'Param Set'.padEnd(16) +
    'TP'.padStart(5) + 'SL'.padStart(6) + 'Hold'.padStart(6) +
    'N'.padStart(7) + 'WR%'.padStart(8) + 'PF'.padStart(7) + 'avg%'.padStart(8) +
    '  Δ PF     Δ avg%'
  );
  log('  ' + '─'.repeat(85));
  for(const ps of ALL7){
    const b = bestPerSet[ps.key];
    if(!b){ log(`  ${ps.label.padEnd(16)}  (insufficient data)`); continue; }
    const pfD = b.best.pf - b.base.pf;
    const avgD = b.best.avgPnl - b.base.avgPnl;
    const flag = pfD > 0.1 ? ' ★' : pfD > 0 ? ' ▲' : '';
    log(
      '  ' +
      ps.label.padEnd(16) +
      String(b.best.tp + '%').padStart(5) +
      String(b.best.sl + '×').padStart(6) +
      String(b.best.hold).padStart(6) +
      String(b.best.n).padStart(7) +
      (b.best.wr.toFixed(1) + '%').padStart(8) +
      b.best.pf.toFixed(2).padStart(7) +
      ((b.best.avgPnl >= 0 ? '+' : '') + b.best.avgPnl.toFixed(2) + '%').padStart(8) +
      `  ${pfD >= 0 ? '+' : ''}${pfD.toFixed(2)}     ${avgD >= 0 ? '+' : ''}${avgD.toFixed(2)}%${flag}`
    );
  }
  log('');

  // ─── MFE-guided TP analysis (shows where to exit) ───────────────────────────
  log(sep());
  log('  MFE-BASED EXIT CALIBRATION (% of winning trades that reached each MFE level)');
  log('  Use this to cross-check TP selection: ideal TP ≈ level where MFE curve bends');
  log(sep());
  log('');

  for(const ps of ALL7){
    const sigs = byKey[ps.key];
    if(sigs.length < MIN_SIGNALS) continue;
    const mfes = sigs.map(s => {
      if(!s.bars || s.bars.length < 2) return 0;
      const entry = s.bars[1].o;
      if(entry <= 0) return 0;
      let mfe = 0;
      for(let j = 1; j < s.bars.length; j++){
        const up = (s.bars[j].h - entry) / entry * 100;
        if(up > mfe) mfe = up;
      }
      return mfe;
    });

    const levels = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15];
    const pcts = levels.map(l => (mfes.filter(m => m >= l).length / mfes.length * 100).toFixed(0) + '%');
    log(`  ${ps.label.padEnd(16)}: ≥${levels.map((l,i) => l+'%:'+pcts[i]).join('  ')}`);
  }
  log('');

  log(sep());
  log('  DONE');
  log(`  Saved: ${outFile}`);
  log('');

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  console.log(`\n  Output: ${outFile}`);
}

function calcStats(results){
  if(!results.length) return null;
  const wins = results.filter(r => r.hitTP);
  const loss = results.filter(r => !r.hitTP);
  const n = results.length;
  const wr = wins.length / n * 100;
  const grossW = wins.reduce((s, x) => s + x.pnl, 0);
  const grossL = loss.reduce((s, x) => s + Math.abs(x.pnl), 0);
  const pf = grossL > 0 ? grossW / grossL : Infinity;
  const avgPnl = results.reduce((s, x) => s + x.pnl, 0) / n;
  return { n, wr, pf, avgPnl };
}

if(isMainThread) runMain();
