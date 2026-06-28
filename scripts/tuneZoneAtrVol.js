// GRID SEARCH — Find optimal thresholds for Zone EXPLODE, ATR EXPLODE, Vol THRUST
// Tests every combination of key parameters on 14,457 breakout signals
// Goal: Maximize hit rate while keeping signal count ≥20

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function atrPctl120(c,atr,idx){if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;let below=0;for(let j=idx-120;j<idx;j++){const v=c[j].c>0?atr[j]/c[j].c*100:0;if(v<cur)below++;}return below/120*100;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({c,atr:a14(c)});}}
console.log('Stocks: '+SD.length);

// Collect ALL breakout signals with raw features
const S=[];
for(const{c,atr}of SD){const n=c.length;
for(let i=130;i<n-11;i++){
  if(atr[i]<=0||c[i].c<=0)continue;
  const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
  const eRA=rng/atr[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100;
  const atrPct=atr[i]/s.c*100,pctl=atrPctl120(c,atr,i);
  let v20=0;for(let j=i-20;j<i;j++)v20+=c[j].v;v20/=20;
  let v5=0;for(let j=i-5;j<i;j++)v5+=c[j].v;v5/=5;
  const eVR=v20>0?s.v/v20:0,eVP=v5>0?s.v/v5:0;
  let p10R=0,p10V=0,p10RB=0;
  for(let j=i-10;j<i;j++){if(j<1)continue;p10R+=(c[j].h-c[j].l)/(atr[j]||1);const vr=v20>0?c[j].v/v20:0;p10V+=vr;if(c[j].c<c[j].o)p10RB+=vr;}
  p10R/=10;p10V/=10;p10RB/=10;
  const volExpR=p10R>0?eRA/p10R:0;
  const isGreen=s.c>s.o;
  let zone=null;
  for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
    for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(atr[j]||1)>1.0)ok=false;}
    if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>20)continue;
    const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
    for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
    for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
    if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
    zone={zH,zL:zLo,len:zL,t};break;}
  if(!zone||s.c<=zone.zH*1.001)continue;
  const cazp=zone.zH>0?(s.c-zone.zH)/zone.zH*100:0;
  let mfe=0,h5=false;
  for(let d=1;d<=10&&i+d<n;d++){const hp=(c[i+d].h-s.c)/s.c*100;if(hp>mfe)mfe=hp;if(hp>=5)h5=true;}
  S.push({pctl,eRA,cL,uW,bP,atrPct,eVR,eVP,p10R,p10V,p10RB,volExpR,isGreen,cazp,zt:zone.t,zl:zone.len,h5,mfe});
}}
console.log('Signals: '+S.length);
const baseHR=(S.filter(s=>s.h5).length/S.length*100).toFixed(1);
console.log('Baseline +5% HR: '+baseHR+'%');

// ═══ ATR EXPLODE GRID SEARCH ═══
console.log('\n'+'='.repeat(80));
console.log('ATR EXPLODE — Grid search for optimal thresholds');
console.log('='.repeat(80));

let bestATR={hr:0,n:0,params:{}};
const atrResults=[];
for(const pctlLo of [30,35,40,45]){
for(const pctlHi of [85,90,95]){
for(const minERA of [1.5,1.8,2.0,2.2,2.5]){
for(const minVER of [1.2,1.5,1.8,2.0]){
for(const minADR of [3,3.5,4]){
for(const maxADR of [7,8,9,10]){
for(const minVR of [1.2,1.5,1.8,2.0]){
for(const minVP of [1.5,2.0,2.25,2.5]){
for(const maxRB of [0.8,0.9,1.0,1.2]){
for(const minCL of [55,60,65,70]){
for(const minBP of [25,30,35]){
  const grp=S.filter(s=>s.pctl>=pctlLo&&s.pctl<=pctlHi&&s.eRA>=minERA&&s.eRA<=5&&s.volExpR>=minVER&&s.atrPct>=minADR&&s.atrPct<=maxADR&&s.eVR>=minVR&&s.eVP>=minVP&&s.p10RB<=maxRB&&s.cL>=minCL&&s.bP>=minBP&&s.uW<=40);
  if(grp.length<15)continue;
  const hr=grp.filter(s=>s.h5).length/grp.length*100;
  if(hr>bestATR.hr||(hr===bestATR.hr&&grp.length>bestATR.n)){
    bestATR={hr,n:grp.length,params:{pctlLo,pctlHi,minERA,minVER,minADR,maxADR,minVR,minVP,maxRB,minCL,minBP}};
  }
  if(hr>=75&&grp.length>=15)atrResults.push({hr,n:grp.length,params:{pctlLo,pctlHi,minERA,minVER,minADR,maxADR,minVR,minVP,maxRB,minCL,minBP}});
}}}}}}}}}}}

