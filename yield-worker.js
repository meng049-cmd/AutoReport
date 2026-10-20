const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'yield-core.js'+version,'quality-core.js'+version);
self.onmessage=async({data})=>{try{
 const file=data.file||data;
 self.postMessage({type:'progress',message:'正在讀取主檔並驗證 Detail…'});
 const inputBook=DetailMerger.readBook(XLSX,await file.arrayBuffer()),merger=new DetailMerger(XLSX);merger.add(inputBook,file.name);
 self.postMessage({type:'progress',message:'正在計算每日製程與階段良率…'});
 const analysis=analyzeQuality(merger);
 analysis.sources=data.sources||[...merger.sources].map(name=>({name,kind:'Detail'}));analysis.referenceSources=data.referenceSources||[];try{const saved=JSON.parse(inputBook.Custprops?.AutoReportReferenceSources||'null');if(Array.isArray(saved)&&saved.every(name=>typeof name==='string'))analysis.referenceSources=saved;}catch{}
 const {book,calculation,...stats}=buildYieldReport(merger,analysis.identities);applyProductStageAverage(analysis,calculation.stageChecks);
 analysis.start_date=stats.start_date;analysis.end_date=stats.end_date;
 self.postMessage({type:'progress',message:'正在分析不良歸屬、排名與總良率…'});
 appendQualitySheets(XLSX,book,analysis);
 const jsonMetadata=value=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));book.Custprops.AutoReportSources=jsonMetadata(analysis.sources.map(source=>source.name));book.Custprops.AutoReportReferenceSources=jsonMetadata(analysis.referenceSources);
 stats.filename=stats.filename.replace('.xlsx','_不良分析.xlsx');
 self.postMessage({type:'progress',message:'分析完成，正在產生 Excel 下載檔…'});
 book.Workbook={...book.Workbook,Sheets:book.SheetNames.map(name=>({name,Hidden:['計算明細','Detail'].includes(name)?1:0}))};
 const bytes=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});
 self.postMessage({type:'complete',...stats,analysis,stageChecks:calculation.stageChecks,bytes},[bytes]);
}catch(error){self.postMessage({type:'error',message:error.message||'主檔無法處理。'});}};
