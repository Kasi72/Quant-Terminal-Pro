'use strict';
// scripts/archetypeTune.js
// Full archetype parameter sweep — all 5 momentum archetypes
// Phase 1: independent per-dim marginal lift
// Phase 2: joint 2-dim grid for the two most impactful dims per archetype
// Usage: node scripts/archetypeTune.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR  = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS = Math.min(16, os.cpus().length);
const IS_CUT    = '2025-05-05';
const MIN_N     = 15;   // min OOS signals for a result to be reported

// ── Exit grid ─────────────────────────────────────────────────────────────────
const TP_G  = [3, 4, 5, 6, 7, 8];
const SL_G  = [1.5, 2.0, 2.5, 3.0];
const HB_G  = [10, 15, 20, 25];
const N_EX  = TP_G.length * SL_G.length * HB_G.length; // 96
const exitIdx = (ti, si, hi) => ti * (SL_G.length * HB_G.length) + si * HB_G.length + hi;

// ── Wilson CI ────────────────────────────────────────────────────────────────
const wilsonLower = (w, n, z = 1.645) => {
  if (n === 0) return 0;
  const p = w / n, z2 = z * z;
  return (p + z2/(2*n) - z*Math.sqrt(p*(1-p)/n + z2/(4*n*n))) / (1 + z2/n);
};

// ── CSV ───────────────────────────────────────────────────────────────────────
function parseCSV(txt) {
  const out = [];
  const lines = txt.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (isNaN(c) || c <= 0) continue;
    out.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c, v: +p[5] });
  }
  return out;
}

// ── Indicators ────────────────────────────────────────────────────────────────
function atr14(C) {
  const n = C.length, a = new Float64Array(n);
  if (n < 2) return a;
  a[1] = C[1].h - C[1].l;
  for (let i = 2; i < n; i++) {
    const tr = Math.max(C[i].h-C[i].l, Math.abs(C[i].h-C[i-1].c), Math.abs(C[i].l-C[i-1].c));
    a[i] = i < 14 ? tr : i === 14
      ? (()=>{ let s=0; for(let j=1;j<=14;j++) s+=Math.max(C[j].h-C[j].l,Math.abs(C[j].h-C[j-1].c),Math.abs(C[j].l-C[j-1].c)); return s/14; })()
      : (a[i-1]*13+tr)/14;
  }
  return a;
}

function ema(C, p) {
  const n = C.length, e = new Float64Array(n);
  if (n < p) return e;
  let s = 0; for (let i = 0; i < p; i++) s += C[i].c; e[p-1] = s/p;
  const k = 2/(p+1);
  for (let i = p; i < n; i++) e[i] = C[i].c*k + e[i-1]*(1-k);
  return e;
}

function dmi14(C) {
  const n = C.length, P = 14;
  const adxA = new Float64Array(n).fill(20);
  const diPA = new Float64Array(n), diMA = new Float64Array(n);
  if (n < P*2+2) return { diP: diPA, diM: diMA, adx: adxA };
  const dmP = new Float64Array(n), dmM = new Float64Array(n), trA = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = C[i].h - C[i-1].h, dn = C[i-1].l - C[i].l;
    dmP[i] = (up>dn && up>0)?up:0; dmM[i] = (dn>up && dn>0)?dn:0;
    trA[i] = Math.max(C[i].h-C[i].l, Math.abs(C[i].h-C[i-1].c), Math.abs(C[i].l-C[i-1].c));
  }
  let sTR=0, sDMp=0, sDMm=0;
  for (let i=1;i<=P;i++){sTR+=trA[i];sDMp+=dmP[i];sDMm+=dmM[i];}
  const dxA = new Float64Array(n);
  for (let i=P+1;i<n;i++){
    sTR=sTR-sTR/P+trA[i]; sDMp=sDMp-sDMp/P+dmP[i]; sDMm=sDMm-sDMm/P+dmM[i];
    const dp=sTR>0?(sDMp/sTR)*100:0, dm=sTR>0?(sDMm/sTR)*100:0;
    diPA[i]=dp; diMA[i]=dm;
    const s=dp+dm; dxA[i]=s>0?Math.abs(dp-dm)/s*100:0;
  }
  const seed=P*2+1;
  if (n>seed){
    let av=0; for(let i=P+1;i<=seed;i++) av+=dxA[i]; av/=P; adxA[seed]=av;
    for(let i=seed+1;i<n;i++){av=(av*(P-1)+dxA[i])/P; adxA[i]=av;}
  }
  return { diP: diPA, diM: diMA, adx: adxA };
}

function bscDI(diP, diM, endIdx, max) {
  for (let i = endIdx; i >= Math.max(0, endIdx - max); i--) {
    if (i < 1) continue;
    if (diP[i] > diM[i] && diP[i-1] <= diM[i-1]) return endIdx - i;
  }
  return 99;
}

function rsi(C, p, upTo) {
  if (upTo < p) return 50;
  let g=0, l=0;
  for (let i=Math.max(1, upTo-p+1); i<=upTo; i++) {
    const d = C[i].c - C[i-1].c;
    if (d>0) g+=d; else l-=d;
  }
  return l===0?100:100-100/(1+g/l);
}

