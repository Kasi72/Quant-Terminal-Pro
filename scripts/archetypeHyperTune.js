'use strict';
// scripts/archetypeHyperTune.js
// Hyper-tunes all 6 Momentum Archetype sets via IS/OOS P&L backtesting.
// Workers precompute next-open, stop-first P&L outcomes for a fixed exit grid;
// the main thread sweeps detection/exit combinations using a multi-metric score.
// Usage: node scripts/archetypeHyperTune.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = Math.min(Number(process.env.WORKERS || 6), os.cpus().length);
const N_COMBOS   = Number(process.env.N_COMBOS || 15_000);
const MIN_OOS_N  = Number(process.env.MIN_OOS_N || 50);
const IS_CUT     = '2025-05-05';

// ─── EXIT PARAM GRID (precomputed per event in workers) ──────────────────────
// 6 × 4 × 4 = 96 combos; index into Int8Array outcomes per event
const TP_G  = [3, 4, 5, 6, 7, 8];
const SL_G  = [1.5, 2.0, 2.5, 3.0];
const HB_G  = [10, 15, 20, 25];
const N_EXIT = TP_G.length * SL_G.length * HB_G.length; // 96
const PNL_SCALE = 10; // store P&L at 0.1 percentage-point precision

function exitIdx(tpI, slI, hbI) { return tpI * (SL_G.length * HB_G.length) + slI * HB_G.length + hbI; }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function wilsonLower(w, n, z = 1.645) {
  if (n === 0) return 0;
  const p = w / n;
  const z2 = z * z;
  return (p + z2 / (2*n) - z * Math.sqrt(p*(1-p)/n + z2/(4*n*n))) / (1 + z2/n);
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function metricScore(r) {
  // OOS is weighted more heavily; full-sample metrics are stability checks.
  // Negative OOS expectancy/PF below 1 is deliberately scored near zero.
  const oosWr = clamp01((r.oosWR - 0.50) / 0.25);
  const oosPf = clamp01((r.oosPF - 1.00) / 1.50);
  const oosAvg = clamp01((r.oosAvg + 0.50) / 2.00);
  const fullPf = clamp01((r.fullPF - 1.00) / 1.50);
  const fullAvg = clamp01((r.fullAvg + 0.50) / 2.00);
  const sample = clamp01(Math.log10(Math.max(1, r.oosN)) / 3);
  return 0.24 * oosWr + 0.30 * oosPf + 0.24 * oosAvg + 0.12 * fullPf + 0.06 * fullAvg + 0.04 * sample;
}
function rand(lo, hi)     { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi)  { return Math.floor(lo + Math.random() * (hi - lo + 1)); }

// ─── CSV PARSER ──────────────────────────────────────────────────────────────
function parseCSV(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 6) continue;
    const d = p[0], oc = +p[1], hc = +p[2], lc = +p[3], cc = +p[4], vc = +p[5];
    if (!d || isNaN(cc) || cc <= 0) continue;
    out.push({ d, o: oc, h: hc, l: lc, c: cc, v: vc });
  }
  return out;
}

// ─── INDICATORS ──────────────────────────────────────────────────────────────
// Full per-bar DMI (Wilder, period=14) — returns {dp, dm, adx} as Float64Arrays
function computeDMI14(candles) {
  const n   = candles.length;
  const dp  = new Float64Array(n);
  const dm  = new Float64Array(n);
  const adx = new Float64Array(n).fill(20);
  if (n < 30) return { dp, dm, adx };
  const P = 14;

  // Raw DM+, DM-, TR
  const dmP = new Float64Array(n), dmM = new Float64Array(n), tr = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i-1].h, dn = candles[i-1].l - candles[i].l;
    dmP[i] = (up > dn && up > 0) ? up : 0;
    dmM[i] = (dn > up && dn > 0) ? dn : 0;
    tr[i]  = Math.max(candles[i].h-candles[i].l,
              Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  }

  // Wilder initial sums
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= P; i++) { sTR += tr[i]; sDMp += dmP[i]; sDMm += dmM[i]; }

  // DX array for ADX seed
  const dxArr = new Float64Array(n);
  for (let i = P+1; i < n; i++) {
    sTR  = sTR  - sTR/P  + tr[i];
    sDMp = sDMp - sDMp/P + dmP[i];
    sDMm = sDMm - sDMm/P + dmM[i];
    const d = sTR > 0 ? (sDMp/sTR)*100 : 0;
    const e = sTR > 0 ? (sDMm/sTR)*100 : 0;
    dp[i] = d; dm[i] = e;
    const s = d + e;
    dxArr[i] = s > 0 ? Math.abs(d-e)/s*100 : 0;
  }

  // ADX = Wilder MA of DX, seeded at bar P*2
  const seed = P * 2;
  if (n > seed + 1) {
    let av = 0; for (let i = P+1; i <= seed; i++) av += dxArr[i]; av /= P;
    adx[seed] = av;
    for (let i = seed+1; i < n; i++) { av = (av*(P-1) + dxArr[i]) / P; adx[i] = av; }
  }
  return { dp, dm, adx };
}

