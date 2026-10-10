'use strict';
// research_remaining.js — robustness research for: VF TP choice, CC Precision fix, EMA Stack RS gate
// Correct stats (win = pnl>0), yearly split, bootstrap CIs, train(2023-24)/test(2025-26) gate selection.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const WORKERS    = Number(process.env.WORKERS || Math.min(os.cpus().length, 12));
const OOS_START  = Date.parse('2023-01-01') / 1000;
const SPLIT_TS   = Date.parse('2025-01-01') / 1000;
const WINDOW     = 300;
const MIN_BARS   = 150;
const MAX_STORE  = 22;
const NIFTY_FP   = path.join(DATA_DIR, 'NIFTY50.csv');
const OUT_FILE   = path.join(__dirname, 'results', 'research_remaining.txt');

const SCAN = [
  { key: 'optimized_deployable_20plus',    label: 'VF',  stages: ['PRE_BREAKOUT'],               ucMin: 0,  cooldown: 20 },
  { key: 'optimized_highprecision_15plus', label: 'CC',  stages: ['PRE_BREAKOUT'],               ucMin: 0,  cooldown: 15 },
  { key: 'optimized_ultraselective_8plus', label: 'EMA', stages: ['PRE_BREAKOUT', 'STRONG_BUY'], ucMin: 0,  cooldown: 20 },
];

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/), out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 5) continue;
    const ts = Date.parse(p[0]), o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +(p[5] || 0);
    if (!Number.isFinite(ts) || o <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) { if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x; else d.push(x); }
  return d;
}

function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  if (c.length <= 15) return out;
  const tr = [0];
  for (let i = 1; i < c.length; i++)
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  let s = 0; for (let i = 1; i <= 14; i++) s += tr[i]; out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

if (!isMainThread) {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const out = [];
  for (const fp of workerData.files) {
    let c; try { c = parseCSV(fp); } catch { continue; }
    if (c.length < MIN_BARS) continue;
    const atr = atr14Array(c);
    for (const ps of SCAN) {
      const stages = new Set(ps.stages);
      let lastExit = -1;
      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExit || c[i].ts < OOS_START) continue;
        let r; try { r = engine.analyzeStock(c.slice(i - WINDOW + 1, i + 1), ps.key); } catch { continue; }
        if (!r || !stages.has(r.stage)) continue;
        const lb = i - 20, lb5 = i - 5;
        let hi20 = 0; for (let k = i - 19; k <= i; k++) hi20 = Math.max(hi20, c[k].h);
        out.push({
          arch: ps.label, stage: r.stage, ts: c[i].ts, ts20: c[lb].ts,
          ret20: c[i].c / c[lb].c - 1, ret5: c[i].c / c[lb5].c - 1,
          atr: atr[i] || c[i].c * 0.02, atrPct: (atr[i] || 0) / c[i].c * 100,
          uc: r.ucScore ?? 0, closeLoc: r.closeLoc ?? null, vol20: r.exactVolRatio20 ?? null,
          rsi2: r.rsi2 ?? null, body: r.bodyPct ?? null, wick: r.upperWickPct ?? null,
          rangeAtr: r.exactRangeATR14 ?? null, adx: r.momentum?.adx14 ?? null,
          infl: r.inflectionScore ?? null, cond: r.conditionsMet ?? null,
          distHi20: hi20 > 0 ? (c[i].c / hi20 - 1) * 100 : null,
          candles: c.slice(i + 1, i + 1 + MAX_STORE).map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c })),
        });
        lastExit = i + ps.cooldown;
      }
    }
  }
  parentPort.postMessage(out);
  process.exit(0);
}

