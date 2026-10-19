import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const context=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','quality-core.js'])vm.runInContext(readFileSync(file,'utf8'),context);
const {XLSX,DetailMerger,analyzeQuality,appendQualitySheets}=context;
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const row=(serial,process,status,defect,day=5,ic='A')=>[process,'o','p','n',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'op',defect,status,ic,'Model'];
function analyze(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');const merger=new DetailMerger(XLSX);merger.add(book,'master.xlsx');return analyzeQuality(merger);}
test('unique units and one primary process/defect reconcile every ranking to overall failure rate',()=>{
 const a=analyze([row('a','P2','FAIL','later',6),row('a','P1','FAIL','破損,或一致性差'),row('a','P1','GOOD',null,7),row('b','P1','FAIL','破損,或一致性差'),row('c','P1','GOOD',null),row('d','P2','FAIL','later',5,'B'),row('e','P1','GOOD',null,5,'B')]);
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
 const a=analyze([row('same','P1','FAIL',null),row('same','P1','GOOD',null,6,'B')]);assert.equal(a.total,1);assert.equal(a.fail,1);assert.equal(a.identityConflicts.length,1);assert.equal(a.products[0].pending,true);assert.equal(a.defects[0].defect,'【未填不良項目】');
});

test('cross-station and cross-day observations with blank mappings never increase total PPID quantity',()=>{
 const rows=[row('ppid','P1','GOOD',null),row('ppid','P2','FAIL','bad',6,''),row('ppid','P1','GOOD',null,7),row('second','P1','GOOD',null)];rows[1][10]='';
 const a=analyze(rows);assert.equal(a.total,2);assert.equal(a.fail,1);assert.equal(a.products.length,1);assert.equal(a.products[0].total,2);assert.equal(a.badRate,.5);assert.equal(a.defects[0].rate,.5);assert.equal(a.processes.find(p=>p.process==='P1').total,2);
});

test('first NG means only FAIL: GOOD defect text is ignored and chronological first FAIL wins',()=>{
 const a=analyze([row('a','P0','GOOD','CG內異物',4),row('a','P2','FAIL','later',6),row('a','P1','FAIL','first',5),row('b','P0','GOOD','CG內異物',4)]);
 assert.equal(a.total,2);assert.equal(a.fail,1);assert.equal(a.good,1);assert.equal(a.yield,.5);
 assert.equal(a.attribution[0].date,'2026-10-05');assert.equal(a.attribution[0].process,'P1');assert.equal(a.attribution[0].defect,'first');assert.equal(a.attribution[0].status,'FAIL');
 assert.equal(a.defects.some(d=>d.defect==='CG內異物'),false);
});
test('first FAIL survives unchanged daily merging and a merged workbook download/reload',()=>{
 const input=XLSX.utils.book_new();const late=row('a','P1','FAIL','late',5),early=row('a','P1','FAIL','early',5);late[5]+=.6;early[5]+=.4;
 XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,late,early]),'Detail');const merger=new DetailMerger(XLSX);merger.add(input,'raw.xlsx');
 const merged=merger.finish();assert.equal(merged.output_rows,1);assert.equal(merged.removed_rows,1);assert.equal(merged.book.Sheets.Detail.H2.v,'late');
 assert.equal(analyzeQuality(merger).attribution[0].defect,'early');
 const downloaded=XLSX.read(XLSX.write(merged.book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),again=new DetailMerger(XLSX);again.add(downloaded,'merged.xlsx');
 assert.equal(analyzeQuality(again).attribution[0].defect,'early');assert.equal(analyzeQuality(again).attribution[0].timestamp,early[5]);
 const report=XLSX.utils.book_new();appendQualitySheets(XLSX,report,analyzeQuality(again));assert.equal(report.Sheets['不良歸屬明細'].I2.v,'FAIL');assert.equal(report.Sheets['不良歸屬明細'].H2.v,early[5]);
 downloaded.Sheets.Detail.H2.v='manually changed';const changed=new DetailMerger(XLSX);changed.add(downloaded,'edited.xlsx');assert.equal(analyzeQuality(changed).attribution[0].defect,'manually changed');
});
test('equal timestamp first NG keeps the input order across different processes',()=>{
 const a=analyze([row('same','P2','FAIL','first'),row('same','P1','FAIL','second')]);assert.equal(a.fail,1);assert.equal(a.attribution[0].defect,'first');
});

test('Chinese first-NG metadata survives an XLSX round trip',()=>{
 const input=XLSX.utils.book_new(),late=row('中科小板','外觀檢查點亮測試','FAIL','晚一筆不良'),early=row('中科小板','外觀檢查點亮測試','FAIL','首次異物');late[5]+=.7;early[5]+=.1;
 XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,late,early]),'Detail');const m=new DetailMerger(XLSX);m.add(input,'原始檔.xlsx');
 const book=XLSX.read(XLSX.write(m.finish().book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',dense:true}),again=new DetailMerger(XLSX);again.add(book,'下載檔.xlsx');
 assert.equal(analyzeQuality(again).attribution[0].defect,'首次異物');assert.equal(analyzeQuality(again).attribution[0].process,'外觀檢查點亮測試');
});
