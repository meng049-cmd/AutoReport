import {clearQuality,renderQuality} from './quality-ui.mjs';
import {getReferenceSources} from './report-context.mjs';
import {mergeFilesToBytes} from './merge-ui.mjs';
import {addLibraryFile,beginFileOperation,endFileOperation} from './file-library.mjs';
import {validateDetailFiles} from './limits.mjs';
const $=id=>document.getElementById(id);let downloadUrl,busy=false;
export function calculateYieldFile(file,onProgress=()=>{},context={}){
 return new Promise((resolve,reject)=>{const w=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));w.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}w.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};w.onerror=()=>{w.terminate();reject(Error('瀏覽器無法完成計算，請使用桌面版 Chrome／Edge 或縮小主檔。'));};w.postMessage({file,referenceSources:getReferenceSources(),...context});});
}
function clear(){clearQuality();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldDownload').removeAttribute('href');$('yieldMessage').textContent='';$('thresholdDashboard').hidden=true;}
export async function analyzeYieldFiles(files,context={}){
 if(busy)return;try{validateDetailFiles(files);}catch(error){$('yieldMessage').textContent=error.message;return;}if(!beginFileOperation())return;clear();busy=true;const controls=['yieldCalculate','yieldFile','libraryMerge','libraryAnalyze'],previous=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 const progress=text=>{$('yieldMessage').textContent=text;context.onProgress?.(text);},sources=context.sources||files.map(file=>({name:file.name,size:file.size,kind:'Detail'}));
 try{let file=files[0];if(files.length>1){progress('正在合併所選檔案…');const merged=await mergeFilesToBytes(files,progress);file=new File([merged.bytes],merged.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});await addLibraryFile(file,{kind:'merged',sources,rows:merged.output_rows});}
 const data=await calculateYieldFile(file,progress,context.sources?{sources:context.sources}:{});if(!context.fromLibrary)for(const input of files)await addLibraryFile(input,{kind:'input',sources:[{name:input.name,size:input.size,kind:'Detail'}]});const report=new File([data.bytes],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});if(context.saveReport!==false)await addLibraryFile(report,{kind:'analysis',sources:data.analysis.sources,rows:data.output_rows});downloadUrl=URL.createObjectURL(report);const link=$('yieldDownload');link.href=downloadUrl;link.download=data.filename;link.textContent='下載 '+data.filename;$('yieldMessage').textContent='分析完成，報表已加入檔案清單，可點擊下載。';renderQuality(data.analysis,data.start_date,data.end_date,data.stageChecks,{url:downloadUrl,filename:data.filename});$('yieldResult').hidden=false;
 }catch(error){progress(error.message);}finally{busy=false;controls.forEach((id,i)=>$(id).disabled=previous[i]);endFileOperation();}
}
$('yieldFile').onchange=clear;$('yieldCalculate').onclick=()=>analyzeYieldFiles(Array.from($('yieldFile').files));