atrResults.sort((a,b)=>b.hr-a.hr||(b.n-a.n));
console.log('\nTop 5 ATR EXPLODE configurations (≥75% HR, ≥15 signals):');
console.log('  HR     | Sigs | Pctl    | ERA  | VER  | ADR     | VR   | VP   | RB   | CL  | BP');
console.log('  -------+------+---------+------+------+---------+------+------+------+-----+----');
for(const r of atrResults.slice(0,5)){
  const p=r.params;
  console.log(`  ${r.hr.toFixed(1).padStart(5)}% | ${String(r.n).padStart(4)} | ${p.pctlLo}-${p.pctlHi} | ${p.minERA} | ${p.minVER} | ${p.minADR}-${p.maxADR} | ${p.minVR} | ${p.minVP} | ${p.maxRB} | ${p.minCL} | ${p.minBP}`);
}
console.log('\nBest: '+bestATR.hr.toFixed(1)+'% HR, '+bestATR.n+' signals');
console.log('Params: '+JSON.stringify(bestATR.params));

// ═══ ZONE EXPLODE GRID SEARCH ═══
console.log('\n'+'='.repeat(80));
console.log('ZONE EXPLODE — Grid search for optimal thresholds');
console.log('='.repeat(80));

let bestZone={hr:0,n:0,params:{}};
const zoneResults=[];
for(const maxZT of [12,15,18,20]){
for(const minZL of [4,5,6,7]){
for(const maxZL of [15,20,25]){
for(const minCAZP of [0.5,0.75,1.0]){
for(const maxCAZP of [3,4,5,6]){
for(const minERA of [0.8,1.0,1.2,1.5]){
for(const maxERA of [3,4,5,6]){
for(const minVER of [1.0,1.25,1.5]){
for(const maxP10V of [0.9,1.0,1.1,1.2]){
for(const minCL of [60,65,70,75,80]){
for(const minBP of [20,25,30,35]){
for(const green of [true,false]){
  let grp=S.filter(s=>s.zt<=maxZT&&s.zl>=minZL&&s.zl<=maxZL&&s.cazp>=minCAZP&&s.cazp<=maxCAZP&&s.eRA>=minERA&&s.eRA<=maxERA&&s.volExpR>=minVER&&s.p10V<=maxP10V&&s.cL>=minCL&&s.bP>=minBP&&s.uW<=35);
  if(green)grp=grp.filter(s=>s.isGreen);
  if(grp.length<15)continue;
  const hr=grp.filter(s=>s.h5).length/grp.length*100;
  if(hr>bestZone.hr||(hr===bestZone.hr&&grp.length>bestZone.n)){
    bestZone={hr,n:grp.length,params:{maxZT,minZL,maxZL,minCAZP,maxCAZP,minERA,maxERA,minVER,maxP10V,minCL,minBP,green}};
  }
  if(hr>=70&&grp.length>=15)zoneResults.push({hr,n:grp.length,params:{maxZT,minZL,maxZL,minCAZP,maxCAZP,minERA,maxERA,minVER,maxP10V,minCL,minBP,green}});
}}}}}}}}}}}}

