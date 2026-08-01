'use strict';
const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const PARAM_KEY  = 'sniper_95plus';
const WINDOW     = 300;
const MIN_BARS   = 150;
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
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

if (!isMainThread) {
  try {
    const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
    const { override } = workerData;
    if (override.field != null) engine.PARAM_SETS[PARAM_KEY][override.field] = override.value;

    let signals = 0;
    let errors = 0;
    for (const file of workerData.files) {
      let c;
      try { c = parseCSV(file.fp); } catch(e) { errors++; continue; }
      if (c.length < MIN_BARS) continue;

      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, PARAM_KEY); } catch(e) { errors++; continue; }
        if (r && ACTIONABLE.has(r.stage)) signals++;
      }
    }
    parentPort.postMessage({ type: 'done', signals, errors });
  } catch (e) {
    parentPort.postMessage({ type: 'err', msg: e.message });
  }
} else {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .slice(0, 20)  // only 20 files for test
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  console.log(`Testing with ${files.length} files`);
  const w = new Worker(__filename, {
    workerData: { files, override: { field: null, value: null } },
    stderr: true,
  });
  w.on('message', m => console.log('Result:', JSON.stringify(m)));
  w.on('error', e => console.error('Worker error:', e));
  w.stderr.on('data', d => console.error('Worker stderr:', d.toString()));
  w.on('exit', c => console.log('Exit:', c));
}
