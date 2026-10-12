const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'yield-core.js'+version,'quality-core.js'+version);
self.onmessage=async({data:file})=>{try{
 self.postMessage({type:'progress',message:'正在讀取主檔並驗證 Detail…'});
 const merger=new DetailMerger(XLSX);merger.add(XLSX.read(await file.arrayBuffer(),{type:'array',dense:true}),file.name);
 self.postMessage({type:'progress',message:'正在計算每日製程良率、前段／後段與 SMT…'});
 const {book,...stats}=buildYieldReport(merger);
 self.postMessage({type:'progress',message:'正在分析不良歸屬、排名與總良率…'});
 const analysis=analyzeQuality(merger);appendQualitySheets(XLSX,book,analysis);
 stats.filename=stats.filename.replace('.xlsx','_不良分析.xlsx');
 const bytes=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});
 self.postMessage({type:'complete',...stats,analysis,bytes},[bytes]);
}catch(error){self.postMessage({type:'error',message:error.message||'主檔無法處理。'});}};
