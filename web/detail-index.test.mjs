import test from 'node:test';
import assert from 'node:assert/strict';
import {indexDetailFiles,indexKey} from './detail-index.mjs';

test('incremental date indexing scans only new or changed files and reuses indexes after reload',async()=>{
 const originalStore=globalThis.AutoReportDetailIndex,originalWorker=globalThis.Worker;
 const records=new Map(),reads=[],scans=[];
 const old={name:'old.xlsx',size:10,lastModified:1},fresh={name:'new.xlsx',size:20,lastModified:2};
 const oldMeta={key:indexKey(old,'old'),complete:true,dayCounts:{'2026-11-01':1}};
 records.set(oldMeta.key,oldMeta);const known=new Map([['old',oldMeta]]);
 globalThis.__BUILD_ID__='test';
 globalThis.AutoReportDetailIndex={meta:async key=>{reads.push(key);return records.get(key);}};
 globalThis.Worker=class {
  postMessage({file,key}){scans.push(file.name);const meta={key,complete:true,dayCounts:{'2026-11-02':1}};records.set(key,meta);queueMicrotask(()=>this.onmessage({data:{type:'complete',meta}}));}
  terminate(){}
 };
 try{
  const progress=[];
  await indexDetailFiles([old,fresh],{ids:['old','new'],knownMetas:known,onProgress:text=>progress.push(text)});
  assert.deepEqual(scans,['new.xlsx']);assert.deepEqual(reads,[indexKey(fresh,'new')]);
  assert.match(progress[0],/沿用 1.*更新 1/);
  reads.length=0;scans.length=0;
  await indexDetailFiles([old,fresh],{ids:['old','new'],knownMetas:known});
  assert.equal(reads.length,0);assert.equal(scans.length,0);
  await indexDetailFiles([old,fresh],{ids:['old','new']});
  assert.equal(scans.length,0,'persisted indexes survive a page reload');
  await indexDetailFiles([old,{...fresh,size:21,lastModified:3}],{ids:['old','new'],knownMetas:known});
  assert.deepEqual(scans,['new.xlsx'],'only the updated file is rescanned');
 }finally{globalThis.AutoReportDetailIndex=originalStore;globalThis.Worker=originalWorker;}
});
