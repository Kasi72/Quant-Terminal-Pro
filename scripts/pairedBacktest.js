// Paired Advanced Feature + Entry Formula Backtest — FAST VERSION
// Pre-computes all features in a single O(n) or O(n log n) pass per stock.
// Usage: node scripts/pairedBacktest.js

'use strict';
const fs   = require('fs');
const path = require('path');

const CSV_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_BARS  = 100;
const TRIG_WIN  = 5;
const FWD       = [5, 10, 20];
const MOM_THRESH = 5.0;

// ── CSV ───────────────────────────────────────────────────────────────────────
const MO = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function loadCSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const h=+p[2], l=+p[3], c=+p[4], o=+p[1];
    if (!isFinite(c)||c<=0||!isFinite(h)||!isFinite(l)||h<l) continue;
    bars.push({o:+p[1],h,l,c,v:+p[5]});
  }
  return bars;
}

// ── ATR14 ─────────────────────────────────────────────────────────────────────
function buildATR14(b) {
  const a = new Float64Array(b.length);
  for (let i=1;i<b.length;i++) {
    const tr = Math.max(b[i].h-b[i].l, Math.abs(b[i].h-b[i-1].c), Math.abs(b[i].l-b[i-1].c));
    a[i] = i===1 ? tr : (a[i-1]*13+tr)/14;
  }
  return a;
}

// ── FER pre-computed (20-bar) ─────────────────────────────────────────────────
function buildFER(b) {
  const fer = new Float64Array(b.length).fill(NaN);
  for (let i=20;i<b.length;i++) {
    const net = Math.abs(b[i].c - b[i-20].c);
    let path = 0;
    for (let j=i-19;j<=i;j++) path += Math.abs(b[j].c - b[j-1].c);
    fer[i] = path>0 ? net/path : 0;
  }
  return fer;
}

// ── ROC20 pre-computed ────────────────────────────────────────────────────────
function buildROC20(b) {
  const r = new Float64Array(b.length).fill(NaN);
  for (let i=20;i<b.length;i++) r[i] = b[i-20].c>0 ? (b[i].c/b[i-20].c-1)*100 : NaN;
  return r;
}

// ── TRAM pre-computed (60-bar CVaR) ──────────────────────────────────────────
function buildTRAM(b) {
  const tram = new Float64Array(b.length).fill(NaN);
  for (let i=60;i<b.length;i++) {
    const rets = [];
    for (let j=i-59;j<=i;j++) if(b[j-1].c>0) rets.push((b[j].c-b[j-1].c)/b[j-1].c*100);
    if (rets.length<10) continue;
    rets.sort((a,c)=>a-c);
    const cut = Math.max(1,Math.floor(rets.length*0.05));
    const cvar = rets.slice(0,cut).reduce((s,x)=>s+x,0)/cut;
    const roc20 = b[i-20].c>0 ? (b[i].c/b[i-20].c-1)*100 : 0;
    tram[i] = Math.abs(cvar)>0.001 ? roc20/Math.abs(cvar) : 0;
  }
  return tram;
}

// ── MWC pre-computed ──────────────────────────────────────────────────────────
function buildMWC(b) {
  const mwc = new Int8Array(b.length).fill(-1);
  for (let i=60;i<b.length;i++) {
    const c=b[i].c;
    const r5  = b[i-5].c>0  ? (c/b[i-5].c -1)*100 : 0;
    const r20 = b[i-20].c>0 ? (c/b[i-20].c-1)*100 : 0;
    const r60 = b[i-60].c>0 ? (c/b[i-60].c-1)*100 : 0;
    const pb=b[i-8].c, pe=b[i-3].c;
    const sl = pb>0 && r5>(pe/pb-1)*100 ? 1 : 0;
    mwc[i] = (r5>r20?1:0)+(r20>r60?1:0)+(r5>0?1:0)+sl;
  }
  return mwc;
}

