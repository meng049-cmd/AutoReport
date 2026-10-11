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
  assert.deepEqual(errors,[]);assert.ok(requests.every(([method,url])=>method==='GET'&&!url.includes('/api/')));
  console.log('Browser verified all requests are GET; upload files never leave browser.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
