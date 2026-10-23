import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {createStageChartWorkbook,createDefectTrendWorkbook} from './chart-export.mjs';

test('editable stage-yield workbook includes native combo chart and preserves blank dates',async()=>{
 const stage={key:'SMT',title:'SMT',target:.995,color:'F4B400'};
 const rows=[{date:'2026-10-12',value:.999},{date:'2026-10-13',value:null},{date:'2026-10-14',value:.987}];
 const bytes=await createStageChartWorkbook(stage,rows),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 const sheet=book.getWorksheet('每日階段良率');assert.equal(sheet.rowCount,4);assert.deepEqual([sheet.getCell('A2').value,sheet.getCell('A3').value,sheet.getCell('A4').value],rows.map(r=>r.date));
 assert.equal(sheet.getCell('B2').value,.999);assert.equal(sheet.getCell('B3').value,null);assert.equal(sheet.getCell('B4').value,.987);assert.equal(sheet.getCell('C3').value,.995);
 const zip=await JSZip.loadAsync(bytes),chart=await zip.file('xl/charts/chart1.xml').async('string');
 assert.match(chart,/<c:barChart>/);assert.match(chart,/<c:lineChart>/);assert.match(chart,/<c:dispBlanksAs val="gap"\/>/);assert.match(chart,/每日階段良率'!\$A\$2:\$A\$4/);
 assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'),/<drawing r:id="rId1"\/>/);
 assert.match(await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string'),/relationships\/chart/);
 const lowBytes=await createStageChartWorkbook(stage,[{date:'2026-10-15',value:.5}]),lowZip=await JSZip.loadAsync(lowBytes);assert.match(await lowZip.file('xl/charts/chart1.xml').async('string'),/<c:min val="0\.5"\/>/);
});
test('native chart and plotted PNG snapshot coexist with notes and source files',async()=>{
 const snapshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const bytes=await createStageChartWorkbook({title:'前段',target:.985,color:'#d54545'},[{date:'2026-10-05',value:.99}],{snapshot,sources:[{name:'來源.xlsx',size:123}],referenceSources:['對照.xlsx']});
 const zip=await JSZip.loadAsync(bytes);assert.ok(Object.keys(zip.files).some(name=>/^xl\/media\/image\d+\.png$/.test(name)));
 const nativeDrawing=await zip.file('xl/drawings/drawing2.xml').async('string');assert.match(nativeDrawing,/<c:chart/);assert.match(await zip.file('xl/drawings/drawing1.xml').async('string'),/<xdr:pic>/);assert.doesNotMatch(await zip.file('xl/drawings/drawing1.xml').async('string'),/<xdr:oneCellAnchor[^>]*editAs/);
 assert.doesNotMatch(await zip.file('xl/charts/chart1.xml').async('string'),/val="#d54545"/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);assert.ok(book.getWorksheet('已產生圖表'));assert.ok(book.getWorksheet('統計說明'));assert.equal(book.getWorksheet('資料來源').getCell('B2').value,'來源.xlsx');assert.equal(book.getWorksheet('資料來源').getCell('B3').value,'對照.xlsx');assert.equal(book.getWorksheet('已產生圖表').getImages().length,1);
});


test('defect trend export has editable multi-series native lines, exact denominators and blank-date gaps',async()=>{
 const dates=[{key:'2026-10-05',label:'2026-10-05',input:100,count:3,rate:.03},{key:'2026-10-06',label:'2026-10-06',input:0,count:0,rate:null},{key:'2026-10-07',label:'2026-10-07',input:50,count:1,rate:.02}],series=[{defect:'裂痕',color:'#117b73',points:dates.map((d,i)=>({...d,count:i===0?1:0,rate:d.input?(i===0?.01:0):null}))},{defect:'異物',color:'#d54545',points:dates.map((d,i)=>({...d,count:i===0?2:i===2?1:0,rate:d.input?.02:null}))}],snapshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const bytes=await createDefectTrendWorkbook({dates,series},{snapshot,sources:[{name:'trend.xlsx'}]}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/charts/chart1.xml').async('string');assert.match(xml,/<c:lineChart>/);assert.match(xml,/<c:symbol val="circle"\/>/);assert.doesNotMatch(xml,/<c:barChart>/);assert.equal((xml.match(/<c:ser>/g)||[]).length,2);assert.match(xml,/不良率推移'!\$B\$2:\$B\$4/);assert.match(xml,/不良率推移'!\$C\$2:\$C\$4/);assert.match(xml,/<c:dispBlanksAs val="gap"/);assert.match(xml,/117b73/);assert.match(xml,/d54545/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.getWorksheet('不良率推移');assert.equal(sheet.getCell('B1').value,'裂痕');assert.equal(sheet.getCell('C1').value,'異物');assert.equal(sheet.getCell('A3').value,'2026-10-06');assert.equal(sheet.getCell('B3').value,null);assert.equal(sheet.getCell('C3').value,null);assert.equal(sheet.getCell('C4').value,.02);assert.equal(book.getWorksheet('日期投入').getCell('B2').value,100);assert.equal(book.getWorksheet('已產生圖表').getImages().length,1);assert.ok(book.getWorksheet('推移明細'));
});

test('stage chart workbook uses editable AGGREGATE formulas sourced from only its three processes',async()=>{
 const rows=[{date:'2026-06-02',value:.5,processRows:[{process:'DAF熱壓投入',value:1},{process:'DAF外觀',value:0},{process:'功能一測試',value:.5}]},{date:'2026-06-03',value:null,processRows:[]}],bytes=await createStageChartWorkbook({key:'前段',title:'前段',target:.985,color:'#d54545'},rows),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const value=book.getWorksheet('每日階段良率').getCell('B2').value;assert.match(value.formula,/AGGREGATE\(1,6/);assert.equal(value.result,.5);assert.equal(book.getWorksheet('製程良率資料').getCell('C2').value,0);assert.equal(book.getWorksheet('每日階段良率').getCell('B3').value,null);
});

test('defect chart workbook computes plotted rates from its owning process input and bad PPID cells',async()=>{
 const rows=[{date:'CG內異物 · DAF外觀',value:.5},{date:'CG內異物 · 功能一測試',value:.2}],bytes=await createStageChartWorkbook({kind:'defect',title:'製程內不良項目不良率',sheetName:'不良率貢獻',target:0,color:'#d54545'},rows,{inputCounts:[2,5],badCounts:[1,1]}),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.getWorksheet('不良率貢獻');assert.equal(sheet.getCell('D2').value,2);assert.equal(sheet.getCell('D3').value,5);assert.equal(sheet.getCell('E2').value,1);assert.equal(sheet.getCell('B2').value.formula,'IFERROR(E2/D2,"")');assert.equal(sheet.getCell('B2').value.result,.5);assert.equal(sheet.getCell('B3').value.result,.2);
});
