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
