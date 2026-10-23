import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildStageAnalysis,stageDrillView,stageAuditSheets} from './stage-analysis.mjs';
const ctx=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','yield-core.js','quality-core.js'])vm.runInContext(readFileSync(file,'utf8'),ctx);
const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
function fixture(){
 const book=ctx.XLSX.utils.book_new(),merger=new ctx.DetailMerger(ctx.XLSX),row=(serial,process,day,status,defect,ic='A')=>[process,'WO','part','name',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'];
 const rows=[row('a','DAF外觀',12,'FAIL','DAF issue'),row('a','功能一測試',12,'FAIL','FT1 dust'),row('b','DAF外觀',12,'GOOD',''),row('c','功能一測試',12,'GOOD',''),row('x','DAF外觀',12,'FAIL','crack','B'),row('a','DAF外觀',14,'GOOD',''),row('y','DAF外觀',14,'GOOD','','B'),row('AOI-only','正面AOI',12,'FAIL','excluded','B')];
 ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');merger.add(book,'test.xlsx');const analysis=ctx.analyzeQuality(merger),report=ctx.buildYieldReport(merger,analysis.identities),model=buildStageAnalysis(analysis,'前段','2026-10-12','2026-10-14',report.calculation.stageChecks);return {analysis,model,merger};
}
test('stage dates retain original product/process arithmetic means while unique inputs union across processes and dates',()=>{
 const {model}=fixture();assert.deepEqual(model.daily.map(row=>row.input),[4,0,2]);assert.deepEqual(model.daily.map(row=>row.value),[.25,null,1]);assert.ok(model.daily.every(row=>row.consistent));assert.equal(model.period.input,5);assert.equal(model.period.sumDailyInput,6);assert.equal(model.period.repeatedInput,1);assert.equal(model.period.count,2);
 const view=stageDrillView(model,[{key:'2026-10-12'}]);assert.equal(view.parent.input,4);assert.equal(view.audit.sumInput,5);assert.equal(view.audit.overlap,1);assert.equal(view.audit.count,3);assert.equal(view.audit.badOverlap,1);assert.equal(view.audit.reconstructed,.25);assert.ok(view.audit.inputOK&&view.audit.yieldOK&&view.audit.reportOK);
 const simpleMean=view.groups.reduce((sum,g)=>sum+g.value,0)/view.groups.length;assert.notEqual(simpleMean,view.parent.value,'pooling products then averaging processes is not the saved product-first arithmetic mean');assert.equal(view.contributors.reduce((sum,r)=>sum+r.contribution,0),view.parent.value);assert.equal(view.contributors.reduce((sum,r)=>sum+r.weight,0),1);
});
test('every stage drilldown reconciles union inputs, local defect totals and parent yield without dropping failures attributed elsewhere globally',()=>{
 const {analysis,model}=fixture();assert.equal(analysis.attribution.find(row=>row.serial==='a').process,'DAF外觀');
 const visit=path=>{const view=stageDrillView(model,path);assert.ok(view.audit.inputOK&&view.audit.yieldOK&&view.audit.reportOK,JSON.stringify(path));if(path.length<3)for(const g of view.groups)visit([...path,{key:g.key}]);else assert.equal(view.groups.reduce((sum,g)=>sum+g.count,0),view.parent.count);};for(const day of model.daily)if(day.input)visit([{key:day.date}]);
 const product=analysis.products.find(p=>p.ic==='A').id,view=stageDrillView(model,[{key:'2026-10-12'},{key:'功能一測試'},{key:product}]);assert.equal(view.groups[0].label,'FT1 dust');assert.equal(view.groups[0].count,1);assert.equal(view.parent.input,2);assert.equal(view.audit.reconstructed,.5);
 const sheets=stageAuditSheets(model),totals=sheets.find(s=>s.name==='逐層驗算總表').rows.slice(1);assert.ok(totals.every(row=>row[11]===true));const weights=sheets.find(s=>s.name==='日期平均貢獻明細').rows.slice(1).filter(row=>row[0]==='2026-10-12');assert.equal(weights.reduce((sum,row)=>sum+row[10],0),.25);
});
test('stage local PPIDs use FAIL priority, exclude attribution-only rows, and keep unnamed failures in the defect breakdown',()=>{
 const product='A',analysis={products:[{id:product,ic:'A',model:'M'}],observations:[{date:'2026-10-12',process:'DAF外觀',product,serial:'a',fail:true,status:'GOOD',defect:'early GOOD'},{date:'2026-10-12',process:'DAF外觀',product,serial:'a',fail:true,status:'FAIL',defect:'first FAIL'},{date:'2026-10-12',process:'DAF外觀',product,serial:'a',fail:true,status:'FAIL',defect:'later FAIL'},{date:'2026-10-12',process:'DAF外觀',product,serial:'b',fail:true,status:'FAIL',defect:''},{date:'2026-10-12',process:'DAF外觀',product,serial:'synthetic',fail:true,status:'FAIL',attributionOnly:true}]};
 const model=buildStageAnalysis(analysis,'前段','2026-10-12','2026-10-12'),view=stageDrillView(model,[{key:'2026-10-12'},{key:'DAF外觀'},{key:product}]);assert.equal(model.daily[0].input,2);assert.equal(model.daily[0].value,0);assert.deepEqual(view.groups.map(g=>g.label).sort(),['first FAIL','【未填不良項目】'].sort());assert.equal(view.audit.reconstructed,0);assert.ok(view.audit.yieldOK&&view.audit.inputOK);
});
test('a mismatch against stored stage checks remains visible in the audit rather than silently changing the reported yield',()=>{
 const {analysis}=fixture(),model=buildStageAnalysis(analysis,'前段','2026-10-12','2026-10-12',[{date:'2026-10-12',stage:'前段',yield:.9}]),view=stageDrillView(model,[{key:'2026-10-12'}]);assert.equal(model.daily[0].value,.9);assert.equal(model.daily[0].calculated,.25);assert.equal(view.audit.reportOK,false);assert.equal(view.audit.yieldOK,false);
});
test('reopening a downloaded merged workbook retains global attribution and the other process local defects for stage reconciliation',()=>{
 const {merger}=fixture(),bytes=ctx.XLSX.write(merger.finish().book,{type:'array',bookType:'xlsx'}),again=new ctx.DetailMerger(ctx.XLSX);again.add(ctx.DetailMerger.readBook(ctx.XLSX,bytes),'downloaded.xlsx');
 const analysis=ctx.analyzeQuality(again),checks=ctx.buildYieldReport(again,analysis.identities).calculation.stageChecks,model=buildStageAnalysis(analysis,'前段','2026-10-12','2026-10-14',checks),product=analysis.products.find(row=>row.ic==='A').id;
 assert.equal(analysis.attribution.find(row=>row.serial==='a').defect,'DAF issue');assert.ok(model.daily.every(row=>row.consistent));const view=stageDrillView(model,[{key:'2026-10-12'},{key:'功能一測試'},{key:product}]);assert.equal(view.groups[0].label,'FT1 dust');assert.ok(view.audit.inputOK&&view.audit.yieldOK);
});
