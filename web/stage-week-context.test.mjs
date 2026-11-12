import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {calendarBuckets} from './defect-analysis.mjs';
import '../period-core.js';

test('reopening a persisted dashboard skips index reads and comparison work until library inputs change',async()=>{
 const files=[{id:'source',name:'Detail.xlsx',size:100,createdAt:'2026-11-01',detail:true}],calls={reads:0,builds:0,cache:0};
 const ctx=vm.createContext({Date,JSON,calendarBuckets,periods:globalThis.AutoReportPeriods,
  libraryCollection:()=> 'detail',listLibraryFiles:()=>files,entryFile:item=>item,
  existingIndex:async()=>{calls.reads++;return {key:'indexed-source',dayCounts:{'2026-10-26':1}};},
  indexDetailFiles:async()=>{calls.builds++;throw Error('Unexpected Excel parsing');},
  getWeeklyTrendCache:async()=>{calls.cache++;return {stageContext:{products:[]}};},saveWeeklyTrendCache:async()=>{}});
 const source=readFileSync('web/stage-week-context.mjs','utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function').replaceAll('import.meta.url', '"https://example.test/"');
 vm.runInContext(source,ctx);
 const data={start_date:'2026-11-01',analysis:{}};
 assert.equal(await ctx.attachStageWeekContext(data,{},()=>{}),true);
 assert.equal(data.analysis.stageWeekContext.status,'ready');
 const restored=structuredClone(data);
 assert.equal(await ctx.attachStageWeekContext(restored,{},()=>{}),false);
 assert.deepEqual(calls,{reads:1,builds:0,cache:1});
 files.push({id:'new',name:'New.xlsx',size:200,detail:true});
 assert.equal(await ctx.attachStageWeekContext(restored,{},()=>{}),true);
 assert.equal(calls.reads,3);
});