// ── CleanMom pre-computed ─────────────────────────────────────────────────────
function buildCleanMom(b) {
  const cm = new Float64Array(b.length).fill(NaN);
  for (let i=20;i<b.length;i++) {
    const roc20 = b[i-20].c>0 ? (b[i].c/b[i-20].c-1)*100 : 0;
    let peak=b[i-20].h, maxDD=0;
    for (let j=i-19;j<=i;j++){
      if(b[j].h>peak) peak=b[j].h;
      const dd=peak>0?(b[j].l-peak)/peak*100:0;
      if(dd<maxDD) maxDD=dd;
    }
    cm[i] = roc20+maxDD;
  }
  return cm;
}

// ── VRAM pre-computed — FAST O(n log n) per stock ────────────────────────────
// Key insight: the vol regime and regime-ROC distribution change slowly.
// We pre-compute ATR% for every bar, then for each bar compute VRAM using
// the fixed 120-bar sorted window (binary-insert maintains sorted order).

function bsearchLo(arr, len, v) {
  // count of elements strictly < v in arr[0..len-1]
  let lo=0, hi=len;
  while(lo<hi){ const m=(lo+hi)>>1; if(arr[m]<v) lo=m+1; else hi=m; }
  return lo;
}
function toReg(rank) { return rank<0.33?0:rank<0.67?1:2; } // 0=LOW,1=MID,2=HIGH

function buildVRAM(b) {
  const n = b.length;
  const vram = new Float64Array(n).fill(NaN);

  // pre-build atrPct array
  const atrPct = new Float64Array(n);
  let prev = b[0].c;
  for (let i=1;i<n;i++){
    const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-prev),Math.abs(b[i].l-prev));
    atrPct[i] = b[i].c>0 ? tr/b[i].c*100 : 0;
    prev = b[i].c;
  }

  // For each bar i, we need:
  // 1. A sorted 120-bar window of atrPct[i-120..i-1] → determines vol regime of bar i
  // 2. All ROC20 samples from bars j<i where toReg(rank of atrPct[j-1] in same sorted window) == curReg
  //    → mean & std → z-score of current ROC20
  //
  // Full O(n²) version is too slow. Fast approach:
  // Pre-compute regime label for each bar (use growing sorted array up to 120).
  // Then for each i, compute mean/std of ROC20 for each regime on-the-fly
  // using running accumulators (sum, sum², count) split by regime.
  // This reduces to O(n) per stock (excluding the sort, which is O(n log n) total).

  // sorted window (insertion-maintained, up to 120)
  const WIN = 120;
  const sortBuf = new Float64Array(WIN);
  let sortLen = 0;

  // running accumulators for 3 regimes: sum, sum2, count (for bars that have ROC20)
  const rSum  = [0,0,0], rSum2 = [0,0,0], rCnt = [0,0,0];
  // also store regime label per bar
  const regLabel = new Int8Array(n).fill(-1);

  // insertion into sorted buffer (maintain sorted order)
  function insert(v) {
    if (sortLen < WIN) {
      // find position
      let pos = sortLen;
      while (pos>0 && sortBuf[pos-1]>v) { sortBuf[pos]=sortBuf[pos-1]; pos--; }
      sortBuf[pos]=v; sortLen++;
    } else {
      // evict oldest: just rebuild (small, ≤120 elements) — still O(WIN) per bar → O(n*WIN) total
      // For 120-bar window this is fine: 1617 * 500 * 120 = ~97M ops, fast in JS
      // Actually we need sliding window eviction. Use a simple approach:
      // Since WIN=120 and we evict the element that entered 120 steps ago,
      // store a circular buffer for the raw values and re-sort every step.
      // This is O(WIN log WIN) per bar; total O(n * WIN * log(WIN)) ≈ 1617*500*120*7 ≈ 680M → too slow.
      // Instead: just rebuild sortBuf from scratch using the raw values in the window.
      // We'll keep a raw circular buffer for the window.
      return false; // signal: use raw rebuild
    }
    return true;
  }

  // Use a raw circular buffer for the 120-bar window and sort on demand
  const rawWin = new Float64Array(WIN);
  let rawHead = 0, rawLen = 0;

  function pushRaw(v) {
    rawWin[rawHead % WIN] = v;
    rawHead++;
    if (rawLen < WIN) rawLen++;
  }
  function getSorted() {
    const slice = rawLen < WIN ? rawWin.slice(0, rawLen) : rawWin.slice();
    return slice.sort();
  }

  // Running accumulators for ROC20 per regime (updated as we advance i)
  // At bar i, the "historical" distribution for z-score uses bars 20..i-1.
  // We add bar j's ROC20 to the accumulator for regime(j) after we pass bar j.

  for (let i=1;i<n;i++) {
    pushRaw(atrPct[i]);
    if (i < 80) continue;

    const sorted = getSorted();
    const sLen = sorted.length;
    const rank = bsearchLo(sorted, sLen, atrPct[i]) / sLen;
    const reg  = toReg(rank);
    regLabel[i] = reg;

    // Update accumulator: bar i-1 now has ROC20 known (it's b[i-1] roc20)
    // Actually we add bar i-20 to accumulator when we pass bar i (so it goes into history)
    if (i >= 21 && regLabel[i-20] >= 0) {
      const r20 = b[i-20-20] && b[i-20-20].c>0 ? (b[i-20].c/b[i-20-20].c-1)*100 : null;
      // Hmm this is getting complex. Simpler: just use a direct approach per bar below.
    }

    // --- Direct approach for correctness: compute mean/std from all historical bars in same regime
    // Cap history window at 200 bars to stay fast (still O(200) per bar)
    const HIST_WIN = 200;
    const histStart = Math.max(20, i - HIST_WIN);
    const rocs = [];
    for (let j = histStart; j < i; j++) {
      if (regLabel[j] === reg && j>=20 && b[j-20].c>0) {
        rocs.push((b[j].c/b[j-20].c-1)*100);
      }
    }
    if (rocs.length < 10) continue;
    const mu  = rocs.reduce((s,x)=>s+x,0)/rocs.length;
    const sig = Math.sqrt(rocs.reduce((s,x)=>s+(x-mu)**2,0)/(rocs.length-1));
    if (sig <= 0) continue;
    const roc20 = b[i-20].c>0 ? (b[i].c/b[i-20].c-1)*100 : NaN;
    if (!isFinite(roc20)) continue;
    vram[i] = (roc20 - mu) / sig;
  }
  return vram;
}

