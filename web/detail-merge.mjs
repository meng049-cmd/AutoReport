import {validateDetailFiles} from './limits.mjs';

export function mergeDetailFiles(files,onProgress=()=>{}){
 return new Promise((resolve,reject)=>{
  try{validateDetailFiles(files);}catch(error){reject(error);return;}
  const worker=new Worker(new URL('../merge-worker.js?v='+__BUILD_ID__,import.meta.url));
  worker.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}worker.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};
  worker.onerror=()=>{worker.terminate();reject(Error('瀏覽器無法完成合併，請減少檔案或使用桌面版 Chrome／Edge。'));};
  worker.postMessage({files});
 });
}