function candleArch(c, atr) {
  const range = c.h - c.l;
  if (range <= 0 || c.c <= 0) return null;
  const body  = Math.abs(c.c - c.o);
  const upper = c.h - Math.max(c.o, c.c);
  const lower = Math.min(c.o, c.c) - c.l;
  const bPct  = body  / range * 100;
  const uwPct = upper / range * 100;
  const lwPct = lower / range * 100;
  const cl    = (c.c - c.l) / range * 100;
  const safeBody = Math.max(body, range * 0.001);
  return {
    bPct, uwPct, lwPct, cl,
    uwbr: upper / safeBody,
    bodyAtr: atr > 0 ? body / atr : 0,
    risk: range / c.c * 100,
    isGreen: c.c > c.o,
    isHammer: lwPct >= 2 * bPct && cl >= 60,
  };
}

function bbWidthPctls(C) {
  // Returns per-bar BB width percentile (vs 60d history)
  const n = C.length, P = 20, W = 60;
  const pctl = new Float64Array(n);
  const bws = [];
  for (let i = P; i < n; i++) {
    let s=0; for (let j=i-P+1;j<=i;j++) s+=C[j].c;
    const mean=s/P;
    let v=0; for (let j=i-P+1;j<=i;j++) v+=(C[j].c-mean)**2;
    const bw = mean>0?(4*Math.sqrt(v/P)/mean)*100:0;
    bws.push(bw);
    const win = bws.slice(-W);
    const below = win.filter(w=>w<=bw).length;
    pctl[i] = below/win.length*100;
  }
  return pctl;
}

