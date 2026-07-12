'use strict';

/**
 * Elite param comparison backtest:
 *   A) ChatGPT forensic v12 "Elite Tuned" (currently live)
 *   B) Grid-v13 (grid-optimised, n=215, Wilson=51.93%)
 *
 * Iterates through ALL historical bars per stock — same methodology as
 * backtestProductionParamSets.js and compareutraselective.js.
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR      = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR    = path.join(__dirname, '_compiled_current');
const N_WORKERS     = Math.max(1, Math.min(8, os.cpus().length - 1));
const HISTORY_WINDOW = 280;
const MIN_HISTORY    = 220;
const MAX_HOLD       = 20;

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

// ── Two Elite param variants ──────────────────────────────────────────────────
const VARIANTS = {
  chatgpt_v12: {
    label: 'ChatGPT forensic v12 (live)',
    params: {
      name: 'Elite Tuned', tag: '75.0% WR',
      minAvgTurnover20: 20_000_000, maxATRPct14Pctl120: 60,
      maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
      zoneRangeATRThreshold: 1.0, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
      maxPre10AvgVolRatio: 1.0, maxPre5AvgVolRatio: 1.10,
      maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 1.1,
      breakoutMultiplier: 1.001,
      minExactRangeATR14: 1.8, maxExactRangeATR14: 6.0,
      minExactVolRatio20: 2.2, minExactVolVsPre5: 2.0,
      minCloseLoc: 55, maxUpperWickPct: 15, minBodyPct: 35, maxCandleRisk: 5.0,
      minUltraPrecisionScore: 0, minRSI2: 50,
      minVolatilityExpansionRatio: 1.4, minCandleQualityScore: 2,
      maxCloseAboveZonePct: 8.0,
    },
  },
  grid_v13: {
    label: 'Grid-v13 (n=215, Wilson=51.93%)',
    params: {
      name: 'Elite Grid-v13 10+', tag: '58.6% WR',
      minAvgTurnover20: 10_000_000, maxATRPct14Pctl120: 70,
      maxPre10AvgRangeATR: 1.1, maxPre10ExpansionCount: 3, expansionATRMultiplier: 1.1,
      zoneRangeATRThreshold: 1.0, minZoneLen: 6, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
      maxPre10AvgVolRatio: 1.10, maxPre5AvgVolRatio: 1.20,
      maxPre10HighVolCount: 3, highVolMultiplier: 1.2, maxPre10RedVolBias: 1.5,
      breakoutMultiplier: 1.001,
      minExactRangeATR14: 1.8, maxExactRangeATR14: 6.0,
      minExactVolRatio20: 1.5, minExactVolVsPre5: 2.0,
      minCloseLoc: 57, maxUpperWickPct: 13, minBodyPct: 25, maxCandleRisk: 5.0,
      minUltraPrecisionScore: 0, minRSI2: 50,
      minVolatilityExpansionRatio: 1.1, minCandleQualityScore: 2,
      maxCloseAboveZonePct: 10.0,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-');
    const mm = String((MONTHS[mon] ?? 0) + 1).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd.padStart(2,'0')}`;
    return { iso, ts: Math.floor(Date.UTC(+yyyy, +mm-1, +dd)/1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0,10);
    return { iso, ts: Math.floor(Date.parse(`${iso}T00:00:00Z`)/1000) };
  }
  const t = Date.parse(s);
  return { iso: '', ts: Number.isFinite(t) ? Math.floor(t/1000) : 0 };
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const hdr = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iDate=hdr.indexOf('date'), iO=hdr.indexOf('open'), iH=hdr.indexOf('high'),
        iL=hdr.indexOf('low'), iC=hdr.indexOf('close'), iV=hdr.indexOf('volume');
  if ([iDate,iO,iH,iL,iC,iV].some(x=>x<0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o=+p[iO], h=+p[iH], l=+p[iL], c=+p[iC], v=+p[iV];
    if (!ts || !Number.isFinite(c) || c<=0) continue;
    out.push({ ts, date: iso, o, h, l, c, v: Number.isFinite(v)?v:0 });
  }
  out.sort((a,b)=>a.ts-b.ts);
  return out;
}

function wilson(hits, n) {
  if (n<=0) return 0;
  const z=1.96, p=hits/n;
  return ((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n))*100;
}

function forwardExcursion(candles, sigIdx, entry) {
  let mfe=0, mae=0, hit5=false;
  for (let d=1; d<=MAX_HOLD && sigIdx+d<candles.length; d++) {
    const bar = candles[sigIdx+d];
    const hi = (bar.h-entry)/entry*100;
    const lo = (bar.l-entry)/entry*100;
    if (hi>mfe) mfe=hi;
    if (lo<mae) mae=lo;
    if (!hit5 && hi>=5) hit5=true;
  }
  return { mfe, mae, hit5 };
}

// ─── Worker ───────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, variants } = workerData;
  const variantKeys = Object.keys(variants);
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));

  const results = {};
  for (const vk of variantKeys) results[vk] = [];

  for (const fp of files) {
    const sym = path.basename(fp).replace(/_NS_OHLCV\.csv$/i,'').replace(/\.csv$/i,'');
    const candles = parseCSV(fp);
    if (candles.length < MIN_HISTORY + MAX_HOLD + 2) continue;

    for (let i = MIN_HISTORY; i < candles.length - 1; i++) {
      const start = Math.max(0, i + 1 - HISTORY_WINDOW);
      const window = candles.slice(start, i + 1);

      for (const vk of variantKeys) {
        engine.PARAM_SETS['optimized_elite_10plus'] = variants[vk].params;
        let r;
        try { r = engine.analyzeStock(window, 'optimized_elite_10plus'); }
        catch { continue; }
        if (!ACTIONABLE.has(r.stage)) continue;
        const { mfe, mae, hit5 } = forwardExcursion(candles, i, candles[i].c);
        results[vk].push({ sym, date: candles[i].date, mfe, mae, hit5 });
      }
    }
  }

  parentPort.postMessage({ type: 'done', results });
}

// ─── Main thread ──────────────────────────────────────────────────────────────
if (isMainThread) {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(f => path.join(DATA_DIR, f));

  const variantKeys = Object.keys(VARIANTS);
  const variants    = Object.fromEntries(variantKeys.map(k => [k, VARIANTS[k]]));

  console.log('='.repeat(88));
  console.log('Elite Param Comparison Backtest');
  console.log('='.repeat(88));
  console.log(`Data: ${DATA_DIR}  |  Files: ${files.length}  |  Workers: ${N_WORKERS}`);
  console.log('A:', VARIANTS.chatgpt_v12.label);
  console.log('B:', VARIANTS.grid_v13.label);
  console.log('Running (all historical bars)...\n');

  const batchSize = Math.ceil(files.length / N_WORKERS);
  const batches   = [];
  for (let i=0; i<N_WORKERS; i++) batches.push(files.slice(i*batchSize, (i+1)*batchSize));

  const allResults = Object.fromEntries(variantKeys.map(k => [k, []]));
  let completed = 0;
  const ts = Date.now();

  for (const batch of batches) {
    if (!batch.length) { completed++; if (completed===N_WORKERS) finish(); continue; }
    const w = new Worker(__filename, { workerData: { files: batch, variants } });
    w.on('message', msg => {
      if (msg.type === 'done') {
        for (const vk of variantKeys) allResults[vk].push(...msg.results[vk]);
        completed++;
        if (completed === N_WORKERS) finish();
      }
    });
    w.on('error', e => { console.error('Worker error:', e); completed++; if (completed === N_WORKERS) finish(); });
  }

  function summarize(trades) {
    if (!trades.length) return { n:0, wr:0, wilson:0, pf:0, avgMfe:0, avgMae:0, stocks:0, oosN:0, oosWr:0, oosPf:0 };
    const n      = trades.length;
    const hits   = trades.filter(t => t.hit5).length;
    const wr     = hits/n*100;
    const wil    = wilson(hits, n);
    const winMfe = trades.filter(t=>t.hit5).reduce((s,t)=>s+t.mfe,0);
    const lossMae= trades.filter(t=>!t.hit5).reduce((s,t)=>s+Math.abs(t.mae),0);
    const pf     = lossMae>0 ? winMfe/lossMae : (winMfe>0?99:0);
    const avgMfe = trades.reduce((s,t)=>s+t.mfe,0)/n;
    const avgMae = trades.reduce((s,t)=>s+t.mae,0)/n;
    const stocks = new Set(trades.map(t=>t.sym)).size;

    const sorted   = [...trades].sort((a,b)=>a.date.localeCompare(b.date));
    const oosStart = Math.floor(sorted.length * 0.7);
    const oos      = sorted.slice(oosStart);
    const oosHits  = oos.filter(t=>t.hit5).length;
    const oosWr    = oos.length ? oosHits/oos.length*100 : 0;
    const oosWinMfe  = oos.filter(t=>t.hit5).reduce((s,t)=>s+t.mfe,0);
    const oosLossMae = oos.filter(t=>!t.hit5).reduce((s,t)=>s+Math.abs(t.mae),0);
    const oosPf    = oosLossMae>0 ? oosWinMfe/oosLossMae : (oosWinMfe>0?99:0);

    return { n, wr, wilson:wil, pf, avgMfe, avgMae, stocks, oosN: oos.length, oosWr, oosPf };
  }

  function finish() {
    const elapsed = ((Date.now()-ts)/1000).toFixed(1);
    console.log(`Completed in ${elapsed}s\n`);

    const summaries = {};
    for (const vk of variantKeys) summaries[vk] = summarize(allResults[vk]);

    const colW = 34;
    console.log('─'.repeat(92));
    console.log(
      'Variant'.padEnd(colW) +
      'n'.padStart(6) + 'WR%'.padStart(8) + 'Wilson%'.padStart(9) +
      'PF'.padStart(7) + 'AvgMFE%'.padStart(9) + 'AvgMAE%'.padStart(9) +
      'Stocks'.padStart(8) + 'OOS-n'.padStart(7) + 'OOS-WR%'.padStart(9) + 'OOS-PF'.padStart(8)
    );
    console.log('─'.repeat(92));

    for (const vk of variantKeys) {
      const s = summaries[vk];
      console.log(
        VARIANTS[vk].label.padEnd(colW) +
        String(s.n).padStart(6) +
        s.wr.toFixed(1).padStart(7) + '%' +
        s.wilson.toFixed(1).padStart(8) + '%' +
        s.pf.toFixed(3).padStart(7) +
        s.avgMfe.toFixed(2).padStart(8) + '%' +
        s.avgMae.toFixed(2).padStart(8) + '%' +
        String(s.stocks).padStart(8) +
        String(s.oosN).padStart(7) +
        s.oosWr.toFixed(1).padStart(8) + '%' +
        s.oosPf.toFixed(3).padStart(8)
      );
    }
    console.log('─'.repeat(92));

    const cg = summaries['chatgpt_v12'];
    const gv = summaries['grid_v13'];

    console.log('\nVerdict:');
    console.log(`  ChatGPT forensic  n=${cg.n}  WR=${cg.wr.toFixed(1)}%  Wilson=${cg.wilson.toFixed(1)}%  PF=${cg.pf.toFixed(3)}  OOS-WR=${cg.oosWr.toFixed(1)}%`);
    console.log(`  Grid-v13          n=${gv.n}  WR=${gv.wr.toFixed(1)}%  Wilson=${gv.wilson.toFixed(1)}%  PF=${gv.pf.toFixed(3)}  OOS-WR=${gv.oosWr.toFixed(1)}%`);

    const MIN_N = 50;
    const cgOk  = cg.n >= MIN_N;
    const gvOk  = gv.n >= MIN_N;

    console.log('');
    if (!cgOk && !gvOk) {
      console.log('  ⚠ Both variants have n < 50 — insufficient sample for reliable comparison.');
    } else if (!cgOk) {
      console.log(`  → ChatGPT n=${cg.n} < ${MIN_N} (unreliable). RECOMMEND: switch to Grid-v13.`);
    } else if (!gvOk) {
      console.log(`  → Grid-v13 n=${gv.n} < ${MIN_N} (unreliable). RECOMMEND: keep ChatGPT forensic.`);
    } else if (gv.wilson >= cg.wilson && gv.pf >= cg.pf) {
      console.log('  → Grid-v13 wins on BOTH Wilson WR and PF. RECOMMEND: switch to Grid-v13.');
    } else if (cg.wilson >= gv.wilson && cg.pf >= gv.pf) {
      console.log('  → ChatGPT forensic wins on BOTH Wilson WR and PF. RECOMMEND: keep ChatGPT forensic.');
    } else {
      // Split — Wilson winner vs PF winner
      if (gv.wilson > cg.wilson) {
        console.log('  → Grid-v13 has higher Wilson WR (more reliable at scale). RECOMMEND: switch to Grid-v13.');
      } else {
        console.log('  → ChatGPT forensic has higher Wilson WR. RECOMMEND: keep ChatGPT forensic.');
      }
    }

    const ts2 = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5)+'Z';
    const outFile = path.join(__dirname, `elite_comparison_${ts2}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ variants: VARIANTS, summaries }, null, 2));
    console.log(`\nOutput: ${outFile}`);
  }
}
