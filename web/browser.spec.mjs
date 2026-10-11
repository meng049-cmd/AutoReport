import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
test('Pages project path loads; browser uploads Excel/CSV and downloads a real workbook',async()=>{
 const root=path.resolve('dist');const requests=[];
 const server=createServer(async(req,res)=>{
  requests.push([req.method,req.url]);
  const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,requestPath.replace(/^\/AutoReport\//,'').replace(/^$/,'index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('request',r=>requests.push([r.method(),r.url()]));page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.exportRequests=0;const send=Worker.prototype.postMessage;
   Worker.prototype.postMessage=function(message,...args){if(message.type==='export')window.exportRequests++;return send.call(this,message,...args);};
  });
  await page.goto(process.env.LIVE_SITE_URL || `http://127.0.0.1:${server.address().port}/AutoReport/`);
  await page.waitForFunction(()=>document.querySelector('#orderCount').textContent==='1,268');
  await page.locator('#query').fill('C515-250300004');await page.locator('#lookup').click();
  await page.locator('#searchResults').getByText('唯一匹配').waitFor();assert.match(await page.locator('#searchResults').innerText(),/Taroko 14/);
  await page.locator('#file').setInputFiles('downloads/AutoReport_query_template.xlsx');await page.locator('#match').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成 15 筆'));
  assert.match(await page.locator('#message').innerText(),/唯一匹配 9 筆/);assert.match(await page.locator('#message').innerText(),/多組候選 1 筆/);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());assert.equal(book.worksheets[0].rowCount,16);assert.equal(book.worksheets[0].getCell('E2').value,'Goodix');
  await page.locator('#file').setInputFiles({name:'繁體查詢.csv',mimeType:'text/csv',buffer:Buffer.from('工單號碼,機型\nC515-250300004,Goodix\n')});await page.locator('#match').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成 1 筆'));
  assert.match(await page.locator('#uploadResults').innerText(),/Taroko 14/);
  const detailBook=new ExcelJS.Workbook();const detail=detailBook.addWorksheet('Detail');
  detail.addRow(['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態']);
  detail.addRow(['背面大板','C515-250300004','','RFPC','TW000Y',new Date('2026-10-11'),'卓佳玲','','Good']);
  detail.getCell('F2').numFmt='yyyy/mm/dd';detailBook.addWorksheet('Data').addRow(['原始資料']);
  await page.locator('#file').setInputFiles({name:'Detail.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await detailBook.xlsx.writeBuffer())});
  await page.locator('#match').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成 1 筆'));
  const [detailDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  const filled=new ExcelJS.Workbook();await filled.xlsx.readFile(await detailDownload.path());
  assert.equal(filled.getWorksheet('Detail').getCell('J2').value,'Goodix');assert.equal(filled.getWorksheet('Detail').getCell('K2').value,'Taroko 14');
  assert.equal(filled.getWorksheet('Detail').getCell('F2').numFmt,'yyyy/mm/dd');assert.equal(filled.getWorksheet('Data').getCell('A1').value,'原始資料');
  const preparedExports=await page.evaluate(()=>window.exportRequests);
  const [again]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  assert.equal(again.suggestedFilename(),'Detail_IC機種.xlsx');
  assert.equal(await page.evaluate(()=>window.exportRequests),preparedExports,'download clicks must use the prepared file without an asynchronous worker request');
  assert.equal(await page.locator('#message').evaluate(el=>el.closest('.panel')?.querySelector('#export')!==null),true,'download feedback is next to the upload controls');
  await page.locator('#file').setInputFiles({name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('工單號碼\nmissing\n')});
  assert.equal(await page.locator('#export').isDisabled(),true,'a changed file invalidates the previous download');
  assert.deepEqual(errors,[]);assert.ok(requests.every(([method,url])=>method==='GET'&&!url.includes('/api/')));
  console.log('Browser verified all requests are GET; upload files never leave browser.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
