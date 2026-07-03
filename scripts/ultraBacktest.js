'use strict';
// Ultra-Selective backtest: v10 baseline vs v11-fp (fingerprint-tuned)
// Single-threaded — Ultra fires rarely so no workers needed
// Run: node scripts/ultraBacktest.js

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const DATE_FROM = '2019-01-01';
const KEY       = 'optimized_ultraselective_8plus';
const ACTIONABLE = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const MONTH_MAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseDate(s) {
  s = s.trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [d,mon,y] = s.split('-');
    const iso = `${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
    return { iso, ts: Math.floor(new Date(iso).getTime()/1000) };
  }
  const ts = Math.floor(new Date(s).getTime()/1000);
  return { iso: s.slice(0,10), ts: isNaN(ts)?0:ts };
}
function parseCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const hdr   = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const iDate =hdr.indexOf('date'),iOpen=hdr.indexOf('open'),iHigh=hdr.indexOf('high'),iLow=hdr.indexOf('low');
  const iClose=hdr.findIndex(h=>h==='close'||h==='adj close'),iVol=hdr.findIndex(h=>h==='volume');
  if (iClose<0||iVol<0) return [];
  const out=[];
  for (let i=1;i<lines.length;i++) {
    const p=lines[i].split(',');
    const {iso,ts}=parseDate(p[iDate]?.trim()??'');
    if (iso<DATE_FROM||ts===0) continue;
    const c=+p[iClose],o=+p[iOpen]||c,h=+p[iHigh]||c,l=+p[iLow]||c,v=+p[iVol]||0;
    if (isNaN(c)||c<=0) continue;
    out.push({ts,date:iso,o,h,l,c,v});
  }
  return out;
}

function runEngine(engineDir, label) {
  const { analyzeStock } = require(engineDir + '/stockEngine.js');
  const allFiles = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')).map(f=>path.join(DATA_DIR,f));
  const stats = { isW:0,isL:0,isTotal:0,oosW:0,oosL:0,oosTotal:0, trades:[] };

  let scanned = 0;
  for (const fp of allFiles) {
    const candles = parseCSV(fp);
    if (candles.length < 100) { scanned++; continue; }
    const isEnd = Math.floor(candles.length * 0.6);
    const sym = path.basename(fp).replace(/_NS_OHLCV\.csv$/,'').replace(/\.csv$/,'');

    for (let i = 50; i < candles.length - 10; i++) {
      const slice = candles.slice(Math.max(0,i-299),i+1);
      let r;
      try { r = analyzeStock(slice, KEY); } catch { continue; }
      if (!r || !ACTIONABLE.has(r.stage)) continue;

      const entry = candles[i].c;
      const tgt = entry * 1.05, stp = entry * 0.97;
      let outcome = null;
      for (let j=i+1; j<Math.min(i+11,candles.length); j++) {
        if (candles[j].l <= stp) { outcome='L'; break; }
        if (candles[j].h >= tgt) { outcome='W'; break; }
      }
      if (!outcome) {
        const fc = candles[Math.min(i+10,candles.length-1)].c;
        outcome = fc >= entry*1.01 ? 'W' : 'L';
      }

      const isIS = i < isEnd;
      if (isIS) { stats.isTotal++; outcome==='W'?stats.isW++:stats.isL++; }
      else       { stats.oosTotal++; outcome==='W'?stats.oosW++:stats.oosL++; }
      stats.trades.push({ sym, date: candles[i].date, outcome, isIS,
        bodyPct: r.bodyPct, exactVolVsPre5: r.exactVolVsPre5 });
    }
    scanned++;
    if (scanned % 100 === 0) process.stdout.write(`\r  [${label}] ${scanned}/${allFiles.length}...`);
  }
  process.stdout.write(`\r  [${label}] ${scanned}/${allFiles.length} done.     \n`);
  return { label, stats };
}

const t0 = Date.now();
const allFiles = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv'));
console.log(`Ultra backtest — ${allFiles.length} stocks, single-threaded x2\n`);

const baseline = runEngine(path.join(__dirname,'_compiled'),          'v10 baseline          ');
const proposed = runEngine(path.join(__dirname,'_compiled_proposed'), 'v11-fp bodyPct≥70 vol≥3');

const elapsed = ((Date.now()-t0)/1000).toFixed(1);
console.log(`\nCompleted in ${elapsed}s`);

for (const { label, stats: s } of [baseline, proposed]) {
  const isWR  = s.isTotal  > 0 ? (s.isW /s.isTotal *100).toFixed(1) : '–';
  const oosWR = s.oosTotal > 0 ? (s.oosW/s.oosTotal*100).toFixed(1) : '–';
  const isPF  = s.isL  > 0 ? (s.isW /s.isL ).toFixed(2) : '∞';
  const oosPF = s.oosL > 0 ? (s.oosW/s.oosL).toFixed(2) : '∞';
  console.log(`\n── ${label} ──`);
  console.log(`  IS : ${s.isW}W ${s.isL}L / ${s.isTotal} trades  WR=${isWR}%  PF=${isPF}`);
  console.log(`  OOS: ${s.oosW}W ${s.oosL}L / ${s.oosTotal} trades  WR=${oosWR}%  PF=${oosPF}`);
}

// Show OOS trade list for proposed
console.log('\n  OOS trades (proposed):');
proposed.stats.trades.filter(t=>!t.isIS).forEach(t=>
  console.log(`    ${t.sym.padEnd(20)} ${t.date}  ${t.outcome}  body=${t.bodyPct.toFixed(0)}%  vol/pre5=${t.exactVolVsPre5.toFixed(1)}`)
);
