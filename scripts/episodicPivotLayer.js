// ══════════════════════════════════════════════════════════════════════════════
// EPISODIC PIVOT (EP) LAYER — Backtest as HP15 Add-On Filter
// ══════════════════════════════════════════════════════════════════════════════
//
// StockBee definition: A stock is an Episodic Pivot when it makes a
//   ≥4% single-day price gain on ≥9 million share volume.
// This marks institutional accumulation on a catalyst (earnings, news, etc.)
//
// Tests:
//   A. EP on the signal candle itself        (same-day burst)
//   B. EP within 5 days before signal
//   C. EP within 10 days before signal
//   D. EP within 20 days before signal  ← likely sweet spot
//   E. EP within 30 days before signal
//   F. EP within 60 days before signal
//
// Also sweeps volume threshold (5M, 7M, 9M, 12M) and price threshold (3%, 4%, 5%)
// to find the optimal EP definition for NSE.
//
// Baseline: HP15 alone (236 trades, 60/40 IS/OOS)
// Goal: find EP layer that lifts OOS WR from 45.6% → ≥60% without losing too
//       many signals (minimum 30 OOS trades to stay statistically valid).
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DATA_DIRS = [
  'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV',
  'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX',
];

// ─── HP15 EXACT PARAMS ────────────────────────────────────────────────────────
const HP15 = {
  minAvgTurnover20:10e6,maxATRPct14Pctl120:85,maxPre10AvgRangeATR:1.0,maxPre10ExpansionCount:2,
  expansionATRMultiplier:1.1,zoneRangeATRThreshold:1.0,minZoneLen:5,maxZoneLen:25,
  maxZoneTightnessPct:8.0,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:1.10,
  maxPre10HighVolCount:4,highVolMultiplier:1.35,maxPre10RedVolBias:2.00,
  minExactRangeATR14:1.5,maxExactRangeATR14:5.0,minExactVolRatio20:1.5,minExactVolVsPre5:2.5,
  minCloseLoc:55,maxUpperWickPct:40,minBodyPct:20,maxCandleRisk:10.0,
  minUltraPrecisionScore:50,minRSI2:50,minVolatilityExpansionRatio:0.75,
  minCandleQualityScore:null,maxCloseAboveZonePct:6.0,
};

// ─── DATE NORMALIZATION ───────────────────────────────────────────────────────
const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
           Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