// ── Accumulator ───────────────────────────────────────────────────────────────
function acc() { return {n:0,trig:0,miss:0,h:{5:0,10:0,20:0}}; }

function record(a, bars, trigBar, entryPrice, n) {
  a.trig++;
  for (const fwd of FWD) {
    const end = trigBar+fwd;
    if (end >= n) continue;
    let maxH = 0;
    for (let f=trigBar;f<=end;f++) maxH = Math.max(maxH, bars[f].h);
    if ((maxH-entryPrice)/entryPrice*100 >= MOM_THRESH) a.h[fwd]++;
  }
}

// ── Combo definitions ─────────────────────────────────────────────────────────
const COMBOS = [
  { name: 'Unfiltered (ATR entry)',           f: ()=> true },
  { name: 'FER ≥0.55 only',                  f: (fe)=> fe>=0.55 },
  { name: 'VRAM <−1.1 only',                 f: (_,v)=> v<-1.1 },
  { name: 'TRAM <−3.0 only',                 f: (_,__,t)=> t<-3.0 },
  { name: 'MWC ≤1 only',                     f: (_,__,___,m)=> m<=1 },
  { name: 'CleanMom <−28 only',              f: (_,__,___,____,c)=> c<-28 },
  { name: 'FER + VRAM',                      f: (fe,v)=> fe>=0.55 && v<-1.1 },
  { name: 'FER + TRAM',                      f: (fe,_,t)=> fe>=0.55 && t<-3.0 },
  { name: 'FER + MWC',                       f: (fe,_,__,m)=> fe>=0.55 && m<=1 },
  { name: 'VRAM + TRAM',                     f: (_,v,t)=> v<-1.1 && t<-3.0 },
  { name: 'VRAM + MWC',                      f: (_,v,__,m)=> v<-1.1 && m<=1 },
  { name: 'VRAM + CleanMom',                 f: (_,v,__,___,c)=> v<-1.1 && c<-28 },
  { name: 'FER + VRAM + MWC',               f: (fe,v,_,m)=> fe>=0.55 && v<-1.1 && m<=1 },
  { name: 'FER + VRAM + TRAM',              f: (fe,v,t)=> fe>=0.55 && v<-1.1 && t<-3.0 },
  { name: 'FER + VRAM + CleanMom',          f: (fe,v,_,__,c)=> fe>=0.55 && v<-1.1 && c<-28 },
  { name: 'VRAM + TRAM + MWC',              f: (_,v,t,m)=> v<-1.1 && t<-3.0 && m<=1 },
  { name: 'FER + VRAM + TRAM + MWC',       f: (fe,v,t,m)=> fe>=0.55 && v<-1.1 && t<-3.0 && m<=1 },
  { name: 'FER + VRAM + TRAM + CM',        f: (fe,v,t,_,c)=> fe>=0.55 && v<-1.1 && t<-3.0 && c<-28 },
  { name: 'VRAM + TRAM + CleanMom',        f: (_,v,t,__,c)=> v<-1.1 && t<-3.0 && c<-28 },
  { name: 'ALL 5',                          f: (fe,v,t,m,c)=> fe>=0.55 && v<-1.1 && t<-3.0 && m<=1 && c<-28 },
];

