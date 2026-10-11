import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {matchFile,exportMatches} from './files.mjs';
test('Detail B/C matching appends J/K and preserves original XML cells and other sheets',async()=>{
 const book=new ExcelJS.Workbook();const detail=book.addWorksheet('Detail');
 detail.addRow(['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態']);
 detail.addRow(['背面大板','626090100','92000283-X','RFPC', 'TW000Y',new Date('2026-10-11'), '卓佳玲',null,'Good']);
 detail.getCell('F2').numFmt='yyyy/mm/dd hh:mm';detail.getCell('D2').font={bold:true};detail.getCell('I2').value={formula:'"Good"',result:'Good'};
 detail.addRow(['背面大板','missing','unknown']);book.addWorksheet('Data').addRow(['保留']);book.addWorksheet('2D').addRow([123]);
 const bytes=await book.xlsx.writeBuffer();const calls=[];
 const matcher={lookup(criteria){calls.push(criteria);return criteria[0][1]==='missing'?{'狀態':'查無資料','候選':[]}:{'狀態':'唯一匹配','候選':[{'機種':'Model A',IC:'Goodix'}]};}};
 const result=await matchFile(matcher,bytes,'original.xlsx');assert.equal(result['筆數'],2);assert.deepEqual(calls[0],[['order','626090100'],['part','92000283-X']]);
 const output=await exportMatches(result);const before=await JSZip.loadAsync(bytes),after=await JSZip.loadAsync(output);
 for(const name of Object.keys(before.files).filter(n=>!before.files[n].dir&&n!=='xl/worksheets/sheet1.xml'))assert.deepEqual(await after.file(name).async('uint8array'),await before.file(name).async('uint8array'),name);
 const original=await before.file('xl/worksheets/sheet1.xml').async('string'),changed=await after.file('xl/worksheets/sheet1.xml').async('string');
 for(const cell of original.match(/<c\b[^>]*\br="[A-I]\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g))assert.ok(changed.includes(cell),cell);
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(output);assert.equal(loaded.getWorksheet('Detail').getCell('J2').value,'Goodix');assert.equal(loaded.getWorksheet('Detail').getCell('K2').value,'Model A');assert.equal(loaded.getWorksheet('Detail').getCell('J3').text,'');assert.equal(loaded.getWorksheet('Detail').getCell('J1').value,'IC');
 detail.getCell('J2').value='Existing';await assert.rejects(matchFile(matcher,await book.xlsx.writeBuffer(),'x.xlsx'),/已有資料/);
});

test('small compressed workbook with 90000 data rows exports on a bounded call stack',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('Detail').addRow(['製程','工單','料號']);
 const zip=await JSZip.loadAsync(await book.xlsx.writeBuffer());
 const name='xl/worksheets/sheet1.xml';let xml=await zip.file(name).async('string');
 const rows=[];for(let n=2;n<=90001;n++)rows.push(`<row r="${n}"><c r="A${n}" t="inlineStr"><is><t>保留</t></is></c></row>`);
 xml=xml.replace('</sheetData>',rows.join('')+'</sheetData>').replace('ref="A1:C1"','ref="A1:C90001"');zip.file(name,xml);
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});assert.ok(bytes.length<1024*1024,'fixture is smaller than 1 MB');
 const dir=await mkdtemp(path.join(tmpdir(),'autoreport-stack-'));
 try{
  const fixture=path.join(dir,'small.xlsx');await writeFile(fixture,bytes);
  const code=`
   import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import JSZip from 'jszip';
   import {exportMatches} from './web/files.mjs';
   const detailBytes=readFileSync(process.argv[1]);
   const result={detailBytes,'結果':Array.from({length:90000},(_,i)=>({'列號':i+2,IC:'Goodix','機種':'Model A'}))};
   const output=await exportMatches(result);const zip=await JSZip.loadAsync(output);
   const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
   assert.ok(xml.includes('ref="A1:K90001"'));assert.ok(xml.includes('<c r="K90001" t="inlineStr"><is><t>Model A</t></is></c>'));
   assert.ok(xml.includes('<c r="A90001" t="inlineStr"><is><t>保留</t></is></c>'));
  `;
  execFileSync(process.execPath,['--stack-size=256','--input-type=module','-e',code,fixture],{cwd:process.cwd(),timeout:60000});
 }finally{await rm(dir,{recursive:true,force:true});}
});
