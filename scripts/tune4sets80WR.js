// TUNE ALL 4 PARAM SETS TO >80% WR
// Full accurate 21-filter pipeline, 77 stocks, 491K candle-days
// Phase 1: Single-param sweep (5 rounds)
// Phase 2: 2-param interaction search
// Phase 3: Final convergence
// Each set gets its own minimum signal threshold

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function computeATR14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function computeRSI2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}const ag=g/2,al=l/2;r[i]=al===0?100:100-100/(1+ag/al);}return r;}
function atrPctl120(c,atr,idx){if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;let below=0;for(let j=idx-120;j<idx;j++){const v=c[j].c>0?atr[j]/c[j].c*100:0;if(v<cur)below++;}return below/120*100;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({c,atr:computeATR14(c),rsi:computeRSI2(c)});}}
console.log('Stocks: ' + SD.length);

function sim(P) {
  const trades=[];
  for(const{c,atr,rsi}of SD){const n=c.length;
  for(let i=130;i<n-11;i++){
    if(atr[i]<=0||c[i].c<=0)continue;
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
    trades.push({out,mfe});
  }}
  if(trades.length===0)return{n:0,w:0,st:0,wr:0,fs:0};
  const w=trades.filter(t=>t.out==='hit').length,st=trades.filter(t=>t.out==='stop').length;
  return{n:trades.length,w,st,wr:w/trades.length*100,fs:st>0?trades.filter(t=>t.out==='stop'&&t.mfe>=3).length/st*100:0};
}

const GRID = {
  ap:[30,40,50,60,70,80,85,90,95],
  pr:[0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90],
  pe:[0,1,2,3,4],
  mt:[3,4,5,6,8,10,12,15,18],
  pv:[0.70,0.80,0.85,0.90,0.95,1.00],
  p5:[0.70,0.80,0.90,0.95,1.00,1.10],
  ph:[0,1,2,3,4],
  rb:[1.0,1.5,2.0],
  er:[0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6,1.8,2.0],
  vr:[0.6,0.8,1.0,1.2,1.4,1.6,1.8,2.0,2.5],
  vp:[1.0,1.2,1.5,2.0,2.5,3.0,3.5,4.0],
  cl:[50,55,60,65,70,75,80,85],
  uw:[15,20,25,30,35,40,45,50],
  bp:[20,25,30,35,40,45,50],
  sr:[4,5,6,7,8,8.5,10,12,13],
  up:[10,15,20,25,30,35,40,45,50,55,60,65],
  ve:[null,1.0,1.25,1.5,1.75,2.0,2.25,2.5,3.0],
  cq:[null,1,2,3,4,5],
  mnz:[4,5,6,7,8,10],
  mxz:[15,20,25],
};

function tuneSet(name, base, minSigs) {
  console.log('\n' + '='.repeat(70));
  console.log(name + ' — Target >80% WR, min ' + minSigs + ' signals');
  console.log('='.repeat(70));
  const baseR = sim(base);
  console.log('Current: ' + baseR.n + 'sig ' + baseR.wr.toFixed(1) + '%WR ' + baseR.st + 'stops FS' + baseR.fs.toFixed(0) + '%');

  let best = { ...base };

  // Phase 1: Single-param WR maximization
  console.log('\nPhase 1: Single-param sweep');
  for (let round = 1; round <= 5; round++) {
    let improved = false;
    for (const [param, values] of Object.entries(GRID)) {
      if (best[param] === undefined) continue;
      let bestVal = best[param], bestWR = sim(best).wr;
      for (const val of values) {
        const test = { ...best, [param]: val };
        const r = sim(test);
        if (r.n >= minSigs && r.wr > bestWR) { bestWR = r.wr; bestVal = val; improved = true; }
      }
      best[param] = bestVal;
    }
    const r = sim(best);
    console.log('  R' + round + ': ' + r.n + 'sig ' + r.wr.toFixed(1) + '%WR ' + r.st + 'st' + (improved ? '' : ' (converged)'));
    if (!improved) break;
  }

  // Phase 2: 2-param interactions on key params
  console.log('Phase 2: 2-param interactions');
  const keyP = ['cl','er','vr','vp','pr','pe','mt','uw','bp','ve','sr','up','cq','ph','ap'];
  let bestWR = sim(best).wr;
  for (let a = 0; a < keyP.length; a++) {
    for (let b = a + 1; b < keyP.length; b++) {
      if (best[keyP[a]] === undefined || best[keyP[b]] === undefined) continue;
      for (const vA of GRID[keyP[a]] || []) {
        for (const vB of GRID[keyP[b]] || []) {
          const test = { ...best, [keyP[a]]: vA, [keyP[b]]: vB };
          const r = sim(test);
          if (r.n >= minSigs && r.wr > bestWR) { bestWR = r.wr; best = { ...test }; }
        }
      }
    }
  }
  const afterInt = sim(best);
  console.log('  After: ' + afterInt.n + 'sig ' + afterInt.wr.toFixed(1) + '%WR ' + afterInt.st + 'st');

  // Phase 3: Final convergence
  console.log('Phase 3: Final convergence');
  for (let round = 1; round <= 3; round++) {
    let improved = false;
    for (const [param, values] of Object.entries(GRID)) {
      if (best[param] === undefined) continue;
      let bestVal = best[param], bwr = sim(best).wr;
      for (const val of values) {
        const test = { ...best, [param]: val };
        const r = sim(test);
        if (r.n >= minSigs && r.wr > bwr) { bwr = r.wr; bestVal = val; improved = true; }
      }
      best[param] = bestVal;
    }
    const r = sim(best);
    console.log('  F' + round + ': ' + r.n + 'sig ' + r.wr.toFixed(1) + '%WR' + (improved ? '' : ' (converged)'));
    if (!improved) break;
  }

  const finalR = sim(best);
  console.log('\nFINAL: ' + finalR.n + 'sig ' + finalR.wr.toFixed(1) + '%WR ' + finalR.st + 'stops FS' + finalR.fs.toFixed(0) + '%');
  console.log('Changes:');
  for (const [k, v] of Object.entries(best)) { if (v !== base[k]) console.log('  ' + k.padEnd(6) + ': ' + String(base[k]).padStart(6) + ' -> ' + v); }
  return { best, baseR, finalR };
}

