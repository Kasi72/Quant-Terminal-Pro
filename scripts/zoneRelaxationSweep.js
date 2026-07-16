'use strict';
// Zone Relaxation Sweep — targets 5-10 signals/week for the 5 breakout sets
// while preserving candle quality filters (which drive the validated WR).
//
// Problem: current zone params are SO tight that breakout sets fired only
//   10-42 times in a full year across 1617 symbols (~0-0.4 signals/week each).
//   This is a regime mismatch — NSE's 2025-2026 bull run causes stocks to break
//   out before forming the long, tight consolidations the params require.
//
// Approach:
//   1. Collect candidates with ZONE-RELAXED params but CANDLE-QUALITY-EXACT params
//      (keeping closeLoc, wick, body, volume, etc. at current production values)
//   2. Record zone features (zoneLen, zoneTightnessPct, pre10AvgRangeATR, etc.)
//   3. Sweep zone param grid → find combos giving 250-500 signals/year (5-10/wk)
//      while maximising WR and PF
//
// Usage: node scripts/zoneRelaxationSweep.js [--set KEY]
//   KEY: deployable|highprecision|elite|ultraselective|sniper (default: all)
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_PREFIX = process.env.OUT_PREFIX || path.join(__dirname, 'zone_relaxation_sweep');

const HISTORY_WINDOW  = 320;
const MIN_HISTORY     = 220;
const MAX_HOLD        = 20;
const LOOKBACK_BARS   = 200; // only scan last ~200 bars (~10 months) per symbol
const N_WORKERS      = Math.max(1, Math.min(6, os.cpus().length - 1));
const TOP_N          = 12;

// Target: 250-500 signals/year across full universe → 5-10 signals/week
const TARGET_MIN = 200;
const TARGET_MAX = 1000;  // allow up to 20/week — let WR filter do the rest

const BREAKOUT_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const ALIAS = {
  deployable:    'optimized_deployable_20plus',
  highprecision: 'optimized_highprecision_15plus',
  elite:         'optimized_elite_10plus',
  ultraselective:'optimized_ultraselective_8plus',
  sniper:        'sniper_95plus',
};
const LABELS = {
  optimized_deployable_20plus:   'Deployable',
  optimized_highprecision_15plus:'HighPrecision',
  optimized_elite_10plus:        'Elite',
  optimized_ultraselective_8plus:'UltraSelective',
  sniper_95plus:                 'Sniper',
};
const ACTIONABLE = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseDate(raw) {
  const s = String(raw||'').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd,mon,yyyy]=s.split('-'), mm=String((MONTHS[mon]??0)+1).padStart(2,'0');
    return { iso:`${yyyy}-${mm}-${dd.padStart(2,'0')}`, ts:Math.floor(Date.UTC(+yyyy,+mm-1,+dd)/1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const iso=s.slice(0,10); return { iso, ts:Math.floor(Date.parse(`${iso}T00:00:00Z`)/1000) }; }
  const t=Date.parse(s);
  return Number.isFinite(t)?{iso:new Date(t).toISOString().slice(0,10),ts:Math.floor(t/1000)}:{iso:'',ts:0};
}
function parseCSV(fp) {
  const text=fs.readFileSync(fp,'utf8').trim(); if(!text)return[];
  const lines=text.split(/\r?\n/), h=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const [iDate,iOpen,iHigh,iLow,iClose,iVol]=['date','open','high','low','close','volume'].map(n=>h.indexOf(n));
  if([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i=>i<0))return[];
  const out=[];
  for(let i=1;i<lines.length;i++){
    const p=lines[i].split(','); const{iso,ts}=parseDate(p[iDate]);
    const o=+p[iOpen],hgh=+p[iHigh],lo=+p[iLow],c=+p[iClose],v=+p[iVol];
    if(!iso||!ts||!Number.isFinite(o)||!Number.isFinite(c)||c<=0||hgh<lo)continue;
    out.push({ts,date:iso,o,h:hgh,l:lo,c,v:Number.isFinite(v)?v:0});
  }
  out.sort((a,b)=>a.ts-b.ts); return out;
}
function pct(n,d){return d>0?n/d*100:0;}
function avg(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function wilson(h,n){if(n<=0)return 0;const z=1.96,p=h/n;return((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n))*100;}

// Zone-relaxed override — keeps ALL candle quality filters exact, only loosens zone/structure
function zoneRelaxed(base) {
  return {
    ...base,
    // ─── Structure / zone filters — FULLY RELAXED for candidate collection ───
    minZoneLen: 1,
    maxZoneLen: 40,
    maxZoneTightnessPct: 40,
    zoneRangeATRThreshold: 3.0,
    maxPre10AvgRangeATR: 3.0,
    maxPre10ExpansionCount: 20,
    maxPre10AvgVolRatio: 5.0,
    maxPre5AvgVolRatio: 5.0,
    maxPre10HighVolCount: 20,
    maxPre10RedVolBias: 10,
    // ─── Candle quality — EXACT (unchanged from production) ──────────────────
    // minExactRangeATR14, maxExactRangeATR14, minExactVolRatio20, minExactVolVsPre5,
    // minCloseLoc, maxUpperWickPct, minBodyPct, maxCandleRisk,
    // minUltraPrecisionScore, minRSI2, minVolatilityExpansionRatio,
    // minCandleQualityScore, maxCloseAboveZonePct, forensic  — ALL UNCHANGED
  };
}

// Simulate: simple TP/SL outcome
function simulate(candles, sigIdx) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!entry || entry <= 0) return null;
  // derive TP/SL from engine's price engine if available, else use 5%/3%
  const tp = entry * 1.05, sl = entry * 0.97;
  let mfe = 0, mae = 0;
  for (let i = entryIdx; i <= Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1); i++) {
    const b = candles[i];
    mfe = Math.max(mfe, (b.h - entry) / entry * 100);
    mae = Math.min(mae, (b.l - entry) / entry * 100);
    if (b.h >= tp) return { win: true, pct: 5.0, mfe, mae };
    if (b.l <= sl) return { win: false, pct: -3.0, mfe, mae };
  }
  const last = candles[Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1)];
  const closePct = (last.c - entry) / entry * 100;
  return { win: closePct > 0, pct: closePct, mfe, mae };
}

