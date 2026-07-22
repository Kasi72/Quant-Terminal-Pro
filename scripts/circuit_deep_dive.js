'use strict';
/**
 * CIRCUIT DEEP DIVE — 5-bar forensic analysis + case-control discriminant study
 * ─────────────────────────────────────────────────────────────────────────────
 * For each NO_SIGNAL circuit event:
 *   - Extracts bars D-5 → D-1 before the circuit candle
 *   - Computes 40+ engineered features: volume sequences, range compression,
 *     Garman-Klass volatility, ATR ratio (contraction), OBV/price divergence,
 *     candle geometry sequences, linear regression, Money Flow Index, etc.
 *
 * Case-control design:
 *   - For every circuit event (case), samples 5 random non-circuit bars from
 *     the SAME stock (control) with the same lookback window
 *   - Computes Odds Ratio (binary features) and Cohen's d (continuous) for
 *     each feature → ranks by discriminant power
 *   - Identifies minimum-condition sets that together achieve highest lift
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const OUT_DIR    = path.join(__dirname, 'results');
const CIRCUIT_PCT = 9.0;
const CIRCUIT_MAX = 25.0;
const CONFIRM_GAP = 0.5;      // H≈C (upper circuit locked)
const LOOKBACK    = 5;        // bars before circuit day to analyze
const CTRL_PER_EVENT = 5;     // control bars sampled per circuit event
const MIN_DATA    = 350;
const WINDOW_IND  = 60;       // bars needed for indicator warmup

// ─── CSV parse ────────────────────────────────────────────────────────────────

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(s => s.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || !o || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), date: p[0].trim(), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ─── Rolling indicator arrays (cheap, reused) ─────────────────────────────────

function buildIndicators(bars) {
  const n = bars.length;

  // EMA helper
  const ema = (src, p) => {
    const k = 2 / (p + 1); let v = src[0]; const o = [v];
    for (let i = 1; i < src.length; i++) { v = src[i]*k + v*(1-k); o.push(v); }
    return o;
  };

  const closes = bars.map(b => b.c);
  const vols   = bars.map(b => b.v);

  // ATR 14
  const tr = [bars[0].h - bars[0].l];
  for (let i = 1; i < n; i++) tr.push(Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-bars[i-1].c),Math.abs(bars[i].l-bars[i-1].c)));
  let atr14 = tr.slice(0,14).reduce((a,x)=>a+x,0)/14;
  const atrArr = Array(14).fill(atr14);
  for (let i=14;i<n;i++){atr14=(atr14*13+tr[i])/14; atrArr.push(atr14);}

  // ATR 5
  let atr5 = tr.slice(0,5).reduce((a,x)=>a+x,0)/5;
  const atr5Arr = Array(5).fill(atr5);
  for (let i=5;i<n;i++){atr5=(atr5*4+tr[i])/5; atr5Arr.push(atr5);}

  // OBV
  const obv=[0];
  for(let i=1;i<n;i++) obv.push(obv[i-1]+(bars[i].c>bars[i-1].c?bars[i].v:bars[i].c<bars[i-1].c?-bars[i].v:0));

  // CMF 14
  const mfv=bars.map(b=>{const r=b.h-b.l;return r<1e-9?0:((b.c-b.l)-(b.h-b.c))/r*b.v;});
  const cmf14=Array(13).fill(0);
  for(let i=13;i<n;i++){
    const vs=bars.slice(i-13,i+1).reduce((a,b)=>a+b.v,0);
    cmf14.push(vs?mfv.slice(i-13,i+1).reduce((a,x)=>a+x,0)/vs:0);
  }

  // Volume 20-bar avg
  const vAvg20=bars.map((_,i)=>{const s=vols.slice(Math.max(0,i-19),i+1);return s.reduce((a,x)=>a+x,0)/s.length;});

  // Volume 5-bar avg
  const vAvg5=bars.map((_,i)=>{const s=vols.slice(Math.max(0,i-4),i+1);return s.reduce((a,x)=>a+x,0)/s.length;});

  // EMA20 for OBV
  const ema20c = ema(closes, 20);

  // RSI 14
  const gains=[], losses=[];
  for(let i=1;i<n;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));}
  let ag=gains.slice(0,14).reduce((a,x)=>a+x,0)/14, al=losses.slice(0,14).reduce((a,x)=>a+x,0)/14;
  const rsi14=Array(15).fill(50);
  rsi14[14]=al===0?100:100-100/(1+ag/al);
  for(let i=14;i<gains.length;i++){ag=(ag*13+gains[i])/14;al=(al*13+losses[i])/14;rsi14.push(al===0?100:100-100/(1+ag/al));}

  // Stochastic %K 14
  const stoch14 = bars.map((_,i)=>{
    if(i<13) return 50;
    const s=bars.slice(i-13,i+1);
    const lo=Math.min(...s.map(b=>b.l)),hi=Math.max(...s.map(b=>b.h));
    return hi===lo?50:(bars[i].c-lo)/(hi-lo)*100;
  });

  // ADX14 lightweight
  const dmP=[],dmM=[],trr=[{v:bars[0].h-bars[0].l}];
  for(let i=1;i<n;i++){
    const up=bars[i].h-bars[i-1].h,dn=bars[i-1].l-bars[i].l;
    dmP.push(up>dn&&up>0?up:0); dmM.push(dn>up&&dn>0?dn:0);
    trr.push({v:Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-bars[i-1].c),Math.abs(bars[i].l-bars[i-1].c))});
  }
  let atrD=trr.slice(0,14).reduce((a,x)=>a+x.v,0);
  let aDP=dmP.slice(0,13).reduce((a,x)=>a+x,0);
  let aDM=dmM.slice(0,13).reduce((a,x)=>a+x,0);
  const adxArr=Array(14).fill({adx:20,dp:20,dm:20});
  let dxBuf=[];
  for(let i=13;i<trr.length-1;i++){
    atrD=atrD-atrD/14+trr[i+1].v;
    aDP=aDP-aDP/14+(dmP[i]||0);
    aDM=aDM-aDM/14+(dmM[i]||0);
    const dp=atrD?aDP/atrD*100:0,dm=atrD?aDM/atrD*100:0;
    const dx=dp+dm?Math.abs(dp-dm)/(dp+dm)*100:0;
    dxBuf.push(dx);
    if(dxBuf.length<14){adxArr.push({adx:20,dp,dm});continue;}
    const adxVal=dxBuf.length===14?dxBuf.reduce((a,x)=>a+x,0)/14:(adxArr[adxArr.length-1].adx*13+dx)/14;
    adxArr.push({adx:adxVal,dp,dm});
  }
  while(adxArr.length<n) adxArr.push(adxArr[adxArr.length-1]||{adx:20,dp:20,dm:20});

  return { atrArr, atr5Arr, obv, cmf14, vAvg20, vAvg5, ema20c, rsi14, stoch14, adxArr };
}

// ─── Garman-Klass volatility over n bars ─────────────────────────────────────
function gkVol(bars) {
  // GK = sqrt(1/n * sum(0.5*(ln H/L)^2 - (2ln2-1)*(ln C/O)^2))
  const terms = bars.map(b => {
    const hl = b.h > b.l ? Math.log(b.h / b.l) : 0;
    const co = b.o > 0 && b.c > 0 ? Math.log(b.c / b.o) : 0;
    return 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
  });
  return Math.sqrt(Math.max(0, terms.reduce((a, x) => a + x, 0) / terms.length)) * 100;
}

// ─── Linear regression on array → {slope, r2, intercept} ───────────────────
function linReg(arr) {
  const n = arr.length;
  let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
  arr.forEach((y,x)=>{sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;sy2+=y*y;});
  const denom=n*sx2-sx*sx;
  if(!denom) return {slope:0,r2:0,intercept:arr[0]};
  const slope=(n*sxy-sx*sy)/denom;
  const intc=(sy-slope*sx)/n;
  const ssres=arr.reduce((a,y,x)=>a+(y-(intc+slope*x))**2,0);
  const sstot=arr.reduce((a,y)=>a+(y-sy/n)**2,0);
  return {slope:+slope.toFixed(5),r2:sstot>0?+(1-ssres/sstot).toFixed(4):0,intercept:intc};
}

// ─── Money Flow Index (n-period) ─────────────────────────────────────────────
function mfi(bars, n=7) {
  const tp=bars.map(b=>(b.h+b.l+b.c)/3);
  let posFlow=0,negFlow=0;
  for(let i=1;i<bars.length;i++){
    const mf=tp[i]*bars[i].v;
    if(tp[i]>tp[i-1]) posFlow+=mf; else negFlow+=mf;
  }
  return negFlow===0?100:100-100/(1+posFlow/negFlow);
}

// ─── Extract deep features for an n-bar window ending at idx ─────────────────
function deepFeatures(bars, idx, ind) {
  if(idx < LOOKBACK+1) return null;
  const {atrArr,atr5Arr,obv,cmf14,vAvg20,vAvg5,rsi14,stoch14,adxArr} = ind;

  const W = bars.slice(idx - LOOKBACK, idx + 1); // D-5 … D-1 → 6 bars (D0 excluded)
  // W[0]=D-5, W[1]=D-4, W[2]=D-3, W[3]=D-2, W[4]=D-1, but we only want D-5..D-1 (5 bars)
  // Actually idx is the pre-circuit bar (D-1), so we want bars at idx-4..idx
  const slice5 = bars.slice(idx - 4, idx + 1); // 5 bars: D-5..D-1

  if(slice5.length < 5) return null;

  const [b5, b4, b3, b2, b1] = slice5; // oldest to newest (b1 = D-1, the day before circuit)

  // ── Volume features ──
  const vs = slice5.map(b=>b.v);
  const va20 = vAvg20[idx] || 1;
  const va5  = vAvg5[idx]  || 1;

  const volRatios = slice5.map((b,i)=>{const a=vAvg20[idx-4+i];return a?b.v/a:1;});
  const vD1=volRatios[4], vD2=volRatios[3], vD3=volRatios[2], vD4=volRatios[1], vD5=volRatios[0];

  // Vol declining 3 consecutive days before circuit (D-3>D-2>D-1 in raw volume)
  const volDecl3 = vs[4] < vs[3] && vs[3] < vs[2];
  // Vol declining 5 days straight
  const volDecl5 = vs[4]<vs[3] && vs[3]<vs[2] && vs[2]<vs[1] && vs[1]<vs[0];
  // All 5 bars below 20-bar avg volume
  const allVolBelowAvg = volRatios.every(r=>r<1.0);
  // At least 4/5 bars below avg
  const mostVolBelowAvg = volRatios.filter(r=>r<1.0).length >= 4;
  // Last 2 bars dramatically dry (< 0.5× avg)
  const veryDry2 = vD1 < 0.5 && vD2 < 0.5;
  // Volume z-score on D-1 (< -0.5 = drying)
  const volZD1 = va20 > 0 ? (b1.v - va20) / (va20 * 0.8) : 0;
  // Vol on bull candles vs bear candles over 5 days
  const volOnBull = slice5.filter(b=>b.c>b.o).reduce((a,b)=>a+b.v,0);
  const volOnBear = slice5.filter(b=>b.c<=b.o).reduce((a,b)=>a+b.v,0);
  const volBullDominance = (volOnBull + volOnBear) > 0 ? volOnBull/(volOnBull+volOnBear) : 0.5;
  // Recent-to-prior vol ratio (D-1+D-2 vs D-3+D-4+D-5)
  const recentVol = (b1.v + b2.v) / 2;
  const priorVol  = (b3.v + b4.v + b5.v) / 3;
  const volTaper  = priorVol > 0 ? recentVol / priorVol : 1; // < 1 = tapering

  // ── Range / Volatility features ──
  const ranges = slice5.map(b=>b.h-b.l);
  const rD1=ranges[4],rD2=ranges[3],rD3=ranges[2];
  const rangeDecl3 = rD1 < rD2 && rD2 < rD3;
  const rangeDecl5 = ranges[4]<ranges[3] && ranges[3]<ranges[2] && ranges[2]<ranges[1] && ranges[1]<ranges[0];

  // ATR compression ratio = ATR5/ATR14 at D-1
  const atrComp = atrArr[idx] > 0 ? atr5Arr[idx] / atrArr[idx] : 1;
  // Garman-Klass vol 5 bars
  const gkV5 = gkVol(slice5);
  // Parkinson volatility (HL-based)
  const parkV5 = Math.sqrt(slice5.reduce((a,b)=>{const hl=b.h/b.l;return a+Math.log(hl)*Math.log(hl);},(0))/(4*5*Math.log(2)))*100;
  // Price range span: max(H) - min(L) over 5 bars, normalized
  const highMax = Math.max(...slice5.map(b=>b.h));
  const lowMin  = Math.min(...slice5.map(b=>b.l));
  const priceSpan5pct = b1.c > 0 ? (highMax - lowMin) / b1.c * 100 : 5;
  // Inside bar count
  let insideCount = 0;
  for(let i=1;i<5;i++) if(slice5[i].h<=slice5[i-1].h && slice5[i].l>=slice5[i-1].l) insideCount++;
  const hasConsecInsideBars = insideCount >= 2;

  // ── Candle geometry D-1 ──
  const range1 = b1.h - b1.l;
  const body1  = Math.abs(b1.c - b1.o);
  const bodyPct1      = range1 > 1e-9 ? body1 / range1 * 100 : 0;
  const upperWick1    = range1 > 1e-9 ? (b1.h - Math.max(b1.c, b1.o)) / range1 * 100 : 0;
  const lowerWick1    = range1 > 1e-9 ? (Math.min(b1.c, b1.o) - b1.l) / range1 * 100 : 0;
  const closeLoc1     = range1 > 1e-9 ? (b1.c - b1.l) / range1 * 100 : 50;
  const isBull1       = b1.c > b1.o;
  const isDoji1       = bodyPct1 < 5;
  const isHammer1     = lowerWick1 > 2 * Math.max(bodyPct1,1) && upperWick1 < 15; // lower wick dominates
  const isInvHammer1  = upperWick1 > 2 * Math.max(bodyPct1,1) && lowerWick1 < 15;

  // Candle sequence over 5 bars (B=bull, R=bear, D=doji)
  const candleSeq = slice5.map(b=>{
    const bdy=Math.abs(b.c-b.o),rng=b.h-b.l;
    if(rng<1e-9||bdy/rng<0.05) return 'D';
    return b.c>b.o?'B':'R';
  }).join('');

  // Close-in-upper-half count (strength)
  const closeUpperHalf = slice5.filter(b=>{const r=b.h-b.l;return r>1e-9&&(b.c-b.l)/r>0.5;}).length;
  // Lower-wick-dominant count (buying at lows)
  const lowerWickDom = slice5.filter(b=>{
    const r=b.h-b.l; if(r<1e-9) return false;
    const lw=(Math.min(b.c,b.o)-b.l)/r, uw=(b.h-Math.max(b.c,b.o))/r;
    return lw>uw&&lw>0.25;
  }).length;

  // ── Price structure ──
  const closes5 = slice5.map(b=>b.c);
  const lr5 = linReg(closes5);
  // How flat is the consolidation?
  const priceFlatPct5 = Math.max(...closes5) / Math.min(...closes5) - 1;
  const isFlat5 = priceFlatPct5 < 0.025; // within 2.5%
  const isTight3 = (Math.max(b1.c,b2.c,b3.c)/Math.min(b1.c,b2.c,b3.c)-1) < 0.015;
  // Close relative to 5-day high
  const c5High = highMax;
  const closeVs5H = c5High > 0 ? (b1.c / c5High - 1) * 100 : 0;
  // Close vs 5-day low
  const closeVs5L = lowMin > 0 ? (b1.c / lowMin - 1) * 100 : 0;

  // ── OBV / price divergence ──
  const obvSlice = [obv[idx-4],obv[idx-3],obv[idx-2],obv[idx-1],obv[idx]];
  const lrOBV = linReg(obvSlice);
  const lrPrice = linReg(closes5);
  const obvDivUp   = lrOBV.slope > 0 && lrPrice.slope <= 0;  // OBV up, price flat/down = bull divergence
  const obvDivDown = lrOBV.slope < 0 && lrPrice.slope > 0;   // OBV down, price up = bear divergence
  const obvTrendPct = obvSlice[0] !== 0 ? (obvSlice[4]-obvSlice[0])/Math.abs(obvSlice[0])*100 : 0;

  // ── Money Flow Index 5-bar ──
  const mfi5 = mfi(slice5, 5);
  // Stochastic D-1
  const stochD1 = stoch14[idx] || 50;
  // RSI D-1
  const rsiD1 = rsi14[idx] || 50;
  const rsiD2 = rsi14[idx-1] || 50;
  // RSI declining D-3→D-1 (overbought fading)
  const rsiDecl3 = rsiD1 < (rsi14[idx-1]||50) && (rsi14[idx-1]||50) < (rsi14[idx-2]||50);

  // ── ADX / trend ──
  const adxD1 = adxArr[idx]?.adx ?? 20;
  const dpD1  = adxArr[idx]?.dp ?? 20;
  const dmD1  = adxArr[idx]?.dm ?? 20;
  const diBull = dpD1 > dmD1;
  const adxLow  = adxD1 < 20;
  const adxMid  = adxD1 >= 20 && adxD1 <= 30;

  // ── CMF ──
  const cmfD1 = cmf14[idx] || 0;
  const cmfNeg = cmfD1 < 0;
  const cmfSlight = cmfD1 >= -0.1 && cmfD1 < 0.1;

  // ── ATR % of close ──
  const atrPct = atrArr[idx] > 0 && b1.c > 0 ? atrArr[idx] / b1.c * 100 : 2;

  // ── COMBINED PATTERN COMBOS (composite binary features) ──
  // Pattern A: The "Silent Coil" — vol dry + range contracting + DI+>DI-
  const patSilentCoil = mostVolBelowAvg && rangeDecl3 && diBull;
  // Pattern B: The "Taper Hammer" — vol tapering + hammer candle on D-1
  const patTaperHammer = volTaper < 0.7 && isHammer1;
  // Pattern C: "OBV Divergence Coil" — OBV rising while price flat
  const patOBVCoil = obvDivUp && isFlat5;
  // Pattern D: "Near High Coil" — near 52w high + vol drying + DI bull
  const near52H_idx = (() => {
    const w52 = bars.slice(Math.max(0,idx-252),idx+1);
    const h52 = Math.max(...w52.map(b=>b.h));
    return b1.c > 0 ? b1.c / h52 > 0.7 : false;
  })();
  const patNearHighCoil = near52H_idx && mostVolBelowAvg && diBull;
  // Pattern E: "Inside Bar Stack" — 2+ consecutive inside bars + vol dry
  const patInsideStack = hasConsecInsideBars && mostVolBelowAvg;
  // Pattern F: "Flat Price Taper" — price consolidating tight + vol tapering
  const patFlatTaper = isFlat5 && volTaper < 0.8;
  // Pattern G: NR4/NR7 with DI bull
  const nr4 = ranges[4] <= Math.min(ranges[3],ranges[2],ranges[1]);
  const patNR4Bull = nr4 && diBull;
  // Pattern H: MFI oversold + OBV rising (accumulation)
  const patMFIAccum = mfi5 < 40 && lrOBV.slope > 0;

  return {
    // Multi-bar volume
    volRatioD1: +vD1.toFixed(3),
    volRatioD2: +vD2.toFixed(3),
    volRatioD3: +vD3.toFixed(3),
    volTaper:   +volTaper.toFixed(3),
    volZD1:     +volZD1.toFixed(3),
    volDecl3, volDecl5, allVolBelowAvg, mostVolBelowAvg, veryDry2,
    volBullDominance: +volBullDominance.toFixed(3),

    // Range / volatility
    atrComp:   +atrComp.toFixed(4),
    gkVol5:    +gkV5.toFixed(3),
    parkVol5:  +parkV5.toFixed(3),
    priceSpan5pct: +priceSpan5pct.toFixed(2),
    rangeDecl3, rangeDecl5, insideCount,
    hasConsecInsideBars,

    // Candle geometry D-1
    bodyPct1:   +bodyPct1.toFixed(1),
    upperWick1: +upperWick1.toFixed(1),
    lowerWick1: +lowerWick1.toFixed(1),
    closeLoc1:  +closeLoc1.toFixed(1),
    isBull1, isDoji1, isHammer1, isInvHammer1,
    candleSeq,
    closeUpperHalf,
    lowerWickDom,

    // Price structure
    lrSlope5:   +lr5.slope.toFixed(5),
    lrR2:       +lr5.r2.toFixed(4),
    priceFlatPct5: +(priceFlatPct5*100).toFixed(2),
    isFlat5, isTight3,
    closeVs5H:  +closeVs5H.toFixed(2),
    closeVs5L:  +closeVs5L.toFixed(2),

    // OBV divergence
    obvDivUp, obvDivDown,
    obvTrendPct: +obvTrendPct.toFixed(3),

    // Momentum
    mfi5:      +mfi5.toFixed(1),
    stochD1:   +stochD1.toFixed(1),
    rsiD1:     +rsiD1.toFixed(1),
    rsiDecl3,
    cmfD1:     +cmfD1.toFixed(4),
    cmfNeg, cmfSlight,
    atrPct:    +atrPct.toFixed(2),

    // ADX / trend
    adxD1:  +adxD1.toFixed(1),
    dpD1:   +dpD1.toFixed(1),
    dmD1:   +dmD1.toFixed(1),
    diBull, adxLow, adxMid,

    // Composite patterns
    patSilentCoil, patTaperHammer, patOBVCoil, patNearHighCoil,
    patInsideStack, patFlatTaper, patNR4Bull, patMFIAccum,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

function collectWorker() {
  const events  = [];
  const controls = [];
  let processed = 0;

  for (const { name, fp } of workerData.files) {
    let bars; try { bars = parseCSV(fp); } catch { processed++; continue; }
    processed++;
    if (bars.length < MIN_DATA + WINDOW_IND) continue;

    const symbol = name.replace(/_OHLCV\.csv$/i,'');
    const ind = buildIndicators(bars);

    // Detect circuit events
    const circuitIndices = [];
    for (let i = WINDOW_IND + LOOKBACK; i < bars.length - 1; i++) {
      const prev = bars[i - 1];
      const b    = bars[i];
      if (!prev.c) continue;
      const move = (b.c / prev.c - 1) * 100;
      if (move < CIRCUIT_PCT || move > CIRCUIT_MAX) continue;
      const gapHC = b.c > 0 ? (b.h - b.c) / b.c * 100 : 99;
      if (gapHC > CONFIRM_GAP) continue;
      // Pre-circuit bar is i-1
      const preIdx = i - 1;
      if (preIdx < WINDOW_IND + LOOKBACK) continue;
      const feat = deepFeatures(bars, preIdx, ind);
      if (!feat) continue;
      circuitIndices.push(preIdx);
      events.push({ symbol, circuitDate: b.date, circuitMove: +(move.toFixed(2)), preDate: bars[preIdx].date, preIdx, ...feat });
    }

    // Control bars: randomly sample non-circuit bars from the same stock
    const circSet = new Set(circuitIndices);
    const eligible = [];
    for (let i = WINDOW_IND + LOOKBACK; i < bars.length - 1; i++) {
      if (!circSet.has(i)) eligible.push(i);
    }
    // Sample CTRL_PER_EVENT * circuitIndices.length controls
    const nCtrl = Math.min(circuitIndices.length * CTRL_PER_EVENT, eligible.length);
    const shuffled = eligible.sort(() => Math.random() - 0.5).slice(0, nCtrl);
    for (const ctrlIdx of shuffled) {
      const feat = deepFeatures(bars, ctrlIdx, ind);
      if (!feat) continue;
      controls.push({ symbol, preDate: bars[ctrlIdx].date, ...feat });
    }

    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', events, controls, processed });
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function qPct(arr, p) {
  const s=[...arr].sort((a,b)=>a-b);
  return s[Math.min(Math.floor(s.length*p/100),s.length-1)]??null;
}

function meanStd(arr) {
  if(!arr.length) return {mean:0,std:0};
  const m=arr.reduce((a,x)=>a+x,0)/arr.length;
  const v=arr.reduce((a,x)=>a+(x-m)**2,0)/arr.length;
  return {mean:m,std:Math.sqrt(v)};
}

function oddsRatio(pCase, nCase, pCtrl, nCtrl) {
  // OR = (pCase / (1-pCase)) / (pCtrl / (1-pCtrl))
  const eps = 0.5; // continuity correction
  const a = pCase * nCase + eps, b = (1-pCase) * nCase + eps;
  const c = pCtrl * nCtrl + eps, d = (1-pCtrl) * nCtrl + eps;
  return (a * d) / (b * c);
}

function cohenD(caseVals, ctrlVals) {
  const m1 = meanStd(caseVals), m2 = meanStd(ctrlVals);
  const pooledStd = Math.sqrt((m1.std**2 + m2.std**2) / 2) || 1e-9;
  return (m1.mean - m2.mean) / pooledStd;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(10, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n  CIRCUIT DEEP DIVE — ${files.length} stocks, ${nWorkers} workers`);
  console.log(`  5-bar window · ${CTRL_PER_EVENT}× control bars per event · 40+ features\n`);

  let allEvents = [], allControls = [], done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 200 === 0) process.stdout.write(`  Scanning ${done}/${files.length}\r`);
      } else if (m.type === 'done') {
        allEvents   = allEvents.concat(m.events);
        allControls = allControls.concat(m.controls);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`Worker exit ${c}`)); });
  })));

  console.log(`\n  Cases: ${allEvents.length} · Controls: ${allControls.length}\n`);

  if (!allEvents.length) { console.log('  No events found.'); return; }

  const nCase = allEvents.length, nCtrl = allControls.length;

  // ─── Discriminant analysis ────────────────────────────────────────────────

  // Binary features: compute odds ratio
  const boolKeys = [
    'volDecl3','volDecl5','allVolBelowAvg','mostVolBelowAvg','veryDry2',
    'rangeDecl3','rangeDecl5','hasConsecInsideBars',
    'isBull1','isDoji1','isHammer1',
    'isFlat5','isTight3',
    'obvDivUp','obvDivDown',
    'cmfNeg','cmfSlight',
    'diBull','adxLow','adxMid','rsiDecl3',
    'patSilentCoil','patTaperHammer','patOBVCoil','patNearHighCoil',
    'patInsideStack','patFlatTaper','patNR4Bull','patMFIAccum',
  ];

  const boolDiscrim = boolKeys.map(k => {
    const caseTrue  = allEvents.filter(e=>e[k]).length;
    const ctrlTrue  = allControls.filter(e=>e[k]).length;
    const pCase = caseTrue / nCase;
    const pCtrl = ctrlTrue / nCtrl;
    const OR = oddsRatio(pCase, nCase, pCtrl, nCtrl);
    return { feature: k, pCase: +pCase.toFixed(3), pCtrl: +pCtrl.toFixed(3), OR: +OR.toFixed(3),
             lift: +((pCase/(pCtrl||0.001)).toFixed(3)) };
  }).sort((a, b) => Math.abs(Math.log(b.OR)) - Math.abs(Math.log(a.OR)));

  // Continuous features: compute Cohen's d
  const contKeys = [
    'volRatioD1','volRatioD2','volRatioD3','volTaper','volZD1','volBullDominance',
    'atrComp','gkVol5','parkVol5','priceSpan5pct',
    'insideCount','bodyPct1','upperWick1','lowerWick1','closeLoc1',
    'closeUpperHalf','lowerWickDom',
    'lrSlope5','lrR2','priceFlatPct5','closeVs5H',
    'obvTrendPct','mfi5','stochD1','rsiD1','cmfD1','atrPct',
    'adxD1','dpD1','dmD1',
  ];

  const contDiscrim = contKeys.map(k => {
    const cVals = allEvents.map(e=>e[k]).filter(Number.isFinite);
    const rVals = allControls.map(e=>e[k]).filter(Number.isFinite);
    const d = cohenD(cVals, rVals);
    const cm = meanStd(cVals), rm = meanStd(rVals);
    return {
      feature: k, d: +d.toFixed(3),
      caseMean: +cm.mean.toFixed(3), caseStd: +cm.std.toFixed(3),
      ctrlMean: +rm.mean.toFixed(3), ctrlStd: +rm.std.toFixed(3),
      caseP25: qPct(cVals,25), caseP50: qPct(cVals,50), caseP75: qPct(cVals,75),
    };
  }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  // ─── Candle sequence frequency ─────────────────────────────────────────────
  const caseSeqs = {}, ctrlSeqs = {};
  for (const e of allEvents)  caseSeqs[e.candleSeq]  = (caseSeqs[e.candleSeq]||0)  + 1;
  for (const e of allControls) ctrlSeqs[e.candleSeq] = (ctrlSeqs[e.candleSeq]||0) + 1;
  const topSeqs = Object.entries(caseSeqs)
    .map(([seq, cnt]) => ({seq, caseFreq:cnt/nCase, ctrlFreq:(ctrlSeqs[seq]||0)/nCtrl, lift:(cnt/nCase)/((ctrlSeqs[seq]||0.1)/nCtrl)}))
    .sort((a,b)=>b.lift-a.lift).slice(0,15);

  // ─── Combination analysis (top binary features) ───────────────────────────
  const topBinary = boolDiscrim.filter(f=>f.OR>1.2).slice(0,8).map(f=>f.feature);
  // Find pairs with highest case% that are significant
  const pairStats = [];
  for(let i=0;i<topBinary.length;i++) for(let j=i+1;j<topBinary.length;j++) {
    const a=topBinary[i], b=topBinary[j];
    const cCase=allEvents.filter(e=>e[a]&&e[b]).length;
    const cCtrl=allControls.filter(e=>e[a]&&e[b]).length;
    const pC=cCase/nCase, pR=cCtrl/nCtrl;
    const or=oddsRatio(pC,nCase,pR,nCtrl);
    if(cCase>=10) pairStats.push({pair:`${a} ∧ ${b}`,pCase:+(pC*100).toFixed(1),pCtrl:+(pR*100).toFixed(1),OR:+or.toFixed(2),n:cCase});
  }
  pairStats.sort((a,b)=>b.OR-a.OR);

  // ─── Print report ──────────────────────────────────────────────────────────
  const W=100;
  const bar=(pCase,pCtrl,w=28)=>{
    const fc=Math.round(pCase*w), fr=Math.round(pCtrl*w);
    return `[${'█'.repeat(fc)}${'░'.repeat(w-fc)}]${(pCase*100).toFixed(1).padStart(5)}% vs [${'█'.repeat(fr)}${'░'.repeat(w-fr)}]${(pCtrl*100).toFixed(1).padStart(5)}%`;
  };

  console.log('═'.repeat(W));
  console.log('  CIRCUIT DEEP DIVE — DISCRIMINANT FINDINGS');
  console.log(`  Cases(circuit)=${nCase}  Controls(random)=${nCtrl}  Ratio=${(nCtrl/nCase).toFixed(1)}×`);
  console.log('═'.repeat(W));

  console.log('\n─── 1. BINARY FEATURE ODDS RATIOS (sorted by |log OR|) ───────────────────────────────\n');
  console.log('  Feature'.padEnd(32) + 'Case%  Ctrl%    OR    Lift  ' + 'Visualisation');
  console.log('  '+'-'.repeat(96));
  for(const f of boolDiscrim.slice(0,20)) {
    const flag = f.OR > 2.0 ? '★★' : f.OR > 1.5 ? '★ ' : f.OR < 0.7 ? '▼ ' : '  ';
    console.log(`${flag} ${f.feature.padEnd(30)} ${(f.pCase*100).toFixed(1).padStart(5)}% ${(f.pCtrl*100).toFixed(1).padStart(5)}%  ${String(f.OR).padStart(6)}  ${String(f.lift).padStart(5)}×  ${bar(f.pCase,f.pCtrl,20)}`);
  }

  console.log('\n─── 2. CONTINUOUS FEATURE COHEN\'S d (|d|>0.15 = noteworthy) ──────────────────────────\n');
  console.log('  Feature'.padEnd(22) + '  d       Case P50   Ctrl P50   Case mean  Ctrl mean');
  console.log('  '+'-'.repeat(76));
  for(const f of contDiscrim.slice(0,20)) {
    const flag = Math.abs(f.d) > 0.4 ? '★★' : Math.abs(f.d) > 0.25 ? '★ ' : '  ';
    const dir  = f.d > 0 ? '↑' : '↓';
    console.log(`${flag} ${f.feature.padEnd(20)} ${dir} ${String(f.d).padStart(7)}  ${String(f.caseP50).padStart(9)}  ${String(f.ctrlP50).padStart(9)}  ${f.caseMean.toFixed(3).padStart(9)}  ${f.ctrlMean.toFixed(3).padStart(9)}`);
  }

  console.log('\n─── 3. CANDLE SEQUENCE LIFTS (5 bars before circuit) ──────────────────────────────────\n');
  console.log('  Sequence  Case%   Ctrl%   Lift    Interpretation');
  console.log('  '+'-'.repeat(72));
  for(const s of topSeqs.slice(0,12)) {
    const interp = s.seq.endsWith('B') ? 'ends bull' : s.seq.endsWith('R') ? 'ends bear' : 'ends doji';
    const bearCount = (s.seq.match(/R/g)||[]).length;
    const pattern = bearCount >= 3 ? 'mostly-bear' : bearCount === 0 ? 'all-bull' : 'mixed';
    console.log(`  ${s.seq.padEnd(10)}${(s.caseFreq*100).toFixed(1).padStart(5)}%  ${(s.ctrlFreq*100).toFixed(1).padStart(5)}%  ${s.lift.toFixed(2).padStart(6)}×   ${pattern}, ${interp}`);
  }

  console.log('\n─── 4. BINARY PAIR COMBINATIONS (highest OR pairs) ────────────────────────────────────\n');
  console.log('  Pair combination'.padEnd(52) + 'Case%   Ctrl%    OR      n');
  console.log('  '+'-'.repeat(80));
  for(const p of pairStats.slice(0,12)) {
    console.log(`  ${p.pair.padEnd(50)} ${String(p.pCase).padStart(5)}%  ${String(p.pCtrl).padStart(5)}%  ${String(p.OR).padStart(7)}  ${p.n}`);
  }

  // ─── Distilled elite param set ─────────────────────────────────────────────
  console.log('\n─── 5. ELITE PARAM SET — from top discriminants ───────────────────────────────────────\n');

  // Get case vs ctrl medians for key continuous features
  const getMedian = (arr, k) => {const v=arr.map(e=>e[k]).filter(Number.isFinite).sort((a,b)=>a-b);return v[Math.floor(v.length/2)]??null;};
  const cMed = k => getMedian(allEvents, k);

  const eliteParams = {
    // Volume — most discriminant feature family
    maxVolRatio20:        cMed('volRatioD1') !== null ? +(cMed('volRatioD1')+0.3).toFixed(2) : 1.2,
    maxVolTaper:          0.85,              // D-1+D-2 avg / D-3+D-4+D-5 avg
    requireVolDecl3:      boolDiscrim.find(f=>f.feature==='volDecl3')?.OR > 1.3,
    // Range compression
    maxAtrComp:           +(cMed('atrComp')+0.1).toFixed(2), // ATR5/ATR14 — want contracting
    maxPriceSpan5pct:     +(cMed('priceSpan5pct')+2).toFixed(1),
    requireRangeDecl3:    boolDiscrim.find(f=>f.feature==='rangeDecl3')?.OR > 1.3,
    // RSI neutral zone — tightest discriminant window
    minRSI14:   +(Math.max(35, cMed('rsiD1')-10)).toFixed(0),
    maxRSI14:   +(Math.min(75, cMed('rsiD1')+12)).toFixed(0),
    // DI alignment
    requireDIBull:        boolDiscrim.find(f=>f.feature==='diBull')?.OR > 1.2,
    // ADX — prefer low-trend
    minADX:     8,
    maxADX:     32,
    // CMF — loosest gate possible (most circuit hitters have neg CMF)
    minCMF20:             -0.30,
    // OBV divergence bonus
    bonusOBVDivUp:        true,
    // ATR — volatile stocks only
    minAtrPct14:          +(cMed('atrPct')-1.5 > 2 ? cMed('atrPct')-1.5 : 2).toFixed(1),
    maxAtrPct14:          +(cMed('atrPct')+4.0).toFixed(1),
    // Candle — close in upper half of bar
    minCloseLoc:          25,
    // Price flatness — consolidation
    maxPriceFlatPct5:     +(cMed('priceFlatPct5')+3).toFixed(1),
    // Stochastic — avoid extreme OB
    maxStochD1:           85,
    // Composite patterns (any one of these boosts confidence significantly)
    bonusPatterns:        'patSilentCoil | patNR4Bull | patOBVCoil | patInsideStack | patFlatTaper',
  };

  Object.entries(eliteParams).forEach(([k,v])=>console.log(`  ${k.padEnd(32)} ${JSON.stringify(v)}`));

  // Save
  const out = {
    generated: new Date().toISOString(),
    nCases: nCase, nControls: nCtrl,
    boolDiscrim, contDiscrim, topSeqs, topPairs: pairStats.slice(0,20),
    eliteParams, events: allEvents,
  };
  fs.mkdirSync(OUT_DIR, {recursive:true});
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const jp = path.join(OUT_DIR, `circuit_deep_dive_${stamp}.json`);
  fs.writeFileSync(jp, JSON.stringify(out,null,2));
  console.log(`\n  Saved → ${jp}\n`);

  return out;
}

if (isMainThread) {
  main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
} else {
  collectWorker().catch(e=>{parentPort.postMessage({type:'error',error:e.stack||String(e)});});
}
