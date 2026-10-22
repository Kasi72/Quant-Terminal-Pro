'use strict';
// research_regime_conviction.js — does the live-trade finding (market regime + conviction drive the
// +5% win rate) hold across 2023-2026? Replays the screener (analyzeStockMulti best + RS63 promotion)
// over local OHLCV, records Nifty regime and conviction at each signal, and scores every signal on the
// live objective: touch +5% before the hard stop within maxHold, entry at next open.
//
// Run: node scripts/research_regime_conviction.js   (env WORKERS=3, DATA_DIR=...)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE = path.join(__dirname, '_compiled_current');
const OOS_START = Date.parse('2023-01-01') / 1000;
const WINDOW = 300;
const COOLDOWN = 10;
const OUT_FILE = path.join(__dirname, 'results', 'research_regime_conviction.txt');
const ACTIONABLE = new Set(['PRE_BREAKOUT', 'BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const STAGE_W = { ULTRA_STRONG_BUY: 30, STRONG_BUY: 25, BUY: 20, PRE_BREAKOUT: 10, EARLY_INFLECTION: 5, COMPRESSION_WATCH: 2, NO_SIGNAL: 0 };

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',');
    const ts = Date.parse(p[0]); const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +(p[5] || 0);
    if (Number.isFinite(ts) && o > 0 && h >= l && c > 0) out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.filter((x, i) => i === 0 || x.ts !== out[i - 1].ts);
}

// Same formula as lib/signals.ts computeConviction.
function conviction(r) {
  const raw = (STAGE_W[r.stage] ?? 0) + Math.min(r.inflectionScore ?? 0, 100) * 0.25 + Math.min(r.momentum?.momentumScore ?? 0, 100) * 0.2
    + Math.min(r.confidence ?? 0, 100) * 0.15 + (r.priceEngine?.tradeValid ? 10 : 0);
  return Number.isFinite(raw) ? Math.round(Math.min(Math.max(raw, 0), 100)) : 0;
}

if (!isMainThread) {
  const eng = require(path.join(ENGINE, 'stockEngine.js'));
  const { detectMarketRegime } = require(path.join(ENGINE, 'tradeOps.js'));
  const nifty = workerData.nifty;
  const nIdx = new Map(nifty.map((k, i) => [new Date(k.ts * 1000).toISOString().slice(0, 10), i]));
  const regimeCache = new Map();
  const regimeAt = (i) => {
    if (!regimeCache.has(i)) regimeCache.set(i, i >= 220 ? detectMarketRegime(nifty.slice(i - 260 < 0 ? 0 : i - 260, i + 1)).label : 'Unknown');
    return regimeCache.get(i);
  };
  const out = [];
  for (const fp of workerData.files) {
    let c; try { c = parseCSV(fp); } catch { continue; }
    if (c.length < WINDOW + 25) continue;
    let next = 0;
    for (let i = WINDOW - 1; i < c.length - 1; i++) {
      if (i < next || c[i].ts < OOS_START) continue;
      const day = new Date(c[i].ts * 1000).toISOString().slice(0, 10);
      const ni = nIdx.get(day);
      if (ni == null || ni < 64) continue;
      const w = c.slice(i - WINDOW + 1, i + 1);
      let r; try { r = eng.analyzeStockMulti(w, '').best; } catch { continue; }
      if (!r) continue;
      const rs63 = eng.computeRSvsNifty(c.slice(0, i + 1), nifty.slice(0, ni + 1), 63);
      let src = r.stageSource || 'pattern';
      if (Number.isFinite(rs63) && rs63 >= 1.15 && r.stage === 'EARLY_INFLECTION') { r.stage = 'PRE_BREAKOUT'; src = 'rs63'; eng.ensurePriceLevels(r, w); }
      const watch = r.stage === 'EARLY_INFLECTION';
      if (!ACTIONABLE.has(r.stage) && !watch) continue;
      const pe = r.priceEngine || {};
      const fwd = c.slice(i + 1, i + 1 + (pe.maxHoldBars || 20));
      if (fwd.length < 3) continue;
      const entry = fwd[0].o;
      const stops = [pe.tacticalStop, pe.disasterStop].filter(x => x > 0 && x < entry);
      const atr = (r.atrPct14 > 0 ? r.atrPct14 / 100 : 0.03) * entry;
      const stop = stops.length ? Math.min(...stops) : entry - 2.5 * atr;
      const tgt = entry * 1.05;
      let exit = fwd[fwd.length - 1].c, win = false;
      for (const b of fwd) {
        if (b.o <= stop) { exit = b.o; break; }
        if (b.l <= stop) { exit = stop; break; }
        if (b.o >= tgt) { exit = b.o; win = true; break; }
        if (b.h >= tgt) { exit = tgt; win = true; break; }
      }
      const riskPct = (entry - stop) / entry * 100;
      // Exit geometry variants: stop capped at N% below entry (tighter of cap and the trade's stop) x target.
      const variants = {};
      for (const cap of [0, 8, 6, 4]) for (const tp of [5, 7, 10]) {
        const vStop = cap ? Math.max(stop, entry * (1 - cap / 100)) : stop;
        const vTgt = entry * (1 + tp / 100);
        let vx = fwd[fwd.length - 1].c;
        for (const b of fwd) {
          if (b.o <= vStop) { vx = b.o; break; }
          if (b.l <= vStop) { vx = vStop; break; }
          if (b.o >= vTgt) { vx = b.o; break; }
          if (b.h >= vTgt) { vx = vTgt; break; }
        }
        const pnl = Math.max(-25, Math.min(25, (vx - entry) / entry * 100));
        variants[`${cap ? 'cap' + cap : 'native'}|tp${tp}`] = [pnl, (entry - vStop) / entry * 100];
      }
      out.push({
        d: day, y: day.slice(0, 4), stage: r.stage, watch, ps: r.paramSetKey, arch: r.archetypeType, src,
        pstage: r.patternStage || r.stage,
        conv: conviction(r), regime: regimeAt(ni), win, pnl: Math.max(-25, Math.min(25, (exit - entry) / entry * 100)), riskPct, variants,
      });
      // Only actionable signals start a cooldown; watch-stage rows must not suppress later buys.
      if (!watch) next = i + COOLDOWN;
    }
  }
  parentPort.postMessage(out);
  return;
}

