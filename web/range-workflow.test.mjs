import test from 'node:test';import assert from 'node:assert/strict';import ExcelJS from 'exceljs';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {performance} from 'node:perf_hooks';
import XLSX from '../vendor/xlsx.full.min.js';import {matchFile,exportMatches} from './files.mjs';
const six=['DAF外觀','DAF熱壓投入','功能一測試','功能二測試','外觀檢查點亮測試','輝度機測試'];
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態'];
const matcher={lookup(){return {'狀態':'唯一匹配','候選':[{'機種':'QA Model',IC:'QA IC'}]};}};
test('compact Raw matching exports only the six processes and A–K values while preserving source bytes and dates',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Detail');sheet.addRow(header);
 for(const [i,process] of [...six,'正面AOI','包裝'].entries())sheet.addRow([process,'WO','PART','Name','P'+i,new Date('2026-10-25T10:00:00Z'),'OP','','GOOD']);sheet.getCell('L2').value='unused column';
 const extra=book.addWorksheet('其他原始資料');for(let i=0;i<500;i++)extra.addRow([i,Math.sin(i).toString(36),Math.cos(i).toString(36)]);
 const bytes=await book.xlsx.writeBuffer(),before=Buffer.from(bytes),result=await matchFile(matcher,bytes,'raw.xlsx',{analysisOnly:true});assert.equal(result['筆數'],6);assert.equal(result.excludedRows,2);assert.equal(result.detailBytes,undefined);
 const output=await exportMatches(result),loaded=XLSX.read(output,{type:'array'}),rows=XLSX.utils.sheet_to_json(loaded.Sheets.Detail,{header:1,defval:null});
 assert.deepEqual(loaded.SheetNames,['Detail']);assert.deepEqual(rows.slice(1).map(r=>r[0]),six);assert.equal(rows[0].length,11);assert.equal(typeof rows[1][5],'number');assert.equal(XLSX.SSF.parse_date_code(rows[1][5]).y,2026);assert.equal(rows[1][9],'QA IC');assert.equal(rows[1][10],'QA Model');assert.ok(output.byteLength<bytes.byteLength);assert.deepEqual(Buffer.from(bytes),before);
});
test('compact Detail preserves merged work-order identities, honors manual fills and normalizes the 1904 date system',async()=>{
 const book=new ExcelJS.Workbook();book.properties.date1904=true;const sheet=book.addWorksheet('Detail');sheet.addRows([header,['DAF外觀','WO','PART','Name','A',new Date('2026-10-25T00:00:00Z'),'OP','','GOOD'],['功能一測試','','','Name','B',new Date('2026-10-26T00:00:00Z'),'OP','','GOOD']]);sheet.mergeCells('B2:B3');sheet.mergeCells('C2:C3');
 const result=await matchFile(matcher,await book.xlsx.writeBuffer(),'1904.xlsx',{analysisOnly:true});result['結果'][1].IC='Manual';
 const loaded=XLSX.read(await exportMatches(result),{type:'array'}),rows=XLSX.utils.sheet_to_json(loaded.Sheets.Detail,{header:1});assert.equal(rows[2][1],'WO');assert.equal(rows[2][2],'PART');assert.equal(rows[2][9],'Manual');const date=XLSX.SSF.parse_date_code(rows[1][5]);assert.equal(`${date.y}-${date.m}-${date.d}`,'2026-10-25');
 sheet.getCell('J2').value='existing';await assert.rejects(matchFile(matcher,await book.xlsx.writeBuffer(),'already.xlsx',{analysisOnly:true}),/已有資料/);
});
test('multi-month, multi-week and day ranges still compute daily results and PPID unions across all selected dates',async()=>{
 const ctx=vm.createContext({URL,performance});ctx.self=ctx;ctx.location={href:'https://example.test/yield-worker.js'};ctx.importScripts=(...paths)=>{for(const path of paths)vm.runInContext(readFileSync(path.split('?')[0],'utf8'),ctx);};const messages=[];ctx.postMessage=d=>messages.push(d);vm.runInContext(readFileSync('yield-worker.js','utf8'),ctx);
 const row=(serial,day,status='GOOD',process='DAF外觀')=>[process,'WO','P','N',serial,(Date.parse(day+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,'OP',status==='FAIL'?'dust':'',status,'IC','Model'];
 const book=ctx.XLSX.utils.book_new();ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([[...header,'IC','機種'],row('outside','2026-08-31','FAIL'),row('A','2026-09-15'),row('B','2026-09-30'),row('A','2026-10-25','FAIL'),row('C','2026-10-31'),row('D','2026-11-01','FAIL'),row('excluded','2026-09-20','FAIL','包裝')]),'Detail');
 const merger=new ctx.DetailMerger(ctx.XLSX);merger.add(book,'source.xlsx',{analysisOnly:true});const values=[...merger.rows.values()].map((v,seq)=>({...v,seq,fail:merger.hasDefect(v)})),dayCounts={};for(const v of values)dayCounts[v.day]=(dayCounts[v.day]||0)+1;
 const meta={key:'source',name:'source.xlsx',complete:true,header:merger.header,dayCounts,sources:['source.xlsx'],firstNG:[...merger.firstNG.values()],analysisFirstNG:[...merger.analysisFirstNG.values()]};ctx.AutoReportDetailIndex={meta:async()=>meta,scan:async(key,period,visit)=>{for(const v of values)if(ctx.AutoReportPeriods.contains(period,v.day))visit(v);}};
 const p=ctx.AutoReportPeriods;
 for(const [mode,start,end,days,total,fail] of [['month','2026-09-15','2026-10-25',61,3,1],['week','2026-10-25','2026-11-01',14,3,2],['day','2026-09-15','2026-10-25',41,2,1]]){
  const period=p.rangeFor(p.periodFor(start,mode),p.periodFor(end,mode));await ctx.onmessage({data:{files:[],indexedSources:['source'],period}});const result=messages.at(-1);assert.equal(result.type,'complete',result.message);assert.equal(result.date_count,days);assert.equal(result.analysis.total,total);assert.equal(result.analysis.fail,fail);assert.equal(result.includes_detail,false);
 }
 assert.throws(()=>p.rangeFor(p.periodFor('2026-10-01','month'),p.periodFor('2026-09-01','month')),/開始期間/);
});