// ─── Zone param grid ─────────────────────────────────────────────────────────
const ZONE_AXES = {
  minZoneLen:           [1, 2, 3, 4, 5, 6],
  maxZoneTightnessPct:  [10, 14, 18, 22, 28, 35, 40],
  maxPre10AvgRangeATR:  [1.0, 1.2, 1.5, 1.8, 2.2, 3.0],
  maxPre10ExpansionCount:[0, 1, 2, 3, 5, 8],
  maxPre10AvgVolRatio:  [0.75, 0.90, 1.0, 1.2, 1.5, 2.0],
  maxPre5AvgVolRatio:   [0.85, 1.0, 1.2, 1.5, 2.0, 2.5],
};

function allCombos() {
  const keys = Object.keys(ZONE_AXES);
  const vals  = keys.map(k => ZONE_AXES[k]);
  const total = vals.reduce((p, v) => p * v.length, 1);
  // Too many? Sample a random subset
  const MAX_COMBOS = 8000;
  if (total <= MAX_COMBOS) {
    const out = [];
    function recurse(idx, cur) {
      if (idx === keys.length) { out.push({...cur}); return; }
      for (const v of vals[idx]) { cur[keys[idx]] = v; recurse(idx+1, {...cur}); }
    }
    recurse(0, {}); return out;
  }
  // Random sample
  const out = [], seen = new Set();
  let attempts = 0;
  while (out.length < MAX_COMBOS && attempts < MAX_COMBOS * 10) {
    attempts++;
    const combo = {};
    for (let i = 0; i < keys.length; i++) {
      const arr = vals[i];
      combo[keys[i]] = arr[Math.floor(Math.random() * arr.length)];
    }
    const key = JSON.stringify(combo);
    if (!seen.has(key)) { seen.add(key); out.push(combo); }
  }
  return out;
}

// Check if a captured signal passes given zone params
function zonePassesCombo(s, combo, baseParams) {
  if (s.zoneLen < combo.minZoneLen) return false;
  if (s.zoneLen > (baseParams.maxZoneLen || 40)) return false;
  if (s.zoneTightnessPct > combo.maxZoneTightnessPct) return false;
  if (s.pre10AvgRangeATR > combo.maxPre10AvgRangeATR) return false;
  if (s.pre10ExpansionCount > combo.maxPre10ExpansionCount) return false;
  if (s.pre10AvgVolRatio > combo.maxPre10AvgVolRatio) return false;
  if (s.pre5AvgVolRatio > combo.maxPre5AvgVolRatio) return false;
  return true;
}

