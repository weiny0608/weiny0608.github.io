/* FCN Lab v1.0.0 - deterministic contract engine. Dates are ISO civil dates. */
'use strict';
const FCNCore = (() => {
 const DAY = 86400000, EPS = 1e-10;
 const parse = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('INVALID_DATE');
  const d = new Date(s + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== s) throw new Error('INVALID_DATE');
  return d;
 };
 const iso = d => d.toISOString().slice(0,10);
 const plusDays = (s,n) => iso(new Date(+parse(s) + n*DAY));
 const days = (a,b) => Math.round((+parse(b)-+parse(a))/DAY);
 function addMonths(s,n) {
  const d=parse(s), year=d.getUTCFullYear(), month=d.getUTCMonth(), day=d.getUTCDate();
  const first=new Date(Date.UTC(year,month+n,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(day,last)); return iso(first);
 }
 const hitKI = (r,c) => c.kiInclusive ? r <= c.ki/100+EPS : r < c.ki/100-EPS;
 const hitKO = (r,c) => r >= c.ko/100-EPS;
 const worst = ratios => {
  const value=Math.min(...ratios);
  return { index:ratios.indexOf(value), value, ties:ratios.map((r,i)=>Math.abs(r-value)<EPS?i:-1).filter(i=>i>=0) };
 };
 function validate(c) {
  parse(c.start); parse(c.asOf);
  if (c.start>c.asOf) throw new Error('START_AFTER_ASOF');
  if (!Array.isArray(c.assets)||c.assets.length<1||c.assets.length>4) throw new Error('ASSET_COUNT');
  if (new Set(c.assets.map(x=>x.symbol)).size !== c.assets.length) throw new Error('DUPLICATE_SYMBOL');
  for (const a of c.assets) {
   if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(a.symbol)) throw new Error('INVALID_SYMBOL');
   if (a.initial!=null && (!Number.isFinite(a.initial)||a.initial<=0)) throw new Error('INVALID_INITIAL');
  }
  for (const k of ['strike','ki','ko']) if (!Number.isFinite(c[k])||c[k]<=0||c[k]>300) throw new Error('INVALID_BARRIER');
  if (c.ki>c.strike||c.strike>c.ko) throw new Error('BARRIER_ORDER');
  if (!Number.isInteger(c.tenor)||c.tenor<1||c.tenor>36) throw new Error('INVALID_TENOR');
  if (!Number.isInteger(c.guarantee)||c.guarantee<0||c.guarantee>c.tenor) throw new Error('INVALID_GUARANTEE');
  if (!Number.isFinite(c.notional)||c.notional<=0||c.notional>1e12) throw new Error('INVALID_NOTIONAL');
  if (!Number.isFinite(c.coupon)||c.coupon<0||c.coupon>100) throw new Error('INVALID_COUPON');
  if (!['AKI','EKI'].includes(c.kiType)||!['close','low'].includes(c.akiPrice)||!['daily','monthly'].includes(c.koFrequency)||![360,365].includes(c.basis)) throw new Error('INVALID_OPTION');
 }
 function align(c,series,cutoff) {
  validate(c);
  const maps=c.assets.map(a=>{
   const s=series[a.symbol];
   if (!s||!Array.isArray(s.bars)) throw new Error('MISSING_SYMBOL:'+a.symbol);
   const map=new Map();
   for(const b of s.bars) {
    parse(b.date);
    if(!Number.isFinite(b.close)||b.close<0) throw new Error('BAD_CLOSE:'+a.symbol+':'+b.date);
    if(b.low!=null&&(!Number.isFinite(b.low)||b.low<0||b.low>b.close+EPS)) throw new Error('BAD_LOW:'+a.symbol+':'+b.date);
    if(map.has(b.date)) throw new Error('DUPLICATE_DATE:'+a.symbol+':'+b.date);
    if(b.date>=c.start&&b.date<=cutoff) map.set(b.date,b);
   }
   return map;
  });
  const union=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort();
  if(!union.length) throw new Error('NO_DATA');
  const gaps=union.filter(d=>maps.some(m=>!m.has(d)));
  if(gaps.length) {
   const d=gaps[0], missing=c.assets.filter((a,i)=>!maps[i].has(d)).map(a=>a.symbol).join(',');
   throw new Error('INCOMPLETE_DAY:'+d+':'+missing);
  }
  const first=union[0];
  if(days(c.start,first)>7) throw new Error('MISSING_INCEPTION:'+first);
  const initials=c.assets.map((a,i)=>a.initial??maps[i].get(first).close);
  if(initials.some(x=>x<=0)) throw new Error('ZERO_INITIAL');
  const rows=union.map(date=>({date,prices:maps.map(m=>m.get(date).close),lows:maps.map(m=>m.get(date).low??null)}));
  return {rows,initials,start:first};
 }
 function evaluate(c,aligned) {
  validate(c);
  const all=aligned.rows.filter(r=>r.date>=aligned.start&&r.date<=c.asOf);
  if(!all.length) throw new Error('NO_DATA');
  const start=aligned.start, initials=aligned.initials;
  const maturity=addMonths(start,c.tenor), lockEnd=addMonths(start,c.guarantee);
  const maturityRow=all.find(r=>r.date>=maturity);
  if(maturityRow&&days(maturity,maturityRow.date)>7) throw new Error('MISSING_MATURITY:'+maturity);
  const finalDate=maturityRow?.date??null;
  const monthly=new Set();
  for(let m=Math.max(1,c.guarantee);m<=c.tenor;m++) {
   const target=addMonths(start,m), row=all.find(r=>r.date>=target);
   if(row) {
    if(days(target,row.date)>7) throw new Error('MISSING_OBSERVATION:'+target);
    monthly.add(row.date);
   }
  }
  const firstEligible=all.find(r=>r.date>start&&r.date>=lockEnd);
  const koEligible=(row)=>row.date>start&&row.date>=lockEnd&&(c.koFrequency==='daily'||monthly.has(row.date));
  let memory=initials.map(()=>false), koFirst=initials.map(()=>null), kiFirst=initials.map(()=>null);
  let kiTriggered=false, koDate=null, endDate=all.at(-1).date, ended=false, kind='ALIVE';
  let lastRatios=all[0].prices.map((p,i)=>p/initials[i]), lastRow=all[0];
  const events=[], observed=[];
  function event(date,type,ratios,detail={}) {events.push({date,type,worst:worst(ratios),memory:memory.filter(Boolean).length,...detail});}
  event(start,'START',lastRatios);
  for(const row of all) {
   if(row.date===start) continue; // Observation begins after the initial fixing.
   const ratios=row.prices.map((p,i)=>p/initials[i]);
   const isFinal=finalDate!==null&&row.date===finalDate;
   const newly=[];
   if(c.kiType==='AKI') {
    const probes=c.akiPrice==='low'?row.lows:row.prices;
    if(probes.some(v=>v===null)) throw new Error('MISSING_LOW:'+row.date);
    probes.forEach((p,i)=>{if(hitKI(p/initials[i],c)&&!kiFirst[i]){kiFirst[i]=row.date;newly.push(i);}});
   } else if(isFinal) {
    ratios.forEach((r,i)=>{if(hitKI(r,c)){kiFirst[i]=row.date;newly.push(i);}});
   }
   if(newly.length) {kiTriggered=true;event(row.date,'KI',ratios,{assets:newly});}
   const eligible=koEligible(row);
   if(eligible) {
    const hit=ratios.map(r=>hitKO(r,c)), added=[];
    hit.forEach((yes,i)=>{if(yes&&!memory[i]){memory[i]=true;koFirst[i]=row.date;added.push(i);}});
    const called=c.memory?memory.every(Boolean):hit.every(Boolean);
    if(c.memory&&added.length) event(row.date,'MEMORY',ratios,{assets:added});
    observed.push({date:row.date,ratios:[...ratios],hit:[...hit],memory:[...memory],called});
    if(called) {
     koDate=row.date;endDate=row.date;ended=true;kind='KO';lastRatios=ratios;lastRow=row;
     event(row.date,'KO',ratios,{atMaturity:isFinal});break;
    }
    if(c.koFrequency==='monthly') event(row.date,'OBSERVATION',ratios,{hit:hit.filter(Boolean).length});
   }
   lastRatios=ratios;lastRow=row;
   if(isFinal){endDate=row.date;ended=true;kind='MATURED';event(row.date,'MATURITY',ratios);break;}
  }
  const w=worst(lastRatios);
  const loss=ended&&kind!=='KO'&&kiTriggered&&w.value<c.strike/100-EPS;
  const principalValue=ended?(loss?c.notional*Math.max(0,w.value)/(c.strike/100):c.notional):null;
  const accrued=c.notional*(c.coupon/100)*days(start,endDate)/c.basis;
  const total=ended?principalValue+accrued:null;
  const couponSchedule=[];
  let prev=start;
  for(let m=1;m<=c.tenor;m++) {
   const planned=addMonths(start,m), effective=all.find(r=>r.date>=planned)?.date;
   if(!effective||effective>endDate) break;
   couponSchedule.push({date:effective,from:prev,days:days(prev,effective),amount:c.notional*c.coupon/100*days(prev,effective)/c.basis});prev=effective;
   if(prev===endDate)break;
  }
  if(prev<endDate)couponSchedule.push({date:endDate,from:prev,days:days(prev,endDate),amount:c.notional*c.coupon/100*days(prev,endDate)/c.basis,partial:true});
  return {start,maturity,finalDate,lockEnd,firstKO:firstEligible?(c.koFrequency==='daily'?firstEligible.date:[...monthly][0]??null):null,initials,ended,kind,loss,kiTriggered,kiFirst,koFirst,memory,koDate,endDate,ratios:lastRatios,lastRow,worst:w,principalValue,coupon:accrued,total,returnRate:ended?(total/c.notional-1):null,theoreticalShares:loss?c.notional/(initials[w.index]*c.strike/100):null,events,observations:observed,couponSchedule,days:days(start,endDate)};
 }
 function stress(c,result,terminalRatios,extraKI=false) {
  if(terminalRatios.length!==c.assets.length||terminalRatios.some(r=>!Number.isFinite(r)||r<0))throw new Error('INVALID_TERMINAL');
  const w=worst(terminalRatios);
  const breached=terminalRatios.some(r=>hitKI(r,c));
  const ki=c.kiType==='EKI'?breached:(result.kiTriggered||extraKI||breached);
  const loss=ki&&w.value<c.strike/100-EPS;
  const principal=loss?c.notional*w.value/(c.strike/100):c.notional;
  const coupon=c.notional*c.coupon/100*days(result.start,result.maturity)/c.basis;
  return {worst:w,ki,loss,principal,coupon,total:principal+coupon,returnRate:(principal+coupon)/c.notional-1};
 }
 return {parse,iso,plusDays,days,addMonths,hitKI,hitKO,worst,validate,align,evaluate,stress};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FCNCore;

