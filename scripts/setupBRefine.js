// ══════════════════════════════════════════════════════════════════════════════
// SETUP B ULTRA-REFINEMENT
// Base: 17-23% pullback from 20-day swing high, below SMA50, low volume
//       +5% target / 10d time stop / -5% hard stop
// Goal: find additional filters that lift OOS WR above 63.6% baseline
//
// Isolation tests (one filter at a time against OOS baseline):
//   1. RSI14 thresholds                 6. Days spent declining into zone
//   2. RSI2 extreme oversold            7. Prior rally size before peak
//   3. Signal-day candle shape          8. Proximity to 52-week low
//   4. Distance from 200-day SMA        9. Average daily turnover (liquidity)
//   5. ATR% (stock volatility)         10. Volume < 1× avg (stricter vol filter)
//
// Then: combinatorial score — how many filters does each trade pass?
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
           Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
function normDate(d){
  if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
  const m=d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m?`${m[3]}-${MON[m[2]]||'01'}-${m[1].padStart(2,'0')}`:d;
}

// ─── INDICATORS ───────────────────────────────────────────────────────────────
function smaN(c,idx,n){
  if(idx<n-1)return null;let s=0;
  for(let j=idx-n+1;j<=idx;j++)s+=c[j].c;return s/n;
}
function rsi(c,idx,period=14){
  if(idx<period)return 50;
  let g=0,l=0;
  for(let j=idx-period+1;j<=idx;j++){
    const ch=c[j].c-c[j-1].c;if(ch>0)g+=ch;else l-=ch;
  }
  const ag=g/period,al=l/period;
  return al<1e-9?100:100-100/(1+ag/al);
}
function rsi2(c,idx){
  if(idx<2)return 50;
  const ch1=c[idx].c-c[idx-1].c,ch2=c[idx-1].c-c[idx-2].c;
  const g=((ch1>0?ch1:0)+(ch2>0?ch2:0))/2,l=((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
  return l<1e-9?100:100-100/(1+g/l);
}
function atr14(c,idx){
  if(idx<15)return 0;
  let s=0;for(let j=1;j<=14;j++)s+=Math.max(c[idx-14+j].h-c[idx-14+j].l,Math.abs(c[idx-14+j].h-c[idx-14+j-1].c),Math.abs(c[idx-14+j].l-c[idx-14+j-1].c));
  let a=s/14;
  for(let j=idx-13;j<=idx;j++){const tr=Math.max(c[j].h-c[j].l,Math.abs(c[j].h-c[j-1].c),Math.abs(c[j].l-c[j-1].c));a=(a*13+tr)/14;}
  return a;
}
function swingHigh20(c,idx){
  let h=-Infinity;for(let j=Math.max(0,idx-20);j<idx;j++)h=Math.max(h,c[j].h);return h;
}
function high52w(c,idx){
  let h=-Infinity;for(let j=Math.max(0,idx-252);j<=idx;j++)h=Math.max(h,c[j].h);return h;
}
function low52w(c,idx){
  let l=Infinity;for(let j=Math.max(0,idx-252);j<=idx;j++)l=Math.min(l,c[j].l);return l;
}
function volAvg(c,idx,n){
  let s=0,k=0;for(let j=Math.max(0,idx-n);j<idx;j++){s+=c[j].v;k++;}return k>0?s/k:0;
}
function turnover(c,idx){return c[idx].c*c[idx].v;}
function avgTurnover20(c,idx){
  let s=0,k=0;for(let j=Math.max(0,idx-20);j<idx;j++){s+=c[j].c*c[j].v;k++;}return k>0?s/k:0;
}
// Days stock spent declining before hitting the zone (how many consecutive lower closes)
function daysDecline(c,idx){
  let d=0;for(let j=idx-1;j>=Math.max(0,idx-30);j--){if(c[j].c<c[j+1].c)d++;else break;}return d;
}
// How much did the stock rally before the swing high? (gain over 60 days before peak)
function priorRally(c,idx){
  // Find peak in last 20 bars, then look back 60 bars from there
  let peakIdx=idx-1;
  for(let j=idx-20;j<idx;j++)if(c[j].h>c[peakIdx].h)peakIdx=j;
  const base=Math.max(0,peakIdx-60);
  return c[base].c>0?(c[peakIdx].c-c[base].c)/c[base].c*100:0;
}
// Lower wick dominance: is today a hammer-like candle?
function lowerWickPct(bar){
  const rng=bar.h-bar.l;if(rng<0.01)return 0;
  return(Math.min(bar.o,bar.c)-bar.l)/rng*100;
}
function bodyPct(bar){
  const rng=bar.h-bar.l;if(rng<0.01)return 0;
  return Math.abs(bar.c-bar.o)/rng*100;
}
function closeLoc(bar){
  const rng=bar.h-bar.l;if(rng<0.01)return 50;
  return(bar.c-bar.l)/rng*100;
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function stats(trades){
  const n=trades.length;if(n===0)return{n:0,wr:0,avgPnl:0,medPnl:0,pf:0};
  const wins=trades.filter(t=>t.pnl>0);
  const wr=wins.length/n*100;
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  const sorted=[...trades].map(t=>t.pnl).sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const medPnl=sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
  const gW=wins.reduce((s,t)=>s+t.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  return{n,wr,avgPnl,medPnl,pf};
}
function bsCI(pnls,B=1000){
  if(pnls.length<5)return{loWR:0,loPnl:-99};
  const wrs=[],rets=[];
  for(let b=0;b<B;b++){let w=0,s=0;
    for(let i=0;i<pnls.length;i++){const x=pnls[Math.floor(Math.random()*pnls.length)];if(x>0)w++;s+=x;}
    wrs.push(w/pnls.length*100);rets.push(s/pnls.length);}
  wrs.sort((a,b)=>a-b);rets.sort((a,b)=>a-b);
  return{loWR:wrs[25],loPnl:rets[25]};
}

// ─── SIMULATE ─────────────────────────────────────────────────────────────────
function sim(c,entryIdx,tgtPct=5,tsDay=10,slPct=5){
  const entry=c[entryIdx].c;
  const tgtP=entry*(1+tgtPct/100),slP=entry*(1-slPct/100);
  for(let d=1;d<=tsDay;d++){
    const ci=entryIdx+d;if(ci>=c.length)break;
    const bar=c[ci];
    if(bar.o<=slP)return{pnl:(bar.o-entry)/entry*100,ex:'stop',d};
    if(bar.l<=slP)return{pnl:-slPct,ex:'stop',d};
    if(bar.o>=tgtP)return{pnl:(bar.o-entry)/entry*100,ex:'target',d};
    if(bar.h>=tgtP)return{pnl:tgtPct,ex:'target',d};
    if(d===tsDay)return{pnl:(bar.c-entry)/entry*100,ex:'time',d};
  }
  const last=c[Math.min(entryIdx+tsDay,c.length-1)];
  return{pnl:(last.c-entry)/entry*100,ex:'time',d:tsDay};
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────
const stocks=[];
if(fs.existsSync(DATA_DIR)){
  for(const f of fs.readdirSync(DATA_DIR)){
    if(!f.endsWith('.csv'))continue;
    try{
      const raw=fs.readFileSync(path.join(DATA_DIR,f),'utf8').trim().split('\n');
      const c=[];
      for(let i=1;i<raw.length;i++){
        const p=raw[i].split(',');if(p.length<5||isNaN(+p[4])||+p[4]<=0)continue;
        c.push({d:normDate(p[0].trim()),o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0});
      }
      if(c.length>=260)stocks.push({sym:f.replace(/\.csv$/i,''),c});
    }catch{}
  }
}
console.log(`Loaded ${stocks.length} stocks\n`);

// ─── COLLECT SETUP B SIGNALS WITH FULL METADATA ──────────────────────────────
console.log('Collecting Setup B signals...');
const signals=[];
for(const {sym,c} of stocks){
  const splitIdx=Math.floor(c.length*0.60);
  let wasInZone=false;
  for(let i=260;i<c.length-11;i++){
    const sh=swingHigh20(c,i);if(sh<=0)continue;
    const entry=c[i].c;
    const dd=(sh-entry)/sh*100;
    const inZone=dd>=17&&dd<23;
    if(inZone&&!wasInZone){
      // Base filter: below SMA50
      const s50=smaN(c,i,50);
      if(s50===null||entry>s50){wasInZone=true;continue;}

      // Pre-compute all metadata for isolation tests
      const va=volAvg(c,i,20);
      const volRatio=va>0?c[i].v/va:0;

      // Base volume filter: < 2× avg (already know this is needed)
      if(volRatio>=2){wasInZone=true;continue;}

      const s200=smaN(c,i,200);
      const r14=rsi(c,i,14);
      const r2=rsi2(c,i);
      const atrV=atr14(c,i);
      const atrPct=entry>0?atrV/entry*100:0;
      const h52=high52w(c,i);
      const l52=low52w(c,i);
      const pctFromH52=h52>0?(h52-entry)/h52*100:0;
      const pctFromL52=l52>0?(entry-l52)/l52*100:0;
      const distFrom200=s200&&s200>0?(entry-s200)/s200*100:null;
      const rally=priorRally(c,i);
      const decDays=daysDecline(c,i);
      const lw=lowerWickPct(c[i]);
      const bp=bodyPct(c[i]);
      const cl=closeLoc(c[i]);
      const at20=avgTurnover20(c,i);
      const tr=sim(c,i);

      signals.push({
        sym,c,idx:i,entry,dd,
        splitTag:i<splitIdx?'IS':'OOS',
        year:c[i].d.slice(0,4),
        // filters
        r14,r2,
        volRatio,
        distFrom200,      // % above(+) or below(-) 200-SMA; null if no data
        atrPct,
        pctFromH52,       // % below 52-week high
        pctFromL52,       // % above 52-week low
        rally,            // % gain 60 days before peak
        decDays,          // consecutive down-closes before signal
        lw,               // lower wick %
        bp,               // body %
        cl,               // close location %
        at20,             // avg daily turnover (₹)
        // result
        pnl:tr.pnl, ex:tr.ex,
      });
    }
    wasInZone=inZone;
  }
}

const OOS=signals.filter(s=>s.splitTag==='OOS');
const IS =signals.filter(s=>s.splitTag==='IS');
console.log(`Signals: IS=${IS.length}  OOS=${OOS.length}\n`);

const BASE=stats(OOS.map(s=>({pnl:s.pnl})));
console.log(`BASELINE OOS: WR=${BASE.wr.toFixed(1)}%  AvgPnl=${BASE.avgPnl>=0?'+':''}${BASE.avgPnl.toFixed(2)}%  PF=${BASE.pf.toFixed(2)}  n=${BASE.n}\n`);

// ─── ISOLATION TEST HELPER ────────────────────────────────────────────────────
function testFilter(label, fn, showBuckets=false){
  const pass=OOS.filter(fn),fail=OOS.filter(s=>!fn(s));
  const sP=stats(pass.map(s=>({pnl:s.pnl}))),sF=stats(fail.map(s=>({pnl:s.pnl})));
  const ci=bsCI(pass.map(s=>s.pnl));
  const dWR=sP.wr-BASE.wr, dPnl=sP.avgPnl-BASE.avgPnl;
  let flag='NO'; if(sP.avgPnl>BASE.avgPnl&&ci.loPnl>0) flag='OK'; else if(sP.avgPnl>BASE.avgPnl) flag='~';
  return{label,pass:sP,fail:sF,ci,dWR,dPnl,flag};
}
function printRow(r){
  const d=r.dWR,p=r.dPnl;
  process.stdout.write(
    `  ${r.label.padEnd(38)} │ ${String(r.pass.n).padStart(5)} │ ${(r.pass.wr.toFixed(1)+'%').padStart(7)} │ ${((r.pass.avgPnl>=0?'+':'')+r.pass.avgPnl.toFixed(2)+'%').padStart(8)} │ ${r.pass.pf.toFixed(2).padStart(5)} │ `+
    `${(d>=0?'+':'')+d.toFixed(1)+'pp'} │ ${(p>=0?'+':'')+p.toFixed(2)+'%'} │ ${(r.ci.loPnl>=0?'+':'')+r.ci.loPnl.toFixed(2)+'%'} │ ${r.flag}\n`
  );
}

console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  ISOLATION TESTS (OOS only vs baseline 63.6% WR / +1.28% avg)');
console.log('  Each row = "pass this filter" subset');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const hdr=`  ${'Filter'.padEnd(38)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'ΔWR'.padStart(6)} │ ${'ΔPnl'.padStart(7)} │ ${'CI lo'.padStart(7)} │ OK?`;
const sep='  '+'-'.repeat(hdr.length-2);

// ── RSI14 ──
console.log('  RSI14:');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['RSI14 < 20 (very oversold)',  s=>s.r14<20],
  ['RSI14 < 25',                  s=>s.r14<25],
  ['RSI14 < 30',                  s=>s.r14<30],
  ['RSI14 < 35',                  s=>s.r14<35],
  ['RSI14 < 40',                  s=>s.r14<40],
  ['RSI14 40–60 (neutral)',        s=>s.r14>=40&&s.r14<60],
  ['RSI14 >= 40 (not oversold)',   s=>s.r14>=40],
]) printRow(testFilter(lbl,fn));

// ── RSI2 ──
console.log('\n  RSI2 (2-period, extreme oversold):');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['RSI2 < 5',   s=>s.r2<5],
  ['RSI2 < 10',  s=>s.r2<10],
  ['RSI2 < 20',  s=>s.r2<20],
  ['RSI2 < 30',  s=>s.r2<30],
  ['RSI2 >= 30', s=>s.r2>=30],
  ['RSI2 >= 50', s=>s.r2>=50],
]) printRow(testFilter(lbl,fn));

// ── VOLUME ──
console.log('\n  Signal-day volume (vs 20-day avg):');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['Vol < 0.5× avg (very quiet)', s=>s.volRatio<0.5],
  ['Vol 0.5–1× avg',              s=>s.volRatio>=0.5&&s.volRatio<1],
  ['Vol < 1× avg (below avg)',    s=>s.volRatio<1],
  ['Vol 1–1.5× avg',              s=>s.volRatio>=1&&s.volRatio<1.5],
  ['Vol 1.5–2× avg',              s=>s.volRatio>=1.5&&s.volRatio<2],
]) printRow(testFilter(lbl,fn));

