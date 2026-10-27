import {buildStageAnalysis} from './stage-analysis.mjs';
import {summarizeStage} from './stage-metrics.mjs';
import {periodKey,periodBounds} from './defect-analysis.mjs';
export function productStageSeries(analysis,productId,stage,start,end){
 const products=analysis.products.filter(p=>p.id===productId),observations=(analysis.observations||[]).filter(row=>row.product===productId),scoped={...analysis,products,observations};
 const model=buildStageAnalysis(scoped,stage,start,end,[]),current=periodBounds(periodKey(end,'week'),'week'),previous=new Date(current.start+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-7);
 const weeks=[periodKey(previous.toISOString().slice(0,10),'week'),periodKey(end,'week')].map(date=>{
  const bounds=periodBounds(date,'week'),rows=observations.filter(row=>row.date>=bounds.start&&row.date<=bounds.end&&row.date>=start&&row.date<=end);
  return {date,label:date.slice(5),kind:'week',start:bounds.start,end:bounds.end,...summarizeStage(rows,stage)};
 });
 return {...model,weeks,chartRows:[...weeks,...model.daily]};
}
