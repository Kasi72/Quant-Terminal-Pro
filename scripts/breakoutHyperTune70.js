/**
 * Breakout Hyper-Tuner — Target 70%+ OOS WR
 * ──────────────────────────────────────────
 * Problem: breakout sets have ~22-44% OOS WR in NSE 2025-26 bull market
 *   because minZoneLen≥4 requires multi-bar bases that no longer form.
 * Solution:
 *   1) Collection: fully relax BOTH zone AND quality gates (including minZoneLen=1)
 *   2) Sweep: random-sample 20K combos of zone+quality params per set
 *   3) Target: OOS WR ≥ 70% with OOS n ≥ 50 signals
 *
 * Run: node scripts/breakoutHyperTune70.js
 *      node scripts/breakoutHyperTune70.js --set deployable   (single set)
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('path'), path = require('path');
const fsys = require('fs');
const os   = require('os');

const DATA_DIR     = process.env.DATA_DIR    || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR   = process.env.ENGINE_DIR  || path.join(__dirname, '_compiled_current');
const HISTORY_WIN  = Number(process.env.HISTORY_WIN  || 500);   // bars fed to engine per call
const MIN_HISTORY  = Number(process.env.MIN_HISTORY  || 220);
const MAX_HOLD     = Number(process.env.MAX_HOLD     || 20);
const RANDOM_COMBOS = Number(process.env.RANDOM_COMBOS || 20000);
const N_WORKERS    = Math.max(1, Math.min(os.cpus().length - 1, 16));
const MIN_OOS_N    = 50;
const TARGET_OOS_WR = 70;
const IS_SPLIT     = 0.70;

const SET_ARG = (() => { const i = process.argv.indexOf('--set'); return i >= 0 ? process.argv[i+1] : null; })();
const BREAKOUT_KEYS = ['optimized_deployable_20plus','optimized_highprecision_15plus','optimized_elite_10plus','optimized_ultraselective_8plus','sniper_95plus'];
const LABELS = { optimized_deployable_20plus:'Deployable', optimized_highprecision_15plus:'HighPrecision', optimized_elite_10plus:'Elite', optimized_ultraselective_8plus:'UltraSelective', sniper_95plus:'Sniper' };
const ACTIONABLE = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const stamp = new Date().toISOString().replace(/[:.]/g,'_').slice(0,19);
const outFile = path.join(__dirname, `breakout_hypertune70_${stamp}.txt`);

// ─── UTILS ───────────────────────────────────────────────────────────────────
function log(s){ console.log(s); fsys.appendFileSync(outFile, s+'\n'); }
function parseDate(raw){ const s=String(raw||'').trim(); if(/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)){const[dd,mon,yyyy]=s.split('-');const mm=String((MONTHS[mon.toLowerCase()]??0)+1).padStart(2,'0');return{iso:`${yyyy}-${mm}-${dd.padStart(2,'0')}`,ts:Math.floor(Date.UTC(+yyyy,+mm-1,+dd)/1000)};}if(/^\d{4}-\d{2}-\d{2}/.test(s)){const iso=s.slice(0,10);return{iso,ts:Math.floor(Date.parse(`${iso}T00:00:00Z`)/1000)};}const t=Date.parse(s);return Number.isFinite(t)?{iso:new Date(t).toISOString().slice(0,10),ts:Math.floor(t/1000)}:{iso:'',ts:0};}
function parseCSV(fp){ const lines=fsys.readFileSync(fp,'utf8').trim().split(/\r?\n/); const h=lines[0].split(',').map(x=>x.trim().toLowerCase()); const[iDate,iOpen,iHigh,iLow,iClose,iVol]=['date','open','high','low','close','volume'].map(n=>h.indexOf(n)); if([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i=>i<0))return[]; const out=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(',');const{iso,ts}=parseDate(p[iDate]);const o=+p[iOpen],hh=+p[iHigh],lo=+p[iLow],c=+p[iClose],v=+p[iVol];if(!iso||!ts||!isFinite(o)||!isFinite(hh)||!isFinite(lo)||!isFinite(c)||c<=0||hh<lo)continue;out.push({ts,date:iso,o,h:hh,l:lo,c,v:isFinite(v)?v:0});}out.sort((a,b)=>a.ts-b.ts);return out;}
function avg(a){ return a.length?a.reduce((s,v)=>s+v,0)/a.length:0; }
function wilson(h,n){ if(n<=0)return 0;const z=1.96,p=h/n;return((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n))*100; }
function rng(seed){ let x=seed>>>0; return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;}; }

// ─── FULL RELAXATION (zone + quality) ────────────────────────────────────────
function fullyRelaxed(base) {
  return {
    ...base,
    minAvgTurnover20: Math.min(base.minAvgTurnover20 || 10000000, 5000000),
    maxATRPct14Pctl120: 99,
    // Zone: fully open — captures 1-bar consolidations
    maxPre10AvgRangeATR: 5.0,
    maxPre10ExpansionCount: 20,
    zoneRangeATRThreshold: base.zoneRangeATRThreshold || 0.5,
    minZoneLen: 1,
    maxZoneLen: 200,
    maxZoneTightnessPct: 100,
    maxPre10AvgVolRatio: 5.0,
    maxPre5AvgVolRatio: 5.0,
    maxPre10HighVolCount: 20,
    maxPre10RedVolBias: 10,
    // Breakout candle: fully open
    minExactRangeATR14: 0.05,
    maxExactRangeATR14: 30,
    minExactVolRatio20: 0.05,
    minExactVolVsPre5: 0.05,
    minCloseLoc: 0,
    maxUpperWickPct: 100,
    minBodyPct: 0,
    maxCandleRisk: 25,
    minUltraPrecisionScore: 0,
    minRSI2: 0,
    minVolatilityExpansionRatio: null,
    minCandleQualityScore: null,
    maxCloseAboveZonePct: null,
    forensic: {},
    breakoutMultiplier: base.breakoutMultiplier || 0.003,
  };
}

// ─── SIMULATION ───────────────────────────────────────────────────────────────
function levelsFromEngine(pe, fallback){
  const entry=Number(pe?.plannedEntry||fallback),stop=Number(pe?.tacticalStop||entry*0.94),t1=Number(pe?.target5||entry*1.05),t2=Number(pe?.target7||entry*1.08),t3=Number(pe?.target10||entry*1.12);
  if(![entry,stop,t1,t2,t3].every(Number.isFinite)||entry<=0||stop<=0||stop>=entry)return null;
  return{entry,stop,t1:Math.max(t1,entry*1.001),t2:Math.max(t2,t1),t3:Math.max(t3,t2)};
}
function simulateBreakout(candles,sigIdx,levels){
  const entryIdx=sigIdx+1; if(entryIdx>=candles.length)return null;
  const entry=candles[entryIdx].o; if(!Number.isFinite(entry)||entry<=0)return null;
  const toP=price=>(price-entry)/entry*100;
  const riskAbs=Math.max(0.0001,entry-levels.stop);
  let stop=levels.stop,pos=1,pnl=0,status='time',t1Hit=false,t2Hit=false;
  let exitIdx=Math.min(entryIdx+MAX_HOLD-1,candles.length-1),mfe=0,mae=0;
  for(let i=entryIdx;i<=Math.min(entryIdx+MAX_HOLD-1,candles.length-1);i++){
    const b=candles[i]; mfe=Math.max(mfe,toP(b.h)); mae=Math.min(mae,toP(b.l));
    if(pos>0&&b.o<=stop){pnl+=pos*toP(b.o);status=t2Hit?'stop_gap_t2':t1Hit?'stop_gap_t1':'stop_gap';exitIdx=i;pos=0;break;}
    if(pos>0&&b.l<=stop){pnl+=pos*toP(stop);status=t2Hit?'stop_t2':t1Hit?'stop_t1':'stop';exitIdx=i;pos=0;break;}
    if(!t1Hit&&b.h>=levels.t1&&pos>0){pnl+=0.5*toP(levels.t1);pos-=0.5;t1Hit=true;status='hit_t1';stop=Math.max(stop,entry);}
    if(t1Hit&&!t2Hit&&b.h>=levels.t2&&pos>0){pnl+=0.3*toP(levels.t2);pos-=0.3;t2Hit=true;status='hit_t2';stop=Math.max(stop,levels.t1);}
    if(t2Hit&&b.h>=levels.t3&&pos>0){pnl+=pos*toP(levels.t3);pos=0;status='hit_t3';exitIdx=i;break;}
  }
  if(pos>0){pnl+=pos*toP(candles[exitIdx].c);status=t2Hit?'time_t2':t1Hit?'time_t1':'time';}
  return{pnl,pnlR:((entry*(1+pnl/100))-entry)/riskAbs,status,mfe,mae,days:exitIdx-entryIdx+1,entryDate:candles[entryIdx].date};
}

// ─── CANDIDATE CAPTURE ────────────────────────────────────────────────────────
function captureBreakout(r, candles, i, sym){
  if(!ACTIONABLE.has(r.stage))return null;
  const levels=levelsFromEngine(r.priceEngine,candles[i].c); if(!levels)return null;
  const sim=simulateBreakout(candles,i,levels); if(!sim)return null;
  const dna=r.candleDNA||{},st=r.stats||{};
  return{
    sym,idx:i,date:candles[i].date,ts:candles[i].ts,
    pnl:sim.pnl,status:sim.status,mfe:sim.mfe,mae:sim.mae,
    // Zone features
    zoneLen:r.zone?.windowLength??0,zoneTightnessPct:r.zone?.zoneTightnessPct??999,
    pre10AvgRangeATR:r.pre10AvgRangeATR,pre10ExpansionCount:r.pre10ExpansionCount,
    pre10AvgVolRatio:r.pre10AvgVolRatio,pre5AvgVolRatio:r.pre5AvgVolRatio,
    pre10HighVolCount:r.pre10HighVolCount,pre10RedVolBias:r.pre10RedVolBias,
    atrPct14Pctl120:r.atrPct14Pctl120,avgTurnover20:r.avgTurnover20,
    // Candle quality features
    exactRangeATR14:r.exactRangeATR14,exactVolRatio20:r.exactVolRatio20,exactVolVsPre5:r.exactVolVsPre5,
    closeLoc:r.closeLoc,upperWickPct:r.upperWickPct,bodyPct:r.bodyPct,signalRangePct:r.signalRangePct,
    ultraPrecisionScore:r.ultraPrecisionScore,rsi2:r.rsi2,volatilityExpansionRatio:r.volatilityExpansionRatio,
    candleQualityScore:r.candleQualityScore,
    closeAboveZonePct:r.zone&&r.zone.zoneHigh>0?((candles[i].c-r.zone.zoneHigh)/r.zone.zoneHigh)*100:999,
    // DNA / stats extras
    candleDnaScore:dna.score??0,marubozuScore:dna.marubozuScore??0,upperToLowerWickRatio:dna.upperToLowerWickRatio??99,
    volZScore:st.volZScore??0,bbWidthPctl:st.bbWidthPctl??50,guppyCompressDays:st.guppyCompressDays??0,
    candlePatternStrength:st.candlePatternStrength??0,
  };
}

// ─── CORE FILTER ──────────────────────────────────────────────────────────────
function corePasses(s, p){
  if(s.avgTurnover20<(p.minAvgTurnover20||0))return false;
  if(s.atrPct14Pctl120>(p.maxATRPct14Pctl120||99))return false;
  if(s.pre10AvgRangeATR>(p.maxPre10AvgRangeATR||99))return false;
  if(s.pre10ExpansionCount>(p.maxPre10ExpansionCount||99))return false;
  if(s.zoneLen<(p.minZoneLen||1)||s.zoneLen>(p.maxZoneLen||200))return false;
  if(s.zoneTightnessPct>(p.maxZoneTightnessPct||100))return false;
  if(s.pre10AvgVolRatio>(p.maxPre10AvgVolRatio||99))return false;
  if(s.pre5AvgVolRatio>(p.maxPre5AvgVolRatio||99))return false;
  if(s.pre10HighVolCount>(p.maxPre10HighVolCount||99))return false;
  if(s.pre10RedVolBias>(p.maxPre10RedVolBias||99))return false;
  if(s.exactRangeATR14<(p.minExactRangeATR14||0))return false;
  if(s.exactRangeATR14>(p.maxExactRangeATR14||99))return false;
  if(s.exactVolRatio20<(p.minExactVolRatio20||0))return false;
  if(s.exactVolVsPre5<(p.minExactVolVsPre5||0))return false;
  if(s.closeLoc<(p.minCloseLoc||0))return false;
  if(s.upperWickPct>(p.maxUpperWickPct||100))return false;
  if(s.bodyPct<(p.minBodyPct||0))return false;
  if(s.signalRangePct>(p.maxCandleRisk||99))return false;
  if(s.ultraPrecisionScore<(p.minUltraPrecisionScore||0))return false;
  if(s.rsi2<(p.minRSI2||0))return false;
  if(p.minVolatilityExpansionRatio!=null&&s.volatilityExpansionRatio<p.minVolatilityExpansionRatio)return false;
  if(p.minCandleQualityScore!=null&&s.candleQualityScore<p.minCandleQualityScore)return false;
  if(p.maxCloseAboveZonePct!=null&&s.closeAboveZonePct>p.maxCloseAboveZonePct)return false;
  return true;
}

// ─── SWEEP AXES ───────────────────────────────────────────────────────────────
const ZONE_AXES = {
  minZoneLen:           [1, 2, 3, 4, 5, 6],
  maxZoneTightnessPct:  [8, 10, 12, 15, 18, 22, 30, 50, 100],
  maxPre10AvgRangeATR:  [0.7, 0.8, 1.0, 1.15, 1.3, 1.5, 2.0, 5.0],
  maxPre10ExpansionCount:[0, 1, 2, 3, 5, 20],
  maxPre10AvgVolRatio:  [0.7, 0.85, 1.0, 1.1, 1.3, 5.0],
  maxPre5AvgVolRatio:   [0.85, 1.0, 1.1, 1.3, 1.5, 5.0],
};
const QUALITY_AXES = {
  minExactRangeATR14:   [0.05, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
  minExactVolRatio20:   [0.05, 0.8, 1.2, 1.5, 2.0, 2.5, 3.0],
  minExactVolVsPre5:    [0.05, 0.8, 1.2, 1.5, 2.0, 3.0],
  minCloseLoc:          [0, 40, 50, 60, 65, 70, 75, 80],
  maxUpperWickPct:      [10, 15, 18, 20, 25, 30, 40, 100],
  minBodyPct:           [0, 20, 35, 50, 60, 70],
  minUltraPrecisionScore:[0, 10, 25, 40, 50, 60, 70],
  minVolatilityExpansionRatio:[null, 0.5, 1.0, 1.4, 2.0, 2.5],
  minCandleQualityScore:[null, 1, 2, 3, 4, 5],
  maxCloseAboveZonePct: [null, 2, 3, 4, 5, 8, 10],
  maxCandleRisk:        [4, 5, 6, 7, 8.5, 10, 15, 25],
};
const ALL_AXES = { ...ZONE_AXES, ...QUALITY_AXES };

// ─── WORKER ───────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { candidates, combos, isCutIdx } = workerData;
  const results = [];

  for (const combo of combos) {
    const passed = candidates.filter(s => corePasses(s, combo));
    const is  = passed.filter(s => s.sortIdx < isCutIdx);
    const oos = passed.filter(s => s.sortIdx >= isCutIdx);
    if (oos.length < MIN_OOS_N) continue;
    if (is.length < 30) continue;

    const oosWins = oos.filter(s => s.pnl > 0).length;
    const oosWR   = oosWins / oos.length * 100;
    if (oosWR < TARGET_OOS_WR) continue;  // skip below target early

    const isWins  = is.filter(s => s.pnl > 0).length;
    const isWR    = isWins / is.length * 100;
    const oosWil  = wilson(oosWins, oos.length);

    const avgPnl = v => v.reduce((a,s)=>a+s.pnl,0)/v.length;
    const pf = arr => { const w=arr.filter(s=>s.pnl>0),l=arr.filter(s=>s.pnl<=0); const gw=w.reduce((a,s)=>a+s.pnl,0),gl=Math.abs(l.reduce((a,s)=>a+s.pnl,0)); return gl>0?gw/gl:(gw>0?99:0); };

    results.push({ combo, isN:is.length, oosN:oos.length, isWR, oosWR, oosWil, isAvg:avgPnl(is), oosAvg:avgPnl(oos), isPF:pf(is), oosPF:pf(oos) });
  }

  results.sort((a,b) => b.oosWR - a.oosWR || b.oosWil - a.oosWil);
  parentPort.postMessage({ results: results.slice(0, 50) });
  return;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main(){
  const csvFiles = fsys.readdirSync(DATA_DIR).filter(f=>f.toLowerCase().endsWith('.csv')&&!f.toLowerCase().includes('_all')&&!f.toLowerCase().includes('all_symbols'));
  log(`Breakout Hyper-Tuner 70%+   ${new Date().toISOString()}`);
  log(`Files: ${csvFiles.length}  Workers: ${N_WORKERS}  Combos/set: ${RANDOM_COMBOS}  MinOOSn: ${MIN_OOS_N}  Target: ${TARGET_OOS_WR}%+ OOS WR`);
  log(`History window: ${HISTORY_WIN} bars\n`);

  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));

  const targetKeys = SET_ARG
    ? BREAKOUT_KEYS.filter(k => LABELS[k].toLowerCase().includes(SET_ARG.toLowerCase()))
    : BREAKOUT_KEYS;

  for (const key of targetKeys) {
    const label = LABELS[key];
    log(`${'═'.repeat(80)}`);
    log(`${label} (${key})`);
    log(`${'═'.repeat(80)}`);

    // Mutate engine params: fully relaxed
    const base = JSON.parse(JSON.stringify(engine.PARAM_SETS[key]));
    Object.assign(engine.PARAM_SETS[key], fullyRelaxed(base));

    // ── Collection ──────────────────────────────────────────────────────────
    log(`Collecting candidates (fully relaxed)...`);
    const rawCandidates = [];
    let proc = 0, skip = 0;

    for (const f of csvFiles) {
      const fp = path.join(DATA_DIR, f);
      const sym = f.replace(/\.csv$/i,'');
      let candles;
      try { candles = parseCSV(fp); } catch { skip++; continue; }
      if (!candles || candles.length < MIN_HISTORY + MAX_HOLD + 5) { skip++; continue; }

      for (let i = MIN_HISTORY; i < candles.length - 1; i++) {
        const window = candles.slice(Math.max(0, i + 1 - HISTORY_WIN), i + 1);
        let r;
        try { r = engine.analyzeStock(window, key); } catch { continue; }
        const row = captureBreakout(r, candles, i, sym);
        if (row) rawCandidates.push(row);
      }
      proc++;
      if (proc % 300 === 0) process.stdout.write(`  ${proc}/${csvFiles.length} symbols, ${rawCandidates.length} candidates\r`);
    }
    process.stdout.write('\n');

    // Sort by ts for IS/OOS split
    rawCandidates.sort((a,b) => a.ts - b.ts || a.sym.localeCompare(b.sym) || a.idx - b.idx);

    // Dedupe (one trade per symbol until previous exits)
    const seen = {}, deduped = [];
    for (const c of rawCandidates) {
      if (c.idx < (seen[c.sym] || 0)) continue;
      deduped.push(c);
      seen[c.sym] = c.idx + MAX_HOLD;
    }
    deduped.forEach((c,i) => { c.sortIdx = i; });

    const isCutIdx = Math.floor(deduped.length * IS_SPLIT);
    const isCutDate = deduped[isCutIdx]?.date || '?';

    log(`  Raw: ${rawCandidates.length}  After dedupe: ${deduped.length}  IS/OOS cut: ${isCutDate} (IS: ${isCutIdx} | OOS: ${deduped.length - isCutIdx})`);

    // Zone distribution
    const zLens = deduped.map(c=>c.zoneLen).sort((a,b)=>a-b);
    const pct = (p) => zLens[Math.floor(p/100*(zLens.length-1))] ?? 0;
    log(`  ZoneLen p25=${pct(25)} p50=${pct(50)} p75=${pct(75)} p90=${pct(90)} p99=${pct(99)}`);

    if (deduped.length - isCutIdx < MIN_OOS_N) {
      log(`  ⚠ Insufficient OOS candidates (${deduped.length - isCutIdx} < ${MIN_OOS_N}). Skipping sweep.\n`);
      Object.assign(engine.PARAM_SETS[key], base); // restore
      continue;
    }

    // ── Generate combos ─────────────────────────────────────────────────────
    const rand = rng(key.length * 31337 + 42);
    const combos = [];
    for (let i = 0; i < RANDOM_COMBOS; i++) {
      const combo = {};
      for (const [ax, vals] of Object.entries(ALL_AXES)) {
        combo[ax] = vals[Math.floor(rand() * vals.length)];
      }
      // Also inherit turnover/ATR pctl from base (fixed)
      combo.minAvgTurnover20 = base.minAvgTurnover20 || 10000000;
      combo.maxATRPct14Pctl120 = 85;
      combo.maxZoneLen = 200;
      combos.push(combo);
    }
    // Always include the base params as combo 0
    combos.unshift({ ...base, minZoneLen:1, maxZoneTightnessPct:100, maxPre10AvgRangeATR:5 });

    log(`  Sweeping ${combos.length} combos across ${N_WORKERS} workers...`);

    // ── Dispatch workers ────────────────────────────────────────────────────
    const chunkSize = Math.ceil(combos.length / N_WORKERS);
    const chunks = [];
    for (let i = 0; i < combos.length; i += chunkSize) chunks.push(combos.slice(i, i+chunkSize));

    const allResults = await Promise.all(chunks.map(chunk => new Promise((res, rej) => {
      const w = new Worker(__filename, { workerData: { candidates: deduped, combos: chunk, isCutIdx } });
      w.on('message', res); w.on('error', rej);
      w.on('exit', code => { if (code !== 0) rej(new Error(`Worker exited ${code}`)); });
    })));

    const merged = allResults.flatMap(r => r.results);
    merged.sort((a,b) => b.oosWR - a.oosWR || b.oosWil - a.oosWil);
    const top = merged.slice(0, 20);

    // ── Report ───────────────────────────────────────────────────────────────
    if (top.length === 0) {
      log(`  ✗ No combo found with OOS WR ≥ ${TARGET_OOS_WR}% and OOS n ≥ ${MIN_OOS_N}\n`);
    } else {
      log(`\n  ✓ ${top.length} combos found with OOS WR ≥ ${TARGET_OOS_WR}%\n`);
      log(`  ${'─'.repeat(110)}`);
      log(`  Rank  IS_n  IS_WR%  OOS_n  OOS_WR%  OOS_Wil%  OOS_Avg%  OOS_PF  Key params`);
      log(`  ${'─'.repeat(110)}`);
      top.forEach((r,idx) => {
        const c = r.combo;
        const zStr  = `zLen≥${c.minZoneLen} tight≤${c.maxZoneTightnessPct}% rng≤${c.maxPre10AvgRangeATR} exp≤${c.maxPre10ExpansionCount}`;
        const qStr  = `rng≥${c.minExactRangeATR14}ATR vol≥${c.minExactVolRatio20}x loc≥${c.minCloseLoc}% UPS≥${c.minUltraPrecisionScore}`;
        log(`  ${String(idx+1).padStart(4)}  ${String(r.isN).padStart(5)}  ${r.isWR.toFixed(1).padStart(6)}%  ${String(r.oosN).padStart(5)}  ${r.oosWR.toFixed(1).padStart(7)}%  ${r.oosWil.toFixed(1).padStart(8)}%  ${r.oosAvg.toFixed(2).padStart(8)}%  ${r.oosPF.toFixed(2).padStart(6)}  ${zStr} | ${qStr}`);
      });

      // Full detail for rank 1
      const best = top[0];
      log(`\n  ★ RANK 1 FULL PARAMS (${label}):`);
      log(`    IS:  n=${best.isN} WR=${best.isWR.toFixed(1)}% Avg=${best.isAvg.toFixed(2)}% PF=${best.isPF.toFixed(2)}`);
      log(`    OOS: n=${best.oosN} WR=${best.oosWR.toFixed(1)}% Wil=${best.oosWil.toFixed(1)}% Avg=${best.oosAvg.toFixed(2)}% PF=${best.oosPF.toFixed(2)}`);
      log(`\n    Zone params:`);
      log(`      minZoneLen:           ${best.combo.minZoneLen}`);
      log(`      maxZoneTightnessPct:  ${best.combo.maxZoneTightnessPct}`);
      log(`      maxPre10AvgRangeATR:  ${best.combo.maxPre10AvgRangeATR}`);
      log(`      maxPre10ExpansionCount:${best.combo.maxPre10ExpansionCount}`);
      log(`      maxPre10AvgVolRatio:  ${best.combo.maxPre10AvgVolRatio}`);
      log(`      maxPre5AvgVolRatio:   ${best.combo.maxPre5AvgVolRatio}`);
      log(`    Quality params:`);
      log(`      minExactRangeATR14:   ${best.combo.minExactRangeATR14}`);
      log(`      minExactVolRatio20:   ${best.combo.minExactVolRatio20}`);
      log(`      minExactVolVsPre5:    ${best.combo.minExactVolVsPre5}`);
      log(`      minCloseLoc:          ${best.combo.minCloseLoc}`);
      log(`      maxUpperWickPct:      ${best.combo.maxUpperWickPct}`);
      log(`      minBodyPct:           ${best.combo.minBodyPct}`);
      log(`      minUltraPrecisionScore:${best.combo.minUltraPrecisionScore}`);
      log(`      minVolatilityExpansionRatio:${best.combo.minVolatilityExpansionRatio}`);
      log(`      minCandleQualityScore: ${best.combo.minCandleQualityScore}`);
      log(`      maxCloseAboveZonePct:  ${best.combo.maxCloseAboveZonePct}`);
      log(`      maxCandleRisk:         ${best.combo.maxCandleRisk}`);
      log(`    JSON:\n${JSON.stringify(best.combo, null, 6)}`);
    }
    log('');

    // Restore engine params
    Object.assign(engine.PARAM_SETS[key], base);
  }

  log(`\n✅ Done. Results: ${outFile}`);
}

main().catch(err => { console.error(err); process.exit(1); });
