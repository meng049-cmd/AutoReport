const $=id=>document.getElementById(id);
let downloadUrl,activeWorker;
export function clearMergedDownload(){
 if(downloadUrl)URL.revokeObjectURL(downloadUrl);
 downloadUrl=null;$('mergeResult').hidden=true;$('mergeMessage').textContent='';
}
export function mergeFiles(files){
 if(activeWorker)return;
 clearMergedDownload();$('mergeMessage').className='';
 if(!files.length||files.length>30||files.reduce((sum,f)=>sum+f.size,0)>100*1024*1024||files.some(f=>!f.name.toLowerCase().endsWith('.xlsx'))){
  $('mergeMessage').className='warn';$('mergeMessage').textContent='請選擇 1 至 30 份 .xlsx，合計 100 MB 以內。';return;
 }
 const controls=['mergeDirect','mergeFiles','mergeMatched','match','file'];
 const previous=controls.map(id=>$(id).disabled);
 controls.forEach(id=>$(id).disabled=true);
 function finish(){activeWorker?.terminate();activeWorker=null;controls.forEach((id,i)=>$(id).disabled=previous[i]);}
 function fail(message){$('mergeMessage').className='warn';$('mergeMessage').textContent=message;finish();}
 try{
  activeWorker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  activeWorker.onmessage=({data})=>{
   if(data.type==='progress'){$('mergeMessage').textContent=data.message;return;}
   if(data.type==='error'){fail(data.message);return;}
   downloadUrl=URL.createObjectURL(new Blob([data.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const link=$('mergeDownload');link.href=downloadUrl;link.download=data.filename;link.textContent='下載 '+data.filename;
   const stats=$('mergeStats');stats.replaceChildren();
   for(const [label,value] of [['原始筆數',data.input_rows],['移除重複',data.removed_rows],['保留筆數',data.output_rows]]){
    const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=value.toLocaleString();const span=document.createElement('span');span.textContent=label;div.append(strong,span);stats.append(div);
   }
   $('mergeResult').hidden=false;$('mergeMessage').textContent=`合併完成：${data.start_date} 至 ${data.end_date}。點選下方連結下載。`;finish();
  };
  activeWorker.onerror=()=>fail('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。');
  activeWorker.postMessage(files);
 }catch(error){fail(error.message);}
}
$('mergeDirect').onclick=()=>mergeFiles(Array.from($('mergeFiles').files));
$('mergeFiles').onchange=clearMergedDownload;
