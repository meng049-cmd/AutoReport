import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const context=vm.createContext({});for(const file of ['vendor/xlsx.full.min.js','merge-core.js','yield-core.js'])vm.runInContext(readFileSync(file,'utf8'),context);
const {XLSX,DetailMerger,buildYieldReport}=context;
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
function row(process,status,serial,day=5,ic='Goodix',model='CY26-16'){return [process,'001','part','name',serial,(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000,'operator',status==='FAIL'?'測試不良':null,status,ic,model];}
function report(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');const merger=new DetailMerger(XLSX);merger.add(book,'master.xlsx');return buildYieldReport(merger);}
test('per-product daily yields and arithmetic stage averages, including FAIL-first deduplication',()=>{
 const r=report([row('DAF外觀檢查','GOOD','a'),row('DAF外觀檢查','FAIL','a'),row('DAF外觀檢查','GOOD','b'),row('DAF熱壓投入','GOOD','c'),row('DAF熱壓投入','GOOD','d'),row('DAF熱壓投入','GOOD','e'),row('功能一測試','FAIL','f'),row('正面AOI','GOOD','s'),row('DAF外觀檢查','GOOD','x',7),row('DAF外觀檢查','FAIL','z',5,'Synaptics','CY26-16')]);
 assert.equal(r.removed_rows,1);assert.equal(r.product_count,2);assert.equal(r.date_count,3);
 const stages=r.book.Sheets['每日階段良率'];assert.equal(stages.B3.v,1);assert.equal(stages.B4.v,.5);assert.equal(stages.C4.v,'');assert.equal(stages.D4.v,1);assert.match(stages.B4.f,/AGGREGATE\(1,6/);
 assert.equal(stages.B10.v,0,'all FAIL produces zero, not blank');
 const processes=r.book.Sheets['每日製程良率'];assert.equal(processes.B3.v,.5);assert.equal(processes.B4.v,1);assert.equal(processes.B5.v,0);
 assert.equal(r.book.Sheets['計算明細'].H2.f,'E2/(E2+F2)');
 const bytes=XLSX.write(r.book,{bookType:'xlsx',type:'buffer'}),loaded=XLSX.read(bytes,{type:'buffer',cellFormula:true});
 assert.equal(loaded.Sheets['每日階段良率'].B4.v,.5);assert.match(loaded.Sheets['每日階段良率'].B4.f,/AGGREGATE/);assert.equal(loaded.Sheets['每日階段良率'].C4.v,'');
 assert.equal(loaded.SheetNames.join(','),'每日製程良率,每日階段良率,計算明細,Detail');
});
test('missing product remains explicitly pending, with original rows preserved',()=>{const r=row('正面AOI','GOOD','a');r[9]='';const result=report([r]);assert.equal(result.missing_product_rows,1);assert.equal(result.product_count,0);assert.equal(result.pending_product_count,1);assert.equal(result.book.Sheets['每日製程良率'].A2.v,'【待補 IC】');assert.ok(result.book.Sheets['待補產品資料']);});

test('daily yield classifies defect text instead of status and preserves discarded GOOD evidence',()=>{
 const a=row('正面AOI','GOOD','a');a[7]='CG內異物';const b=row('正面AOI','FAIL','b');b[7]=null;
 const replacement=row('正面AOI','FAIL','a');replacement[7]=null;
 const r=report([a,replacement,b]);assert.equal(r.output_rows,2);assert.equal(r.calculation.dailyCounts[0].fail,1);assert.equal(r.calculation.dailyCounts[0].good,1);assert.equal(r.book.Sheets['計算明細'].H2.v,.5);assert.equal(r.book.Sheets['計算明細'].I2.v,.5);assert.equal(r.book.Sheets['計算明細'].I2.f,'F2/(E2+F2)');
 const again=XLSX.read(XLSX.write(r.book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),m=new DetailMerger(XLSX);m.add(again,'report.xlsx');assert.equal(buildYieldReport(m).book.Sheets['計算明細'].H2.v,.5);
});
