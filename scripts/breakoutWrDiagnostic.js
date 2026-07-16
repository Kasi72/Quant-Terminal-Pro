/**
 * Breakout WR Diagnostic — "what is actually achievable?"
 * Reports best achievable OOS WR per breakout set and top quality filters that add edge.
 * Run: node scripts/breakoutWrDiagnostic.js
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fsys = require('fs');
const os = require('os');

const DATA_DIR    = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR  = path.join(__dirname, '_compiled_current');
const HISTORY_WIN = 500;
const MIN_HISTORY = 220;
const MAX_HOLD    = 20;
const IS_SPLIT    = 0.70;
const N_WORKERS   = Math.max(1, Math.min(os.cpus().length - 1, 16));
const RANDOM_COMBOS = 15000;
const MIN_OOS_N   = 30;  // lower threshold to see best achievable

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const ACTIONABLE = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const stamp = new Date().toISOString().replace(/[:.]/g,'_').slice(0,19);
const outFile = path.join(__dirname, `breakout_wr_diagnostic_${stamp}.txt`);

function log(s){ console.log(s); fsys.appendFileSync(outFile, s+'\n'); }
function parseDate(raw){ const s=String(raw||'').trim(); if(/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)){const[dd,mon,yyyy]=s.split('-');const mm=String((MONTHS[mon.toLowerCase()]??0)+1).padStart(2,'0');return{iso:`${yyyy}-${mm}-${dd.padStart(2,'0')}`,ts:Math.floor(Date.UTC(+yyyy,+mm-1,+dd)/1000)};}if(/^\d{4}-\d{2}-\d{2}/.test(s)){const iso=s.slice(0,10);return{iso,ts:Math.floor(Date.parse(`${iso}T00:00:00Z`)/1000)};}return{iso:'',ts:0};}
function parseCSV(fp){ const lines=fsys.readFileSync(fp,'utf8').trim().split(/\r?\n/); const h=lines[0].split(',').map(x=>x.trim().toLowerCase()); const[iDate,iOpen,iHigh,iLow,iClose,iVol]=['date','open','high','low','close','volume'].map(n=>h.indexOf(n)); if([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i=>i<0))return[]; const out=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(',');const{iso,ts}=parseDate(p[iDate]);const o=+p[iOpen],hh=+p[iHigh],lo=+p[iLow],c=+p[iClose],v=+p[iVol];if(!iso||!ts||!isFinite(o)||!isFinite(hh)||!isFinite(lo)||!isFinite(c)||c<=0||hh<lo)continue;out.push({ts,date:iso,o,h:hh,l:lo,c,v:isFinite(v)?v:0});}out.sort((a,b)=>a.ts-b.ts);return out;}
function wilson(h,n){ if(n<=0)return 0;const z=1.96,p=h/n;return((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n))*100; }
function rng(seed){ let x=seed>>>0; return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;}; }

function fullyRelaxed(base) {
  return {
    ...base,
    minAvgTurnover20: Math.min(base.minAvgTurnover20||10000000, 5000000),
    maxATRPct14Pctl120: 99,
    maxPre10AvgRangeATR: 5.0, maxPre10ExpansionCount: 20,
    minZoneLen: 1, maxZoneLen: 200, maxZoneTightnessPct: 100,
    maxPre10AvgVolRatio: 5.0, maxPre5AvgVolRatio: 5.0,
    maxPre10HighVolCount: 20, maxPre10RedVolBias: 10,
    minExactRangeATR14: 0.05, maxExactRangeATR14: 30,
    minExactVolRatio20: 0.05, minExactVolVsPre5: 0.05,
    minCloseLoc: 0, maxUpperWickPct: 100, minBodyPct: 0, maxCandleRisk: 25,
    minUltraPrecisionScore: 0, minRSI2: 0,
    minVolatilityExpansionRatio: null, minCandleQualityScore: null, maxCloseAboveZonePct: null,
    forensic: {},
  };
}

function levelsFromEngine(pe, fallback){
  const entry=Number(pe?.plannedEntry||fallback),stop=Number(pe?.tacticalStop||entry*0.94),
        t1=Number(pe?.target5||entry*1.05);
  if(![entry,stop,t1].every(Number.isFinite)||entry<=0||stop<=0||stop>=entry)return null;
  return{entry,stop,t1};
}

function simulateSimple(candles, sigIdx, levels){
  const entryIdx=sigIdx+1; if(entryIdx>=candles.length)return null;
  const entry=candles[entryIdx].o; if(!entry||entry<=0)return null;
  let exitIdx=Math.min(entryIdx+MAX_HOLD-1,candles.length-1);
  for(let i=entryIdx;i<=exitIdx;i++){
    if(candles[i].l<=levels.stop) return{pnl:(levels.stop-entry)/entry*100,win:false};
    if(candles[i].h>=levels.t1)   return{pnl:(levels.t1-entry)/entry*100,win:true};
  }
  const closeP=(candles[exitIdx].c-entry)/entry*100;
  return{pnl:closeP,win:closeP>0};
}

function captureBreakout(r, candles, i){
  if(!ACTIONABLE.has(r.stage))return null;
  const levels=levelsFromEngine(r.priceEngine,candles[i].c); if(!levels)return null;
  const sim=simulateSimple(candles,i,levels); if(!sim)return null;
  return{
    ts:candles[i].ts, date:candles[i].date, win:sim.win, pnl:sim.pnl,
    zoneLen:r.zone?.windowLength??0, zoneTightnessPct:r.zone?.zoneTightnessPct??999,
    pre10AvgRangeATR:r.pre10AvgRangeATR, pre10ExpansionCount:r.pre10ExpansionCount,
    pre10AvgVolRatio:r.pre10AvgVolRatio, pre5AvgVolRatio:r.pre5AvgVolRatio,
    exactRangeATR14:r.exactRangeATR14, exactVolRatio20:r.exactVolRatio20,
    exactVolVsPre5:r.exactVolVsPre5, closeLoc:r.closeLoc,
    upperWickPct:r.upperWickPct, bodyPct:r.bodyPct, signalRangePct:r.signalRangePct,
    ultraPrecisionScore:r.ultraPrecisionScore, rsi2:r.rsi2,
    volatilityExpansionRatio:r.volatilityExpansionRatio, candleQualityScore:r.candleQualityScore,
    avgTurnover20:r.avgTurnover20, atrPct14Pctl120:r.atrPct14Pctl120,
  };
}

function corePasses(s, p){
  if(s.exactRangeATR14<(p.minExactRangeATR14||0))return false;
  if(s.exactVolRatio20<(p.minExactVolRatio20||0))return false;
  if(s.exactVolVsPre5<(p.minExactVolVsPre5||0))return false;
  if(s.closeLoc<(p.minCloseLoc||0))return false;
  if(s.upperWickPct>(p.maxUpperWickPct||100))return false;
  if(s.bodyPct<(p.minBodyPct||0))return false;
  if(s.signalRangePct>(p.maxCandleRisk||99))return false;
  if(s.ultraPrecisionScore<(p.minUltraPrecisionScore||0))return false;
  if(p.minVolatilityExpansionRatio!=null&&s.volatilityExpansionRatio<p.minVolatilityExpansionRatio)return false;
  if(p.minCandleQualityScore!=null&&s.candleQualityScore<p.minCandleQualityScore)return false;
  if(s.pre10AvgRangeATR>(p.maxPre10AvgRangeATR||99))return false;
  if(s.pre10ExpansionCount>(p.maxPre10ExpansionCount||99))return false;
  if(s.pre10AvgVolRatio>(p.maxPre10AvgVolRatio||99))return false;
  if(s.pre5AvgVolRatio>(p.maxPre5AvgVolRatio||99))return false;
  return true;
}

const ALL_AXES = {
  minExactRangeATR14:   [0.05, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
  minExactVolRatio20:   [0.05, 0.8, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0],
  minExactVolVsPre5:    [0.05, 0.8, 1.2, 1.5, 2.0, 3.0],
  minCloseLoc:          [0, 40, 50, 60, 65, 70, 75, 80, 85],
  maxUpperWickPct:      [10, 15, 18, 20, 25, 30, 40, 100],
  minBodyPct:           [0, 20, 35, 50, 60, 70, 80],
  minUltraPrecisionScore:[0, 10, 25, 40, 50, 60, 70, 80],
  minVolatilityExpansionRatio:[null, 0.5, 1.0, 1.4, 2.0, 2.5, 3.0],
  minCandleQualityScore:[null, 1, 2, 3, 4, 5, 6],
  maxCandleRisk:        [3, 4, 5, 6, 7, 8.5, 10, 15, 25],
  maxPre10AvgRangeATR:  [0.7, 0.8, 1.0, 1.15, 1.3, 1.5, 2.0, 5.0],
  maxPre10ExpansionCount:[0, 1, 2, 3, 5, 20],
  maxPre10AvgVolRatio:  [0.7, 0.85, 1.0, 1.1, 1.3, 5.0],
  maxPre5AvgVolRatio:   [0.85, 1.0, 1.1, 1.3, 1.5, 5.0],
};

if (!isMainThread) {
  const { candidates, combos, isCutIdx } = workerData;
  const results = [];
  for (const combo of combos) {
    const passed = candidates.filter(s => corePasses(s, combo));
    const oos = passed.filter(s => s.sortIdx >= isCutIdx);
    if (oos.length < MIN_OOS_N) continue;
    const oosWins = oos.filter(s => s.win).length;
    const oosWR   = oosWins / oos.length * 100;
    const is      = passed.filter(s => s.sortIdx < isCutIdx);
    const isWR    = is.length ? is.filter(s=>s.win).length/is.length*100 : 0;
    results.push({ combo, isN:is.length, oosN:oos.length, oosWR, oosWil:wilson(oosWins,oos.length), isWR });
  }
  results.sort((a,b) => b.oosWR - a.oosWR || b.oosWil - a.oosWil);
  parentPort.postMessage({ results: results.slice(0, 30) });
  return;
}

async function main(){
  const csvFiles = fsys.readdirSync(DATA_DIR).filter(f=>f.toLowerCase().endsWith('.csv'));
  log(`Breakout WR Diagnostic — Best Achievable   ${new Date().toISOString()}`);
  log(`Files: ${csvFiles.length}  Workers: ${N_WORKERS}  Combos: ${RANDOM_COMBOS}  MinOOSn: ${MIN_OOS_N}\n`);

  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const KEY = 'optimized_deployable_20plus'; // collect once, share across all 5 sets via post-hoc filter
  const base = JSON.parse(JSON.stringify(engine.PARAM_SETS[KEY]));
  Object.assign(engine.PARAM_SETS[KEY], fullyRelaxed(base));

  log(`Collecting candidates (fully relaxed — all sets share same pool)...`);
  const rawCandidates = [];
  let proc = 0;
  for (const f of csvFiles) {
    const fp = path.join(DATA_DIR, f);
    const sym = f.replace(/\.csv$/i,'');
    let candles; try { candles = parseCSV(fp); } catch { continue; }
    if (!candles || candles.length < MIN_HISTORY + MAX_HOLD + 5) continue;
    for (let i = MIN_HISTORY; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i + 1 - HISTORY_WIN), i + 1);
      let r; try { r = engine.analyzeStock(window, KEY); } catch { continue; }
      const row = captureBreakout(r, candles, i); if (row) rawCandidates.push({...row, sym});
    }
    proc++;
    if (proc % 300 === 0) process.stdout.write(`  ${proc}/${csvFiles.length} symbols, ${rawCandidates.length} candidates\r`);
  }
  process.stdout.write('\n');
  Object.assign(engine.PARAM_SETS[KEY], base);

  // Sort + dedupe
  rawCandidates.sort((a,b) => a.ts - b.ts || a.sym.localeCompare(b.sym));
  const seen = {}, deduped = [];
  for (const c of rawCandidates) {
    if (c.sortIdx !== undefined) continue; // already set
    const key = c.sym;
    if (c.ts < (seen[key] || 0)) continue;
    deduped.push(c);
    seen[key] = c.ts + MAX_HOLD * 86400;
  }
  deduped.forEach((c,i) => { c.sortIdx = i; });
  const isCutIdx = Math.floor(deduped.length * IS_SPLIT);
  const isCutDate = deduped[isCutIdx]?.date || '?';

  const baseWins = deduped.filter(c=>c.win).length;
  log(`Raw pool: ${deduped.length} (IS: ${isCutIdx} | OOS: ${deduped.length-isCutIdx})`);
  log(`IS/OOS cut: ${isCutDate}`);
  log(`Base WR (no filter): ${(baseWins/deduped.length*100).toFixed(1)}%`);

  const oosPool = deduped.slice(isCutIdx);
  const oosBaseWr = oosPool.filter(c=>c.win).length / oosPool.length * 100;
  log(`OOS Base WR: ${oosBaseWr.toFixed(1)}%`);

  // Monthly WR breakdown
  log('\nMonthly OOS WR breakdown:');
  const byMonth = {};
  for (const c of oosPool) {
    const mo = c.date.slice(0,7);
    if (!byMonth[mo]) byMonth[mo] = {w:0,n:0};
    byMonth[mo].n++; if(c.win) byMonth[mo].w++;
  }
  Object.keys(byMonth).sort().forEach(mo => {
    const{w,n}=byMonth[mo]; log(`  ${mo}: n=${n} WR=${(w/n*100).toFixed(0)}%`);
  });

  // Sweep for best achievable
  log(`\nSweeping ${RANDOM_COMBOS} quality-filter combos for best achievable OOS WR...`);
  const rand = rng(42);
  const combos = [];
  for (let i = 0; i < RANDOM_COMBOS; i++) {
    const combo = {};
    for (const [ax, vals] of Object.entries(ALL_AXES)) combo[ax] = vals[Math.floor(rand()*vals.length)];
    combos.push(combo);
  }

  const chunkSize = Math.ceil(combos.length / N_WORKERS);
  const chunks = [];
  for (let i = 0; i < combos.length; i += chunkSize) chunks.push(combos.slice(i, i+chunkSize));

  const allResults = await Promise.all(chunks.map(chunk => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { candidates: deduped, combos: chunk, isCutIdx } });
    w.on('message', res); w.on('error', rej);
    w.on('exit', code => { if(code!==0) rej(new Error(`Worker exited ${code}`)); });
  })));

  const merged = allResults.flatMap(r => r.results);
  merged.sort((a,b) => b.oosWR - a.oosWR || b.oosWil - a.oosWil);
  const top = merged.slice(0, 20);

  log(`\n${'═'.repeat(100)}`);
  log(`BEST ACHIEVABLE OOS WR — Top 20 combos`);
  log(`${'═'.repeat(100)}`);
  log(`Rank  IS_n  IS_WR%  OOS_n  OOS_WR%  OOS_Wil%  Key filters`);
  log(`${'─'.repeat(100)}`);
  top.forEach((r,idx) => {
    const c = r.combo;
    const f = `rng≥${c.minExactRangeATR14}ATR vol≥${c.minExactVolRatio20}x loc≥${c.minCloseLoc}% UPS≥${c.minUltraPrecisionScore} VER≥${c.minVolatilityExpansionRatio} risk≤${c.maxCandleRisk}%`;
    log(`${String(idx+1).padStart(4)}  ${String(r.isN).padStart(5)}  ${r.isWR.toFixed(1).padStart(6)}%  ${String(r.oosN).padStart(5)}  ${r.oosWR.toFixed(1).padStart(7)}%  ${r.oosWil.toFixed(1).padStart(8)}%  ${f}`);
  });

  if (top.length > 0) {
    const best = top[0];
    log(`\n★ BEST ACHIEVABLE: IS_n=${best.isN} IS_WR=${best.isWR.toFixed(1)}% | OOS_n=${best.oosN} OOS_WR=${best.oosWR.toFixed(1)}% Wil=${best.oosWil.toFixed(1)}%`);
    log(`  Full params JSON:\n${JSON.stringify(best.combo, null, 4)}`);
  }

  log(`\n✅ Done. Results: ${outFile}`);
}

main().catch(err => { console.error(err); process.exit(1); });
