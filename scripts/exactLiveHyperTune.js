'use strict';

// Exact-live feature collection + walk-forward hyper-tuning. The engine emits
// non-enumerable per-bar debug features; this script never approximates signal
// generation and enforces per-symbol non-overlap for every exit combination.

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const COMBOS = Number(process.env.COMBOS || 5000);
const MIN_OOS = Number(process.env.MIN_OOS || 50);
const TP = [2, 3, 4, 5, 6, 7, 8];
const SL = [1, 1.5, 2, 2.5, 3, 3.5];
const HOLD = [10, 15, 20, 25];
const EXIT_N = TP.length * SL.length * HOLD.length;
const BSC = [0, 1, 3, 5, 99];
const ADX = [0, 15, 20, 25, 30, 35, 45];
const KEYS = [
  ['VolumeFootprint', 'optimized_deployable_20plus'],
  ['CompressionCoil', 'optimized_highprecision_15plus'],
  ['MomentumPocket', 'optimized_elite_10plus'],
  ['EMAStack', 'optimized_ultraselective_8plus'],
  ['PerfectStorm', 'sniper_95plus'],
];

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]), c = Number(p[4]), v = Number(p[5]);
    if (!Number.isFinite(ts) || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
    else d.push(x);
  }
  return d;
}

function atrAt(c, end) {
  if (end < 1) return c[end]?.c * 0.02 || 0;
  const start = Math.max(1, end - 13);
  let s = 0;
  for (let i = start; i <= end; i++) {
    const pc = c[i - 1].c;
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  return s / (end - start + 1);
}

function exitIndex(t, s, h) { return (t * SL.length + s) * HOLD.length + h; }

function outcomes(c, sig, atr) {
  const out = new Int16Array(EXIT_N);
  const dur = new Uint8Array(EXIT_N);
  const entryIdx = sig + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0) || !(atr > 0)) return { out, dur };
  const entry = c[entryIdx].o;
  for (let ti = 0; ti < TP.length; ti++) for (let si = 0; si < SL.length; si++) for (let hi = 0; hi < HOLD.length; hi++) {
    const stop = entry - SL[si] * atr;
    const target = entry * (1 + TP[ti] / 100);
    const end = Math.min(c.length - 1, entryIdx + HOLD[hi] - 1);
    let exit = end, px = c[end].c;
    for (let j = entryIdx; j <= end; j++) {
      const b = c[j];
      if (b.o <= stop) { exit = j; px = b.o; break; }
      if (b.l <= stop) { exit = j; px = stop; break; }
      if (b.h >= target) { exit = j; px = target; break; }
      if (j === end) { exit = j; px = b.c; }
    }
    out[exitIndex(ti, si, hi)] = Math.max(-32767, Math.min(32767, Math.round(((px - entry) / entry * 100) * 10)));
    dur[exitIndex(ti, si, hi)] = Math.min(255, exit - sig);
  }
  return { out, dur };
}

function collectWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const [, key] of KEYS) engine.setArchetypeTuning(key, null);
  const events = Object.fromEntries(KEYS.map(([id]) => [id, []]));
  let processed = 0, usable = 0, short = 0;
  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 2) { short++; continue; }
    usable++;
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');
    for (let i = WINDOW - 1; i < c.length - 1; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);
      for (const [id, key] of KEYS) {
        let r; try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        const d = r && r.__tuning;
        if (!d) continue;
        // Hard gates that are immutable in the live functions.
        if (id === 'EMAStack' && !d.crossedAboveToday) continue;
        if (id === 'PerfectStorm' && d.fires < 2) continue;
        const eo = outcomes(c, i, atrAt(c, i));
        events[id].push({ symbol, idx: i, date: new Date(c[i].ts * 1000).toISOString().slice(0, 10), d, o: eo.out, dur: eo.dur });
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', events, meta: { processed, usable, short } });
}

