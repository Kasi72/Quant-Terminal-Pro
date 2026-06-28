// WALK-FORWARD + OUT-OF-SAMPLE VALIDATION — All 5 param sets
// Split: Train (data before 2024) | Test OOS (2024-2026)
// Full accurate 21-filter pipeline, 77 stocks
// Tests for overfitting: if WR degrades >15% on OOS → overfit

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({date:p[0],o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({date:p[0],o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function computeATR14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function computeRSI2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}const ag=g/2,al=l/2;r[i]=al===0?100:100-100/(1+ag/al);}return r;}
function atrPctl120(c,atr,idx){if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;let below=0;for(let j=idx-120;j<idx;j++){const v=c[j].c>0?atr[j]/c[j].c*100:0;if(v<cur)below++;}return below/120*100;}

function dateYear(d) {
  if (!d) return 2020;
  const parts = d.split('-');
  if (parts[0].length === 4) return parseInt(parts[0]); // 2024-01-01
  if (parts.length === 3) {
    const y = parseInt(parts[2]);
    if (y > 100) return y; // DD-Mon-YYYY
    return y < 50 ? 2000 + y : 1900 + y;
  }
  return 2020;
}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr:computeATR14(c),rsi:computeRSI2(c)});}}
console.log('Stocks: ' + SD.length);

function sim(P, dateFilter) {
  const trades=[];
  for(const{sym,c,atr,rsi}of SD){const n=c.length;
  for(let i=130;i<n-11;i++){
    if(atr[i]<=0||c[i].c<=0)continue;
    if(dateFilter && !dateFilter(c[i].date)) continue;
    const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
    let avgTO=0;for(let j=i-20;j<i;j++)avgTO+=c[j].c*c[j].v;avgTO/=20;
    if(avgTO<P.to)continue;
    if(atrPctl120(c,atr,i)>P.ap)continue;
    const eRA=rng/atr[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100,sigR=rng/s.c*100;
    let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;
    let v5=0;for(let j=i-5;j<i;j++)v5+=c[j].v;v5/=5;
    const eVR=v20>0?s.v/v20:0,eVP=v5>0?s.v/v5:0;
    let p10R=0,p10E=0,p10V=0,p10HV=0,p10RB=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;const rA=(c[j].h-c[j].l)/(atr[j]||1);p10R+=rA;if(rA>P.em)p10E++;const vr=v20>0?c[j].v/v20:0;p10V+=vr;if(vr>P.hm)p10HV++;if(c[j].c<c[j].o)p10RB+=vr;}
    p10R/=10;p10V/=10;p10RB/=10;
    let p5V=0;for(let j=i-5;j<i;j++){if(j>=0)p5V+=(v20>0?c[j].v/v20:0);}p5V/=5;
    const vER=p10R>0?eRA/p10R:0;
    if(p10R>P.pr)continue;if(p10E>P.pe)continue;if(p10V>P.pv)continue;if(p5V>P.p5)continue;
    if(p10HV>P.ph)continue;if(p10RB>P.rb)continue;
    if(eRA<P.er||eRA>P.ex)continue;if(eVR<P.vr)continue;if(eVP<P.vp)continue;
    if(cL<P.cl)continue;if(uW>P.uw)continue;if(bP<P.bp)continue;if(sigR>P.sr)continue;
    if(P.ve!=null&&vER<P.ve)continue;
    let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP>=2.5)cq++;if(eRA>=1.5)cq++;
    if(P.cq!=null&&cq<P.cq)continue;
    if(rsi[i]<P.rs)continue;
    let zone=null;
    for(let zL=P.mxz;zL>=P.mnz;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>P.za)ok=false;}
      if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>P.mt)continue;
      const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
      zone={zH,zL:zLo,len:zL,t};break;}
    if(!zone)continue;if(s.c<=zone.zH*1.001)continue;
    if(P.caz!=null){const cabp=zone.zH>0?(s.c-zone.zH)/zone.zH*100:0;if(cabp>P.caz)continue;}
    let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
    if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP>=4)ups+=20;else if(eVP>=2)ups+=12;
    if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
    if(ups<P.up)continue;
    const rawSt=zone.zL-0.5*atr[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
    const aP=atr[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP));
    let mfe=0,out='exp',hT1=false;
    for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100;if(hp>mfe)mfe=hp;
      if(cd.c<=stP&&!hT1){out='stop';break;}if(cd.h>=s.c*(1+t1P/100))hT1=true;}
    if(out!=='stop')out=hT1?'hit':'exp';
    const exitP=out==='stop'?stP:hT1?s.c*(1+t1P/100):c[Math.min(i+10,n-1)].c;
    trades.push({sym,out,pnl:(exitP-s.c)/s.c*100,mfe,date:s.date});
  }}
  if(trades.length===0)return{n:0,w:0,st:0,exp:0,wr:0,fs:0,avgPnl:0,pf:0};
  const w=trades.filter(t=>t.out==='hit'),st=trades.filter(t=>t.out==='stop');
  const wr=w.length/trades.length*100;
  const gW=w.reduce((s,t)=>s+t.pnl,0),gL=Math.abs(st.reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:w.length>0?99:0;
  const fs=st.length>0?st.filter(t=>t.mfe>=3).length/st.length*100:0;
  const avgW=w.length>0?gW/w.length:0,avgL=st.length>0?Math.abs(gL/st.length):0;
  const exp=(wr/100)*avgW-(1-wr/100)*avgL;
  return{n:trades.length,w:w.length,st:st.length,exp:trades.length-w.length-st.length,wr,fs,avgPnl:trades.reduce((s,t)=>s+t.pnl,0)/trades.length,pf,avgW,avgL,expectancy:exp,trades};
}

