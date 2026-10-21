const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'yield-core.js'+version,'quality-core.js'+version);
self.onmessage=async({data})=>{try{
 const files=data.files||[data.file||data],merger=new DetailMerger(XLSX,{skipInvalidRows:data.skipInvalidRows===true}),started=performance.now(),timings={};let inputBook;
 for(let i=0;i<files.length;i++){const file=files[i];self.postMessage({type:'progress',message:`正在讀取並驗證 ${i+1}/${files.length}：${file.name}`});inputBook=DetailMerger.readBook(XLSX,await file.arrayBuffer());merger.add(inputBook,file.name);}
 timings.read=performance.now()-started;let phase=performance.now();
 self.postMessage({type:'progress',message:'正在計算每日製程與階段良率…'});
 const analysis=analyzeQuality(merger);analysis.skippedRows=merger.skippedRows;
 timings.quality=performance.now()-phase;phase=performance.now();
 analysis.sources=data.sources||[...merger.sources].map(name=>({name,kind:'Detail'}));analysis.referenceSources=data.referenceSources||[];try{const saved=files.length===1?JSON.parse(inputBook.Custprops?.AutoReportReferenceSources||'null'):null;if(Array.isArray(saved)&&saved.every(name=>typeof name==='string'))analysis.referenceSources=saved;}catch{}inputBook=null;
 const {book,calculation,...stats}=buildYieldReport(merger,analysis.identities);applyProductStageAverage(analysis,calculation.stageChecks);
 analysis.start_date=stats.start_date;analysis.end_date=stats.end_date;
 stats.skipped_rows=merger.skippedRows.length;
 timings.daily=performance.now()-phase;phase=performance.now();
 self.postMessage({type:'progress',message:'正在分析不良歸屬、排名與總良率…'});
 appendQualitySheets(XLSX,book,analysis);
 timings.sheets=performance.now()-phase;
 const jsonMetadata=value=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));book.Custprops.AutoReportSources=jsonMetadata(analysis.sources.map(source=>source.name));book.Custprops.AutoReportReferenceSources=jsonMetadata(analysis.referenceSources);
 let merged;if(data.includeMerged){self.postMessage({type:'progress',message:'正在儲存合併 Detail…'});phase=performance.now();const mergedBook=XLSX.utils.book_new();mergedBook.Custprops=book.Custprops;XLSX.utils.book_append_sheet(mergedBook,book.Sheets.Detail,'Detail');const bytes=XLSX.write(mergedBook,{bookType:'xlsx',type:'array',compression:true});merged={filename:stats.filename.replace('_每日良率.xlsx','.xlsx'),bytes,output_rows:stats.output_rows};timings.mergedWrite=performance.now()-phase;}
 stats.filename=stats.filename.replace('.xlsx','_不良分析.xlsx');
 self.postMessage({type:'progress',message:'分析完成，正在產生 Excel 下載檔…'});
 book.Workbook={...book.Workbook,Sheets:book.SheetNames.map(name=>({name,Hidden:['計算明細','Detail'].includes(name)?1:0}))};
 phase=performance.now();const bytes=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});timings.reportWrite=performance.now()-phase;timings.total=performance.now()-started;
 self.postMessage({type:'complete',...stats,analysis,stageChecks:calculation.stageChecks,bytes,merged,timings},merged?[bytes,merged.bytes]:[bytes]);
}catch(error){self.postMessage({type:'error',message:error.message||'主檔無法處理。'});}};
