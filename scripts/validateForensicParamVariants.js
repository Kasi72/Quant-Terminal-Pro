'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const VARIANTS_FILE = process.env.VARIANTS_FILE || path.join(__dirname, 'deployable_highprecision_forensic_variants.json');
const OUT_PREFIX = process.env.OUT_PREFIX || 'deployable_highprecision_forensic_validation';
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 280);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 220);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const ENTRY_WINDOW = Number(process.env.ENTRY_WINDOW || 3);
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || Math.min(8, Math.max(1, os.cpus().length - 1))));
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-');
    const mm = String((MONTHS[mon] ?? 0) + 1).padStart(2, '0');
    return { iso: `${yyyy}-${mm}-${dd.padStart(2, '0')}`, ts: Math.floor(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / 1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    return { iso, ts: Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000) };
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? { iso: new Date(t).toISOString().slice(0, 10), ts: Math.floor(t / 1000) } : { iso: '', ts: 0 };
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const h = lines[0].split(',').map(x => x.trim().toLowerCase());
  const ix = n => h.indexOf(n);
  const iDate = ix('date'), iOpen = ix('open'), iHigh = ix('high'), iLow = ix('low'), iClose = ix('close'), iVol = ix('volume');
  if ([iDate, iOpen, iHigh, iLow, iClose, iVol].some(i => i < 0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o = Number(p[iOpen]), hi = Number(p[iHigh]), lo = Number(p[iLow]), c = Number(p[iClose]), v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(c) || c <= 0) continue;
    out.push({ ts, date: iso, o, h: hi, l: lo, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function pct(n, d) { return d > 0 ? n / d * 100 : 0; }
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function wilson(h, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = h / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function levelsFromEngine(pe, fallbackEntry) {
  const entry = Number(pe?.plannedEntry || fallbackEntry);
  const stop = Number(pe?.tacticalStop || entry * 0.94);
  const t1 = Number(pe?.target5 || entry * 1.05);
  const t2 = Number(pe?.target7 || entry * 1.08);
  const t3 = Number(pe?.target10 || entry * 1.12);
  if (![entry, stop, t1, t2, t3].every(Number.isFinite) || entry <= 0 || stop <= 0 || stop >= entry) return null;
  return { plannedEntry: entry, stop, t1: Math.max(t1, entry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulate(candles, entryIdx, entry, levels) {
  if (entryIdx >= candles.length || !Number.isFinite(entry) || entry <= 0) return null;
  const riskAbs = Math.max(0.0001, entry - levels.stop);
  const pctTo = price => (price - entry) / entry * 100;
  const t1Pct = pctTo(levels.t1), t2Pct = pctTo(levels.t2), t3Pct = pctTo(levels.t3);
  let stop = levels.stop, pos = 1, pnl = 0, status = 'time';
  let exitIdx = Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1);
  let t1Hit = false, t2Hit = false, mfe = 0, mae = 0;
  for (let i = entryIdx; i <= Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1); i++) {
    const b = candles[i];
    mfe = Math.max(mfe, pctTo(b.h));
    mae = Math.min(mae, pctTo(b.l));
    if (pos > 0 && b.o <= stop) { pnl += pos * pctTo(b.o); status = t2Hit ? 'stop_gap_t2' : t1Hit ? 'stop_gap_t1' : 'stop_gap'; exitIdx = i; pos = 0; break; }
    if (pos > 0 && b.l <= stop) { pnl += pos * pctTo(stop); status = t2Hit ? 'stop_t2' : t1Hit ? 'stop_t1' : 'stop'; exitIdx = i; pos = 0; break; }
    if (!t1Hit && b.h >= levels.t1 && pos > 0) { pnl += 0.5 * t1Pct; pos -= 0.5; t1Hit = true; status = 'hit_t1'; stop = Math.max(stop, entry); }
    if (t1Hit && !t2Hit && b.h >= levels.t2 && pos > 0) { pnl += 0.3 * t2Pct; pos -= 0.3; t2Hit = true; status = 'hit_t2'; stop = Math.max(stop, levels.t1); }
    if (t2Hit && b.h >= levels.t3 && pos > 0) { pnl += pos * t3Pct; pos = 0; status = 'hit_t3'; exitIdx = i; break; }
  }
  if (pos > 0) pnl += pos * pctTo(candles[exitIdx].c);
  return { pnl, pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs, status, mfe, mae, days: exitIdx - entryIdx + 1 };
}

function simulateNextOpen(candles, signalIdx, levels) {
  return simulate(candles, signalIdx + 1, candles[signalIdx + 1]?.o, levels);
}

function simulatePlanned(candles, signalIdx, levels) {
  for (let d = 1; d <= ENTRY_WINDOW && signalIdx + d < candles.length; d++) {
    const b = candles[signalIdx + d];
    if (b.o >= levels.plannedEntry) return simulate(candles, signalIdx + d, b.o, levels);
    if (b.h >= levels.plannedEntry) return simulate(candles, signalIdx + d, levels.plannedEntry, levels);
  }
  return null;
}

function forensicPasses(r, f = {}) {
  const dna = r.candleDNA || {}, adv = r.advanced || {}, st = r.stats || {};
  const vals = {
    candleDnaScore: dna.score ?? 0,
    candleDnaCloseQuality: dna.wickCleanliness ?? 0,
    candleDnaLowerTail: dna.rangeExpansion ?? 0,
    bodyATR: dna.bodyATR ?? 0,
    upperToLowerWickRatio: dna.upperToLowerWickRatio ?? 99,
    marubozuScore: dna.marubozuScore ?? 0,
    advScore: adv.advScore ?? 0,
    fer20: adv.fer20 ?? 0,
    cusumPos: adv.cusumPos ?? 0,
    mwcScore: adv.mwcScore ?? 0,
    tram: adv.tram ?? 0,
    cleanMom: adv.cleanMom ?? 0,
    durationRatio: adv.durationRatio ?? 0,
    vram: adv.vram ?? 0,
    pic: adv.pic ?? 0,
    utbotBarsAgo: adv.utbotBarsAgo ?? 99,
    bbWidthPctl: st.bbWidthPctl ?? 50,
    volZScore: st.volZScore ?? 0,
    statsScore: st.statsScore ?? 0,
    sharpe20: st.sharpe20 ?? 0,
    entropy10: st.entropy10 ?? 0,
    insideBars: st.insideBars ?? 0,
    guppyCompressDays: st.guppyCompressDays ?? 0,
    guppyGroupGapPct: st.guppyGroupGapPct ?? 0,
    guppyCoiledRelease: !!st.guppyCoiledRelease,
    guppyCleanBullishFan: !!st.guppyCleanBullishFan,
    candlePatternStrength: st.candlePatternStrength ?? 0,
    bullishPattern: st.candlePatternType === 'bullish',
  };
  return (f.minCandleDnaScore == null || vals.candleDnaScore >= f.minCandleDnaScore) &&
    (f.minCandleDnaCloseQuality == null || vals.candleDnaCloseQuality >= f.minCandleDnaCloseQuality) &&
    (f.minCandleDnaLowerTail == null || vals.candleDnaLowerTail >= f.minCandleDnaLowerTail) &&
    (f.maxBodyATR == null || vals.bodyATR <= f.maxBodyATR) &&
    (f.maxUpperToLowerWickRatio == null || vals.upperToLowerWickRatio <= f.maxUpperToLowerWickRatio) &&
    (f.minMarubozuScore == null || vals.marubozuScore >= f.minMarubozuScore) &&
    (f.minAdvScore == null || vals.advScore >= f.minAdvScore) &&
    (f.minFer20 == null || vals.fer20 >= f.minFer20) &&
    (f.maxCusumPos == null || vals.cusumPos <= f.maxCusumPos) &&
    (f.maxMwcScore == null || vals.mwcScore <= f.maxMwcScore) &&
    (f.maxTram == null || vals.tram <= f.maxTram) &&
    (f.maxCleanMom == null || vals.cleanMom <= f.maxCleanMom) &&
    (f.maxDurationRatio == null || vals.durationRatio <= f.maxDurationRatio) &&
    (f.maxVram == null || vals.vram <= f.maxVram) &&
    (f.minPic == null || vals.pic >= f.minPic) &&
    (f.maxPic == null || vals.pic <= f.maxPic) &&
    (f.maxUtbotBarsAgo == null || vals.utbotBarsAgo <= f.maxUtbotBarsAgo) &&
    (f.maxBbWidthPctl == null || vals.bbWidthPctl <= f.maxBbWidthPctl) &&
    (f.minVolZScore == null || vals.volZScore >= f.minVolZScore) &&
    (f.minStatsScore == null || vals.statsScore >= f.minStatsScore) &&
    (f.minSharpe20 == null || vals.sharpe20 >= f.minSharpe20) &&
    (f.maxEntropy10 == null || vals.entropy10 <= f.maxEntropy10) &&
    (f.minInsideBars == null || vals.insideBars >= f.minInsideBars) &&
    (f.minGuppyCompressDays == null || vals.guppyCompressDays >= f.minGuppyCompressDays) &&
    (f.minGuppyGroupGapPct == null || vals.guppyGroupGapPct >= f.minGuppyGroupGapPct) &&
    (!f.requireGuppyCleanBullishFan || vals.guppyCleanBullishFan) &&
    (!f.requireGuppyCoiledRelease || vals.guppyCoiledRelease) &&
    (f.minCandlePatternStrength == null || vals.candlePatternStrength >= f.minCandlePatternStrength) &&
    (!f.requireBullishPattern || vals.bullishPattern);
}

function empty(variantNames) {
  return Object.fromEntries(variantNames.map(k => [k, { signals: 0, nextOpen: [], planned: [] }]));
}

function worker(files, config) {
  const engine = require(path.join(config.engineDir, 'stockEngine.js'));
  const variants = config.variants;
  const names = Object.keys(variants);
  const bases = {};
  for (const v of Object.values(variants)) bases[v.baseKey] = { ...engine.PARAM_SETS[v.baseKey] };
  const out = empty(names);
  const nextAllowed = Object.fromEntries(names.map(k => [k, { nextOpen: {}, planned: {} }]));
  let processed = 0, skipped = 0, minDate = '', maxDate = '';
  for (const fp of files) {
    const sym = path.basename(fp).replace(/_NS_OHLCV\.csv$/i, '').replace(/\.csv$/i, '');
    const candles = parseCSV(fp);
    if (candles.length < config.minHistory + config.maxHold + 2) {
      skipped++; processed++; parentPort.postMessage({ type: 'progress', processed, skipped }); continue;
    }
    if (!minDate || candles[0].date < minDate) minDate = candles[0].date;
    if (!maxDate || candles[candles.length - 1].date > maxDate) maxDate = candles[candles.length - 1].date;
    for (let i = config.minHistory; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i + 1 - config.historyWindow), i + 1);
      for (const name of names) {
        const v = variants[name];
        Object.assign(engine.PARAM_SETS[v.baseKey], bases[v.baseKey], v.params || {});
        let r;
        try { r = engine.analyzeStock(window, v.baseKey); } catch { continue; }
        if (!ACTIONABLE.has(r.stage) || !forensicPasses(r, v.forensic || {})) continue;
        out[name].signals++;
        const levels = levelsFromEngine(r.priceEngine, candles[i].c);
        if (!levels) continue;
        const models = { nextOpen: simulateNextOpen(candles, i, levels), planned: simulatePlanned(candles, i, levels) };
        for (const [model, sim] of Object.entries(models)) {
          if (!sim) continue;
          const allowed = nextAllowed[name][model][sym] || 0;
          if (i < allowed) continue;
          out[name][model].push({ sym, signalDate: candles[i].date, stage: r.stage, confidence: r.confidence, ...sim });
          nextAllowed[name][model][sym] = i + Math.max(1, sim.days);
        }
      }
    }
    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }
  parentPort.postMessage({ type: 'done', out, meta: { skipped, minDate, maxDate } });
}

function stats(trades) {
  const sorted = [...trades].sort((a, b) => a.signalDate.localeCompare(b.signalDate));
  const n = sorted.length, wins = sorted.filter(t => t.pnl > 0), losses = sorted.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const cut = Math.floor(n * 0.7), oos = sorted.slice(cut), ow = oos.filter(t => t.pnl > 0), ol = oos.filter(t => t.pnl <= 0);
  const ogw = ow.reduce((s, t) => s + t.pnl, 0), ogl = Math.abs(ol.reduce((s, t) => s + t.pnl, 0));
  return { n, stocks: new Set(sorted.map(t => t.sym)).size, wr: pct(wins.length, n), wilson: wilson(wins.length, n), avg: avg(sorted.map(t => t.pnl)), pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), avgR: avg(sorted.map(t => t.pnlR)), mfe: avg(sorted.map(t => t.mfe)), mae: avg(sorted.map(t => t.mae)), oos: { n: oos.length, wr: pct(ow.length, oos.length), avg: avg(oos.map(t => t.pnl)), pf: ogl > 0 ? ogw / ogl : (ogw > 0 ? Infinity : 0) } };
}

function fmt(v, d = 1) { return Number(v || 0).toFixed(d); }
function fpf(v) { return v === Infinity ? 'Inf' : fmt(v, 2); }

if (!isMainThread) {
  worker(workerData.files, workerData.config);
  return;
}

const variants = JSON.parse(fs.readFileSync(VARIANTS_FILE, 'utf8'));
const variantNames = Object.keys(variants);
const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols')).map(f => path.join(DATA_DIR, f));
const chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []);
files.forEach((f, i) => chunks[i % chunks.length].push(f));
const combined = empty(variantNames);
const config = { engineDir: ENGINE_DIR, variants, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD };
let done = 0, skipped = 0, minDate = '', maxDate = '', lastPrint = 0;
const started = Date.now();

console.log('='.repeat(90));
console.log('Forensic param variant validation');
console.log('='.repeat(90));
console.log(`Data: ${DATA_DIR}`);
console.log(`Variants: ${VARIANTS_FILE}`);
console.log(`Workers: ${chunks.length}`);
console.log('');

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = done ? done / elapsed : 0;
  const eta = rate ? (files.length - done) / rate : 0;
  process.stdout.write(`\rProgress ${done}/${files.length} (${fmt(pct(done, files.length))}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let wd = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      done += Math.max(0, msg.processed - wd);
      wd = msg.processed;
      progress();
    } else if (msg.type === 'done') {
      for (const name of variantNames) {
        combined[name].signals += msg.out[name].signals;
        combined[name].nextOpen.push(...msg.out[name].nextOpen);
        combined[name].planned.push(...msg.out[name].planned);
      }
      skipped += msg.meta.skipped || 0;
      if (msg.meta.minDate && (!minDate || msg.meta.minDate < minDate)) minDate = msg.meta.minDate;
      if (msg.meta.maxDate && (!maxDate || msg.meta.maxDate > maxDate)) maxDate = msg.meta.maxDate;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
}))).then(() => {
  done = files.length;
  progress(true);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const txtFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const rows = {};
  for (const name of variantNames) rows[name] = { nextOpen: stats(combined[name].nextOpen), planned: stats(combined[name].planned), signals: combined[name].signals };
  const lines = [];
  const push = s => lines.push(s);
  push('\n' + '='.repeat(132));
  push('FORENSIC PARAM VARIANT VALIDATION');
  push('='.repeat(132));
  push(`Data: ${DATA_DIR}`);
  push(`Files: ${files.length}, skipped: ${skipped}, date range: ${minDate} to ${maxDate}`);
  push(`Variants: ${VARIANTS_FILE}`);
  for (const model of ['nextOpen', 'planned']) {
    push('');
    push(model === 'nextOpen' ? 'NEXT-OPEN STOP-FIRST' : 'PLANNED ENTRY WITHIN 3 DAYS, STOP-FIRST');
    push('-'.repeat(132));
    push(`${'Variant'.padEnd(32)} ${'Signals'.padStart(7)} ${'Trades'.padStart(7)} ${'Stocks'.padStart(7)} ${'WR'.padStart(7)} ${'Wilson'.padStart(8)} ${'Avg'.padStart(8)} ${'PF'.padStart(7)} ${'AvgR'.padStart(8)} ${'MFE'.padStart(8)} ${'MAE'.padStart(8)} ${'OOSn'.padStart(6)} ${'OOSWR'.padStart(7)} ${'OOSAvg'.padStart(8)} ${'OOSPF'.padStart(7)}`);
    for (const name of variantNames) {
      const m = rows[name][model];
      push(`${name.padEnd(32)} ${String(rows[name].signals).padStart(7)} ${String(m.n).padStart(7)} ${String(m.stocks).padStart(7)} ${fmt(m.wr).padStart(6)}% ${fmt(m.wilson).padStart(7)}% ${fmt(m.avg,2).padStart(7)}% ${fpf(m.pf).padStart(7)} ${fmt(m.avgR,3).padStart(8)} ${fmt(m.mfe,1).padStart(7)}% ${fmt(m.mae,1).padStart(7)}% ${String(m.oos.n).padStart(6)} ${fmt(m.oos.wr).padStart(6)}% ${fmt(m.oos.avg,2).padStart(7)}% ${fpf(m.oos.pf).padStart(7)}`);
    }
  }
  const report = lines.join('\n');
  fs.writeFileSync(txtFile, report, 'utf8');
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { dataDir: DATA_DIR, files: files.length, skipped, minDate, maxDate, variantsFile: VARIANTS_FILE, runAt: new Date().toISOString() }, variants, rows }, null, 2), 'utf8');
  console.log(report);
  console.log(`\nJSON: ${jsonFile}`);
  console.log(`TXT : ${txtFile}`);
}).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