const SETS = {
  'D20+ v9-80': {to:10000000,ap:50,pr:0.75,pe:1,em:1.1,za:1.0,mnz:5,mxz:25,mt:5,pv:0.90,p5:0.90,ph:4,hm:1.35,rb:2.0,er:1.6,ex:5.0,vr:1.40,vp:2.50,cl:75,uw:45,bp:50,sr:6,up:60,rs:50,ve:1.75,cq:2,caz:null},
  'HP15+ v9-80': {to:10000000,ap:85,pr:0.75,pe:1,em:1.1,za:1.0,mnz:5,mxz:25,mt:8,pv:0.90,p5:1.10,ph:4,hm:1.35,rb:2.0,er:1.2,ex:5.0,vr:2.50,vp:2.00,cl:75,uw:40,bp:30,sr:10,up:50,rs:50,ve:2.25,cq:null,caz:6.0},
  'E10+ v9-80': {to:20000000,ap:40,pr:0.90,pe:3,em:1.1,za:0.95,mnz:7,mxz:25,mt:5,pv:1.00,p5:1.10,ph:2,hm:1.2,rb:2.0,er:1.6,ex:6.0,vr:1.80,vp:2.00,cl:50,uw:35,bp:25,sr:5,up:25,rs:50,ve:1.25,cq:2,caz:null},
  'US8+ v9-80': {to:10000000,ap:30,pr:0.80,pe:0,em:1.1,za:0.95,mnz:8,mxz:25,mt:6,pv:0.90,p5:0.95,ph:0,hm:1.5,rb:2.0,er:1.5,ex:6.0,vr:1.60,vp:2.50,cl:50,uw:35,bp:40,sr:8.5,up:45,rs:50,ve:1.50,cq:4,caz:null},
  'Sniper 95+': {to:10000000,ap:50,pr:0.80,pe:1,em:1.1,za:1.0,mnz:4,mxz:25,mt:3,pv:0.90,p5:1.10,ph:0,hm:1.35,rb:2.0,er:1.6,ex:5.0,vr:1.40,vp:1.50,cl:65,uw:45,bp:30,sr:6,up:20,rs:50,ve:2.50,cq:2,caz:null},
};

const trainFilter = d => dateYear(d) < 2024;
const testFilter = d => dateYear(d) >= 2024;

console.log('='.repeat(90));
console.log('  WALK-FORWARD + OOS VALIDATION — All 5 Param Sets');
console.log('  Train: all data before 2024 | Test OOS: 2024-2026');
console.log('  Full 21-filter pipeline, ' + SD.length + ' stocks');
console.log('='.repeat(90));

console.log('\n  Set            | Period     | Sigs | Wins | Stops | Exp | WR     | PF    | FS%  | AvgPnl | Expectancy');
console.log('  ---------------+------------+------+------+-------+-----+--------+-------+------+--------+----------');

const verdicts = [];

for (const [name, params] of Object.entries(SETS)) {
  const full = sim(params, null);
  const train = sim(params, trainFilter);
  const test = sim(params, testFilter);

  const fmt = (label, r) => {
    if (r.n === 0) return `  ${name.padEnd(15)}| ${label.padEnd(10)} |    0 |    — |     — |   — |      — |     — |    — |      — |        —`;
    return `  ${name.padEnd(15)}| ${label.padEnd(10)} | ${String(r.n).padStart(4)} | ${String(r.w).padStart(4)} | ${String(r.st).padStart(5)} | ${String(r.exp).padStart(3)} | ${r.wr.toFixed(1).padStart(5)}% | ${r.pf.toFixed(2).padStart(5)} | ${r.fs.toFixed(0).padStart(3)}% | ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(2).padStart(5)}% | ${(r.expectancy>=0?'+':'')+r.expectancy.toFixed(2)}%`;
  };

  console.log(fmt('FULL', full));
  console.log(fmt('TRAIN<2024', train));
  console.log(fmt('TEST≥2024', test));

  // Overfitting check
  const wrDelta = test.n > 0 ? test.wr - train.wr : 0;
  const verdict = test.n === 0 ? 'NO OOS DATA' :
    test.n < 3 ? 'TOO FEW OOS SIGNALS' :
    wrDelta >= -5 ? 'ROBUST — no overfitting' :
    wrDelta >= -15 ? 'MILD DEGRADATION' :
    'OVERFIT — WR dropped ' + Math.abs(wrDelta).toFixed(0) + '%';
  verdicts.push({ name, full, train, test, wrDelta, verdict });

  console.log(`  ${' '.repeat(15)}| VERDICT    | ${verdict}`);
  console.log('  ---------------+------------+------+------+-------+-----+--------+-------+------+--------+----------');
}