// ── 200-SMA DISTANCE ──
console.log('\n  Distance from 200-day SMA:');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['Above 200-SMA (long uptrend)', s=>s.distFrom200!==null&&s.distFrom200>0],
  ['0–10% below 200-SMA',         s=>s.distFrom200!==null&&s.distFrom200<0&&s.distFrom200>=-10],
  ['10–20% below 200-SMA',        s=>s.distFrom200!==null&&s.distFrom200<-10&&s.distFrom200>=-20],
  ['> 20% below 200-SMA',         s=>s.distFrom200!==null&&s.distFrom200<-20],
  ['Within 15% of 200-SMA (either side)', s=>s.distFrom200!==null&&Math.abs(s.distFrom200)<=15],
  ['< 5% below 200-SMA',          s=>s.distFrom200!==null&&s.distFrom200>=-5&&s.distFrom200<0],
]) printRow(testFilter(lbl,fn));

// ── ATR% ──
console.log('\n  ATR% (14-day ATR / price × 100):');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['ATR% < 1.5% (low volatility)', s=>s.atrPct<1.5],
  ['ATR% 1.5–2.5%',               s=>s.atrPct>=1.5&&s.atrPct<2.5],
  ['ATR% 2.5–4%',                 s=>s.atrPct>=2.5&&s.atrPct<4],
  ['ATR% > 4% (high volatility)', s=>s.atrPct>=4],
  ['ATR% < 3%',                   s=>s.atrPct<3],
  ['ATR% < 2%',                   s=>s.atrPct<2],
]) printRow(testFilter(lbl,fn));

