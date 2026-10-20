export const dimensions=['product','date','process','defect'];
export const dimensionNames={product:'產品',date:'日期',process:'製程',defect:'不良項目'};
export function calendarDates(start,end){const dates=[];for(let time=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');Number.isFinite(time)&&time<=last;time+=86400000)dates.push(new Date(time).toISOString().slice(0,10));return dates;}
export function attributedRows(analysis,filters={}){return analysis.attribution.filter(row=>dimensions.every(key=>!filters[key]||row[key]===filters[key]));}
const cohortCaches=new WeakMap();
export function cohortInput(analysis,filters={}){
 let totals=cohortCaches.get(analysis);if(!totals){totals=new Map();const put=(product,date,process,total,add=false)=>{const key=JSON.stringify([product,date,process]);totals.set(key,(add?totals.get(key)||0:0)+total);};
 put('','','',analysis.total);for(const p of analysis.products)put(p.id,'','',p.total);for(const p of analysis.processes)put('','',p.process,p.total);for(const p of analysis.productProcesses)put(p.product,'',p.process,p.total);
 for(const [key,total] of analysis.dailyProductTotals||[]){const [product,date]=JSON.parse(key);put(product,date,'',total);put('',date,'',total,true);}for(const [key,total] of analysis.dailyProcessTotals||[]){const [product,date,process]=JSON.parse(key);put(product,date,process,total);put('',date,process,total,true);}cohortCaches.set(analysis,totals);}
 return totals.get(JSON.stringify([filters.product||'',filters.date||'',filters.process||'']))||0;
}
export function defectBreakdown(analysis,filters={},dates=[]){
 const records=attributedRows(analysis,filters),dimension=dimensions.find(key=>!filters[key])||null,groupMap=new Map();
 const ensure=(key,label)=>{if(!groupMap.has(key))groupMap.set(key,{key,label,count:0});return groupMap.get(key);};
 if(dimension==='product')for(const product of analysis.products)ensure(product.id,product.ic+'／'+product.model);
 if(dimension==='date')for(const date of dates)ensure(date,date);
 if(dimension==='process')for(const [key] of analysis.dailyProcessTotals||[]){const [p,d,process]=JSON.parse(key);if((!filters.product||p===filters.product)&&(!filters.date||d===filters.date))ensure(process,process);}
 for(const row of records)if(dimension)ensure(row[dimension],dimension==='product'?row.ic+'／'+row.model:row[dimension]).count++;
 const groups=[...groupMap.values()].map(group=>{const input=cohortInput(analysis,{...filters,[dimension]:group.key});return {...group,input,rate:input?group.count/input:null,contribution:analysis.total?group.count/analysis.total:0};});
 if(dimension!=='date')groups.sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
 return {dimension,groups,records,input:cohortInput(analysis,filters),count:records.length,contribution:analysis.total?records.length/analysis.total:0};
}
export function allDefectLevels(analysis){
 const groups=new Map();
 for(const row of analysis.attribution){const path={};for(const dimension of dimensions){path[dimension]=row[dimension];const key=JSON.stringify(path),item=groups.get(key)||{...path,level:dimension,count:0,ic:row.ic,model:row.model};item.count++;groups.set(key,item);}}
 return [...groups.values()].map(row=>{const input=cohortInput(analysis,row);return {...row,input,rate:input?row.count/input:null,contribution:analysis.total?row.count/analysis.total:0};}).sort((a,b)=>a.ic.localeCompare(b.ic)||a.model.localeCompare(b.model)||(a.date||'').localeCompare(b.date||'')||(a.process||'').localeCompare(b.process||'')||(a.defect||'').localeCompare(b.defect||''));
}
