// DEBUG BACKTEST — Full filter funnel + trade simulation for ALL 4 param sets
// Shows exactly how many candle-days pass each filter stage

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
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr:computeATR14(c),rsi:computeRSI2(c)});}}

console.log('Stocks loaded: ' + SD.length);

const SETS = {
  'D20+ v8-DT': {minAvgTurnover:10000000,maxATRPctl:85,maxP10Range:0.80,maxP10Exp:1,expM:1.1,zRA:1.0,minZ:6,maxZ:25,maxT:18,maxP10Vol:0.90,maxP5Vol:0.95,maxP10HV:4,hvM:1.35,maxRB:2.00,minERA:1.1,maxERA:5.0,minEVR:0.80,minEVP:2.00,minCL:75,maxUW:45,minBP:25,maxSR:8.5,minUPS:60,minRSI:50,minVER:1.75,minCQ:2,maxCAZ:null},
  'HP15+ v7-UT': {minAvgTurnover:10000000,maxATRPctl:85,maxP10Range:0.80,maxP10Exp:3,expM:1.1,zRA:1.0,minZ:4,maxZ:25,maxT:18,maxP10Vol:0.85,maxP5Vol:1.10,maxP10HV:4,hvM:1.35,maxRB:2.00,minERA:1.1,maxERA:5.0,minEVR:0.80,minEVP:2.00,minCL:50,maxUW:40,minBP:30,maxSR:13,minUPS:50,minRSI:50,minVER:null,minCQ:null,maxCAZ:6.0},
  'E10+ v8-DT': {minAvgTurnover:20000000,maxATRPctl:60,maxP10Range:0.80,maxP10Exp:3,expM:1.1,zRA:0.95,minZ:6,maxZ:25,maxT:18,maxP10Vol:0.90,maxP5Vol:1.00,maxP10HV:2,hvM:1.2,maxRB:2.00,minERA:1.5,maxERA:6.0,minEVR:1.60,minEVP:2.00,minCL:75,maxUW:35,minBP:25,maxSR:8.5,minUPS:25,minRSI:50,minVER:1.25,minCQ:2,maxCAZ:null},
  'US8+ v8-DT': {minAvgTurnover:10000000,maxATRPctl:95,maxP10Range:0.80,maxP10Exp:0,expM:1.1,zRA:0.95,minZ:8,maxZ:25,maxT:6,maxP10Vol:0.90,maxP5Vol:0.95,maxP10HV:4,hvM:1.5,maxRB:2.00,minERA:1.4,maxERA:6.0,minEVR:1.60,minEVP:3.50,minCL:70,maxUW:30,minBP:40,maxSR:8.5,minUPS:45,minRSI:50,minVER:1.50,minCQ:4,maxCAZ:null},
};

