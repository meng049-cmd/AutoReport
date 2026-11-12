import {libraryCollection,listLibraryFiles,entryFile} from './file-library.mjs';
import {periods,existingIndex,indexDetailFiles} from './detail-index.mjs';
import {getWeeklyTrendCache,saveWeeklyTrendCache} from './analysis-cache.mjs';
import {calendarBuckets} from './defect-analysis.mjs';

const DAY=86400000;
function calculate(period,sources,skipInvalidRows,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./weekly-trend-worker.js?v='+__BUILD_ID__,import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(signal.reason);};
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data})=>{cleanup();data.error?reject(Error(data.error)):resolve(data);};
  worker.onerror=()=>{cleanup();reject(Error('前一週階段資料讀取未完成。'));};
  worker.postMessage({period,sources,skipInvalidRows,stageContext:true});
 });
}
export async function attachStageWeekContext(data,context,onProgress,signal){
 const analysis=data.analysis,start=data.start_date||analysis.start_date;
 const current=calendarBuckets(start,start,'week')[0];
 const previousDay=new Date(Date.parse(current.start+'T00:00:00Z')-DAY).toISOString().slice(0,10);
 const period=periods.periodFor(previousDay,'week');
 const result={key:period.key.replace('_w','-W').replace(/_$/,''),start:period.start_date,end:period.end_date,status:'empty',products:[],sources:[]};
 const all=listLibraryFiles(),selected=new Set(context.fileIds||[]);
 const selectedSource=all.find(item=>selected.has(item.id)&&item.detail&&libraryCollection(item)!=='analysis');
 const collection=selectedSource?libraryCollection(selectedSource):'detail';
 const files=all.filter(item=>item.detail&&libraryCollection(item)===collection)
  .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 const cacheKey=JSON.stringify(['stage-week-context-v2',period,context.skipInvalidRows===true,files.map(item=>[item.id,item.name,item.size,item.lastModified,item.createdAt])]);
 if(analysis.stageWeekContext?.cacheKey===cacheKey&&analysis.stageWeekContext.status!=='error')return false;
 analysis.stageWeekContext=result;
 const sources=[];
 try{
  for(const item of files){
   signal?.throwIfAborted();
   const file=entryFile(item);
   let meta=await existingIndex(file,item.id);
   if(!meta)meta=(await indexDetailFiles([file],{ids:[item.id],onProgress,signal}))[0];
   const rows=periods.rowsIn(meta,period);
   if(rows)sources.push({id:item.id,key:meta.key,name:item.name,rows});
  }
  if(!sources.length){result.cacheKey=cacheKey;return true;}
  onProgress('正在準備 '+result.key+' 前一週階段比較資料…');
  const skipInvalidRows=context.skipInvalidRows===true;
  const key=JSON.stringify(['stage-week-context-v1',period,skipInvalidRows,sources.map(source=>source.key)]);
  let saved=await getWeeklyTrendCache(key);
  signal?.throwIfAborted();
  if(!saved){
   saved=await calculate(period,sources,skipInvalidRows,signal);
   await saveWeeklyTrendCache(key,saved,sources.map(source=>source.id));
  }
  Object.assign(result,{cacheKey,status:'ready',products:saved.stageContext.products,sources:sources.map(({name})=>({name})),skipped:saved.skipped||0});
 }catch(error){
  if(signal?.aborted)throw error;
  result.status='error';result.error=error.message;
 }
 return true;
}
