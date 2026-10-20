const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'yield-core.js'+version,'quality-core.js'+version,'threshold-core.js'+version);
self.onmessage=async({data:file})=>{try{
 self.postMessage({type:'progress',message:'正在讀取主檔並驗證 Detail…'});
 const merger=new DetailMerger(XLSX);merger.add(DetailMerger.readBook(XLSX,await file.arrayBuffer()),file.name);
 self.postMessage({type:'progress',message:'正在計算每日製程良率、前段／後段與 SMT…'});
 const analysis=analyzeQuality(merger);
 const {book,calculation,...stats}=buildYieldReport(merger,analysis.identities);applyProductStageAverage(analysis,calculation.stageChecks);
 self.postMessage({type:'progress',message:'正在分析不良歸屬、排名與總良率…'});
 appendQualitySheets(XLSX,book,analysis);
 const thresholds=buildThresholdAnalysis(merger,calculation,analysis.identities);
 stats.filename=stats.filename.replace('.xlsx','_不良分析.xlsx');
 self.postMessage({type:'progress',message:'分析完成，正在產生 Excel 下載檔…'});
 book.Workbook={...book.Workbook,Sheets:book.SheetNames.map(name=>({name,Hidden:['計算明細','Detail'].includes(name)?1:0}))};
 const bytes=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});
 self.postMessage({type:'complete',...stats,analysis,thresholds,bytes},[bytes]);
}catch(error){self.postMessage({type:'error',message:error.message||'主檔無法處理。'});}};
