import '../indexed-detail-store.js';
import '../period-core.js';
export const periods=globalThis.AutoReportPeriods;
export const indexKey=(file,id)=>JSON.stringify(['detail-index-v1',id||file.name,file.size,file.lastModified||0]);
export async function existingIndex(file,id){const meta=await globalThis.AutoReportDetailIndex.meta(indexKey(file,id));return meta?.complete?{key:meta.key,name:meta.name,size:meta.size,dayCounts:meta.dayCounts,invalidRows:meta.skippedRows?.length||0,complete:true}:null;}
export async function indexDetailFiles(files,{ids=[],onProgress=()=>{},signal}={}){
 const metas=[];
 for(let i=0;i<files.length;i++){
  signal?.throwIfAborted();const file=files[i],key=indexKey(file,ids[i]),prefix=`日期索引 ${i+1}/${files.length}：${file.name}`;
  onProgress(prefix);const saved=await existingIndex(file,ids[i]);if(saved){metas.push(saved);continue;}
  const meta=await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('../detail-index-worker.js?v='+__BUILD_ID__,import.meta.url));
   const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',cancel);};
   const cancel=()=>{cleanup();reject(Error('已取消建立日期索引；已完成的檔案會保留，下次可繼續。'));};
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
   worker.onmessage=({data})=>{if(data.type==='progress'){onProgress(prefix+'；'+data.message);return;}cleanup();data.type==='error'?reject(Error(file.name+'：'+data.message)):resolve(data.meta);};
   worker.onerror=()=>{cleanup();reject(Error(file.name+' 無法建立索引。已完成的檔案已保留；請確認該檔案可正常開啟，或重新匯出較小的 Detail 檔。'));};worker.postMessage({file,key});
  });metas.push(meta);
 }
 return metas;
}
