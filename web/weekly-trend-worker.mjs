import '../merge-core.js';
import '../yield-core.js';
import '../quality-core.js';
import '../indexed-detail-store.js';
import {addTrendProcessUnit,trendDefectName} from './defect-analysis.mjs';

const MAX_ROWS=300000;
const index=globalThis.AutoReportDetailIndex;

function summarize(analysis){
 const processUnits=new Map();
 for(const row of analysis.observations){
  if(row.attributionOnly)continue;
  if(!processUnits.has(row.process))processUnits.set(row.process,new Map());
  addTrendProcessUnit(processUnits.get(row.process),row);
 }
 const aggregate=()=>({input:0,count:0,defects:new Map()});
 function record(group,row){
  group.input++;
  if(!row.fail)return;
  group.count++;
  const defect=trendDefectName(row);
  group.defects.set(defect,(group.defects.get(defect)||0)+1);
 }
 const counts=group=>({...group,defects:[...group.defects]});
 const processes=[];
 for(const [process,units] of processUnits){
  const all=aggregate(),products=new Map();
  for(const row of units.values()){
   if(!products.has(row.product))products.set(row.product,aggregate());
   record(all,row);
   record(products.get(row.product),row);
  }
  processes.push([process,{...counts(all),products:[...products].map(([id,group])=>[id,counts(group)])}]);
 }
 const products=analysis.products.map(({id,ic,model,total,fail})=>({id,ic,model,input:total,count:fail}));
 return {input:analysis.total,count:analysis.fail,products,processes};
}

self.onmessage=async({data:{period,sources,skipInvalidRows,mode}})=>{
 const label=mode==='day'?'當日':'本週';
 try{
  const merger=new globalThis.DetailMerger(null,{skipInvalidRows});
  for(const source of sources){
   if(source.rows>MAX_ROWS)throw Error(source.name+' 在'+label+'超過 30 萬筆索引紀錄。');
   const meta=await index.meta(source.key);
   if(!meta?.complete)throw Error(source.name+' 的日期索引尚未完成。');
   merger.prepareIndexed(meta,period);
   await index.scan(source.key,period,value=>{
    merger.addIndexed(value);
    if(merger.rows.size>MAX_ROWS)throw Error(label+'去重後仍超過 30 萬筆過站紀錄。');
   });
   merger.completeIndexed();
  }
  const summary=summarize(globalThis.analyzeQuality(merger));
  self.postMessage({summary,skipped:merger.skippedRows.length});
 }catch(error){self.postMessage({error:error.message||'無法計算'+label+'推移。'});}
};
