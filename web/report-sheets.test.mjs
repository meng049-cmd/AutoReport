import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function runtime(){const ctx=vm.createContext({});for(const f of ['vendor/xlsx.full.min.js','merge-core.js','report-sheets.js'])vm.runInContext(readFileSync(f,'utf8'),ctx);return ctx;}
const header=['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
test('partitioned Detail roundtrip retains every row, formats, order and hidden state',()=>{
 const {XLSX,DetailMerger,splitReportSheets}=runtime(),merger=new DetailMerger(XLSX),input=XLSX.utils.book_new();
 const rows=Array.from({length:7},(_,i)=>['DAF外觀','WO','P','N','S'+i,46000+i,'op',i===3?'dust':'',i===3?'FAIL':'GOOD','IC','M']);
 XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');merger.add(input,'source.xlsx');const output=merger.finish().book;output.Workbook={Sheets:[{name:'Detail',Hidden:1}]};
 splitReportSheets(XLSX,output,4);assert.deepEqual(Array.from(output.SheetNames),['Detail','Detail_2','Detail_3']);for(const name of output.SheetNames)assert.ok(XLSX.utils.decode_range(output.Sheets[name]['!ref']).e.r<4);assert.ok(output.Workbook.Sheets.every(s=>s.Hidden===1));
 const bytes=XLSX.write(output,{type:'array',bookType:'xlsx'}),again=new DetailMerger(XLSX);again.add(DetailMerger.readBook(XLSX,bytes),'report.xlsx');assert.equal(again.rows.size,7);assert.equal(again.analysisFirstNG.get('S3').defect,'dust');assert.equal(again.finish().output_rows,7);
});
test('analysis metadata path bypasses Excel merge row ceiling without creating a merged worksheet',()=>{
 const {XLSX,DetailMerger}=runtime(),merger=new DetailMerger(XLSX),input=XLSX.utils.book_new();XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([header,['DAF外觀','WO','P','N','S',46000,'op','','GOOD','IC','M']]),'Detail');merger.add(input,'source.xlsx');Object.defineProperty(merger.rows,'size',{value:1048576});assert.throws(()=>merger.finish(),/列數上限/);const report=merger.finish({analysisOnly:true});assert.equal(report.book.SheetNames.length,0);assert.equal(report.output_rows,1);
});
test('large summary tables keep cached numeric results and duplicate their header per partition',()=>{
 const {XLSX,splitReportSheets}=runtime(),book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['n','rate'],[1,.5],[2,0],[3,1],[4,.25]]);sheet.B2.f='1/2';XLSX.utils.book_append_sheet(book,sheet,'不良明細');splitReportSheets(XLSX,book,3);assert.equal(book.Sheets['不良明細'].B2.v,.5);assert.equal(book.Sheets['不良明細'].B2.f,undefined);assert.equal(book.Sheets['不良明細_2'].A1.v,'n');assert.equal(book.Sheets['不良明細_2'].A3.v,4);
});