(async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && f !== 'NIFTY50.csv').map(f => path.join(DATA_DIR, f));
  const nifty = parseCSV(path.join(DATA_DIR, 'NIFTY50.csv'));
  const N = Number(process.env.WORKERS || Math.min(3, os.cpus().length));
  const chunks = Array.from({ length: N }, () => []);
  files.forEach((f, i) => chunks[i % N].push(f));
  const t0 = Date.now();
  const all = (await Promise.all(chunks.map(ch => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { files: ch, nifty } });
    w.on('message', res); w.on('error', rej);
  })))).flat();

  const lines = [];
  const out = s => { lines.push(s); console.log(s); };
  const st = a => {
    if (!a.length) return 'n=0';
    const wr = a.filter(t => t.win).length / a.length;
    const pnl = a.reduce((s, t) => s + t.pnl, 0) / a.length;
    const R = a.reduce((s, t) => s + t.pnl / Math.max(t.riskPct, 0.5), 0) / a.length;
    return `n=${String(a.length).padStart(5)} WR=${(wr * 100).toFixed(1).padStart(5)}% avg=${(pnl >= 0 ? '+' : '') + pnl.toFixed(2)}% expR=${(R >= 0 ? '+' : '') + R.toFixed(2)}`;
  };
  const by = (title, f, a) => {
    out(`\n## ${title}`);
    const g = {}; for (const t of a) { const k = f(t); (g[k] = g[k] || []).push(t); }
    for (const [k, v] of Object.entries(g).sort()) out(`  ${String(k).padEnd(30)} ${st(v)}`);
  };
  const A = all.filter(t => !t.watch);
  out(`REGIME x CONVICTION REPLAY — ${files.length} stocks, ${all.length} signals (${A.length} actionable), 2023-01 → ${all.map(t => t.d).sort().pop()}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  out('Objective: touch +5% before hard stop within maxHold; entry next open. Regime from Nifty only (no VIX).');
  out(`\nActionable baseline: ${st(A)}   | Early Inflection (watch) signals: ${st(all.filter(t => t.watch))}`);
  by('Regime', t => t.regime, A);
  by('Conviction', t => t.conv < 50 ? 'a <50' : t.conv < 60 ? 'b 50-59' : t.conv < 65 ? 'c 60-64' : t.conv < 70 ? 'd 65-69' : t.conv < 80 ? 'e 70-79' : 'f 80+', A);
  by('Stage', t => t.stage, A);
  by('Stage source', t => t.src, A);
  by('Param set', t => t.ps, A);
  const bear = t => /Bear/.test(t.regime);
  by('Regime x conviction>=65', t => `${/Bear/.test(t.regime) ? 'Bear' : /Bull/.test(t.regime) ? 'Bull' : 'Neutral/other'} | conv ${t.conv >= 65 ? '>=65' : '<65'}`, A);
  const reg3 = t => /Bear/.test(t.regime) ? 'Bear' : /Bull/.test(t.regime) ? 'Bull' : 'Neutral';
  by('Stage source x regime', t => `${t.src.padEnd(8)} | ${reg3(t)}`, A);
  by('Stage source x year', t => `${t.src.padEnd(8)} | ${t.y}`, A);
  by('UC promotions split by what the pattern check gave', t => `uc from ${t.pstage}`, A.filter(t => t.src === 'uc_score'));
  // Exit geometry: per variant, all actionable and pattern-only
  out('\n## Exit geometry (stop cap x target) — pnl clipped to ±25%');
  const vkeys = Object.keys(A[0]?.variants || {});
  for (const [label, set] of [['ALL actionable', A], ['pattern + rs63 (no uc)', A.filter(t => t.src !== 'uc_score')]]) {
    out(`  ${label}`);
    for (const k of vkeys) {
      const v = set.map(t => t.variants[k]);
      const wr = v.filter(x => x[0] > 0).length / v.length;
      const avg = v.reduce((s, x) => s + x[0], 0) / v.length;
      const R = v.reduce((s, x) => s + x[0] / Math.max(x[1], 0.5), 0) / v.length;
      const byY = ['2023', '2024', '2025', '2026'].map(y => { const s = set.filter(t => t.y === y).map(t => t.variants[k][0]); return (s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(2); }).join(' / ');
      out(`    ${k.padEnd(12)} profit-rate ${(wr * 100).toFixed(1)}%  avg ${(avg >= 0 ? '+' : '') + avg.toFixed(2)}%  expR ${(R >= 0 ? '+' : '') + R.toFixed(2)}  | by year ${byY}`);
    }
  }
  const P = A.filter(t => t.src === 'pattern');
  by('PATTERN-ONLY: regime', reg3, P);
  by('PATTERN-ONLY: conviction', t => t.conv < 50 ? 'a <50' : t.conv < 65 ? 'b 50-64' : 'c 65+', P);
  by('PATTERN-ONLY: param set', t => t.ps, P);
  by('PATTERN-ONLY: stage', t => t.stage, P);

  // Conviction threshold chosen on 2023-24, checked on 2025-26
  out('\n## Conviction threshold: train 2023-24 vs test 2025-26');
  for (const th of [0, 50, 55, 60, 65, 70, 75]) {
    const tr = A.filter(t => t.y <= '2024' && t.conv >= th), te = A.filter(t => t.y >= '2025' && t.conv >= th);
    out(`  conv>=${String(th).padEnd(3)} train ${st(tr)}  |  test ${st(te)}`);
  }
  // Candidate rules, by year
  const cc = t => t.ps === 'optimized_highprecision_15plus';
  const rules = {
    'Baseline': () => true,
    'B: no CC Precision': t => !cc(t),
    'C: B + Bear needs conv>=65': t => !cc(t) && (!bear(t) || t.conv >= 65),
    'D: B + conv>=65 always': t => !cc(t) && t.conv >= 65,
    'E: Bull regimes only': t => /Bull/.test(t.regime),
    'F: B + skip Bear entirely': t => !cc(t) && !bear(t),
  };
  out('\n## Candidate rules by year');
  for (const [k, f] of Object.entries(rules)) {
    const a = A.filter(f);
    out(`  ${k.padEnd(28)} ALL ${st(a)}`);
    for (const y of ['2023', '2024', '2025', '2026']) out(`  ${''.padEnd(28)} ${y} ${st(a.filter(t => t.y === y))}`);
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'));
  out(`\nSaved ${OUT_FILE}`);
})().catch(e => { console.error(e); process.exit(1); });
