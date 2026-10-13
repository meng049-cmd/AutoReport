(function(root){
'use strict';
const targets={SMT:.995,'前段':.98,'後段':.99};
function buildDefectComposition(merger){
 const stages={正面AOI:'SMT',DAF外觀:'前段',DAF熱壓投入:'前段',功能一測試:'前段',功能二測試:'後段',外觀檢查點亮測試:'後段',輝度機測試:'後段'};
 const items=new Map(),processTotals=new Map(),stageTotals=new Map();
 for(const {row} of merger.rows.values()){
  if(String(row[merger.status]).trim().toUpperCase()!=='FAIL')continue;
  const process=root.canonicalProcess(row[0]),stage=stages[process]||'',defect=String(row[7]??'').trim()||'【未填不良項目】',key=JSON.stringify([process,defect]);
  const item=items.get(key)||{process,stage,defect,count:0};item.count++;items.set(key,item);
  processTotals.set(process,(processTotals.get(process)||0)+1);
  if(stage)stageTotals.set(stage,(stageTotals.get(stage)||0)+1);
 }
 return [...items.values()].map(r=>({...r,processTotal:processTotals.get(r.process),stageTotal:r.stage?stageTotals.get(r.stage):null,processShare:r.count/processTotals.get(r.process),stageShare:r.stage?r.count/stageTotals.get(r.stage):null})).sort((a,b)=>b.count-a.count||a.process.localeCompare(b.process)||a.defect.localeCompare(b.defect));
}
function buildThresholdAnalysis(merger,calculation,identities){
 const dailyGlobal=new Map(),dailyProducts=new Map(),failRows=new Map();
 for(const value of merger.rows.values()){
  const row=value.row,serial=String(row[4]).trim(),identity=identities.get(serial),product=identity.id,day=value.day,process=root.canonicalProcess(row[0]);
  const add=(map,key)=>{const set=map.get(key)||new Set();set.add(serial);map.set(key,set);};add(dailyGlobal,day);add(dailyProducts,JSON.stringify([product,day]));
  if(String(row[merger.status]).trim().toUpperCase()==='FAIL'){const key=JSON.stringify([product,day]);const list=failRows.get(key)||[];list.push({serial,process,defect:String(row[7]??'').trim()||'【未填不良項目】',time:value.timestamp});failRows.set(key,list);}
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
 const rows=[['IC','機種','日期','未達標階段','目標良率','實際階段良率','未達差距','不良歸屬製程','不良項目','不良PPID數','該產品當日總PPID','全產品當日總PPID','不良比例（個體）','不良比例（全體）','該產品該製程GOOD片數','該產品該製程FAIL片數','該產品該製程總片數','該製程良率'],...data.rows.map(r=>[r.ic,r.model,r.date,r.stage,r.target,r.yield,r.target-r.yield,r.process,r.defect,r.count,r.productTotal,r.globalTotal,r.productRate,r.globalRate,r.processGood,r.processFail,r.processTotal,r.processYield])];
 const sheet=XLSX.utils.aoa_to_sheet(rows);for(let r=1;r<rows.length;r++)for(const c of [4,5,6,12,13,17])sheet[XLSX.utils.encode_cell({r,c})].z=[12,13].includes(c)?'0.0000%':'0.00%';sheet['!cols']=rows[0].map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,'未達標分析');
 const composition=[['階段','歸屬製程','不良項目','不良項目總數（筆）','所屬製程不良總數（筆）','所屬階段不良總數（筆）','占所屬製程不良比例','占所屬階段不良比例'],...data.composition.map(r=>[r.stage||'未歸類',r.process,r.defect,r.count,r.processTotal,r.stageTotal,r.processShare,r.stageShare])];
 const compositionSheet=XLSX.utils.aoa_to_sheet(composition);
 for(let r=1;r<composition.length;r++)for(const c of [6,7]){const cell=compositionSheet[XLSX.utils.encode_cell({r,c})];if(cell)cell.z='0.0000%';}
 compositionSheet['!cols']=composition[0].map(()=>({wch:28}));XLSX.utils.book_append_sheet(book,compositionSheet,'全產品不良項目占比');
 const notes=book.Sheets['統計說明'];XLSX.utils.sheet_add_aoa(notes,[['未達標目標','SMT≥99.5%、前段≥98%、後段≥99%；用未四捨五入的每日階段良率判斷；無資料不列未達標。'],['未達標比例分母','個體＝產品當日不重複PPID；全體＝全部產品當日不重複PPID。'],['全產品不良項目占比','以整份主檔的FAIL紀錄計數，不分IC、機種、日期，也不限制未達標資料；主檔已依日期＋製程＋PPID去重，FAIL優先。每筆H欄完整文字為一項，不拆分標點。跨製程或跨日期的同片FAIL各計一次，不套用每片單一不良歸屬。'],['製程不良項目比例','同製程＋不良項目的FAIL紀錄總數／該製程全部FAIL紀錄總數；每個製程所有項目原始比例加總為100%。'],['階段不良項目比例','同製程＋不良項目的FAIL紀錄總數／所屬SMT、前段或後段全部FAIL紀錄總數；每階段所有製程＋項目的原始比例加總為100%。未定義階段的製程保留，階段分母與比例留白。'],['未達標歸屬','每個產品／日期／階段內，一片只歸屬該階段最早FAIL的製程＋不良項目；階段分開分析，不跨階段相加。'],['製程GOOD／FAIL','該產品該日期該製程的唯一PPID，FAIL優先；為整個製程片數，非單一不良項目片數。']],{origin:-1});
}
root.buildThresholdAnalysis=buildThresholdAnalysis;root.appendThresholdSheet=appendThresholdSheet;
})(typeof self!=='undefined'?self:globalThis);
