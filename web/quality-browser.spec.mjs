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
  assert.equal(await notes.locator('dl').isVisible(),true,'notes survive chart navigation');await page.screenshot({path:'/tmp/autoreport-formula-notes.png',fullPage:true});await notes.locator('summary').click();assert.equal(await notes.locator('dl').isVisible(),false);
  // Stage charts preserve the initial date range and reconcile overlapping process inputs.
  const stageBook=new ExcelJS.Workbook(),stageSheet=stageBook.addWorksheet('Detail');stageSheet.addRow(['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種']);
  for(const [serial,process,day,status,defect,ic] of [['a','DAF外觀',12,'FAIL','DAF issue','A'],['a','功能一測試',12,'FAIL','FT1 dust','A'],['b','DAF外觀',12,'GOOD','','A'],['c','功能一測試',12,'GOOD','','A'],['x','DAF外觀',12,'FAIL','crack','B'],['a','DAF外觀',14,'GOOD','','A'],['y','DAF外觀',14,'GOOD','','B']])stageSheet.addRow([process,'WO','part','name',serial,new Date(`2026-10-${day}T00:00:00Z`),'op',defect,status,ic,'Model']);
  await page.evaluate(()=>{location.hash='#yield';dispatchEvent(new HashChangeEvent('hashchange'));});await page.locator('#yieldFile').setInputFiles({name:'stage-reconcile.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await stageBook.xlsx.writeBuffer())});await page.locator('#yieldCalculate').click();await page.waitForFunction(()=>!document.querySelector('#qualityDashboard').hidden&&!document.querySelector('#qualityView').hidden);
  const canvas=page.locator('#stage-前段'),originalImage=await canvas.evaluate(node=>node.toDataURL());assert.equal(await canvas.getAttribute('data-points'),'3');
  await page.locator('#defectStart').fill('2026-10-14');await page.locator('#defectEnd').fill('2026-10-14');await page.locator('#defectApplyRange').click();assert.equal(await page.locator('#defectGroups button').count(),1,'defect analysis does use its own selected range');await page.locator('#qualityProduct').selectOption({label:'B／Model'});
  assert.equal(await canvas.getAttribute('data-points'),'3','stage dates stay at the initial report range');assert.equal(await canvas.evaluate(node=>node.toDataURL()),originalImage,'stage chart values, inputs and image ignore defect date/product filters');
  await canvas.evaluate(node=>node.dataset.activeIndex='0');await canvas.focus();await canvas.press('Enter');const card=page.locator('.stage-card').first(),processLevel=card.locator('.stage-drill-level[data-dimension=process]');
  assert.match(await processLevel.locator('.stage-input-audit').innerText(),/子層投入合計 5 − 重複計入 1 ＝ 上層唯一投入 4/);assert.match(await processLevel.locator('.stage-yield-audit').innerText(),/25\.00% ＝ 上層良率 25\.00%/);assert.equal(await processLevel.locator('.stage-reconcile').getAttribute('data-pass'),'true');
  const stageChoice=(dimension,key)=>card.locator(`.stage-drill-level[data-dimension="${dimension}"] .defect-groups button`).filter({hasText:key});
  await stageChoice('process','DAF外觀').click();assert.equal(await card.locator('.stage-drill-level[data-dimension=product] .stage-reconcile').getAttribute('data-pass'),'true');await stageChoice('product','A／Model').click();let defectLevel=card.locator('.stage-drill-level[data-dimension=defect]');assert.match(await defectLevel.innerText(),/良品 1 ＋ 不良項目唯一 PPID 1 ＝ 上層唯一投入 2/);assert.equal(await defectLevel.locator('.stage-reconcile').getAttribute('data-pass'),'true');
  await stageChoice('defect','DAF issue').click();assert.equal(await defectLevel.locator('.scroll tbody tr').last().locator('td').nth(3).innerText(),'a');
  await stageChoice('process','功能一測試').click();assert.equal(await card.locator('.stage-drill-level').count(),2,'changing an upper bar replaces the later path');await stageChoice('product','A／Model').click();defectLevel=card.locator('.stage-drill-level[data-dimension=defect]');assert.match(await defectLevel.innerText(),/FT1 dust/);assert.equal(await defectLevel.locator('.stage-reconcile').getAttribute('data-pass'),'true','a failure in another process is not lost to global first-NG attribution');
  await processLevel.locator('.stage-audit-details summary').click();await card.screenshot({path:'/tmp/autoreport-stage-reconciliation.png'});
  const [stageExport]=await Promise.all([page.waitForEvent('download'),page.locator('#download-前段').click()]),stageOutput=new ExcelJS.Workbook();await stageOutput.xlsx.readFile(await stageExport.path());const stageData=stageOutput.getWorksheet('每日階段良率');assert.equal(stageData.getCell('B2').value,.25);assert.equal(stageData.getCell('B3').value,null);assert.equal(stageData.getCell('B4').value,1);assert.equal(stageData.getCell('D2').value,4);assert.equal(stageData.getCell('D4').value,2);
  const auditRows=stageOutput.getWorksheet('逐層驗算總表').getSheetValues().slice(2).filter(Boolean);assert.ok(auditRows.length>5);assert.ok(auditRows.every(row=>row[12]===true));const period=stageOutput.getWorksheet('分析期間驗算');assert.deepEqual([period.getCell('C2').value,period.getCell('D2').value,period.getCell('E2').value],[6,1,5]);const contributions=stageOutput.getWorksheet('日期平均貢獻明細').getSheetValues().slice(2).filter(row=>row?.[1]==='2026-10-12');assert.equal(contributions.reduce((sum,row)=>sum+row[11],0),.25);
  await processLevel.locator('.chart-head button').click();assert.equal(await card.locator('.stage-drill-level').count(),0);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
