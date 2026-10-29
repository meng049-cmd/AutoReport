import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {matchFile,exportMatches} from './files.mjs';
import {Matcher} from './matcher.mjs';
import {applyMatchCorrections,summarizeMatchCorrections} from './match-corrections.mjs';
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


test('non-XLSX bytes named xlsx fail with an actionable format message before matching',async()=>{
 await assert.rejects(matchFile({lookup(){throw Error('matching should not run');}},new Uint8Array([0x35,0xf4,0x48,0xaf,0xde,0x3e,0xe4,0xb9]),'DAF偏移和CG.xlsx'),/不是可讀的標準 XLSX/);
});

test('Detail matching reads more than 100000 rows, caches repeated criteria and preserves unrelated wide sheets',async()=>{
 const book=new ExcelJS.Workbook(),detail=book.addWorksheet('Detail');detail.addRow(['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態']);const other=book.addWorksheet('大型輔助頁');other.getCell('XFD100005').value='保留欄位與內容';
 const zip=await JSZip.loadAsync(await book.xlsx.writeBuffer()),sheetPath='xl/worksheets/sheet1.xml';let xml=await zip.file(sheetPath).async('string');const rows=[];const count=100005;for(let n=2;n<=count+1;n++)rows.push(`<row r="${n}"><c r="A${n}" t="inlineStr"><is><t>DAF外觀</t></is></c><c r="B${n}" t="inlineStr"><is><t>ORDER1</t></is></c><c r="E${n}" t="inlineStr"><is><t>PPID${n}</t></is></c><c r="I${n}" t="inlineStr"><is><t>GOOD</t></is></c></row>`);xml=xml.replace('</sheetData>',rows.join('')+'</sheetData>');zip.file(sheetPath,xml);const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 let calls=0;const result=await matchFile({lookup(){calls++;return {'狀態':'唯一匹配','候選':[{'機種':'LargeModel',IC:'IC'}]};}},bytes,'large.xlsx');assert.equal(result['筆數'],count);assert.equal(calls,1);assert.equal(result['結果'].at(-1)['列號'],100006);
 const output=await JSZip.loadAsync(await exportMatches(result)),updated=await output.file(sheetPath).async('string');assert.match(updated,/<c r="K100006" t="inlineStr"><is><t>LargeModel<\/t>/);assert.deepEqual(await output.file('xl/worksheets/sheet2.xml').async('uint8array'),await zip.file('xl/worksheets/sheet2.xml').async('uint8array'));
});

test('manual work-order corrections fill all merged Detail rows while isolating other parts and preserving source cells',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Detail');
 sheet.addRows([['製程','工單','料號','品名規格','小板序號'],['DAF外觀','MISS1','PART1','原始內容','PPID1'],['DAF外觀','','','原始內容2','PPID2'],['DAF外觀','MISS1','PART2','','PPID3'],['DAF外觀','','','','PPID4']]);
 sheet.mergeCells('B2:B3');sheet.mergeCells('C2:C3');book.addWorksheet('其他資料').addRow(['必須保留']);
 const bytes=await book.xlsx.writeBuffer(),matcher=new Matcher({records:[],keys:[]});
 const initial=await matchFile(matcher,bytes,'original.xlsx'),groups=summarizeMatchCorrections(initial);
 assert.equal(groups.length,3);const group=groups.find(g=>g.order==='MISS1'&&g.part==='PART1');assert.equal(group.rows,2);
 const corrected=applyMatchCorrections(initial,[{key:group.key,ic:'GOODIX',model:'CY26-16 & <A>'}]);
 assert.deepEqual(corrected['結果'].map(r=>r['狀態']),['手動補填','手動補填','查無資料','缺少查找欄位']);
 const output=await exportMatches(corrected),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(output);
 for(const row of [2,3]){assert.equal(loaded.getWorksheet('Detail').getCell('J'+row).text,'GOODIX');assert.equal(loaded.getWorksheet('Detail').getCell('K'+row).text,'CY26-16 & <A>');}
 assert.equal(loaded.getWorksheet('Detail').getCell('J4').text,'');assert.equal(loaded.getWorksheet('Detail').getCell('J5').text,'');
 const before=await JSZip.loadAsync(bytes),after=await JSZip.loadAsync(output);
 const originalXml=await before.file('xl/worksheets/sheet1.xml').async('string'),updatedXml=await after.file('xl/worksheets/sheet1.xml').async('string');
 for(const cell of originalXml.match(/<c\b[^>]*\br="[A-I]\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g))assert.ok(updatedXml.includes(cell));
 assert.deepEqual(await before.file('xl/worksheets/sheet2.xml').async('uint8array'),await after.file('xl/worksheets/sheet2.xml').async('uint8array'));
 assert.equal(summarizeMatchCorrections(corrected).find(g=>g.key===group.key).pending,0);
});

test('manual CSV corrections never replace unique database matches or unrelated blank-identifier rows',async()=>{
 const matcher=new Matcher({records:[{id:1,model:'Database Model',ic:'Database IC',parts:[],dpns:[],family:'',source_file:'reference.xlsx',sheet:'資料',row_number:2}],keys:[['order','known1',1]]});
 const input=new TextEncoder().encode('工單號碼,IC,備註\nKNOWN1,,已知工單\nKNOWN1,wrong,衝突待確認\n,,無識別資料1\n,,無識別資料2\n');
 const result=await matchFile(matcher,input,'query.csv'),groups=summarizeMatchCorrections(result);
 assert.equal(groups.length,3);const known=groups.find(g=>g.order==='KNOWN1'),blank=groups.find(g=>!g.order);
 applyMatchCorrections(result,[{key:known.key,ic:'Manual IC',model:'Manual Model'},{key:blank.key,ic:'Blank IC',model:'Blank Model'}]);
 assert.equal(result['結果'][0].IC,'Database IC');assert.equal(result['結果'][1].IC,'Manual IC');assert.equal(result['結果'][2].IC,'Blank IC');assert.equal(result['結果'][3].IC,'');
 const output=new ExcelJS.Workbook();await output.xlsx.load(await exportMatches(result));
 assert.equal(output.worksheets[0].getCell('C3').value,'手動補填');assert.equal(output.worksheets[0].getCell('D3').value,'Manual Model');
 assert.match(output.worksheets[0].getCell('H3').value,/本批次手動補填/);
 assert.throws(()=>applyMatchCorrections(result,[{key:known.key,ic:'',model:'Incomplete'}]),/完整填寫/);
});