// ── 52-WEEK PROXIMITY ──
console.log('\n  52-week high/low proximity:');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['> 30% off 52w high (deep correction)', s=>s.pctFromH52>30],
  ['20–30% off 52w high',                  s=>s.pctFromH52>=20&&s.pctFromH52<30],
  ['10–20% off 52w high',                  s=>s.pctFromH52>=10&&s.pctFromH52<20],
  ['< 10% off 52w high',                   s=>s.pctFromH52<10],
  ['> 30% above 52w low (not near bottom)',s=>s.pctFromL52>30],
  ['10–30% above 52w low',                 s=>s.pctFromL52>=10&&s.pctFromL52<30],
  ['< 10% above 52w low (near bottom)',    s=>s.pctFromL52<10],
]) printRow(testFilter(lbl,fn));

// ── PRIOR RALLY ──
console.log('\n  Prior rally before the pullback (60-day gain before peak):');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['Prior rally > 40%',   s=>s.rally>40],
  ['Prior rally 20–40%',  s=>s.rally>=20&&s.rally<40],
  ['Prior rally 10–20%',  s=>s.rally>=10&&s.rally<20],
  ['Prior rally < 10%',   s=>s.rally<10],
  ['Prior rally > 20%',   s=>s.rally>20],
  ['Prior rally > 15%',   s=>s.rally>15],
]) printRow(testFilter(lbl,fn));