// ─── Sim + stats ──────────────────────────────────────────────────────────────
function sim(s, tp, slAtr, hold) {
  const cs = s.candles;
  if (!cs.length || cs[0].o <= 0) return null;
  const e = cs[0].o, stop = e - slAtr * s.atr, tgt = e * (1 + tp / 100);
  const end = Math.min(cs.length - 1, hold - 1);
  for (let j = 0; j <= end; j++) {
    const b = cs[j];
    if (b.o <= stop) return { pnl: (b.o - e) / e * 100, bars: j + 1 };
    if (b.l <= stop) return { pnl: (stop - e) / e * 100, bars: j + 1 };
    if (b.o >= tgt)  return { pnl: (b.o - e) / e * 100, bars: j + 1 };
    if (b.h >= tgt)  return { pnl: tp, bars: j + 1 };
  }
  return { pnl: (cs[end].c - e) / e * 100, bars: end + 1 };
}
function stats(pnls) {
  const N = pnls.length;
  if (!N) return { N: 0, wr: NaN, pf: NaN, avg: NaN };
  let gw = 0, gl = 0, w = 0;
  for (const p of pnls) { if (p > 0) { gw += p; w++; } else gl -= p; }
  return { N, wr: w / N * 100, pf: gl > 0 ? gw / gl : 99, avg: (gw - gl) / N };
}
function run(sigs, tp, sl, hold) {
  const rs = sigs.map(s => sim(s, tp, sl, hold)).filter(Boolean);
  const st = stats(rs.map(r => r.pnl));
  st.bars = rs.length ? rs.reduce((a, r) => a + r.bars, 0) / rs.length : NaN;
  st.pnls = rs.map(r => r.pnl);
  return st;
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function bootCI(pnls, B = 2000) {
  if (pnls.length < 5) return { avgLo: NaN, avgHi: NaN, pfLo: NaN, pfHi: NaN };
  const avgs = [], pfs = [], n = pnls.length;
  for (let b = 0; b < B; b++) {
    const smp = []; for (let i = 0; i < n; i++) smp.push(pnls[(rnd() * n) | 0]);
    const s = stats(smp); avgs.push(s.avg); pfs.push(Math.min(s.pf, 20));
  }
  avgs.sort((a, b) => a - b); pfs.sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor(p * (a.length - 1))];
  return { avgLo: q(avgs, 0.05), avgHi: q(avgs, 0.95), pfLo: q(pfs, 0.05), pfHi: q(pfs, 0.95) };
}
function pairedBoot(a, b, B = 4000) { // P(mean(a) > mean(b)) on same trades
  const n = a.length; let wins = 0;
  for (let k = 0; k < B; k++) {
    let d = 0; for (let i = 0; i < n; i++) { const j = (rnd() * n) | 0; d += a[j] - b[j]; }
    if (d > 0) wins++;
  }
  return wins / B;
}

// ─── Output ───────────────────────────────────────────────────────────────────
const lines = [];
const out = s => { lines.push(s); process.stdout.write(s + '\n'); };
const f = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';
const sg = v => (v >= 0 ? '+' : '') + f(v);
const fmt = s => `N=${String(s.N).padStart(4)} WR=${f(s.wr, 1).padStart(5)}% PF=${f(s.pf).padStart(5)} avg=${sg(s.avg).padStart(6)}%`;
const year = ts => new Date(ts * 1000).getUTCFullYear();

function loadNifty() {
  const lines = fs.readFileSync(NIFTY_FP, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const a = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(','); const ts = Date.parse(p[0]?.trim()); const c = +p[4];
    if (Number.isFinite(ts) && c > 0) a.push({ ts: Math.floor(ts / 1000), c });
  }
  return a.sort((x, y) => x.ts - y.ts);
}
function niftyAt(a, ts) { // last close on or before ts (no look-ahead)
  let lo = 0, hi = a.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].ts <= ts) { ans = a[m].c; lo = m + 1; } else hi = m - 1; }
  return ans;
}

