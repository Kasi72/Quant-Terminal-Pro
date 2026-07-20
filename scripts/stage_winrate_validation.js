#!/usr/bin/env node
/**
 * STAGE WIN RATE VALIDATION
 * Compute empirical win rates for BUY / STRONG_BUY / ULTRA_STRONG_BUY
 * using Phase-2 optimized weights across all 4 archetypes.
 *
 * Each candle is run through all archetypes; the highest-scoring
 * archetype determines its stage (mirrors stockEngine.ts logic).
 *
 * Win = 5% profit target hit within 20 bars.
 * Loss = stop-loss (3×ATR) hit, or 20-bar exit without target.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';
const TARGET    = 5;     // % profit target
const SL_MULT   = 3.0;  // 3×ATR stop (deployed)
const MAX_BARS  = 20;

// ── New Phase-2 weights (matching stockEngine.ts after phase-2 edit) ─────────
const WEIGHTS = {
  CompressionCoil:  [20,  3, 49, 18,  3,  3],
  VolumeFootprint:  [43,  3,  3, 21,  3, 18],
  MomentumPocket:   [ 3, 10, 16,  3, 39, 25],
  EMAStack:         [23,  3, 39, 17,  3, 11],
};

// Phase-3: per-archetype ULTRA thresholds (expectancy-maximized, bootstrap-validated)
const ULTRA_T = {
  CompressionCoil: 84,  // WR 67.4% @ n=315  bootstrap [62.2–72.1%]
  VolumeFootprint: 98,  // WR 64.8% @ n=125  bootstrap [56.0–72.8%]
  MomentumPocket:  99,  // WR 62.4% @ n=404  bootstrap [57.9–67.1%]
  EMAStack:        99,  // WR 72.3% @ n=83   bootstrap [62.7–81.9%]
};
const THRESH = { STRONG: 62, BUY: 43 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadCSV(fp) {
  return fs.readFileSync(fp, 'utf8').trim().split('\n').slice(1).map(l => {
    const [, o, h, lo, c, v] = l.split(',');
    return { o: +o, h: +h, l: +lo, c: +c, v: parseInt(v) || 0 };
  }).filter(r => r.c > 0);
}

function atr14(cs, end) {
  if (end < 14) return cs[end] ? cs[end].h - cs[end].l : 0;
  let s = 0;
  for (let i = end - 13; i <= end; i++)
    s += Math.max(cs[i].h - cs[i].l,
                  Math.abs(cs[i].h - cs[i-1].c),
                  Math.abs(cs[i].l - cs[i-1].c));
  return s / 14;
}

function avgVol(cs, end, n) {
  let s = 0, cnt = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) { s += cs[i].v; cnt++; }
  return cnt > 0 ? s / cnt : 0;
}

function bbWidth(cs, end) {
  if (end < 20) return 0;
  let sum = 0;
  for (let i = end - 19; i <= end; i++) sum += cs[i].c;
  const mean = sum / 20;
  let v = 0;
  for (let i = end - 19; i <= end; i++) v += (cs[i].c - mean) ** 2;
  return cs[end].c > 0 ? 4 * Math.sqrt(v / 20) / cs[end].c : 0;
}

function dmi(cs, end) {
  if (end < 14) return { dp: 20, dm: 20 };
  let pdm = 0, mdm = 0, tr = 0;
  for (let i = end - 13; i <= end; i++) {
    const up   = cs[i].h - cs[i-1].h;
    const down = cs[i-1].l - cs[i].l;
    pdm += (up > down && up > 0)   ? up   : 0;
    mdm += (down > up && down > 0) ? down : 0;
    tr  += Math.max(cs[i].h - cs[i].l,
                    Math.abs(cs[i].h - cs[i-1].c),
                    Math.abs(cs[i].l - cs[i-1].c));
  }
  return tr > 0
    ? { dp: 100 * pdm / tr, dm: 100 * mdm / tr }
    : { dp: 20, dm: 20 };
}

function label(cs, idx, entry, a) {
  const tgt = entry * (1 + TARGET / 100);
  const sl  = entry - SL_MULT * a;
  for (let i = idx + 1; i <= Math.min(idx + MAX_BARS, cs.length - 1); i++) {
    if (cs[i].l <= sl)  return { win: 0, exit: 'SL',     bars: i - idx };
    if (cs[i].h >= tgt) return { win: 1, exit: 'TARGET', bars: i - idx };
  }
  return { win: 0, exit: 'TIME', bars: MAX_BARS };
}

// ── Archetype condition vectors ───────────────────────────────────────────────

function compressionCoil(cs, i, a) {
  const sig = cs[i];
  let comprBars = 0;
  for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
    if ((cs[j].h - cs[j].l) < 0.7 * a) comprBars++; else break;
  }
  let volDec = 0;
  for (let j = i - 1; j >= Math.max(1, i - 5); j--) {
    if (cs[j].v < cs[j-1].v) volDec++; else break;
  }
  let hi20 = 0, lo20 = Infinity;
  for (let j = Math.max(0, i - 20); j < i; j++) {
    hi20 = Math.max(hi20, cs[j].h); lo20 = Math.min(lo20, cs[j].l);
  }
  const pp20 = hi20 > lo20 ? (sig.c - lo20) / (hi20 - lo20) * 100 : 50;

  if (i < 60) return null;
  const bws = [];
  for (let j = i - 59; j <= i; j++) bws.push(bbWidth(cs, j));
  bws.sort((a, b) => a - b);
  const pctl30 = bws[Math.floor(bws.length * 0.30)];

  const sr = sig.h - sig.l;
  const cl = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const bp = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0;
  const { dp, dm } = dmi(cs, i);

  const c = [
    comprBars >= 8,
    volDec >= 2,
    pp20 >= 59,
    bbWidth(cs, i) <= pctl30,
    sr <= 0.8 * a && sig.c > sig.o && cl > 55 && bp > 30,
    dp > dm,
  ];
  const bonus = Math.min(10, comprBars * 3) + Math.min(5, Math.max(0, pp20 - 65) * 0.5);
  return { c, bonus };
}

function volumeFootprint(cs, i, a) {
  if (i < 20) return null;
  const sig   = cs[i];
  const v20   = avgVol(cs, i - 1, 20);
  const vr20  = v20 > 0 ? sig.v / v20 : 0;
  const sr    = sig.h - sig.l;
  const cl    = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const uw    = sr > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sr * 100 : 0;
  let hi20 = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) hi20 = Math.max(hi20, cs[j].h);
  const rng   = sr / a;
  const prev  = i > 0 ? cs[i-1].c : sig.o;
  const gap   = prev > 0 ? (sig.o - prev) / prev * 100 : 0;
  const { dp, dm } = dmi(cs, i);

  const c = [
    vr20  >= 3.7,
    cl >= 68 && uw <= 12,
    hi20 > 0 && sig.c >= hi20 * 0.83,
    rng >= 2.4,
    gap >= -2.6,
    dp > dm,
  ];
  const bonus = Math.min(10, (vr20 - 3) * 5) + Math.min(5, (cl - 68) * 0.3);
  return { c, bonus };
}

function momentumPocket(cs, i, a) {
  if (i < 60) return null;
  const sig = cs[i];
  let hi52 = 0;
  for (let j = Math.max(0, i - 252); j < i; j++) hi52 = Math.max(hi52, cs[j].h);
  const dd52 = hi52 > 0 ? (hi52 - sig.c) / hi52 * 100 : 0;
  const refL = i >= 20 ? Math.min(...cs.slice(i - 20, i).map(b => b.l)) : sig.l;
  const sr   = sig.h - sig.l;
  const bp   = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0;
  const cl   = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const v20  = avgVol(cs, i - 1, 20);
  const vr20 = v20 > 0 ? sig.v / v20 : 0;
  const { dp, dm } = dmi(cs, i);

  // stabilizationBars: consecutive bars where range < ATR (proxy)
  let stabBars = 0;
  for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
    if ((cs[j].h - cs[j].l) < a) stabBars++; else break;
  }

  const c = [
    dd52 >= 15,
    sig.l > refL,
    sig.c > sig.o && bp >= 60,
    cl >= 55,
    vr20 >= 1.5,
    dp > dm,
  ];
  const bonus = Math.min(10, stabBars * 3) + Math.min(5, (vr20 - 1.5) * 4);
  return { c, bonus };
}

function emaStack(cs, i, a) {
  if (i < 55) return null;
  const sig = cs[i];
  const k20 = 2 / 21, k50 = 2 / 51;
  let e20 = cs[0].c, e50 = cs[0].c;
  for (let j = 1; j < i; j++) {
    e20 = cs[j].c * k20 + e20 * (1 - k20);
    e50 = cs[j].c * k50 + e50 * (1 - k50);
  }
  const prevE20 = e20;
  e20 = sig.c * k20 + e20 * (1 - k20);

  let below = 0;
  for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
    if (cs[j].c < prevE20) below++; else break;
  }
  const sr  = sig.h - sig.l;
  const bp  = sr > 0 ? Math.abs(sig.c - sig.o) / sr * 100 : 0;
  const cl  = sr > 0 ? (sig.c - sig.l) / sr * 100 : 50;
  const v20 = avgVol(cs, i - 1, 20);
  const vr  = v20 > 0 ? sig.v / v20 : 0;
  const { dp, dm } = dmi(cs, i);

  const c = [
    sig.c > e20 && cs[i-1]?.c <= prevE20,
    below >= 3,
    e20 > e50,
    sig.c > sig.o && bp >= 40,
    cl >= 60,
    dp > dm,
  ];
  const bonus = Math.min(10, below * 2) + Math.min(5, (vr - 1.8) * 5);
  return { c, bonus };
}

// ── Score from condition vector ───────────────────────────────────────────────

function score(arch, cvec, bonus) {
  const w = WEIGHTS[arch];
  return Math.min(100, Math.round(
    cvec.reduce((s, b, j) => s + (b ? w[j] : 0), 0) + bonus
  ));
}

function stage(sc, arch) {
  const ut = ULTRA_T[arch] ?? 86;
  return sc >= ut            ? 'ULTRA'
       : sc >= THRESH.STRONG ? 'STRONG'
       : sc >= THRESH.BUY    ? 'BUY'
       : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 60);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  STAGE WIN RATE VALIDATION');
console.log('  Phase-3 weights · per-arch ULTRA · STRONG=62, BUY=43 · 5% target');
console.log(`  Dataset: ${files.length} stocks · 3×ATR stop · 20-bar window`);
console.log('═══════════════════════════════════════════════════════════════\n');

const totals = {
  ULTRA:  { wins: 0, sl: 0, time: 0, total: 0, bars: 0 },
  STRONG: { wins: 0, sl: 0, time: 0, total: 0, bars: 0 },
  BUY:    { wins: 0, sl: 0, time: 0, total: 0, bars: 0 },
};

const perArch = {
  CompressionCoil: { ULTRA:{w:0,t:0}, STRONG:{w:0,t:0}, BUY:{w:0,t:0} },
  VolumeFootprint: { ULTRA:{w:0,t:0}, STRONG:{w:0,t:0}, BUY:{w:0,t:0} },
  MomentumPocket:  { ULTRA:{w:0,t:0}, STRONG:{w:0,t:0}, BUY:{w:0,t:0} },
  EMAStack:        { ULTRA:{w:0,t:0}, STRONG:{w:0,t:0}, BUY:{w:0,t:0} },
};

// Score-bucket histograms for distribution analysis
const scoreDist = { ULTRA:{}, STRONG:{}, BUY:{}, PRE:{} };
const WR_BY_SCORE = {};
for (let s = 0; s <= 100; s += 5) WR_BY_SCORE[s] = { w: 0, t: 0 };

let processed = 0;

for (const file of files) {
  try {
    const cs = loadCSV(path.join(DATA_DIR, file));
    if (cs.length < 80) continue;
    processed++;

    for (let i = 65; i < cs.length - MAX_BARS; i++) {
      const a = atr14(cs, i);
      if (a === 0) continue;
      const atrPct = a / cs[i].c * 100;
      if (atrPct > 3.5) continue; // HIGH band filter

      // Run all 4 archetypes, pick best score
      const archetypes = [
        ['CompressionCoil', compressionCoil(cs, i, a)],
        ['VolumeFootprint', volumeFootprint(cs, i, a)],
        ['MomentumPocket',  momentumPocket(cs, i, a)],
        ['EMAStack',        emaStack(cs, i, a)],
      ];

      let bestScore = -1, bestArch = null, bestStage = null;

      for (const [arch, res] of archetypes) {
        if (!res) continue;
        const sc = score(arch, res.c, res.bonus);
        const st = stage(sc, arch);
        if (st && sc > bestScore) {
          bestScore = sc; bestArch = arch; bestStage = st;
        }
      }

      if (!bestStage) continue;

      const { win, exit, bars } = label(cs, i, cs[i].c, a);
      const bucket = totals[bestStage];
      bucket.total++;
      bucket.bars += bars;
      if (win) bucket.wins++;
      else if (exit === 'SL')   bucket.sl++;
      else                       bucket.time++;

      // Per-archetype breakdown
      perArch[bestArch][bestStage].t++;
      perArch[bestArch][bestStage].w += win;

      // Score distribution
      const scoreBucket = Math.floor(bestScore / 5) * 5;
      if (WR_BY_SCORE[scoreBucket] !== undefined) {
        WR_BY_SCORE[scoreBucket].t++;
        WR_BY_SCORE[scoreBucket].w += win;
      }
    }
  } catch (e) {}
}

console.log(`Processed: ${processed} stocks\n`);

// ── Main results ──────────────────────────────────────────────────────────────

console.log('─────────────────────────────────────────────────────────────────');
console.log('OVERALL WIN RATES BY SIGNAL STAGE\n');

let grandWins = 0, grandTotal = 0;

for (const [st, b] of [['ULTRA_STRONG_BUY', totals.ULTRA], ['STRONG_BUY', totals.STRONG], ['BUY', totals.BUY]]) {
  if (b.total === 0) { console.log(`${st}: no signals`); continue; }
  const wr   = (b.wins / b.total * 100).toFixed(1);
  const slr  = (b.sl   / b.total * 100).toFixed(1);
  const timer = (b.time / b.total * 100).toFixed(1);
  const avgB = (b.bars  / b.total).toFixed(1);
  grandWins  += b.wins;
  grandTotal += b.total;

  const bar = '█'.repeat(Math.round(b.wins / b.total * 40));
  console.log(`${st}`);
  console.log(`  Signals:    ${b.total}`);
  console.log(`  Win Rate:   ${wr}%  ${bar}`);
  console.log(`  Stop-Loss:  ${slr}%`);
  console.log(`  Time-Exit:  ${timer}%`);
  console.log(`  Avg Hold:   ${avgB} bars`);
  console.log();
}

const overall = grandTotal > 0 ? (grandWins / grandTotal * 100).toFixed(1) : '-';
console.log(`Overall (all stages): ${overall}% WR on ${grandTotal} signals\n`);

// ── Per-archetype breakdown ───────────────────────────────────────────────────

console.log('─────────────────────────────────────────────────────────────────');
console.log('PER-ARCHETYPE BREAKDOWN\n');
console.log('Archetype         | ULTRA WR  (n) | STRONG WR  (n) | BUY WR  (n)');
console.log('─'.repeat(70));

for (const [arch, stages] of Object.entries(perArch)) {
  const u = stages.ULTRA,  s = stages.STRONG, b = stages.BUY;
  const uw = u.t > 0 ? (u.w/u.t*100).toFixed(1) + '%' : '—';
  const sw = s.t > 0 ? (s.w/s.t*100).toFixed(1) + '%' : '—';
  const bw = b.t > 0 ? (b.w/b.t*100).toFixed(1) + '%' : '—';
  console.log(
    `${arch.padEnd(17)} | ${(uw + ` (${u.t})`).padEnd(13)} | ${(sw + ` (${s.t})`).padEnd(14)} | ${bw} (${b.t})`
  );
}

// ── Score vs win rate curve ───────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────────────────────────');
console.log('WIN RATE BY SCORE BUCKET (all archetypes combined)\n');
console.log('Score  | Signals | Win%');
for (const [sc, v] of Object.entries(WR_BY_SCORE)) {
  if (v.t < 5) continue;
  const wr  = (v.w / v.t * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v.w / v.t * 30));
  const tag = +sc >= 84             ? '← ULTRA'
            : +sc >= THRESH.STRONG ? '← STRONG'
            : +sc >= THRESH.BUY    ? '← BUY'
            : '';
  console.log(`${String(sc).padStart(4)}-${String(+sc+4).padStart(3)} | ${String(v.t).padStart(7)} | ${wr.padStart(5)}% ${bar} ${tag}`);
}

// ── Summary table ─────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY\n');
console.log('Stage            | Win Rate | Signals | SL Hit | Time Exit | Avg Hold');
console.log('─'.repeat(72));
const rows = [['ULTRA_STRONG_BUY', totals.ULTRA], ['STRONG_BUY', totals.STRONG], ['BUY', totals.BUY]];
for (const [st, b] of rows) {
  if (b.total === 0) continue;
  console.log(
    `${st.padEnd(16)} | ${(b.wins/b.total*100).toFixed(1).padStart(7)}% | ${String(b.total).padStart(7)} | ${(b.sl/b.total*100).toFixed(1).padStart(5)}% | ${(b.time/b.total*100).toFixed(1).padStart(8)}% | ${(b.bars/b.total).toFixed(1).padStart(6)}d`
  );
}
console.log('═══════════════════════════════════════════════════════════════\n');
