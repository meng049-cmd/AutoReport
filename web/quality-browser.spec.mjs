import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

test('formula notes collapse, date/process/defect/product drilldown retains cohort inputs and exports its hierarchy',async()=>{
 const root=path.resolve('dist'),server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#yield`);await page.waitForFunction(()=>!document.querySelector('#match').disabled);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Detail');sheet.addRow(['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種']);
  for(const [serial,process,day,status,defect,ic] of [['a','DAF外觀',12,'GOOD','','A'],['a','功能一測試',12,'FAIL','dust','A'],['b','DAF外觀',12,'GOOD','','A'],['c','功能一測試',12,'GOOD','','A'],['a','DAF外觀',14,'GOOD','','A'],['d','DAF外觀',14,'FAIL','crack','B'],['only-aoi','正面AOI',12,'FAIL','excluded','B']])sheet.addRow([process,'WO','part','name',serial,new Date(`2026-10-${day}T00:00:00Z`),'op',defect,status,ic,'Model']);
  await page.locator('#yieldFile').setInputFiles({name:'hierarchy.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});await page.locator('#yieldCalculate').click();await page.locator('#qualityDashboard').waitFor({state:'visible'});
  const notes=page.locator('#defectFormulaNotes');assert.equal(await notes.getAttribute('open'),null);assert.equal(await notes.locator('dl').isVisible(),false);await notes.locator('summary').click();assert.equal(await notes.locator('dl').isVisible(),true);
  const explanation=await notes.innerText();for(const text of ['不良率貢獻長條','不良率項目推移圖','每日階段良率 Excel 圖表','不固定等於全檔唯一 PPID','沒有單一合併母數'])assert.ok(explanation.includes(text));
  assert.equal(await page.locator('#defectFirstAxis').inputValue(),'date');assert.equal(await page.locator('#defectGroups button').count(),3,'empty dates remain');assert.match(await page.locator('#qualityMetrics').innerText(),/全檔投入 PPID\s*4|4\s*全檔投入 PPID/);
  const group=key=>page.locator('#defectGroups button').filter({has:page.locator(`span:text-is("${key}")`)});
  assert.match(await group('2026-10-12').innerText(),/投入 3/);await group('2026-10-12').click();assert.match(await page.locator('#defectTitle').innerText(),/製程/);assert.match(await group('功能一測試').innerText(),/投入 2/);
  await group('功能一測試').click();assert.match(await page.locator('#defectTitle').innerText(),/不良項目/);assert.match(await group('dust').innerText(),/投入 2/);
  await group('dust').click();assert.match(await page.locator('#defectTitle').innerText(),/產品/);assert.match(await group('A／Model').innerText(),/投入 2/);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#defectDownload').click()]),output=new ExcelJS.Workbook();await output.xlsx.readFile(await download.path());assert.equal(output.getWorksheet('不良率貢獻').getCell('A1').value,'產品');assert.equal(output.getWorksheet('不良率貢獻').getCell('B2').value,.25,'bar contribution uses whole-file input of four, not scoped input of two');
  const rows=output.getWorksheet('統計說明').getSheetValues();assert.ok(rows.some(row=>row?.[1]==='下鑽順序'&&row[2]==='日期 → 製程 → 不良項目 → 產品'));
  const levels=output.getWorksheet('完整層級拆解').getSheetValues().slice(2).filter(Boolean),leaves=levels.filter(row=>row[1]==='產品');assert.equal(leaves.reduce((sum,row)=>sum+row[8],0),2);assert.equal(leaves.reduce((sum,row)=>sum+row[10],0),.5);assert.equal(levels.find(row=>row[1]==='產品'&&row[6]==='dust')[7],2);
  await group('A／Model').click();assert.equal(await page.locator('.defect-leaf').count(),1);await page.locator('#defectBack').click();assert.equal(await page.locator('#qualityProduct').inputValue(),'');await page.locator('#defectBack').click();assert.match(await page.locator('#defectTitle').innerText(),/不良項目/);await page.locator('#defectBreadcrumb').getByRole('button',{name:'全部日期',exact:true}).click();assert.match(await page.locator('#defectTitle').innerText(),/日期/);assert.equal(await page.locator('#defectGroups button').count(),3);
  assert.equal(await notes.locator('dl').isVisible(),true,'notes survive chart navigation');await page.screenshot({path:'/tmp/autoreport-formula-notes.png',fullPage:true});await notes.locator('summary').click();assert.equal(await notes.locator('dl').isVisible(),false);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