// Returns how many bars ago DI+ crossed above DI- (0=today, 1=yesterday … 99=none in window)
function bsc(dp, dm, i, look = 5) {
  for (let k = 0; k <= look; k++) {
    const j = i - k;
    if (j < 1) break;
    if (dp[j] > dm[j] && dp[j-1] <= dm[j-1]) return k;
  }
  return 99;
}

function computeATR14(candles) {
  const n = candles.length;
  const atr = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c), Math.abs(candles[i].l - candles[i-1].c));
    if (i < 14)       atr[i] = tr;
    else if (i === 14) { let s = 0; for (let j=1;j<=14;j++) s += Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c)); atr[i] = s/14; }
    else               atr[i] = (atr[i-1]*13 + tr) / 14;
  }
  return atr;
}
function computeEMA(candles, period) {
  const k = 2/(period+1), n = candles.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  for (let i = period-1; i < n; i++) {
    if (i === period-1) { let s=0; for (let j=0;j<period;j++) s+=candles[j].c; out[i]=s/period; }
    else out[i] = candles[i].c * k + out[i-1] * (1-k);
  }
  return out;
}
function rsi2At(candles, i) {
  if (i < 2) return 50;
  const g = (Math.max(0, candles[i].c-candles[i-1].c) + Math.max(0, candles[i-1].c-candles[i-2].c)) / 2;
  const l = (Math.max(0, candles[i-1].c-candles[i].c) + Math.max(0, candles[i-2].c-candles[i-1].c)) / 2;
  return l === 0 ? 100 : 100 - 100/(1 + g/l);
}
function rsi14At(candles, i) {
  if (i < 14) return 50;
  let ag = 0, al = 0;
  for (let j = i-13; j <= i; j++) { const d = candles[j].c-candles[j-1].c; ag += Math.max(0,d)/14; al += Math.max(0,-d)/14; }
  return al === 0 ? 100 : 100 - 100/(1 + ag/al);
}

// ─── BACKTEST SIMULATION (per exit combo) ────────────────────────────────────
function simOutcomes(candles, signalIdx, atr, entryOpen) {
  // Returns Float32Array of net P&L percentages for every exit combination.
  const outcomes = new Int16Array(N_EXIT); // scaled P&L; 0 means no valid trade
  if (!entryOpen || entryOpen <= 0 || !atr || atr <= 0) return outcomes;
  const n = candles.length;

  for (let tpI = 0; tpI < TP_G.length; tpI++) {
    const tp = entryOpen * (1 + TP_G[tpI] / 100);
    for (let slI = 0; slI < SL_G.length; slI++) {
      const sl = entryOpen - SL_G[slI] * atr;
      if (sl >= entryOpen || sl <= 0) continue;
      const riskPct = (entryOpen - sl) / entryOpen * 100;
      if (riskPct > 35 || riskPct < 0.1) continue;

      for (let hbI = 0; hbI < HB_G.length; hbI++) {
        const maxBars = HB_G[hbI];
        let result = 0;
        let lastClose = entryOpen;
        for (let j = signalIdx + 1; j < Math.min(n, signalIdx + 1 + maxBars); j++) {
          lastClose = candles[j].c;
          if (candles[j].h >= tp && candles[j].l <= sl) { result = (sl - entryOpen) / entryOpen * 100; break; }
          if (candles[j].h >= tp) { result = (tp - entryOpen) / entryOpen * 100; break; }
          if (candles[j].l <= sl) { result = (sl - entryOpen) / entryOpen * 100; break; }
        }
        if (result === 0) result = (lastClose - entryOpen) / entryOpen * 100;
        outcomes[exitIdx(tpI, slI, hbI)] = Math.max(-32767, Math.min(32767, Math.round(result * PNL_SCALE)));
      }
    }
  }
  return outcomes;
}

