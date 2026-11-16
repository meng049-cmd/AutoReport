import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';

test('raw and manually corrected results survive deletion, reload and cloud snapshot round trips',async()=>{
 const root=path.resolve('.');
 const server=createServer(async(req,res)=>{try{let name=new URL(req.url,'http://local').pathname;if(name.endsWith('/'))name+='index.html';const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.addInitScript(()=>{globalThis.__ANALYSIS_VERSION__='history-test';});
  await page.goto(`http://127.0.0.1:${server.address().port}/dist/`);
  const expected=await page.evaluate(async()=>{
   const lib=await import('/web/file-library.mjs');await lib.libraryReady;
   const raw=await lib.addLibraryFile(new File(['raw bytes'],'raw.csv'),{kind:'raw',detail:false});
   const first=await lib.addLibraryFile(new File(['unresolved'],'result.xlsx'),{kind:'matched',sourceFileId:raw.id});
   const corrected=await lib.addLibraryFile(new File(['manual Goodix Model A'],'result.xlsx'),{kind:'matched',sourceFileId:raw.id,replaceId:first.id});
   await lib.removeLibraryFiles([raw.id,first.id]);
   const history=lib.listLibraryFiles({includeHistory:true});
   const saved=history.find(item=>item.id===corrected.historyId);
   let blocked=false;try{await lib.removeLibraryFiles([saved.id]);}catch{blocked=true;}
   return {history:await Promise.all(history.map(async item=>({id:item.id,content:await item.blob.text(),persistent:item.persistent}))),visible:lib.listLibraryFiles().length,blocked};
  });
  assert.equal(expected.visible,0);assert.equal(expected.blocked,true);assert.equal(expected.history.length,3);assert.ok(expected.history.every(item=>item.persistent));
  assert.deepEqual(expected.history.map(item=>item.content).sort(),['raw bytes','unresolved','manual Goodix Model A'].sort());
  const failed=await page.evaluate(async()=>{
   const lib=await import('/web/file-library.mjs'),original=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(value,...args){if(this.name==='files'&&value.matchHistory)throw new DOMException('quota','QuotaExceededError');return original.call(this,value,...args);};
   let blocked=false;try{await lib.addLibraryFile(new File(['must not commit'],'quota.csv'),{kind:'raw'});}catch{blocked=true;}finally{IDBObjectStore.prototype.put=original;}
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('AutoReport-file-library',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const values=await new Promise(resolve=>{const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);});db.close();
   return {blocked,committed:values.some(item=>item.name==='quota.csv')};
  });
  assert.deepEqual(failed,{blocked:true,committed:false});
  await page.reload();await page.locator('#sideNav a[href="#/history"]').click();
  await page.waitForFunction(()=>document.querySelector('#libraryCount').textContent==='3 份檔案');
  assert.equal(await page.locator('#fileLibraryTable .library-delete').count(),0);
  assert.equal(await page.locator('#libraryRemove').isHidden(),true);
  await page.getByRole('button',{name:'還原至檔案庫'}).first().click();
  const result=await page.evaluate(async()=>{
   const sync=await import('/cloud/cloud-sync.mjs');const snapshot=await sync.capture('autoreport');
   await sync.restore(snapshot,'autoreport');
   const after=await sync.capture('autoreport');const values=after.databases['AutoReport-file-library'].files.values;
   return {history:await Promise.all(values.filter(item=>item.matchHistory).map(item=>item.blob.text())),active:values.filter(item=>!item.matchHistory).length};
  });
  assert.equal(result.active,1);assert.ok(result.history.includes('manual Goodix Model A'));assert.ok(result.history.includes('raw bytes'));
  // Exercise the actual matching and manual correction UI with a valid workbook.
  await page.reload();await page.locator('#sideNav a[href="#matching"]').last().click();
  await page.waitForFunction(()=>!document.querySelector('#match').disabled);
  const book=new ExcelJS.Workbook();book.addWorksheet('Detail').addRows([
   ['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態'],
   ['DAF外觀','HISTORY123','HISTORY-PART','','history-ppid',46306,'','','GOOD']
  ]);
  await page.locator('#file').setInputFiles({name:'history-input.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
  await page.locator('#match').click();await page.waitForFunction(()=>!document.querySelector('#match').disabled&&!document.querySelector('#matchCorrections').hidden);
  await page.locator('[data-correction-select-ic="0"]').selectOption('new');await page.locator('[data-correction-ic="0"]').fill('History IC');
  await page.locator('[data-correction-select-model="0"]').selectOption('new');await page.locator('[data-correction-model="0"]').fill('History Model');
  await page.locator('#matchRegenerate').click();await page.waitForFunction(()=>!document.querySelector('#match').disabled&&document.querySelector('#message').textContent.includes('補填已套用'));
  await page.reload();
  const retained=await page.evaluate(async()=>{
   const lib=await import('/web/file-library.mjs');await lib.libraryReady;
   const active=lib.listLibraryFiles().filter(item=>item.name.includes('history-input'));
   await lib.removeLibraryFiles(active.map(item=>item.id));
   return Promise.all(lib.listLibraryFiles({includeHistory:true}).filter(item=>item.matchHistory&&item.name.includes('history-input')).map(async item=>({kind:item.kind,bytes:Array.from(new Uint8Array(await item.blob.arrayBuffer()))})));
  });
  assert.equal(retained.filter(item=>item.kind==='raw').length,1);
  const outputs=retained.filter(item=>item.kind==='matched');assert.equal(outputs.length,2);
  const identities=[];for(const output of outputs){const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(new Uint8Array(output.bytes));identities.push([workbook.getWorksheet('Detail').getCell('J2').value,workbook.getWorksheet('Detail').getCell('K2').value]);}
  assert.ok(identities.some(([ic,model])=>ic==='History IC'&&model==='History Model'));

 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
