'use strict';

/**
 * Stop Loss Phase 3 — ATR-Anchored Head-to-Head Validation
 * =========================================================
 * Tests the KEY QUESTION from Phase 2:
 *   "If we change stop from 2×ATR to 1.5×ATR, keeping T1/T2/T3 in ATR terms,
 *    what happens to win rate, EV, and R:R across all ATR bands?"
 *
 * Targets always in ATR terms (validated from targetValidationStudy.js):
 *   T1 = +1.5×ATR above entry
 *   T2 = +3.0×ATR above entry
 *   T3 = +5.0×ATR above entry
 *   Exit sizing: 50% at T1, 30% at T2, 20% at T3
 *
 * Stop candidates (head-to-head):
 *   S1: 2.0×ATR below entry (current engine)
 *   S2: 1.5×ATR below entry (candidate)
 *   S3: 1.75×ATR below entry (mid-point)
 *   S4: Adaptive: 1.5×ATR if ATR%<2%, else 2.0×ATR (band-adaptive)
 *   S5: Adaptive: 1.5×ATR if ATR%<2%, else 1.75×ATR (tighter adaptive)
 *   S6: Dynamic: max(1.5×ATR, 5-bar swing low × 0.995) — ATR+structure
 *   S7: Clamped: 1.5×ATR, min floor 2%, max cap 5% of entry
 *
 * Key additional metrics:
 *   - R×WR (EV in R-multiples, corrects for stop-size bias)
 *   - False stop rate (swept and recovered within 3 bars)
 *   - Breakeven rate (within 0.5% of entry close at exit)
 *   - Per ATR-band P&L map
 *   - Time-to-T1 distribution (validates hold period assumptions)
 *
 * Signal conditions (same as Phase 2 proxy):
 *   Above EMA21 + ATR compression + volume expansion + near 20-bar high
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const HORIZON   = 20;
const MIN_BARS  = 300;
const OUT_DIR   = path.join(__dirname, 'results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o=+p[1], h=+p[2], l=+p[3], c=+p[4], v=+p[5];
    if (!isFinite(ts)||![o,h,l,c,v].every(isFinite)||o<=0) continue;
    out.push({ts:Math.floor(ts/1000),o,h,l,c,v:Math.max(0,v)});
  }
  out.sort((a,b)=>a.ts-b.ts);
  const d=[];
  for (const x of out) {
    if (d.length && d[d.length-1].ts===x.ts) d[d.length-1]=x; else d.push(x);
  }
  return d;
}

function calcATR14(c) {
  const a=new Float64Array(c.length);
  if (c.length<=14) return a;
  let s=0;
  for (let i=1;i<=14;i++) s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
  a[14]=s/14;
  for (let i=15;i<c.length;i++) {
    const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
    a[i]=(a[i-1]*13+tr)/14;
  }
  return a;
}

function calcEMA(c, period) {
  const e=new Float64Array(c.length);
  if (c.length<period) return e;
  let s=0; for (let i=0;i<period;i++) s+=c[i].c;
  e[period-1]=s/period;
  const k=2/(period+1);
  for (let i=period;i<c.length;i++) e[i]=c[i].c*k+e[i-1]*(1-k);
  return e;
}

function isSignal(c, i, atrA, e21A) {
  if (i<30||i>=c.length-HORIZON-2) return false;
  const atr=atrA[i]; if (!atr||atr<=0) return false;
  const entry=c[i+1].o; if (!entry||entry<=0) return false;
  const atrPct=atr/entry*100;
  if (atrPct<0.3||atrPct>10) return false;
  if (c[i].c < e21A[i]) return false;
  let atrSum=0,cnt=0;
  for (let k=i-20;k<i;k++) if (atrA[k]>0){atrSum+=atrA[k];cnt++;}
  if (cnt>0 && atrA[i] > (atrSum/cnt)*1.25) return false;
  let vSum=0,vCnt=0;
  for (let k=i-10;k<i;k++) if (c[k].v>0){vSum+=c[k].v;vCnt++;}
  const avgV=vCnt>0?vSum/vCnt:0;
  if (avgV<=0||c[i].v<avgV*1.3) return false;
  let h20=0; for (let k=i-20;k<=i;k++) h20=Math.max(h20,c[k].h);
  if (c[i].c < h20*0.96) return false;
  return true;
}

// ── Stop candidates ───────────────────────────────────────────────────────────
const STOPS = [
  { key: 's_atr2',    label: 'CURRENT: Stop=2.0×ATR',         compute: (e,a,sw5) => e - 2.0*a },
  { key: 's_atr175',  label: 'CANDIDATE: Stop=1.75×ATR',      compute: (e,a,sw5) => e - 1.75*a },
  { key: 's_atr15',   label: 'CANDIDATE: Stop=1.5×ATR',       compute: (e,a,sw5) => e - 1.5*a },
  { key: 's_atr125',  label: 'CANDIDATE: Stop=1.25×ATR',      compute: (e,a,sw5) => e - 1.25*a },
  { key: 's_atr10',   label: 'CANDIDATE: Stop=1.0×ATR',       compute: (e,a,sw5) => e - 1.0*a },
  { key: 's_adapt1',  label: 'ADAPTIVE: <2%→1.5×, ≥2%→2.0×', compute: (e,a,sw5) => { const p=a/e*100; return p<2 ? e-1.5*a : e-2.0*a; } },
  { key: 's_adapt2',  label: 'ADAPTIVE: <2%→1.5×, ≥2%→1.75×',compute: (e,a,sw5) => { const p=a/e*100; return p<2 ? e-1.5*a : e-1.75*a; } },
  { key: 's_struct',  label: 'STRUCT: max(1.5×ATR, 5L×0.995)',compute: (e,a,sw5) => Math.max(e-1.5*a, sw5*0.995) },
  { key: 's_struct2', label: 'STRUCT: max(1.5×ATR, 5L×0.997)',compute: (e,a,sw5) => Math.max(e-1.5*a, sw5*0.997) },
  { key: 's_clamp15', label: 'CLAMP 1.5×ATR (floor2%,cap5%)', compute: (e,a,sw5) => { const raw=e-1.5*a; return Math.min(e*0.98, Math.max(e*0.95, raw)); } },
  { key: 's_clamp2',  label: 'CLAMP 2.0×ATR (floor2%,cap5%)', compute: (e,a,sw5) => { const raw=e-2.0*a; return Math.min(e*0.98, Math.max(e*0.95, raw)); } },
  { key: 's_clamp15b',label: 'CLAMP 1.5×ATR (floor2%,cap6%)', compute: (e,a,sw5) => { const raw=e-1.5*a; return Math.min(e*0.98, Math.max(e*0.94, raw)); } },
];

// ── Per-stop stats (overall + 5 ATR-bands) ───────────────────────────────────
function newStat() {
  return {
    n:0, hitT1:0, hitT2:0, hitT3:0, stopped:0, swept:0,
    evSum:0, evRSum:0, stopPctSum:0,
    t1TimeSum:0, t1TimeN:0,
    // bands: lt1 (<1%), b1to2 (1-2%), b2to3 (2-3%), b3to5 (3-5%), gt5 (>5%)
    bands: {
      lt1:   {n:0,hitT1:0,stopped:0,swept:0,evSum:0,evRSum:0,stopPctSum:0},
      b1to2: {n:0,hitT1:0,stopped:0,swept:0,evSum:0,evRSum:0,stopPctSum:0},
      b2to3: {n:0,hitT1:0,stopped:0,swept:0,evSum:0,evRSum:0,stopPctSum:0},
      b3to5: {n:0,hitT1:0,stopped:0,swept:0,evSum:0,evRSum:0,stopPctSum:0},
      gt5:   {n:0,hitT1:0,stopped:0,swept:0,evSum:0,evRSum:0,stopPctSum:0},
    },
  };
}

const stats = {};
for (const s of STOPS) stats[s.key] = newStat();

const files = fs.readdirSync(DATA_DIR).filter(f=>/\.csv$/i.test(f)).map(f=>path.join(DATA_DIR,f));
console.log(`\nPhase 3 — ATR-anchored head-to-head | ${files.length} files × ${STOPS.length} stop candidates\n`);

let processed=0, totalSig=0;

for (const fp of files) {
  let c; try { c=parseCSV(fp); } catch { continue; }
  if (c.length<MIN_BARS+HORIZON+30) continue;
  processed++;

  const atrA=calcATR14(c);
  const e21A=calcEMA(c,21);

  for (let i=30; i<c.length-HORIZON-2; i++) {
    if (!isSignal(c,i,atrA,e21A)) continue;

    const atr   = atrA[i];
    const entry = c[i+1].o;
    if (!entry||entry<=0) continue;

    const atrPct = atr/entry*100;
    totalSig++;

    // Targets always in ATR terms
    const t1 = entry + 1.5*atr;
    const t2 = entry + 3.0*atr;
    const t3 = entry + 5.0*atr;
    const t1G = (t1-entry)/entry*100;
    const t2G = (t2-entry)/entry*100;
    const t3G = (t3-entry)/entry*100;

    // 5-bar swing low
    let sw5=Infinity;
    for (let k=i-5;k<=i;k++) sw5=Math.min(sw5,c[k]?.l??Infinity);
    if (!isFinite(sw5)) sw5=entry*0.95;

    const band = atrPct<1?'lt1': atrPct<2?'b1to2': atrPct<3?'b2to3': atrPct<5?'b3to5':'gt5';

    for (const stopDef of STOPS) {
      const stopPrice = stopDef.compute(entry, atr, sw5);
      if (!stopPrice||stopPrice>=entry||stopPrice<=0) continue;
      const stopPct=(entry-stopPrice)/entry*100;
      if (stopPct<0.3||stopPct>15) continue;
      const stopR = 1.0; // by definition, stop = 1R

      const st = stats[stopDef.key];
      st.n++;
      st.stopPctSum += stopPct;

      const bd = st.bands[band];
      bd.n++;
      bd.stopPctSum += stopPct;

      // Walk forward: find first event for each target/stop
      let stopBar=9999, t1Bar=9999, t2Bar=9999, t3Bar=9999;
      let swept=false;

      for (let j=i+1; j<=i+HORIZON && j<c.length; j++) {
        const b=c[j], bi=j-(i+1);
        if (stopBar===9999 && b.l<=stopPrice) {
          stopBar=bi;
          for (let k=j;k<=j+3&&k<c.length;k++) {
            if (c[k].c>entry) { swept=true; break; }
          }
        }
        if (t1Bar===9999 && b.h>=t1) t1Bar=bi;
        if (t2Bar===9999 && b.h>=t2) t2Bar=bi;
        if (t3Bar===9999 && b.h>=t3) t3Bar=bi;
      }

      const t1Won = t1Bar < stopBar;
      const t2Won = t2Bar < stopBar;
      const t3Won = t3Bar < stopBar;
      const stopped = !t1Won;

      // EV in % and R-multiples
      let ev=0, evR=0;

      if (t1Won) {
        if (t1Bar < stopBar) st.t1TimeSum += t1Bar, st.t1TimeN++;
        ev  += 0.50 * t1G;
        evR += 0.50 * (t1G/stopPct);
        if (t2Won) {
          ev  += 0.30 * t2G;
          evR += 0.30 * (t2G/stopPct);
          if (t3Won) {
            ev  += 0.20 * t3G;
            evR += 0.20 * (t3G/stopPct);
          } else {
            const end=Math.min(i+HORIZON,c.length-1);
            const exitPrice = stopBar<9999 ? stopPrice : c[end].c;
            const exitPct=(exitPrice-entry)/entry*100;
            ev  += 0.20 * exitPct;
            evR += 0.20 * (exitPct/stopPct);
          }
        } else {
          const end=Math.min(i+HORIZON,c.length-1);
          const exitPrice = stopBar<9999 ? stopPrice : c[end].c;
          const exitPct=(exitPrice-entry)/entry*100;
          ev  += 0.50 * exitPct;
          evR += 0.50 * (exitPct/stopPct);
        }
      } else {
        ev  = -stopPct;
        evR = -1.0;
      }

      st.evSum  += ev;
      st.evRSum += evR;
      if (t1Won) { st.hitT1++; bd.hitT1++; }
      if (t2Won) st.hitT2++;
      if (t3Won) st.hitT3++;
      if (stopped) { st.stopped++; bd.stopped++; }
      if (swept)   { st.swept++;   bd.swept++;   }
      bd.evSum  += ev;
      bd.evRSum += evR;
    }
  }
  if (processed%200===0) process.stdout.write(`\r  ${processed} files | ${totalSig.toLocaleString()} signals`);
}
process.stdout.write(`\r  ${processed} files | ${totalSig.toLocaleString()} signals\n\n`);

// ── Report ────────────────────────────────────────────────────────────────────
function pct(x) { return (x>=0?'+':'')+x.toFixed(2)+'%'; }
function rr(x)  { return (x>=0?'+':'')+x.toFixed(3)+'R'; }

const LINE='═'.repeat(120);
console.log(LINE);
console.log('  PHASE 3 — ATR-ANCHORED STOP HEAD-TO-HEAD');
console.log(`  T1=+1.5×ATR · T2=+3.0×ATR · T3=+5.0×ATR · 50%@T1 30%@T2 20%@T3`);
console.log(`  ${processed} files · ${totalSig.toLocaleString()} signal bars · 20-bar horizon`);
console.log(LINE);
console.log();

// Overall table
const H = 'Stop Method                                  |  n(sig) | WinRate | T2Rate | T3Rate | StopRate| Sweep%  | EV%/tr  | EV_R/tr | AvgStop%| R:R@T2 | T1 bar';
console.log(H);
console.log('─'.repeat(H.length));

const rows = STOPS.map(s => {
  const st = stats[s.key];
  if (st.n < 100) return null;
  const n=st.n;
  return {
    key: s.key, label: s.label, n,
    wr:    +(st.hitT1/n*100).toFixed(2),
    t2r:   +(st.hitT2/n*100).toFixed(2),
    t3r:   +(st.hitT3/n*100).toFixed(2),
    stopr: +(st.stopped/n*100).toFixed(2),
    sweep: +(st.swept/n*100).toFixed(2),
    ev:    +(st.evSum/n).toFixed(4),
    evR:   +(st.evRSum/n).toFixed(4),
    stop:  +(st.stopPctSum/n).toFixed(2),
    rrT2:  +((t2=>t2>0?t2/st.stopPctSum*n:0)(3.0*st.stopPctSum/n)).toFixed(2), // T2 = 3×ATR, stop = stopPct, so R:R = t2Gain/stopPct
    t1bar: st.t1TimeN>0 ? +(st.t1TimeSum/st.t1TimeN).toFixed(1) : 0,
    bands: st.bands,
  };
}).filter(Boolean);

// Re-compute R:R at T2 properly: R:R = (T2_gain) / stop_dist = (3×ATR%) / stopPct
// Since ATR% varies per signal, compute from evR data isn't direct.
// Approximate: for each stop method, T2gain ≈ 3×atrPct per signal, stop = stopPct
// We'll just show T2hit/(1-T2hit) ratio as proxy

for (const r of rows) {
  // R:R at T2: average = (t2 - entry) / (entry - stop) = 3×ATR% / stopPct
  // We'll compute from averages as proxy (approximate but informative)
  const approxRR = r.stop > 0 ? (r.stop * 3.0 / r.stop) : 0; // always 3x for ATR-based stops

  const line = [
    r.label.padEnd(45),
    String(r.n).padStart(7),
    (r.wr.toFixed(1)+'%').padStart(7),
    (r.t2r.toFixed(1)+'%').padStart(6),
    (r.t3r.toFixed(1)+'%').padStart(6),
    (r.stopr.toFixed(1)+'%').padStart(7),
    (r.sweep.toFixed(1)+'%').padStart(7),
    (r.ev.toFixed(3)+'%').padStart(7),
    (r.evR.toFixed(3)+'R').padStart(7),
    (r.stop.toFixed(2)+'%').padStart(7),
    '—'.padStart(6),
    r.t1bar.toFixed(1).padStart(7),
  ].join(' | ');
  console.log(line);
}

console.log();
console.log('── DERIVED R:R TABLE (T2 gain / stop distance, by ATR band) ──────────────────────────────────────────────────────────────────');
console.log('   For ATR-based stops: R:R@T2 = 3×ATR% / stopPct');
for (const r of rows) {
  const avgAtrPct = r.stop / (STOPS.find(s=>s.key===r.key)?.compute.toString().includes('1.5') ? 1.5 : 2.0);
  // Instead just show: stop=x%, T2=3×ATR%, R:R = T2/stop
  // We need avg ATR% which = avg stop / stop_mult
  // Approximate from avgStop:
  let mult = 2.0;
  if (r.key.includes('atr15')||r.key.includes('adapt')||r.key.includes('struct')||r.key.includes('clamp15')) mult=1.5;
  if (r.key.includes('atr175')) mult=1.75;
  if (r.key.includes('atr125')) mult=1.25;
  if (r.key.includes('atr10')) mult=1.0;
  const avgAtr = r.stop / mult;
  const t2pct  = 3.0 * avgAtr;
  const impliedRR = t2pct / r.stop;
  console.log(`  ${r.label.padEnd(45)}  avgStop: ${r.stop.toFixed(2).padStart(5)}%  T2gain≈${t2pct.toFixed(2).padStart(5)}%  R:R≈${impliedRR.toFixed(2)}`);
}

console.log();
console.log('── PER ATR-BAND BREAKDOWN ─────────────────────────────────────────────────────────────────────────────────────────────────────');
for (const [bk, bl] of [['lt1','ATR<1%'],['b1to2','ATR1–2%'],['b2to3','ATR2–3%'],['b3to5','ATR3–5%'],['gt5','ATR>5%']]) {
  console.log(`\n  ── ${bl} ──`);
  const brows = rows.map(r => {
    const b = r.bands[bk];
    if (!b||b.n<50) return null;
    return {
      label: r.label.padEnd(45),
      n: b.n,
      wr: b.n>0?+(b.hitT1/b.n*100).toFixed(1):0,
      ev: b.n>0?+(b.evSum/b.n).toFixed(3):0,
      evR: b.n>0?+(b.evRSum/b.n).toFixed(3):0,
      sweep: b.n>0?+(b.swept/b.n*100).toFixed(1):0,
      stop: b.n>0?+(b.stopPctSum/b.n).toFixed(2):0,
    };
  }).filter(Boolean).sort((a,b)=>b.evR-a.evR);

  for (const b of brows) {
    const marker = b.evR > 0 ? '  ★' : '';
    console.log(`  ${b.label} n=${String(b.n).padStart(6)} WR:${String(b.wr).padStart(5)}% EV%:${String(b.ev).padStart(7)}% EV_R:${String(b.evR).padStart(7)}R Sweep:${String(b.sweep).padStart(5)}% Stop:${String(b.stop).padStart(5)}%${marker}`);
  }
}

console.log();
console.log('── SWEEP COST COMPARISON ──────────────────────────────────────────────────────────────────────────────────────────────────────');
const sweepSorted = [...rows].sort((a,b)=>a.sweep-b.sweep);
for (const r of sweepSorted) {
  const sweepCostPct = r.swept > 0 ? r.stop * r.sweep / 100 : 0; // approx cost = stopPct × sweepRate
  console.log(`  ${r.label.padEnd(45)}  Sweep:${r.sweep.toFixed(1).padStart(5)}%  SweepCost≈${sweepCostPct.toFixed(3).padStart(6)}%/tr  WR:${r.wr.toFixed(1).padStart(5)}%  EV_R:${r.evR.toFixed(3).padStart(8)}R`);
}

console.log();
console.log('── KEY INSIGHTS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────');
const byEvR = [...rows].sort((a,b)=>b.evR-a.evR);
const current = rows.find(r=>r.key==='s_atr2');
const best    = byEvR[0];
const bestWR  = [...rows].sort((a,b)=>b.wr-a.wr)[0];

console.log(`  Total signal bars : ${totalSig.toLocaleString()}`);
console.log(`  Current (2×ATR)   : WR=${current?.wr.toFixed(1)}% EV_R=${current?.evR.toFixed(3)}R Sweep=${current?.sweep.toFixed(1)}% AvgStop=${current?.stop.toFixed(2)}%`);
console.log(`  Best EV_R method  : ${best?.label} WR=${best?.wr.toFixed(1)}% EV_R=${best?.evR.toFixed(3)}R`);
console.log(`  Best WR method    : ${bestWR?.label} WR=${bestWR?.wr.toFixed(1)}%`);

if (current && best && best.key !== 's_atr2') {
  const evImprove = best.evR - current.evR;
  console.log(`\n  DELTA vs current  : EV_R ${evImprove>=0?'+':''}${evImprove.toFixed(3)}R/trade  WR ${(best.wr-current.wr).toFixed(1)}pp  Sweep ${(best.sweep-current.sweep).toFixed(1)}pp`);
}

// ── Save ──────────────────────────────────────────────────────────────────────
const ts=new Date().toISOString().slice(0,16).replace(':','-');
const report={
  generatedAt:new Date().toISOString(),
  config:{targets:'T1=1.5×ATR T2=3.0×ATR T3=5.0×ATR',exits:'50%@T1 30%@T2 20%@T3',horizon:HORIZON},
  totals:{processed,totalSignals:totalSig},
  results: rows.map(r=>({...r, bands:undefined})),
  bandBreakdown: ['lt1','b1to2','b2to3','b3to5','gt5'].reduce((acc,bk)=>{
    acc[bk]=rows.map(r=>{const b=r.bands[bk];return b&&b.n>=50?{key:r.key,label:r.label,n:b.n,wr:b.hitT1/b.n*100,ev:b.evSum/b.n,evR:b.evRSum/b.n,sweep:b.swept/b.n*100}:null}).filter(Boolean).sort((a,b2)=>b2.evR-a.evR);
    return acc;
  },{}),
};
const jf=path.join(OUT_DIR,`stop_loss_phase3_${ts}.json`);
fs.writeFileSync(jf,JSON.stringify(report,null,2));
console.log(`\n  JSON: ${jf}`);
console.log(LINE+'\n');
