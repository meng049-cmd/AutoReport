export const STAGE_PROCESSES={前段:['DAF熱壓投入','DAF外觀','功能一測試'],後段:['輝度機測試','功能二測試','外觀檢查點亮測試']};
export const stageProcesses=stage=>STAGE_PROCESSES[stage]||Object.values(STAGE_PROCESSES).flat();
export const isStageProcess=(process,stage='')=>stageProcesses(stage).includes(process);
const average=values=>values.length?values.reduce((sum,n)=>sum+n,0)/values.length:null;
/** Same observation scope for AGGREGATE(1,6) process mean and unique-PPID comparison. */
export function summarizeStage(rows,stage=''){
 const units=new Map(),processes=new Map();
 for(const row of rows){if(row.attributionOnly||!isStageProcess(row.process,stage))continue;units.set(row.serial,Boolean(units.get(row.serial)||row.fail));const group=processes.get(row.process)||new Map();group.set(row.serial,Boolean(group.get(row.serial)||row.fail));processes.set(row.process,group);}
 const processRows=[...processes].map(([process,items])=>{const input=items.size,count=[...items.values()].filter(Boolean).length;return {process,input,count,good:input-count,value:input?(input-count)/input:null};});
 const input=units.size,count=[...units.values()].filter(Boolean).length,good=input-count,uniqueYield=input?good/input:null,value=average(processRows.map(row=>row.value));
 return {input,count,good,value,badRate:value==null?null:1-value,uniqueYield,uniqueBadRate:input?count/input:null,difference:value==null?null:value-uniqueYield,processRows,processCount:processRows.length};
}

/** Chart-only six-process scope; exclude other records without excluding shared PPIDs. */
export function restrictChartAnalysis(analysis){
 const observations=(analysis.observations||[]).filter(row=>!row.attributionOnly&&isStageProcess(row.process)),units=new Map(),known=new Map((analysis.attribution||[]).filter(row=>isStageProcess(row.process)).map(row=>[row.serial,row]));
 for(const row of observations){let unit=units.get(row.serial);if(!unit){unit={product:row.product,primary:null};units.set(row.serial,unit);}if(row.fail&&(!unit.primary||(row.status==='FAIL'&&unit.primary.status!=='FAIL')))unit.primary=row;}
 const attribution=[];for(const [serial,unit] of units)if(unit.primary){const original=known.get(serial),row=original||unit.primary,p=analysis.products.find(p=>p.id===unit.product);attribution.push({...row,serial,product:unit.product,ic:p?.ic,model:p?.model,defect:row.defect||'【未填不良項目】'});}
 const products=analysis.products.map(product=>{const ids=[...units].filter(([,unit])=>unit.product===product.id),total=ids.length,fail=ids.filter(([,unit])=>unit.primary).length;return {...product,total,fail,good:total-fail,yield:total?(total-fail)/total:null,badRate:total?fail/total:null};}).filter(product=>product.total);
 const total=units.size,fail=attribution.length;for(const product of products)product.contribution=total?product.fail/total:0;
 return {...analysis,observations,attribution,products,total,fail,good:total-fail,yield:total?(total-fail)/total:null,badRate:total?fail/total:null,processes:analysis.processes?.filter(row=>isStageProcess(row.process)),productProcesses:analysis.productProcesses?.filter(row=>isStageProcess(row.process))};
}
