const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'merge-core.js'+version,'yield-core.js'+version,'quality-core.js'+version,'report-sheets.js'+version,'indexed-detail-store.js'+version,'period-core.js'+version);
self.onmessage=async({data})=>{try{
 const files=data.files||[data.file||data],merger=new DetailMerger(XLSX,{skipInvalidRows:data.skipInvalidRows===true}),started=performance.now(),timings={};let inputBook;
 const period=data.period||null,indexed=Array.isArray(data.indexedSources);
 if(period)AutoReportPeriods.validateRange(period);
 if(indexed){
  let rowCount=0,maxFileRows=0;for(const key of data.indexedSources){const meta=await AutoReportDetailIndex.meta(key);if(!meta?.complete)throw Error('日期索引尚未完成，請重新建立索引。');const count=AutoReportPeriods.rowsIn(meta,period);rowCount+=count;maxFileRows=Math.max(maxFileRows,count);}
  if(maxFileRows>300000)throw Error(`此期間包含 ${rowCount.toLocaleString()} 筆索引資料，超出本瀏覽器單次安全分析容量。請改選較短期間（例如由月改為週）；已完成的日期索引會保留。`);
  for(let i=0;i<data.indexedSources.length;i++){
   const key=data.indexedSources[i],meta=await AutoReportDetailIndex.meta(key);self.postMessage({type:'progress',message:`正在載入期間資料 ${i+1}/${data.indexedSources.length}：${meta.name}`});
   merger.prepareIndexed(meta,period);await AutoReportDetailIndex.scan(key,period,value=>{merger.addIndexed(value);if(merger.rows.size>300000)throw Error('此期間去重後仍超過 30 萬筆過站紀錄，已停止載入以保護瀏覽器。請改選較短期間；已完成的日期索引會保留。');});merger.completeIndexed();
  }
 }else{for(let i=0;i<files.length;i++){const file=files[i];self.postMessage({type:'progress',message:`正在讀取並驗證 ${i+1}/${files.length}：${file.name}`});inputBook=DetailMerger.readBook(XLSX,await file.arrayBuffer());merger.add(inputBook,file.name);}}

 timings.read=performance.now()-started;let phase=performance.now();
 self.postMessage({type:'progress',message:'正在計算每日製程與階段良率…'});
 const analysis=analyzeQuality(merger);analysis.skippedRows=merger.skippedRows;
 timings.quality=performance.now()-phase;phase=performance.now();
 analysis.sources=data.sources||[...merger.sources].map(name=>({name,kind:'Detail'}));analysis.referenceSources=data.referenceSources||[];try{const saved=files.length===1?JSON.parse(inputBook?.Custprops?.AutoReportReferenceSources||'null'):null;if(Array.isArray(saved)&&saved.every(name=>typeof name==='string'))analysis.referenceSources=saved;}catch{}inputBook=null;
 const {book,calculation,...stats}=buildYieldReport(merger,analysis.identities,{includeDetail:!indexed,period});applyProductPPIDYield(analysis);
 if(indexed){merger.rows.clear();merger.defectKeys.clear();merger.firstNG.clear();merger.analysisFirstNG.clear();analysis.identities.clear();}
 analysis.period=period;stats.includes_detail=!indexed;
 analysis.start_date=stats.start_date;analysis.end_date=stats.end_date;
 stats.skipped_rows=merger.skippedRows.length;
 timings.daily=performance.now()-phase;phase=performance.now();
 self.postMessage({type:'progress',message:'正在分析不良歸屬、排名與總良率…'});
 appendQualitySheets(XLSX,book,analysis);
 timings.sheets=performance.now()-phase;
 const jsonMetadata=value=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));book.Custprops.AutoReportSources=jsonMetadata(analysis.sources.map(source=>source.name));book.Custprops.AutoReportReferenceSources=jsonMetadata(analysis.referenceSources);
 // Analysis does not create an intermediate merged workbook.
 stats.filename=period?`${period.key.replace(/_$/,'')}_${period.start_date}-${period.end_date}_不良分析.xlsx`:stats.filename.replace('.xlsx','_不良分析.xlsx');
 if(indexed){book.Custprops.AutoReportPeriod=JSON.stringify(period);XLSX.utils.sheet_add_aoa(book.Sheets['統計說明'],[['期間分析','以選定日／週／月起訖範圍內資料統一去重及判定首次不良，逐日計算每日良率；完整 Detail 保留在來源檔案庫，本報表只輸出統計與必要不良明細。']],{origin:-1});}
 self.postMessage({type:'progress',message:'分析完成，正在產生 Excel 下載檔…'});
 book.Workbook={...book.Workbook,Sheets:book.SheetNames.map(name=>({name,Hidden:(['計算明細','階段計算明細'].includes(name)||/^Detail(?:_\d+)?$/.test(name))?1:0}))};
 splitReportSheets(XLSX,book);phase=performance.now();const bytes=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});timings.reportWrite=performance.now()-phase;timings.total=performance.now()-started;
 self.postMessage({type:'complete',...stats,analysis,stageChecks:calculation.stageChecks,bytes,timings},[bytes]);
}catch(error){self.postMessage({type:'error',message:error.message||'主檔無法處理。'});}};
