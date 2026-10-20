import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
test('Pages project path loads; browser uploads Excel/CSV and downloads a real workbook',async()=>{
 const root=path.resolve('dist');const requests=[];
 const server=createServer(async(req,res)=>{
  requests.push([req.method,req.url]);
  const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,requestPath.replace(/^\/AutoReport\//,'').replace(/^$/,'index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('request',r=>requests.push([r.method(),r.url()]));page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.exportRequests=0;const send=Worker.prototype.postMessage;
   Worker.prototype.postMessage=function(message,...args){if(message.type==='export')window.exportRequests++;return send.call(this,message,...args);};
  });
  await page.goto(process.env.LIVE_SITE_URL || `http://127.0.0.1:${server.address().port}/AutoReport/`);
  await page.waitForFunction(()=>!document.querySelector('#match').disabled);
  assert.equal(await page.locator('#orderCount').innerText(),'0');
  await page.locator('#query').fill('C515-250300004');await page.locator('#lookup').click();
  await page.locator('#searchResults').getByText('查無資料').waitFor();
  const referenceBook=new ExcelJS.Workbook();
  for(const name of ['工單（A16）','CY26','工單（CY24&25）','重工工單1','NPI']){
   const sheet=referenceBook.addWorksheet(name);sheet.addRows([['機種','IC','料號','工單'],['Taroko 14','Goodix','TEST-PART','C515-250300004']]);
  }
  await page.locator('#databaseFile').setInputFiles({name:'test-reference.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await referenceBook.xlsx.writeBuffer())});
  await page.locator('#databaseUpload').click();
  await page.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('已儲存在本瀏覽器'),{},{timeout:120000});
  const queryBook=new ExcelJS.Workbook();queryBook.addWorksheet('查詢').addRows([['工單號碼'],['C515-250300004'],['MISSING123']]);
  await page.locator('#query').fill('C515-250300004');await page.locator('#lookup').click();
  await page.locator('#searchResults').getByText('唯一匹配').waitFor();assert.match(await page.locator('#searchResults').innerText(),/Taroko 14/);
  await page.locator('#file').setInputFiles({name:'query.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await queryBook.xlsx.writeBuffer())});await page.locator('#match').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成 2 筆'));
  assert.match(await page.locator('#message').innerText(),/唯一匹配 1 筆/);assert.match(await page.locator('#message').innerText(),/查無資料 1 筆/);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());assert.equal(book.worksheets[0].rowCount,3);assert.equal(book.worksheets[0].getCell('E2').value,'Goodix');
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
  await page.locator('#mergeMatched').click();
  await page.locator('#matchedMergeResult').waitFor({state:'visible'});
  assert.equal(await page.locator('#matchedMergeDownload').evaluate(el=>el.closest('.panel').contains(document.querySelector('#mergeMatched'))),true,'merged download stays next to the initiating button');
  assert.match(await page.locator('#matchedMergeMessage').innerText(),/合併完成/);
  assert.equal(await page.locator('#matchedMergeDownload').getAttribute('href'),await page.locator('#mergeDownload').getAttribute('href'));
  const [mergedMatch]=await Promise.all([page.waitForEvent('download'),page.locator('#matchedMergeDownload').click()]);
  assert.equal(mergedMatch.suggestedFilename(),'2026_w41_1011-1011.xlsx');
  const mergedMatchedBook=new ExcelJS.Workbook();await mergedMatchedBook.xlsx.readFile(await mergedMatch.path());
  assert.deepEqual(mergedMatchedBook.worksheets.map(s=>s.name),['Detail']);
  assert.equal(mergedMatchedBook.getWorksheet('Detail').getCell('J2').value,'Goodix');
  assert.equal(mergedMatchedBook.getWorksheet('Detail').getCell('K2').value,'Taroko 14');
  await page.locator('#file').setInputFiles({name:'auto-detail.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await detailBook.xlsx.writeBuffer())});
  await page.locator('#autoAnalyze').click();await page.waitForFunction(()=>!document.querySelector('#autoResult').hidden||document.querySelector('#message').className==='warn',{},{timeout:30000});assert.equal(await page.locator('#message').getAttribute('class'),'ok',await page.locator('#message').innerText());
  assert.equal(await page.locator('#uploadResults').innerText(),'');assert.match(await page.locator('#message').innerText(),/中間比對與合併結果不顯示/);
  const [autoDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#autoDownload').click()]);
  const autoBook=new ExcelJS.Workbook();await autoBook.xlsx.readFile(await autoDownload.path());assert.ok(autoBook.getWorksheet('不良分析'));assert.equal(autoBook.getWorksheet('資料來源').getCell('B2').value,'auto-detail.xlsx');assert.equal(autoBook.getWorksheet('資料來源').getCell('B3').value,'test-reference.xlsx');
  assert.equal(autoDownload.suggestedFilename(),'2026_w41_1011-1011_每日良率_不良分析.xlsx');
  await page.locator('#yieldFile').setInputFiles({name:'master.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await readFile(await mergedMatch.path())});
  await page.locator('#yieldCalculate').click();await page.locator('#yieldResult').waitFor({state:'visible'});
  const [yieldDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#yieldDownload').click()]);
  assert.equal(yieldDownload.suggestedFilename(),'2026_w41_1011-1011_每日良率_不良分析.xlsx');
  const yieldBook=new ExcelJS.Workbook();await yieldBook.xlsx.readFile(await yieldDownload.path());
  assert.deepEqual(yieldBook.worksheets.slice(0,4).map(s=>s.name),['每日製程良率','每日階段良率','計算明細','Detail']);
  assert.equal(yieldBook.getWorksheet('計算明細').getCell('E2').value,1);
  assert.equal(yieldBook.getWorksheet('計算明細').getCell('H2').value.result,1);
  assert.match(yieldBook.getWorksheet('每日階段良率').getCell('B4').value.formula,/AGGREGATE/);
  assert.equal(yieldBook.getWorksheet('品質總覽').getCell('B2').value,1);assert.equal(yieldBook.getWorksheet('每日階段良率').getCell('A3').value,'SMT','legacy SMT report calculation is retained');
  assert.equal(await page.locator('#qualityDashboard').isVisible(),true);
  await page.locator('#qualityProduct').selectOption({label:'Goodix／Taroko 14'});
  assert.equal(await page.locator('#stage-SMT').count(),0);assert.equal(await page.locator('#download-SMT').count(),0);
  const qualityFixture=new ExcelJS.Workbook();await qualityFixture.xlsx.load(await mergedMatchedBook.xlsx.writeBuffer());
  const qualityDetail=qualityFixture.getWorksheet('Detail');qualityDetail.getCell('H2').value='第一筆不良項目';qualityDetail.getCell('I2').value='GOOD';
  const otherFailure=qualityDetail.getRow(2).values.slice(1);otherFailure[0]='第二製程';otherFailure[5]=new Date('2026-10-12');otherFailure[7]='其他不良';otherFailure[8]='FAIL';qualityDetail.addRow(otherFailure);
  const earlierGood=qualityDetail.getRow(2).values.slice(1);earlierGood[0]='正面AOI';earlierGood[5]=new Date('2026-10-10');earlierGood[7]='後續GOOD不良項目';earlierGood[8]='GOOD';qualityDetail.addRow(earlierGood);
  // The daily merge and attribution both prioritize FAIL; the first FAIL in input wins, not the earliest timestamp.
  qualityDetail.getCell('F2').value=new Date('2026-10-11T12:00:00Z');qualityDetail.getCell('H2').value='第一筆不良項目';
  const earlierFail=qualityDetail.getRow(2).values.slice(1);earlierFail[5]=new Date('2026-10-11T01:00:00Z');earlierFail[7]='時間較早但後出現';earlierFail[8]='FAIL';qualityDetail.addRow(earlierFail);
  const goodUnit=qualityDetail.getRow(2).values.slice(1);goodUnit[4]='second-unit';goodUnit[7]=null;goodUnit[8]='GOOD';qualityDetail.addRow(goodUnit);
  await page.locator('#yieldFile').setInputFiles({name:'quality.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await qualityFixture.xlsx.writeBuffer())});
  await page.locator('#yieldCalculate').click();await page.locator('#qualityDashboard').waitFor({state:'visible'});
  assert.match(await page.locator('#qualityMetrics').innerText(),/50\.00%/);
  assert.equal(await page.locator('canvas').count(),3);assert.equal(await page.locator('#stage-前段').getAttribute('data-points'),'3','chart date axis retains days with no stage data');await page.locator('#stage-前段').focus();await page.locator('#stage-前段').press('ArrowRight');assert.match(await page.locator('#qualitySelection').innerText(),/2026-10-11 · —/,'keyboard navigation can reach an empty date');
  const [chartExcel]=await Promise.all([page.waitForEvent('download'),page.locator('#download-前段').click()]);assert.equal(chartExcel.suggestedFilename(),'前段_每日階段良率.xlsx');const chartBook=new ExcelJS.Workbook();await chartBook.xlsx.readFile(await chartExcel.path());const chartSheet=chartBook.getWorksheet('每日階段良率');assert.equal(chartSheet.rowCount,4,'all three calendar dates, including empty dates, remain in the data table');assert.equal(chartSheet.getCell('A2').value,'2026-10-10');assert.equal(chartSheet.getCell('A3').value,'2026-10-11');assert.equal(chartSheet.getCell('B3').value,null);const chartZip=await JSZip.loadAsync(await readFile(await chartExcel.path()));const chartXml=await chartZip.file('xl/charts/chart1.xml').async('string');assert.match(chartXml,/<c:barChart>/);assert.match(chartXml,/<c:lineChart>/);assert.match(chartXml,/<c:dispBlanksAs val="gap"\/>/);assert.match(chartXml,/每日階段良率'!\$A\$2:\$A\$4/);assert.ok(chartBook.getWorksheet('已產生圖表'));assert.equal(chartBook.getWorksheet('已產生圖表').getImages().length,1);assert.ok(chartBook.getWorksheet('資料來源'));
  const [qualityDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#yieldDownload').click()]);
  const qualityOutput=new ExcelJS.Workbook();await qualityOutput.xlsx.readFile(await qualityDownload.path());
  assert.equal(qualityOutput.getWorksheet('Detail').state,'hidden');assert.equal(qualityOutput.getWorksheet('計算明細').state,'hidden');
  assert.deepEqual(qualityOutput.worksheets.filter(sheet=>sheet.state==='visible').map(sheet=>sheet.name),['每日製程良率','每日階段良率','品質總覽','產品總良率','製程總良率','不良分析','PPID對照衝突','不良PPID明細','資料來源','統計說明']);
  assert.equal(qualityOutput.getWorksheet('品質總覽').getCell('B2').value,2);
  assert.equal(qualityOutput.getWorksheet('品質總覽').getCell('F2').value,.5);
  assert.equal(qualityOutput.getWorksheet('產品總良率').getCell('F1').value,'產品總良率（日期×階段算術平均）');
  assert.equal(qualityOutput.getWorksheet('全產品不良排名'),undefined);
  assert.equal(qualityOutput.getWorksheet('產品製程總良率'),undefined);
  assert.equal(qualityOutput.getWorksheet('不良歸屬明細'),undefined);
  const defectAnalysis=qualityOutput.getWorksheet('不良分析');assert.equal(defectAnalysis.getCell('A4').value,'日期');assert.equal(defectAnalysis.getCell('E5').value,'其他不良');assert.equal(defectAnalysis.getCell('G5').value,1);assert.equal(defectAnalysis.getCell('I5').value,.5);assert.equal(defectAnalysis.getCell('I6').value,.5);
  assert.equal(qualityOutput.getWorksheet('全產品不良項目占比'),undefined);assert.equal(qualityOutput.getWorksheet('未達標分析'),undefined);assert.equal(qualityOutput.getWorksheet('計算明細').getCell('I1').value,'不良率');
  assert.ok(qualityOutput.getWorksheet('資料來源'));assert.equal(qualityOutput.getWorksheet('不良PPID明細').getCell('F2').value,'其他不良');
  assert.equal(await page.locator('#sources').isHidden(),true);assert.doesNotMatch(await page.locator('body').innerText(),/前段：DAF外觀|檔案在你的瀏覽器內比對/);
  assert.equal(await page.locator('.defect-panel').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.yield-charts'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Excel stage charts follow full defect analysis');
  await page.locator('#defectGroups button').first().click();assert.equal(await page.locator('.defect-level').count(),2);assert.match(await page.locator('#defectTitle-date').innerText(),/日期/);assert.match(await page.locator('#defectTitle').innerText(),/產品/,'ancestor product chart stays visible');
  await page.locator('#defectDate').selectOption('2026-10-10');assert.match(await page.locator('#defectTotals').innerText(),/0/,'AOI-only date has no attributed failures');
  await page.locator('#defectDate').selectOption('2026-10-12');await page.locator('#defectGroups-process button').filter({hasText:'第二製程'}).click();await page.locator('#defectGroups-defect button').filter({hasText:'其他不良'}).click();
  assert.equal(await page.locator('.defect-level').count(),4);assert.equal(await page.locator('.defect-level canvas').count(),4,'no individual PPID chart is appended');assert.equal(await page.locator('.defect-leaf').count(),1);
  await page.locator('#defectBack').click();assert.equal(await page.locator('#defectItem').inputValue(),'');assert.equal(await page.locator('.defect-level').count(),4);await page.locator('#defectItem').selectOption('其他不良');
  await page.locator('#defectOrders').click();assert.match(await page.locator('#defectDetailTitle').innerText(),/工單/);assert.match(await page.locator('#defectDetailTable').innerText(),/C515-250300004/);assert.equal(await page.locator('#defectDetailTable tbody tr').count(),1);await page.locator('#defectClose').click();
  const [levelDownload]=await Promise.all([page.waitForEvent('download'),page.locator('.defect-level').last().getByRole('button',{name:'下載 Excel 圖表'}).click()]);const levelBook=new ExcelJS.Workbook();await levelBook.xlsx.readFile(await levelDownload.path());assert.ok(levelBook.getWorksheet('拆解資料'));assert.equal(levelBook.getWorksheet('已產生圖表').getImages().length,1);
  await page.locator('#defectOpen').click();assert.equal(await page.locator('#defectDetails').isVisible(),true);assert.match(await page.locator('#defectDetailTable').innerText(),/其他不良/);assert.equal(await page.locator('#defectDetailTable tbody tr').count(),1);
  await page.locator('#defectSearch').fill('does-not-exist');assert.equal(await page.locator('#defectDetailTable tbody tr').count(),0);await page.locator('#defectClose').click();
  const [defectDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#defectDownload').click()]);assert.equal(defectDownload.suggestedFilename(),'AutoReport_完整不良分析.xlsx');const fullAnalysis=new ExcelJS.Workbook();await fullAnalysis.xlsx.readFile(await defectDownload.path());
  assert.equal(fullAnalysis.getWorksheet('品質總覽').getCell('A2').value,2);assert.equal(fullAnalysis.getWorksheet('品質總覽').getCell('E2').value,.5);assert.equal(fullAnalysis.getWorksheet('不良PPID明細').rowCount,2);assert.equal(fullAnalysis.getWorksheet('不良PPID明細').getCell('F2').value,'其他不良');assert.ok(fullAnalysis.getWorksheet('完整層級拆解'));assert.equal(fullAnalysis.getWorksheet('已產生圖表').getImages().length,1);
  assert.ok(fullAnalysis.getWorksheet('工單明細'));assert.equal(fullAnalysis.getWorksheet('工單明細').getCell('A2').value,'C515-250300004');
  await page.locator('#defectPeriodMode').selectOption('week');assert.equal(await page.locator('#defectStart').getAttribute('type'),'week');await page.locator('#defectStart').fill('2026-W41');await page.locator('#defectEnd').fill('2026-W42');await page.locator('#defectApplyRange').click();assert.equal(await page.locator('#stage-前段').getAttribute('data-points'),'14');assert.equal(await page.locator('#defectDate option').count(),3,'both ISO weeks retained');
  await page.locator('#defectPeriodMode').selectOption('month');await page.locator('#defectStart').fill('2026-10');await page.locator('#defectEnd').fill('2026-10');await page.locator('#defectApplyRange').click();assert.equal(await page.locator('#stage-前段').getAttribute('data-points'),'31');await page.locator('#defectDate').selectOption('2026-10');assert.equal(await page.locator('#defectDate option').count(),2);assert.match(await page.locator('#defectTotals').innerText(),/2/,'monthly inputs deduplicate the same PPID across days');
  await page.locator('#defectPeriodMode').selectOption('day');await page.locator('#defectStart').fill('2026-10-12');await page.locator('#defectEnd').fill('2026-10-10');await page.locator('#defectApplyRange').click();assert.match(await page.locator('#defectRangeStatus').innerText(),/有效/);await page.locator('#defectStart').fill('2026-10-10');await page.locator('#defectEnd').fill('2026-10-12');await page.locator('#defectApplyRange').click();
  await page.locator('#defectGroups-date button').filter({hasText:'2026-10-12'}).click();await page.locator('#defectGroups-process button').filter({hasText:'第二製程'}).click();await page.locator('#defectGroups-defect button').filter({hasText:'其他不良'}).click();
  await page.screenshot({path:'/tmp/autoreport-analysis-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no page-wide overflow');await page.screenshot({path:'/tmp/autoreport-analysis-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
  await page.locator('#defectReset').click();assert.equal(await page.locator('#qualityProduct').inputValue(),'');
  await page.locator('#yieldFile').setInputFiles({name:'downloaded-master.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await readFile(await qualityDownload.path())});
  await page.locator('#yieldCalculate').click();await page.locator('#yieldResult').waitFor({state:'visible'});
  const [reanalysis]=await Promise.all([page.waitForEvent('download'),page.locator('#yieldDownload').click()]);
  const reloaded=new ExcelJS.Workbook();await reloaded.xlsx.readFile(await reanalysis.path());assert.equal(reloaded.getWorksheet('不良分析').getCell('E5').value,'其他不良');
  assert.equal(await page.locator('#thresholdDashboard').isVisible(),false);
  assert.equal(await page.locator('#qualityDashboard').isVisible(),true);
  const lowMaster=new ExcelJS.Workbook(),lowSheet=lowMaster.addWorksheet('Detail');lowSheet.addRow(['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種']);
  lowSheet.addRow(['DAF外觀','o','p','n','low-a',new Date('2026-10-05'),'op','偏移','FAIL','Goodix','Model']);lowSheet.addRow(['DAF外觀','o','p','n','low-b',new Date('2026-10-05'),'op',null,'GOOD','Goodix','Model']);
  await page.locator('#yieldFile').setInputFiles({name:'low.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await lowMaster.xlsx.writeBuffer())});await page.locator('#yieldCalculate').click();await page.locator('#qualityDashboard').waitFor({state:'visible'});assert.equal(await page.locator('#thresholdDashboard').isVisible(),false);
  const [lowDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#yieldDownload').click()]);const lowOutput=new ExcelJS.Workbook();await lowOutput.xlsx.readFile(await lowDownload.path());assert.equal(lowOutput.getWorksheet('未達標分析'),undefined);assert.equal(lowOutput.getWorksheet('全產品不良項目占比'),undefined);assert.equal(lowOutput.getWorksheet('不良分析').getCell('G5').value,1);assert.equal(lowOutput.getWorksheet('不良分析').getCell('I5').value,.5);




  const targetBook=new ExcelJS.Workbook(),targetDetail=targetBook.addWorksheet('Detail');targetDetail.addRow(['製程','工單','料號','品名','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種']);
  for(const [day,fails] of [[12,1],[13,3],[14,4],[16,0]])for(let n=0;n<200;n++)targetDetail.addRow(['DAF外觀','work-'+day,'p','n',day+'-'+n,new Date(`2026-10-${day}`),'op',n<fails?'測試不良':null,n<fails?'FAIL':'GOOD','IC','Model']);
  await page.locator('#yieldFile').setInputFiles({name:'target-overlap.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await targetBook.xlsx.writeBuffer())});await page.locator('#yieldCalculate').click();await page.locator('#yieldResult').waitFor({state:'visible'});assert.equal(await page.locator('#stage-前段').getAttribute('data-points'),'5','empty date between measurements remains');
  const targetPixels=await page.locator('#stage-前段').evaluate(canvas=>{const {width:w,height:h}=canvas,data=canvas.getContext('2d').getImageData(0,0,w,h).data,blue=(x,y)=>{const i=(y*w+x)*4;return data[i]>45&&data[i]<80&&data[i+1]>85&&data[i+1]<135&&data[i+2]>180;},red=(x,y)=>{const i=(y*w+x)*4;return data[i]>180&&data[i+1]<100&&data[i+2]<100;};let crossing=false,label=false;for(let y=4;y<h-4;y++)for(let x=0;x<w;x++)if(blue(x,y)){if(y<40)label=true;if(red(x,y-4)&&red(x,y+4))crossing=true;}return {crossing,label};});assert.equal(targetPixels.crossing,true,'blue target remains visible across a red bar');assert.equal(targetPixels.label,true,'blue target label occupies the space above the plot');
  await page.locator('.yield-charts').screenshot({path:'/tmp/autoreport-fixed-target.png'});const [fixedExcel]=await Promise.all([page.waitForEvent('download'),page.locator('#download-前段').click()]);await fixedExcel.saveAs('/tmp/autoreport-fixed-stage.xlsx');

  const failBook=new ExcelJS.Workbook();await failBook.xlsx.load(await detailBook.xlsx.writeBuffer());
  failBook.getWorksheet('Detail').getCell('H2').value='不良';failBook.getWorksheet('Detail').getCell('I2').value='FAIL';
  await page.locator('#mergeFiles').setInputFiles([
   {name:'good.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await detailBook.xlsx.writeBuffer())},
   {name:'fail.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await failBook.xlsx.writeBuffer())}
  ]);
  await page.locator('#mergeDirect').click();await page.locator('#mergeResult').waitFor({state:'visible'});
  const [dedupDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#mergeDownload').click()]);
  const dedupBook=new ExcelJS.Workbook();await dedupBook.xlsx.readFile(await dedupDownload.path());
  assert.equal(dedupBook.getWorksheet('Detail').rowCount,2);
  assert.equal(dedupBook.getWorksheet('Detail').getCell('I2').value,'FAIL');
  assert.equal(dedupBook.getWorksheet('Detail').getCell('H2').value,'不良');
  await page.locator('#file').setInputFiles({name:'detail-again.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await detailBook.xlsx.writeBuffer())});await page.locator('#match').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成'));
  const preparedExports=await page.evaluate(()=>window.exportRequests);
  const [again]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  assert.equal(again.suggestedFilename(),'detail-again_IC機種.xlsx');
  assert.equal(await page.evaluate(()=>window.exportRequests),preparedExports,'download clicks must use the prepared file without an asynchronous worker request');
  assert.equal(await page.locator('#message').evaluate(el=>el.closest('.panel')?.querySelector('#export')!==null),true,'download feedback is next to the upload controls');
  await page.locator('#file').setInputFiles({name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('工單號碼\nmissing\n')});
  assert.equal(await page.locator('#export').isDisabled(),true,'a changed file invalidates the previous download');
  assert.equal(await page.locator('#matchedMergeResult').isHidden(),true);assert.equal(await page.locator('#matchedMergeDownload').getAttribute('href'),null);
  const first=Buffer.from(await detailBook.xlsx.writeBuffer());detail.getCell('A2').value='第二份原始內容';
  const second=Buffer.from(await detailBook.xlsx.writeBuffer());
  await page.locator('#file').setInputFiles([
   {name:'same.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:first},
   {name:'broken.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('invalid workbook')},
   {name:'same.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:second},
  ]);
  await page.locator('#match').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('批次完成'));
  assert.match(await page.locator('#message').innerText(),/可下載 2 份結果，失敗 1 個檔案/);
  assert.equal(await page.locator('[data-download]').count(),2);
  const [batch]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
  assert.equal(batch.suggestedFilename(),'AutoReport_批次結果.zip');
  const zip=await JSZip.loadAsync(await readFile(await batch.path()));
  assert.deepEqual(Object.keys(zip.files),['same_IC機種.xlsx','same_IC機種_2.xlsx']);
  for(const [name,expected] of [['same_IC機種.xlsx','背面大板'],['same_IC機種_2.xlsx','第二份原始內容']]){
   const result=new ExcelJS.Workbook();await result.xlsx.load(await zip.file(name).async('nodebuffer'));
   assert.equal(result.getWorksheet('Detail').getCell('A2').value,expected);
   assert.equal(result.getWorksheet('Detail').getCell('J2').value,'Goodix');
   assert.equal(result.getWorksheet('Detail').getCell('K2').value,'Taroko 14');
  }
  const [individual]=await Promise.all([page.waitForEvent('download'),page.locator('[data-download="1"]').click()]);
  assert.equal(individual.suggestedFilename(),'same_IC機種_2.xlsx');
  assert.deepEqual(errors,[]);assert.ok(requests.every(([method,url])=>method==='GET'&&!url.includes('/api/')));
  console.log('Browser verified all requests are GET; upload files never leave browser.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