const accs  = COMBOS.map(()=>acc());
const bench = {n:0,h:{5:0,10:0,20:0}};

// ── Main ─────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(CSV_DIR).filter(f=>f.endsWith('.csv'));
process.stdout.write(`Processing ${files.length} stocks...\n`);

for (let fi=0;fi<files.length;fi++) {
  if (fi%100===0) process.stdout.write(`  ${fi}/${files.length}\r`);
  const bars = loadCSV(path.join(CSV_DIR, files[fi]));
  if (bars.length < MIN_BARS+30) continue;
  const n    = bars.length;
  const atrs = buildATR14(bars);
  const ferA = buildFER(bars);
  const tramA= buildTRAM(bars);
  const mwcA = buildMWC(bars);
  const cmA  = buildCleanMom(bars);
  const vramA= buildVRAM(bars);   // O(n * HIST_WIN) — bounded, fast

  for (let si=MIN_BARS; si<n-20-TRIG_WIN; si++) {
    const bar = bars[si], atr = atrs[si];
    if (atr<=0||bar.c<=0) continue;

    // benchmark
    bench.n++;
    for (const fwd of FWD) {
      const end=si+1+fwd; if(end>=n) continue;
      let maxH=0; for(let f=si+1;f<=end;f++) maxH=Math.max(maxH,bars[f].h);
      if((maxH-bar.c)/bar.c*100>=MOM_THRESH) bench.h[fwd]++;
    }

    const entry = bar.h + 0.75*atr;
    let trigBar = -1;
    for (let t=si+1;t<=si+TRIG_WIN&&t<n;t++) { if(bars[t].h>=entry){trigBar=t;break;} }

    const fe = ferA[si],  v = vramA[si];
    const t  = tramA[si], m = mwcA[si], c = cmA[si];
    const feOK = isFinite(fe), vOK = isFinite(v), tOK = isFinite(t);
    const mOK  = m>=0,         cOK = isFinite(c);

    for (let ci=0;ci<COMBOS.length;ci++) {
      const fer_v  = feOK ? fe : NaN;
      const vram_v = vOK  ? v  : 999;   // 999 = no data → won't pass <-1.1
      const tram_v = tOK  ? t  : 999;
      const mwc_v  = mOK  ? m  : -1;   // -1 = no data → won't pass <=1
      const cm_v   = cOK  ? c  : 999;

      // skip if any required feature has no data (pass=false naturally)
      const pass = COMBOS[ci].f(fer_v, vram_v, tram_v, mwc_v, cm_v);
      if (!pass) continue;
      accs[ci].n++;
      if (trigBar<0) { accs[ci].miss++; continue; }
      record(accs[ci], bars, trigBar, entry, n);
    }
  }
}
process.stdout.write(`\nDone.\n\n`);

