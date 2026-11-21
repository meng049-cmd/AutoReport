import '../browser-storage.js';
import {clearQuality,renderQuality} from './quality-ui.mjs';
import {getReferenceSources} from './report-context.mjs';
import {addLibraryFile,beginFileOperation,endFileOperation,listLibraryFiles,entryFile} from './file-library.mjs';
import {analysisSelectionKey,getAnalysisCache,saveAnalysisCache} from './analysis-cache.mjs';
import {indexDetailFiles} from './detail-index.mjs';
import {validateYieldFiles} from './limits.mjs';
import {attachStageWeekContext} from './stage-week-context.mjs';
const $=id=>document.getElementById(id);let downloadUrl,busy=false,controller;
export const getYieldOptions=()=>({skipInvalidRows:$('yieldSkipErrors').getAttribute('aria-pressed')==='true'});
export function calculateYieldFile(input,onProgress=()=>{},context={}){
 const files=Array.isArray(input)?input:[input];
 const {signal,...payload}=context;
 return new Promise((resolve,reject)=>{
  try{validateYieldFiles(files);}catch(error){reject(error);return;}
  const w=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));
  const cleanup=()=>{w.terminate();signal?.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(Error('已取消分析；日期索引保留，下次可直接選擇日／週／月起訖範圍繼續。'));};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  w.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}cleanup();data.type==='error'?reject(Error(data.message)):resolve(data);};
  w.onerror=()=>{cleanup();reject(Error('本次計算未完成。已建立的日期索引保留，請改選較短期間後重試。'));};
  w.postMessage({files,...getYieldOptions(),referenceSources:getReferenceSources(),...payload});
 });
}
function clear(){clearQuality();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldDownload').removeAttribute('href');$('yieldMessage').textContent='';$('thresholdDashboard').hidden=true;}
async function showReport(data,blob,filename,progress,message,context){downloadUrl=URL.createObjectURL(blob);const link=$('yieldDownload');link.href=downloadUrl;link.download=filename;link.textContent='下載 '+filename;progress(message+(data.skipped_rows?' 已略過 '+data.skipped_rows+' 列錯誤資料，詳見報表。':''));const corrections=data.analysis.workOrderCorrections||[],updated=$('yieldOrderCorrections');updated.hidden=!corrections.length;updated.textContent=corrections.length?`已套用 ${corrections.length} 組工單對照，IC、機種及產品系列請見 Excel「工單對照修改」工作表。`:'';renderQuality(data.analysis,data.start_date,data.end_date,data.stageChecks,{url:downloadUrl,filename});$('yieldResult').hidden=false;if(context.downloadReport)$('qualityReportDownload').click();}
export async function analyzeYieldFiles(files,context={}){
 const progress=text=>{$('yieldMessage').textContent=text;context.onProgress?.(text);};
 if(busy)return;try{validateYieldFiles(files);}catch(error){progress(error.message);return;}if(!beginFileOperation())return;clear();busy=true;controller=new AbortController();$('yieldCancel').hidden=false;const controls=['yieldCalculate','yieldCalculateUpload','yieldFile','yieldSkipErrors','libraryAnalyze'],previous=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 let options={...getYieldOptions(),...(context.skipInvalidRows===undefined?{}:{skipInvalidRows:context.skipInvalidRows}),period:context.period||null};
 const sources=context.sources||files.map(file=>({name:file.name,size:file.size,kind:'Detail'})),selectionKey=analysisSelectionKey(context.fileIds,options,sources,getReferenceSources());
 try{
  const entries=new Map(listLibraryFiles().map(item=>[item.id,item])),single=context.fileIds?.length===1?entries.get(context.fileIds[0]):null,reportId=context.reportId||(single?.kind==='analysis'?single.id:null);
  progress('正在載入分析結果…');
  const database=await globalThis.readBrowserDatabase();
  const corrections=database?.reference?.manual_corrections||[];
  const correctionRevision=corrections.length?JSON.stringify(corrections):undefined;
  const cached=await getAnalysisCache({reportId,selectionKey});
  const savedReport=reportId?entries.get(reportId):null,cachedFile=cached&&entries.get(cached.reportId);
  if(cachedFile&&cached.correctionRevision===correctionRevision){
   const changed=await attachStageWeekContext(cached.data,{...getYieldOptions(),...context},progress,controller.signal);
   if(changed)await saveAnalysisCache(cached.reportId,cached.data,{downloadBlob:cached.downloadBlob,correctionRevision});
   await showReport(cached.data,cached.downloadBlob||cachedFile.blob,cached.data.filename,progress,'已開啟已儲存的分析結果。',context);return;
  }
  let inputIds=context.fileIds,indexedSources;
  let inputs=savedReport?.analysisInputs;
  if(savedReport&&!inputs&&savedReport.detail===false){
   const sourceNames=(cached?.data?.analysis?.sources||savedReport.sources||[]).map(source=>source.name);
   const available=[...entries.values()].filter(entry=>entry.detail&&entry.kind!=='analysis');
   const matches=sourceNames.map(name=>available.filter(entry=>entry.name===name));
   const period=cached?.data?.analysis?.period;
   if(cached?.data?.analysis&&matches.length&&matches.every(match=>match.length===1)){
    inputs={ids:matches.map(([entry])=>entry.id),options:{...options,period},sources:savedReport.sources};
   }
  }
  if(savedReport?.detail===false&&!inputs)throw Error('找不到此舊報表的原始 Detail 或期間資料。請從檔案庫選取原始 Detail 和相同期間，重新產生報表。');
  if(inputs){
   options=inputs.options;inputIds=inputs.ids;
   if(inputIds?.length){
    const originals=inputIds.map(id=>entries.get(id));
    if(originals.some(entry=>!entry))throw Error('原始 Detail 已從檔案庫移除，請重新匯入來源檔案後再分析。');
    files=originals.map(entryFile);
   }else files=inputs.files;
  }
  validateYieldFiles(files);
  if(!savedReport||inputs){
   const metas=await indexDetailFiles(files,{ids:inputIds,onProgress:progress,signal:controller.signal});indexedSources=metas.map(meta=>meta.key);
  }
  const reportSources=inputs?.sources||context.sources;
  const data=await calculateYieldFile(files,progress,{...options,indexedSources,signal:controller.signal,includeMerged:false,...(reportSources?{sources:reportSources}:{})});
  const report=new File([data.bytes],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});let savedId=reportId;
  if((!savedReport&&context.saveReport!==false)||(savedReport&&(correctionRevision!==undefined||cached?.correctionRevision!==undefined))){
   const analysisInputs=inputs||(!savedReport?{ids:inputIds,files:inputIds?.length?undefined:files,options,sources:data.analysis.sources}:undefined);
   const entry=await addLibraryFile(report,{kind:'analysis',detail:data.includes_detail!==false,sources:data.analysis.sources,rows:data.output_rows,replaceId:reportId,analysisInputs});savedId=entry.id;
  }
  await attachStageWeekContext(data,{...context,...options},progress,controller.signal);
  let cachedPersistently=true;if(savedId){progress('正在儲存分析快取…');cachedPersistently=await saveAnalysisCache(savedId,data,{selectionKey,inputIds,correctionRevision,downloadBlob:report});}
  await showReport(data,report,data.filename,progress,context.saveReport===false?'看板已開啟。':'分析完成，報表已加入檔案清單，可點擊下載。'+(cachedPersistently?'':' 看板快取僅保留於本次分頁，請保留來源檔案以便重算。'),context);
 }catch(error){progress(error.message);}finally{busy=false;controller=null;$('yieldCancel').hidden=true;controls.forEach((id,i)=>$(id).disabled=previous[i]);endFileOperation();}
}
$('yieldFile').onchange=clear;$('yieldCalculateUpload').onclick=()=>analyzeYieldFiles(Array.from($('yieldFile').files));
$('yieldSkipErrors').onclick=()=>{const enabled=!getYieldOptions().skipInvalidRows;$('yieldSkipErrors').setAttribute('aria-pressed',String(enabled));$('yieldSkipErrors').textContent='略過錯誤列（測試）：'+(enabled?'開':'關');};

$('yieldCancel').onclick=()=>controller?.abort();
