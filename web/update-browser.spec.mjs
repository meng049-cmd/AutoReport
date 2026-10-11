import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {Matcher} from './matcher.mjs';

test('updated reference database works in the browser and preserves Detail downloads',async()=>{
 const root=path.resolve('dist'),data=JSON.parse(await readFile('dist/reference.json','utf8'));
 assert.ok(data.records.length>0);assert.ok(data.keys.length>0);
 const order=data.keys.find(([kind])=>kind==='order')?.[1]||'NO-MATCH';
 const expected=new Matcher(data).lookup([['order',order]]);
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>!document.querySelector('#match').disabled);
  assert.equal(await page.locator('#orderCount').innerText(),data.stats['不重複工單'].toLocaleString('en-US'));
  assert.match(await page.locator('#databaseUpload').getAttribute('href'),/github\.com\/meng049-cmd\/AutoReport\/upload\/codex\/autoreport-database\/database-inputs$/);
  const book=new ExcelJS.Workbook(),detail=book.addWorksheet('Detail');
  detail.addRow(['製程','工單','料號','品名','小板','時間','人員','不良','狀態']);
  detail.addRow(['保留',order,'','測試','','','','','Good']);
  detail.addRow(['保留','AUTOREPORT-NO-MATCH','','','','','','','Good']);
  book.addWorksheet('Data').addRow(['原始資料保留']);
  await page.locator('#file').setInputFiles({name:'updated.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
  await page.locator('#match').click();await page.waitForFunction(()=>!document.querySelector('#export').disabled);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.readFile(await download.path());
  const match=expected['狀態']==='唯一匹配'?expected['候選'][0]:{};
  assert.equal(loaded.getWorksheet('Detail').getCell('J2').text,match.IC||'');
  assert.equal(loaded.getWorksheet('Detail').getCell('K2').text,match['機種']||'');
  assert.equal(loaded.getWorksheet('Detail').getCell('J3').text,'');
  assert.equal(loaded.getWorksheet('Detail').getCell('A2').text,'保留');
  assert.equal(loaded.getWorksheet('Data').getCell('A1').text,'原始資料保留');
  if(data.database_update)assert.match(await page.locator('#databaseUpdated').innerText(),/資料更新時間/);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