// ── Print ─────────────────────────────────────────────────────────────────────
const base20 = bench.h[20]/bench.n*100;
const base5  = bench.h[5] /bench.n*100;
const base10 = bench.h[10]/bench.n*100;

function wr(a, fwd) { return a.trig>0?(a.h[fwd]/a.trig*100).toFixed(2)+'%':'n/a'; }
function edg(a, fwd, base) {
  if (!a.trig) return 'n/a';
  const e=(a.h[fwd]/a.trig*100)-base;
  return (e>=0?'+':'')+e.toFixed(2)+'pp';
}

const W=122;
console.log('═'.repeat(W));
console.log('  PAIRED BACKTEST: Advanced Features + ATR Buy Entry  (entry = High + 0.75×ATR14)');
console.log(`  Benchmark (enter at close, no filter): WR5=${base5.toFixed(2)}%  WR10=${base10.toFixed(2)}%  WR20=${base20.toFixed(2)}%`);
console.log('═'.repeat(W));
console.log('  '+
  'Filter Combo'.padEnd(36)+
  'Signals'.padStart(10)+'Triggered'.padStart(11)+'TrigRate'.padStart(10)+
  'WR5%'.padStart(9)+'WR10%'.padStart(9)+'WR20%'.padStart(9)+'Edge20'.padStart(10));
console.log('  '+'-'.repeat(W-2));

for (let ci=0;ci<COMBOS.length;ci++) {
  const a=accs[ci];
  const tr=(a.trig+a.miss)>0?((a.trig/(a.trig+a.miss))*100).toFixed(1)+'%':'n/a';
  const e20 = a.trig>0?(a.h[20]/a.trig*100)-base20:null;
  const star = e20===null?'':e20>=3?' ◀★★':e20>=2?' ◀★':e20>=1?' ◀':'';
  console.log('  '+
    COMBOS[ci].name.padEnd(36)+
    String(a.n).padStart(10)+String(a.trig).padStart(11)+tr.padStart(10)+
    wr(a,5).padStart(9)+wr(a,10).padStart(9)+wr(a,20).padStart(9)+
    edg(a,20,base20).padStart(10)+star);
}
console.log('  '+'-'.repeat(W-2));
console.log('  '+
  'BENCHMARK (no filter, close)'.padEnd(36)+
  String(bench.n).padStart(10)+'—'.padStart(11)+'100%'.padStart(10)+
  base5.toFixed(2).padStart(8)+'%'+base10.toFixed(2).padStart(8)+'%'+base20.toFixed(2).padStart(8)+'%'+
  '0.00pp'.padStart(10));

// rank by WR20
console.log('\n\nTop combos by 20d win rate (≥50 triggered):\n');
const ranked = COMBOS.map((c,i)=>({...c, a:accs[i]}))
  .filter(x=>x.a.trig>=50)
  .map(x=>({name:x.name, wr20:x.a.h[20]/x.a.trig*100, trig:x.a.trig, n:x.a.n}))
  .sort((a,b)=>b.wr20-a.wr20);
ranked.slice(0,12).forEach((r,i)=>{
  const e=(r.wr20-base20).toFixed(2);
  console.log(`  #${String(i+1).padStart(2)}  ${r.name.padEnd(38)} WR20=${r.wr20.toFixed(2)}%  Edge=+${e}pp  N=${r.trig.toLocaleString()} triggered`);
});