zoneResults.sort((a,b)=>b.hr-a.hr||(b.n-a.n));
console.log('\nTop 5 ZONE EXPLODE configurations (≥70% HR, ≥15 signals):');
console.log('  HR     | Sigs | ZT   | ZL     | CAZP    | ERA     | VER  | P10V | CL  | BP  | Green');
console.log('  -------+------+------+--------+---------+---------+------+------+-----+-----+------');
for(const r of zoneResults.slice(0,5)){
  const p=r.params;
  console.log(`  ${r.hr.toFixed(1).padStart(5)}% | ${String(r.n).padStart(4)} | ≤${p.maxZT} | ${p.minZL}-${p.maxZL} | ${p.minCAZP}-${p.maxCAZP} | ${p.minERA}-${p.maxERA} | ${p.minVER} | ≤${p.maxP10V} | ${p.minCL} | ${p.minBP} | ${p.green}`);
}
console.log('\nBest: '+bestZone.hr.toFixed(1)+'% HR, '+bestZone.n+' signals');
console.log('Params: '+JSON.stringify(bestZone.params));

// ═══ VOL THRUST GRID SEARCH ═══
console.log('\n'+'='.repeat(80));
console.log('VOL THRUST — Grid search for optimal thresholds');
console.log('='.repeat(80));

let bestVol={hr:0,n:0,params:{}};
const volResults=[];
for(const minVR of [1.5,2.0,2.5,3.0,3.5,4.0,5.0]){
for(const minVP of [1.5,2.0,2.5,3.0,3.5,4.0,5.0]){
for(const maxRB of [0.6,0.7,0.8,0.9,1.0,1.1]){
for(const minCL of [55,60,65,70,75]){
for(const minBP of [25,30,35,40,45]){
for(const maxUW of [25,30,35,40]){
  const grp=S.filter(s=>s.eVR>=minVR&&s.eVP>=minVP&&s.p10RB<=maxRB&&s.cL>=minCL&&s.bP>=minBP&&s.uW<=maxUW);
  if(grp.length<20)continue;
  const hr=grp.filter(s=>s.h5).length/grp.length*100;
  if(hr>bestVol.hr||(hr===bestVol.hr&&grp.length>bestVol.n)){
    bestVol={hr,n:grp.length,params:{minVR,minVP,maxRB,minCL,minBP,maxUW}};
  }
  if(hr>=60&&grp.length>=20)volResults.push({hr,n:grp.length,params:{minVR,minVP,maxRB,minCL,minBP,maxUW}});
}}}}}}

volResults.sort((a,b)=>b.hr-a.hr||(b.n-a.n));
console.log('\nTop 5 VOL THRUST configurations (≥60% HR, ≥20 signals):');
console.log('  HR     | Sigs | VR   | VP   | RB   | CL  | BP  | UW');
console.log('  -------+------+------+------+------+-----+-----+----');
for(const r of volResults.slice(0,5)){
  const p=r.params;
  console.log(`  ${r.hr.toFixed(1).padStart(5)}% | ${String(r.n).padStart(4)} | ≥${p.minVR} | ≥${p.minVP} | ≤${p.maxRB} | ≥${p.minCL} | ≥${p.minBP} | ≤${p.maxUW}`);
}
console.log('\nBest: '+bestVol.hr.toFixed(1)+'% HR, '+bestVol.n+' signals');
console.log('Params: '+JSON.stringify(bestVol.params));

// ═══ FINAL SUMMARY ═══
console.log('\n'+'='.repeat(80));
console.log('FINAL — Optimized badge thresholds for implementation');
console.log('='.repeat(80));
console.log('\nATR EXPLODE:');
console.log('  Current: 80.4% HR (56 signals)');
console.log('  Optimal: '+bestATR.hr.toFixed(1)+'% HR ('+bestATR.n+' signals)');
console.log('  '+JSON.stringify(bestATR.params));
console.log('\nZONE EXPLODE:');
console.log('  Current: 63.4% HR (290 signals)');
console.log('  Optimal: '+bestZone.hr.toFixed(1)+'% HR ('+bestZone.n+' signals)');
console.log('  '+JSON.stringify(bestZone.params));
console.log('\nVOL THRUST:');
console.log('  Current: 52.6% HR (1,165 signals)');
console.log('  Optimal: '+bestVol.hr.toFixed(1)+'% HR ('+bestVol.n+' signals)');
console.log('  '+JSON.stringify(bestVol.params));
