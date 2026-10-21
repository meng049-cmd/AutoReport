import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});
vm.runInContext(readFileSync('vendor/xlsx.full.min.js','utf8'),context);
vm.runInContext(readFileSync('merge-core.js','utf8'),context);
const {XLSX,DetailMerger}=context;
const header = ['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態'];
function book(rows, columns=header) {
  const result=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result,XLSX.utils.aoa_to_sheet([columns,...rows]),'Detail');
  return result;
}
function row(process,day,status,defect=null) {
  const serial=(Date.UTC(2026,9,day)-Date.UTC(1899,11,30))/86400000;
  return [process,'001','part','name','serial',serial,'operator',defect,status];
}
test('FAIL whole row wins; dates and processes remain separate',()=>{
  const merger=new DetailMerger(XLSX);
  merger.add(book([row('A',5,'GOOD'),row('A',6,'GOOD')]),'first.xlsx');
  merger.add(book([row('A',5,'FAIL','defect'),row('A',5,'FAIL','later'),row('B',5,'GOOD')]),'second.xlsx');
  const result=merger.finish();
  assert.equal(result.input_rows,5);assert.equal(result.output_rows,3);assert.equal(result.removed_rows,2);
  assert.equal(result.filename,'2026_w41_1005-1006.xlsx');
  const rows=XLSX.utils.sheet_to_json(result.book.Sheets.Detail,{header:1});
  assert.equal(rows[1][7],'defect');assert.equal(rows[1][8],'FAIL');
  assert.equal(result.book.SheetNames.join(','),'Detail');
});
test('state header can be H instead of I',()=>{
  const merger=new DetailMerger(XLSX);
  const columns=header.slice(0,7).concat('狀態');
  merger.add(book([row('A',5,'GOOD').slice(0,7).concat('GOOD'),row('A',5,'FAIL').slice(0,7).concat('FAIL')],columns),'state.xlsx');
  assert.equal(merger.finish().output_rows,1);
});
test('reject missing Detail, invalid dates and inconsistent headers',()=>{
  assert.throws(()=>new DetailMerger(XLSX).add({SheetNames:[]},'bad.xlsx'),/Detail/);
  const bad=row('A',5,'GOOD');bad[5]='invalid';
  assert.throws(()=>new DetailMerger(XLSX).add(book([bad]),'bad.xlsx'),/無效/);
  const merger=new DetailMerger(XLSX);merger.add(book([row('A',5,'GOOD')]),'first.xlsx');
  assert.throws(()=>merger.add(book([row('A',5,'GOOD')],header.concat('extra')),'second.xlsx'),/不一致/);
});

test('daily report reader parses only Detail and retains metadata without unrelated sheet data',()=>{
 const input=book([row('A',5,'FAIL','bad')]);XLSX.utils.book_append_sheet(input,XLSX.utils.aoa_to_sheet([['other'],['not a detail row']]),'OldReport');
 const bytes=XLSX.write(input,{type:'array',bookType:'xlsx'}),selected=DetailMerger.readBook(XLSX,bytes);
 assert.ok(selected.Sheets.Detail);assert.equal(selected.Sheets.OldReport,undefined);
 const m=new DetailMerger(XLSX);m.add(selected,'master.xlsx');assert.equal(m.finish().output_rows,1);
});
test('original Chinese source filenames survive merge download and report reload',()=>{
 const merger=new DetailMerger(XLSX);merger.add(book([row('A',5,'GOOD')]),'W39工單明細.xlsx');merger.add(book([row('B',6,'FAIL','bad')]),'W40工單明細.xlsx');
 const output=merger.finish().book,again=new DetailMerger(XLSX);again.add(DetailMerger.readBook(XLSX,XLSX.write(output,{type:'array',bookType:'xlsx'})),'合併主檔.xlsx');
 assert.deepEqual([...again.sources],['W39工單明細.xlsx','W40工單明細.xlsx']);
});

test('Scrap is FAIL priority while raw cells and first FAIL/Scrap input order stay intact',()=>{
 for(const [first,second,winner] of [['GOOD','Scrap','Scrap'],[' scrap ','FAIL',' scrap '],['FAIL','SCRAP','FAIL'],['sCrAp','GOOD','sCrAp']]){
  const m=new DetailMerger(XLSX);m.add(book([row('P',5,first)]),'first.xlsx');m.add(book([row('P',5,second)]),'second.xlsx');
  assert.equal(m.finish().book.Sheets.Detail.I2.v,winner);assert.equal(m.firstNG.get('serial').status,'FAIL');assert.equal(m.analysisFirstNG.get('serial').defect,'【未填不良項目】');
 }
 const m=new DetailMerger(XLSX);m.add(book([row('P',5,'Scrap').slice(0,7).concat('Scrap')],header.slice(0,7).concat('狀態')),'H-status.xlsx');assert.equal(m.hasDefect([...m.rows.values()][0]),true);
});

test('strict errors remain default; test mode skips only bad rows and preserves physical Excel row numbers across downloads',()=>{
 const invalid=row('P',5,'UNKNOWN'),badDate=row('P',5,'GOOD');badDate[5]='not a date';const input=book([row('P',5,'Scrap'),[],invalid,badDate]);
 assert.throws(()=>new DetailMerger(XLSX).add(input,'errors.xlsx'),/第 4 列.*GOOD／FAIL／Scrap/);
 const m=new DetailMerger(XLSX,{skipInvalidRows:true});m.add(input,'errors.xlsx');assert.equal(m.total,1);assert.equal(m.rows.size,1);assert.equal(m.skippedRows.length,2);assert.equal(m.skippedRows[0].row,4);assert.equal(m.skippedRows[1].row,5);assert.equal(m.skippedRows[0].values[8],'UNKNOWN');assert.match(m.skippedRows[1].reason,/產出時間/);
 const merged=m.finish();assert.equal(merged.skipped_rows,2);assert.equal(merged.removed_rows,0);const again=new DetailMerger(XLSX);again.add(DetailMerger.readBook(XLSX,XLSX.write(merged.book,{type:'array',bookType:'xlsx'})),'saved.xlsx');assert.equal(again.skippedRows.length,2);assert.equal(again.skippedRows[0].filename,'errors.xlsx');assert.equal(again.finish().skipped_rows,2);
 assert.throws(()=>new DetailMerger(XLSX,{skipInvalidRows:true}).add({SheetNames:[]},'bad.xlsx'),/Detail/);
 const empty=new DetailMerger(XLSX,{skipInvalidRows:true});empty.add(book([invalid]),'invalid.xlsx');assert.throws(()=>empty.finish(),/已略過 1 列.*沒有可分析/);empty.add(book([row('P',6,'GOOD')]),'valid.xlsx');assert.equal(empty.finish().output_rows,1);
});
