import {clearQuality,renderQuality} from './quality-ui.mjs';
import {getReferenceSources} from './report-context.mjs';
import {addLibraryFile,beginFileOperation,endFileOperation,listLibraryFiles} from './file-library.mjs';
import {analysisSelectionKey,getAnalysisCache,saveAnalysisCache} from './analysis-cache.mjs';
import {validateDetailFiles} from './limits.mjs';
const $=id=>document.getElementById(id);let downloadUrl,busy=false;
export const getYieldOptions=()=>({skipInvalidRows:$('yieldSkipErrors').getAttribute('aria-pressed')==='true'});
export function calculateYieldFile(input,onProgress=()=>{},context={}){
 const files=Array.isArray(input)?input:[input];
 return new Promise((resolve,reject)=>{try{validateDetailFiles(files);}catch(error){reject(error);return;}const w=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));w.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}w.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};w.onerror=()=>{w.terminate();reject(Error('瀏覽器無法完成計算，請使用桌面版 Chrome／Edge 或縮小主檔。'));};w.postMessage({files,...getYieldOptions(),referenceSources:getReferenceSources(),...context});});
}
function clear(){clearQuality();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldDownload').removeAttribute('href');$('yieldMessage').textContent='';$('thresholdDashboard').hidden=true;}
function showReport(data,blob,filename,progress,message){downloadUrl=URL.createObjectURL(blob);const link=$('yieldDownload');link.href=downloadUrl;link.download=filename;link.textContent='下載 '+filename;progress(message+(data.skipped_rows?' 已略過 '+data.skipped_rows+' 列錯誤資料，詳見報表。':''));renderQuality(data.analysis,data.start_date,data.end_date,data.stageChecks,{url:downloadUrl,filename});$('yieldResult').hidden=false;}
export async function analyzeYieldFiles(files,context={}){
 const progress=text=>{$('yieldMessage').textContent=text;context.onProgress?.(text);};
 if(busy)return;try{validateDetailFiles(files);}catch(error){progress(error.message);return;}if(!beginFileOperation())return;clear();busy=true;const controls=['yieldCalculate','yieldFile','yieldSkipErrors','libraryMerge','libraryAnalyze'],previous=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 const options={...getYieldOptions(),...(context.skipInvalidRows===undefined?{}:{skipInvalidRows:context.skipInvalidRows})},sources=context.sources||files.map(file=>({name:file.name,size:file.size,kind:'Detail'})),selectionKey=analysisSelectionKey(context.fileIds,options,sources,getReferenceSources());
 try{
  const entries=new Map(listLibraryFiles().map(item=>[item.id,item])),single=context.fileIds?.length===1?entries.get(context.fileIds[0]):null,reportId=context.reportId||(single?.kind==='analysis'?single.id:null);
  progress('正在載入分析結果…');const cached=await getAnalysisCache({reportId,selectionKey});const cachedFile=cached&&entries.get(cached.reportId);
  if(cachedFile){showReport(cached.data,cached.downloadBlob||cachedFile.blob,cached.data.filename,progress,'已開啟已儲存的分析結果。');return;}
  const data=await calculateYieldFile(files,progress,{...options,includeMerged:files.length>1,...(context.sources?{sources:context.sources}:{})});
  if(data.merged)await addLibraryFile(new File([data.merged.bytes],data.merged.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),{kind:'merged',collection:'analysis',sources,rows:data.merged.output_rows});
  if(!context.fromLibrary)for(const input of files)await addLibraryFile(input,{kind:'input',sources:[{name:input.name,size:input.size,kind:'Detail'}]});
  const report=new File([data.bytes],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});let savedId=context.reportId;
  if(context.saveReport!==false){const entry=await addLibraryFile(report,{kind:'analysis',sources:data.analysis.sources,rows:data.output_rows});savedId=entry.id;}
  if(savedId)void saveAnalysisCache(savedId,data,{selectionKey,inputIds:context.fileIds,downloadBlob:context.saveReport===false?report:undefined});
  showReport(data,report,data.filename,progress,context.saveReport===false?'看板已開啟。':'分析完成，報表已加入檔案清單，可點擊下載。');
 }catch(error){progress(error.message);}finally{busy=false;controls.forEach((id,i)=>$(id).disabled=previous[i]);endFileOperation();}
}
$('yieldFile').onchange=clear;$('yieldCalculate').onclick=()=>analyzeYieldFiles(Array.from($('yieldFile').files));
$('yieldSkipErrors').onclick=()=>{const enabled=!getYieldOptions().skipInvalidRows;$('yieldSkipErrors').setAttribute('aria-pressed',String(enabled));$('yieldSkipErrors').textContent='略過錯誤列（測試）：'+(enabled?'開':'關');};
