(function(root){
'use strict';
const DAY=86400000;
function periodFor(day,mode){
 const date=new Date(day+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==day)throw Error('資料日期無效。');
 const iso=t=>new Date(t).toISOString().slice(0,10);
 if(mode==='day')return {mode,key:day,start_date:day,end_date:day};
 if(mode==='month'){const y=date.getUTCFullYear(),m=date.getUTCMonth();return {mode,key:day.slice(0,7),start_date:iso(Date.UTC(y,m,1)),end_date:iso(Date.UTC(y,m+1,0))};}
 if(mode!=='week')throw Error('請選擇日、週或月。');
 const start=+date-date.getUTCDay()*DAY;
 const yearStart=y=>{const jan11=Date.UTC(y,0,11);return jan11+((7-new Date(jan11).getUTCDay())%7)*DAY;};
 let year=date.getUTCFullYear();if(start<yearStart(year))year--;
 const week=Math.floor((start-yearStart(year))/(7*DAY))+1;
 return {mode,key:`${year}_w${String(week).padStart(2,'0')}_`,start_date:iso(start),end_date:iso(start+6*DAY)};
}
function contains(period,day){return !period||(day>=period.start_date&&day<=period.end_date);}
function periodsFor(metas,mode){const items=new Map(),days=[...new Set(metas.flatMap(meta=>Object.keys(meta.dayCounts||{})))].sort();if(!days.length)return [];const start=periodFor(days[0],'month').start_date,end=periodFor(days.at(-1),'month').end_date;let dates=days;if(mode==='day'&&(Date.parse(end)-Date.parse(start))/DAY<=20000){dates=[];for(let t=Date.parse(start+'T00:00:00Z');t<=Date.parse(end+'T00:00:00Z');t+=DAY)dates.push(new Date(t).toISOString().slice(0,10));}for(const day of dates){const p=periodFor(day,mode);items.set(p.key,p);}return [...items.values()].sort((a,b)=>b.start_date.localeCompare(a.start_date));}
function rowsIn(meta,period){return Object.entries(meta.dayCounts||{}).reduce((sum,[day,count])=>sum+(contains(period,day)?count:0),0);}
function rangeFor(first,last){if(!first||!last||first.mode!==last.mode||first.start_date>last.start_date)throw Error('開始期間不可晚於結束期間。');return {mode:first.mode,key:first.key===last.key?first.key:`${first.key.replace(/_$/,'')}_to_${last.key.replace(/_$/,'')}`,start_date:first.start_date,end_date:last.end_date};}
function validateRange(period){const first=periodFor(period.start_date,period.mode),last=periodFor(period.end_date,period.mode);if(first.start_date!==period.start_date||last.end_date!==period.end_date||first.start_date>last.start_date)throw Error('日／週／月起訖範圍無效。');return period;}
root.AutoReportPeriods={periodFor,contains,periodsFor,rowsIn,rangeFor,validateRange};
})(typeof self!=='undefined'?self:globalThis);
