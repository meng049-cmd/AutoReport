import {buildStageAnalysis} from './stage-analysis.mjs';
import {summarizeStage,isStageProcess} from './stage-metrics.mjs';
import {calendarBuckets} from './defect-analysis.mjs';

export function productStageSeries(analysis,productId,stage,start,end,days=[]){
 const products=analysis.products.filter(product=>product.id===productId);
 const productRows=(analysis.observations||[]).filter(row=>row.product===productId);
 const observations=productRows.filter(row=>!days.length||days.includes(row.date));
 const model=buildStageAnalysis({...analysis,products,observations},stage,start,end,[]);
 const daily=model.daily.filter(row=>(!days.length||days.includes(row.date))&&row.input>0);
 if(!daily.length)return {...model,daily,weeks:[],chartRows:[],comparisonNote:''};

 const current=calendarBuckets(daily.at(-1).date,daily.at(-1).date,'week')[0];
 const before=new Date(current.start+'T00:00:00Z');before.setUTCDate(before.getUTCDate()-7);
 const previous=calendarBuckets(before.toISOString().slice(0,10),before.toISOString().slice(0,10),'week')[0];
 const weeks=[];
 for(const [index,bucket] of [previous,current].entries()){
  const rows=(index===0?productRows:observations).filter(row=>
   !row.attributionOnly&&isStageProcess(row.process,stage)&&row.date>=bucket.start&&row.date<=bucket.end&&
   (index===0||(row.date>=start&&row.date<=end)));
  let metrics=summarizeStage(rows,stage),availableStart=rows.map(row=>row.date).sort()[0],availableEnd=rows.map(row=>row.date).sort().at(-1),contextSources=[];
  const context=analysis.stageWeekContext;
  if(index===0&&context?.key===bucket.key&&context.status==='ready'){
   const saved=context.products.find(product=>product.id===productId)?.stages.find(item=>item.stage===stage);
   if(saved){metrics=saved;availableStart=context.start;availableEnd=context.end;contextSources=context.sources||[];}
  }
  if(metrics.input)weeks.push({
   ...metrics,date:bucket.key,label:bucket.key,kind:'week',start:bucket.start,end:bucket.end,
   availableStart,availableEnd,contextSources
  });
 }
 const hasPrevious=weeks.some(row=>row.date===previous.key);
 const comparisonNote=hasPrevious?'':analysis.stageWeekContext?.status==='error'
  ?previous.key+' 比較資料未載入：'+analysis.stageWeekContext.error
  :previous.key+' 沒有可用的同機種／IC 階段投入資料。';
 return {...model,daily,weeks,chartRows:[...weeks,...daily],comparisonNote};
}