// ─── WORKER THREAD ───────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, setId } = workerData;

  const ev1 = [], ev2 = [], ev3 = [], ev4 = [], ev5 = [], ev6 = [];

  for (const fp of files) {
    let content; try { content = fs.readFileSync(fp,'utf8'); } catch { continue; }
    const candles = parseCSV(content);
    const n = candles.length;
    if (n < 70) continue;

    const atr14 = computeATR14(candles);
    const ema20  = computeEMA(candles, 20);
    const ema10  = computeEMA(candles, 10);
    const dmi    = computeDMI14(candles);  // { dp, dm, adx } — per-bar arrays

    for (let i = 60; i < n - 1; i++) {
      const sig = candles[i];
      if (sig.c <= 0 || sig.h <= sig.l) continue;

      // Turnover gate (₹5M)
      let tSum = 0, vSum = 0;
      const tStart = Math.max(0, i - 20);
      const cnt = i - tStart;
      if (cnt < 5) continue;
      for (let j = tStart; j < i; j++) { tSum += candles[j].c*candles[j].v; vSum += candles[j].v; }
      const turnover20 = tSum / cnt;
      if (turnover20 < 5_000_000) continue;
      const vAvg20 = vSum / cnt;
      const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;

      const atr = atr14[i] || sig.c * 0.02;
      const isOOS = sig.d >= IS_CUT ? 1 : 0;
      const nextBar = candles[i+1];
      const entryOpen = nextBar.o > 0 ? nextBar.o : nextBar.c;
      if (!entryOpen || entryOpen <= 0) continue;

      const sigRange = sig.h - sig.l;
      const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
      const bodyPct  = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
      const rangeATR = sigRange / (atr || 0.0001);
      const isGreen  = sig.c >= sig.o ? 1 : 0;
      const strictGreen = sig.c > sig.o ? 1 : 0;
      const candleRisk = sig.c > 0 ? sigRange / sig.c * 100 : 99;
      const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 100;
      const lowerWickPct = sigRange > 0 ? (Math.min(sig.o, sig.c) - sig.l) / sigRange * 100 : 0;
      const hammer = lowerWickPct >= 2 * bodyPct && closeLoc >= 60 ? 1 : 0;

      // Precompute binary outcomes for all 96 exit combos
      const outcomes = simOutcomes(candles, i, atr, entryOpen);

      // ── DMI fields (shared across all sets) ──────────────────────────────
      const diP  = dmi.dp[i];   // DI+ value at bar i
      const diM  = dmi.dm[i];   // DI- value at bar i
      const adxV = dmi.adx[i];  // ADX value at bar i
      const bscV = bsc(dmi.dp, dmi.dm, i, 5); // bars since DI+ crossed above DI-
      const diBull = diP > diM ? 1 : 0;        // DI+ currently above DI-
      const diBear = diM > diP ? 1 : 0;        // DI- currently above DI+ (for ORS)

      // ── Set 1: Volume Footprint ───────────────────────────────────────────
      if (!setId || setId === 1) {
        let hi20 = 0;
        for (let j = Math.max(0,i-20); j < i; j++) if (candles[j].h > hi20) hi20 = candles[j].h;
        const nearHi20Pct = hi20 > 0 ? (hi20 - sig.c) / hi20 * 100 : 99;
        const prevC = i > 0 ? candles[i-1].c : sig.o;
        const gapDownPct = prevC > 0 ? (sig.o - prevC) / prevC * 100 : 0;
        // Pre-filter: at least a potential candidate
        if (volRatio20 >= 2.0 && strictGreen && candleRisk <= 12) {
          ev1.push({ isOOS, outcomes,
            vr: volRatio20, cl: closeLoc, nh: nearHi20Pct, ra: rangeATR, gd: gapDownPct,
            green: strictGreen, risk: candleRisk, uw: upperWickPct, bp: bodyPct,
            dp: diP, dm: diM, adx: adxV, bsc: bscV, dib: diBull });
        }
      }

      // ── Set 2: Compression Coil ───────────────────────────────────────────
      if (!setId || setId === 2) {
        let comprBars = 0;
        for (let j = i-1; j >= Math.max(0,i-12); j--) {
          if ((candles[j].h-candles[j].l) < 0.9*(atr14[j]||atr)) comprBars++;
          else break;
        }
        if (comprBars >= 5 && strictGreen && candleRisk <= 12) {
          let volDecDays = 0;
          for (let j = i-1; j >= Math.max(1,i-5); j--) { if (candles[j].v < candles[j-1].v) volDecDays++; else break; }
          let lo20=Infinity, hi20=0;
          for (let j = Math.max(0,i-20); j <= i; j++) { if (candles[j].l<lo20) lo20=candles[j].l; if (candles[j].h>hi20) hi20=candles[j].h; }
          const pricePos20 = hi20>lo20 ? (sig.c-lo20)/(hi20-lo20)*100 : 50;
          // BB width pctl (last 30 bars fast approximation)
          let bbW = 50;
          { const pd=20, widths=[];
            for (let k = Math.max(pd, i-30); k <= i; k++) {
              let s=0; for (let j=k-pd+1;j<=k;j++) s+=candles[j].c; const m=s/pd;
              let v2=0; for (let j=k-pd+1;j<=k;j++) v2+=(candles[j].c-m)**2;
              widths.push(m>0?(4*Math.sqrt(v2/pd)/m)*100:0);
            }
            if (widths.length>0){ const cur=widths[widths.length-1]; bbW=widths.filter(w=>w<=cur).length/widths.length*100; }
          }
          ev2.push({ isOOS, outcomes,
            cb: comprBars, vd: volDecDays, pp: pricePos20, bb: bbW, ra: rangeATR, vr: volRatio20,
            green: strictGreen, risk: candleRisk, uw: upperWickPct, bp: bodyPct,
            dp: diP, dm: diM, adx: adxV, bsc: bscV, dib: diBull });
        }
      }

      // ── Set 3: Momentum Pocket ────────────────────────────────────────────
      if ((!setId || setId === 3) && turnover20 >= 10_000_000) {
        let hh252 = 0;
        for (let j = Math.max(0,i-252); j < i; j++) if (candles[j].h>hh252) hh252=candles[j].h;
        const dd52W = hh252 > 0 ? (hh252 - sig.c) / hh252 * 100 : 0;
        if (dd52W >= 20 && dd52W <= 75) {
          let stabBars = 0, refLow = sig.l;
          for (let j = i-1; j >= Math.max(0,i-12); j--) {
            if (candles[j].l > refLow*0.99) { stabBars++; refLow=Math.min(refLow,candles[j].l); } else break;
          }
          const rsi14 = rsi14At(candles, i);
          if (stabBars < 1 || (!strictGreen && !hammer)) continue;
          ev3.push({ isOOS, outcomes,
            dd: dd52W, sb: stabBars, cl: closeLoc, bp: bodyPct, ig: isGreen, green: strictGreen, uw: upperWickPct, risk: candleRisk, hammer, vr: volRatio20, r14: rsi14,
            dp: diP, dm: diM, adx: adxV, bsc: bscV, dib: diBull });
        }
      }

      // ── Set 4: EMA Stack (crossover bars only) ────────────────────────────
      if ((!setId || setId === 4) && turnover20 >= 10_000_000 && !isNaN(ema20[i])) {
        const prevC = i > 0 ? candles[i-1].c : sig.c;
        const pE20  = i > 0 ? ema20[i-1] : ema20[i];
        const todayCross = sig.c > ema20[i] && prevC < pE20 && ema20[i] > 0;
        const ystdyCross = i > 1 ? (candles[i-1].c>(ema20[i-1]||0) && candles[i-2].c<(ema20[i-2]||0)) : false;
        if (todayCross || ystdyCross) {
          const crossBar = todayCross ? i : i-1;
          let belowCnt = 0;
          for (let j = crossBar-1; j >= Math.max(0,crossBar-25); j--) {
            if (candles[j].c < (ema20[j]||0)) belowCnt++; else break;
          }
          const e10e20 = ema20[i]>0 ? (ema10[i]-ema20[i])/ema20[i]*100 : 0;
          let minRSI2 = 100;
          for (let j=Math.max(2,i-4);j<=i;j++) { const r=rsi2At(candles,j); if(r<minRSI2) minRSI2=r; }
          ev4.push({ isOOS, outcomes,
            ct: todayCross?1:0, bc: belowCnt, e10: e10e20, vr: volRatio20, mr: minRSI2,
            green: strictGreen, bp: bodyPct, uw: upperWickPct, risk: candleRisk,
            dp: diP, dm: diM, adx: adxV, bsc: bscV, dib: diBull });
        }
      }

      // ── Set 5: Perfect Storm ──────────────────────────────────────────────
      if (!setId || setId === 5) {
        const vfF = volRatio20 >= 1.5 && closeLoc >= 50 ? 1 : 0;
        let ccC2 = 0; for (let j=i-1;j>=Math.max(0,i-10);j--){ if((candles[j].h-candles[j].l)<0.9*(atr14[j]||atr)) ccC2++; else break; }
        const ccF = ccC2 >= 2 ? 1 : 0;
        let hh252q=0; for(let j=Math.max(0,i-252);j<i;j++) if(candles[j].h>hh252q) hh252q=candles[j].h;
        const ddQ = hh252q>0?(hh252q-sig.c)/hh252q*100:0;
        const mpF = (ddQ>=8&&ddQ<=60&&isGreen&&closeLoc>=45&&volRatio20>=1.1) ? 1 : 0;
        const pE20q = i>0?ema20[i-1]:ema20[i];
        const esF = (!isNaN(ema20[i]) && sig.c>ema20[i] && (i>0?candles[i-1].c:sig.c)<pE20q) ? 1 :
                    (i>1&&!isNaN(ema20[i-1])&&candles[i-1].c>(ema20[i-1]||0)&&candles[i-2].c<(ema20[i-2]||0)) ? 1 : 0;
        const fires = vfF + ccF + mpF + esF;  // 4 original storm fires (unchanged)
        if (fires >= 2) {
          // dmi stored separately — used as a gatable filter, not a fire counter
          // (DI+ > DI- is true ~60% of bars in a bull regime; adding to fires count would flood the pool)
          const quality = (closeLoc >= 55 ? 1 : 0) + (bodyPct >= 40 ? 1 : 0) + (upperWickPct <= 20 ? 1 : 0) + (lowerWickPct >= 8 ? 1 : 0);
          ev5.push({ isOOS, outcomes, vf: vfF, cc: ccF, mp: mpF, es: esF, dmi: diBull, adx: adxV, fires, risk: candleRisk, quality });
        }
      }

      // ── Set 6: ORS-Prime ─────────────────────────────────────────────────
      if (process.env.INCLUDE_ORS && (!setId || setId === 6) && !isNaN(ema20[i])) {
        const rsi2 = rsi2At(candles, i);
        if (rsi2 <= 35) { // pre-filter: must be at least somewhat oversold
          const rsi14 = rsi14At(candles, i);
          const uw = sigRange > 0 ? (sig.h - Math.max(sig.o,sig.c)) / sigRange * 100 : 0;
          const rp = sig.c > 0 ? sigRange/sig.c*100 : 0;
          const isRed = sig.c < sig.o ? 1 : 0;
          const distE20 = ema20[i]>0 ? (sig.c-ema20[i])/ema20[i]*100 : 0;
          let swH=0; for(let j=Math.max(0,i-60);j<i;j++) if(candles[j].h>swH) swH=candles[j].h;
          const ddSw = swH>0?(swH-sig.c)/swH*100:0;
          const sc = (rsi2<=5?30:rsi2<=10?20:rsi2<=15?10:rsi2<=25?5:0)
                   + (rsi14<=30?15:rsi14<=40?10:rsi14<=50?5:0)
                   + (rp>=8?10:rp>=6?7:rp>=4?3:0)
                   + (distE20<=-10?10:distE20<=-7?8:distE20<=-5?5:distE20<=-3?2:0)
                   + (bodyPct>=70?8:bodyPct>=55?5:0)
                   + (uw<=10?7:uw<=20?4:0)
                   + (ddSw>=50?5:ddSw>=35?3:0);
          ev6.push({ isOOS, outcomes,
            r2: rsi2, r14: rsi14, cl: closeLoc, bp: bodyPct, uw, rp, de: distE20, ds: ddSw, ir: isRed, sc,
            adx: adxV, dibar: diBear });  // dibar: DI- > DI+ confirms bearish trend being reversed
        }
      }
    }
  }

  parentPort.postMessage({ ev1, ev2, ev3, ev4, ev5, ev6 });
}