function evalCombo(signals, combo, baseParams, oosStart) {
  const passed = signals.filter(s => zonePassesCombo(s, combo, baseParams));
  const is = passed.filter(s => s.date < oosStart);
  const oos = passed.filter(s => s.date >= oosStart);
  function calc(arr) {
    if (!arr.length) return { n:0, wr:0, wilson:0, avg:0, pf:0, mfe:0, mae:0 };
    const wins = arr.filter(s=>s.win), losses = arr.filter(s=>!s.win);
    const gw = wins.reduce((a,s)=>a+s.pct,0), gl = Math.abs(losses.reduce((a,s)=>a+s.pct,0));
    return {
      n: arr.length, wr: wins.length/arr.length*100, wilson: wilson(wins.length,arr.length),
      avg: avg(arr.map(s=>s.pct)), pf: gl>0?gw/gl:(gw>0?99:0),
      mfe: avg(arr.map(s=>s.mfe)), mae: avg(arr.map(s=>s.mae)),
    };
  }
  const ri = calc(is), ro = calc(oos);
  // Scoring: prioritise IS Wilson + OOS WR + PF; penalise if outside frequency target
  const freqScore = passed.length >= TARGET_MIN && passed.length <= TARGET_MAX ? 10 : 0;
  const score = ri.wilson * 0.4 + (ri.pf > 0 ? Math.min(ri.pf, 8) * 2 : 0) +
                (ro.n >= 5 ? ro.wilson * 0.3 : 0) + freqScore;
  return { is: ri, oos: ro, n: passed.length, score };
}

// ─── Worker ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { signals, combos, baseParams, oosStart } = workerData;
  const results = combos.map(combo => {
    const r = evalCombo(signals, combo, baseParams, oosStart);
    return { combo, ...r };
  });
  results.sort((a,b) => b.score - a.score);
  parentPort.postMessage(results.slice(0, 40));
  return;
}

// ─── Main ────────────────────────────────────────────────────────────────────
const { analyzeStock, PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

const setArg = process.argv.indexOf('--set');
const singleSet = setArg >= 0 ? (ALIAS[process.argv[setArg+1]] || process.argv[setArg+1]) : null;
const SETS_TO_RUN = singleSet ? [singleSet] : BREAKOUT_KEYS;

console.log('Loading candle data...');
const files = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv'));
const allCandles = {};
for (const f of files) {
  const c = parseCSV(path.join(DATA_DIR, f));
  if (c.length >= MIN_HISTORY) allCandles[f.replace(/\.csv$/i,'')] = c;
}
const symbols = Object.keys(allCandles);
console.log(`Loaded ${symbols.length} symbols\n`);

function collectSignals(paramKey, baseParams) {
  const relaxed = zoneRelaxed(baseParams);
  // Patch a temporary copy of PARAM_SETS so analyzeStock uses relaxed zone params
  const original = { ...PARAM_SETS[paramKey] };
  Object.assign(PARAM_SETS[paramKey], relaxed);

  const signals = [];
  let cnt = 0;
  for (const sym of symbols) {
    cnt++;
    if (cnt % 400 === 0) console.log(`  Collecting ${paramKey.replace('optimized_','').replace('_plus','')}... ${cnt}/${symbols.length}`);
    const candles = allCandles[sym];
    const startIdx = Math.max(MIN_HISTORY, candles.length - LOOKBACK_BARS);
    for (let i = startIdx; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - HISTORY_WINDOW + 1), i + 1);
      let r;
      try { r = analyzeStock(window, paramKey); } catch { continue; }
      if (!ACTIONABLE.has(r.stage)) continue;
      const outcome = simulate(candles, i);
      if (!outcome) continue;
      signals.push({
        sym, date: candles[i].date,
        win: outcome.win, pct: outcome.pct, mfe: outcome.mfe, mae: outcome.mae,
        zoneLen:              r.zone?.windowLength ?? 0,
        zoneTightnessPct:     r.zone?.zoneTightnessPct ?? 999,
        pre10AvgRangeATR:     r.pre10AvgRangeATR,
        pre10ExpansionCount:  r.pre10ExpansionCount,
        pre10AvgVolRatio:     r.pre10AvgVolRatio,
        pre5AvgVolRatio:      r.pre5AvgVolRatio,
        pre10HighVolCount:    r.pre10HighVolCount,
        pre10RedVolBias:      r.pre10RedVolBias,
      });
    }
  }
  // Restore original params
  Object.assign(PARAM_SETS[paramKey], original);
  console.log(`  Done — ${signals.length} raw candidates collected.`);
  return signals;
}

