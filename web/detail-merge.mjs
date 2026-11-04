export function mergeDetailFiles(files,onProgress=()=>{},onFile=()=>{}){
 return new Promise((resolve,reject)=>{
  if(!Array.isArray(files)||!files.length){reject(Error('請先勾選含 Detail 分頁的檔案。'));return;}
  if(files.some(file=>!file?.name?.toLowerCase().endsWith('.xlsx')||!file.size)){reject(Error('請選擇有效的 .xlsx Detail 檔案。'));return;}
  const worker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  let settled=false;
  const fail=error=>{
   if(settled)return;
   settled=true;worker.terminate();
   reject(error instanceof Error?error:Error(String(error)));
  };
  worker.onmessage=({data})=>{
   if(data.type==='progress'){onProgress(data.message);return;}
   if(data.type==='file'){
    Promise.resolve().then(()=>onFile(data.file)).then(()=>worker.postMessage({type:'file-stored',part:data.file.part}),fail);return;
   }
   if(data.type==='error'){fail(Error(data.message));return;}
   if(data.type==='complete'){
    if(settled)return;
    settled=true;worker.terminate();resolve(data);
   }
  };
  worker.onerror=()=>fail(Error('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。'));
  worker.postMessage({files});
 });
}
