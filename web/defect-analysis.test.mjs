import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {usesGroupInputRate,defectChartValue,scopedQualitySummary,dateInputAudits,calendarDates,defectBreakdown,allDefectLevels,cohortInput,defectKey,parseDefectKey,defectFilterLabel,periodKey,periodBounds,calendarBuckets,attributedRows,workOrderRows,periodLabel,orderYieldRows,defectTrend,orderStageSeries,selectTrendSeries,defectDimensions} from './defect-analysis.mjs';
const ctx=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','quality-core.js'])vm.runInContext(readFileSync(file,'utf8'),ctx);
test('trend exposure unions PPIDs across eligible processes and period dates, excluding AOI rows rather than whole PPIDs',()=>{
 const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],book=ctx.XLSX.utils.book_new(),merger=new ctx.DetailMerger(ctx.XLSX);
 const row=(serial,process,day,status='GOOD',defect='')=>[process,'O','p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,'IC','Model'];
 ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,row('shared','正面AOI',12,'FAIL','AOI defect'),row('shared','DAF外觀',12),row('shared','功能一測試',12,'FAIL','eligible defect'),row('shared','功能一測試',13),row('only-AOI','背面AOI',12,'FAIL','excluded'),row('good','DAF外觀',12)]),'Detail');merger.add(book,'raw.xlsx');
 const analysis=ctx.analyzeQuality(merger),scope={startDate:'2026-10-12',endDate:'2026-10-14'};
 assert.equal(analysis.total,2);assert.equal(analysis.fail,1);assert.equal(analysis.attribution[0].defect,'eligible defect');assert.ok(analysis.observations.every(row=>!row.process.includes('AOI')));
 const daily=defectTrend(analysis,scope);assert.deepEqual(daily.dates.map(d=>d.input),[2,1,0]);assert.deepEqual(daily.dates.map(d=>d.rate),[.5,0,null]);
 const front=defectTrend(analysis,{...scope,process:'DAF外觀'}),test=defectTrend(analysis,{...scope,process:'功能一測試'});assert.equal(front.dates[0].input,2);assert.equal(test.dates[0].input,1);assert.equal(daily.dates[0].input,2,'combined input is a union, not 2 + 1');
 for(const granularity of ['day','week','month']){const audit=dateInputAudits(analysis,{...scope,granularity});assert.ok(audit.every(row=>row.consistent));assert.equal(audit[0].uniqueInput,2);assert.equal(audit[0].processInputSum,3);assert.equal(audit[0].repeatedInput,1);}
 for(const granularity of ['week','month']){const period=defectTrend(analysis,{...scope,granularity});assert.equal(period.dates[0].input,2);assert.equal(period.dates[0].count,1);assert.equal(period.dates[0].rate,.5);}
 assert.equal(defectTrend(analysis,{...scope,process:'正面AOI'}).dates[0].input,0);
});
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