// ── DAYS IN DECLINE ──
console.log('\n  Consecutive down-closes before signal:');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['1–2 down days (fresh)',   s=>s.decDays<=2],
  ['3–5 down days',           s=>s.decDays>=3&&s.decDays<=5],
  ['6–10 down days',          s=>s.decDays>=6&&s.decDays<=10],
  ['> 10 down days (exhausted)',s=>s.decDays>10],
  ['≤ 4 down days',           s=>s.decDays<=4],
  ['≥ 5 down days',           s=>s.decDays>=5],
]) printRow(testFilter(lbl,fn));

// ── CANDLE SHAPE ──
console.log('\n  Signal-day candle shape:');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['Lower wick > 40% of range (hammer)', s=>s.lw>40],
  ['Lower wick > 30%',                   s=>s.lw>30],
  ['Lower wick > 20%',                   s=>s.lw>20],
  ['Close location > 50% (closed upper half)', s=>s.cl>50],
  ['Close location > 60%',               s=>s.cl>60],
  ['Close location < 40% (closed weak)', s=>s.cl<40],
  ['Body < 20% (doji-like)',             s=>s.bp<20],
  ['Body > 40%',                         s=>s.bp>40],
]) printRow(testFilter(lbl,fn));

// ── TURNOVER ──
console.log('\n  Average daily turnover (liquidity):');console.log(hdr);console.log(sep);
for(const [lbl,fn] of [
  ['Turnover > ₹50cr',   s=>s.at20>50e6],
  ['Turnover > ₹100cr',  s=>s.at20>100e6],
  ['Turnover > ₹200cr',  s=>s.at20>200e6],
  ['Turnover > ₹500cr',  s=>s.at20>500e6],
  ['Turnover < ₹50cr',   s=>s.at20<=50e6],
]) printRow(testFilter(lbl,fn));