// Current param sets in compact form
const D20 = {to:10000000,ap:85,pr:0.80,pe:1,em:1.1,za:1.0,mnz:6,mxz:25,mt:18,pv:0.90,p5:0.95,ph:4,hm:1.35,rb:2.0,er:1.1,ex:5.0,vr:0.80,vp:2.0,cl:75,uw:45,bp:25,sr:8.5,up:60,rs:50,ve:1.75,cq:2,caz:null};
const HP = {to:10000000,ap:85,pr:0.80,pe:3,em:1.1,za:1.0,mnz:4,mxz:25,mt:18,pv:0.85,p5:1.10,ph:4,hm:1.35,rb:2.0,er:1.1,ex:5.0,vr:0.80,vp:2.0,cl:50,uw:40,bp:30,sr:13,up:50,rs:50,ve:null,cq:null,caz:6.0};
const E10 = {to:20000000,ap:60,pr:0.80,pe:3,em:1.1,za:0.95,mnz:6,mxz:25,mt:18,pv:0.90,p5:1.00,ph:2,hm:1.2,rb:2.0,er:1.5,ex:6.0,vr:1.60,vp:2.0,cl:75,uw:35,bp:25,sr:8.5,up:25,rs:50,ve:1.25,cq:2,caz:null};
const US8 = {to:10000000,ap:95,pr:0.80,pe:0,em:1.1,za:0.95,mnz:8,mxz:25,mt:6,pv:0.90,p5:0.95,ph:4,hm:1.5,rb:2.0,er:1.4,ex:6.0,vr:1.60,vp:3.50,cl:70,uw:30,bp:40,sr:8.5,up:45,rs:50,ve:1.50,cq:4,caz:null};

// D20+: min 20 signals (wide net but quality)
const d20 = tuneSet('D20+', D20, 20);
// HP15+: min 30 signals (most signals role)
const hp = tuneSet('HP15+', HP, 30);
// E10+: min 15 signals (high conviction)
const e10 = tuneSet('E10+', E10, 15);
// US8+: min 10 signals (selective)
const us8 = tuneSet('US8+', US8, 10);

console.log('\n' + '='.repeat(70));
console.log('FINAL COMPARISON — ALL 4 SETS');
console.log('='.repeat(70));
console.log('\nSet      | Current                    | Tuned for >80% WR');
console.log('---------+----------------------------+----------------------------');
for (const [name, res] of [['D20+', d20], ['HP15+', hp], ['E10+', e10], ['US8+', us8]]) {
  const c = res.baseR, t = res.finalR;
  console.log(name.padEnd(9) + '| ' + (c.n + 'sig ' + c.wr.toFixed(1) + '%WR ' + c.st + 'st FS' + c.fs.toFixed(0) + '%').padEnd(27) + '| ' + t.n + 'sig ' + t.wr.toFixed(1) + '%WR ' + t.st + 'st FS' + t.fs.toFixed(0) + '%');
}

console.log('\n>80% achieved?');
for (const [name, res] of [['D20+', d20], ['HP15+', hp], ['E10+', e10], ['US8+', us8]]) {
  console.log('  ' + name + ': ' + (res.finalR.wr >= 80 ? 'YES (' + res.finalR.wr.toFixed(1) + '%)' : 'NO (max ' + res.finalR.wr.toFixed(1) + '%)'));
}

console.log('\nTuned params:');
for (const [name, res] of [['D20+', d20], ['HP15+', hp], ['E10+', e10], ['US8+', us8]]) {
  console.log('\n' + name + ':');
  console.log(JSON.stringify(res.best));
}
