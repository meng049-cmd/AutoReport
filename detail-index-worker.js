const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'indexed-detail-store.js'+version);
self.onmessage=async({data:{file,key}})=>{try{
 const store=AutoReportDetailIndex;await store.reset(key);
 const merger=new DetailMerger(XLSX,{skipInvalidRows:true});
 self.postMessage({type:'progress',message:'正在解析 Detail…'});
 merger.add(DetailMerger.readBook(XLSX,await file.arrayBuffer()),file.name);
 const dayCounts={},header=merger.header.slice(0,11);let batch=[],seq=0;
 for(const value of merger.rows.values()){
  dayCounts[value.day]=(dayCounts[value.day]||0)+1;
  batch.push({source:key,day:value.day,seq:seq++,row:value.row.slice(0,11),timestamp:value.timestamp,key:value.key,fail:merger.hasDefect(value)});
  if(batch.length===2000){await store.putRows(batch);batch=[];self.postMessage({type:'progress',message:`已建立 ${seq.toLocaleString()} 筆索引…`});}
 }
 if(batch.length)await store.putRows(batch);
 const meta={key,name:file.name,size:file.size,header,dayCounts,invalidRows:merger.skippedRows.length,firstNG:[...merger.firstNG.values()],analysisFirstNG:[...merger.analysisFirstNG.values()],sources:[...merger.sources],skippedRows:merger.skippedRows,complete:true};
 await store.putMeta(meta);self.postMessage({type:'complete',meta:{key:meta.key,name:meta.name,size:meta.size,dayCounts:meta.dayCounts,invalidRows:meta.invalidRows,complete:true}});
}catch(error){self.postMessage({type:'error',message:error.name==='QuotaExceededError'?'本機儲存空間不足，日期索引尚未完成。請釋放空間後重試；已完成的索引會保留。':error.message||'日期索引建立失敗。'});}};
