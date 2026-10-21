(function(root){
'use strict';
function analyzeQuality(merger){
 const products=new Map(),units=new Map(),processes=new Map(),productProcesses=new Map(),identityConflicts=[];
 const processName=value=>root.canonicalProcess?root.canonicalProcess(value):String(value).trim().replace(/\s+/g,'')==='DAF外觀檢查'?'DAF外觀':String(value).trim().replace(/\s+/g,'');
 const addProcess=(map,key,unit,fail,meta)=>{const item=map.get(key)||{...meta,units:new Map()};item.units.set(unit,Boolean(item.units.get(unit)||fail));map.set(key,item);};
 for(const value of merger.rows.values()){
  const row=value.row,ic=String(row[9]??'').trim(),model=String(row[10]??'').trim();
  if(!root.isAnalysisProcess(row[0]))continue;
  const serial=String(row[4]).trim(),process=processName(row[0]);
  const fail=merger.hasDefect(value);
  const unit=units.get(serial)||{serial,fail:false,primary:null,defectObservations:0,mappings:new Map(),processes:new Map(),records:0};
  unit.mappings.set(JSON.stringify([ic,model]),{ic,model});unit.records++;
  if(fail){unit.fail=true;unit.defectObservations++;if(!unit.primary||value.timestamp<unit.primary.timestamp)unit.primary={timestamp:value.timestamp,date:value.day,process,defect:String(row[7]??'').trim()||'【未填不良項目】',order:String(row[1]??'').trim(),status:root.normalizeDetailStatus(row[merger.status])};}
  unit.processes.set(process,Boolean(unit.processes.get(process)||fail));units.set(serial,unit);
  addProcess(processes,process,serial,fail,{process});
 }
 for(const unit of units.values()){
  const first=merger.analysisFirstNG?.get(unit.serial);
  if(first){unit.fail=true;unit.primary={timestamp:first.timestamp,date:first.date,process:processName(first.process),defect:first.defect,status:first.status,order:first.order||''};}
  const mappings=[...unit.mappings.values()],ics=[...new Set(mappings.map(m=>m.ic).filter(Boolean))],models=[...new Set(mappings.map(m=>m.model).filter(Boolean))];
  const conflict=ics.length>1||models.length>1;
  const ic=conflict?'【產品對照衝突】':ics[0]||'',model=conflict?'【待確認機種】':models[0]||'',product=JSON.stringify([ic,model]);unit.product=product;
  if(conflict)identityConflicts.push({serial:unit.serial,mappings,records:unit.records});
  if(!products.has(product))products.set(product,{id:product,ic:ic||'【待補 IC】',model:model||'【待補機種】',pending:conflict||!ic||!model,units:new Set()});
  products.get(product).units.add(unit.serial);
  for(const [process,fail] of unit.processes)addProcess(productProcesses,JSON.stringify([product,process]),unit.serial,fail,{product,process});
 }
 const globalTotal=units.size,globalFail=[...units.values()].filter(u=>u.fail).length;
 const globalDefects=new Map(),productDefects=new Map(),attribution=[];
 for(const unit of units.values())if(unit.fail){
  const {process,defect,date}=unit.primary,p=products.get(unit.product);
  const key=JSON.stringify([process,defect]),pk=JSON.stringify([unit.product,process,defect]);
  const increment=(map,key,meta)=>{const value=map.get(key)||{...meta,count:0};value.count++;map.set(key,value);};
  increment(globalDefects,key,{process,defect});increment(productDefects,pk,{product:unit.product,process,defect});
  attribution.push({ic:p.ic,model:p.model,product:unit.product,serial:unit.serial,date,process,defect,timestamp:unit.primary.timestamp,status:unit.primary.status,order:unit.primary.order||'',defectObservations:unit.defectObservations});
 }
 const observations=[],dailyProcessUnits=new Map(),dailyProductUnits=new Map();for(const value of merger.rows.values()){if(!root.isAnalysisProcess(value.row[0]))continue;const serial=String(value.row[4]).trim(),unit=units.get(serial);if(!unit)continue;const process=processName(value.row[0]),key=JSON.stringify([unit.product,value.day,process]);observations.push({serial,product:unit.product,date:value.day,process,order:String(value.row[1]??'').trim(),fail:merger.hasDefect(value)});const processUnits=dailyProcessUnits.get(key)||new Set();processUnits.add(serial);dailyProcessUnits.set(key,processUnits);const dailyKey=JSON.stringify([unit.product,value.day]),set=dailyProductUnits.get(dailyKey)||new Set();set.add(serial);dailyProductUnits.set(dailyKey,set);}
 // Preserve the authentic work order of first-NG evidence even when its visible merge row won under another order.
 const observedKeys=new Set(observations.map(row=>JSON.stringify([row.serial,row.date,row.process,row.order])));
 for(const row of attribution)if(!observedKeys.has(JSON.stringify([row.serial,row.date,row.process,row.order])))observations.push({serial:row.serial,product:row.product,date:row.date,process:row.process,order:row.order,fail:true,attributionOnly:true});
 const orderGroups=new Map(),orderGroup=(order,product)=>{const key=JSON.stringify([order,product]);if(!orderGroups.has(key)){const p=products.get(product);orderGroups.set(key,{order:order||'【未填工單】',product,ic:p.ic,model:p.model,units:new Set(),bad:new Set(),dates:new Set()});}return orderGroups.get(key);};
 for(const row of observations){const group=orderGroup(row.order,row.product);group.units.add(row.serial);group.dates.add(row.date);}
 for(const row of attribution){const group=orderGroup(row.order,row.product);group.units.add(row.serial);group.bad.add(row.serial);}
 const orders=[...orderGroups.values()].map(group=>{const total=group.units.size,fail=group.bad.size,dates=[...group.dates].sort();return {order:group.order,product:group.product,ic:group.ic,model:group.model,total,good:total-fail,fail,yield:total?(total-fail)/total:null,badRate:total?fail/total:null,start:dates[0],end:dates.at(-1)};}).sort((a,b)=>b.fail-a.fail||a.order.localeCompare(b.order)||a.model.localeCompare(b.model));
 const dailyProcessTotals=new Map([...dailyProcessUnits].map(([key,set])=>[key,set.size])),dailyProductTotals=new Map([...dailyProductUnits].map(([key,set])=>[key,set.size]));
 const ranking=(items,total)=>items.sort((a,b)=>b.count-a.count||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect)).map((r,index)=>({...r,rank:index+1,total,rate:total?r.count/total:0}));
 const productRows=[...products.values()].map(p=>{
  const total=p.units.size,fail=[...p.units].filter(key=>units.get(key).fail).length;
  return {id:p.id,ic:p.ic,model:p.model,pending:p.pending,total,good:total-fail,fail,yield:total?(total-fail)/total:0,badRate:total?fail/total:0,contribution:globalTotal?fail/globalTotal:0,defects:ranking([...productDefects.values()].filter(d=>d.product===p.id),total)};
 }).sort((a,b)=>b.fail-a.fail||a.model.localeCompare(b.model)||a.ic.localeCompare(b.ic));
 const processRows=map=>[...map.values()].map(p=>{const total=p.units.size,fail=[...p.units.values()].filter(Boolean).length;const {units:ignored,...meta}=p;return {...meta,total,good:total-fail,fail,yield:total?(total-fail)/total:0};}).sort((a,b)=>a.yield-b.yield||a.process.localeCompare(b.process));
 const result={total:globalTotal,good:globalTotal-globalFail,fail:globalFail,badRate:globalTotal?globalFail/globalTotal:null,yield:globalTotal?(globalTotal-globalFail)/globalTotal:null,products:productRows,defects:ranking([...globalDefects.values()],globalTotal),processes:processRows(processes),productProcesses:processRows(productProcesses),attribution,observations,orders,dailyProcessTotals,dailyProductTotals,identityConflicts,skippedRows:merger.skippedRows||[]};
 Object.defineProperty(result,'identities',{value:new Map([...units.values()].map(u=>[u.serial,products.get(u.product)]))});return result;
}
function applyProductStageAverage(analysis,stageChecks){
 for(const product of analysis.products){const values=stageChecks.filter(check=>check.product===product.id&&Number.isFinite(check.yield)).map(check=>check.yield);product.stageAverageCount=values.length;product.yield=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;}
 return analysis;
}
function appendQualitySheets(XLSX,book,analysis){
 const append=(name,rows,percentColumns)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);for(let r=1;r<rows.length;r++)for(const c of percentColumns){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell)cell.z='0.00%';}sheet['!cols']=rows[0].map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,name);};
 append('品質總覽',[['統計範圍','總片數','良品片數','不良片數','唯一PPID總良率','唯一PPID不良率'],['全部產品',analysis.total,analysis.good,analysis.fail,analysis.yield,analysis.badRate]], [4,5]);
 append('產品總良率',[['IC','機種','產品PPID數','PPID良品數','PPID不良數','產品總良率（日期×階段算術平均）','PPID不良率（唯一PPID）','平均納入日期×階段數','占全產品不良貢獻比例'],...analysis.products.map(p=>[p.ic,p.model,p.total,p.good,p.fail,p.yield,p.badRate,p.stageAverageCount||0,p.contribution])],[5,6,8]);
 append('製程總良率',[['製程','經過製程總片數','良品片數','不良片數','總良率'],...analysis.processes.map(p=>[p.process,p.total,p.good,p.fail,p.yield])],[4]);
 const defectGroups=new Map();for(const a of analysis.attribution){const key=JSON.stringify([a.ic,a.model,a.date,a.process,a.defect]),item=defectGroups.get(key)||{ic:a.ic,model:a.model,product:a.product,date:a.date,process:a.process,defect:a.defect,count:0,serials:[]};item.count++;item.serials.push(a.serial);defectGroups.set(key,item);}
 const defectRows=[...defectGroups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.process.localeCompare(b.process)||a.ic.localeCompare(b.ic)||a.model.localeCompare(b.model)||a.defect.localeCompare(b.defect));
 const defectAnalysis=[['全產品總PPID',analysis.total,'唯一不良PPID',analysis.fail,'總良率',analysis.yield,'總不良率',analysis.badRate],['不良率貢獻加總','','','','','','',analysis.total?defectRows.reduce((sum,r)=>sum+r.count,0)/analysis.total:null],[],['日期','製程','IC','機種','不良項目','製程投入數量（PPID）','不良數量（PPID）','該組不良率','占全產品總PPID的不良率貢獻'],...defectRows.map(a=>{const input=analysis.dailyProcessTotals.get(JSON.stringify([a.product,a.date,a.process]))||0;return [a.date,a.process,a.ic,a.model,a.defect,input,a.count,input?a.count/input:0,analysis.total?a.count/analysis.total:0];}),['合計','','','','',null,analysis.fail,null,analysis.badRate]];
 const defectAnalysisSheet=XLSX.utils.aoa_to_sheet(defectAnalysis);for(const c of [5,7]){const cell=defectAnalysisSheet[XLSX.utils.encode_cell({r:0,c})];if(cell)cell.z='0.00%';}if(defectAnalysisSheet.H2)defectAnalysisSheet.H2.z='0.00%';for(let r=4;r<defectAnalysis.length;r++)for(const c of [7,8]){const cell=defectAnalysisSheet[XLSX.utils.encode_cell({r,c})];if(cell)cell.z='0.00%';}defectAnalysisSheet['!cols']=[{wch:18},{wch:20},{wch:20},{wch:24},{wch:38},{wch:26},{wch:24},{wch:18},{wch:38}];XLSX.utils.book_append_sheet(book,defectAnalysisSheet,'不良分析');
 append('PPID對照衝突',[['PPID','過站紀錄數','觀察到的IC／機種對照'],...analysis.identityConflicts.map(c=>[c.serial,c.records,JSON.stringify(c.mappings)])],[]);
 append('不良PPID明細',[['日期','製程','IC','機種','PPID','不良項目','歸屬狀態','不良紀錄數','占全檔不良率貢獻','工單'],...analysis.attribution.map(row=>[row.date,row.process,row.ic,row.model,row.serial,row.defect,row.status||'',row.defectObservations,analysis.total?1/analysis.total:0,row.order||''])],[8]);
 append('工單良率',[['工單','IC','機種','投入PPID','良品PPID','首次歸屬不良PPID','工單良率','工單不良率','開始日期','結束日期'],...(analysis.orders||[]).map(row=>[row.order,row.ic,row.model,row.total,row.good,row.fail,row.yield,row.badRate,row.start,row.end])],[6,7]);
 if(analysis.skippedRows?.length)append('略過錯誤明細',[['來源檔名','Excel列號','原因','製程','工單','料號','品名規格','小板序號','產出時間原值','操作人員','不良項目','原始狀態','IC','機種'],...analysis.skippedRows.map(r=>[r.filename,r.row,r.reason,...r.values])],[]);
 append('資料來源',[['類別','檔名','分頁','檔案大小（bytes）'],...(analysis.sources||[]).map(source=>['分析輸入',source.name,'Detail',source.size??null]),...(analysis.referenceSources||[]).map(name=>['IC／機種對照',name,'工單（A16）、CY26、工單（CY24&25）、重工工單1、NPI',null])],[]);
 append('統計說明',[
 ['項目','口徑'],['Scrap','Scrap不分大小寫、忽略前後空白，計算及合併優先序視同FAIL；原始Detail狀態保留。FAIL與Scrap同優先級，維持輸入第一筆。'],['略過錯誤列','測試模式預設關閉；開啟只略過Detail內日期、製程、PPID或狀態無效的資料列，不略過損壞檔案或缺少必要欄位。略過資料不列入投入與良率分子分母，檔名／原列號／原值與原因見略過錯誤明細。'],['產品身份','以 PPID（小板序號）為唯一身份，跨產品對照、站點及日期只算一片；一致的非空 IC／機種沿用，有矛盾則列入對照衝突組。'],['不良片','狀態 FAIL 或 H 欄有不良項目均計為不良，包含 GOOD。每個 PPID 跨日期、跨製程只計一次；FAIL 未填項目時標示「未填不良項目」。'],['不良歸屬','一片只歸屬一次，每個 PPID 優先取輸入順序第一筆 FAIL，沒有 FAIL 才取第一筆有不良項目的 GOOD。多檔先依選取順序，再依原始列序；不按產出時間重選。合併 XLSX 保存第一次項目與各合併組的不良標記，Detail 的 FAIL 優先規則不變。'],['舊版合併檔','若舊版合併檔沒有保存排除AOI後的原始首次不良順序或工單，會以可讀Detail及既有有效metadata重建；若需完整重現原始選檔順序，請從原始檔案重新分析。'],['不良項目','H 欄完整內容視為一個項目，不拆分逗號、頓號等描述；其他紀錄依原合併規則保留於 Detail。'],['產品內加總','各項不良片數／該產品總片數，加總＝該產品自身不良率。'],['全產品加總','各產品不良片數／全產品總片數，加總＝整體不良率。'],['產品自身不良率','各產品使用不同分母，不能直接相加；改用全產品不良貢獻比例相加。'],['製程總良率','該製程良品的不重複片數／經過該製程總片數；同片於該製程曾不良即計為不良。'],['缺漏產品','明確標示待補，仍計入整體並保留明細。'],['每日前後段','每日製程良率＝良品片數／總片數，不良率＝不良片數／總片數；前後段仍採 AGGREGATE 製程良率平均。'],['產品總良率','各機種所有有資料的日期×階段良率取算術平均；不改每日階段良率。PPID數量、不良率及不良貢獻仍按跨日期唯一PPID計算，故產品總良率與PPID不良率不互為補數。']
 ,['不良層級拆解','依產品→日期→製程→不良項目拆解首次歸屬不良；任一層全部子項的不良數加總等於父層。不良率貢獻一律使用全檔唯一PPID作分母，所有最細項加總等於品質總覽的PPID不良率。'],['拆解投入分母','產品使用全檔該產品唯一PPID；日期使用該產品當日唯一PPID；製程與項目使用該產品當日該製程唯一PPID。跨日期、跨製程投入可能重複，投入數及各組不良率不能直接相加。'],['空白日期','起訖日期內每日皆保留；無資料日為空白，不視為0%或100%。'],['分析製程','正面AOI、背面AOI完全排除投入、不良、良率與產品身份判定；原始Detail及IC／機種比對保留。SMT列保留空白，不引用AOI數據。'],['日期區間','看板可按日、ISO週（週一至週日）、月選擇起訖區間。區間只篩選全檔首次不良的歸屬日期，不在區間內重新選擇首次不良。投入為區間內納入製程的不重複PPID，週／月不將每日投入直接相加。'],['工單良率','工單投入為納入製程曾過站的不重複PPID；不良按全檔第一次FAIL優先的歸屬工單計算，GOOD有項目亦計不良。工單良率=(投入-首次歸屬不良)/投入。同片跨工單投入可重複出現，投入及工單良率不可直接加總；全檔不良仍只歸屬一次。'],['工單明細','依首次不良紀錄的工單歸屬；同一PPID只歸屬一筆不良。工單投入按該工單實際過站去重，跨工單投入不直接相加。'],['看板範圍','每日階段圖繪製前段、後段，另含工單良率與可切換產品的不良項目推移圖。各日期圖保留區間內所有日期，無投入為空白。'],['比對欄位','Detail B欄工單、C欄料號對照；唯一匹配填入J欄IC及K欄機種，多組候選或未匹配不猜測。正面AOI納入比對。'],['使用限制','一般比對每檔100MB；合併最多30份且合計100MB；分析主檔100MB。'],['檔案清單','比對、合併與分析產出檔案集中儲存於目前瀏覽器的IndexedDB檔案清單，可多選下載、合併或分析。同名檔案各自保留；清空本瀏覽器資料庫同時移除檔案清單。'],['本瀏覽器資料庫','匯入追加並跳過重複，清空後資料與匯入清單移除。資料只保存在目前瀏覽器，請下載SQLite備份。'],['顯示精度','百分比顯示會四捨五入；加總驗算請使用原始PPID數或Excel儲存的未四捨五入數值。'],['圖表活頁簿','階段／不良拆解為可編輯原生柱狀圖及參考線，項目推移為原生多序列折線圖，均附來源數據；已產生圖表工作表為匯出當下的圖像快照，不會跟著儲存格修改而更新。']
 ],[]);
}
root.analyzeQuality=analyzeQuality;root.applyProductStageAverage=applyProductStageAverage;root.appendQualitySheets=appendQualitySheets;
})(typeof self!=='undefined'?self:globalThis);
