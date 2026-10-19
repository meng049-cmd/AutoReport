import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const context=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','quality-core.js'])vm.runInContext(readFileSync(file,'utf8'),context);
const {XLSX,DetailMerger,analyzeQuality,appendQualitySheets}=context;
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const row=(serial,process,status,defect,day=5,ic='A')=>[process,'o','p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'];
function analyze(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');const merger=new DetailMerger(XLSX);merger.add(book,'master.xlsx');return analyzeQuality(merger);}
test('unique units and one primary process/defect reconcile every ranking to overall failure rate',()=>{
 const a=analyze([row('a','P1','FAIL','破損,或一致性差'),row('a','P2','FAIL','later',6),row('a','P1','GOOD',null,7),row('b','P1','FAIL','破損,或一致性差'),row('c','P1','GOOD',null),row('d','P2','FAIL','later',5,'B'),row('e','P1','GOOD',null,5,'B')]);
 assert.equal(a.total,5);assert.equal(a.fail,3);assert.equal(a.badRate,.6);assert.equal(a.yield,.4);
 const p=a.products.find(p=>p.ic==='A');assert.equal(p.total,3);assert.equal(p.defects.length,1);assert.equal(p.defects[0].process,'P1');assert.equal(p.defects[0].defect,'破損,或一致性差');assert.equal(p.defects[0].count,2);
 assert.equal(p.defects.reduce((sum,d)=>sum+d.count,0),p.fail);
 assert.ok(Math.abs(a.products.reduce((sum,p)=>sum+p.contribution,0)-a.badRate)<1e-12);
 assert.equal(a.defects.reduce((sum,d)=>sum+d.count,0),a.fail);
 assert.equal(a.processes.find(p=>p.process==='P1').total,4);assert.equal(a.processes.find(p=>p.process==='P1').fail,2);
 const book=XLSX.utils.book_new();appendQualitySheets(XLSX,book,a);assert.equal(book.Sheets['品質總覽'].F2.v,.6);assert.equal(book.Sheets['全產品不良排名'].F2.v,.4);
 const loaded=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});assert.equal(loaded.Sheets['品質總覽'].B2.v,5);
});
test('one PPID with contradictory products is counted once and explicitly pending',()=>{
 const a=analyze([row('same','P1','FAIL','對照測試'),row('same','P1','GOOD',null,6,'B')]);assert.equal(a.total,1);assert.equal(a.fail,1);assert.equal(a.identityConflicts.length,1);assert.equal(a.products[0].pending,true);assert.equal(a.defects[0].defect,'對照測試');
});

test('cross-station and cross-day observations with blank mappings never increase total PPID quantity',()=>{
 const rows=[row('ppid','P1','GOOD',null),row('ppid','P2','FAIL','bad',6,''),row('ppid','P1','GOOD',null,7),row('second','P1','GOOD',null)];rows[1][10]='';
 const a=analyze(rows);assert.equal(a.total,2);assert.equal(a.fail,1);assert.equal(a.products.length,1);assert.equal(a.products[0].total,2);assert.equal(a.badRate,.5);assert.equal(a.defects[0].rate,.5);assert.equal(a.processes.find(p=>p.process==='P1').total,2);
});

test('first defect follows input order and counts GOOD and FAIL in rates',()=>{
 const a=analyze([row('a','P2','GOOD','first input',6),row('a','P1','FAIL','earlier clock',5),row('b','P0','GOOD','CG內異物'),row('c','P0','FAIL',null)]);
 assert.equal(a.total,3);assert.equal(a.fail,2);assert.equal(a.good,1);assert.equal(a.yield,1/3);assert.equal(a.badRate,2/3);
 assert.equal(a.attribution[0].date,'2026-10-06');assert.equal(a.attribution[0].process,'P2');assert.equal(a.attribution[0].defect,'first input');assert.equal(a.attribution[0].status,'GOOD');
 assert.equal(a.defects.reduce((n,d)=>n+d.count,0),2);
});
test('first GOOD defect survives FAIL-priority merging and merged workbook download/reload',()=>{
 const input=XLSX.utils.book_new();const first=row('a','P1','GOOD','first in input',5),later=row('a','P1','FAIL','second in input',5);first[5]+=.6;later[5]+=.4;
 XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,first,later]),'Detail');const merger=new DetailMerger(XLSX);merger.add(input,'raw.xlsx');
 const merged=merger.finish();assert.equal(merged.output_rows,1);assert.equal(merged.removed_rows,1);assert.equal(merged.book.Sheets.Detail.H2.v,'second in input');assert.equal(merged.book.Sheets.Detail.I2.v,'FAIL');
 assert.equal(analyzeQuality(merger).attribution[0].defect,'first in input');
 const downloaded=XLSX.read(XLSX.write(merged.book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),again=new DetailMerger(XLSX);again.add(downloaded,'merged.xlsx');
 assert.equal(analyzeQuality(again).attribution[0].defect,'first in input');assert.equal(analyzeQuality(again).attribution[0].timestamp,first[5]);
 const report=XLSX.utils.book_new();appendQualitySheets(XLSX,report,analyzeQuality(again));assert.equal(report.Sheets['不良歸屬明細'].I2.v,'GOOD');
 downloaded.Sheets.Detail.H2.v='manually changed';const changed=new DetailMerger(XLSX);changed.add(downloaded,'edited.xlsx');assert.equal(analyzeQuality(changed).attribution[0].defect,'manually changed');
});
test('same-day GOOD defect removed by a blank-FAIL merge winner remains a defect after download',()=>{
 const input=XLSX.utils.book_new();XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,row('a','P1','GOOD','retained evidence'),row('a','P1','FAIL',null)]),'Detail');
 const m=new DetailMerger(XLSX);m.add(input,'raw.xlsx');const merged=m.finish();assert.equal(merged.book.Sheets.Detail.H2,undefined);
 const again=new DetailMerger(XLSX);again.add(XLSX.read(XLSX.write(merged.book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),'merged.xlsx');
 assert.equal(analyzeQuality(again).fail,1);assert.equal(analyzeQuality(again).attribution[0].defect,'retained evidence');
});
test('first defect uses selected file order before row order across dates and processes',()=>{
 const m=new DetailMerger(XLSX);for(const [name,rs] of [['first.xlsx',[row('a','P2','GOOD','selected first',7)]],['second.xlsx',[row('a','P1','FAIL','older time',3)]]]){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([header,...rs]),'Detail');m.add(b,name);}
 assert.equal(analyzeQuality(m).attribution[0].defect,'selected first');assert.equal(analyzeQuality(m).fail,1);
});
test('Chinese first-defect metadata survives XLSX chronological output sorting',()=>{
 const input=XLSX.utils.book_new(),first=row('中科小板','外觀檢查點亮測試','GOOD','輸入第一項',6),second=row('中科小板','功能二測試','FAIL','較早時間',5);
 XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,first,second]),'Detail');const m=new DetailMerger(XLSX);m.add(input,'原始檔.xlsx');
 const book=XLSX.read(XLSX.write(m.finish().book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',dense:true}),again=new DetailMerger(XLSX);again.add(book,'下載檔.xlsx');
 assert.equal(analyzeQuality(again).attribution[0].defect,'輸入第一項');assert.equal(analyzeQuality(again).attribution[0].status,'GOOD');
});
