'use strict';
// Find stocks that cause analyzeStock to hang
// Run: node scripts/findHangingStocks.js

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled_proposed');
const DATE_FROM  = '2019-01-01';

const { analyzeStock, PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

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
  const iDate  = hdr.indexOf('date'); const iOpen = hdr.indexOf('open');
  const iHigh  = hdr.indexOf('high'); const iLow  = hdr.indexOf('low');
  const iClose = hdr.findIndex(h => h === 'close' || h === 'adj close');
  const iVol   = hdr.findIndex(h => h === 'volume');
  if (iClose < 0 || iVol < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]?.trim() ?? '');
    if (iso < DATE_FROM || ts === 0) continue;
    const c = +p[iClose], o = +p[iOpen]||c, h = +p[iHigh]||c, l = +p[iLow]||c, v = +p[iVol]||0;
    if (isNaN(c) || c <= 0) continue;
    out.push({ ts, date: iso, o, h, l, c, v });
  }
  return out;
}

const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv')).map(f => path.join(DATA_DIR, f));
const KEYS = ['optimized_deployable_20plus','optimized_highprecision_15plus','optimized_elite_10plus','optimized_ultraselective_8plus','sniper_95plus'];
const hanging = [];

console.log(`Scanning ${allFiles.length} stocks for hanging calls...`);

for (const fp of allFiles) {
  const sym     = path.basename(fp).replace(/_NS_OHLCV\.csv$/,'').replace(/\.csv$/,'');
  const candles = parseCSV(fp);
  if (candles.length < 100) continue;

  let slowSym = false;
  for (const key of KEYS) {
    // Test a few representative slices: i=60, i=150, i=250, last
    for (const i of [60, 150, 250, candles.length - 1]) {
      if (i >= candles.length) continue;
      const t0 = Date.now();
      try {
        analyzeStock(candles.slice(Math.max(0, i-299), i+1), key);
      } catch {}
      const ms = Date.now() - t0;
      if (ms > 2000) {
        console.log(`  ⚠️  SLOW: ${sym} key=${key} i=${i} took ${ms}ms`);
        hanging.push({ sym, key, i, ms });
        slowSym = true;
      }
    }
    if (slowSym) break;
  }

  process.stdout.write(`\r  ${sym.padEnd(20)} ...`);
}

console.log('\n\nDone.');
if (hanging.length === 0) {
  console.log('✅  No hanging stocks found — analyzeStock is fast on all stocks.');
  console.log('    The optimizer hang must be caused by something else.');
} else {
  console.log(`\n❌  ${hanging.length} slow calls found:`);
  for (const h of hanging) console.log(`    ${h.sym}  key=${h.key}  i=${h.i}  ${h.ms}ms`);
}

fs.writeFileSync(path.join(__dirname, 'hangingStocks.json'), JSON.stringify(hanging, null, 2));