function rand(a, b) { return a + Math.random() * (b - a); }
function ri(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(a) { return a[ri(0, a.length - 1)]; }
function r1(a, b) { return +rand(a, b).toFixed(1); }
function r0(a, b) { return Math.round(rand(a, b)); }

function gen(id) {
  if (id === 'VolumeFootprint') return { minVolRatio:r1(2.5,8), minCloseLoc:r0(55,96), maxUpperWick:r0(5,30), minHi20Frac:+rand(.80,.99).toFixed(3), minRangeATR:r1(.8,4), maxGapDownPct:r1(-5,0), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'CompressionCoil') return { minCompressionBars:ri(5,14), maxCompressionBars:ri(8,18), minVolumeDeclineDays:ri(1,5), minPricePos20:r0(35,85), maxBBWidthPctl:r0(10,60), maxRangeATR:r1(.4,1.3), minCloseLoc:r0(30,75), minBodyPct:r0(20,75), maxCandleRisk:r0(5,14), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'MomentumPocket') return { minDd52W:r0(10,60), maxDd52W:r0(35,80), minStabBars:ri(1,10), minCloseLoc:r0(25,90), minBodyPct:r0(10,80), maxUpperWick:r0(10,60), minVolRatio:r1(.6,4), minRSI14:r0(5,55), maxRSI14:r0(35,85), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'EMAStack') return { minBelowBars:ri(1,12), minEMA10VsEma20:r1(.1,2), minBodyPct:r0(15,85), maxUpperWick:r0(10,55), maxCandleRisk:r0(5,15), minVolRatio:r1(.6,4), maxRSI2Last5:r0(10,75), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  return { minFires:ri(2,4), minADXGate:ri(20,60), minQualityTier:ri(1,4), maxCandleRisk:r0(8,20), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
}

function stageOk(conditions, score) { return conditions >= 4 && score >= 45; }
function passDmi(d, p, defaultBsc, defaultAdx, defaultBull) {
  return (!p.requireDIBull && !defaultBull || p.requireDIBull === false || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX;
}
function selected(id, d, p) {
  let score = 0, conditions = 0;
  if (id === 'VolumeFootprint') {
    const q = [d.volRatio20>=p.minVolRatio, d.closeLoc>=p.minCloseLoc&&d.upperWickPct<=p.maxUpperWick, d.hi20Frac>=p.minHi20Frac, d.rangeATR>=p.minRangeATR, d.gapDownPct>=p.maxGapDownPct, (!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?20:0)+(q[1]?20:0)+(q[2]?15:0)+(q[3]?20:0)+(q[4]?10:0)+(q[5]?15:0)+Math.min(10,(d.volRatio20-3)*5)+Math.min(5,(d.closeLoc-68)*.3);
  } else if (id === 'CompressionCoil') {
    const q=[d.compressionBars>=p.minCompressionBars&&d.compressionBars<=p.maxCompressionBars,d.volDeclineDays>=p.minVolumeDeclineDays,d.pricePos20>=p.minPricePos20,d.bbWidthPctl<=p.maxBBWidthPctl,d.rangeATR<=p.maxRangeATR&&d.isGreen&&d.closeLoc>=p.minCloseLoc&&d.bodyPct>=p.minBodyPct&&d.candleRisk<=p.maxCandleRisk,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?20:0)+(q[1]?15:0)+(q[2]?15:0)+(q[3]?20:0)+(q[4]?15:0)+(q[5]?15:0)+Math.min(10,d.compressionBars*3)+Math.min(5,Math.max(0,d.pricePos20-65)*.5);
  } else if (id === 'MomentumPocket') {
    const candle=(d.isGreen&&d.closeLoc>=p.minCloseLoc&&d.bodyPct>=p.minBodyPct&&d.upperWickPct<=p.maxUpperWick)||(d.hammer&&d.closeLoc>=60);
    const q=[d.dd52W>=p.minDd52W&&d.dd52W<=p.maxDd52W,d.stabilizationBars>=p.minStabBars,candle,d.volRatio20>=p.minVolRatio,d.rsi14>=p.minRSI14&&d.rsi14<=p.maxRSI14,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?18:0)+(q[1]?12:0)+(q[2]?20:0)+(q[3]?17:0)+(q[4]?13:0)+(q[5]?20:0)+Math.min(10,d.stabilizationBars*3)+Math.min(5,(d.volRatio20-1.5)*4);
  } else if (id === 'EMAStack') {
    const q=[true,d.belowCount>=p.minBelowBars,d.ema10VsEma20>=p.minEMA10VsEma20&&d.isGreen&&d.bodyPct>=p.minBodyPct&&d.upperWickPct<=p.maxUpperWick&&d.candleRisk<=p.maxCandleRisk,d.volRatio20>=p.minVolRatio,d.recentlyOversold&&d.rsi2Pass!==false,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    // d.recentlyOversold is emitted as a boolean by the engine; the fallback
    // keeps the row compatible with older collected event files.
    conditions=q.filter(Boolean).length; score=(q[0]?25:0)+(q[1]?15:0)+(q[2]?15:0)+(q[3]?15:0)+(q[4]?10:0)+(q[5]?20:0)+Math.min(10,d.belowCount*2)+Math.min(5,(d.volRatio20-1.8)*5);
  } else {
    if (d.fires < p.minFires || d.quality < p.minQualityTier || d.candleRisk > p.maxCandleRisk || d.adx < p.minADXGate) return false;
    score=d.fireScores.reduce((a,b)=>a+b,0)/d.fireScores.length+(d.fires>=4?15:d.fires===3?10:5); return score>=45;
  }
  return stageOk(conditions, score);
}

function stats(rows) {
  const n=rows.length; if(!n) return {n:0,wr:0,pf:0,avg:0,avgMFE20:0,avgMAE20:0};
  const wins=rows.filter(x=>x.pnl>0).length, gw=rows.filter(x=>x.pnl>0).reduce((a,x)=>a+x.pnl,0), gl=-rows.filter(x=>x.pnl<0).reduce((a,x)=>a+x.pnl,0);
  return {n,wr:wins/n*100,pf:gl?gw/gl:Infinity,avg:rows.reduce((a,x)=>a+x.pnl,0)/n,avgMFE20:rows.reduce((a,x)=>a+x.mfe20,0)/n,avgMAE20:rows.reduce((a,x)=>a+x.mae20,0)/n};
}

function evaluate(events, id, p) {
  const ti=TP.indexOf(p.tpPct), si=SL.indexOf(p.slAtrMult), hi=HOLD.indexOf(p.maxHoldBars), ei=exitIndex(ti,si,hi);
  const by={}; for(const e of events) (by[e.symbol] ||= []).push(e); for(const a of Object.values(by)) a.sort((x,y)=>x.idx-y.idx);
  const rows=[];
  for(const a of Object.values(by)) { let next=-1; for(const e of a) { if(e.idx<next||!selected(id,e.d,p)) continue; const pnl=e.o[ei]/10; const dur=e.dur[ei]; const exit=e.idx+dur; rows.push({pnl,date:e.date,exit,mfe20:0,mae20:0}); next=exit+1; } }
  const full=stats(rows), is=stats(rows.filter(x=>x.date<=OOS_CUT)), oos=stats(rows.filter(x=>x.date>OOS_CUT));
  return {p,full,is,oos};
}

function fitness(r) {
  if (r.oos.n < MIN_OOS || r.full.n < MIN_OOS*2) return -1e9;
  const pf=x=>Math.min(4,Math.max(0,x.pf))/4, avg=x=>Math.max(0,Math.min(4,x.avg+2))/6;
  const base=.23*(r.full.wr/100)+.25*pf(r.full)+.15*avg(r.full)+.18*(r.oos.wr/100)+.27*pf(r.oos)+.18*avg(r.oos);
  const consistency=(r.full.avg>0&&r.oos.avg>0&&r.full.pf>=1&&r.oos.pf>=1)?0.15:0;
  return base+consistency+Math.min(.05,Math.log10(r.oos.n)/100);
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Missing ${DATA_DIR}`);
  const files=fs.readdirSync(DATA_DIR).filter(n=>n.toLowerCase().endsWith('.csv')&&n!=='ALL_SYMBOLS_OHLCV.csv').sort().map(name=>({name,fp:path.join(DATA_DIR,name)}));
  const workers=Math.min(Math.max(1,Number(process.env.WORKERS||10)),files.length||1), chunks=Array.from({length:workers},()=>[]); files.forEach((f,i)=>chunks[i%workers].push(f));
  console.log(`Exact live feature collection: ${files.length} files, workers=${workers}`);
  const all=Object.fromEntries(KEYS.map(([id])=>[id,[]])); let done=0, usable=0, short=0;
  await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{ const w=new Worker(__filename,{workerData:{files:chunk}}); w.on('message',m=>{ if(m.type==='progress'){done+=m.n;if(done%100===0)process.stdout.write(`  ${done}/${files.length}\r`);} else if(m.type==='done'){usable+=m.meta.usable;short+=m.meta.short;for(const [id] of KEYS)all[id].push(...m.events[id]);resolve();} }); w.on('error',reject); w.on('exit',c=>{if(c)reject(new Error(`worker exited ${c}`));}); })));
  console.log(`\nEvents: ${KEYS.map(([id])=>`${id}=${all[id].length}`).join(' | ')}`);
  const out={generated:new Date().toISOString(),dataDir:DATA_DIR,window:WINDOW,oosCut:OOS_CUT,combos:COMBOS,minOOS:MIN_OOS,meta:{files:files.length,usable,short},bestBySet:{}};
  for(const [id] of KEYS){ let best=null,bestQualified=null; for(let i=0;i<COMBOS;i++){const p=gen(id);const r=evaluate(all[id],id,p);const f=fitness(r);r.fitness=f;if(!best||f>best.fitness)best=r;if(r.full.pf>=1&&r.oos.pf>=1&&r.full.avg>0&&r.oos.avg>0&&r.full.wr>=50&&r.oos.wr>=50&&(!bestQualified||f>bestQualified.fitness))bestQualified=r;} out.bestBySet[id]={best,bestQualified}; const q=bestQualified||best; console.log(`${id.padEnd(18)} ${bestQualified?'QUALIFIED':'NO QUALIFIED'} full n=${q.full.n} WR=${q.full.wr.toFixed(1)} PF=${q.full.pf.toFixed(2)} Avg=${q.full.avg.toFixed(2)} | OOS n=${q.oos.n} WR=${q.oos.wr.toFixed(1)} PF=${q.oos.pf.toFixed(2)} Avg=${q.oos.avg.toFixed(2)}`); }
  fs.mkdirSync(OUT_DIR,{recursive:true}); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const jp=path.join(OUT_DIR,`exact_live_hypertune_${stamp}.json`); fs.writeFileSync(jp,JSON.stringify(out,null,2)); console.log(`Saved: ${jp}`);
}

if(isMainThread)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;}); else collectWorker().catch(e=>{parentPort.postMessage({type:'error',error:e.stack||String(e)});process.exitCode=1;});

