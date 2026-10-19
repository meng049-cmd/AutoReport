(function(root){
'use strict';
function analyzeQuality(merger){
 const products=new Map(),units=new Map(),processes=new Map(),productProcesses=new Map(),identityConflicts=[];
 const processName=value=>root.canonicalProcess?root.canonicalProcess(value):String(value).trim().replace(/\s+/g,'')==='DAF外觀檢查'?'DAF外觀':String(value).trim().replace(/\s+/g,'');
 const addProcess=(map,key,unit,fail,meta)=>{const item=map.get(key)||{...meta,units:new Map()};item.units.set(unit,Boolean(item.units.get(unit)||fail));map.set(key,item);};
 for(const value of merger.rows.values()){
  const row=value.row,ic=String(row[9]??'').trim(),model=String(row[10]??'').trim();
  const serial=String(row[4]).trim(),process=processName(row[0]);
  const fail=merger.hasDefect(value);
  const unit=units.get(serial)||{serial,fail:false,primary:null,defectObservations:0,mappings:new Map(),processes:new Map(),records:0};
  unit.mappings.set(JSON.stringify([ic,model]),{ic,model});unit.records++;
  if(fail){unit.fail=true;unit.defectObservations++;if(!unit.primary||value.timestamp<unit.primary.timestamp)unit.primary={timestamp:value.timestamp,date:value.day,process,defect:String(row[7]??'').trim()||'【未填不良項目】'};}
  unit.processes.set(process,Boolean(unit.processes.get(process)||fail));units.set(serial,unit);
  addProcess(processes,process,serial,fail,{process});
 }
 for(const unit of units.values()){
  const first=merger.firstNG?.get(unit.serial);
  if(first){unit.fail=true;unit.primary={timestamp:first.timestamp,date:first.date,process:processName(first.process),defect:first.defect,status:first.status};}
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
  attribution.push({ic:p.ic,model:p.model,serial:unit.serial,date,process,defect,timestamp:unit.primary.timestamp,status:unit.primary.status,defectObservations:unit.defectObservations});
 }
 const ranking=(items,total)=>items.sort((a,b)=>b.count-a.count||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect)).map((r,index)=>({...r,rank:index+1,total,rate:total?r.count/total:0}));
 const productRows=[...products.values()].map(p=>{
  const total=p.units.size,fail=[...p.units].filter(key=>units.get(key).fail).length;
  return {id:p.id,ic:p.ic,model:p.model,pending:p.pending,total,good:total-fail,fail,yield:total?(total-fail)/total:0,badRate:total?fail/total:0,contribution:globalTotal?fail/globalTotal:0,defects:ranking([...productDefects.values()].filter(d=>d.product===p.id),total)};
 }).sort((a,b)=>b.fail-a.fail||a.model.localeCompare(b.model)||a.ic.localeCompare(b.ic));
 const processRows=map=>[...map.values()].map(p=>{const total=p.units.size,fail=[...p.units.values()].filter(Boolean).length;const {units:ignored,...meta}=p;return {...meta,total,good:total-fail,fail,yield:total?(total-fail)/total:0};}).sort((a,b)=>a.yield-b.yield||a.process.localeCompare(b.process));
 const result={total:globalTotal,good:globalTotal-globalFail,fail:globalFail,badRate:globalTotal?globalFail/globalTotal:0,yield:globalTotal?(globalTotal-globalFail)/globalTotal:0,products:productRows,defects:ranking([...globalDefects.values()],globalTotal),processes:processRows(processes),productProcesses:processRows(productProcesses),attribution,identityConflicts};
 Object.defineProperty(result,'identities',{value:new Map([...units.values()].map(u=>[u.serial,products.get(u.product)]))});return result;
}
function appendQualitySheets(XLSX,book,analysis){
 const append=(name,rows,percentColumns)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);for(let r=1;r<rows.length;r++)for(const c of percentColumns){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell)cell.z='0.00%';}sheet['!cols']=rows[0].map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,name);};
 append('品質總覽',[['統計範圍','總片數','良品片數','不良片數','總良率','不良率'],['全部產品',analysis.total,analysis.good,analysis.fail,analysis.yield,analysis.badRate]], [4,5]);
 append('產品總良率',[['IC','機種','產品總片數','良品片數','不良片數','產品總良率','產品自身不良率','占全產品不良貢獻比例'],...analysis.products.map(p=>[p.ic,p.model,p.total,p.good,p.fail,p.yield,p.badRate,p.contribution])],[5,6,7]);
 append('全產品不良排名',[['排名','歸屬製程','不良項目','不良片數','全產品總片數','占全產品不良比例'],...analysis.defects.map(d=>[d.rank,d.process,d.defect,d.count,d.total,d.rate])],[5]);
 append('各產品不良排名',[['IC','機種','排名','歸屬製程','不良項目','不良片數','產品總片數','占該產品不良比例','占全產品不良貢獻比例'],...analysis.products.flatMap(p=>p.defects.map(d=>[p.ic,p.model,d.rank,d.process,d.defect,d.count,d.total,d.rate,d.count/analysis.total]))],[7,8]);
 append('製程總良率',[['製程','經過製程總片數','良品片數','不良片數','總良率'],...analysis.processes.map(p=>[p.process,p.total,p.good,p.fail,p.yield])],[4]);
 const products=new Map(analysis.products.map(p=>[p.id,p]));
 append('產品製程總良率',[['IC','機種','製程','經過製程總片數','良品片數','不良片數','總良率'],...analysis.productProcesses.map(p=>{const product=products.get(p.product);return [product.ic,product.model,p.process,p.total,p.good,p.fail,p.yield];})],[6]);
 append('不良歸屬明細',[['IC','機種','小板序號','首次NG日期','首次NG製程','首次NG不良項目','含不良項目紀錄數','首次NG時間','首次NG狀態'],...analysis.attribution.map(a=>[a.ic,a.model,a.serial,a.date,a.process,a.defect,a.defectObservations,a.timestamp,a.status])],[]);
 const attributionSheet=book.Sheets['不良歸屬明細'];for(let r=2;r<=analysis.attribution.length+1;r++)attributionSheet['H'+r].z='yyyy-mm-dd hh:mm:ss';
 const defectGroups=new Map();for(const a of analysis.attribution){const key=JSON.stringify([a.ic,a.model,a.date,a.process,a.defect]),item=defectGroups.get(key)||{ic:a.ic,model:a.model,date:a.date,process:a.process,defect:a.defect,count:0,serials:[]};item.count++;item.serials.push(a.serial);defectGroups.set(key,item);}
 const defectAnalysis=[['IC','機種','日期','製程','不良名稱','不良數量（PPID）','PPID清單'],...[...defectGroups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.ic.localeCompare(b.ic)||a.model.localeCompare(b.model)||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect)).map(a=>[a.ic,a.model,a.date,a.process,a.defect,a.count,a.serials.join('、')])];
 const defectAnalysisSheet=XLSX.utils.aoa_to_sheet(defectAnalysis);defectAnalysisSheet['!cols']=[{wch:20},{wch:24},{wch:14},{wch:28},{wch:36},{wch:20},{wch:48}];XLSX.utils.book_append_sheet(book,defectAnalysisSheet,'不良分析');
 append('PPID對照衝突',[['PPID','過站紀錄數','觀察到的IC／機種對照'],...analysis.identityConflicts.map(c=>[c.serial,c.records,JSON.stringify(c.mappings)])],[]);
 append('統計說明',[
 ['項目','口徑'],['產品身份','以 PPID（小板序號）為唯一身份，跨產品對照、站點及日期只算一片；一致的非空 IC／機種沿用，有矛盾則列入對照衝突組。'],['不良片','狀態 FAIL 或 H 欄有不良項目均計為不良，包含 GOOD。每個 PPID 跨日期、跨製程只計一次；FAIL 未填項目時標示「未填不良項目」。'],['不良歸屬','一片只歸屬一次，每個 PPID 優先取輸入順序第一筆 FAIL，沒有 FAIL 才取第一筆有不良項目的 GOOD。多檔先依選取順序，再依原始列序；不按產出時間重選。合併 XLSX 保存第一次項目與各合併組的不良標記，Detail 的 FAIL 優先規則不變。'],['不良項目','H 欄完整內容視為一個項目，不拆分逗號、頓號等描述；其他紀錄依原合併規則保留於 Detail。'],['產品內加總','各項不良片數／該產品總片數，加總＝該產品自身不良率。'],['全產品加總','各產品不良片數／全產品總片數，加總＝整體不良率。'],['產品自身不良率','各產品使用不同分母，不能直接相加；改用全產品不良貢獻比例相加。'],['製程總良率','該製程良品的不重複片數／經過該製程總片數；同片於該製程曾不良即計為不良。'],['缺漏產品','明確標示待補，仍計入整體並保留明細。'],['每日前後段','每日製程良率＝良品片數／總片數，不良率＝不良片數／總片數；前後段仍採 AGGREGATE 製程良率平均。']
 ],[]);
}
root.analyzeQuality=analyzeQuality;root.appendQualitySheets=appendQualitySheets;
})(typeof self!=='undefined'?self:globalThis);
