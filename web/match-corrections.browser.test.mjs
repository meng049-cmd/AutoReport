import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {authenticatedAnalysis} from './auth-test-context.mjs';

test('batch matching paginates missing orders, retains edits, regenerates Excel and replaces library results',async()=>{
 const reference={records:[{id:1,model:'Known Model',ic:'Known IC',parts:[],dpns:[],family:'',source_file:'reference.xlsx',sheet:'資料',row_number:2},{id:2,model:'CY26-16',ic:'Goodix'},{id:3,model:'Other Model',ic:'Synaptis'}],keys:[['order','known1',1]],stats:{'索引資料列':3,'分頁':[],'不重複工單':1,'機種IC組合':3}};
 const root=path.resolve('dist');
 const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/reference.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reference));return;}
  const file=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  const context=await browser.newContext();await authenticatedAnalysis(context);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#matching`);await page.waitForFunction(()=>!document.querySelector('#match').disabled);
  assert.equal(await page.title(),'AUTOREPORT 工單查找與品質分析');
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Detail');sheet.addRow(['製程','工單','料號','品名規格','小板序號']);
  for(let index=0;index<51;index++)sheet.addRow(['DAF外觀','MISS'+index,'PART'+index,'原始內容','PPID'+index]);
  sheet.addRow(['DAF外觀','MISS0','PART0','重複工單','REPEAT']);sheet.addRow(['DAF外觀','KNOWN1','','已知工單','KNOWN']);
  const other=new ExcelJS.Workbook();other.addWorksheet('Detail').addRows([['製程','工單','料號','品名規格','小板序號'],['DAF外觀','MISS0','PART0','另一來源','OTHER']]);
  await page.locator('#file').setInputFiles([{name:'first.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())},{name:'second.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await other.xlsx.writeBuffer())}]);
  await page.locator('#match').click();await page.waitForFunction(()=>!document.querySelector('#match').disabled&&document.querySelector('#message').textContent.includes('批次完成'));
  assert.match(await page.locator('#matchCorrectionSummary').innerText(),/51 組/);assert.equal(await page.locator('#matchCorrectionTable tbody tr').count(),50);
  const first=page.locator('#matchCorrectionTable tbody tr').first();assert.match(await first.innerText(),/MISS0/);assert.match(await first.innerText(),/first.xlsx/);assert.match(await first.innerText(),/second.xlsx/);
  assert.equal(await page.locator('[data-correction-ic="0"]').isHidden(),true);
  assert.ok((await page.locator('[data-correction-select-ic="0"] option').allTextContents()).includes('Goodix'));
  await page.locator('[data-correction-select-ic="0"]').selectOption({label:'Goodix'});await page.locator('#matchRegenerate').click();assert.match(await page.locator('#message').innerText(),/完整填寫/);
  await page.locator('[data-correction-select-model="0"]').selectOption({label:'CY26-16'});await page.locator('#matchCorrectionNext').click();
  await page.locator('[data-correction-select-ic="50"]').selectOption('new');await page.locator('[data-correction-ic="50"]').fill(' SYNAPTIS ');
  await page.locator('[data-correction-select-model="50"]').selectOption('new');await page.locator('[data-correction-model="50"]').fill('CY26-50');
  await page.locator('#matchCorrectionPrev').click();assert.equal(await page.locator('[data-correction-select-ic="0"] option:checked').innerText(),'Goodix');
  const before=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('AutoReport-file-library');request.onsuccess=()=>{const db=request.result,read=db.transaction('files').objectStore('files').getAll();read.onsuccess=()=>{db.close();resolve(read.result.filter(item=>item.kind==='matched').map(item=>item.id).sort());};read.onerror=reject;};request.onerror=reject;}));
  assert.equal(before.length,2);
  await page.locator('#matchRegenerate').click();await page.waitForFunction(()=>!document.querySelector('#match').disabled&&document.querySelector('#matchCorrectionSummary').textContent.includes('4 筆已手動補填'));
  assert.match(await page.locator('#matchCorrectionSummary').innerText(),/49 筆待補填/);
  const after=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('AutoReport-file-library');request.onsuccess=()=>{const db=request.result,read=db.transaction('files').objectStore('files').getAll();read.onsuccess=()=>{db.close();resolve(read.result.filter(item=>item.kind==='matched').map(item=>item.id).sort());};read.onerror=reject;};request.onerror=reject;}));
  assert.deepEqual(after,before);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);assert.equal(download.suggestedFilename(),'AUTOREPORT 工單查找與品質分析_批次結果.zip');
  const zip=await JSZip.loadAsync(await readFile(await download.path()));
  const firstBook=new ExcelJS.Workbook();await firstBook.xlsx.load(await zip.file('AUTOREPORT 工單查找與品質分析_first_IC機種.xlsx').async('uint8array'));
  const detail=firstBook.getWorksheet('Detail');assert.equal(detail.getCell('J2').text,'Goodix');assert.equal(detail.getCell('K2').text,'CY26-16');assert.equal(detail.getCell('J52').text,'Synaptis');assert.equal(detail.getCell('J53').text,'Goodix');assert.equal(detail.getCell('J54').text,'Known IC');assert.equal(detail.getCell('J3').text,'');assert.equal(detail.getCell('D2').text,'原始內容');
  const secondBook=new ExcelJS.Workbook();await secondBook.xlsx.load(await zip.file('AUTOREPORT 工單查找與品質分析_second_IC機種.xlsx').async('uint8array'));assert.equal(secondBook.getWorksheet('Detail').getCell('K2').text,'CY26-16');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
