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
test('stage defect shares use unique failed PPID and sum to one within each product/day/stage',()=>{
 const {quality,report,result}=run([
  row('a','DAF外觀','FAIL','偏移'),row('b','DAF外觀','FAIL','偏移'),row('c','DAF外觀','GOOD',null),
  row('a','功能一測試','FAIL','其他'),row('c','功能一測試','FAIL','功能不良'),
  row('d','DAF外觀','GOOD',null),row('e','正面AOI','FAIL','AOI不良'),
  row('f','DAF外觀','FAIL','隔日',6),row('g','DAF外觀','FAIL','其他產品',5,'Elan')
 ]);
 const front=result.rows.filter(r=>r.ic==='Goodix'&&r.date==='2026-10-05'&&r.stage==='前段');
 assert.equal(front.length,2);assert.equal(front.reduce((n,r)=>n+r.stageDefectShare,0),1);
 const offset=front.find(r=>r.defect==='偏移'),other=front.find(r=>r.defect==='功能不良');
 assert.equal(offset.count,2);assert.equal(offset.stageFailTotal,3);assert.equal(offset.stageDefectShare,2/3);assert.equal(other.stageDefectShare,1/3);assert.equal(offset.processDefectShare,1);assert.equal(other.processFail,2);assert.equal(other.processDefectShare,1/2);
 for(const r of result.rows.filter(r=>!front.includes(r))){assert.equal(r.stageFailTotal,1);assert.equal(r.stageDefectShare,1);}
 appendQualitySheets(XLSX,report.book,quality);appendThresholdSheet(XLSX,report.book,result);
 const sheet=report.book.Sheets['未達標分析'],index=result.rows.indexOf(offset)+2;
 assert.equal(sheet['S'+index].v,3);assert.equal(sheet['T'+index].v,2/3);assert.equal(sheet['T'+index].z,'0.0000%');assert.equal(sheet['U'+index].v,1);assert.equal(sheet['U'+index].z,'0.0000%');const otherIndex=result.rows.indexOf(other)+2;assert.equal(sheet['U'+otherIndex].v,1/2);
});