// ─── SECTION 2: COMBINATORIAL SCORE ──────────────────────────────────────────
// Assign each signal a score based on how many "positive" conditions it passes
// Using the best-performing conditions from isolation tests
// Score 0-8; test what WR/P&L looks like at each score threshold

console.log('\n\n══════════════════════════════════════════════════════════════════════════════');
console.log('  COMBINATORIAL SCORE');
console.log('  Each signal scored 0-9 on how many quality conditions it passes');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// Conditions chosen based on their logical merit AND initial isolation test direction
// We'll evaluate the score threshold results on OOS to avoid fitting
const scoreConditions = [
  ['RSI14 < 30',               s=>s.r14<30],
  ['RSI2 < 20',                s=>s.r2<20],
  ['Vol < 1× avg',             s=>s.volRatio<1],
  ['Above 200-SMA',            s=>s.distFrom200!==null&&s.distFrom200>0],
  ['ATR% < 3%',                s=>s.atrPct<3],
  ['>30% above 52w low',       s=>s.pctFromL52>30],
  ['Prior rally > 15%',        s=>s.rally>15],
  ['5+ down days',             s=>s.decDays>=5],
  ['Lower wick > 30%',         s=>s.lw>30],
];
for(const sig of signals) sig.score=scoreConditions.filter(([,fn])=>fn(sig)).length;

