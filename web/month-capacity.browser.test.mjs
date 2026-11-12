import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

test('Chromium completes a 649468-record month across four indexed sources with global PPID deduplication', {timeout:240000}, async()=>{
 const root=process.cwd();
 const server=createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const result=await page.evaluate(async()=>{
   const script=`const base=${JSON.stringify(new URL('/',location.href).href)},nativeImportScripts=self.importScripts.bind(self);self.importScripts=(...paths)=>nativeImportScripts(...paths.map(path=>new URL(path,base).href));importScripts('yield-worker.js');
const count=649468,chunk=Math.ceil(count/4),header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const processes=['DAF外觀','DAF熱壓投入','功能一測試','功能二測試','外觀檢查點亮測試','輝度機測試'];
const make=i=>{const day='2026-08-'+String(i%31+1).padStart(2,'0'),process=processes[i%6],serial='PPID'+Math.floor(i/6),fail=i===0||i===6,timestamp=(Date.parse(day+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;return {key:JSON.stringify([day,process,serial]),day,timestamp,seq:i,fail,row:[process,'WO','PART','Name',serial,timestamp,'OP',fail?'dust':'',fail?'FAIL':'GOOD','IC','Model']};};
AutoReportDetailIndex={meta:async key=>({key,name:key+'.xlsx',header,complete:true,dayCounts:{'2026-08-01':chunk},firstNG:[],analysisFirstNG:[]}),scan:async(key,period,visit)=>{const part=Number(key);for(let i=part*chunk;i<Math.min(count,(part+1)*chunk);i++)visit(make(i));if(part===3){visit(make(0));visit(make(6));}}};`;
   const worker=new Worker(URL.createObjectURL(new Blob([script],{type:'text/javascript'})));
   return await new Promise((resolve,reject)=>{
    worker.onerror=e=>{worker.terminate();reject(Error(e.message));};
    worker.onmessage=({data})=>{if(data.type==='progress')return;worker.terminate();if(data.type==='error'){reject(Error(data.message));return;}
     resolve({total:data.analysis.total,fail:data.analysis.fail,output:data.output_rows,input:data.input_rows,removed:data.removed_rows,days:data.date_count,detail:data.includes_detail,filename:data.filename,bytes:data.bytes.byteLength,attribution:data.analysis.attribution.map(row=>row.serial),timings:data.timings});};
    worker.postMessage({files:[],indexedSources:['0','1','2','3'],period:{mode:'month',key:'2026-08',start_date:'2026-08-01',end_date:'2026-08-31'}});
   });
  });
  assert.equal(result.total,Math.ceil(649468/6));assert.equal(result.fail,2);assert.equal(result.output,649468);assert.equal(result.input,649470);assert.equal(result.removed,2);assert.equal(result.days,31);assert.equal(result.detail,false);assert.equal(result.filename,'2026-08_0801-0831_不良分析.xlsx');assert.ok(result.bytes>0);assert.deepEqual(result.attribution.sort(),['PPID0','PPID1']);
  console.log(JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
