import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from '@playwright/test';import {createServer} from 'node:http';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import ExcelJS from 'exceljs';import {execFileSync} from 'node:child_process';
test('web Excel update persists, deduplicates, preserves conflicts and downloads a real SQLite database',async()=>{
 const root=path.resolve('dist');const methods=[];const server=createServer(async(req,res)=>{methods.push(req.method);const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(30000);page.on('request',r=>methods.push(r.method()));
 const site=process.env.LIVE_SITE_URL||`http://127.0.0.1:${server.address().port}/`;
 // Seed a real version-1 database before the application starts.
 await page.goto(new URL('browser-storage.js',site).href);
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('AutoReport-local-database',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('state');
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put({version:1,reference:{obsolete:true},database:new ArrayBuffer(10)},'active');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
 }));
 await page.goto(site);await page.waitForFunction(()=>!document.querySelector('#match').disabled);const old=await page.locator('#orderCount').innerText();assert.equal(old,'0');
 assert.equal(await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('AutoReport-local-database',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('state');const read=tx.objectStore('state').get('active');read.onsuccess=()=>{db.close();resolve(read.result===undefined);};};})),true,'version-1 browser data must be deleted');assert.equal(await page.locator('#databaseUpload').getAttribute('href'),null);
 const book=new ExcelJS.Workbook();for(const name of ['工單（A16）','CY26','工單（CY24&25）','重工工單1','NPI']){const sheet=book.addWorksheet(name);sheet.addRow(['機種','IC','料號','工單']);sheet.addRow(['BrowserModel','Goodix','99000123-001','WEBORDER123']);}
 const file={name:'web-reference.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())};
 await page.locator('#databaseFile').setInputFiles(file);await page.locator('#databaseUpload').click();await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('已儲存在本瀏覽器'),{},{timeout:120000});assert.match(await page.locator('#databaseStatus').innerText(),/新增 1 筆，跳過重複 4 筆/);
 await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('唯一匹配').waitFor();assert.match(await page.locator('#searchResults').innerText(),/BrowserModel/);
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#match').disabled);assert.notEqual(await page.locator('#orderCount').innerText(),old);await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('唯一匹配').waitFor();
 await page.locator('#databaseFile').setInputFiles(file);await page.locator('#databaseUpload').click();await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('沒有新對照'),{},{timeout:120000});
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#databaseDownload').click()]);const bytes=await readFile(await download.path());assert.equal(bytes.subarray(0,16).toString(),'SQLite format 3\0');await writeFile('/tmp/browser-updated.sqlite3',bytes);
 execFileSync('.venv/bin/python',['-c',"import sqlite3;d=sqlite3.connect('/tmp/browser-updated.sqlite3');assert d.execute('pragma integrity_check').fetchone()[0]=='ok';assert d.execute(\"select count(*) from records where model='BrowserModel'\").fetchone()[0]==1"]);
 await page.locator('#databaseFile').setInputFiles({name:'bad.xlsx',mimeType:file.mimeType,buffer:Buffer.from('broken')});await page.locator('#databaseUpload').click();await page.waitForFunction(()=>!document.querySelector('#databaseUpload').disabled,{},{timeout:120000});await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('唯一匹配').waitFor();
 for(const sheet of book.worksheets)sheet.getCell('B2').value='Elan';
 await page.locator('#databaseFile').setInputFiles({...file,buffer:Buffer.from(await book.xlsx.writeBuffer())});await page.locator('#databaseUpload').click();await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('新增 1 筆'),{},{timeout:120000});await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('多組候選').waitFor();assert.match(await page.locator('#searchResults').innerText(),/Goodix/);assert.match(await page.locator('#searchResults').innerText(),/Elan/);
 // Cancel preserves data; accept clears SQLite, the matcher and every open tab.
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#databaseClear').click();
 await page.locator('#lookup').click();await page.locator('#searchResults').getByText('多組候選').waitFor();
 await page.locator('#file').setInputFiles({name:'clear-query.csv',mimeType:'text/csv',buffer:Buffer.from('工單號碼\nWEBORDER123\n')});
 await page.locator('#match').click();await page.waitForFunction(()=>!document.querySelector('#export').disabled);
 // Populate independent report and merge state before clearing the entire page.
 const report=new ExcelJS.Workbook();report.addWorksheet('Detail').addRows([
  ['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],
  ['DAF外觀','WEBORDER123','99000123-001','Test','PPID1',new Date('2026-10-14'),'Tester','','GOOD','Goodix','BrowserModel']
 ]);
 const reportFile={name:'old-report.xlsx',mimeType:file.mimeType,buffer:Buffer.from(await report.xlsx.writeBuffer())};
 await page.locator('#mergeFiles').setInputFiles(reportFile);await page.locator('#mergeDirect').click();await page.locator('#mergeResult').waitFor({state:'visible'});
 await page.locator('#yieldFile').setInputFiles(reportFile);await page.locator('#yieldCalculate').click();await page.locator('#yieldResult').waitFor({state:'visible'});
 const other=await context.newPage();await other.goto(site);await other.waitForFunction(()=>!document.querySelector('#match').disabled);
 assert.notEqual(await other.locator('#orderCount').innerText(),'0');await other.locator('#file').setInputFiles(reportFile);
 page.once('dialog',dialog=>dialog.accept());await Promise.all([page.waitForEvent('domcontentloaded',{timeout:120000}),page.locator('#databaseClear').click()]);
 await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.startsWith('已清空本瀏覽器資料庫'),{},{timeout:120000});
 assert.equal(await page.locator('#orderCount').innerText(),'0');assert.equal(await page.locator('#pairCount').innerText(),'0');
 assert.equal(await page.locator('#export').isDisabled(),true);
 await page.locator('.imported-files summary').click();assert.equal(await page.locator('#uploadedFilesStatus').innerText(),'尚無匯入資料。');
 for(const target of [page,other]){
  await target.waitForFunction(()=>document.querySelector('#databaseStatus')?.textContent.startsWith('已清空本瀏覽器資料庫'));
  assert.equal(await target.locator('#databaseMetrics').isHidden(),true);
  assert.equal(await target.locator('#uploadedFiles').innerText(),'');assert.equal(await target.locator('#sources').innerText(),'');
  assert.equal(await target.locator('#query').inputValue(),'');
  assert.equal(await target.locator('#uploadResults').innerText(),'');assert.equal(await target.locator('#searchResults').innerText(),'');
  for(const id of ['mergeResult','matchedMergeResult','yieldResult','qualityDashboard','thresholdDashboard'])assert.equal(await target.locator('#'+id).isHidden(),true,id);
  assert.equal(await target.evaluate(()=>[...document.querySelectorAll('input[type=file]')].every(el=>el.files.length===0)),true);
  assert.doesNotMatch(await target.locator('body').innerText(),/web-reference\.xlsx|clear-query\.csv|old-report\.xlsx|BrowserModel/);
 }

 await other.waitForFunction(()=>document.querySelector('#orderCount')?.textContent==='0');
 await other.locator('#query').fill('WEBORDER123');await other.locator('#lookup').click();await other.locator('#searchResults').getByText('查無資料').waitFor();
 const [emptyDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#databaseDownload').click()]);
 await writeFile('/tmp/browser-cleared.sqlite3',await readFile(await emptyDownload.path()));
 execFileSync('.venv/bin/python',['-c',"import sqlite3;d=sqlite3.connect('/tmp/browser-cleared.sqlite3');assert d.execute('pragma integrity_check').fetchone()[0]=='ok';assert all(d.execute('select count(*) from '+t).fetchone()[0]==0 for t in ['sources','sheets','records','lookup_keys','raw_rows','work_orders'])"]);
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#match').disabled);assert.equal(await page.locator('#orderCount').innerText(),'0');
 await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('查無資料').waitFor();
 // Repeating clear is harmless, and a fresh upload still persists normally.
 page.once('dialog',dialog=>dialog.accept());await Promise.all([page.waitForEvent('domcontentloaded',{timeout:120000}),page.locator('#databaseClear').click()]);
 await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.startsWith('已清空本瀏覽器資料庫'),{},{timeout:120000});
 await page.locator('#databaseFile').setInputFiles(file);await page.locator('#databaseUpload').click();
 await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('已儲存在本瀏覽器'),{},{timeout:120000});
 await page.locator('#query').fill('WEBORDER123');await page.locator('#lookup').click();await page.locator('#searchResults').getByText('唯一匹配').waitFor();
 await other.waitForFunction(()=>document.querySelector('#orderCount').textContent!=='0');
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#match').disabled);assert.notEqual(await page.locator('#orderCount').innerText(),'0');
 await other.close();
 console.log('Clear cancellation, cross-tab sync, empty SQLite, persistence, repeated clear and fresh upload verified.');
 assert.ok(methods.every(m=>m==='GET'),'source files never leave browser');console.log('Actual in-browser Python importer, IndexedDB reload, duplicate skip, invalid-file rollback and SQLite download verified.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