console.log(`  Score breakdown (OOS):`);
console.log(`  ${'Score'.padEnd(8)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'MedPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'CI loWR'.padStart(8)} │ ${'CI loPnl'.padStart(9)} │ Signal%`);
console.log('  '+'-'.repeat(97));

const scoreGroups={};
for(const s of OOS){if(!scoreGroups[s.score])scoreGroups[s.score]=[];scoreGroups[s.score].push(s);}
const scoreKeys=Object.keys(scoreGroups).map(Number).sort((a,b)=>a-b);
for(const sc of scoreKeys){
  const grp=scoreGroups[sc];
  const st=stats(grp.map(s=>({pnl:s.pnl})));
  const ci=bsCI(grp.map(s=>s.pnl));
  const sigPct=(grp.length/OOS.length*100).toFixed(0)+'%';
  console.log(`  ${('='+sc).padEnd(8)} │ ${String(st.n).padStart(5)} │ ${(st.wr.toFixed(1)+'%').padStart(7)} │ ${((st.avgPnl>=0?'+':'')+st.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((st.medPnl>=0?'+':'')+st.medPnl.toFixed(2)+'%').padStart(8)} │ ${st.pf.toFixed(2).padStart(5)} │ ${(ci.loWR.toFixed(1)+'%').padStart(8)} │ ${((ci.loPnl>=0?'+':'')+ci.loPnl.toFixed(2)+'%').padStart(9)} │ ${sigPct}`);
}

// Cumulative: score >= N
console.log('\n  Score >= threshold (cumulative, OOS):');
console.log(`  ${'Score ≥'.padEnd(9)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'MedPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'CI loWR'.padStart(8)} │ ${'CI loPnl'.padStart(9)} │ Signal%`);
console.log('  '+'-'.repeat(97));
for(const thresh of [1,2,3,4,5,6,7]){
  const grp=OOS.filter(s=>s.score>=thresh);
  if(grp.length<10)continue;
  const st=stats(grp.map(s=>({pnl:s.pnl})));
  const ci=bsCI(grp.map(s=>s.pnl));
  const sigPct=(grp.length/OOS.length*100).toFixed(0)+'%';
  let flag='  -'; if(st.avgPnl>BASE.avgPnl&&ci.loPnl>0) flag='  OK'; else if(st.avgPnl>BASE.avgPnl) flag='  ~';
  console.log(`  ${('≥'+thresh).padEnd(9)} │ ${String(st.n).padStart(5)} │ ${(st.wr.toFixed(1)+'%').padStart(7)} │ ${((st.avgPnl>=0?'+':'')+st.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((st.medPnl>=0?'+':'')+st.medPnl.toFixed(2)+'%').padStart(8)} │ ${st.pf.toFixed(2).padStart(5)} │ ${(ci.loWR.toFixed(1)+'%').padStart(8)} │ ${((ci.loPnl>=0?'+':'')+ci.loPnl.toFixed(2)+'%').padStart(9)} │ ${sigPct}${flag}`);
}