// ─── MAIN THREAD ─────────────────────────────────────────────────────────────

function sweepSet(label, events, filterFn, genFn, nCombos, minOosN) {
  const isEvt  = events.filter(e => !e.isOOS);
  const oosEvt = events.filter(e =>  e.isOOS);
  console.log(`  Pool: ${events.length.toLocaleString()} (IS=${isEvt.length.toLocaleString()} OOS=${oosEvt.length.toLocaleString()})`);
  if (oosEvt.length < minOosN * 3) { console.log(`  ✗ OOS pool too small`); return null; }

  const results = [];

  for (let c = 0; c < nCombos; c++) {
    const p = genFn();
    const tpI  = TP_G.indexOf(p.tpPct);
    const slI  = SL_G.indexOf(p.slAtrMult);
    const hbI  = HB_G.indexOf(p.maxHoldBars);
    if (tpI < 0 || slI < 0 || hbI < 0) continue;
    const ei = exitIdx(tpI, slI, hbI);

    let isW=0, isN=0, isPnl=0, isGrossWin=0, isGrossLoss=0;
    let oosW=0, oosN=0, oosPnl=0, oosGrossWin=0, oosGrossLoss=0;
    for (const e of isEvt) {
      if (!filterFn(e, p)) continue;
      const o = e.outcomes[ei] / PNL_SCALE;
      if (o === 0) continue;
      isN++; isPnl += o; if (o > 0) { isW++; isGrossWin += o; } else isGrossLoss -= o;
    }
    if (isN < Math.max(25, Math.floor(minOosN * 2))) continue;
    for (const e of oosEvt) {
      if (!filterFn(e, p)) continue;
      const o = e.outcomes[ei] / PNL_SCALE;
      if (o === 0) continue;
      oosN++; oosPnl += o; if (o > 0) { oosW++; oosGrossWin += o; } else oosGrossLoss -= o;
    }
    if (oosN < minOosN) continue;
    const fullN = isN + oosN, fullW = isW + oosW;
    const fullPnl = isPnl + oosPnl;
    const fullGrossWin = isGrossWin + oosGrossWin;
    const fullGrossLoss = isGrossLoss + oosGrossLoss;
    const row = {
      isN, isWR: isW/isN, isPF: isGrossLoss > 0 ? isGrossWin/isGrossLoss : Infinity, isAvg: isPnl/isN,
      oosN, oosWR: oosW/oosN, oosPF: oosGrossLoss > 0 ? oosGrossWin/oosGrossLoss : Infinity, oosAvg: oosPnl/oosN,
      fullN, fullWR: fullW/fullN, fullPF: fullGrossLoss > 0 ? fullGrossWin/fullGrossLoss : Infinity, fullAvg: fullPnl/fullN,
      wil: wilsonLower(oosW, oosN), p,
    };
    // Sweet-spot eligibility: no candidate may be positive only because of OOS
    // luck while remaining negative on the full sample or the holdout.
    if (row.fullPF < 1 || row.oosPF < 1 || row.fullAvg <= 0 || row.oosAvg <= 0 || row.fullWR < 0.50 || row.oosWR < 0.50) continue;
    row.fitness = metricScore(row);
    results.push(row);
  }

  results.sort((a, b) => b.fitness - a.fitness);
  const top20 = results.slice(0, 20);

  if (top20.length === 0) { console.log(`  ✗ No combos qualified`); return null; }

  console.log(`\n${'═'.repeat(110)}`);
  console.log(`RESULTS — ${label}`);
  console.log('═'.repeat(110));
  console.log(`Rank  Full_n Full_WR Full_PF Full_Avg | IS_n IS_WR IS_PF IS_Avg | OOS_n OOS_WR OOS_PF OOS_Avg Wil Fit | Detection params | Exit`);
  console.log('─'.repeat(110));
  for (let i = 0; i < top20.length; i++) {
    const r = top20[i];
    const det = Object.entries(r.p).filter(([k])=>!['tpPct','slAtrMult','maxHoldBars'].includes(k))
      .map(([k,v])=>`${k}=${typeof v==='number'?v.toFixed(typeof v==='boolean'?0:2):v}`).join(' ');
    console.log(
      `${String(i+1).padStart(4)}  ${String(r.fullN).padStart(6)} ${(r.fullWR*100).toFixed(1).padStart(6)} ${(r.fullPF).toFixed(2).padStart(7)} ${r.fullAvg.toFixed(2).padStart(8)} | ` +
      `${String(r.isN).padStart(4)} ${(r.isWR*100).toFixed(1).padStart(5)} ${(r.isPF).toFixed(2).padStart(5)} ${r.isAvg.toFixed(2).padStart(6)} | ` +
      `${String(r.oosN).padStart(5)} ${(r.oosWR*100).toFixed(1).padStart(6)} ${(r.oosPF).toFixed(2).padStart(6)} ${r.oosAvg.toFixed(2).padStart(7)} ${(r.wil*100).toFixed(1).padStart(4)} ${(r.fitness*100).toFixed(1).padStart(4)} | ` +
      `${det}  |  TP=${r.p.tpPct}% SL=${r.p.slAtrMult}xATR Hold=${r.p.maxHoldBars}d`
    );
  }

  const best = top20[0];
  console.log(`\n★ SWEET SPOT — ${label}`);
  console.log(`  FULL: n=${best.fullN} WR=${(best.fullWR*100).toFixed(1)}% PF=${best.fullPF.toFixed(2)} Avg=${best.fullAvg.toFixed(2)}%`);
  console.log(`  IS  : n=${best.isN} WR=${(best.isWR*100).toFixed(1)}% PF=${best.isPF.toFixed(2)} Avg=${best.isAvg.toFixed(2)}%`);
  console.log(`  OOS : n=${best.oosN} WR=${(best.oosWR*100).toFixed(1)}% PF=${best.oosPF.toFixed(2)} Avg=${best.oosAvg.toFixed(2)}% Wilson=${(best.wil*100).toFixed(1)}% Fitness=${(best.fitness*100).toFixed(1)}`);
  console.log('  Full params:');
  console.log(JSON.stringify(best.p, null, 4));
  return best;
}

