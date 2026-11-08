import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {productStageSeries} from './stage-product-series.mjs';
import {createStageChartWorkbook} from './chart-export.mjs';

const products=[{id:'p',ic:'Goodix',model:'B24'}];
const row=(serial,date,process='功能一測試',fail=false)=>({
 product:'p',serial,date,process,fail,status:fail?'FAIL':'GOOD'
});

test('previous calendar week uses its own unique PPIDs outside the daily display range',()=>{
 const analysis={products,observations:[
  row('a','2026-10-18'),row('a','2026-10-19'),
  row('b','2026-10-20','功能一測試',true),
  row('a','2026-10-27'),row('c','2026-10-28')
 ]};
 const model=productStageSeries(analysis,'p','前段','2026-10-25','2026-10-31');
 assert.deepEqual(model.weeks.map(item=>item.date),['2026-W41','2026-W42']);
 assert.equal(model.weeks[0].input,2);
 assert.equal(model.weeks[0].value,.5);
 assert.equal(model.weeks[1].input,2);
 assert.deepEqual(model.daily.map(item=>item.date),['2026-10-27','2026-10-28']);
});

test('context adds the missing prior week for both stages without adding prior daily rows',()=>{
 const analysis={products,observations:[
  row('a','2026-10-27'),row('a','2026-10-27','功能二測試')
 ],stageWeekContext:{
  key:'2026-W41',start:'2026-10-18',end:'2026-10-24',status:'ready',
  products:[{id:'p',stages:[
   {stage:'前段',input:40,count:2,good:38,value:.95,uniqueYield:.95,processRows:[{process:'功能一測試',input:40,count:2,good:38,value:.95}]},
   {stage:'後段',input:35,count:1,good:34,value:34/35,uniqueYield:34/35,processRows:[{process:'功能二測試',input:35,count:1,good:34,value:34/35}]}
  ]}]
 }};
 for(const stage of ['前段','後段']){
  const model=productStageSeries(analysis,'p',stage,'2026-10-25','2026-10-31');
  assert.deepEqual(model.chartRows.map(item=>item.date),['2026-W41','2026-W42','2026-10-27']);
  assert.equal(model.weeks[0].input,stage==='前段'?40:35);
  assert.equal(model.period.input,1);
 }
});

test('missing context creates a notice instead of a fictitious prior-week bar',()=>{
 const model=productStageSeries({products,observations:[row('a','2026-10-27')]},'p','前段','2026-10-25','2026-10-31');
 assert.deepEqual(model.weeks.map(item=>item.date),['2026-W42']);
 assert.match(model.comparisonNote,/2026-W41/);
});

test('year-boundary prior week and day multi-selection keep their own scopes',()=>{
 const analysis={products,observations:[
  row('old','2026-12-28'),row('a','2027-01-04'),row('b','2027-01-05','功能一測試',true)
 ]};
 const model=productStageSeries(analysis,'p','前段','2027-01-04','2027-01-06',['2027-01-04']);
 assert.deepEqual(model.weeks.map(item=>item.date),['2026-W51','2026-W52']);
 assert.equal(model.weeks[1].value,1);
 assert.equal(model.daily.length,1);
});

test('both editable charts share source ranges, weekly point fills and formula results',async()=>{
 const rows=[
  {kind:'week',date:'2026-W41',value:.97,processRows:[{process:'功能一測試',value:.97}]},
  {kind:'week',date:'2026-W42',value:.98,processRows:[{process:'功能一測試',value:.98}]},
  {date:'2026-10-27',value:1,processRows:[{process:'功能一測試',value:1}]}
 ];
 for(const stageName of ['前段','後段']){
  const bytes=await createStageChartWorkbook({key:stageName,title:'B24-Goodix · '+stageName,target:.985,color:'#d54545'},rows.map(row=>({...row,processRows:row.processRows.map(process=>({...process,process:stageName==='前段'?'功能一測試':'功能二測試'}))})),{linkedChartCopy:true,inputCounts:[100,100,10]});
  const zip=await JSZip.loadAsync(bytes),book=new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet=book.getWorksheet('每日階段良率');
  assert.deepEqual([2,3,4].map(index=>sheet.getCell('A'+index).value),rows.map(item=>item.date));
  assert.equal(sheet.getCell('B2').value.result,.97);
  assert.match(sheet.getCell('B2').value.formula,/AGGREGATE.*製程良率資料/);
  assert.equal(book.getWorksheet('已產生圖表').getImages().length,0);
  const charts=await Promise.all([1,2].map(id=>zip.file('xl/charts/chart'+id+'.xml').async('string')));
  assert.equal(charts[0],charts[1]);
  for(const chart of charts){
   assert.match(chart,/每日階段良率'!\$B\$2:\$B\$4/);
   assert.match(chart,/<c:dPt><c:idx val="0"\/><c:spPr><a:solidFill><a:srgbClr val="FFC000"/);
   assert.match(chart,/<c:dPt><c:idx val="1"\/><c:spPr><a:solidFill><a:srgbClr val="FFC000"/);
   assert.doesNotMatch(chart,/DAF[＋+]FT1|ASM[＋+]FT2/);
  }
  assert.ok(zip.file('xl/worksheets/_rels/sheet3.xml.rels'));
 }
});
