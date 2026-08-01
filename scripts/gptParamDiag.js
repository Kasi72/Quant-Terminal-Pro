'use strict';
/**
 * Diagnostic: counts how many bars pass each condition for a single archetype.
 * Helps identify which filter is too strict or miscalculated.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const WINDOW   = 300;
const MIN_TURN = 5_000_000;

const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p[0].length === 4) return Date.UTC(+p[0], +p[1]-1, +p[2]);
    const m = MON[p[1]]; if (m !== undefined) return Date.UTC(+p[2], m, +p[0]);
  }
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(','); if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts: parseNSEDate(p[0]), o: +p[1], h: +p[2], l: +p[3], c, v: +p[5] || 0 });
  }
  return out;
}

// ── Indicators ──
function computeEMAArr(candles, period) {
  const alpha = 2 / (period + 1), out = new Array(candles.length).fill(0);
  let ema = candles[0].c;
  for (let i = 0; i < candles.length; i++) { ema = alpha*candles[i].c + (1-alpha)*ema; out[i] = ema; }
  return out;
}
function computeATR14Arr(candles) {
  const out = new Array(candles.length).fill(0);
  let atr = candles[0].h - candles[0].l;
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
    atr = atr/14*13 + tr/14; out[i] = atr;
  }
  out[0] = out[1] || (candles[0].h-candles[0].l); return out;
}
function computeRSIArr(candles, period) {
  const out = new Array(candles.length).fill(50);
  let aG = 0, aL = 0;
  for (let i = 1; i <= period; i++) { const d = candles[i].c - candles[i-1].c; if (d>0) aG+=d; else aL-=d; }
  aG/=period; aL/=period;
  for (let i = period; i < candles.length; i++) {
    if (i > period) { const d = candles[i].c-candles[i-1].c; const g=d>0?d:0, l=d<0?-d:0; aG=aG*(period-1)/period+g/period; aL=aL*(period-1)/period+l/period; }
    out[i] = aL > 0 ? 100 - 100/(1+aG/aL) : (aG>0?100:50);
  }
  return out;
}
function computeDMIArr(candles, period) {
  const n = candles.length;
  const diPlus = new Array(n).fill(0), diMinus = new Array(n).fill(0), adx = new Array(n).fill(0);
  let smP=0, smM=0, smTR=0, smDX=0; let adxInit=false;
  for (let i = 1; i < n; i++) {
    const c=candles[i],p=candles[i-1];
    const uM=c.h-p.h, dM=p.l-c.l;
    const pDM=uM>dM&&uM>0?uM:0, mDM=dM>uM&&dM>0?dM:0;
    const tr=Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c));
    if (i < period) { smP+=pDM; smM+=mDM; smTR+=tr; }
    else {
      smP=smP-smP/period+pDM; smM=smM-smM/period+mDM; smTR=smTR-smTR/period+tr;
      const diP=smTR>0?smP/smTR*100:0, diM=smTR>0?smM/smTR*100:0;
      diPlus[i]=diP; diMinus[i]=diM;
      const dx=(diP+diM)>0?Math.abs(diP-diM)/(diP+diM)*100:0;
      if (!adxInit){smDX=dx;adxInit=true;} else smDX=smDX*(period-1)/period+dx/period;
      adx[i]=smDX;
    }
  }
  return { diPlus, diMinus, adx };
}

function cmf20(candles, i) {
  const n = Math.min(20, i+1); let mfv=0, vol=0;
  for (let j=i-n+1; j<=i; j++) { const b=candles[j],r=b.h-b.l; const mf=r>0?((b.c-b.l)-(b.h-b.c))/r*b.v:0; mfv+=mf; vol+=b.v; }
  return vol>0?mfv/vol:0;
}

// OBV slope — raw units normalised by recent vol avg (same as engine)
function obvSlope10(candles, i) {
  const start = Math.max(1, i-10);
  let obv = 0;
  for (let j = start; j <= i; j++) {
    const d = candles[j].c - candles[j-1].c;
    obv += d > 0 ? candles[j].v : d < 0 ? -candles[j].v : 0;
  }
  // slope = cumulative OBV over 10 bars relative to avg daily volume
  let vSum = 0, vCnt = 0;
  for (let j = Math.max(0, i-20); j < i; j++) { vSum += candles[j].v; vCnt++; }
  const vAvg = vCnt > 0 ? vSum / vCnt : 1;
  return vAvg > 0 ? obv / (vAvg * 10) : 0;
}

function volAvg20(candles, i) {
  let s=0,n=0; for (let j=Math.max(0,i-20);j<i;j++){s+=candles[j].v;n++;} return n>0?s/n:0;
}
function turnover20(candles, i) {
  let s=0,n=0; for (let j=Math.max(0,i-20);j<i;j++){s+=candles[j].c*candles[j].v;n++;} return n>0?s/n:0;
}
function barsSinceDICross(diPlus, diMinus, i, lookback) {
  // Check TODAY first (b=0)
  if (i >= 1 && diPlus[i] > diMinus[i] && diPlus[i-1] <= diMinus[i-1]) return 0;
  for (let b=1; b<=lookback; b++) {
    const j=i-b; if (j<1) break;
    if (diPlus[j]>diMinus[j] && diPlus[j-1]<=diMinus[j-1]) return b;
  }
  return 99;
}
function hi20excl(candles, i) { let h=0; for (let j=Math.max(0,i-20);j<i;j++) if (candles[j].h>h) h=candles[j].h; return h; }

// ── Diagnostic: sample N symbols, count bars passing each VolumeFootprint condition ──
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
  .map(f => path.join(DATA_DIR, f));

// Sample 200 symbols for speed
const sampleFiles = allFiles.sort(() => Math.random()-0.5).slice(0, 200);

const cnts = {
  bars:        0,
  turnOk:      0,
  green:        0,
  volRatio5:   0,
  closeLoc60:  0,
  upperWick25: 0,
  hi20_82:     0,
  rangeATR3:   0,
  noGapDown:   0,
  cmf015:      0,
  obvSlope05:  0,
  closeAbvEMA20: 0,
  ema20AbvEMA50: 0,
  diBull:       0,
  bsc3:         0,
  adx45:        0,
  ALL_VF:      0,
};

// Also collect raw value distributions
const adxSamples = [], obvSamples = [], cmfSamples = [], bscSamples = [], volRatioSamples = [];

console.log(`Diagnosing VolumeFootprint GPT conditions on ${sampleFiles.length} symbols...\n`);

for (const fp of sampleFiles) {
  const candles = parseNSE(fp);
  if (candles.length < WINDOW + 25) continue;

  const atr14Arr = computeATR14Arr(candles);
  const ema20Arr = computeEMAArr(candles, 20);
  const ema50Arr = computeEMAArr(candles, 50);
  const dmi      = computeDMIArr(candles, 14);

  for (let i = WINDOW; i < candles.length - 5; i++) {
    if (turnover20(candles, i) < MIN_TURN) continue;
    cnts.bars++;

    const sig   = candles[i];
    const prev  = candles[i-1];
    const range = sig.h - sig.l;
    if (range <= 0) continue;

    const vAvg      = volAvg20(candles, i);
    const volRatio  = vAvg > 0 ? sig.v / vAvg : 0;
    const closeLoc  = (sig.c - sig.l) / range * 100;
    const upperWick = (sig.h - Math.max(sig.o,sig.c)) / range * 100;
    const hi20      = hi20excl(candles, i);
    const rangeATR  = atr14Arr[i] > 0 ? range / atr14Arr[i] : 0;
    const noGapDown = sig.o >= prev.c;
    const cmfV      = cmf20(candles, i);
    const obvV      = obvSlope10(candles, i);
    const ema20     = ema20Arr[i];
    const ema50     = ema50Arr[i];
    const adxV      = dmi.adx[i];
    const bsc       = barsSinceDICross(dmi.diPlus, dmi.diMinus, i, 10);

    // collect distributions (sample 1 in 20)
    if (i % 20 === 0) {
      adxSamples.push(adxV);
      if (sig.c >= sig.o) { // green only
        obvSamples.push(obvV);
        cmfSamples.push(cmfV);
        bscSamples.push(bsc);
        volRatioSamples.push(volRatio);
      }
    }

    const isGreen = sig.c >= sig.o;
    if (!isGreen) continue;
    cnts.green++;
    if (volRatio < 5) continue; cnts.volRatio5++;
    if (closeLoc < 60) continue; cnts.closeLoc60++;
    if (upperWick > 25) continue; cnts.upperWick25++;
    if (!hi20 || sig.c < hi20 * 0.82) continue; cnts.hi20_82++;
    if (rangeATR < 3) continue; cnts.rangeATR3++;
    if (!noGapDown) continue; cnts.noGapDown++;
    if (cmfV < 0.15) continue; cnts.cmf015++;
    if (obvV < 0.5) continue; cnts.obvSlope05++;
    if ((sig.c/ema20-1)*100 < 0) continue; cnts.closeAbvEMA20++;
    if ((ema20/ema50-1)*100 < 0) continue; cnts.ema20AbvEMA50++;
    if (dmi.diPlus[i] <= dmi.diMinus[i]) continue; cnts.diBull++;
    if (bsc > 3) continue; cnts.bsc3++;
    if (adxV < 45) continue; cnts.adx45++;
    cnts.ALL_VF++;
  }
}

console.log('=== VolumeFootprint GPT — Condition Funnel ===');
console.log(`Total bars (after turnover):  ${cnts.bars}`);
console.log(`Green candles:                ${cnts.green}  (${(cnts.green/cnts.bars*100).toFixed(1)}%)`);
console.log(`+ volRatio ≥ 5:              ${cnts.volRatio5}  (${(cnts.volRatio5/cnts.green*100).toFixed(1)}% of green)`);
console.log(`+ closeLoc ≥ 60:             ${cnts.closeLoc60}`);
console.log(`+ upperWick ≤ 25:            ${cnts.upperWick25}`);
console.log(`+ hi20 ≥ 82%:               ${cnts.hi20_82}`);
console.log(`+ rangeATR ≥ 3:             ${cnts.rangeATR3}`);
console.log(`+ noGapDown:                 ${cnts.noGapDown}`);
console.log(`+ CMF20 ≥ 0.15:             ${cnts.cmf015}`);
console.log(`+ OBVslope ≥ 0.5:           ${cnts.obvSlope05}`);
console.log(`+ close > EMA20:             ${cnts.closeAbvEMA20}`);
console.log(`+ EMA20 > EMA50:             ${cnts.ema20AbvEMA50}`);
console.log(`+ DI+ > DI-:                 ${cnts.diBull}`);
console.log(`+ maxBsc ≤ 3:               ${cnts.bsc3}`);
console.log(`+ ADX ≥ 45:                 ${cnts.adx45}`);
console.log(`= SIGNALS:                   ${cnts.ALL_VF}`);

// Distribution of key values (sampled, green bars only)
function pctiles(arr, p) {
  const s = [...arr].sort((a,b)=>a-b);
  return p.map(pct => s[Math.min(Math.floor(s.length*pct/100), s.length-1)]?.toFixed(2) ?? 'N/A');
}

console.log('\n=== Key Value Distributions (sample, green bars) ===');
if (adxSamples.length) {
  const [p25,p50,p75,p90,p95] = pctiles(adxSamples,[25,50,75,90,95]);
  console.log(`ADX14: p25=${p25}  p50=${p50}  p75=${p75}  p90=${p90}  p95=${p95}  (need ≥45)`);
}
if (obvSamples.length) {
  const [p10,p25,p50,p75,p90] = pctiles(obvSamples,[10,25,50,75,90]);
  console.log(`OBVslope: p10=${p10}  p25=${p25}  p50=${p50}  p75=${p75}  p90=${p90}  (need ≥0.5)`);
}
if (cmfSamples.length) {
  const [p25,p50,p75,p90] = pctiles(cmfSamples,[25,50,75,90]);
  console.log(`CMF20: p25=${p25}  p50=${p50}  p75=${p75}  p90=${p90}  (need ≥0.15)`);
}
if (bscSamples.length) {
  const bscHist = {};
  for (const b of bscSamples) { const k = Math.min(b, 99); bscHist[k] = (bscHist[k]||0)+1; }
  const total = bscSamples.length;
  const pct = (k) => ((bscHist[k]||0)/total*100).toFixed(1);
  console.log(`BSC dist (DI+ cross recency): bsc=0: ${pct(0)}%  bsc=1: ${pct(1)}%  bsc=2: ${pct(2)}%  bsc=3: ${pct(3)}%  bsc≥4: ${(bscSamples.filter(b=>b>3).length/total*100).toFixed(1)}%  bsc=99: ${pct(99)}%`);
}
if (volRatioSamples.length) {
  const [p75,p90,p95,p99] = pctiles(volRatioSamples,[75,90,95,99]);
  console.log(`VolRatio: p75=${p75}  p90=${p90}  p95=${p95}  p99=${p99}  (need ≥5)`);
}