// ── Exit simulation ───────────────────────────────────────────────────────────
function simExit(C, ei, tpPct, slMult, hbars, atrA) {
  const entry = C[ei].c;
  const a = atrA[ei] || entry*0.02;
  const tp = entry*(1+tpPct/100), sl = entry - slMult*a;
  const end = Math.min(C.length-1, ei+hbars);
  for (let i=ei+1;i<=end;i++){
    if (C[i].l <= sl) return 0;
    if (C[i].h >= tp) return 1;
  }
  return C[end].c >= entry ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT ("production") param values — the baseline against which we measure lift
// ─────────────────────────────────────────────────────────────────────────────
const CUR = {
  VF: {
    minVolRatio: 3.7, minCloseLoc: 68, maxUpperWick: 20,
    minHi20Frac: 0.83, minRangeATR: 2.4, maxGapDown: 0.974, minADX: 15,
  },
  CC: {
    minCoilBars: 8, maxCoilBars: 12, minPricePos: 59, maxBBPctl: 47,
    maxRangeATR: 0.8, minCloseLoc: 55, minBodyPct: 40, minADX: 20,
  },
  MP: {
    dd52WLo: 31, dd52WHi: 42, minCloseLoc: 43, minBodyPct: 59,
    maxUpperWick: 30, minVolRatio: 1.8, rsi14Lo: 27, rsi14Hi: 74,
    maxBSC: 5, minADX: 25,
  },
  ES: {
    minBelowBars: 5, minEMA10Spread: 0.7, minBodyPct: 40,
    maxUpperWick: 25, maxCandleRisk: 10, minVolRatio: 1.9,
    maxBSC: 3, minADX: 15,
  },
  PS: {
    minFireCount: 2, minADXgate: 25, minQualTier: 2, maxCandleRisk: 8,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SWEEP DEFINITIONS
// Each entry: { arch, dim, label, values }
// Independent sweep: one dim varies, rest stay at CUR
// ─────────────────────────────────────────────────────────────────────────────
const DIMS = [
  // ── VolumeFootprint ──────────────────────────────────────────────────────
  { arch:'VF', dim:'minVolRatio',  label:'VF c1: Min Vol Ratio ×20d',   values:[2.0, 2.5, 3.0, 3.5, 3.7, 4.0, 4.5, 5.0] },
  { arch:'VF', dim:'minCloseLoc',  label:'VF c2a: Min Close Loc %',     values:[55, 60, 65, 68, 72, 75, 78] },
  { arch:'VF', dim:'maxUpperWick', label:'VF c2b: Max Upper Wick %',    values:[12, 15, 18, 20, 25, 30, 35] },
  { arch:'VF', dim:'minHi20Frac',  label:'VF c3: Price/20d-Hi ≥ (frac)',values:[0.72, 0.76, 0.80, 0.83, 0.86, 0.90, 0.94] },
  { arch:'VF', dim:'minRangeATR',  label:'VF c4: Min Range/ATR',        values:[1.5, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.5] },
  { arch:'VF', dim:'maxGapDown',   label:'VF c5: Gap-down floor (o/pc)',values:[0.960, 0.968, 0.974, 0.980, 0.990, 0.995] },
  { arch:'VF', dim:'minADX',       label:'VF c6: Min ADX',              values:[10, 13, 15, 18, 20, 23, 25] },
  // ── CompressionCoil ──────────────────────────────────────────────────────
  { arch:'CC', dim:'minCoilBars',  label:'CC c1: Min Coil Bars',        values:[4, 5, 6, 7, 8, 9, 10, 11] },
  { arch:'CC', dim:'maxCoilBars',  label:'CC c1: Max Coil Bars',        values:[9, 10, 11, 12, 13, 15, 18, 22] },
  { arch:'CC', dim:'minPricePos',  label:'CC c3: Min Price Pos 20d %',  values:[45, 50, 55, 59, 63, 67, 72] },
  { arch:'CC', dim:'maxBBPctl',    label:'CC c4: Max BB Width Pctl',    values:[25, 30, 35, 40, 47, 52, 58, 65] },
  { arch:'CC', dim:'maxRangeATR',  label:'CC c5a: Max Range/ATR coil',  values:[0.5, 0.6, 0.65, 0.70, 0.75, 0.80, 0.90, 1.0] },
  { arch:'CC', dim:'minCloseLoc',  label:'CC c5b: Min Close Loc % coil',values:[45, 50, 55, 58, 62, 65, 70] },
  { arch:'CC', dim:'minBodyPct',   label:'CC c5c: Min Body % coil',     values:[20, 25, 30, 35, 40, 45, 50] },
  { arch:'CC', dim:'minADX',       label:'CC c6: Min ADX',              values:[12, 15, 17, 20, 23, 25, 28] },
  // ── MomentumPocket ───────────────────────────────────────────────────────
  { arch:'MP', dim:'dd52WLo',      label:'MP c1: DD 52W low bound %',   values:[20, 24, 27, 30, 31, 34, 37, 40] },
  { arch:'MP', dim:'dd52WHi',      label:'MP c1: DD 52W high bound %',  values:[35, 38, 42, 45, 48, 52, 58, 65] },
  { arch:'MP', dim:'minCloseLoc',  label:'MP c3a: Min Close Loc %',     values:[30, 35, 40, 43, 48, 52, 55] },
  { arch:'MP', dim:'minBodyPct',   label:'MP c3b: Min Body % (green)',  values:[40, 45, 50, 55, 59, 63, 68] },
  { arch:'MP', dim:'maxUpperWick', label:'MP c3c: Max Upper Wick %',    values:[20, 22, 25, 28, 30, 35, 40] },
  { arch:'MP', dim:'minVolRatio',  label:'MP c4: Min Vol Ratio ×20d',   values:[1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5] },
  { arch:'MP', dim:'rsi14Lo',      label:'MP c5a: RSI14 low bound',     values:[18, 22, 25, 27, 30, 33, 37] },
  { arch:'MP', dim:'rsi14Hi',      label:'MP c5b: RSI14 high bound',    values:[55, 60, 65, 68, 74, 78, 82] },
  { arch:'MP', dim:'maxBSC',       label:'MP c6a: Max bars since DI×',  values:[2, 3, 4, 5, 6, 8, 10] },
  { arch:'MP', dim:'minADX',       label:'MP c6b: Min ADX',             values:[15, 18, 20, 22, 25, 27, 30] },
  // ── EMAStack ─────────────────────────────────────────────────────────────
  { arch:'ES', dim:'minBelowBars', label:'ES c2: Min bars below EMA20', values:[2, 3, 4, 5, 6, 7, 9] },
  { arch:'ES', dim:'minEMA10Spread',label:'ES c3a: Min EMA10/EMA20 %',  values:[0.0, 0.2, 0.4, 0.5, 0.7, 0.9, 1.2] },
  { arch:'ES', dim:'minBodyPct',   label:'ES c3b: Min Body %',          values:[25, 30, 35, 40, 45, 50, 55] },
  { arch:'ES', dim:'maxUpperWick', label:'ES c3c: Max Upper Wick %',    values:[15, 18, 20, 22, 25, 30, 35] },
  { arch:'ES', dim:'maxCandleRisk',label:'ES c3d: Max Candle Risk %',   values:[6, 7, 8, 9, 10, 12, 15] },
  { arch:'ES', dim:'minVolRatio',  label:'ES c4: Min Vol Ratio ×20d',   values:[1.2, 1.5, 1.7, 1.9, 2.1, 2.3, 2.5] },
  { arch:'ES', dim:'maxBSC',       label:'ES c6a: Max bars since DI×',  values:[1, 2, 3, 4, 5, 6, 7] },
  { arch:'ES', dim:'minADX',       label:'ES c6b: Min ADX',             values:[10, 12, 13, 15, 17, 20, 22] },
  // ── PerfectStorm ─────────────────────────────────────────────────────────
  { arch:'PS', dim:'minFireCount', label:'PS: Min archetypes firing',   values:[2, 3, 4] },
  { arch:'PS', dim:'minADXgate',   label:'PS: ADX pre-gate',            values:[18, 20, 22, 25, 28, 30] },
  { arch:'PS', dim:'minQualTier',  label:'PS: Min quality tier (0-4)',  values:[1, 2, 3] },
  { arch:'PS', dim:'maxCandleRisk',label:'PS: Max candle risk %',       values:[5, 6, 7, 8, 10, 12] },
];

// Build ALL_TESTS: independent sweep (one dim varies, rest = CUR)
const ALL_TESTS = [];
for (const d of DIMS) {
  for (const v of d.values) {
    ALL_TESTS.push({ ...d, value: v, mode: 'INDEP' });
  }
}

// Joint 2-dim grids: most impactful pairs per archetype
const JOINT_GRIDS = [
  { arch:'VF', d1:'minVolRatio',   v1s:[2.5,3.0,3.5,3.7,4.0,4.5], d2:'minRangeATR', v2s:[1.5,1.8,2.0,2.2,2.4,2.7,3.0] },
  { arch:'VF', d1:'minCloseLoc',   v1s:[60,65,68,72,75],           d2:'maxUpperWick', v2s:[15,18,20,25,30] },
  { arch:'CC', d1:'minCoilBars',   v1s:[5,6,7,8,9,10],             d2:'maxBBPctl',    v2s:[30,35,40,47,55] },
  { arch:'CC', d1:'maxRangeATR',   v1s:[0.55,0.65,0.70,0.75,0.80], d2:'minCloseLoc', v2s:[45,50,55,60,65] },
  { arch:'MP', d1:'dd52WLo',       v1s:[24,27,30,31,34,37],        d2:'dd52WHi',      v2s:[38,42,45,50,55] },
  { arch:'MP', d1:'minVolRatio',   v1s:[1.2,1.5,1.8,2.0,2.2,2.5], d2:'minADX',       v2s:[18,20,22,25,28] },
  { arch:'ES', d1:'minEMA10Spread',v1s:[0.0,0.3,0.5,0.7,0.9,1.2], d2:'minVolRatio',  v2s:[1.3,1.5,1.7,1.9,2.1,2.3] },
  { arch:'ES', d1:'minBelowBars',  v1s:[2,3,4,5,6,7],              d2:'maxBSC',       v2s:[1,2,3,4,5,6] },
  { arch:'PS', d1:'minFireCount',  v1s:[2,3,4],                    d2:'minADXgate',   v2s:[18,20,22,25,28,30] },
];

for (const g of JOINT_GRIDS) {
  for (const v1 of g.v1s) for (const v2 of g.v2s) {
    ALL_TESTS.push({ arch: g.arch, dim: `${g.d1}×${g.d2}`, label: `${g.arch} joint ${g.d1}×${g.d2}`,
      value: `${v1}×${v2}`, v1, v2, d1: g.d1, d2: g.d2, mode: 'JOINT' });
  }
}

const T = ALL_TESTS.length;

// ─────────────────────────────────────────────────────────────────────────────
// ARCHETYPE CONDITION FUNCTIONS — match stockEngine.ts exactly
// ─────────────────────────────────────────────────────────────────────────────
// Each returns conditionsMet (0-6) given pre-computed feature object + params
function checkVF(f, P) {
  if (!f.isGreen || f.candleRisk > 8) return -1;  // hard pre-gate
  const c1 = f.volRatio20 >= P.minVolRatio;
  const c2 = f.closeLoc >= P.minCloseLoc && f.uwPct <= P.maxUpperWick;
  const c3 = f.hi20Frac >= P.minHi20Frac;
  const c4 = f.rangeATR >= P.minRangeATR;
  const c5 = f.openRatio >= P.maxGapDown;
  const c6 = f.diPlus > f.diMinus && f.adx >= P.minADX;
  return [c1,c2,c3,c4,c5,c6].filter(Boolean).length;
}

function checkCC(f, P) {
  if (!f.isGreen || f.candleRisk > 8) return -1;
  const c1 = f.coilBars >= P.minCoilBars && f.coilBars <= P.maxCoilBars;
  const c2 = f.volDeclineDays >= 2;
  const c3 = f.pricePos20 >= P.minPricePos;
  const c4 = f.bbPctl <= P.maxBBPctl;
  const c5 = f.rangeATR <= P.maxRangeATR && f.isGreen && f.closeLoc >= P.minCloseLoc && f.bPct >= P.minBodyPct;
  const c6 = f.diPlus > f.diMinus && f.adx >= P.minADX;
  return [c1,c2,c3,c4,c5,c6].filter(Boolean).length;
}

function checkMP(f, P) {
  const c1 = f.dd52W >= P.dd52WLo && f.dd52W <= P.dd52WHi;
  const c2 = true;  // stabilizationBars always passes per engine code
  const greenPath = f.closeLoc >= P.minCloseLoc && f.bPct >= P.minBodyPct && f.isGreen && f.uwPct <= P.maxUpperWick;
  const hammerPath = f.isHammer && f.closeLoc >= 60;
  const c3 = greenPath || hammerPath;
  const c4 = f.volRatio20 >= P.minVolRatio;
  const c5 = f.rsi14 >= P.rsi14Lo && f.rsi14 <= P.rsi14Hi;
  const c6 = f.bscDI <= P.maxBSC && f.adx >= P.minADX;
  return [c1,c2,c3,c4,c5,c6].filter(Boolean).length;
}

function checkES(f, P) {
  if (!f.crossedToday) return -1;  // hard gate: EMA cross is structural
  const c1 = true;  // crossedToday already gated above
  const c2 = f.belowBars >= P.minBelowBars;
  const c3 = f.ema10Spread >= P.minEMA10Spread && f.isGreen && f.bPct >= P.minBodyPct && f.uwPct <= P.maxUpperWick && f.candleRisk <= P.maxCandleRisk;
  const c4 = f.volRatio20 >= P.minVolRatio;
  const c5 = f.recentlyOversold;
  const c6 = f.diPlus > f.diMinus && f.bscDI <= P.maxBSC && f.adx >= P.minADX;
  return [c1,c2,c3,c4,c5,c6].filter(Boolean).length;
}

// PS reuses sub-archetype fire counts; we compute independently here
// f.vfMet, f.ccMet, f.mpMet, f.esMet = sub-archetype conditionsMet at CUR values
function checkPS(f, P) {
  if (f.adx < P.minADXgate) return -1;
  if (f.qualTier < P.minQualTier || f.candleRisk > P.maxCandleRisk) return -1;
  const fires = (f.vfFires ? 1 : 0) + (f.ccFires ? 1 : 0) + (f.mpFires ? 1 : 0) + (f.esFires ? 1 : 0);
  return fires >= P.minFireCount ? fires : 0;
}

// Build effective param set: start from CUR, override with this test's dim(s)
function effectiveParams(arch, test) {
  const P = { ...CUR[arch] };
  if (test.mode === 'INDEP') { P[test.dim] = test.value; }
  else { P[test.d1] = test.v1; P[test.d2] = test.v2; }
  return P;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, isCut, tests } = workerData;

  // Separate tests by archetype for fast dispatch
  const byArch = { VF:[], CC:[], MP:[], ES:[], PS:[] };
  tests.forEach((t, ti) => byArch[t.arch].push({ ...t, ti }));

  const accum = new Int32Array(T * 2 * N_EX * 2);  // [testIdx][is/oos][exit][w/n]
  const inc = (ti, isIs, ei, win) => {
    const b = (ti*2+(isIs?0:1))*N_EX*2 + ei*2;
    accum[b+1]++; if(win) accum[b]++;
  };

  for (const file of files) {
    let C;
    try { C = parseCSV(fs.readFileSync(file, 'utf8')); } catch(_){ continue; }
    if (C.length < 60) continue;

    const A14 = atr14(C);
    const E10  = ema(C, 10);
    const E20  = ema(C, 20);
    const { diP, diM, adx } = dmi14(C);
    const bbP  = bbWidthPctls(C);
    const n = C.length;

    // Rolling turnover & volume avg
    let tS=0, vS=0, tcnt=0;

    for (let i = 50; i < n - 1; i++) {
      // Update rolling 20-bar windows (bars i-20 to i-1)
      if (i === 50) {
        tS=0; vS=0; tcnt=0;
        for (let j=Math.max(0,i-20);j<i;j++){tS+=C[j].c*C[j].v;vS+=C[j].v;tcnt++;}
      } else {
        tS+=C[i-1].c*C[i-1].v; vS+=C[i-1].v; tcnt++;
        if(tcnt>20){const d=Math.max(0,i-21);tS-=C[d].c*C[d].v;vS-=C[d].v;tcnt--;}
      }
      if (tcnt < 5) continue;
      const turnover20 = tS/tcnt;
      const vAvg20 = vS/tcnt;
      if (turnover20 < 5_000_000) continue;

      const sig = C[i];
      const a14 = A14[i] || sig.c*0.02;
      const ca  = candleArch(sig, a14);
      if (!ca) continue;

      const isIs = sig.d < isCut;

      // ── Pre-compute all features ─────────────────────────────────────
      const vr20 = vAvg20 > 0 ? sig.v/vAvg20 : 0;
      const sigRange = sig.h - sig.l;
      const rATR = sigRange / (a14||0.0001);
      const prevC = i>0?C[i-1].c:sig.o;
      const rsi14v = rsi(C, 14, i);

      // 20d high (excl today)
      let hi20=0; for(let j=Math.max(0,i-20);j<i;j++) if(C[j].h>hi20) hi20=C[j].h;
      // 20d range for price position
      let lo20=Infinity; let hi20b=0;
      for(let j=Math.max(0,i-20);j<=i;j++){if(C[j].l<lo20)lo20=C[j].l;if(C[j].h>hi20b)hi20b=C[j].h;}

      // ── VolumeFootprint features ──────────────────────────────────
      const fVF = {
        isGreen: ca.isGreen, candleRisk: ca.risk,
        volRatio20: vr20, closeLoc: ca.cl, uwPct: ca.uwPct,
        hi20Frac: hi20>0?sig.c/hi20:0,
        rangeATR: rATR,
        openRatio: prevC>0?sig.o/prevC:1,
        diPlus: diP[i], diMinus: diM[i], adx: adx[i],
      };

      // ── CompressionCoil features ──────────────────────────────────
      let coilBars=0;
      for(let j=i-1;j>=Math.max(0,i-15);j--){
        if((C[j].h-C[j].l)<0.70*(A14[j]||a14)) coilBars++; else break;
      }
      let volDec=0;
      for(let j=i-1;j>=Math.max(1,i-5);j--){
        if(C[j].v<C[j-1].v) volDec++; else break;
      }
      const pricePos20 = (hi20b>lo20)?(sig.c-lo20)/(hi20b-lo20)*100:50;

      const fCC = {
        isGreen: ca.isGreen, candleRisk: ca.risk,
        coilBars, volDeclineDays: volDec, pricePos20, bbPctl: bbP[i],
        rangeATR: rATR, closeLoc: ca.cl, bPct: ca.bPct,
        diPlus: diP[i], diMinus: diM[i], adx: adx[i],
      };

      // ── MomentumPocket features ───────────────────────────────────
      if (turnover20 >= 10_000_000) {
        let hh252=0;
        for(let j=Math.max(0,i-252);j<i;j++) if(C[j].h>hh252) hh252=C[j].h;
        const dd52W = hh252>0?(hh252-sig.c)/hh252*100:0;
        const bscMP = bscDI(diP, diM, i, 10);

        const fMP = {
          dd52W, closeLoc: ca.cl, bPct: ca.bPct, uwPct: ca.uwPct,
          isGreen: ca.isGreen, isHammer: ca.isHammer,
          volRatio20: vr20, rsi14: rsi14v, bscDI: bscMP, adx: adx[i],
        };

        // ── EMAStack features ─────────────────────────────────────
        const prevClose2 = i>0?C[i-1].c:0;
        const prevE20   = i>0?(E20[i-1]||0):0;
        const crossedToday = sig.c>E20[i] && prevClose2<prevE20 && E20[i]>0;
        let belowBars=0;
        for(let j=i-1;j>=Math.max(0,i-20);j--){
          if(C[j].c<(E20[j]||0)) belowBars++; else break;
        }
        const ema10Spread = E20[i]>0?(E10[i]-E20[i])/E20[i]*100:0;
        let recentOversold=false;
        for(let j=Math.max(1,i-4);j<=i;j++){
          if(rsi(C,2,j)<=50){recentOversold=true;break;}
        }
        const bscES = bscDI(diP, diM, i, 7);

        const fES = {
          crossedToday, belowBars, ema10Spread,
          isGreen: ca.isGreen, bPct: ca.bPct, uwPct: ca.uwPct, candleRisk: ca.risk,
          volRatio20: vr20, recentlyOversold: recentOversold,
          diPlus: diP[i], diMinus: diM[i], bscDI: bscES, adx: adx[i],
        };

        // ── PerfectStorm features ─────────────────────────────────
        // Evaluate sub-archetypes at CURRENT param values
        let qualTier=0;
        if(ca.cl>=55) qualTier++;
        if(ca.bPct>=40) qualTier++;
        if(ca.uwPct<=20) qualTier++;
        if(ca.lwPct>=8) qualTier++;

        const vfFires = checkVF(fVF, CUR.VF) >= 4;
        const ccFires = checkCC(fCC, CUR.CC) >= 4;
        const mpFires = checkMP(fMP, CUR.MP) >= 4;
        const esFires = crossedToday && checkES(fES, CUR.ES) >= 4;
        const fPS = { adx: adx[i], qualTier, candleRisk: ca.risk, vfFires, ccFires, mpFires, esFires };

        // ── Run all tests ─────────────────────────────────────────
        for (const t of byArch.MP) {
          const P = effectiveParams('MP', t);
          if (checkMP(fMP, P) < 4) continue;
          for(let ti2=0;ti2<TP_G.length;ti2++) for(let si2=0;si2<SL_G.length;si2++) for(let hi2=0;hi2<HB_G.length;hi2++){
            inc(t.ti, isIs, exitIdx(ti2,si2,hi2), simExit(C,i,TP_G[ti2],SL_G[si2],HB_G[hi2],A14));
          }
        }
        for (const t of byArch.ES) {
          const P = effectiveParams('ES', t);
          if (checkES(fES, P) < 4) continue;
          for(let ti2=0;ti2<TP_G.length;ti2++) for(let si2=0;si2<SL_G.length;si2++) for(let hi2=0;hi2<HB_G.length;hi2++){
            inc(t.ti, isIs, exitIdx(ti2,si2,hi2), simExit(C,i,TP_G[ti2],SL_G[si2],HB_G[hi2],A14));
          }
        }
        for (const t of byArch.PS) {
          const P = effectiveParams('PS', t);
          if (checkPS(fPS, P) <= 0) continue;
          for(let ti2=0;ti2<TP_G.length;ti2++) for(let si2=0;si2<SL_G.length;si2++) for(let hi2=0;hi2<HB_G.length;hi2++){
            inc(t.ti, isIs, exitIdx(ti2,si2,hi2), simExit(C,i,TP_G[ti2],SL_G[si2],HB_G[hi2],A14));
          }
        }
      }

      for (const t of byArch.VF) {
        const P = effectiveParams('VF', t);
        if (checkVF(fVF, P) < 4) continue;
        for(let ti2=0;ti2<TP_G.length;ti2++) for(let si2=0;si2<SL_G.length;si2++) for(let hi2=0;hi2<HB_G.length;hi2++){
          inc(t.ti, isIs, exitIdx(ti2,si2,hi2), simExit(C,i,TP_G[ti2],SL_G[si2],HB_G[hi2],A14));
        }
      }
      for (const t of byArch.CC) {
        const P = effectiveParams('CC', t);
        if (checkCC(fCC, P) < 4) continue;
        for(let ti2=0;ti2<TP_G.length;ti2++) for(let si2=0;si2<SL_G.length;si2++) for(let hi2=0;hi2<HB_G.length;hi2++){
          inc(t.ti, isIs, exitIdx(ti2,si2,hi2), simExit(C,i,TP_G[ti2],SL_G[si2],HB_G[hi2],A14));
        }
      }
    }
  }

  parentPort.postMessage({ accum: Buffer.from(accum.buffer) });
  return;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const files = fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')).map(f=>path.join(DATA_DIR,f));
console.log(`\nArchetype Tune  ${new Date().toISOString()}`);
console.log(`Files: ${files.length}  Workers: ${N_WORKERS}  Tests: ${T}  Exits/test: ${N_EX}`);

const chunks = Array.from({length:N_WORKERS},()=>[]);
files.forEach((f,i)=>chunks[i%N_WORKERS].push(f));
const global = new Int32Array(T * 2 * N_EX * 2);

let done = 0;
const wPromises = chunks.map(chunk => new Promise(res => {
  const w = new Worker(__filename, { workerData: { files: chunk, isCut: IS_CUT, tests: ALL_TESTS } });
  w.on('message', ({ accum }) => {
    const a = new Int32Array(Buffer.from(accum).buffer);
    for (let k=0;k<global.length;k++) global[k]+=a[k];
    done++; process.stdout.write(`\r  Workers: ${done}/${N_WORKERS}`);
    res();
  });
  w.on('error', res);
}));

Promise.all(wPromises).then(() => {
  console.log('\n\nDone. Building report...\n');

  // ── Helper: get best-exit for a test (max OOS Wilson) ─────────────────
  function bestExit(ti, isIs) {
    const base = (ti*2+(isIs?0:1))*N_EX*2;
    let bw=-1, btp=0, bsl=0, bh=0, bW=0, bN=0;
    for(let a=0;a<TP_G.length;a++) for(let b2=0;b2<SL_G.length;b2++) for(let c2=0;c2<HB_G.length;c2++){
      const idx=base+exitIdx(a,b2,c2)*2;
      const w=global[idx], n=global[idx+1];
      const wr=wilsonLower(w,n);
      if(wr>bw){bw=wr;btp=TP_G[a];bsl=SL_G[b2];bh=HB_G[c2];bW=w;bN=n;}
    }
    return {wilson:bw,wins:bW,total:bN,tp:btp,sl:bsl,hb:bh};
  }

  const OUT = [];
  const bar = '═'.repeat(130);
  const sep = '─'.repeat(130);

  OUT.push('');
  OUT.push(bar);
  OUT.push('ARCHETYPE PARAMETER TUNE — Full IS/OOS Grid Search on 1617 NSE Stocks');
  OUT.push(bar);

  // ── Phase 1: INDEPENDENT sweeps ───────────────────────────────────────
  OUT.push('\n════ PHASE 1: PER-DIM MARGINAL LIFT (all other params = current production) ════\n');

  // Group by arch+dim
  const dimGroups = {};
  ALL_TESTS.forEach((t, ti) => {
    if (t.mode !== 'INDEP') return;
    const key = `${t.arch}::${t.dim}`;
    if (!dimGroups[key]) dimGroups[key] = { arch:t.arch, label:t.label, entries:[] };
    const oos = bestExit(ti, false);
    const is2 = bestExit(ti, true);
    dimGroups[key].entries.push({ value:t.value, ti, is:is2, oos });
  });

  // Baseline for lift: find the entry closest to CUR value
  const allLifts = [];
  for (const key of Object.keys(dimGroups)) {
    const g = dimGroups[key];
    // Sort by oos.wilson descending for display
    const dimName = g.entries[0] ? key.split('::')[1] : '';
    const archName = g.arch;
    const curVal = CUR[archName]?.[dimName];
    // Base = the entry with value === curVal (or closest)
    const baseEntry = g.entries.find(e => e.value === curVal) || g.entries[0];
    const baseOOS = baseEntry.oos;

    OUT.push(`▶ ${g.label}`);
    OUT.push(`  ${'Value'.padEnd(10)} ${'IS_n'.padStart(7)} ${'IS_WR'.padStart(8)} ${'OOS_n'.padStart(7)} ${'OOS_WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'Lift'.padStart(9)} ${'Best Exit'.padStart(22)}`);
    OUT.push('  ' + sep.slice(0,95));

    for (const e of g.entries.sort((a,b)=>a.value-b.value||String(a.value).localeCompare(String(b.value)))) {
      const isWR  = e.is.total>0?(e.is.wins/e.is.total*100).toFixed(1)+'%':'—';
      const oosWR = e.oos.total>0?(e.oos.wins/e.oos.total*100).toFixed(1)+'%':'—';
      const wil   = e.oos.total>=MIN_N?(e.oos.wilson*100).toFixed(1)+'%':'—';
      const lift  = (e.oos.total>=MIN_N && baseOOS.total>=MIN_N)
        ? ((e.oos.wilson-baseOOS.wilson)*100).toFixed(1)+'pp' : '—';
      const ex    = e.oos.total>=MIN_N?`TP${e.oos.tp}% SL${e.oos.sl}×ATR HB${e.oos.hb}d`:'—';
      const star  = (e.oos.total>=MIN_N && baseOOS.total>=MIN_N && e.oos.wilson>baseOOS.wilson+0.01)?'★':
                    (e.value===curVal?'·':' ');
      OUT.push(`  ${star} ${String(e.value).padEnd(9)} ${String(e.is.total).padStart(7)} ${isWR.padStart(8)} ${String(e.oos.total).padStart(7)} ${oosWR.padStart(8)} ${wil.padStart(8)} ${lift.padStart(9)} ${ex.padStart(22)}`);
      if (e.oos.total >= MIN_N && baseOOS.total >= MIN_N)
        allLifts.push({ key, arch:g.arch, label:g.label, value:e.value, curVal,
          wilson:e.oos.wilson, lift:e.oos.wilson-baseOOS.wilson, oosN:e.oos.total,
          oosWR:e.oos.total>0?e.oos.wins/e.oos.total:0, exit:`TP${e.oos.tp}% SL${e.oos.sl}×ATR HB${e.oos.hb}d` });
    }
    OUT.push('');
  }

  // ── Phase 1 Leaderboard ───────────────────────────────────────────────
  OUT.push('\n─── Phase 1 Top-25 Single-Dim Lifts ───\n');
  const topLifts = allLifts.filter(e=>e.lift>0).sort((a,b)=>b.lift-a.lift).slice(0,25);
  OUT.push(`  ${'Param'.padEnd(38)} ${'Value→Best'.padEnd(12)} ${'OOS_n'.padStart(7)} ${'OOS_WR'.padStart(9)} ${'Wilson'.padStart(8)} ${'Lift'.padStart(8)} ${'Exit'.padStart(22)}`);
  OUT.push('  '+sep.slice(0,110));
  for (const e of topLifts) {
    OUT.push(`  ${e.label.padEnd(38)} ${(String(e.curVal)+'→'+String(e.value)).padEnd(12)} ${String(e.oosN).padStart(7)} ${(e.oosWR*100).toFixed(1).padStart(8)}% ${(e.wilson*100).toFixed(1).padStart(7)}% ${(e.lift*100).toFixed(1).padStart(7)}pp  ${e.exit.padStart(22)}`);
  }

  // ── Sweet spot per dim (best wilson) ─────────────────────────────────
  OUT.push('\n─── Phase 1 Sweet Spots Per Dim ───\n');
  const sweetPerDim = {};
  for (const e of allLifts) {
    if (!sweetPerDim[e.key] || e.wilson > sweetPerDim[e.key].wilson) sweetPerDim[e.key] = e;
  }
  for (const key of Object.keys(sweetPerDim)) {
    const e = sweetPerDim[key];
    OUT.push(`  [${e.arch}] ${e.label.padEnd(40)} cur=${String(e.curVal).padEnd(6)} → BEST=${String(e.value).padEnd(7)}  OOS_n=${e.oosN}  WR=${(e.oosWR*100).toFixed(1)}%  Wilson=${(e.wilson*100).toFixed(1)}%  lift=${e.lift>0?'+':''}${(e.lift*100).toFixed(1)}pp`);
  }

  // ── Phase 2: JOINT sweeps ─────────────────────────────────────────────
  OUT.push('\n\n════ PHASE 2: JOINT 2-DIM GRID (sweet-spot compound combinations) ════\n');

  const jointTests = ALL_TESTS.map((t,ti)=>({...t,ti})).filter(t=>t.mode==='JOINT');
  // Group by arch+dim pair
  const jointGroups = {};
  for (const t of jointTests) {
    if (!jointGroups[t.dim]) jointGroups[t.dim] = { arch:t.arch, dim:t.dim, entries:[] };
    const oos = bestExit(t.ti, false);
    const is2 = bestExit(t.ti, true);
    jointGroups[t.dim].entries.push({ v1:t.v1, v2:t.v2, d1:t.d1, d2:t.d2, oos, is:is2 });
  }

  for (const dimKey of Object.keys(jointGroups)) {
    const g = jointGroups[dimKey];
    const best10 = g.entries.filter(e=>e.oos.total>=MIN_N).sort((a,b)=>b.oos.wilson-a.oos.wilson).slice(0,12);
    if (best10.length === 0) continue;
    OUT.push(`▶ [${g.arch}] ${dimKey}`);
    OUT.push(`  ${'d1-val'.padEnd(8)} ${'d2-val'.padEnd(8)} ${'OOS_n'.padStart(7)} ${'OOS_WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'IS_WR'.padStart(8)} ${'Best Exit'.padStart(22)}`);
    OUT.push('  '+sep.slice(0,78));
    for (const e of best10) {
      const oosWR = e.oos.total>0?(e.oos.wins/e.oos.total*100).toFixed(1)+'%':'—';
      const isWR  = e.is.total>0?(e.is.wins/e.is.total*100).toFixed(1)+'%':'—';
      const ex    = `TP${e.oos.tp}% SL${e.oos.sl}×ATR HB${e.oos.hb}d`;
      OUT.push(`  ${String(e.v1).padEnd(8)} ${String(e.v2).padEnd(8)} ${String(e.oos.total).padStart(7)} ${oosWR.padStart(8)} ${(e.oos.wilson*100).toFixed(1).padStart(7)}% ${isWR.padStart(8)} ${ex.padStart(22)}`);
    }
    OUT.push('');
  }

  // ── FINAL RECOMMENDATIONS ─────────────────────────────────────────────
  OUT.push(bar);
  OUT.push('SWEET SPOT RECOMMENDATIONS — changes to commit to stockEngine.ts');
  OUT.push(bar);

  const archLabel = { VF:'VolumeFootprint', CC:'CompressionCoil', MP:'MomentumPocket', ES:'EMAStack', PS:'PerfectStorm' };
  for (const arch of ['VF','CC','MP','ES','PS']) {
    OUT.push(`\n${archLabel[arch]}`);
    const dims = Object.values(sweetPerDim).filter(e=>e.arch===arch).sort((a,b)=>b.lift-a.lift);
    for (const e of dims) {
      const changed = e.value !== e.curVal;
      const marker = changed ? (e.lift > 0.005 ? '▲ CHANGE' : '≈ MARGINAL') : '· NO CHANGE';
      OUT.push(`  ${marker.padEnd(12)} ${e.label.padEnd(40)} ${String(e.curVal)} → ${String(e.value).padEnd(8)} lift=${e.lift>0?'+':''}${(e.lift*100).toFixed(1)}pp  OOS_n=${e.oosN}  WR=${(e.oosWR*100).toFixed(1)}%  Wilson=${(e.wilson*100).toFixed(1)}%`);
    }
    // Best joint combo
    const jBest = Object.values(jointGroups).filter(g=>g.arch===arch)
      .flatMap(g=>g.entries.filter(e=>e.oos.total>=MIN_N)).sort((a,b)=>b.oos.wilson-a.oos.wilson)[0];
    if (jBest) OUT.push(`  JOINT BEST: ${jBest.d1}=${jBest.v1}  ${jBest.d2}=${jBest.v2}  OOS_n=${jBest.oos.total}  WR=${jBest.oos.total>0?(jBest.oos.wins/jBest.oos.total*100).toFixed(1):'—'}%  Wilson=${(jBest.oos.wilson*100).toFixed(1)}%  Exit=TP${jBest.oos.tp}% SL${jBest.oos.sl}×ATR HB${jBest.oos.hb}d`);
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  OUT.push(''); OUT.push(`Elapsed: ${elapsed}s`); OUT.push(bar);

  const report = OUT.join('\n');
  console.log(report);

  const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
  const outF = path.join('D:/Claude code/stock-screener/scripts', `archetypeTune_${ts}.txt`);
  fs.writeFileSync(outF, report);
  console.log(`\n✅ Report: ${outF}`);
});