function normDate(d){
  if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
  const m=d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m?`${m[3]}-${MON[m[2]]||'01'}-${m[1].padStart(2,'0')}`:d;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function computeATR14(c){
  const a=new Array(c.length).fill(0);if(c.length<15)return a;
  let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
  a[14]=s/14;
  for(let i=15;i<c.length;i++){const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+tr)/14;}
  return a;
}
function atrPctl120(c,atr,idx){
  if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;
  let below=0;for(let j=idx-120;j<idx;j++)if(c[j].c>0&&atr[j]/c[j].c*100<cur)below++;
  return below/120*100;
}
function volAvg(c,idx,period){let s=0,n=0;for(let j=Math.max(0,idx-period);j<idx;j++){s+=c[j].v;n++;}return n>0?s/n:1;}
function findZone(c,atr,idx,p){
  const zC=[];
  for(let j=idx-1;j>=Math.max(0,idx-p.maxZoneLen);j--){
    if(atr[j]<=0)break;if((c[j].h-c[j].l)/atr[j]>p.zoneRangeATRThreshold)break;zC.unshift(j);
  }
  if(zC.length<p.minZoneLen)return null;
  let zH=-Infinity,zL=Infinity;for(const j of zC){zH=Math.max(zH,c[j].h);zL=Math.min(zL,c[j].l);}
  const zt=zL>0?(zH-zL)/zL*100:999;if(zt>p.maxZoneTightnessPct)return null;
  return{zoneHigh:zH,zoneLow:zL,zoneLen:zC.length,zt};
}
function calcUPS(cL,uW,bP,evp5,zt,zLen){
  let s=0;s+=cL>=80?20:cL>=65?12:0;s+=uW<=20?20:uW<=35?12:0;s+=bP>=55?15:bP>=35?9:0;
  s+=evp5>=4?20:evp5>=2?12:0;s+=zt<=5?15:zt<=15?9:0;s+=zLen>=12?10:zLen>=6?6:0;return s;
}
function calcCQS(cL,uW,bP,evp5,ver){let s=0;if(cL>=65)s++;if(uW<=30)s++;if(bP>=40)s++;if(evp5>=2.5)s++;if(ver>=1.5)s++;return s;}
function rsi2(c,idx){
  if(idx<2)return 50;const ch1=c[idx].c-c[idx-1].c,ch2=c[idx-1].c-c[idx-2].c;
  const g=((ch1>0?ch1:0)+(ch2>0?ch2:0))/2,l=((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
  return l<0.001?100:100-100/(1+g/l);
}
function screenHP15(c,atr,idx){
  const s=c[idx];if(!s||s.c<=0||atr[idx]<=0)return null;const p=HP15;
  let to=0;for(let j=idx-20;j<idx;j++)if(j>=0)to+=c[j].c*c[j].v;if(to/20<p.minAvgTurnover20)return null;
  if(atrPctl120(c,atr,idx)>p.maxATRPct14Pctl120)return null;
  let p10RS=0,p10N=0,expC=0;
  for(let j=idx-11;j<idx-1;j++){if(j<0||atr[j]<=0)continue;const ra=(c[j].h-c[j].l)/atr[j];p10RS+=ra;p10N++;if(ra>p.expansionATRMultiplier)expC++;}
  const p10A=p10N>0?p10RS/p10N:999;if(p10A>p.maxPre10AvgRangeATR)return null;if(expC>p.maxPre10ExpansionCount)return null;
  const zone=findZone(c,atr,idx,p);if(!zone)return null;
  const v20=volAvg(c,idx,20);
  let p10VRS=0,p10VRN=0,p5VRS=0,p5VRN=0,hvC=0,redVol=0,greenVol=0;
  for(let j=idx-11;j<idx-1;j++){
    if(j<0)continue;const vr=v20>0?c[j].v/v20:0;p10VRS+=vr;p10VRN++;
    if(j>=idx-6){p5VRS+=vr;p5VRN++;}if(vr>p.highVolMultiplier)hvC++;
    if(c[j].c<c[j].o)redVol+=c[j].v;else greenVol+=c[j].v;
  }
  if(p10VRN>0&&p10VRS/p10VRN>p.maxPre10AvgVolRatio)return null;
  if(p5VRN>0&&p5VRS/p5VRN>p.maxPre5AvgVolRatio)return null;
  if(hvC>p.maxPre10HighVolCount)return null;
  const rvb=greenVol>0?redVol/greenVol:(redVol>0?10:1);if(rvb>p.maxPre10RedVolBias)return null;
  const rng=s.h-s.l;if(rng<=0)return null;
  const eRA=rng/atr[idx],evr20=v20>0?s.v/v20:0,v5=volAvg(c,idx,5),evp5=v5>0?s.v/v5:0;
  const cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100;
  if(s.c<=zone.zoneHigh*1.001)return null;
  if(eRA<p.minExactRangeATR14||eRA>p.maxExactRangeATR14)return null;
  if(evr20<p.minExactVolRatio20)return null;if(evp5<p.minExactVolVsPre5)return null;
  if(cL<p.minCloseLoc)return null;if(uW>p.maxUpperWickPct)return null;if(bP<p.minBodyPct)return null;
  if(rng/s.c*100>p.maxCandleRisk)return null;
  const ver=p10A>0?eRA/p10A:0;if(ver<p.minVolatilityExpansionRatio)return null;
  const ups=calcUPS(cL,uW,bP,evp5,zone.zt,zone.zoneLen);if(ups<p.minUltraPrecisionScore)return null;
  if(rsi2(c,idx)<p.minRSI2)return null;
  if(p.minCandleQualityScore!=null&&calcCQS(cL,uW,bP,evp5,ver)<p.minCandleQualityScore)return null;
  if(p.maxCloseAboveZonePct!=null&&(s.c-zone.zoneHigh)/zone.zoneHigh*100>p.maxCloseAboveZonePct)return null;
  return{zone};
}

// ─── EPISODIC PIVOT CHECK ─────────────────────────────────────────────────────
// lookback=0 means signal candle itself
// lookback=N means any candle in [idx-N, idx] (inclusive)
// pctThresh: minimum single-day price gain (close vs prev close)
// volThresh: minimum volume in shares
function hasEP(c, idx, lookback, pctThresh, volThresh) {
  const start = Math.max(1, idx - lookback);
  for (let j = start; j <= idx; j++) {
    if (c[j].v < volThresh) continue;
    const prevClose = c[j-1].c;
    if (prevClose <= 0) continue;
    const dayReturn = (c[j].c - prevClose) / prevClose * 100;
    if (dayReturn >= pctThresh) return { day: j, ret: dayReturn, vol: c[j].v };
  }
  return null;
}

const tick=p=>Math.round(p/0.05)*0.05;
function gateCheck(stop,cd,prev,pp,candles,i){
  if(cd.c>stop)return'ABOVE';const dipPct=(stop-cd.c)/stop*100;if(dipPct<1.5)return'SHIELDED';
  if(i>=2){const ch1=cd.c-prev.c,ch2=prev.c-(pp?pp.c:prev.c);const g=((ch1>0?ch1:0)+(ch2>0?ch2:0))/2,l=((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;if((l<0.001?100:100-100/(1+g/l))<5)return'SHIELDED';}
  if(prev&&prev.c>stop)return'SHIELDED';if(prev&&cd.c>=prev.c)return'SHIELDED';
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
function simulateTrade(c,atr,idx,zone){
  const entry=c[idx].c;
  const stopRaw=zone.zoneLow-0.50*atr[idx];
  const floorStop=entry*(1-4/100),capStop=entry*(1-6.5/100);
  const stop=Math.min(Math.max(stopRaw,capStop),floorStop);
  const atrPct=atr[idx]/entry*100;
  const t1Pct=Math.max(4,Math.min(12,2.15*atrPct)),t1=tick(entry*(1+t1Pct/100));
  const t2Pct=t1Pct+atrPct,t2=tick(entry*(1+t2Pct/100));
  const t3BucketPct=atrPct<1.5?5:atrPct<=3?7:10;
  const t3Pct=Math.max(t3BucketPct,t2Pct+1.5*atrPct),t3=tick(Math.max(entry*(1+t3Pct/100),t2+0.05));
  let pos=1,pnl=0,status='expired',exitDay=0,trail=stop,t1H=false,t2H=false;
  for(let d=1;d<=Math.min(20,c.length-idx-1);d++){
    const ci=idx+d;if(ci>=c.length)break;
    const cd=c[ci],prev=c[ci-1],pp=ci>=2?c[ci-2]:null;
    if(!t1H&&cd.h>=t1&&pos>0){pnl+=0.50*(t1-entry)/entry*100;pos-=0.50;t1H=true;trail=entry;}
    if(t1H&&!t2H&&cd.h>=t2&&pos>0){pnl+=0.30*(t2-entry)/entry*100;pos-=0.30;t2H=true;trail=t1;}
    if(t2H&&cd.h>=t3&&pos>0){pnl+=pos*(t3-entry)/entry*100;status='hit_t3';exitDay=d;pos=0;break;}
    if(cd.c<=trail&&pos>0){const g=gateCheck(trail,cd,prev,pp,c.slice(idx),d);
      if(g==='STOPPED'){pnl+=pos*(cd.c-entry)/entry*100;status='stopped';exitDay=d;pos=0;break;}}
  }
  if(pos>0){const li=Math.min(idx+20,c.length-1);pnl+=pos*(c[li].c-entry)/entry*100;
    status=t1H?(t2H?'hit_t2':'hit_t1'):'expired';exitDay=li-idx;}
  const nd=normDate(c[idx].d);
  return{pnl,status,exitDay,year:nd.slice(0,7)};
}

function stats(trades){
  const n=trades.length;if(n===0)return{n:0,wr:0,avgPnl:0,medPnl:0,pf:0,maxDD:0};
  const wins=trades.filter(t=>t.pnl>0);const wr=wins.length/n*100;
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  const sorted=[...trades].map(t=>t.pnl).sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const medPnl=sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
  const gW=wins.reduce((s,t)=>s+t.pnl,0),gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  let peak=0,maxDD=0,eq=0;for(const t of trades){eq+=t.pnl;if(eq>peak)peak=eq;if(peak-eq>maxDD)maxDD=peak-eq;}
  return{n,wr,avgPnl,medPnl,pf,maxDD};
}
function bootstrapWR(trades,B=1000){
  if(trades.length<5)return{lo:0,hi:100};
  const wrs=[];for(let b=0;b<B;b++){let w=0;for(let i=0;i<trades.length;i++)if(trades[Math.floor(Math.random()*trades.length)].pnl>0)w++;wrs.push(w/trades.length*100);}
  wrs.sort((a,b)=>a-b);return{lo:wrs[25],hi:wrs[974]};
}

// ─── LOAD STOCKS ─────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  EPISODIC PIVOT (EP) LAYER — Backtest as HP15 Add-On');
console.log('  EP Definition: single-day ≥4% gain on ≥9M share volume (StockBee)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const seen=new Set(),stocks=[];
for(const dir of DATA_DIRS){
  if(!fs.existsSync(dir))continue;
  for(const f of fs.readdirSync(dir)){
    if(!f.endsWith('.csv'))continue;
    const sym=f.replace(/_NS_OHLCV\.csv$|_NSE_OHLCV\.csv$|\.csv$/i,'');
    if(seen.has(sym))continue;
    try{
      const raw=fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n');
      const c=[];
      for(let i=1;i<raw.length;i++){
        const p=raw[i].split(',');if(p.length<5||isNaN(+p[4])||+p[4]<=0)continue;
        c.push({d:normDate(p[0].trim()),o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0});
      }
      if(c.length<200)continue;seen.add(sym);stocks.push({sym,c,atr:computeATR14(c)});
    }catch{}
  }
}
console.log(`Loaded ${stocks.length} stocks\n`);

// ─── COLLECT ALL HP15 SIGNALS + EP METADATA ──────────────────────────────────
// For each signal we pre-compute every EP lookback so we only scan once.
const LOOKBACKS   = [0, 5, 10, 20, 30, 60];  // 0 = signal candle itself
const PCT_THRESH  = 4.0;   // % gain threshold
const VOL_THRESH  = 9e6;   // 9 million shares

const allSignals = [];  // { pnl, status, exitDay, year, splitTag, ep: {lb0..lb60} }

for(const {sym,c,atr} of stocks){
  const splitIdx=Math.floor(c.length*0.60);
  let lastExit=-1;
  for(let i=130;i<c.length-21;i++){
    if(i<=lastExit)continue;
    const sig=screenHP15(c,atr,i);if(!sig)continue;
    const trade=simulateTrade(c,atr,i,sig.zone);
    // Pre-compute EP flags for every lookback
    const epFlags={};
    for(const lb of LOOKBACKS) epFlags[`lb${lb}`]=!!hasEP(c,i,lb,PCT_THRESH,VOL_THRESH);
    allSignals.push({...trade,splitTag:i<splitIdx?'IS':'OOS',sym,idx:i,epFlags});
    lastExit=i+Math.max(trade.exitDay,5);
  }
}

const baseAll=allSignals;
const baseIS =allSignals.filter(t=>t.splitTag==='IS');
const baseOOS=allSignals.filter(t=>t.splitTag==='OOS');

console.log(`Total HP15 signals: ${allSignals.length}  (IS: ${baseIS.length}, OOS: ${baseOOS.length})\n`);

// ─── SECTION 1: LOOKBACK SWEEP (fixed 4%/9M, vary lookback) ──────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 1: LOOKBACK WINDOW SWEEP  (EP: ≥4% gain, ≥9M volume)');
console.log('  How many days before the HP15 signal should the EP have occurred?');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

console.log(`  ${'Lookback'.padEnd(12)} │ ${'IS n'.padStart(5)} │ ${'IS WR'.padStart(7)} │ ${'IS P&L'.padStart(8)} │ ${'OOS n'.padStart(6)} │ ${'OOS WR'.padStart(7)} │ ${'OOS P&L'.padStart(8)} │ ${'ΔWR'.padStart(6)} │ ${'CI lo'.padStart(7)} │ Verdict`);
console.log('  '+'-'.repeat(108));

// Baseline row
{
  const sB=stats(baseIS),sO=stats(baseOOS),bCI=bootstrapWR(baseOOS);
  const dWR=sO.wr-sB.wr;
  console.log(`  ${'BASELINE'.padEnd(12)} │ ${String(sB.n).padStart(5)} │ ${(sB.wr.toFixed(1)+'%').padStart(7)} │ ${((sB.avgPnl>=0?'+':'')+sB.avgPnl.toFixed(2)+'%').padStart(8)} │ ${String(sO.n).padStart(6)} │ ${(sO.wr.toFixed(1)+'%').padStart(7)} │ ${((sO.avgPnl>=0?'+':'')+sO.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((dWR>=0?'+':'')+dWR.toFixed(0)+'pp').padStart(6)} │ ${(bCI.lo.toFixed(1)+'%').padStart(7)} │ (no EP filter)`);
}

const lbResults = {};
for(const lb of LOOKBACKS){
  const lbKey=`lb${lb}`;
  const filtIS  = baseIS.filter(t=>t.epFlags[lbKey]);
  const filtOOS = baseOOS.filter(t=>t.epFlags[lbKey]);
  const sIS=stats(filtIS),sOOS=stats(filtOOS),bCI=bootstrapWR(filtOOS);
  const dWR=sOOS.wr-sIS.wr;
  const lbl = lb===0?'Same day':lb===5?'≤5d prior':lb===10?'≤10d prior':lb===20?'≤20d prior':lb===30?'≤30d prior':'≤60d prior';
  const verdict = sOOS.n<10?'⚠ too few':sOOS.wr>=60&&dWR>=-8?'✅ strong':sOOS.wr>=55&&dWR>=-12?'🟡 moderate':sOOS.wr>stats(baseOOS).wr+5?'🟢 better':'🔴 no gain';
  console.log(`  ${lbl.padEnd(12)} │ ${String(sIS.n).padStart(5)} │ ${(sIS.wr.toFixed(1)+'%').padStart(7)} │ ${((sIS.avgPnl>=0?'+':'')+sIS.avgPnl.toFixed(2)+'%').padStart(8)} │ ${String(sOOS.n).padStart(6)} │ ${(sOOS.wr.toFixed(1)+'%').padStart(7)} │ ${((sOOS.avgPnl>=0?'+':'')+sOOS.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((dWR>=0?'+':'')+dWR.toFixed(0)+'pp').padStart(6)} │ ${(bCI.lo.toFixed(1)+'%').padStart(7)} │ ${verdict}`);
  lbResults[lb]={sIS,sOOS,filtIS,filtOOS,bCI,dWR};
}

// ─── SECTION 2: THRESHOLD SWEEP (fixed 20d lookback, vary pct/vol) ───────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 2: THRESHOLD SWEEP  (20-day lookback, vary % gain and volume)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const PCT_OPTIONS = [3.0, 4.0, 5.0, 6.0];
const VOL_OPTIONS = [3e6, 5e6, 7e6, 9e6, 12e6];

console.log(`  ${'EP def (pct/vol)'.padEnd(18)} │ ${'OOS n'.padStart(6)} │ ${'OOS WR'.padStart(7)} │ ${'OOS P&L'.padStart(8)} │ ${'CI lo'.padStart(7)} │ ${'IS WR'.padStart(7)} │ ${'ΔWR'.padStart(6)} │ Note`);
console.log('  '+'-'.repeat(95));

let bestOosWR=0,bestCfg=null;
for(const pct of PCT_OPTIONS){
  for(const vol of VOL_OPTIONS){
    // Compute per-signal EP flag for this threshold
    const filtIS=[],filtOOS=[];
    for(const sig of allSignals){
      const {sym,idx}=sig;
      const stock=stocks.find(s=>s.sym===sym);if(!stock)continue;
      const ep=hasEP(stock.c,idx,20,pct,vol);
      if(ep){if(sig.splitTag==='IS')filtIS.push(sig);else filtOOS.push(sig);}
    }
    const sOOS=stats(filtOOS),sIS=stats(filtIS),bCI=bootstrapWR(filtOOS);
    const dWR=sOOS.wr-sIS.wr;
    const volM=(vol/1e6).toFixed(0)+'M';
    const label=`${pct}% / ${volM}`;
    const note=sOOS.n<10?'⚠ few':sOOS.wr>=60&&sOOS.n>=20?'✅':sOOS.wr>=55?'🟡':'';
    console.log(`  ${label.padEnd(18)} │ ${String(sOOS.n).padStart(6)} │ ${(sOOS.wr.toFixed(1)+'%').padStart(7)} │ ${((sOOS.avgPnl>=0?'+':'')+sOOS.avgPnl.toFixed(2)+'%').padStart(8)} │ ${(bCI.lo.toFixed(1)+'%').padStart(7)} │ ${(sIS.wr.toFixed(1)+'%').padStart(7)} │ ${((dWR>=0?'+':'')+dWR.toFixed(0)+'pp').padStart(6)} │ ${note}`);
    if(sOOS.n>=15&&sOOS.wr>bestOosWR){bestOosWR=sOOS.wr;bestCfg={pct,vol,sOOS,sIS,filtIS,filtOOS,bCI};}
  }
}

// ─── SECTION 3: BEST CONFIG — DEEP DIVE ──────────────────────────────────────
// Find best lookback from section 1
let bestLB=20,bestLBwr=0;
for(const [lb,r] of Object.entries(lbResults)){
  if(r.filtOOS.length>=15&&r.sOOS.wr>bestLBwr){bestLBwr=r.sOOS.wr;bestLB=+lb;}
}
const bestLBResult=lbResults[bestLB];

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(`  SECTION 3: DEEP DIVE — Best Config Found`);
if(bestCfg){
  const vM=(bestCfg.vol/1e6).toFixed(0)+'M';
  console.log(`  EP: ≥${bestCfg.pct}% gain, ≥${vM} volume, within 20-day lookback`);
}
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const deepIS  = bestCfg?bestCfg.filtIS:bestLBResult.filtIS;
const deepOOS = bestCfg?bestCfg.filtOOS:bestLBResult.filtOOS;
const deepSIS = stats(deepIS), deepSOOS = stats(deepOOS);
const deepCI  = bootstrapWR(deepOOS);
const deepDWR = deepSOOS.wr - deepSIS.wr;

// WF folds
console.log('  ANCHORED WALK-FORWARD (5 folds):');
console.log(`  Fold │ Test window │ Base WR │ Base n │  EP WR  │ EP n  │  ΔWR`);
console.log(`  ─────┼─────────────┼─────────┼────────┼─────────┼───────┼──────`);

const FOLD_N=5;
const wfBase=[],wfEP=[];
for(let f=0;f<FOLD_N;f++){
  const tS=(f+1)/(FOLD_N+1),tE=(f+2)/(FOLD_N+1);
  const bFold=[],epFold=[];
  for(const {sym,c,atr} of stocks){
    const ts=Math.floor(c.length*tS),te=Math.floor(c.length*tE);
    let le=-1;
    for(let i=Math.max(130,ts);i<Math.min(te,c.length-21);i++){
      if(i<=le)continue;
      const sig=screenHP15(c,atr,i);if(!sig)continue;
      const trade=simulateTrade(c,atr,i,sig.zone);
      bFold.push(trade);
      // EP check with best config
      const pct=bestCfg?bestCfg.pct:PCT_THRESH;
      const vol=bestCfg?bestCfg.vol:VOL_THRESH;
      if(hasEP(c,i,20,pct,vol))epFold.push(trade);
      le=i+Math.max(trade.exitDay,5);
    }
  }
  const sB=stats(bFold),sE=stats(epFold);
  const dWR=sE.wr-sB.wr;
  const tLabel=`${Math.round(tS*100)}–${Math.round(tE*100)}%`;
  console.log(`  WF${f+1}  │ ${tLabel.padEnd(11)} │ ${(sB.wr.toFixed(1)+'%').padStart(7)} │ ${String(sB.n).padStart(6)} │ ${(sE.wr.toFixed(1)+'%').padStart(7)} │ ${String(sE.n).padStart(5)} │ ${(dWR>=0?'+':'')+dWR.toFixed(0)}pp`);
  wfBase.push(sB);wfEP.push(sE);
}

// Per-year deep dive
console.log('\n  PER-YEAR: Base vs EP filter');
console.log(`  ${'Year'.padEnd(8)} │ ${'Base n'.padStart(6)} │ ${'Base WR'.padStart(8)} │ ${'EP n'.padStart(5)} │ ${'EP WR'.padStart(7)} │ ${'EP P&L'.padStart(8)} │  ΔWR`);
console.log('  '+'-'.repeat(70));
const byYearBase={},byYearEP={};
for(const t of baseAll){if(!byYearBase[t.year])byYearBase[t.year]=[];byYearBase[t.year].push(t);}
for(const t of deepIS.concat(deepOOS)){if(!byYearEP[t.year])byYearEP[t.year]=[];byYearEP[t.year].push(t);}
for(const yr of Object.keys(byYearBase).sort()){
  const bA=byYearBase[yr]||[],eA=byYearEP[yr]||[];
  if(bA.length<2&&eA.length<2)continue;
  const sB=stats(bA),sE=stats(eA);
  const dWR=eA.length>0&&bA.length>0?sE.wr-sB.wr:null;
  const flag=dWR!==null?(dWR>=5?'▲':(dWR<=-5?'▼':' ')):'';
  console.log(`  ${yr.padEnd(8)} │ ${String(sB.n).padStart(6)} │ ${(sB.wr.toFixed(1)+'%').padStart(8)} │ ${String(sE.n).padStart(5)} │ ${(sE.wr.toFixed(1)+'%').padStart(7)} │ ${((sE.avgPnl>=0?'+':'')+sE.avgPnl.toFixed(2)+'%').padStart(8)} │ ${dWR!==null?((dWR>=0?'+':'')+dWR.toFixed(0)+'pp '+flag):'—'}`);
}

// ─── SECTION 4: EP SIGNAL ANATOMY ────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 4: EP ANATOMY — What do EP-tagged HP15 signals look like?');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// For each HP15 OOS signal, compute days since the EP event
const epDaysStats=[];
for(const sig of baseOOS){
  const stock=stocks.find(s=>s.sym===sig.sym);if(!stock)continue;
  const ep=hasEP(stock.c,sig.idx,20,PCT_THRESH,VOL_THRESH);
  if(ep)epDaysStats.push({daysSinceEP:sig.idx-ep.day,epRet:ep.ret,epVol:ep.vol,tradePnl:sig.pnl});
}
if(epDaysStats.length>0){
  const wins=epDaysStats.filter(t=>t.tradePnl>0),losses=epDaysStats.filter(t=>t.tradePnl<=0);
  const avgDaysW=wins.length>0?wins.reduce((s,t)=>s+t.daysSinceEP,0)/wins.length:0;
  const avgDaysL=losses.length>0?losses.reduce((s,t)=>s+t.daysSinceEP,0)/losses.length:0;
  const avgEPretW=wins.length>0?wins.reduce((s,t)=>s+t.epRet,0)/wins.length:0;
  const avgEPretL=losses.length>0?losses.reduce((s,t)=>s+t.epRet,0)/losses.length:0;
  console.log(`  EP-tagged OOS signals: ${epDaysStats.length}`);
  console.log(`  Wins (${wins.length}):   avg days since EP: ${avgDaysW.toFixed(1)}  │  avg EP return: +${avgEPretW.toFixed(1)}%`);
  console.log(`  Losses (${losses.length}): avg days since EP: ${avgDaysL.toFixed(1)}  │  avg EP return: +${avgEPretL.toFixed(1)}%`);
  // Days-since-EP distribution
  const buckets={'0–3d':0,'4–7d':0,'8–14d':0,'15–20d':0};
  for(const e of epDaysStats){
    const d=e.daysSinceEP;
    if(d<=3)buckets['0–3d']++;else if(d<=7)buckets['4–7d']++;else if(d<=14)buckets['8–14d']++;else buckets['15–20d']++;
  }
  console.log(`\n  Days since EP → HP15 signal distribution:`);
  for(const[k,v]of Object.entries(buckets)){
    const pct=epDaysStats.length>0?v/epDaysStats.length*100:0;
    const wins_in_bucket=epDaysStats.filter(e=>{const d=e.daysSinceEP;if(k==='0–3d')return d<=3;if(k==='4–7d')return d>3&&d<=7;if(k==='8–14d')return d>7&&d<=14;return d>14;}).filter(e=>e.tradePnl>0).length;
    const n_in_bucket=v;
    const bWR=n_in_bucket>0?wins_in_bucket/n_in_bucket*100:0;
    console.log(`    ${k.padEnd(7)}: ${String(v).padStart(3)} signals  WR ${bWR.toFixed(0)}%  ${'█'.repeat(Math.round(pct/5))}  (${pct.toFixed(0)}% of EP signals)`);
  }
}

// ─── FINAL VERDICT ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  FINAL VERDICT — Should EP be added as an HP15 layer?');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const baseOOSstats=stats(baseOOS);
console.log(`  Metric               HP15 Baseline    HP15 + EP (best)`);
console.log(`  ${'─'.repeat(55)}`);
console.log(`  IS signals           ${String(baseIS.length).padStart(9)}        ${String(deepIS.length).padStart(9)}`);
console.log(`  IS Win Rate          ${(stats(baseIS).wr.toFixed(1)+'%').padStart(9)}        ${(deepSIS.wr.toFixed(1)+'%').padStart(9)}`);
console.log(`  OOS signals          ${String(baseOOS.length).padStart(9)}        ${String(deepOOS.length).padStart(9)}`);
console.log(`  OOS Win Rate         ${(baseOOSstats.wr.toFixed(1)+'%').padStart(9)}        ${(deepSOOS.wr.toFixed(1)+'%').padStart(9)}`);
console.log(`  OOS Avg P&L          ${((baseOOSstats.avgPnl>=0?'+':'')+baseOOSstats.avgPnl.toFixed(2)+'%').padStart(9)}        ${((deepSOOS.avgPnl>=0?'+':'')+deepSOOS.avgPnl.toFixed(2)+'%').padStart(9)}`);
console.log(`  OOS Median P&L       ${((baseOOSstats.medPnl>=0?'+':'')+baseOOSstats.medPnl.toFixed(2)+'%').padStart(9)}        ${((deepSOOS.medPnl>=0?'+':'')+deepSOOS.medPnl.toFixed(2)+'%').padStart(9)}`);
console.log(`  OOS 95% CI lo        ${(bootstrapWR(baseOOS).lo.toFixed(1)+'%').padStart(9)}        ${(deepCI.lo.toFixed(1)+'%').padStart(9)}`);
console.log(`  IS→OOS WR drop       ${((baseOOSstats.wr-stats(baseIS).wr>=0?'+':'')+(baseOOSstats.wr-stats(baseIS).wr).toFixed(1)+'pp').padStart(9)}        ${((deepDWR>=0?'+':'')+deepDWR.toFixed(1)+'pp').padStart(9)}`);
console.log(`  Signal survival      ${'100%'.padStart(9)}        ${(deepOOS.length/baseOOS.length*100).toFixed(0)+'%' .padStart(9)}`);
console.log();

const oosLift = deepSOOS.wr - baseOOSstats.wr;
if(deepSOOS.n<10){
  console.log('  ⚠  INSUFFICIENT DATA — EP filter removes too many signals. Cannot conclude.');
}else if(oosLift>=8&&deepSOOS.wr>=55&&deepCI.lo>=50){
  console.log(`  ✅ CONFIRMED — EP layer adds significant value (+${oosLift.toFixed(1)}pp OOS WR, CI>${deepCI.lo.toFixed(0)}%)`);
  console.log(`     Recommend: add EP (≥${bestCfg?.pct||4}% / ≥${((bestCfg?.vol||9e6)/1e6).toFixed(0)}M vol, ≤20d lookback) to HP15 screener`);
}else if(oosLift>=3&&deepSOOS.wr>=50){
  console.log(`  🟡 MARGINAL — EP adds +${oosLift.toFixed(1)}pp OOS WR but CI lo is ${deepCI.lo.toFixed(0)}%. Consider as soft preference, not hard filter.`);
}else if(oosLift<0){
  console.log(`  🔴 NEGATIVE — EP filter removes better trades than it keeps. Do not add.`);
}else{
  console.log(`  🟡 NEUTRAL — EP adds minimal lift (+${oosLift.toFixed(1)}pp). Collect more data before deciding.`);
}
console.log('\n══════════════════════════════════════════════════════════════════════════════\n');
