import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';

test('free-form work order edits persist in SQLite and refresh a previously saved report', {timeout:90000}, async () => {
 const root=resolve('dist');
 const server=createServer(async (request,response)=>{
  try{
   const pathname=new URL(request.url,'http://localhost').pathname;
   const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(root+sep))throw Error('Invalid path');
   const type=/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':'application/octet-stream';
   const bytes=await readFile(file);
   response.setHeader('Content-Type',type);
   response.end(bytes);
  }catch{response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage();
  const site='http://127.0.0.1:'+server.address().port;
  await page.goto(site);
  const original=new ExcelJS.Workbook();
  original.addWorksheet('Detail').addRows([
   ['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'],
   ['DAF外觀','WO123','PART1','','PPID1',46309,'','','GOOD','Old IC','Old Model']
  ]);
  await page.getByText('直接分析其他已比對的 Detail 檔',{exact:true}).click();
  await page.locator('#yieldFile').setInputFiles({name:'detail.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await original.xlsx.writeBuffer())});
  await page.locator('#yieldCalculateUpload').click();
  await page.locator('#qualityReportDownload').waitFor();
  assert.match(await page.locator('#qualityProduct').textContent(),/Old Model/);

  await page.goto(site+'/#/matching');
  await page.getByText('修改工單對照',{exact:true}).click();
  await page.locator('#editOrder').fill('WO123');
  await page.locator('#editOrder').press('Tab');
  await page.locator('#editIC').fill('New IC');
  await page.locator('#editModel').fill('New Model');
  await page.locator('#editFamily').fill('New Family');
  const correctionDownload=page.waitForEvent('download');
  await page.locator('#saveOrderCorrection').click();
  const correction=new ExcelJS.Workbook();
  await correction.xlsx.readFile(await (await correctionDownload).path());
  assert.equal(correction.getWorksheet('工單對照修改').getCell('E2').value,'New Family');

  await page.goto(site+'/#/reports');
  await page.reload();
  await page.getByRole('button',{name:'開啟看板'}).click();
  await page.locator('#yieldOrderCorrections').waitFor();
  assert.match(await page.locator('#qualityProduct').textContent(),/New Model/);
  const reportDownload=page.waitForEvent('download');
  await page.locator('#qualityReportDownload').click();
  const revised=new ExcelJS.Workbook();
  await revised.xlsx.readFile(await (await reportDownload).path());
  assert.deepEqual(revised.getWorksheet('工單對照修改').getRow(2).values.slice(3),['New IC','New Model','New Family']);

  const database=await page.evaluate(async()=>Array.from(new Uint8Array((await readBrowserDatabase()).database)));
  const contents=execFileSync('.venv/bin/python',['-c',`import sqlite3,sys
db=sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
print(db.execute('SELECT payload FROM manual_match_corrections').fetchone()[0])`],{input:Buffer.from(database),encoding:'utf8'});
  assert.equal(JSON.parse(contents).family,'New Family');
 }finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
 }
});