// Also test: rolling walk-forward (train on 3 years, test on next 1 year)
console.log('\n' + '='.repeat(90));
console.log('  ROLLING WALK-FORWARD (3-year train → 1-year test windows)');
console.log('='.repeat(90));

for (const [name, params] of Object.entries(SETS)) {
  console.log('\n  ' + name + ':');
  console.log('  Window              | Train Sigs | Train WR | Test Sigs | Test WR  | Δ WR    | Hold?');
  console.log('  --------------------+------------+----------+-----------+----------+---------+------');

  for (const testYear of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const trainStart = testYear - 3;
    const trnF = d => { const y = dateYear(d); return y >= trainStart && y < testYear; };
    const tstF = d => dateYear(d) === testYear;

    const trn = sim(params, trnF);
    const tst = sim(params, tstF);

    if (trn.n < 3 && tst.n < 1) continue;

    const delta = tst.n > 0 && trn.n > 0 ? tst.wr - trn.wr : 0;
    const hold = tst.n === 0 ? '—' : tst.n < 3 ? '?' : delta >= -10 ? '✓' : '✗';

    console.log(`  ${trainStart}-${testYear-1} → ${testYear}     | ${String(trn.n).padStart(10)} | ${trn.n>0?trn.wr.toFixed(1).padStart(7)+'%':'      —'} | ${String(tst.n).padStart(9)} | ${tst.n>0?tst.wr.toFixed(1).padStart(7)+'%':'      —'} | ${tst.n>0&&trn.n>0?(delta>=0?'+':'')+delta.toFixed(1)+'%':'     —'} | ${hold}`);
  }
}

// Monte Carlo shuffled backtest
console.log('\n' + '='.repeat(90));
console.log('  MONTE CARLO ROBUSTNESS — Shuffle win/loss labels 500 times');
console.log('  If real WR is within random shuffle range → no edge (overfit)');
console.log('='.repeat(90));

for (const [name, params] of Object.entries(SETS)) {
  const full = sim(params, null);
  if (full.n < 5) { console.log('\n  ' + name + ': too few signals for Monte Carlo'); continue; }

  // Shuffle outcomes 500 times
  const shuffledWRs = [];
  for (let mc = 0; mc < 500; mc++) {
    // Create shuffled copy of outcomes
    const outcomes = full.trades.map(t => t.out);
    // Fisher-Yates shuffle
    for (let i = outcomes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }
    const shuffledWins = outcomes.filter(o => o === 'hit').length;
    shuffledWRs.push(shuffledWins / outcomes.length * 100);
  }

  shuffledWRs.sort((a, b) => a - b);
  const p95 = shuffledWRs[Math.floor(shuffledWRs.length * 0.95)];
  const p99 = shuffledWRs[Math.floor(shuffledWRs.length * 0.99)];
  const avgShuffled = shuffledWRs.reduce((s, v) => s + v, 0) / shuffledWRs.length;

  const realAboveRandom = full.wr > p95;
  const significance = full.wr > p99 ? 'p<0.01 SIGNIFICANT' : full.wr > p95 ? 'p<0.05 SIGNIFICANT' : 'NOT SIGNIFICANT — possible overfit';

  console.log(`\n  ${name}:`);
  console.log(`    Real WR:     ${full.wr.toFixed(1)}% (${full.n} signals)`);
  console.log(`    Shuffled avg: ${avgShuffled.toFixed(1)}%`);
  console.log(`    Shuffled 95th: ${p95.toFixed(1)}%`);
  console.log(`    Shuffled 99th: ${p99.toFixed(1)}%`);
  console.log(`    Verdict: ${significance}`);
}

// Final summary
console.log('\n' + '='.repeat(90));
console.log('  FINAL OVERFITTING VERDICT');
console.log('='.repeat(90));

console.log('\n  Set            | Full WR | Train WR | OOS WR  | Δ OOS   | OOS Sigs | Verdict');
console.log('  ---------------+---------+----------+---------+---------+----------+--------');
for (const v of verdicts) {
  console.log(`  ${v.name.padEnd(15)}| ${v.full.wr.toFixed(1).padStart(6)}% | ${v.train.n>0?v.train.wr.toFixed(1).padStart(7)+'%':'      —'} | ${v.test.n>0?v.test.wr.toFixed(1).padStart(6)+'%':'     —'} | ${v.test.n>0?(v.wrDelta>=0?'+':'')+v.wrDelta.toFixed(1)+'%':'     —'} | ${String(v.test.n).padStart(8)} | ${v.verdict}`);
}
