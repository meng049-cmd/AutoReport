(function(root){
'use strict';
const DAY=86400000;
function periodFor(day,mode){
 const date=new Date(day+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==day)throw Error('資料日期無效。');
 const iso=t=>new Date(t).toISOString().slice(0,10);
 if(mode==='month'){const y=date.getUTCFullYear(),m=date.getUTCMonth();return {mode,key:day.slice(0,7),start_date:iso(Date.UTC(y,m,1)),end_date:iso(Date.UTC(y,m+1,0))};}
 if(mode!=='week')throw Error('請選擇週或月。');
 const start=+date-date.getUTCDay()*DAY;
 const yearStart=y=>{const jan11=Date.UTC(y,0,11);return jan11+((7-new Date(jan11).getUTCDay())%7)*DAY;};
 let year=date.getUTCFullYear();if(start<yearStart(year))year--;
 const week=Math.floor((start-yearStart(year))/(7*DAY))+1;
 return {mode,key:`${year}_w${String(week).padStart(2,'0')}_`,start_date:iso(start),end_date:iso(start+6*DAY)};
}
function contains(period,day){return !period||(day>=period.start_date&&day<=period.end_date);}
function periodsFor(metas,mode){const items=new Map();for(const meta of metas)for(const day of Object.keys(meta.dayCounts||{})){const p=periodFor(day,mode);items.set(p.key,p);}return [...items.values()].sort((a,b)=>b.start_date.localeCompare(a.start_date));}
function rowsIn(meta,period){return Object.entries(meta.dayCounts||{}).reduce((sum,[day,count])=>sum+(contains(period,day)?count:0),0);}
root.AutoReportPeriods={periodFor,contains,periodsFor,rowsIn};
})(typeof self!=='undefined'?self:globalThis);
