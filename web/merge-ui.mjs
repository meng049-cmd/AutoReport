import {addLibraryFile,beginFileOperation,endFileOperation} from './file-library.mjs';
import {validateDetailFiles} from './limits.mjs';
const $=id=>document.getElementById(id);
let downloadUrl,busy=false;
export function mergeFilesToBytes(files,onProgress=()=>{},options={}){
 return new Promise((resolve,reject)=>{
  try{validateDetailFiles(files);}catch(error){reject(error);return;}
  const worker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  worker.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}worker.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};
  worker.onerror=()=>{worker.terminate();reject(Error('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。'));};worker.postMessage({files,skipInvalidRows:options.skipInvalidRows===true});
 });
}
export function clearMergedDownload(){if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('mergeResult').hidden=true;$('matchedMergeResult').hidden=true;$('mergeMessage').textContent='';$('matchedMergeMessage').textContent='';for(const id of ['mergeDownload','matchedMergeDownload'])$(id).removeAttribute('href');}
export async function mergeFiles(files,{matched=false,sources=files.map(file=>({name:file.name,size:file.size,kind:'Detail'}))}={}){
 if(busy)return;clearMergedDownload();const message=(text,warning=false)=>{for(const id of matched?['mergeMessage','matchedMergeMessage']:['mergeMessage']){$(id).textContent=text;$(id).className=warning?'warn':'';}};
 try{validateDetailFiles(files);}catch(error){message(error.message,true);return;}
 if(!beginFileOperation())return;busy=true;const controls=['mergeDirect','mergeFiles','mergeMatched','match','file','libraryMerge','libraryAnalyze'],previous=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 try{const data=await mergeFilesToBytes(files,message),file=new File([data.bytes],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});await addLibraryFile(file,{kind:'merged',sources,rows:data.output_rows});downloadUrl=URL.createObjectURL(file);const link=$('mergeDownload');link.href=downloadUrl;link.download=data.filename;link.textContent='下載 '+data.filename;$('mergeStats').replaceChildren();$('mergeResult').hidden=false;if(matched){const inline=$('matchedMergeDownload');inline.href=downloadUrl;inline.download=data.filename;inline.textContent='下載合併後的 Detail：'+data.filename;$('matchedMergeResult').hidden=false;}message('合併完成，已加入檔案清單，可下載或直接分析。');}
 catch(error){message(error.message,true);}finally{busy=false;controls.forEach((id,i)=>$(id).disabled=previous[i]);endFileOperation();}
}
$('mergeDirect').onclick=()=>mergeFiles(Array.from($('mergeFiles').files));$('mergeFiles').onchange=clearMergedDownload;