for (const [name, P] of Object.entries(SETS)) {
  let total=0;
  const rej={to:0,ap:0,p10r:0,p10e:0,p10v:0,p5v:0,hv:0,rb:0,era:0,evr:0,evp:0,cl:0,uw:0,bp:0,sr:0,ver:0,cq:0,rsi:0,nz:0,nb:0,ups:0,caz:0};
  const trades=[];

  for(const{sym,c,atr,rsi}of SD){const n=c.length;
  for(let i=130;i<n-11;i++){
    if(atr[i]<=0||c[i].c<=0)continue;total++;
    const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
    let avgTO=0;for(let j=i-20;j<i;j++)avgTO+=c[j].c*c[j].v;avgTO/=20;
    if(avgTO<P.minAvgTurnover){rej.to++;continue;}
    if(atrPctl120(c,atr,i)>P.maxATRPctl){rej.ap++;continue;}
    const eRA=rng/atr[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100,sigR=rng/s.c*100;
    let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;
    let v5=0;for(let j=i-5;j<i;j++)v5+=c[j].v;v5/=5;
    const eVR=v20>0?s.v/v20:0,eVP=v5>0?s.v/v5:0;
    let p10R=0,p10E=0,p10V=0,p10HV=0,p10RB=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;const rA=(c[j].h-c[j].l)/(atr[j]||1);p10R+=rA;if(rA>P.expM)p10E++;const vr=v20>0?c[j].v/v20:0;p10V+=vr;if(vr>P.hvM)p10HV++;if(c[j].c<c[j].o)p10RB+=vr;}
    p10R/=10;p10V/=10;p10RB/=10;
    let p5V=0;for(let j=i-5;j<i;j++){if(j>=0)p5V+=(v20>0?c[j].v/v20:0);}p5V/=5;
    const vER=p10R>0?eRA/p10R:0;
    if(p10R>P.maxP10Range){rej.p10r++;continue;}
    if(p10E>P.maxP10Exp){rej.p10e++;continue;}
    if(p10V>P.maxP10Vol){rej.p10v++;continue;}
    if(p5V>P.maxP5Vol){rej.p5v++;continue;}
    if(p10HV>P.maxP10HV){rej.hv++;continue;}
    if(p10RB>P.maxRB){rej.rb++;continue;}
    if(eRA<P.minERA||eRA>P.maxERA){rej.era++;continue;}
    if(eVR<P.minEVR){rej.evr++;continue;}
    if(eVP<P.minEVP){rej.evp++;continue;}
    if(cL<P.minCL){rej.cl++;continue;}
    if(uW>P.maxUW){rej.uw++;continue;}
    if(bP<P.minBP){rej.bp++;continue;}
    if(sigR>P.maxSR){rej.sr++;continue;}
    if(P.minVER!=null&&vER<P.minVER){rej.ver++;continue;}
    let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP>=2.5)cq++;if(eRA>=1.5)cq++;
    if(P.minCQ!=null&&cq<P.minCQ){rej.cq++;continue;}
    if(rsi[i]<P.minRSI){rej.rsi++;continue;}
    let zone=null;
    for(let zL=P.maxZ;zL>=P.minZ;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>P.zRA)ok=false;}
      if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>P.maxT)continue;
      const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
      zone={zH,zL:zLo,len:zL,t};break;}
    if(!zone){rej.nz++;continue;}
    if(s.c<=zone.zH*1.001){rej.nb++;continue;}
    if(P.maxCAZ!=null){const cabp=zone.zH>0?(s.c-zone.zH)/zone.zH*100:0;if(cabp>P.maxCAZ){rej.caz++;continue;}}
    let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
    if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP>=4)ups+=20;else if(eVP>=2)ups+=12;
    if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
    if(ups<P.minUPS){rej.ups++;continue;}

    // Trade simulation
    const rawSt=zone.zL-0.5*atr[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
    const aP=atr[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP));
    let mfe=0,out='exp',hT1=false;
    for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100;if(hp>mfe)mfe=hp;
      if(cd.c<=stP&&!hT1){out='stop';break;}if(cd.h>=s.c*(1+t1P/100))hT1=true;}
    if(out!=='stop')out=hT1?'hit':'exp';
    const exitP=out==='stop'?stP:hT1?s.c*(1+t1P/100):c[Math.min(i+10,n-1)].c;
    trades.push({sym,out,pnl:(exitP-s.c)/s.c*100,mfe,stPct});
  }}

  const wins=trades.filter(t=>t.out==='hit');
  const stops=trades.filter(t=>t.out==='stop');
  const gW=wins.reduce((s,t)=>s+t.pnl,0);
  const gL=Math.abs(stops.reduce((s,t)=>s+t.pnl,0));

  console.log('\n' + '='.repeat(70));
  console.log(name);
  console.log('='.repeat(70));
  console.log('Candle-days tested: ' + total.toLocaleString());
  console.log('Signals passed:     ' + trades.length);
  console.log('Winners:            ' + wins.length + ' (' + (trades.length>0?(wins.length/trades.length*100).toFixed(1):'0') + '%)');
  console.log('Stopped:            ' + stops.length);
  console.log('Expired:            ' + trades.filter(t=>t.out==='exp').length);
  console.log('False stops:        ' + stops.filter(t=>t.mfe>=3).length + '/' + stops.length);
  console.log('Avg PnL:            ' + (trades.length>0?(trades.reduce((s,t)=>s+t.pnl,0)/trades.length).toFixed(2):'0') + '%');
  console.log('Avg MFE:            +' + (trades.length>0?(trades.reduce((s,t)=>s+t.mfe,0)/trades.length).toFixed(1):'0') + '%');
  console.log('Profit Factor:      ' + (gL>0?(gW/gL).toFixed(2):'inf'));
  if(wins.length>0) console.log('Avg Win:            +' + (gW/wins.length).toFixed(1) + '%');
  if(stops.length>0) console.log('Avg Loss:           ' + (stops.reduce((s,t)=>s+t.pnl,0)/stops.length).toFixed(1) + '%');
  console.log('\nTop rejectors:');
  const rejArr = Object.entries(rej).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v).slice(0,5);
  for(const r of rejArr) console.log('  ' + r.k.padEnd(6) + ': ' + r.v.toLocaleString() + ' (' + (r.v/total*100).toFixed(1) + '%)');
}
