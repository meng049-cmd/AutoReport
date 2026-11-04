import {clearQuality,renderQuality} from './quality-ui.mjs';
import {getReferenceSources} from './report-context.mjs';
import {addLibraryFile,beginFileOperation,endFileOperation,listLibraryFiles} from './file-library.mjs';
import {analysisSelectionKey,getAnalysisCache,saveAnalysisCache} from './analysis-cache.mjs';
import {indexDetailFiles} from './detail-index.mjs';
import {validateYieldFiles} from './limits.mjs';
const $=id=>document.getElementById(id);let downloadUrl,busy=false,controller;
export const getYieldOptions=()=>({skipInvalidRows:$('yieldSkipErrors').getAttribute('aria-pressed')==='true'});
export function calculateYieldFile(input,onProgress=()=>{},context={}){
 const files=Array.isArray(input)?input:[input];
 const {signal,...payload}=context;
 return new Promise((resolve,reject)=>{
  try{validateYieldFiles(files);}catch(error){reject(error);return;}
  const w=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));
  const cleanup=()=>{w.terminate();signal?.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(Error('已取消分析；日期索引保留，下次可直接選擇週／月繼續。'));};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  w.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}cleanup();data.type==='error'?reject(Error(data.message)):resolve(data);};
  w.onerror=()=>{cleanup();reject(Error('本次計算未完成。已建立的日期索引保留，請改選較短期間後重試。'));};
  w.postMessage({files,...getYieldOptions(),referenceSources:getReferenceSources(),...payload});
 });
}
function clear(){clearQuality();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldDownload').removeAttribute('href');$('yieldMessage').textContent='';$('thresholdDashboard').hidden=true;}
function showReport(data,blob,filename,progress,message){downloadUrl=URL.createObjectURL(blob);const link=$('yieldDownload');link.href=downloadUrl;link.download=filename;link.textContent='下載 '+filename;progress(message+(data.skipped_rows?' 已略過 '+data.skipped_rows+' 列錯誤資料，詳見報表。':''));renderQuality(data.analysis,data.start_date,data.end_date,data.stageChecks,{url:downloadUrl,filename});$('yieldResult').hidden=false;}
export async function analyzeYieldFiles(files,context={}){
 const progress=text=>{$('yieldMessage').textContent=text;context.onProgress?.(text);};
 if(busy)return;try{validateYieldFiles(files);}catch(error){progress(error.message);return;}if(!beginFileOperation())return;clear();busy=true;controller=new AbortController();$('yieldCancel').hidden=false;const controls=['yieldCalculate','yieldFile','yieldSkipErrors','libraryAnalyze'],previous=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 const options={...getYieldOptions(),...(context.skipInvalidRows===undefined?{}:{skipInvalidRows:context.skipInvalidRows}),period:context.period||null},sources=context.sources||files.map(file=>({name:file.name,size:file.size,kind:'Detail'})),selectionKey=analysisSelectionKey(context.fileIds,options,sources,getReferenceSources());
 try{
  const entries=new Map(listLibraryFiles().map(item=>[item.id,item])),single=context.fileIds?.length===1?entries.get(context.fileIds[0]):null,reportId=context.reportId||(single?.kind==='analysis'?single.id:null);
  progress('正在載入分析結果…');const cached=await getAnalysisCache({reportId,selectionKey});const cachedFile=cached&&entries.get(cached.reportId);
  if(cachedFile){showReport(cached.data,cached.downloadBlob||cachedFile.blob,cached.data.filename,progress,'已開啟已儲存的分析結果。');return;}
  if(context.reportId&&entries.get(context.reportId)?.detail===false)throw Error('此為期間彙總報表，完整 Detail 保留在來源檔案庫。看板快取已不存在，請回來源檔案庫依相同週／月重新分析。');
  let indexedSources;
  if(options.period||files.length>30||files.reduce((sum,file)=>sum+file.size,0)>100*1024*1024){
   const metas=await indexDetailFiles(files,{ids:context.fileIds,onProgress:progress,signal:controller.signal});indexedSources=metas.map(meta=>meta.key);
  }
  const data=await calculateYieldFile(files,progress,{...options,indexedSources,signal:controller.signal,includeMerged:false,...(context.sources?{sources:context.sources}:{})});
  const report=new File([data.bytes],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});let savedId=context.reportId;
  if(context.saveReport!==false){const entry=await addLibraryFile(report,{kind:'analysis',detail:data.includes_detail!==false,sources:data.analysis.sources,rows:data.output_rows});savedId=entry.id;}
  let cachedPersistently=true;if(savedId){progress('正在儲存分析快取…');cachedPersistently=await saveAnalysisCache(savedId,data,{selectionKey,inputIds:context.fileIds,downloadBlob:context.saveReport===false?report:undefined});}
  showReport(data,report,data.filename,progress,context.saveReport===false?'看板已開啟。':'分析完成，報表已加入檔案清單，可點擊下載。'+(cachedPersistently?'':' 看板快取僅保留於本次分頁，請保留來源檔案以便重算。'));
 }catch(error){progress(error.message);}finally{busy=false;controller=null;$('yieldCancel').hidden=true;controls.forEach((id,i)=>$(id).disabled=previous[i]);endFileOperation();}
}
$('yieldFile').onchange=clear;$('yieldCalculate').onclick=()=>analyzeYieldFiles(Array.from($('yieldFile').files));
$('yieldSkipErrors').onclick=()=>{const enabled=!getYieldOptions().skipInvalidRows;$('yieldSkipErrors').setAttribute('aria-pressed',String(enabled));$('yieldSkipErrors').textContent='略過錯誤列（測試）：'+(enabled?'開':'關');};

$('yieldCancel').onclick=()=>controller?.abort();
