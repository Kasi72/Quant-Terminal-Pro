// ══════════════════════════════════════════════════════════════════════════════
// HP15 REGIME FILTER — Build + Validate
// ══════════════════════════════════════════════════════════════════════════════
//
// Regime gate (≥2 of 3 conditions required to allow an HP15 signal):
//   R1: Nifty 50 close  >  50-day EMA           (trending up)
//   R2: India VIX       <  70th percentile       (not panic-fear)
//   R3: Nifty 20-day return > 0                  (positive momentum)
//
// Signals before 2016-06-27 (no index/VIX data) → allowed through by default.
//
// Output:
//   • Regime calendar: fraction of days each condition fires
//   • HP15 baseline vs HP15+Regime — IS/OOS, WF folds, per-year, exit model
//   • Net improvement in WR and P&L
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const NIFTY_FILE = 'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv';
const VIX_FILE   = 'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/indiavix_daily.csv';
const DATA_DIRS  = [
  'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV',
  'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX',
];

// ─── HP15 EXACT PARAMS (from lib/stockEngine.ts) ─────────────────────────────
const HP15 = {
  minAvgTurnover20: 10e6, maxATRPct14Pctl120: 85,
  maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
  zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 8.0,
  maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
  maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
  minExactRangeATR14: 1.5, maxExactRangeATR14: 5.0,
  minExactVolRatio20: 1.5, minExactVolVsPre5: 2.5,
  minCloseLoc: 55, maxUpperWickPct: 40, minBodyPct: 20, maxCandleRisk: 10.0,
  minUltraPrecisionScore: 50, minRSI2: 50,
  minVolatilityExpansionRatio: 0.75, minCandleQualityScore: null, maxCloseAboveZonePct: 6.0,
};

// ─── STEP 1: BUILD REGIME MAP ─────────────────────────────────────────────────
function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 5 || isNaN(+p[4]) || +p[4] <= 0) continue;
    rows.push({ d: p[0].trim(), o: +p[1], h: +p[2], l: +p[3], c: +p[4] });
  }
  return rows;
}

function ema(arr, period) {
  const e = new Array(arr.length).fill(0);
  const k = 2 / (period + 1);
  e[period - 1] = arr.slice(0, period).reduce((s,v)=>s+v,0) / period;
  for (let i = period; i < arr.length; i++) e[i] = arr[i] * k + e[i-1] * (1-k);
  return e;
}

function buildRegimeMap() {
  const nifty = parseCSV(NIFTY_FILE);
  const vix   = parseCSV(VIX_FILE);

  // Nifty: 50-day EMA, 20-day return
  const nClose = nifty.map(r => r.c);
  const ema50  = ema(nClose, 50);

  // VIX: 252-day rolling percentile
  const vClose = vix.map(r => r.c);
  const vixMap = new Map(vix.map(r => [r.d, r.c]));

  // Build regime map indexed by date string
  const regimeMap = new Map();

  for (let i = 50; i < nifty.length; i++) {
    const d = nifty[i].d;

    // R1: Nifty above 50-EMA
    const r1 = nifty[i].c > ema50[i];

    // R3: 20-day momentum (close vs 20 days ago)
    const r3 = i >= 20 ? nifty[i].c > nifty[i-20].c : true;

    // R2: VIX < 70th pctl of trailing 252 days
    const vixToday = vixMap.get(d);
    let r2 = true; // default: allow if VIX data missing for this date
    if (vixToday !== undefined) {
      // Find VIX values for last 252 trading days
      const vixVals = [];
      let vi = vix.findIndex(v => v.d === d);
      if (vi < 0) {
        // binary search-style: find closest date
        for (let k = 0; k < vix.length; k++) if (vix[k].d <= d) vi = k;
      }
      if (vi >= 0) {
        for (let k = Math.max(0, vi - 252); k < vi; k++) vixVals.push(vix[k].c);
        if (vixVals.length >= 50) {
          const sorted = [...vixVals].sort((a,b) => a-b);
          const pct70  = sorted[Math.floor(sorted.length * 0.70)];
          r2 = vixToday < pct70;
        }
      }
    }

    const score = (r1?1:0) + (r2?1:0) + (r3?1:0);
    regimeMap.set(d, { r1, r2, r3, score, active: score >= 2 });
  }

  // Stats
  let total = 0, active = 0, r1c = 0, r2c = 0, r3c = 0;
  for (const [,v] of regimeMap) {
    total++; if (v.active) active++;
    if (v.r1) r1c++; if (v.r2) r2c++; if (v.r3) r3c++;
  }
  console.log(`Regime map: ${total} days  |  Active (≥2/3): ${active} (${(active/total*100).toFixed(0)}%)`);
  console.log(`  R1 (N50>EMA50): ${(r1c/total*100).toFixed(0)}%  |  R2 (VIX<70pctl): ${(r2c/total*100).toFixed(0)}%  |  R3 (mom>0): ${(r3c/total*100).toFixed(0)}%\n`);

  return regimeMap;
}