test('order filters and yield use first-NG attribution without counting cross-order PPIDs twice as defects',()=>{
 const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],row=(serial,order,process,day,status,defect,ic='A')=>[process,order,'p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'],book=ctx.XLSX.utils.book_new(),merger=new ctx.DetailMerger(ctx.XLSX);
 ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,row('a','O1','DAF外觀',5,'GOOD','early GOOD'),row('a','O2','功能一測試',6,'FAIL','first FAIL'),row('b','O1','DAF外觀',5,'FAIL','crack'),row('c','O1','DAF外觀',5,'GOOD',''),row('c','O1','DAF外觀',6,'GOOD',''),row('d','O2','功能一測試',7,'GOOD',''),row('f','O1','DAF外觀',6,'GOOD','dust','B'),row('aoi-only','O3','正面AOI',5,'FAIL','excluded'),row('g','RAW','DAF外觀',5,'GOOD',''),row('g','NG','DAF外觀',5,'GOOD','hidden original order')]),'Detail');merger.add(book,'orders.xlsx');const analysis=ctx.analyzeQuality(merger),scope={startDate:'2026-10-05',endDate:'2026-10-08',granularity:'day'},orders=orderYieldRows(analysis,scope);analysis.start_date=scope.startDate;analysis.end_date=scope.endDate;
 assert.equal(analysis.total,6);assert.equal(analysis.fail,4);assert.equal(orders.reduce((sum,r)=>sum+r.fail,0),4);assert.equal(orders.find(r=>r.order==='O3'),undefined);assert.equal(orders.filter(r=>r.order==='O1').reduce((sum,r)=>sum+r.total,0),4);assert.equal(orders.filter(r=>r.order==='O1').reduce((sum,r)=>sum+r.fail,0),2);
 assert.equal(orders.find(r=>r.order==='O2').yield,.5);assert.equal(cohortInput(analysis,{...scope,order:'O1'}),4);assert.equal(cohortInput(analysis,{...scope,order:'NG'}),1,'original first-NG work order remains an authentic input even when the visible row is from another order');assert.equal(orders.find(r=>r.order==='NG').fail,1);assert.equal(orders.find(r=>r.order==='RAW').fail,0);
 assert.equal(attributedRows(analysis,{...scope,process:'功能一測試',order:'O2'})[0].defect,'first FAIL');assert.equal(attributedRows(analysis,{...scope,defect:'crack'})[0].serial,'b');
 const trend=defectTrend(analysis,{...scope,order:'O2'});assert.deepEqual(trend.dates.map(d=>d.input),[0,1,1,0]);assert.deepEqual(trend.dates.map(d=>d.rate),[null,1,0,null]);assert.equal(trend.series.length,1);assert.deepEqual(trend.series[0].points.map(d=>d.rate),[null,1,0,null]);
 const monthly=defectTrend(analysis,{...scope,order:'O1',granularity:'month'});assert.equal(monthly.dates[0].input,4);assert.equal(monthly.dates[0].rate,.5);assert.equal(monthly.series.reduce((sum,s)=>sum+s.points[0].rate,0),.5);
 const productB=analysis.products.find(p=>p.ic==='B').id;assert.equal(defectTrend(analysis,{...scope,product:productB}).series[0].defect,'dust');assert.equal(defectTrend(analysis,{...scope,product:productB}).dates[1].rate,1);
 const bytes=ctx.XLSX.write(merger.finish().book,{type:'array',bookType:'xlsx'}),again=new ctx.DetailMerger(ctx.XLSX);again.add(ctx.DetailMerger.readBook(ctx.XLSX,bytes),'again.xlsx');const reloaded=ctx.analyzeQuality(again);assert.equal(reloaded.orders.find(r=>r.order==='NG').fail,1);assert.equal(reloaded.orders.find(r=>r.order==='NG').total,1);
 const report=ctx.XLSX.utils.book_new();ctx.appendQualitySheets(ctx.XLSX,report,analysis);assert.ok(report.Sheets['工單良率']);assert.equal(report.Sheets['工單良率'].A1.v,'工單');
});

test('work-order stage yields average eligible process percentages and retain unique PPID input',()=>{
 const product=JSON.stringify(['IC','Model']),observations=[];for(const [process,items] of [['DAF外觀',[['a',true],['b',false]]],['DAF熱壓投入',[['c',false],['d',false],['e',false]]],['功能一測試',[['f',true]]]])for(const [serial,fail] of items)observations.push({product,date:'2026-10-05',order:'O1',process,serial,fail});
 const rows=orderStageSeries({observations},'前段',{order:'O1',product},['2026-10-05','2026-10-06']);assert.equal(rows[0].value,.5);assert.equal(rows[0].input,6);assert.equal(rows[1].value,null);
});