async function runWorkers(signals, combos, baseParams, oosStart) {
  const chunkSize = Math.ceil(combos.length / N_WORKERS);
  const chunks = [];
  for (let i = 0; i < combos.length; i += chunkSize) chunks.push(combos.slice(i, i+chunkSize));
  return new Promise((resolve, reject) => {
    let allResults = [], done = 0;
    for (const chunk of chunks) {
      const w = new Worker(__filename, { workerData: { signals, combos: chunk, baseParams, oosStart } });
      w.on('message', res => { allResults.push(...res); done++; if (done === chunks.length) resolve(allResults); });
      w.on('error', reject);
    }
  });
}

const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5);
const outTxt  = `${OUT_PREFIX}_${ts}.txt`;
const outJson = `${OUT_PREFIX}_${ts}.json`;
const lines = [], jsonOut = {};
function log(s) {
  console.log(s);
  lines.push(s);
  // Flush to file immediately so partial results survive a kill
  fs.appendFileSync(outTxt, s + '\n');
}

(async () => {
  log('='.repeat(110));
  log('ZONE RELAXATION SWEEP — preserving candle quality, varying zone/structure params');
  log(`Symbols: ${symbols.length}  MaxHold: ${MAX_HOLD}d  Target: ${TARGET_MIN}-${TARGET_MAX} signals/year  Workers: ${N_WORKERS}`);
  log('='.repeat(110));

  const combos = allCombos();
  log(`Testing ${combos.length} zone param combinations per set\n`);

  for (const setKey of SETS_TO_RUN) {
    const label = LABELS[setKey];
    const baseParams = PARAM_SETS[setKey];

    log(`\n${'─'.repeat(80)}`);
    log(`${label} | collecting candidates (zone-relaxed, candle-quality-exact)...`);

    const signals = collectSignals(setKey, baseParams);

    if (signals.length < 20) {
      log(`  ⚠ Only ${signals.length} raw candidates even with relaxed zones.`);
      log(`    This set's candle-quality filters are the bottleneck, not zones.`);
      jsonOut[setKey] = { label, rawN: signals.length, status: 'candle_quality_bottleneck' };
      continue;
    }

    log(`  Raw candidates (zone-relaxed pool): ${signals.length}`);

    // Distribution of zone features in the candidate pool
    const zoneLens = signals.map(s=>s.zoneLen).sort((a,b)=>a-b);
    const tightPcts = signals.map(s=>s.zoneTightnessPct).filter(v=>v<999).sort((a,b)=>a-b);
    const p = (arr,q) => arr[Math.floor(arr.length*q)] ?? arr[arr.length-1];
    log(`  Zone feature distribution (p25/p50/p75/p90):`);
    log(`    zoneLen:     ${p(zoneLens,.25)} / ${p(zoneLens,.50)} / ${p(zoneLens,.75)} / ${p(zoneLens,.90)}`);
    log(`    tightness%:  ${p(tightPcts,.25)?.toFixed(1)} / ${p(tightPcts,.50)?.toFixed(1)} / ${p(tightPcts,.75)?.toFixed(1)} / ${p(tightPcts,.90)?.toFixed(1)}`);
    log(`    pre10VolRatio p50/p75: ${p(signals.map(s=>s.pre10AvgVolRatio).sort((a,b)=>a-b),.50)?.toFixed(2)} / ${p(signals.map(s=>s.pre10AvgVolRatio).sort((a,b)=>a-b),.75)?.toFixed(2)}`);
    log(`    pre10RangeATR p50/p75: ${p(signals.map(s=>s.pre10AvgRangeATR).sort((a,b)=>a-b),.50)?.toFixed(2)} / ${p(signals.map(s=>s.pre10AvgRangeATR).sort((a,b)=>a-b),.75)?.toFixed(2)}`);

    // OOS split: last 30%
    const sorted = [...signals].sort((a,b)=>a.date.localeCompare(b.date));
    const oosStart = sorted[Math.floor(sorted.length * 0.70)].date;
    log(`  OOS start: ${oosStart}`);

    // Base performance (current production params — should match ~42 signals/year)
    const baseCombo = {
      minZoneLen:           baseParams.minZoneLen,
      maxZoneTightnessPct:  baseParams.maxZoneTightnessPct,
      maxPre10AvgRangeATR:  baseParams.maxPre10AvgRangeATR,
      maxPre10ExpansionCount: baseParams.maxPre10ExpansionCount,
      maxPre10AvgVolRatio:  baseParams.maxPre10AvgVolRatio,
      maxPre5AvgVolRatio:   baseParams.maxPre5AvgVolRatio,
    };
    const base = evalCombo(signals, baseCombo, baseParams, oosStart);
    log(`  BASE: n=${base.n} IS_WR=${base.is.wr.toFixed(1)}% Wil=${base.is.wilson.toFixed(1)}% Avg=${base.is.avg.toFixed(2)}% PF=${base.is.pf.toFixed(2)} | OOS n=${base.oos.n} WR=${base.oos.wr.toFixed(1)}%`);
    log(`  (Base zone params: minZoneLen=${baseParams.minZoneLen}, maxTightness=${baseParams.maxZoneTightnessPct}%, maxRangeATR=${baseParams.maxPre10AvgRangeATR}, maxExpansions=${baseParams.maxPre10ExpansionCount})`);

    log(`  Sweeping ${combos.length} combos...`);
    let allResults = await runWorkers(signals, combos, baseParams, oosStart);
    allResults.sort((a,b) => b.score - a.score);

    // Filter to frequency-targeted results, then by score
    const inTarget = allResults.filter(r => r.n >= TARGET_MIN && r.n <= TARGET_MAX);
    const top = (inTarget.length >= TOP_N ? inTarget : allResults).slice(0, TOP_N);

    log(`\n  Results meeting target (${TARGET_MIN}-${TARGET_MAX} signals/year): ${inTarget.length} combos`);
    log(`  ${'Rank'.padStart(4)} ${'N'.padStart(5)} ${'IS_WR%'.padStart(7)} ${'IS_Wil%'.padStart(8)} ${'IS_Avg%'.padStart(8)} ${'IS_PF'.padStart(6)} ${'OOS_n'.padStart(6)} ${'OOS_WR%'.padStart(8)} ${'OOS_PF'.padStart(7)} Zone Params`);
    log(`  ${'-'.repeat(108)}`);

    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const zp = r.combo;
      const zStr = `zLen≥${zp.minZoneLen} tight≤${zp.maxZoneTightnessPct}% rng≤${zp.maxPre10AvgRangeATR} exp≤${zp.maxPre10ExpansionCount} vol≤${zp.maxPre10AvgVolRatio}/≤${zp.maxPre5AvgVolRatio}`;
      const freq = r.n >= TARGET_MIN && r.n <= TARGET_MAX ? '✓' : r.n < TARGET_MIN ? '⬇' : '⬆';
      log(`  ${String(i+1).padStart(4)} ${String(r.n).padStart(5)}${freq} ${r.is.wr.toFixed(1).padStart(6)}% ${r.is.wilson.toFixed(1).padStart(7)}% ${r.is.avg.toFixed(2).padStart(7)}% ${r.is.pf.toFixed(2).padStart(5)}  ${String(r.oos.n).padStart(5)} ${r.oos.wr.toFixed(1).padStart(7)}% ${r.oos.pf.toFixed(2).padStart(6)}  ${zStr}`);
    }

    // Extract recommended params for the best in-target result
    const best = inTarget.length > 0 ? inTarget[0] : allResults[0];
    jsonOut[setKey] = { label, rawN: signals.length, base, best, top };

    log(`\n  ★ RECOMMENDED zone params for ${label}:`);
    log(`    minZoneLen:           ${best.combo.minZoneLen}`);
    log(`    maxZoneTightnessPct:  ${best.combo.maxZoneTightnessPct}`);
    log(`    maxPre10AvgRangeATR:  ${best.combo.maxPre10AvgRangeATR}`);
    log(`    maxPre10ExpansionCount:${best.combo.maxPre10ExpansionCount}`);
    log(`    maxPre10AvgVolRatio:  ${best.combo.maxPre10AvgVolRatio}`);
    log(`    maxPre5AvgVolRatio:   ${best.combo.maxPre5AvgVolRatio}`);
    log(`    → IS n=${best.n} WR=${best.is.wr.toFixed(1)}% Wil=${best.is.wilson.toFixed(1)}% PF=${best.is.pf.toFixed(2)} | OOS n=${best.oos.n} WR=${best.oos.wr.toFixed(1)}% PF=${best.oos.pf.toFixed(2)}`);
  }

  fs.writeFileSync(outJson, JSON.stringify(jsonOut, null, 2), 'utf8');
  log(`\n✅ Done. Results: ${outTxt}`);
})().catch(e => { console.error(e); process.exit(1); });