// ─── DATE NORMALIZATION ───────────────────────────────────────────────────────
// Stock CSVs use "DD-Mon-YYYY" (e.g. "29-Jun-2021")
// Nifty/VIX CSVs use "YYYY-MM-DD"
// We must normalise stock dates → YYYY-MM-DD for regime lookup.
const MON = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
              Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
function normDate(d) {
  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // DD-Mon-YYYY
  const m = d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) return `${m[3]}-${MON[m[2]] || '01'}-${m[1].padStart(2,'0')}`;
  return d;
}

// ─── STOCK ENGINE HELPERS ─────────────────────────────────────────────────────
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++)
    s += Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
    a[i] = (a[i-1]*13 + tr) / 14;
  }
  return a;
}
function atrPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const cur = c[idx].c > 0 ? atr[idx]/c[idx].c*100 : 0;
  let below = 0;
  for (let j = idx-120; j < idx; j++)
    if (c[j].c > 0 && atr[j]/c[j].c*100 < cur) below++;
  return below/120*100;
}
function volAvg(c, idx, period) {
  let s=0,n=0; for(let j=Math.max(0,idx-period);j<idx;j++){s+=c[j].v;n++;} return n>0?s/n:1;
}
function findZone(c, atr, idx, p) {
  const zC=[];
  for(let j=idx-1;j>=Math.max(0,idx-p.maxZoneLen);j--){
    if(atr[j]<=0)break; if((c[j].h-c[j].l)/atr[j]>p.zoneRangeATRThreshold)break; zC.unshift(j);
  }
  if(zC.length<p.minZoneLen)return null;
  let zH=-Infinity,zL=Infinity;
  for(const j of zC){zH=Math.max(zH,c[j].h);zL=Math.min(zL,c[j].l);}
  const zt=zL>0?(zH-zL)/zL*100:999;
  if(zt>p.maxZoneTightnessPct)return null;
  return{zoneHigh:zH,zoneLow:zL,zoneLen:zC.length,zt};
}
function calcUPS(cL,uW,bP,evp5,zt,zLen){
  let s=0;
  s+=cL>=80?20:cL>=65?12:0; s+=uW<=20?20:uW<=35?12:0; s+=bP>=55?15:bP>=35?9:0;
  s+=evp5>=4?20:evp5>=2?12:0; s+=zt<=5?15:zt<=15?9:0; s+=zLen>=12?10:zLen>=6?6:0;
  return s;
}
function calcCQS(cL,uW,bP,evp5,ver){
  let s=0;
  if(cL>=65)s++;if(uW<=30)s++;if(bP>=40)s++;if(evp5>=2.5)s++;if(ver>=1.5)s++;
  return s;
}
function rsi2(c,idx){
  if(idx<2)return 50;
  const ch1=c[idx].c-c[idx-1].c,ch2=c[idx-1].c-c[idx-2].c;
  const g=((ch1>0?ch1:0)+(ch2>0?ch2:0))/2;
  const l=((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
  return l<0.001?100:100-100/(1+g/l);
}
function screenHP15(c, atr, idx) {
  const s=c[idx]; if(!s||s.c<=0||atr[idx]<=0)return null;
  const p=HP15;
  let to=0; for(let j=idx-20;j<idx;j++)if(j>=0)to+=c[j].c*c[j].v;
  if(to/20<p.minAvgTurnover20)return null;
  if(atrPctl120(c,atr,idx)>p.maxATRPct14Pctl120)return null;
  let p10RS=0,p10N=0,expC=0;
  for(let j=idx-11;j<idx-1;j++){
    if(j<0||atr[j]<=0)continue;
    const ra=(c[j].h-c[j].l)/atr[j]; p10RS+=ra;p10N++;
    if(ra>p.expansionATRMultiplier)expC++;
  }
  const p10A=p10N>0?p10RS/p10N:999;
  if(p10A>p.maxPre10AvgRangeATR)return null;
  if(expC>p.maxPre10ExpansionCount)return null;
  const zone=findZone(c,atr,idx,p); if(!zone)return null;
  const v20=volAvg(c,idx,20);
  let p10VRS=0,p10VRN=0,p5VRS=0,p5VRN=0,hvC=0,redVol=0,greenVol=0;
  for(let j=idx-11;j<idx-1;j++){
    if(j<0)continue;
    const vr=v20>0?c[j].v/v20:0; p10VRS+=vr;p10VRN++;
    if(j>=idx-6){p5VRS+=vr;p5VRN++;}
    if(vr>p.highVolMultiplier)hvC++;
    if(c[j].c<c[j].o)redVol+=c[j].v; else greenVol+=c[j].v;
  }
  if(p10VRN>0&&p10VRS/p10VRN>p.maxPre10AvgVolRatio)return null;
  if(p5VRN>0&&p5VRS/p5VRN>p.maxPre5AvgVolRatio)return null;
  if(hvC>p.maxPre10HighVolCount)return null;
  const rvb=greenVol>0?redVol/greenVol:(redVol>0?10:1);
  if(rvb>p.maxPre10RedVolBias)return null;
  const rng=s.h-s.l; if(rng<=0)return null;
  const eRA=rng/atr[idx];
  const evr20=v20>0?s.v/v20:0;
  const v5=volAvg(c,idx,5); const evp5=v5>0?s.v/v5:0;
  const cL=(s.c-s.l)/rng*100;
  const uW=(s.h-Math.max(s.c,s.o))/rng*100;
  const bP=Math.abs(s.c-s.o)/rng*100;
  if(s.c<=zone.zoneHigh*1.001)return null;
  if(eRA<p.minExactRangeATR14||eRA>p.maxExactRangeATR14)return null;
  if(evr20<p.minExactVolRatio20)return null;
  if(evp5<p.minExactVolVsPre5)return null;
  if(cL<p.minCloseLoc)return null;
  if(uW>p.maxUpperWickPct)return null;
  if(bP<p.minBodyPct)return null;
  if(rng/s.c*100>p.maxCandleRisk)return null;
  const ver=p10A>0?eRA/p10A:0;
  if(ver<p.minVolatilityExpansionRatio)return null;
  const ups=calcUPS(cL,uW,bP,evp5,zone.zt,zone.zoneLen);
  if(ups<p.minUltraPrecisionScore)return null;
  if(rsi2(c,idx)<p.minRSI2)return null;
  if(p.minCandleQualityScore!=null&&calcCQS(cL,uW,bP,evp5,ver)<p.minCandleQualityScore)return null;
  if(p.maxCloseAboveZonePct!=null&&(s.c-zone.zoneHigh)/zone.zoneHigh*100>p.maxCloseAboveZonePct)return null;
  return{zone};
}
const tick=p=>Math.round(p/0.05)*0.05;
function gateCheck(stop,cd,prev,pp,candles,i){
  if(cd.c>stop)return'ABOVE';
  const dipPct=(stop-cd.c)/stop*100;
  if(dipPct<1.5)return'SHIELDED';
  if(i>=2){const ch1=cd.c-prev.c,ch2=prev.c-(pp?pp.c:prev.c);const g=((ch1>0?ch1:0)+(ch2>0?ch2:0))/2;const l=((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;if((l<0.001?100:100-100/(1+g/l))<5)return'SHIELDED';}
  if(prev&&prev.c>stop)return'SHIELDED';
  if(prev&&cd.c>=prev.c)return'SHIELDED';
  let avgV=0,vc=0;for(let vi=Math.max(0,i-20);vi<i;vi++){if(candles[vi]&&candles[vi].v>0){avgV+=candles[vi].v;vc++;}}avgV=vc>0?avgV/vc:0;
  if(cd.v!=null&&avgV>0&&cd.v<avgV*0.6)return'SHIELDED';
  const rng=cd.h-cd.l;
  if(rng>0&&(Math.min(cd.o,cd.c)-cd.l)/rng*100>=60)return'SHIELDED';
  if(cd.c>cd.o&&rng>0&&(cd.c-cd.o)/rng*100>=50)return'SHIELDED';
  if(rng>0&&(cd.c-cd.l)/rng*100>=45)return'SHIELDED';
  if(prev&&cd.c>prev.c&&cd.v>(prev.v||0))return'SHIELDED';
  if(prev&&pp){if(!(cd.c<cd.o&&prev.c<prev.o&&pp.c<pp.o))return'SHIELDED';}else return'SHIELDED';
  return'STOPPED';
}
function simulateTrade(c,atr,entryIdx,zone){
  const entry=c[entryIdx].c;
  const stopRaw=zone.zoneLow-0.50*atr[entryIdx];
  const floorStop=entry*(1-4.0/100),capStop=entry*(1-6.5/100);
  const stop=Math.min(Math.max(stopRaw,capStop),floorStop);
  const atrPct=atr[entryIdx]/entry*100;
  const t1Pct=Math.max(4,Math.min(12,2.15*atrPct));
  const t1=tick(entry*(1+t1Pct/100));
  const t2Pct=t1Pct+atrPct;
  const t2=tick(entry*(1+t2Pct/100));
  const t3BucketPct=atrPct<1.5?5:atrPct<=3?7:10;
  const t3Pct=Math.max(t3BucketPct,t2Pct+1.5*atrPct);
  const t3=tick(Math.max(entry*(1+t3Pct/100),t2+0.05));
  let pos=1,pnl=0,mfe=0,mae=0,status='expired',exitDay=0,trail=stop,t1H=false,t2H=false;
  for(let d=1;d<=Math.min(20,c.length-entryIdx-1);d++){
    const ci=entryIdx+d;if(ci>=c.length)break;
    const cd=c[ci],prev=c[ci-1],pp=ci>=2?c[ci-2]:null;
    const hP=(cd.h-entry)/entry*100,lP=(cd.l-entry)/entry*100;
    if(hP>mfe)mfe=hP;if(lP<mae)mae=lP;
    if(!t1H&&cd.h>=t1&&pos>0){pnl+=0.50*(t1-entry)/entry*100;pos-=0.50;t1H=true;trail=entry;}
    if(t1H&&!t2H&&cd.h>=t2&&pos>0){pnl+=0.30*(t2-entry)/entry*100;pos-=0.30;t2H=true;trail=t1;}
    if(t2H&&cd.h>=t3&&pos>0){pnl+=pos*(t3-entry)/entry*100;status='hit_t3';exitDay=d;pos=0;break;}
    if(cd.c<=trail&&pos>0){
      const g=gateCheck(trail,cd,prev,pp,c.slice(entryIdx),d);
      if(g==='STOPPED'){pnl+=pos*(cd.c-entry)/entry*100;status='stopped';exitDay=d;pos=0;break;}
    }
  }
  if(pos>0){const li=Math.min(entryIdx+20,c.length-1);pnl+=pos*(c[li].c-entry)/entry*100;status=t1H?(t2H?'hit_t2':'hit_t1'):'expired';exitDay=li-entryIdx;}
  const nd = normDate(c[entryIdx].d);
  return{pnl,status,exitDay,mfe,mae,date:nd,year:nd.slice(0,7)}; // "YYYY-MM"
}

// ─── STATS + DISPLAY ──────────────────────────────────────────────────────────
function stats(trades){
  const n=trades.length;
  if(n===0)return{n:0,wr:0,avgPnl:0,medPnl:0,pf:0,maxDD:0};
  const wins=trades.filter(t=>t.pnl>0);
  const wr=wins.length/n*100;
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  const sorted=[...trades].map(t=>t.pnl).sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const medPnl=sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
  const gW=wins.reduce((s,t)=>s+t.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  let peak=0,maxDD=0,eq=0;
  for(const t of trades){eq+=t.pnl;if(eq>peak)peak=eq;if(peak-eq>maxDD)maxDD=peak-eq;}
  return{n,wr,avgPnl,medPnl,pf,maxDD};
}

function bootstrapWR(trades,B=1000){
  if(trades.length<10)return{lo:0,hi:100};
  const wrs=[];
  for(let b=0;b<B;b++){
    let w=0;
    for(let i=0;i<trades.length;i++)if(trades[Math.floor(Math.random()*trades.length)].pnl>0)w++;
    wrs.push(w/trades.length*100);
  }
  wrs.sort((a,b)=>a-b);
  return{lo:wrs[25],hi:wrs[974]};
}

function row(label,a,b){
  const pad=(s,n)=>String(s).padStart(n);
  const sign=v=>v>=0?'+':'';
  const fmt=v=>typeof v==='string'?v:(sign(v)+v.toFixed(2)+'%');
  return `  ${label.padEnd(18)}│ ${pad(fmt(a),12)} │ ${pad(fmt(b),12)} │ ${pad(fmt(typeof b==='number'&&typeof a==='number'?b-a:' '),10)} `;
}

function printBlock(label, base, filt) {
  const bB=bootstrapWR(base), bF=bootstrapWR(filt);
  const pad=(s,n)=>String(s).padStart(n);
  console.log(`  ┌${'─'.repeat(58)}┐`);
  console.log(`  │  ${label.padEnd(56)}│`);
  console.log(`  ├${'─'.repeat(18)}┬${'─'.repeat(14)}┬${'─'.repeat(14)}┬${'─'.repeat(11)}┤`);
  console.log(`  │ Metric           │  HP15 Base   │  HP15+Regime │    Delta     │`);
  console.log(`  ├${'─'.repeat(18)}┼${'─'.repeat(14)}┼${'─'.repeat(14)}┼${'─'.repeat(11)}┤`);
  const sB=stats(base), sF=stats(filt);
  const lines = [
    ['Signals',    sB.n,      sF.n],
    ['Win Rate',   sB.wr,     sF.wr],
    ['Avg P&L',    sB.avgPnl, sF.avgPnl],
    ['Median P&L', sB.medPnl, sF.medPnl],
    ['Prof Factor',sB.pf>=100?'∞':+sB.pf.toFixed(2), sF.pf>=100?'∞':+sF.pf.toFixed(2)],
    ['Max DD',     sB.maxDD,  sF.maxDD],
  ];
  for (const [lbl, bv, fv] of lines) {
    const fmtV = v => typeof v === 'string' ? v.padStart(10) : (v>=0?'+':'')+v.toFixed(typeof bv==='number'&&lbl==='Signals'?0:2)+(lbl==='Signals'?'':lbl==='Prof Factor'?'':'%');
    const delta = (typeof bv==='number'&&typeof fv==='number') ? ((fv-bv)>=0?'+':'')+(fv-bv).toFixed(lbl==='Signals'?0:2)+(lbl==='Signals'||lbl==='Prof Factor'?'':'%') : '';
    console.log(`  │ ${lbl.padEnd(16)}│ ${fmtV(bv).padStart(12)} │ ${fmtV(fv).padStart(12)} │ ${delta.padStart(9)}  │`);
  }
  console.log(`  │ CI lo (95%)      │ ${(bB.lo.toFixed(1)+'%').padStart(12)} │ ${(bF.lo.toFixed(1)+'%').padStart(12)} │ ${((bF.lo-bB.lo>=0?'+':'')+(bF.lo-bB.lo).toFixed(1)+'pp').padStart(9)}  │`);
  console.log(`  └${'─'.repeat(18)}┴${'─'.repeat(14)}┴${'─'.repeat(14)}┴${'─'.repeat(11)}┘`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  HP15 REGIME FILTER — Build & Validate');
console.log('  Regime gate: Nifty>EMA50  AND/OR  VIX<70pctl  AND/OR  N50-mom>0  (≥2/3)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// ─── 1. Build regime map ──────────────────────────────────────────────────────
console.log('── STEP 1: REGIME MAP ─────────────────────────────────────────────────────\n');
const regimeMap = buildRegimeMap();

// ─── 2. Load stocks ───────────────────────────────────────────────────────────
console.log('── STEP 2: LOADING STOCKS ─────────────────────────────────────────────────\n');
const seen = new Set();
const stocks = [];
for (const dir of DATA_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv')) continue;
    const sym = f.replace(/_NS_OHLCV\.csv$|_NSE_OHLCV\.csv$|\.csv$/i,'');
    if (seen.has(sym)) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
      const c = [];
      for (let i = 1; i < raw.length; i++) {
        const p = raw[i].split(',');
        if (p.length < 5 || isNaN(+p[4]) || +p[4] <= 0) continue;
        c.push({ d: normDate(p[0].trim()), o:+p[1], h:+p[2], l:+p[3], c:+p[4], v:+p[5]||0 });
      }
      if (c.length < 200) continue;
      seen.add(sym);
      stocks.push({ sym, c, atr: computeATR14(c) });
    } catch {}
  }
}
console.log(`Loaded ${stocks.length} stocks\n`);

// ─── 3. Run both backtests simultaneously ─────────────────────────────────────
console.log('── STEP 3: BACKTESTING (HP15 baseline vs HP15+Regime) ────────────────────\n');

const baseTrades   = [];   // all HP15 signals
const filtTrades   = [];   // HP15 signals that also pass regime gate
let filteredOut    = 0;

for (const { sym, c, atr } of stocks) {
  const splitIdx = Math.floor(c.length * 0.60);
  let lastExitBase = -1;
  let lastExitFilt = -1;

  for (let i = 130; i < c.length - 21; i++) {
    // ── BASE: run HP15 regardless of regime ──
    if (i > lastExitBase) {
      const sig = screenHP15(c, atr, i);
      if (sig) {
        const r = simulateTrade(c, atr, i, sig.zone);
        baseTrades.push({ ...r, splitIdx: i < splitIdx ? 'IS' : 'OOS' });
        lastExitBase = i + Math.max(r.exitDay, 5);
      }
    }

    // ── FILTERED: check regime gate first ──
    if (i > lastExitFilt) {
      const sig = screenHP15(c, atr, i);
      if (sig) {
        const date    = c[i].d;
        const regime  = regimeMap.get(date);
        const allowed = !regime || regime.active;  // allow if no data (pre-2016)
        if (allowed) {
          const r = simulateTrade(c, atr, i, sig.zone);
          filtTrades.push({ ...r, splitIdx: i < splitIdx ? 'IS' : 'OOS' });
          lastExitFilt = i + Math.max(r.exitDay, 5);
        } else {
          filteredOut++;
          lastExitFilt = i + 5;  // skip 5 bars then re-check
        }
      }
    }
  }
}

console.log(`Base trades: ${baseTrades.length}  |  Regime-filtered: ${filtTrades.length}  |  Blocked: ${filteredOut}\n`);

// ─── 4. IS/OOS Comparison ─────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  TEST 1: 60/40 CHRONOLOGICAL IS/OOS SPLIT');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const baseIS  = baseTrades.filter(t=>t.splitIdx==='IS');
const baseOOS = baseTrades.filter(t=>t.splitIdx==='OOS');
const filtIS  = filtTrades.filter(t=>t.splitIdx==='IS');
const filtOOS = filtTrades.filter(t=>t.splitIdx==='OOS');

printBlock('IN-SAMPLE (first 60%)', baseIS, filtIS);
console.log('');
printBlock('OUT-OF-SAMPLE (last 40%)', baseOOS, filtOOS);

// WR collapse diagnosis
const baseWRdrop = stats(baseOOS).wr - stats(baseIS).wr;
const filtWRdrop = stats(filtOOS).wr - stats(filtIS).wr;
console.log(`\n  WR collapse (IS→OOS):  Base ${baseWRdrop.toFixed(1)}pp  →  Regime-filtered ${filtWRdrop.toFixed(1)}pp`);
const improvement = filtWRdrop - baseWRdrop;
console.log(`  Gap closed: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}pp  ${improvement >= 10 ? '✅ Significant improvement' : improvement >= 0 ? '🟡 Marginal improvement' : '🔴 No improvement'}\n`);

// ─── 5. ANCHORED WALK-FORWARD ─────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  TEST 2: ANCHORED WALK-FORWARD (5 folds)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

console.log('  Fold  │ Test window │ Base WR │ Base P&L │ Regime WR │ Regime P&L │ ΔWR');
console.log('  ──────┼─────────────┼─────────┼──────────┼───────────┼────────────┼─────');

const FOLD_N = 5;
const wfBaseWRs = [], wfFiltWRs = [];

for (let f = 0; f < FOLD_N; f++) {
  const tS = (f+1) / (FOLD_N+1);
  const tE = (f+2) / (FOLD_N+1);
  const bFold = [], fFold = [];

  for (const { sym, c, atr } of stocks) {
    const tStart = Math.floor(c.length * tS);
    const tEnd   = Math.floor(c.length * tE);
    let lB = -1, lF = -1;
    for (let i = Math.max(130, tStart); i < Math.min(tEnd, c.length-21); i++) {
      if (i > lB) {
        const sig = screenHP15(c, atr, i);
        if (sig) { const r=simulateTrade(c,atr,i,sig.zone); bFold.push(r); lB=i+Math.max(r.exitDay,5); }
      }
      if (i > lF) {
        const sig = screenHP15(c, atr, i);
        if (sig) {
          const regime = regimeMap.get(c[i].d);
          if (!regime || regime.active) { const r=simulateTrade(c,atr,i,sig.zone); fFold.push(r); lF=i+Math.max(r.exitDay,5); }
          else lF = i+5;
        }
      }
    }
  }
  const sB=stats(bFold), sF=stats(fFold);
  const dWR = sF.wr - sB.wr;
  const testLabel = `${Math.round(tS*100)}–${Math.round(tE*100)}%`;
  const flag = sF.wr > sB.wr ? '▲' : sF.wr < sB.wr - 5 ? '▼' : '~';
  console.log(`  WF${f+1}   │ ${testLabel.padEnd(11)} │ ${(sB.wr.toFixed(1)+'%').padStart(7)} │ ${((sB.avgPnl>=0?'+':'')+sB.avgPnl.toFixed(2)+'%').padStart(8)} │ ${(sF.wr.toFixed(1)+'%').padStart(9)} │ ${((sF.avgPnl>=0?'+':'')+sF.avgPnl.toFixed(2)+'%').padStart(10)} │ ${(dWR>=0?'+':'')+dWR.toFixed(0)}pp ${flag}`);
  if (sB.n > 0) wfBaseWRs.push(sB.wr);
  if (sF.n > 0) wfFiltWRs.push(sF.wr);
}

const baseRange = wfBaseWRs.length>=2 ? Math.max(...wfBaseWRs)-Math.min(...wfBaseWRs) : 0;
const filtRange = wfFiltWRs.length>=2 ? Math.max(...wfFiltWRs)-Math.min(...wfFiltWRs) : 0;
console.log(`  ──────┴─────────────┴─────────┴──────────┴───────────┴────────────┴─────`);
console.log(`  WR range across folds:   Base ${baseRange.toFixed(0)}pp  →  Regime-filtered ${filtRange.toFixed(0)}pp`);
console.log(`  ${filtRange < baseRange ? '✅ Regime filter reduced fold-to-fold variance' : '🟡 No variance reduction from regime filter'}\n`);

// ─── 6. PER-CALENDAR-YEAR ─────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  TEST 3: PER-CALENDAR-YEAR  (base vs regime-filtered)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');
console.log('  Year │ Base n │ Base WR │ Filt n │ Filt WR │  ΔWR  │ Regime AvgP&L');
console.log('  ─────┼────────┼─────────┼────────┼─────────┼───────┼──────────────');

const byYearBase = {}, byYearFilt = {};
for (const t of baseTrades) { if(!byYearBase[t.year])byYearBase[t.year]=[]; byYearBase[t.year].push(t); }
for (const t of filtTrades) { if(!byYearFilt[t.year])byYearFilt[t.year]=[]; byYearFilt[t.year].push(t); }

const allYears = [...new Set([...Object.keys(byYearBase), ...Object.keys(byYearFilt)])].sort();
for (const yr of allYears) {
  const bArr = byYearBase[yr] || [];
  const fArr = byYearFilt[yr] || [];
  if (bArr.length < 2 && fArr.length < 2) continue;
  const sB = stats(bArr), sF = stats(fArr);
  const dWR = fArr.length>0 && bArr.length>0 ? sF.wr - sB.wr : 0;
  const flag = sF.wr > sB.wr + 3 ? '▲' : sF.wr < sB.wr - 3 ? '▼' : ' ';
  console.log(`  ${yr} │ ${String(sB.n).padStart(6)} │ ${(sB.wr.toFixed(1)+'%').padStart(7)} │ ${String(sF.n).padStart(6)} │ ${(sF.wr.toFixed(1)+'%').padStart(7)} │ ${((dWR>=0?'+':'')+dWR.toFixed(0)+'pp').padStart(5)} ${flag} │ ${((sF.avgPnl>=0?'+':'')+sF.avgPnl.toFixed(2)+'%').padStart(12)}`);
}

// ─── 7. EXIT MODEL ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  TEST 4: EXIT MODEL BREAKDOWN');
console.log('══════════════════════════════════════════════════════════════════════════════\n');
function exitModel(trades) {
  const n = trades.length || 1;
  const c = { hit_t3:0, hit_t2:0, hit_t1:0, stopped:0, expired:0 };
  for (const t of trades) c[t.status] = (c[t.status]||0)+1;
  return Object.entries(c).map(([k,v])=>`${k}: ${(v/n*100).toFixed(0)}%`).join('  ');
}
console.log(`  Base:    ${exitModel(baseTrades)}`);
console.log(`  Regime:  ${exitModel(filtTrades)}`);

// ─── 8. FINAL VERDICT ────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  FINAL VERDICT');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const oosBase = stats(baseOOS), oosFilt = stats(filtOOS);
const bBoot   = bootstrapWR(baseOOS), fBoot = bootstrapWR(filtOOS);

console.log(`  Metric                  HP15 Baseline      HP15 + Regime Gate`);
console.log(`  ${'─'.repeat(58)}`);
console.log(`  OOS Win Rate            ${oosBase.wr.toFixed(1).padStart(6)}%             ${oosFilt.wr.toFixed(1).padStart(6)}%`);
console.log(`  OOS Avg P&L             ${(oosBase.avgPnl>=0?'+':'')+oosBase.avgPnl.toFixed(2).padStart(6)}%             ${(oosFilt.avgPnl>=0?'+':'')+oosFilt.avgPnl.toFixed(2).padStart(6)}%`);
console.log(`  OOS CI lo (95%)         ${bBoot.lo.toFixed(1).padStart(6)}%             ${fBoot.lo.toFixed(1).padStart(6)}%`);
console.log(`  IS→OOS WR drop          ${baseWRdrop.toFixed(1).padStart(6)}pp            ${filtWRdrop.toFixed(1).padStart(6)}pp`);
console.log(`  Trades filtered out     ${String(0).padStart(6)}              ${String(filteredOut).padStart(6)}`);
console.log(`  Signal survival rate    100%                ${(filtTrades.length/(baseTrades.length||1)*100).toFixed(0)}%`);
console.log();

const regimeVerdict =
  oosFilt.wr >= 60 && filtWRdrop >= -8 && fBoot.lo >= 50 ? '✅ REGIME FILTER WORKS — OOS WR restored, CI above 50%, deploy with confidence' :
  oosFilt.wr >= 55 && filtWRdrop >= -12 ? '🟡 PARTIAL FIX — WR improved but still below target; consider tightening R2/R3' :
  oosFilt.wr < oosBase.wr ? '🔴 REGIME FILTER HURTS — blocking good signals; review conditions' :
  '🟡 MARGINAL — some improvement, insufficient to fully restore confidence';

console.log(`  ${regimeVerdict}`);
console.log();

// Regime condition audit — which conditions drove the improvement?
console.log('  ── Regime Condition Breakdown (OOS signals only) ──');
let r1Bl=0, r2Bl=0, r3Bl=0, r1Al=0, r2Al=0, r3Al=0, withData=0;
for (const t of baseTrades.filter(t=>t.splitIdx==='OOS')) {
  const regime = regimeMap.get(t.date);
  if (!regime) continue;
  withData++;
  if (!regime.r1) r1Bl++; if (!regime.r2) r2Bl++; if (!regime.r3) r3Bl++;
  if (regime.r1) r1Al++; if (regime.r2) r2Al++; if (regime.r3) r3Al++;
}
if (withData > 0) {
  console.log(`  (${withData} OOS trades had regime data)`);
  console.log(`  R1 (N50>EMA50) firing: ${(r1Al/withData*100).toFixed(0)}%  │  R2 (VIX<70p) firing: ${(r2Al/withData*100).toFixed(0)}%  │  R3 (mom>0) firing: ${(r3Al/withData*100).toFixed(0)}%`);
}
console.log('\n══════════════════════════════════════════════════════════════════════════════\n');