// Param generators (exit params always from grids for index lookup)
const pickTP  = () => TP_G[randInt(0, TP_G.length-1)];
const pickSL  = () => SL_G[randInt(0, SL_G.length-1)];
const pickHB  = () => HB_G[randInt(0, HB_G.length-1)];

// ─── DMI param helpers ───────────────────────────────────────────────────────
// requireDIBull: 1=DI+ must be > DI-, 0=don't care
// maxBsc: max bars since DI+ crossed above DI- (0=today only, 1=today/yesterday, 3=last 3d, 5=last 5d, 99=no req)
// minADX: ADX must be at least this value (0=no req)
const BSC_OPTS = [0, 1, 3, 5, 99];
const ADX_OPTS = [0, 15, 20, 25];
function dmiGen() {
  return {
    requireDIBull: Math.random() > 0.5 ? 1 : 0,
    maxBsc:        BSC_OPTS[randInt(0, BSC_OPTS.length-1)],
    minADX:        ADX_OPTS[randInt(0, ADX_OPTS.length-1)],
  };
}
function dmiPass(e, p) {
  if (p.requireDIBull && !e.dib) return false;
  if (p.maxBsc < 99 && e.bsc > p.maxBsc) return false;
  if (p.minADX > 0 && e.adx < p.minADX) return false;
  return true;
}

