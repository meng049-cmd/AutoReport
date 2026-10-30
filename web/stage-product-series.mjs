import {buildStageAnalysis} from './stage-analysis.mjs';
import {summarizeStage} from './stage-metrics.mjs';
import {calendarBuckets} from './defect-analysis.mjs';
export function productStageSeries(analysis,productId,stage,start,end,days=[]){
 const products=analysis.products.filter(p=>p.id===productId),observations=(analysis.observations||[]).filter(row=>row.product===productId&&(!days.length||days.includes(row.date))),scoped={...analysis,products,observations};
 const model=buildStageAnalysis(scoped,stage,start,end,[]);
 const earlier=new Date(start+'T00:00:00Z');earlier.setUTCDate(earlier.getUTCDate()-7);
 const weeks=calendarBuckets(earlier.toISOString().slice(0,10),end,'week').slice(-2).map(bucket=>{
  const rows=observations.filter(row=>row.date>=bucket.start&&row.date<=bucket.end&&row.date>=start&&row.date<=end&&row.date.slice(0,4)===bucket.key.slice(0,4));
  return {date:bucket.key,label:bucket.key.slice(5),kind:'week',start:bucket.start,end:bucket.end,...summarizeStage(rows,stage)};
 });
 const daily=model.daily.filter(row=>!days.length||days.includes(row.date));return {...model,daily,weeks,chartRows:[...weeks,...daily]};
}