test('multi-selected trend items retain exposure and blank dates; disabled items are excluded from exported totals',()=>{
 const analysis=fixture();analysis.start_date='2026-10-05';analysis.end_date='2026-10-08';const all=defectTrend(analysis),names=all.series.map(s=>s.defect),selected=selectTrendSeries(all,new Set(names.slice(0,2)));
 assert.equal(selected.series.length,2);assert.deepEqual(selected.dates.map(d=>d.input),all.dates.map(d=>d.input));assert.equal(selected.dates.at(-1).rate,null);for(const [i,date] of selected.dates.entries())assert.equal(date.count,selected.series.reduce((sum,s)=>sum+s.points[i].count,0));
 const visible=selectTrendSeries(selected,[selected.series[0].defect]);assert.equal(visible.series.length,1);assert.deepEqual(visible.dates.map(d=>d.input),all.dates.map(d=>d.input));assert.deepEqual(visible.dates.map(d=>d.count),visible.series[0].points.map(p=>p.count));const none=selectTrendSeries(all,[]);assert.equal(none.series.length,0);assert.equal(none.dates[0].count,0);assert.equal(none.dates.at(-1).rate,null);assert.equal(all.series.length,names.length);
});

test('product, defect and date first axes reconcile every drilldown and keep empty dates',()=>{
 assert.deepEqual(defectDimensions('date'),['date','process','defect','product']);
 const analysis=fixture(),scope={startDate:'2026-10-05',endDate:'2026-10-08',granularity:'day'};
 for(const first of ['product','defect','date']){const order=defectDimensions(first);assert.equal(order[0],first);assert.equal(new Set(order).size,4);const visit=(filters,depth)=>{const view=defectBreakdown(analysis,filters,[],order);assert.equal(view.dimension,order[depth]||null);if(!view.dimension)return;assert.equal(view.groups.reduce((sum,g)=>sum+g.count,0),view.count);assert.ok(Math.abs(view.groups.reduce((sum,g)=>sum+g.contribution,0)-view.contribution)<1e-12);for(const group of view.groups)if(group.count)visit({...filters,[view.dimension]:group.key},depth+1);};visit(scope,0);
 const levels=allDefectLevels(analysis,scope,order),roots=levels.filter(row=>row.level===first),leaves=levels.filter(row=>row.level===order.at(-1));assert.equal(roots.reduce((sum,row)=>sum+row.count,0),analysis.fail);assert.equal(leaves.reduce((sum,row)=>sum+row.count,0),analysis.fail);assert.ok(Math.abs(leaves.reduce((sum,row)=>sum+row.contribution,0)-analysis.badRate)<1e-12);if(first!=='product')assert.ok(roots.every(row=>row.ic==='全部產品'&&row.model==='全部機種'));
 }
 const dates=defectBreakdown(analysis,scope,[],defectDimensions('date'));assert.deepEqual(dates.groups.map(row=>row.key),['2026-10-05','2026-10-06','2026-10-07','2026-10-08']);assert.equal(dates.groups.at(-1).input,0);assert.equal(dates.groups.at(-1).rate,null);
 const defects=defectBreakdown(analysis,scope,[],defectDimensions('defect'));assert.equal(defects.groups[0].input,cohortInput(analysis,{...scope,process:defects.groups[0].process}));const firstDefect=defects.groups[0];assert.equal(defectBreakdown(analysis,{...scope,defect:firstDefect.key},[],defectDimensions('defect')).dimension,'product');
 assert.deepEqual(defectDimensions('bad'),['product','date','process','defect']);
});