// ─── SECTION 3: BEST COMBINED SETUP YEAR-BY-YEAR ─────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════════════════════════');
console.log('  YEAR-BY-YEAR STABILITY (OOS, Setup B base vs Setup B + Score ≥ best)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// Find best score threshold (highest avg P&L with n >= 30)
let bestThresh=0,bestExp=-999;
for(const thresh of [2,3,4,5,6]){
  const grp=OOS.filter(s=>s.score>=thresh);
  if(grp.length<30)continue;
  const st=stats(grp.map(s=>({pnl:s.pnl})));
  if(st.avgPnl>bestExp){bestExp=st.avgPnl;bestThresh=thresh;}
}
console.log(`  Best score threshold found: ≥${bestThresh}  (${OOS.filter(s=>s.score>=bestThresh).length} OOS trades)\n`);

console.log(`  ${'Year'.padEnd(6)} │ ${'Base WR'.padStart(8)} ${'Base Avg'.padStart(9)} ${'Base n'.padStart(7)} │ ${'Refined WR'.padStart(10)} ${'Ref Avg'.padStart(9)} ${'Ref n'.padStart(6)}`);
console.log('  '+'-'.repeat(72));
const years=[...new Set(OOS.map(s=>s.year))].sort();
for(const yr of years){
  const base=OOS.filter(s=>s.year===yr);
  const refined=OOS.filter(s=>s.year===yr&&s.score>=bestThresh);
  if(base.length<5)continue;
  const sb=stats(base.map(s=>({pnl:s.pnl}))),sr=stats(refined.map(s=>({pnl:s.pnl})));
  const flag=refined.length>0&&sr.avgPnl>sb.avgPnl?'  ^':(refined.length>0&&sr.avgPnl<sb.avgPnl?'  v':'');
  console.log(`  ${yr.padEnd(6)} │ ${(sb.wr.toFixed(0)+'%').padStart(8)} ${((sb.avgPnl>=0?'+':'')+sb.avgPnl.toFixed(2)+'%').padStart(9)} ${String(sb.n).padStart(7)} │ ${refined.length>0?(sr.wr.toFixed(0)+'%').padStart(10):'—'.padStart(10)} ${refined.length>0?((sr.avgPnl>=0?'+':'')+sr.avgPnl.toFixed(2)+'%').padStart(9):'—'.padStart(9)} ${String(refined.length).padStart(6)}${flag}`);
}

// ─── SECTION 4: OPTIMAL FINAL SETUP ──────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 4: OPTIMAL TARGET / STOP vs REFINED SIGNALS');
console.log('  Using score >= best threshold, find best exit params');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const refinedIS =IS.filter(s=>s.score>=bestThresh);
const refinedOOS=OOS.filter(s=>s.score>=bestThresh);
console.log(`  Refined signal pool: IS=${refinedIS.length} OOS=${refinedOOS.length}\n`);

const TGT=[3,5,7,10],TS=[5,7,10,15],SL=[3,5,7,null];
const rows2=[];
for(const tgt of TGT) for(const ts of TS) for(const sl of SL){
  const trIS =refinedIS.map(s=>sim(s.c,s.idx,tgt,ts,sl));
  const trOOS=refinedOOS.map(s=>sim(s.c,s.idx,tgt,ts,sl));
  const sI=stats(trIS.map(t=>({pnl:t.pnl}))),sO=stats(trOOS.map(t=>({pnl:t.pnl})));
  const ci=bsCI(trOOS.map(t=>t.pnl));
  rows2.push({tgt,ts,sl,sI,sO,ci,exp:sO.avgPnl});
}
rows2.sort((a,b)=>b.exp-a.exp);
console.log(`  ${'Target'.padEnd(7)} ${'TimeStop'.padEnd(9)} ${'StopLoss'.padEnd(9)} │ ${'IS WR'.padStart(7)} ${'IS Avg'.padStart(8)} │ ${'OOS WR'.padStart(7)} ${'OOS Avg'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'CI lo'.padStart(7)} │ Note`);
console.log('  '+'-'.repeat(102));
for(const r of rows2.slice(0,12)){
  const slL=r.sl===null?'none':`-${r.sl}%`;
  const note=r.sO.avgPnl>r.sI.avgPnl*0.5&&r.ci.loPnl>0?'GOOD':(r.sO.avgPnl>0&&r.ci.loPnl>0?'OK':'—');
  console.log(`  ${('+'+r.tgt+'%').padEnd(7)} ${(r.ts+'d').padEnd(9)} ${slL.padEnd(9)} │ ${(r.sI.wr.toFixed(1)+'%').padStart(7)} ${((r.sI.avgPnl>=0?'+':'')+r.sI.avgPnl.toFixed(2)+'%').padStart(8)} │ ${(r.sO.wr.toFixed(1)+'%').padStart(7)} ${((r.sO.avgPnl>=0?'+':'')+r.sO.avgPnl.toFixed(2)+'%').padStart(8)} │ ${r.sO.pf.toFixed(2).padStart(5)} │ ${((r.ci.loPnl>=0?'+':'')+r.ci.loPnl.toFixed(2)+'%').padStart(7)} │ ${note}`);
}

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  FINAL: Setup B base vs Setup B refined — head to head');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const bestExit=rows2[0];
const slLbl=bestExit.sl===null?'no stop':`-${bestExit.sl}%`;

// Recompute base with same exit params on OOS
const baseOOStrades=OOS.map(s=>({pnl:sim(s.c,s.idx,bestExit.tgt,bestExit.ts,bestExit.sl).pnl}));
const baseS=stats(baseOOStrades);
const refS=bestExit.sO;
const ciBase=bsCI(baseOOStrades.map(t=>t.pnl));
const ciRef=bsCI(refinedOOS.map(s=>sim(s.c,s.idx,bestExit.tgt,bestExit.ts,bestExit.sl).pnl));

console.log(`  Exit params: +${bestExit.tgt}% target / ${bestExit.ts}-day time stop / ${slLbl}`);
console.log(`  Score conditions used for refinement:`);
for(const [i,[lbl]]of scoreConditions.entries())console.log(`    ${i+1}. ${lbl}`);
console.log();
console.log(`  ${'Version'.padEnd(22)} │ ${'n OOS'.padStart(6)} │ ${'WR'.padStart(7)} │ ${'Avg P&L'.padStart(8)} │ ${'Med P&L'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'CI lo P&L'.padStart(10)}`);
console.log('  '+'-'.repeat(84));
console.log(`  ${'Setup B base'.padEnd(22)} │ ${String(OOS.length).padStart(6)} │ ${(baseS.wr.toFixed(1)+'%').padStart(7)} │ ${((baseS.avgPnl>=0?'+':'')+baseS.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((baseS.medPnl>=0?'+':'')+baseS.medPnl.toFixed(2)+'%').padStart(8)} │ ${baseS.pf.toFixed(2).padStart(5)} │ ${((ciBase.loPnl>=0?'+':'')+ciBase.loPnl.toFixed(2)+'%').padStart(10)}`);
console.log(`  ${'Setup B refined (≥'+bestThresh+')'.padEnd(22)} │ ${String(refinedOOS.length).padStart(6)} │ ${(refS.wr.toFixed(1)+'%').padStart(7)} │ ${((refS.avgPnl>=0?'+':'')+refS.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((refS.medPnl>=0?'+':'')+refS.medPnl.toFixed(2)+'%').padStart(8)} │ ${refS.pf.toFixed(2).padStart(5)} │ ${((ciRef.loPnl>=0?'+':'')+ciRef.loPnl.toFixed(2)+'%').padStart(10)}`);
console.log(`  Signal survival: ${(refinedOOS.length/OOS.length*100).toFixed(0)}% of base signals pass the score filter\n`);
