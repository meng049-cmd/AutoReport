import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {createStageChartWorkbook} from './chart-export.mjs';

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