function sharedDefectFixture(){
 const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],book=ctx.XLSX.utils.book_new(),merger=new ctx.DetailMerger(ctx.XLSX),row=(serial,process,status,ic='A',day=5,order='o')=>[process,order,'p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',status==='FAIL'?'CG內異物':'',status,ic,'Model'];
 ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,row('a','P1','FAIL'),row('b','P1','GOOD'),row('c','P2','FAIL','B'),row('d','P2','GOOD','B'),row('e','P2','GOOD'),row('f','P2','GOOD','A',5,'other'),row('b','P2','GOOD'),row('g','P3','GOOD'),row('a','P1','GOOD','A',6),row('b','P1','GOOD','A',6)]),'Detail');merger.add(book,'same-defect.xlsx');return ctx.analyzeQuality(merger);
}
test('defect-first groups split the same name by process and use all good and bad inputs of that process',()=>{
 const analysis=sharedDefectFixture(),scope={startDate:'2026-10-05',endDate:'2026-10-06'},order=defectDimensions('defect'),view=defectBreakdown(analysis,scope,[],order),p1=view.groups.find(g=>g.process==='P1'),p2=view.groups.find(g=>g.process==='P2');
 assert.equal(analysis.total,7);assert.equal(view.groups.length,2);assert.equal(p1.input,2);assert.equal(p1.rate,.5);assert.equal(p2.input,5);assert.equal(p2.rate,.2);assert.equal(p1.contribution,1/7);assert.equal(p2.contribution,1/7);assert.notEqual(p1.key,p2.key);assert.deepEqual(parseDefectKey(p1.key),{process:'P1',defect:'CG內異物'});assert.equal(defectFilterLabel(p1.key),'CG內異物 · P1');
 const next=defectBreakdown(analysis,{...scope,defect:p1.key},[],order);assert.equal(next.dimension,'product');assert.equal(next.input,2);assert.equal(next.count,1);assert.equal(next.records[0].process,'P1');assert.ok(next.groups.every(g=>g.input<=2));
 assert.equal(cohortInput(analysis,{...scope,defect:p1.key,process:'P2'}),0);assert.equal(attributedRows(analysis,{...scope,defect:p1.key,process:'P2'}).length,0);
});
test('defect ownership persists across product/date drilldowns, order filters and week/month unique PPID counting',()=>{
 const analysis=sharedDefectFixture(),scope={startDate:'2026-10-05',endDate:'2026-10-06'},key=defectKey('P2','CG內異物'),order=defectDimensions('defect'),product=analysis.products.find(p=>p.ic==='B').id;
 assert.equal(cohortInput(analysis,{...scope,defect:key}),5);assert.equal(cohortInput(analysis,{...scope,defect:key,order:'o'}),4);assert.equal(cohortInput(analysis,{...scope,defect:key,product}),2);
 const next=defectBreakdown(analysis,{...scope,defect:key,product},[],order);assert.equal(next.dimension,'date');assert.deepEqual(next.groups.map(g=>g.input),[2,0]);assert.equal(next.groups[0].rate,.5);assert.equal(next.groups[1].rate,null);
 for(const granularity of ['week','month']){const view=defectBreakdown(analysis,{...scope,granularity},[],order);assert.equal(view.groups.find(g=>g.process==='P1').input,2);assert.equal(view.groups.find(g=>g.process==='P2').input,5);}
});
test('exported complete hierarchies carry process ownership before the process level and reconcile global contributions',()=>{
 const analysis=sharedDefectFixture(),scope={startDate:'2026-10-05',endDate:'2026-10-06'};
 for(const first of ['defect','product','date']){const order=defectDimensions(first),levels=allDefectLevels(analysis,scope,order);for(const row of levels)if(row.defect)assert.equal(row.input,cohortInput(analysis,{...scope,...row,process:row.process||row.defectProcess}));const leaves=levels.filter(row=>row.level===order.at(-1));assert.equal(leaves.reduce((sum,row)=>sum+row.count,0),2);assert.ok(Math.abs(leaves.reduce((sum,row)=>sum+row.contribution,0)-analysis.badRate)<1e-12);}
 const roots=allDefectLevels(analysis,scope,defectDimensions('defect')).filter(row=>row.level==='defect');assert.deepEqual(roots.map(row=>[row.defectProcess,row.input]).sort(),[['P1',2],['P2',5]]);
});

