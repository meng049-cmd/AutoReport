import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {calendarDates,defectBreakdown,allDefectLevels,cohortInput,periodKey,periodBounds,calendarBuckets,attributedRows,workOrderRows,periodLabel} from './defect-analysis.mjs';
const ctx=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','quality-core.js'])vm.runInContext(readFileSync(file,'utf8'),ctx);
function fixture(){const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],book=ctx.XLSX.utils.book_new(),m=new ctx.DetailMerger(ctx.XLSX);
 const row=(id,process,day,status,defect,ic='A')=>[process,'o','p','n',id,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'];
 ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,row('a','P1',5,'GOOD','GOOD defect'),row('a','P2',6,'FAIL','first FAIL'),row('b','P1',5,'GOOD',null),row('c','P1',5,'FAIL','crack'),row('c','P2',5,'FAIL','later'),row('d','P1',5,'FAIL','dust','B'),row('e','P1',7,'GOOD',null,'B')]),'Detail');m.add(book,'原始.xlsx');return ctx.analyzeQuality(m);}
test('every product/date/process/defect level reconciles first-FAIL attribution without inflating exposure counts',()=>{
 const analysis=fixture(),dates=calendarDates('2026-10-05','2026-10-07'),product=analysis.products.find(p=>p.ic==='A').id;
 const visit=(filters={})=>{const view=defectBreakdown(analysis,filters,dates);assert.equal(view.groups.reduce((n,r)=>n+r.count,0),view.dimension?view.count:0);assert.ok(Math.abs(view.groups.reduce((n,r)=>n+r.contribution,0)-(view.dimension?view.contribution:0))<1e-12);for(const group of view.groups)if(view.dimension)visit({...filters,[view.dimension]:group.key});};visit();
 assert.equal(cohortInput(analysis,{product,date:'2026-10-05'}),3,'two processes of the same PPID still mean one daily input');assert.equal(cohortInput(analysis,{product,date:'2026-10-05',process:'P2'}),1);
 const daily=defectBreakdown(analysis,{product},dates);assert.deepEqual(daily.groups.map(r=>r.count),[1,1,0]);assert.equal(daily.groups[2].input,0);assert.equal(daily.groups[2].rate,null);
 const leaf=defectBreakdown(analysis,{product,date:'2026-10-06',process:'P2',defect:'first FAIL'},dates);assert.equal(leaf.count,1);assert.equal(leaf.records[0].serial,'a');
 const leaves=allDefectLevels(analysis).filter(row=>row.level==='defect');assert.equal(leaves.reduce((n,row)=>n+row.count,0),analysis.fail);assert.ok(Math.abs(leaves.reduce((n,row)=>n+row.contribution,0)-analysis.badRate)<1e-12);
});
test('complete hierarchy retains all defect names rather than limiting to a ranking',()=>{
 const analysis=fixture(),product=analysis.products[0].id;analysis.attribution=Array.from({length:12},(_,i)=>({product,ic:'A',model:'Model',date:'2026-10-05',process:'P1',defect:'defect '+i,serial:'id'+i}));
 const result=defectBreakdown(analysis,{product,date:'2026-10-05',process:'P1'});assert.equal(result.groups.length,12);assert.equal(result.count,12);
});


test('day, ISO week and month ranges retain empty dates and deduplicate inputs across days',()=>{
 assert.equal(periodKey('2021-01-01','week'),'2020-W53');assert.deepEqual(periodBounds('2020-W53','week'),{start:'2020-12-28',end:'2021-01-03'});assert.equal(periodBounds('2021-W53','week'),null);assert.equal(periodBounds('2026-02-30'),null);assert.deepEqual(periodBounds('2024-02','month'),{start:'2024-02-01',end:'2024-02-29'});
 assert.equal(calendarBuckets('2026-10-01','2026-10-31').length,31);assert.equal(calendarBuckets('2026-09-01','2026-11-30','month').length,3);
 const analysis=fixture(),product=analysis.products.find(p=>p.ic==='A').id,range={startDate:'2026-10-01',endDate:'2026-10-31',granularity:'week',product};assert.equal(cohortInput(analysis,range),3);assert.equal(cohortInput(analysis,{...range,date:'2026-W41'}),3);assert.equal(cohortInput(analysis,{...range,date:'2026-W40'}),0);
 const weekly=defectBreakdown(analysis,range);assert.equal(weekly.groups.length,5);assert.equal(weekly.groups.reduce((n,r)=>n+r.count,0),2);assert.equal(weekly.groups.find(r=>r.key==='2026-W40').input,0);assert.equal(weekly.groups.find(r=>r.key==='2026-W40').rate,null);
 const month=defectBreakdown(analysis,{...range,granularity:'month',startDate:'2026-09-01',endDate:'2026-11-30'});assert.deepEqual(month.groups.map(g=>g.count),[0,2,0]);assert.equal(month.groups[1].input,3);
 const selected={startDate:'2026-10-05',endDate:'2026-10-05',product};assert.equal(attributedRows(analysis,selected).some(r=>r.serial==='a'),false,'later first FAIL is not reassigned to a selected earlier GOOD defect');assert.equal(cohortInput(analysis,selected),3);
 const order=workOrderRows(analysis,range);assert.equal(order.length,1);assert.equal(order[0].input,3);assert.equal(order[0].count,2);assert.equal(order[0].order,'o');assert.match(order[0].defects,/first FAIL/);
 const leaves=allDefectLevels(analysis,range).filter(r=>r.level==='defect');assert.equal(leaves.reduce((n,r)=>n+r.count,0),2);assert.ok(leaves.every(r=>r.date==='2026-W41'));
});


test('week labels show month/day intervals and preserve cross-year boundaries',()=>{
 assert.equal(periodLabel('2026-W42','week'),'10/12–10/18');assert.equal(periodLabel('2020-W53','week'),'2020/12/28–2021/01/03');assert.equal(calendarBuckets('2026-10-12','2026-10-18','week')[0].label,'10/12–10/18');
});
