import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const context=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','yield-core.js','quality-core.js','threshold-core.js'])vm.runInContext(readFileSync(file,'utf8'),context);
const {XLSX,DetailMerger,buildYieldReport,analyzeQuality,buildThresholdAnalysis,appendThresholdSheet,appendQualitySheets}=context;
const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const row=(serial,process,status,defect,day=5,ic='Goodix')=>[process,'o','p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'];
function run(rows){const input=XLSX.utils.book_new();XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');const merger=new DetailMerger(XLSX);merger.add(input,'master.xlsx');const quality=analyzeQuality(merger),report=buildYieldReport(merger,quality.identities);return {merger,quality,report,result:buildThresholdAnalysis(merger,report.calculation,quality.identities)};}
test('below-target date/stage diagnosis uses unique daily product/global PPID denominators and actual station counts',()=>{
 const rows=[];for(const process of ['DAF外觀','功能一測試'])for(const serial of ['a','b','c'])rows.push(row(serial,process,serial==='a'?'FAIL':'GOOD',serial==='a'?'bad':null));rows.push(row('d','正面AOI','GOOD',null,5,'Elan'));
 const {quality,report,result}=run(rows);assert.equal(result.below.length,1);assert.equal(result.below[0].stage,'前段');assert.equal(result.rows.length,1);const r=result.rows[0];assert.equal(r.count,1);assert.equal(r.productTotal,3);assert.equal(r.globalTotal,4);assert.equal(r.productRate,1/3);assert.equal(r.globalRate,1/4);assert.equal(r.processGood,2);assert.equal(r.processFail,1);assert.equal(r.process,'DAF外觀');assert.equal(r.yield,2/3);
 appendQualitySheets(XLSX,report.book,quality);appendThresholdSheet(XLSX,report.book,result);const sheet=report.book.Sheets['未達標分析'];assert.equal(sheet.O2.v,2);assert.equal(sheet.P2.v,1);assert.equal(sheet.M2.v,1/3);
});
test('threshold equality passes and absent stages are never flagged',()=>{
 const {merger,quality,report}=run([row('a','正面AOI','GOOD',null)]);
 const checks=[{product:quality.products[0].id,ic:'Goodix',model:'Model',date:'2026-10-05',stage:'SMT',yield:.995,processes:['正面AOI']},{product:quality.products[0].id,stage:'前段',yield:.98,processes:[]},{product:quality.products[0].id,stage:'後段',yield:.99,processes:[]}];
 assert.equal(buildThresholdAnalysis(merger,{...report.calculation,stageChecks:checks},quality.identities).below.length,0);assert.equal(report.calculation.stageChecks.length,1);
});
test('all-product composition counts all FAIL records across products and dates, with no first-failure attribution',()=>{
 const {quality,report,result}=run([
  row('a','DAF外觀','FAIL','偏移'),row('a','功能一測試','FAIL','功能不良'),
  row('b','DAF外觀檢查','FAIL','偏移',5,'Elan'),row('a','DAF外觀','FAIL','偏移',6),
  row('c','DAF外觀','FAIL','其他'),row('c','DAF外觀','GOOD',null),
  row('d','正面AOI','FAIL','AOI'),row('e','背面AOI','FAIL',null),row('f','DAF外觀','GOOD',null),row('g','功能一測試','GOOD',null)
 ]);
 const offset=result.composition.find(r=>r.defect==='偏移'),functional=result.composition.find(r=>r.defect==='功能不良');
 assert.equal(offset.count,3);assert.equal(offset.processTotal,5);assert.equal(offset.stageTotal,7);assert.equal(offset.processGood,1);assert.equal(offset.processFail,4);assert.equal(offset.stageGood,2);assert.equal(offset.stageFail,5);assert.equal(offset.processShare,3/5);assert.equal(offset.stageShare,3/7);assert.equal(functional.count,1);
 assert.ok(Math.abs(result.composition.filter(r=>r.stage==='前段').reduce((n,r)=>n+r.stageShare,0)-5/7)<1e-12);
 assert.equal(result.composition.filter(r=>r.process==='DAF外觀').reduce((n,r)=>n+r.processShare,0),4/5);
 assert.equal(result.composition.reduce((n,r)=>n+r.count,0),7);
 const unknown=result.composition.find(r=>r.process==='背面AOI');assert.equal(unknown.stageShare,null);assert.equal(unknown.processShare,1);
 appendQualitySheets(XLSX,report.book,quality);appendThresholdSheet(XLSX,report.book,result);
 const sheet=report.book.Sheets['全產品不良項目占比'],index=result.composition.indexOf(offset)+2;
 assert.equal(sheet['D'+index].v,3);assert.equal(sheet['G'+index].v,3/5);assert.equal(sheet['H'+index].v,3/7);assert.equal(sheet['H'+index].z,'0.0000%');
});
test('empty FAIL composition exports headers without dividing by zero',()=>{
 const {quality,report,result}=run([row('a','正面AOI','GOOD',null)]);assert.equal(result.composition.length,0);
 appendQualitySheets(XLSX,report.book,quality);appendThresholdSheet(XLSX,report.book,result);assert.equal(report.book.Sheets['全產品不良項目占比']['!ref'],'A1:L1');
});