// ─── ORS DMI helper (bearish trend context) ──────────────────────────────────
// requireDIBear: 1=DI- must be > DI+ (stock in downtrend, we're buying reversal)
// minADX: ADX must be at least this (trend has strength worth reversing)
function orssDmiGen() {
  return {
    requireDIBear: Math.random() > 0.5 ? 1 : 0,
    minADX:        ADX_OPTS[randInt(0, ADX_OPTS.length-1)],
  };
}
function orssDmiPass(e, p) {
  if (p.requireDIBear && !e.dibar) return false;
  if (p.minADX > 0 && e.adx < p.minADX) return false;
  return true;
}

function genVF() { return { minVolRatio: +rand(2.0,6.0).toFixed(1), minCloseLoc: +rand(60,92).toFixed(0), maxUpperWick: +rand(8,18).toFixed(0), maxNearHi20Pct: +rand(2,18).toFixed(0), minRangeATR: +rand(1.5,3.5).toFixed(1), maxGapDownPct: +rand(-4,-1).toFixed(1), ...dmiGen(), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtVF(e,p) { return e.green && e.risk<=8 && e.vr>=p.minVolRatio && e.cl>=p.minCloseLoc && e.uw<=p.maxUpperWick && e.nh<=p.maxNearHi20Pct && e.ra>=p.minRangeATR && e.gd>=p.maxGapDownPct && dmiPass(e,p); }

function genCC() { const minComprBars=randInt(6,12); return { minComprBars, maxComprBars: randInt(Math.max(8,minComprBars),15), minVolDecDays: randInt(1,4), minPricePos20: +rand(45,80).toFixed(0), maxBBWidthPctl: +rand(15,45).toFixed(0), maxRangeATR: +rand(0.5,1.0).toFixed(1), minCloseLoc: +rand(40,65).toFixed(0), minBodyPct: +rand(35,60).toFixed(0), maxCandleRisk: +rand(6,10).toFixed(0), ...dmiGen(), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtCC(e,p) { return e.cb>=p.minComprBars && e.cb<=p.maxComprBars && e.vd>=p.minVolDecDays && e.pp>=p.minPricePos20 && e.bb<=p.maxBBWidthPctl && e.ra<=p.maxRangeATR && e.green && e.cl>=p.minCloseLoc && e.bp>=p.minBodyPct && e.risk<=p.maxCandleRisk && dmiPass(e,p); }

function genMP() { return { minDd52W: +rand(20,45).toFixed(0), maxDd52W: +rand(40,75).toFixed(0), minStabBars: randInt(1,8), minCloseLoc: +rand(30,78).toFixed(0), minBodyPct: +rand(20,75).toFixed(0), maxUpperWick: +rand(15,45).toFixed(0), requireGreen: Math.random()>0.4?1:0, minVolRatio: +rand(0.8,3.2).toFixed(1), minRSI14: +rand(12,48).toFixed(0), maxRSI14: +rand(45,75).toFixed(0), ...dmiGen(), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtMP(e,p) { return e.dd>=p.minDd52W && e.dd<=p.maxDd52W && e.sb>=p.minStabBars && e.vr>=p.minVolRatio && e.r14>=p.minRSI14 && e.r14<=p.maxRSI14 && ((e.ig && e.cl>=p.minCloseLoc && e.bp>=p.minBodyPct && e.uw<=p.maxUpperWick) || (e.hammer && e.cl>=60)) && dmiPass(e,p); }

function genES() { return { minBelowBars: randInt(2,10), minEMA10VsEma20: +rand(0.2,1.5).toFixed(1), minBodyPct: +rand(30,70).toFixed(0), maxUpperWick: +rand(15,35).toFixed(0), maxCandleRisk: +rand(7,12).toFixed(0), minVolRatio: +rand(1.0,3.5).toFixed(1), maxRSI2Last5: +rand(25,58).toFixed(0), todayCrossOnly: 1, ...dmiGen(), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtES(e,p) { return e.bc>=p.minBelowBars && e.e10>=p.minEMA10VsEma20 && e.green && e.bp>=p.minBodyPct && e.uw<=p.maxUpperWick && e.risk<=p.maxCandleRisk && e.vr>=p.minVolRatio && e.mr<=p.maxRSI2Last5 && (!p.todayCrossOnly||e.ct) && dmiPass(e,p); }

function genPS() { return { minFires: randInt(2,4), requireDMI: 0, minADX: randInt(30,45), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtPS(e,p) { return e.fires>=p.minFires && e.risk<=12 && e.quality>=2 && (p.minADX===0||e.adx>=p.minADX); }

function genORS() { return { maxRSI2: +rand(4,28).toFixed(0), maxRSI14: +rand(25,58).toFixed(0), maxCloseLoc: +rand(20,62).toFixed(0), minBodyPct: +rand(30,72).toFixed(0), maxUpperWick: +rand(8,48).toFixed(0), minRangePct: +rand(1.5,10).toFixed(1), maxDistEMA20: +rand(-2,-16).toFixed(0), minDdSwingHigh: +rand(8,48).toFixed(0), minOrsScore: +rand(35,88).toFixed(0), requireRed: Math.random()>0.5?1:0, ...orssDmiGen(), tpPct: pickTP(), slAtrMult: pickSL(), maxHoldBars: pickHB() }; }
function filtORS(e,p) { return e.r2<=p.maxRSI2 && e.r14<=p.maxRSI14 && e.cl<=p.maxCloseLoc && e.bp>=p.minBodyPct && e.uw<=p.maxUpperWick && e.rp>=p.minRangePct && e.de<=p.maxDistEMA20 && e.ds>=p.minDdSwingHigh && e.sc>=p.minOrsScore && (!p.requireRed||e.ir) && orssDmiPass(e,p); }

async function main() {
  if (!isMainThread) return;
  const t0 = Date.now();
  console.log(`Archetype Hyper-Tuner   ${new Date().toISOString()}`);
  console.log(`Workers=${N_WORKERS}  Combos/set=${N_COMBOS}  MinOOS=${MIN_OOS_N}  IS_CUT=${IS_CUT}`);

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /\.(csv|CSV)$/.test(f))
    .map(f => path.join(DATA_DIR, f));
  console.log(`Files: ${files.length}\n`);

  // Chunk files for parallel event collection
  const csz = Math.ceil(files.length / N_WORKERS);
  const chunks = [];
  for (let i = 0; i < files.length; i += csz) chunks.push(files.slice(i, i+csz));

  console.log('Step 1: Collecting events from all stocks...');
  const all = { ev1:[], ev2:[], ev3:[], ev4:[], ev5:[], ev6:[] };
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, setId: 0 } });
    w.on('message', msg => {
      for (const k of Object.keys(all)) all[k].push(...msg[k]);
      done += chunk.length;
      process.stdout.write(`\r  ${done}/${files.length} files`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
  })));

  console.log(`\n\nEvent pools:`);
  const labels = ['VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','PerfectStorm','ORS-Prime'];
  [all.ev1,all.ev2,all.ev3,all.ev4,all.ev5,all.ev6].forEach((ev,i) =>
    console.log(`  Set${i+1} ${labels[i].padEnd(18)}: ${ev.length.toLocaleString()} events`));

  const outLines = [];
  const log = s => { outLines.push(s); console.log(s); };

  console.log('\nStep 2: Sweeping combos per set...\n');

  const setDefs = [
    { name:'Set1 — Volume Footprint Scout',   ev: all.ev1, gen: genVF,  filt: filtVF  },
    { name:'Set2 — Compression Coil',         ev: all.ev2, gen: genCC,  filt: filtCC  },
    { name:'Set3 — Momentum Pocket',          ev: all.ev3, gen: genMP,  filt: filtMP  },
    { name:'Set4 — EMA Stack Crossover',      ev: all.ev4, gen: genES,  filt: filtES  },
    { name:'Set5 — Perfect Storm',            ev: all.ev5, gen: genPS,  filt: filtPS  },
  ];

  const bestBySet = {};
  for (const s of setDefs) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Sweeping ${N_COMBOS.toLocaleString()} combos — ${s.name}`);
    bestBySet[s.name] = sweepSet(s.name, s.ev, s.filt, s.gen, N_COMBOS, MIN_OOS_N);
  }

  const elapsed = ((Date.now() - t0)/1000).toFixed(0);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(__dirname, 'results', `archetype_hypertune_pnl_${stamp}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(), DATA_DIR, IS_CUT, N_COMBOS, MIN_OOS_N,
    objective: 'OOS-weighted composite of full/OOS WR, PF, and average P&L; P&L is next-open stop-first',
    bestBySet,
  }, null, 2));
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`Saved: ${out}`);
}

if (isMainThread) main().catch(e => { console.error(e); process.exit(1); });
