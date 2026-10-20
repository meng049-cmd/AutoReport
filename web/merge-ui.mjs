const $=id=>document.getElementById(id);
let downloadUrl,activeWorker;
export function mergeFilesToBytes(files,onProgress=()=>{}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  worker.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}worker.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};
  worker.onerror=()=>{worker.terminate();reject(Error('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。'));};
  worker.postMessage(files);
 });
}
export function clearMergedDownload(){
 if(downloadUrl)URL.revokeObjectURL(downloadUrl);
 downloadUrl=null;$('mergeResult').hidden=true;$('matchedMergeResult').hidden=true;$('mergeMessage').textContent='';$('matchedMergeMessage').textContent='';for(const id of ['mergeDownload','matchedMergeDownload'])$(id).removeAttribute('href');
}
export function mergeFiles(files,{matched=false}={}){
 if(activeWorker)return;
 clearMergedDownload();$('mergeMessage').className='';$('matchedMergeMessage').className='';
 function message(text,warning=false){$('mergeMessage').textContent=text;$('mergeMessage').className=warning?'warn':'';if(matched){$('matchedMergeMessage').textContent=text;$('matchedMergeMessage').className=warning?'warn':'';}}
 if(!files.length||files.length>30||files.reduce((sum,f)=>sum+f.size,0)>100*1024*1024||files.some(f=>!f.name.toLowerCase().endsWith('.xlsx'))){
  message('請選擇 1 至 30 份 .xlsx，合計 100 MB 以內。',true);return;
 }
 const controls=['mergeDirect','mergeFiles','mergeMatched','match','file'];
 const previous=controls.map(id=>$(id).disabled);
 controls.forEach(id=>$(id).disabled=true);
 function finish(){activeWorker?.terminate();activeWorker=null;controls.forEach((id,i)=>$(id).disabled=previous[i]);}
 function fail(text){message(text,true);finish();}
 try{
  activeWorker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  activeWorker.onmessage=({data})=>{
   if(data.type==='progress'){message(data.message);return;}
   if(data.type==='error'){fail(data.message);return;}
   downloadUrl=URL.createObjectURL(new Blob([data.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const link=$('mergeDownload');link.href=downloadUrl;link.download=data.filename;link.textContent='下載 '+data.filename;
   $('mergeStats').replaceChildren();
   $('mergeResult').hidden=false;
   if(matched){const inline=$('matchedMergeDownload');inline.href=downloadUrl;inline.download=data.filename;inline.textContent='下載合併後的 Detail：'+data.filename;$('matchedMergeResult').hidden=false;}
   message('合併完成，可點擊下載連結取得檔案。');finish();
  };
  activeWorker.onerror=()=>fail('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。');
  message('正在合併 Detail，完成後會顯示下載連結…');activeWorker.postMessage(files);
 }catch(error){fail(error.message);}
}
$('mergeDirect').onclick=()=>mergeFiles(Array.from($('mergeFiles').files));
$('mergeFiles').onchange=clearMergedDownload;
