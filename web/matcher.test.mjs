import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ExcelJS from 'exceljs';
import {Matcher,norm,firstText,role} from './matcher.mjs';
import {matchFile,inputTables,exportMatches} from './files.mjs';
const matcher=new Matcher(JSON.parse(readFileSync('dist/reference.json','utf8')));
const python='.venv/bin/python';
function oracle(code){return JSON.parse(execFileSync(python,['-c',code],{encoding:'utf8',maxBuffer:30*1024*1024}));}
test('every indexed identifier returns exactly the SQLite candidates and evidence',()=>{
 const expected=oracle("import autoreport as a,json\ndb=a.connect()\nprint(json.dumps([[kind,value,a.lookup(db,[(kind,value)])] for kind,value in db.execute('SELECT DISTINCT kind,value FROM lookup_keys ORDER BY kind,value')],ensure_ascii=False))");
 for(const [kind,value,result] of expected)assert.deepEqual(matcher.lookup([[kind,value]]),result,kind+':'+value);
 console.log(`Compared ${expected.length} identifiers, including all 1268 work orders`);
});
test('sample XLSX matches the full Python result including all original cells',async()=>{
 const filename='上傳查詢範例.xlsx',bytes=readFileSync('downloads/AutoReport_query_template.xlsx');
 const expected=oracle("import autoreport as a,json\nfrom pathlib import Path\nprint(json.dumps(a.match_upload(a.connect(),Path('downloads/AutoReport_query_template.xlsx').read_bytes(),'上傳查詢範例.xlsx'),ensure_ascii=False))");
 const actual=await matchFile(matcher,bytes,filename);assert.deepEqual(actual,expected);
 const exported=await exportMatches(actual),book=new ExcelJS.Workbook();await book.xlsx.load(exported);assert.equal(book.worksheets[0].rowCount,16);
});
test('Chinese aliases, width, prefixes and first entries retain names with slash/comma',()=>{
 assert.equal(norm('機種'),norm('机种'));assert.equal(role('機型'),'ic');assert.equal(role('工單號碼'),'order');
 assert.equal(firstText('\nSlate/Congo 14,15\nOther'),'Slate/Congo 14,15');
 assert.equal(matcher.lookup([['order','ＳＡＰ： Ｃ５１５－２５０３００００４\nC533-260100003']])['狀態'],'唯一匹配');
 assert.equal(matcher.lookup([['order','C515-251100004']])['狀態'],'查無資料');
 assert.equal(matcher.lookup([['order','C533-260100003']])['狀態'],'多組候選');
 assert.equal(matcher.lookup([['order','C515-250300004'],['ic','Synaptics']])['狀態'],'條件不一致');
});
test('all query worksheets, merged orders and cached formula results, no formula execution',async()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('自訂查詢分頁');s.addRows([['工單號碼','備註'],['C515-250300004','=HYPERLINK("https://example.com")'],['','x']]);s.mergeCells('A2:A3');
 const s2=book.addWorksheet('任意第二頁');s2.addRows([['产品料号','机型'],['98000320-107','Goodix']]);
 const tables=await inputTables(await book.xlsx.writeBuffer(),'test.xlsx');assert.equal(tables[0].raw[2][0],'');assert.equal(tables[0].expanded[2][0],'C515-250300004');
 const r=await matchFile(matcher,await book.xlsx.writeBuffer(),'test.xlsx');assert.equal(r['筆數'],3);assert.ok(r['結果'].every(i=>i['狀態']==='唯一匹配'));
 const output=new ExcelJS.Workbook();await output.xlsx.load(await exportMatches(r));assert.equal(output.worksheets[0].getCell('I2').type,ExcelJS.ValueType.String);
});
test('CSV quoted newline, UTF-8, Big5 and GB18030, unsupported and oversized files',async()=>{
 const bytes=new TextEncoder().encode('\uFEFF工單號碼,機型,備註\r\n"C515-250300004\nC533-260100003",Goodix,"a,b"\r\n');
 const result=await matchFile(matcher,bytes,'query.csv');assert.equal(result['筆數'],1);assert.equal(result['結果'][0]['狀態'],'唯一匹配');assert.equal(result['結果'][0]['原始資料'][2]['值'],'a,b');
 for(const encoding of ['cp950','gb18030']){const encoded=execFileSync(python,['-c',`import sys;sys.stdout.buffer.write('工單號碼,機型\\nC515-250300004,Goodix\\n'.encode('${encoding}'))`]);assert.equal((await matchFile(matcher,encoded,'query.csv'))['結果'][0]['狀態'],'唯一匹配');}
 await assert.rejects(inputTables(new Uint8Array(20*1024*1024+1),'x.xlsx'),/20 MB/);
 await assert.rejects(inputTables(new Uint8Array(),'x.xls'),/xlsx/);
});
