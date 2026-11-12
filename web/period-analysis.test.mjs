import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
function runtime(){const ctx=vm.createContext({URL,performance});ctx.self=ctx;ctx.location={href:'https://example.test/yield-worker.js?v=test'};ctx.importScripts=(...files)=>{for(const file of files)vm.runInContext(readFileSync(file.split('?')[0],'utf8'),ctx);};const messages=[];ctx.postMessage=data=>messages.push(data);vm.runInContext(readFileSync('yield-worker.js','utf8'),ctx);return {ctx,messages};}
test('analysis filenames retain the source reporting label and use a compact period range',()=>{
 const {ctx}=runtime(),stats={start_date:'2026-11-02',end_date:'2026-11-06'};
 assert.equal(ctx.analysisFilename([{name:'AUTOREPORT 工單查找與品質分析_2026_w43_1101-1107_IC機種.xlsx'}],null,stats),'2026_w43_1101-1107_不良分析.xlsx');
 assert.equal(ctx.analysisFilename([],ctx.AutoReportPeriods.periodFor('2026-11-01','week'),stats),'2026_w43_1101-1107_不良分析.xlsx');
 assert.equal(ctx.analysisFilename([{name:'Detail.xlsx'}],null,stats),'2026_w43_1102-1106_不良分析.xlsx');
});
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const row=(serial,day,status='GOOD',defect='',order='WO')=>['DAF外觀',order,'P','N',serial,(Date.parse(day+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,'OP',defect,status,'Goodix','Model'];
function prepared(ctx,rows,key){const book=ctx.XLSX.utils.book_new();ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');const merger=new ctx.DetailMerger(ctx.XLSX);merger.add(book,key+'.xlsx');return {meta:{key,name:key+'.xlsx',header,complete:true,dayCounts:Object.fromEntries([...new Set([...merger.rows.values()].map(v=>v.day))].map(day=>[day,[...merger.rows.values()].filter(v=>v.day===day).length])),sources:[key+'.xlsx'],firstNG:[...merger.firstNG.values()],analysisFirstNG:[...merger.analysisFirstNG.values()],skippedRows:[]},values:[...merger.rows.values()].map((v,seq)=>({...v,seq,fail:merger.hasDefect(v)}))};}
function useStore(ctx,items){let scans=0;ctx.AutoReportDetailIndex={meta:async key=>items.get(key)?.meta,scan:async(key,period,visit)=>{scans++;for(const v of [...items.get(key).values].sort((a,b)=>a.day.localeCompare(b.day)||a.seq-b.seq))if(ctx.AutoReportPeriods.contains(period,v.day))visit(v);}};return ()=>scans;}
test('reporting weeks preserve W42 and include cross-month week boundaries; month handles leap years',()=>{
 const {ctx}=runtime(),p=ctx.AutoReportPeriods;
 for(const day of ['2026-10-25','2026-10-31']){const w=p.periodFor(day,'week');assert.equal(w.key,'2026_w42_');assert.equal(w.start_date,'2026-10-25');assert.equal(w.end_date,'2026-10-31');}
 const w=p.periodFor('2026-10-01','week');assert.equal(w.start_date,'2026-09-27');assert.equal(w.end_date,'2026-10-03');
 const m=p.periodFor('2028-02-29','month');assert.equal(m.start_date,'2028-02-01');assert.equal(m.end_date,'2028-02-29');assert.throws(()=>p.periodFor('2026-02-30','month'));
 const options=p.periodsFor([{dayCounts:{'2026-10-25':1,'2026-10-31':2,'2026-11-01':1}}],'week');assert.equal(options.length,2);
});
test('216 indexed parts load only the chosen week, deduplicate shared PPIDs, and omit raw Detail from the report',async()=>{
 const {ctx,messages}=runtime(),items=new Map();
 for(let i=0;i<216;i++){const key='part'+i;items.set(key,prepared(ctx,[row('S'+i,'2026-10-25'),row('shared','2026-10-31',i===0?'FAIL':'GOOD',i===0?'dust':''),row('outside-'+i,'2026-11-01')],key));}
 const scans=useStore(ctx,items);ctx.DetailMerger.readBook=()=>{throw Error('Analysis must not reopen Excel files');};
 await ctx.onmessage({data:{files:[],indexedSources:[...items.keys()],period:ctx.AutoReportPeriods.periodFor('2026-10-25','week')}});
 const result=messages.at(-1);assert.equal(result.type,'complete',result.message);assert.equal(scans(),216);assert.equal(result.analysis.total,217);assert.equal(result.analysis.fail,1);assert.equal(result.output_rows,217);assert.equal(result.includes_detail,false);assert.equal(result.date_count,7);assert.equal(result.filename,'2026_w42_1025-1031_不良分析.xlsx');
 const book=ctx.XLSX.read(result.bytes,{type:'array'});assert.ok(!book.SheetNames.some(n=>/^Detail/.test(n)));assert.ok(book.Sheets['不良PPID明細']);assert.equal(result.analysis.observations.length,217);
});
test('monthly union is calculated from PPIDs across weeks, and outside-period FAIL does not contaminate a weekly analysis',async()=>{
 const {ctx,messages}=runtime(),items=new Map([['a',prepared(ctx,[row('same','2026-10-01','FAIL','early'),row('same','2026-10-25'),row('new','2026-10-31','FAIL','late')],'a')],['b',prepared(ctx,[row('same','2026-10-25'),row('nov','2026-11-01','FAIL','next month')],'b')]]);useStore(ctx,items);
 await ctx.onmessage({data:{files:[],indexedSources:['a','b'],period:ctx.AutoReportPeriods.periodFor('2026-10-25','week')}});let result=messages.at(-1);assert.equal(result.type,'complete',result.message);assert.equal(result.analysis.total,2);assert.equal(result.analysis.fail,1);
 messages.length=0;await ctx.onmessage({data:{files:[],indexedSources:['a','b'],period:ctx.AutoReportPeriods.periodFor('2026-10-25','month')}});result=messages.at(-1);assert.equal(result.type,'complete',result.message);assert.equal(result.analysis.total,2);assert.equal(result.analysis.fail,2);assert.equal(result.date_count,31);assert.equal(result.analysis.attribution.find(r=>r.serial==='same').defect,'early');assert.match(result.filename,/2026-10_/);
});
test('oversized periods stop before loading rows; incomplete indexes never produce partial reports',async()=>{
 const {ctx,messages}=runtime(),items=new Map([['big',{meta:{complete:true,dayCounts:{'2026-10-25':600001}}}]]),scans=useStore(ctx,items);
 await ctx.onmessage({data:{files:[],indexedSources:['big'],period:ctx.AutoReportPeriods.periodFor('2026-10-25','week')}});assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/安全分析容量/);assert.equal(scans(),0);
 await ctx.onmessage({data:{files:[],indexedSources:['missing']}});assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/索引尚未完成/);
});
test('new merge partitioning groups a small reporting week instead of splitting it by estimated cell bytes',()=>{
 const {ctx}=runtime();vm.runInContext(readFileSync('merge-worker.js','utf8').replace(/^const version=.*\n/,''),ctx);
 const values=Array.from({length:216},(_,i)=>({day:i<215?'2026-10-25':'2026-11-01',row:['x'.repeat(10000)]}));ctx.testValues=values;const ranges=vm.runInContext('partitionRows(testValues)',ctx);assert.deepEqual(JSON.parse(JSON.stringify(ranges)),[[0,215],[215,216]]);
});

test('file indexer checkpoints only after normalized rows are stored and preserves validation audit',async()=>{
 const ctx=vm.createContext({URL});ctx.self=ctx;ctx.location={href:'https://example.test/detail-index-worker.js'};
 ctx.importScripts=(...files)=>{for(const file of files)vm.runInContext(readFileSync(file.split('?')[0],'utf8'),ctx);};const messages=[];ctx.postMessage=data=>messages.push(data);vm.runInContext(readFileSync('detail-index-worker.js','utf8'),ctx);
 const calls=[],stored=[];let saved;ctx.AutoReportDetailIndex={reset:async key=>calls.push('reset:'+key),putRows:async rows=>{calls.push('rows');stored.push(...rows);},putMeta:async meta=>{calls.push('complete');saved=meta;}};
 const book=ctx.XLSX.utils.book_new();ctx.XLSX.utils.book_append_sheet(book,ctx.XLSX.utils.aoa_to_sheet([header,row('a','2026-10-25'),row('b','2026-11-01','FAIL','dust'),row('bad','2026-10-26','UNKNOWN')]),'Detail');const bytes=ctx.XLSX.write(book,{type:'array',bookType:'xlsx'}),file={name:'source.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
 await ctx.onmessage({data:{file,key:'source'}});assert.equal(messages.at(-1).type,'complete');assert.deepEqual(calls,['reset:source','rows','complete']);assert.equal(stored.length,2);assert.equal(saved.skippedRows.length,1);assert.equal(saved.dayCounts['2026-10-25'],1);assert.equal(saved.complete,true);assert.equal(messages.at(-1).meta.firstNG,undefined,'main thread only receives lightweight date metadata');
 messages.length=0;ctx.AutoReportDetailIndex.putRows=async()=>{throw Error('storage failed');};saved=null;await ctx.onmessage({data:{file,key:'source'}});assert.equal(messages.at(-1).type,'error');assert.equal(saved,null,'a failed write is never marked complete');
});
