(function(root){
'use strict';
const targets={SMT:.995,'前段':.98,'後段':.99};
function buildDefectComposition(merger){
 const stages={正面AOI:'SMT',DAF外觀:'前段',DAF熱壓投入:'前段',功能一測試:'前段',功能二測試:'後段',外觀檢查點亮測試:'後段',輝度機測試:'後段'};
 const items=new Map(),processTotals=new Map(),stageTotals=new Map(),processFails=new Map(),stageFails=new Map();
 for(const value of merger.rows.values()){
  const row=value.row;
  const status=String(row[merger.status]).trim().toUpperCase();
  if(!['GOOD','FAIL'].includes(status))continue;
  const process=root.canonicalProcess(row[0]),stage=stages[process]||'',defect=String(row[7]??'').trim()||'【未填不良項目】',key=JSON.stringify([process,defect]);
  processTotals.set(process,(processTotals.get(process)||0)+1);
  if(stage)stageTotals.set(stage,(stageTotals.get(stage)||0)+1);
  if(merger.hasDefect(value)){processFails.set(process,(processFails.get(process)||0)+1);if(stage)stageFails.set(stage,(stageFails.get(stage)||0)+1);}
 }
 // Numerators use one first-encountered defect per PPID; denominators retain merged input counts.
 for(const first of merger.firstNG.values()){
  const process=root.canonicalProcess(first.process),stage=stages[process]||'',defect=first.defect,key=JSON.stringify([process,defect]);
  const item=items.get(key)||{process,stage,defect,count:0};item.count++;items.set(key,item);
 }
 return [...items.values()].map(r=>({...r,processGood:processTotals.get(r.process)-processFails.get(r.process),processFail:processFails.get(r.process),stageGood:r.stage?stageTotals.get(r.stage)-stageFails.get(r.stage):null,stageFail:r.stage?stageFails.get(r.stage):null,processTotal:processTotals.get(r.process),stageTotal:r.stage?stageTotals.get(r.stage):null,processShare:r.count/processTotals.get(r.process),stageShare:r.stage?r.count/stageTotals.get(r.stage):null})).sort((a,b)=>b.count-a.count||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect));
}
function buildThresholdAnalysis(merger,calculation,identities){
 const dailyGlobal=new Map(),dailyProducts=new Map(),failRows=new Map();
 for(const value of merger.rows.values()){
  const row=value.row,serial=String(row[4]).trim(),identity=identities.get(serial),product=identity.id,day=value.day,process=root.canonicalProcess(row[0]);
  const add=(map,key)=>{const set=map.get(key)||new Set();set.add(serial);map.set(key,set);};add(dailyGlobal,day);add(dailyProducts,JSON.stringify([product,day]));
 }
 for(const first of merger.firstNG.values()){
  const identity=identities.get(first.serial),key=JSON.stringify([identity.id,first.date]),list=failRows.get(key)||[];
  list.push({serial:first.serial,process:root.canonicalProcess(first.process),defect:first.defect,time:first.timestamp});failRows.set(key,list);
 }
 const checks=calculation.stageChecks.map(c=>({...c,target:targets[c.stage],below:c.yield<targets[c.stage]-1e-12}));
 const countMap=new Map(calculation.dailyCounts.map(c=>[JSON.stringify([c.product,c.day,c.process]),c]));
 const rows=[];
 for(const check of checks.filter(c=>c.below)){
  const key=JSON.stringify([check.product,check.date]),primary=new Map();
  for(const row of failRows.get(key)||[])if(check.processes.includes(row.process)){const old=primary.get(row.serial);if(!old||row.time<old.time)primary.set(row.serial,row);}
  const defects=new Map();for(const row of primary.values()){const key=JSON.stringify([row.process,row.defect]);const d=defects.get(key)||{process:row.process,defect:row.defect,count:0};d.count++;defects.set(key,d);}
  const productTotal=dailyProducts.get(key)?.size||0,globalTotal=dailyGlobal.get(check.date)?.size||0;
  for(const d of [...defects.values()].sort((a,b)=>b.count-a.count||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect))){const c=countMap.get(JSON.stringify([check.product,check.date,d.process]));rows.push({...check,...d,productTotal,globalTotal,productRate:d.count/productTotal,globalRate:d.count/globalTotal,processGood:c.good,processFail:c.fail,processTotal:c.good+c.fail,processYield:c.good/(c.good+c.fail)});}
 }
 return {targets,checks,below:checks.filter(c=>c.below),rows,composition:buildDefectComposition(merger)};
}
function appendThresholdSheet(XLSX,book,data){
 const rows=[['IC','機種','日期','未達標階段','目標良率','實際階段良率','未達差距','不良歸屬製程','不良項目','不良PPID數','該產品當日總PPID','全產品當日總PPID','不良比例（個體）','不良比例（全體）','該產品該製程良品片數','該產品該製程不良片數','該產品該製程總片數','該製程良率'],...data.rows.map(r=>[r.ic,r.model,r.date,r.stage,r.target,r.yield,r.target-r.yield,r.process,r.defect,r.count,r.productTotal,r.globalTotal,r.productRate,r.globalRate,r.processGood,r.processFail,r.processTotal,r.processYield])];
 const sheet=XLSX.utils.aoa_to_sheet(rows);for(let r=1;r<rows.length;r++)for(const c of [4,5,6,12,13,17])sheet[XLSX.utils.encode_cell({r,c})].z=[12,13].includes(c)?'0.0000%':'0.00%';sheet['!cols']=rows[0].map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,'未達標分析');
 const composition=[['階段','歸屬製程','不良項目','首次NG不良片數（PPID）','所屬製程投入數（良品＋不良）','所屬階段投入數（良品＋不良）','占製程投入數的不良比例','占階段投入數的不良比例','製程良品數','製程不良數','階段良品數','階段不良數'],...data.composition.map(r=>[r.stage||'未歸類',r.process,r.defect,r.count,r.processTotal,r.stageTotal,r.processShare,r.stageShare,r.processGood,r.processFail,r.stageGood,r.stageFail])];
 const compositionSheet=XLSX.utils.aoa_to_sheet(composition);
 for(let r=1;r<composition.length;r++)for(const c of [6,7]){const cell=compositionSheet[XLSX.utils.encode_cell({r,c})];if(cell)cell.z='0.0000%';}
 compositionSheet['!cols']=composition[0].map(()=>({wch:28}));XLSX.utils.book_append_sheet(book,compositionSheet,'全產品不良項目占比');
 const notes=book.Sheets['統計說明'];XLSX.utils.sheet_add_aoa(notes,[['未達標目標','SMT≥99.5%、前段≥98%、後段≥99%；用未四捨五入的每日階段良率判斷；無資料不列未達標。'],['未達標比例分母','個體＝產品當日不重複PPID；全體＝全部產品當日不重複PPID。'],['全產品不良項目占比','每個 PPID 優先取第一筆 FAIL，沒有 FAIL 才取第一筆有不良項目的 GOOD；跨日期、跨製程只歸屬一次。FAIL 未填項目仍計不良並明確標示。Detail 合併仍保留原始狀態與 FAIL 優先規則。'],['製程不良項目比例','首次不良項目歸屬此製程＋項目的唯一PPID數／該製程合併後總紀錄數，分子依輸入順序且 FAIL 優先，不按產出時間重選。'],['階段不良項目比例','首次NG歸屬此製程＋項目的唯一PPID數／所屬階段的合併後良品＋不良紀錄總數。同片跨製程投入仍分別計數，但NG歸屬只計一次；此比例與每日AGGREGATE良率分開顯示。未歸類階段的比例留白。'],['未達標歸屬','先依輸入順序找每個PPID第一筆FAIL，無FAIL則使用GOOD不良項目，再按該筆日期／製程／階段列入明細；後續不再歸屬。每日良率＝良品片數／總片數。'],['製程GOOD／FAIL','該產品該日期該製程的唯一PPID，FAIL 或有不良項目即計不良，GOOD 且無項目才計良品；原始狀態保留於Detail。']],{origin:-1});
}
root.buildThresholdAnalysis=buildThresholdAnalysis;root.appendThresholdSheet=appendThresholdSheet;
})(typeof self!=='undefined'?self:globalThis);