test('top quality summary recalculates date-range PPID unions and scoped failures instead of fixed whole-file totals',()=>{
 const row=(serial,date,process,fail,product='A',order='O1')=>({serial,date,process,fail,product,order}),analysis={observations:[row('a','2026-06-02','P1',true),row('a','2026-06-03','P2',false,'A','O2'),row('b','2026-06-03','P1',false),row('c','2026-06-03','P2',true),row('c','2026-06-03','P1',true),row('d','2026-06-04','P2',false,'B')]};
 assert.deepEqual(scopedQualitySummary(analysis),{total:4,fail:2,good:2,yield:.5,badRate:.5});
 const scope={startDate:'2026-06-03',endDate:'2026-06-03'};assert.deepEqual(scopedQualitySummary(analysis,scope),{total:3,fail:1,good:2,yield:2/3,badRate:1/3});assert.equal(scopedQualitySummary(analysis,{...scope,process:'P1'}).total,2);assert.equal(scopedQualitySummary(analysis,{...scope,order:'O1'}).total,2);assert.equal(scopedQualitySummary(analysis,{...scope,defect:'ignored'}).total,3);
 assert.deepEqual(scopedQualitySummary(analysis,{startDate:'2026-06-04',endDate:'2026-06-04',product:'B'}),{total:1,fail:0,good:1,yield:1,badRate:0});assert.deepEqual(scopedQualitySummary(analysis,{startDate:'2026-06-05',endDate:'2026-06-05'}),{total:0,fail:0,good:0,yield:null,badRate:null});assert.equal(scopedQualitySummary(analysis,{startDate:'2026-06-02',endDate:'2026-06-04'}).total,4);
});
test('a repeated FAIL inside a selected interval still lowers its quality yield even when globally attributed earlier',()=>{
 const analysis={observations:[{serial:'a',date:'2026-06-02',process:'P1',fail:true},{serial:'a',date:'2026-06-03',process:'P2',fail:true},{serial:'b',date:'2026-06-03',process:'P2',fail:false}],attribution:[{serial:'a',date:'2026-06-02',process:'P1'}]};const scope={startDate:'2026-06-03',endDate:'2026-06-03'};assert.equal(attributedRows(analysis,scope).length,0);assert.deepEqual(scopedQualitySummary(analysis,scope),{total:2,fail:1,good:1,yield:.5,badRate:.5});
});

test('date and process chart values use each column own PPID input instead of whole-file contributions',()=>{
 const analysis=fixture(),scope={startDate:'2026-10-05',endDate:'2026-10-07'},dates=defectBreakdown(analysis,scope,[],defectDimensions('date')),day=dates.groups.find(row=>row.key==='2026-10-06');
 assert.equal(analysis.total,5);assert.equal(day.input,1);assert.equal(day.count,1);assert.equal(day.contribution,.2);assert.equal(defectChartValue(day,'date'),1);assert.equal(defectChartValue(dates.groups[0],'date'),2/4);assert.equal(defectChartValue(dates.groups[2],'date'),0);
 const processes=defectBreakdown(analysis,{...scope,date:'2026-10-05'},[],defectDimensions('date')),p1=processes.groups.find(row=>row.key==='P1');assert.equal(p1.input,4);assert.equal(p1.count,2);assert.equal(defectChartValue(p1,'process'),.5);assert.notEqual(defectChartValue(p1,'process'),p1.contribution);
 const empty=defectBreakdown(analysis,{...scope,endDate:'2026-10-08'},[],defectDimensions('date')).groups.at(-1);assert.equal(empty.input,0);assert.equal(defectChartValue(empty,'date'),null);assert.equal(usesGroupInputRate('process'),true);assert.equal(defectChartValue(day,'product'),day.contribution,'product whole-file contribution remains a separate calculation');
});
test('adding other selected dates does not dilute a date column PPID denominator or rate',()=>{
 const analysis=fixture(),order=defectDimensions('date'),narrow=defectBreakdown(analysis,{startDate:'2026-10-06',endDate:'2026-10-06'},[],order).groups[0],wide=defectBreakdown(analysis,{startDate:'2026-10-05',endDate:'2026-10-08'},[],order).groups.find(row=>row.key==='2026-10-06');assert.equal(narrow.input,1);assert.equal(wide.input,1);assert.equal(defectChartValue(narrow,'date'),1);assert.equal(defectChartValue(wide,'date'),1);
});