(async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(x => x.endsWith('.csv') && x !== 'NIFTY50.csv').map(x => path.join(DATA_DIR, x));
  const chunks = Array.from({ length: WORKERS }, () => []);
  files.forEach((fp, i) => chunks[i % WORKERS].push(fp));
  out(`RESEARCH — VF TP | CC fix | EMA RS   (${files.length} stocks, OOS 2023+, train<2025, test>=2025)`);
  const all = (await Promise.all(chunks.map(ch => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { files: ch } });
    w.on('message', res); w.on('error', rej);
  })))).flat();

  const nifty = loadNifty();
  for (const s of all) {
    const n1 = niftyAt(nifty, s.ts), n0 = niftyAt(nifty, s.ts20);
    s.niftyRet20 = n1 && n0 ? n1 / n0 - 1 : null;
    s.rsDelta = s.niftyRet20 == null ? null : s.ret20 - s.niftyRet20;
    s.rsRatio = s.niftyRet20 == null ? null : (1 + s.ret20) / (1 + s.niftyRet20);
  }
  const VF = all.filter(s => s.arch === 'VF'), CC = all.filter(s => s.arch === 'CC'), EMA = all.filter(s => s.arch === 'EMA');
  out(`Signals: VF=${VF.length} CC=${CC.length} EMA=${EMA.length}\n`);

  // ═══ A. VF TP choice ═══
  out('═══ A. VF SCOUT TP CHOICE (SL=5×ATR, H≤20, RS gate ratio>1.05 applied as live) ═══');
  const VFg = VF.filter(s => s.rsRatio != null && s.rsRatio >= 1.05);
  out(`VF after live RS gate: ${VFg.length}`);
  const years = [...new Set(VFg.map(s => year(s.ts)))].sort();
  out(`TP   | all                                      | 90% CI avg        | PF CI         | bars | avg/bar | ${years.join('      ')}`);
  const vfRes = {};
  for (const tp of [3, 4, 5, 6, 7]) {
    const r = run(VFg, tp, 5, 20); vfRes[tp] = r;
    const ci = bootCI(r.pnls);
    const yr = years.map(y => f(run(VFg.filter(s => year(s.ts) === y), tp, 5, 20).avg).padStart(6)).join(' ');
    out(`TP=${tp} | ${fmt(r)} | [${sg(ci.avgLo)}, ${sg(ci.avgHi)}] | [${f(ci.pfLo)}, ${f(ci.pfHi)}] | ${f(r.bars, 1).padStart(4)} | ${f(r.avg / r.bars, 3).padStart(6)} | ${yr}`);
  }
  out(`P(avg TP5 > TP4) = ${f(pairedBoot(vfRes[5].pnls, vfRes[4].pnls), 3)}   P(avg TP6 > TP5) = ${f(pairedBoot(vfRes[6].pnls, vfRes[5].pnls), 3)}   P(avg TP4 > TP3) = ${f(pairedBoot(vfRes[4].pnls, vfRes[3].pnls), 3)}`);

  // ═══ B. CC Precision ═══
  out('\n═══ B. CC PRECISION ═══');
  const CCp = CC.filter(s => s.uc >= 55);
  out(`Production params (TP=3 SL=4× H≤15 uc≥55): ${fmt(run(CCp, 3, 4, 15))}`);
  out(`Old scan params   (TP=3 SL=2.5× H≤20 uc≥50): ${fmt(run(CC.filter(s => s.uc >= 50), 3, 2.5, 20))}`);
  out(`No UC floor       (TP=3 SL=4× H≤15):        ${fmt(run(CC, 3, 4, 15))}`);
  const tr = CC.filter(s => s.ts < SPLIT_TS), te = CC.filter(s => s.ts >= SPLIT_TS);
  out(`Train N=${tr.length}  Test N=${te.length}`);

  out('\n-- Exit grid on TRAIN (top 8 by avg), then TEST --');
  const grid = [];
  for (const tp of [2, 3, 4, 5, 6]) for (const sl of [2, 3, 4, 5, 6]) for (const h of [5, 10, 15, 20]) {
    const r = run(tr, tp, sl, h); if (r.N >= 30) grid.push({ tp, sl, h, r });
  }
  grid.sort((a, b) => b.r.avg - a.r.avg);
  for (const g of grid.slice(0, 8)) out(`TP=${g.tp} SL=${g.sl}× H≤${String(g.h).padStart(2)} | train ${fmt(g.r)} | test ${fmt(run(te, g.tp, g.sl, g.h))}`);
  const bestExit = grid[0];

  out(`\n-- Feature gates on TRAIN (exit TP=${bestExit.tp} SL=${bestExit.sl}× H≤${bestExit.h}), keep ≥35% of train, validate on TEST --`);
  const FEATS = ['uc', 'closeLoc', 'vol20', 'rsi2', 'body', 'wick', 'rangeAtr', 'adx', 'infl', 'atrPct', 'distHi20', 'ret5', 'ret20', 'rsDelta'];
  const base = run(tr, bestExit.tp, bestExit.sl, bestExit.h);
  const gates = [];
  for (const ft of FEATS) {
    const vals = tr.map(s => s[ft]).filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 50) continue;
    for (const q of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const th = vals[Math.floor(q * (vals.length - 1))];
      for (const dir of ['>=', '<=']) {
        const pass = s => s[ft] != null && (dir === '>=' ? s[ft] >= th : s[ft] <= th);
        const t = tr.filter(pass);
        if (t.length < tr.length * 0.35) continue;
        const rt = run(t, bestExit.tp, bestExit.sl, bestExit.h);
        gates.push({ ft, dir, th, pass, rt });
      }
    }
  }
  gates.sort((a, b) => b.rt.avg - a.rt.avg);
  out(`Train baseline: ${fmt(base)}   Test baseline: ${fmt(run(te, bestExit.tp, bestExit.sl, bestExit.h))}`);
  const seen = new Set();
  const topGates = [];
  for (const g of gates) {
    if (seen.has(g.ft)) continue; seen.add(g.ft); topGates.push(g);
    const rte = run(te.filter(g.pass), bestExit.tp, bestExit.sl, bestExit.h);
    g.rte = rte;
    out(`${(g.ft + ' ' + g.dir + ' ' + f(g.th)).padEnd(24)} | train ${fmt(g.rt)} | test ${fmt(rte)}`);
    if (topGates.length >= 8) break;
  }
  // 2-feature combos from top gates
  out('\n-- 2-gate combos (train ≥25% kept) --');
  const combos = [];
  for (let i = 0; i < topGates.length; i++) for (let j = i + 1; j < topGates.length; j++) {
    const a = topGates[i], b = topGates[j];
    const p = s => a.pass(s) && b.pass(s);
    const t = tr.filter(p); if (t.length < tr.length * 0.25) continue;
    combos.push({ name: `${a.ft}${a.dir}${f(a.th)} & ${b.ft}${b.dir}${f(b.th)}`, p, rt: run(t, bestExit.tp, bestExit.sl, bestExit.h) });
  }
  combos.sort((x, y) => y.rt.avg - x.rt.avg);
  for (const c of combos.slice(0, 6)) out(`${c.name.padEnd(40)} | train ${fmt(c.rt)} | test ${fmt(run(te.filter(c.p), bestExit.tp, bestExit.sl, bestExit.h))}`);

  // ═══ C. EMA Stack RS ═══
  out('\n═══ C. EMA STACK RS GATE (TP=3 SL=5× H≤20) ═══');
  const EMAv = EMA.filter(s => s.rsDelta != null);
  out('gate            | all                                      | 90% CI avg        | train(<2025)                       | test(>=2025)');
  const gatesE = [['none', () => true]];
  for (const t of [-0.02, 0, 0.01, 0.02, 0.03, 0.05, 0.08]) gatesE.push([`delta>${t}`, s => s.rsDelta > t]);
  for (const t of [1.0, 1.02, 1.03, 1.05]) gatesE.push([`ratio>=${t}`, s => s.rsRatio >= t]);
  for (const [name, p] of gatesE) {
    const a = EMAv.filter(p), r = run(a, 3, 5, 20), ci = bootCI(r.pnls);
    out(`${name.padEnd(15)} | ${fmt(r)} | [${sg(ci.avgLo)}, ${sg(ci.avgHi)}] | ${fmt(run(a.filter(s => s.ts < SPLIT_TS), 3, 5, 20))} | ${fmt(run(a.filter(s => s.ts >= SPLIT_TS), 3, 5, 20))}`);
  }
  out('\nBy stage (delta>0.03):');
  for (const st of ['PRE_BREAKOUT', 'STRONG_BUY']) out(`  ${st.padEnd(13)} ${fmt(run(EMAv.filter(s => s.stage === st && s.rsDelta > 0.03), 3, 5, 20))}   ungated ${fmt(run(EMAv.filter(s => s.stage === st), 3, 5, 20))}`);
  out('\nEMA exit grid at delta>0.03:');
  const EMAg = EMAv.filter(s => s.rsDelta > 0.03);
  for (const tp of [3, 4, 5]) for (const sl of [3, 5]) out(`  TP=${tp} SL=${sl}× H≤20  ${fmt(run(EMAg, tp, sl, 20))}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'));
  out(`\nSaved ${OUT_FILE}`);
})();
