export const dimensions=['product','date','process','defect'];
export const dimensionNames={product:'產品',date:'日期',process:'製程',defect:'不良項目'};
const dayMs=86400000, iso=time=>new Date(time).toISOString().slice(0,10);
export function calendarDates(start,end){const dates=[];for(let time=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');Number.isFinite(time)&&time<=last;time+=dayMs)dates.push(iso(time));return dates;}
export function periodKey(date,mode='day'){
 if(mode==='month')return date.slice(0,7);if(mode!=='week')return date;
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),week=Math.ceil(((d-Date.UTC(year,0,1))/dayMs+1)/7);return year+'-W'+String(week).padStart(2,'0');
}
export function periodBounds(key,mode='day'){
 if(mode==='month'){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))return null;const [y,m]=key.split('-').map(Number);return {start:key+'-01',end:iso(Date.UTC(y,m,0))};}
 if(mode==='week'){if(!/^\d{4}-W\d{2}$/.test(key))return null;const [y,w]=key.split('-W').map(Number),jan4=new Date(Date.UTC(y,0,4)),start=Date.UTC(y,0,4)-(jan4.getUTCDay()+6)%7*dayMs+(w-1)*7*dayMs;if(periodKey(iso(start),'week')!==key)return null;return {start:iso(start),end:iso(start+6*dayMs)};}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!Number.isFinite(Date.parse(key+'T00:00:00Z'))||iso(Date.parse(key+'T00:00:00Z'))!==key)return null;return {start:key,end:key};
}
export function periodLabel(key,mode='day'){
 if(mode!=='week')return key;const bounds=periodBounds(key,'week');if(!bounds)return key;return bounds.start.slice(0,4)===bounds.end.slice(0,4)?bounds.start.slice(5).replace('-','/')+'–'+bounds.end.slice(5).replace('-','/'):bounds.start.replaceAll('-','/')+'–'+bounds.end.replaceAll('-','/');
}
export function calendarBuckets(start,end,mode='day'){
 const map=new Map();for(const date of calendarDates(start,end)){const key=periodKey(date,mode);if(!map.has(key))map.set(key,{key,label:periodLabel(key,mode),...periodBounds(key,mode)});}return [...map.values()];
}
function matches(row,filters,ignoreDefect=false){return (!filters.startDate||row.date>=filters.startDate)&&(!filters.endDate||row.date<=filters.endDate)&&(!filters.date||periodKey(row.date,filters.granularity)===filters.date)&&['product','process',...(ignoreDefect?[]:['defect'])].every(key=>!filters[key]||row[key]===filters[key]);}
export function attributedRows(analysis,filters={}){return analysis.attribution.filter(row=>matches(row,filters));}
export function filteredObservations(analysis,filters={}){return (analysis.observations||[]).filter(row=>matches(row,filters,true));}
const cohortCaches=new WeakMap();
export function cohortInput(analysis,filters={}){
 let cache=cohortCaches.get(analysis);if(!cache){cache=new Map();cohortCaches.set(analysis,cache);}
 const rangeKey=JSON.stringify([filters.startDate||'',filters.endDate||'',filters.granularity||'day']);
 if(analysis.observations){let totals=cache.get(rangeKey);if(!totals){const sets=new Map();for(const row of analysis.observations){if((filters.startDate&&row.date<filters.startDate)||(filters.endDate&&row.date>filters.endDate))continue;const bucket=periodKey(row.date,filters.granularity);for(const product of ['',row.product])for(const date of ['',bucket])for(const process of ['',row.process]){const key=JSON.stringify([product,date,process]);let set=sets.get(key);if(!set){set=new Set();sets.set(key,set);}set.add(row.serial);}}totals=new Map([...sets].map(([key,set])=>[key,set.size]));cache.set(rangeKey,totals);}return totals.get(JSON.stringify([filters.product||'',filters.date||'',filters.process||'']))||0;}
 let count;if(!filters.date&&!filters.startDate&&!filters.endDate)count=filters.product?(filters.process?analysis.productProcesses.find(p=>p.product===filters.product&&p.process===filters.process)?.total:analysis.products.find(p=>p.id===filters.product)?.total):(filters.process?analysis.processes.find(p=>p.process===filters.process)?.total:analysis.total);
 else {count=0;const totals=filters.process?analysis.dailyProcessTotals:analysis.dailyProductTotals;for(const [key,total] of totals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))count+=total;}}
 return count||0;
}
export function defectBreakdown(analysis,filters={},dates=[]){
 const records=attributedRows(analysis,filters),dimension=dimensions.find(key=>!filters[key])||null,groupMap=new Map();
 const ensure=(key,label)=>{if(!groupMap.has(key))groupMap.set(key,{key,label,count:0});return groupMap.get(key);};
 if(dimension==='product')for(const product of analysis.products)ensure(product.id,product.ic+'／'+product.model);
 if(dimension==='date'){const start=filters.startDate||dates[0]||analysis.start_date,end=filters.endDate||dates.at(-1)||analysis.end_date;for(const bucket of calendarBuckets(start,end,filters.granularity))ensure(bucket.key,bucket.label);}
 if(dimension==='process'){if(analysis.observations)for(const row of filteredObservations(analysis,filters))ensure(row.process,row.process);else for(const [key] of analysis.dailyProcessTotals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))ensure(process,process);}}
 for(const row of records)if(dimension){const key=dimension==='date'?periodKey(row.date,filters.granularity):row[dimension];ensure(key,dimension==='product'?row.ic+'／'+row.model:key).count++;}
 const groups=[...groupMap.values()].map(group=>{const input=cohortInput(analysis,{...filters,[dimension]:group.key});return {...group,input,rate:input?group.count/input:null,contribution:analysis.total?group.count/analysis.total:0};});
 if(dimension!=='date')groups.sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
 return {dimension,groups,records,input:cohortInput(analysis,filters),count:records.length,contribution:analysis.total?records.length/analysis.total:0};
}
export function allDefectLevels(analysis,filters={}){
 const groups=new Map();for(const row of attributedRows(analysis,filters)){const path={};for(const dimension of dimensions){path[dimension]=dimension==='date'?periodKey(row.date,filters.granularity):row[dimension];const key=JSON.stringify(path),item=groups.get(key)||{...path,level:dimension,count:0,ic:row.ic,model:row.model};item.count++;groups.set(key,item);}}
 return [...groups.values()].map(row=>{const input=cohortInput(analysis,{...filters,...row});return {...row,input,rate:input?row.count/input:null,contribution:analysis.total?row.count/analysis.total:0};}).sort((a,b)=>a.ic.localeCompare(b.ic)||a.model.localeCompare(b.model)||(a.date||'').localeCompare(b.date||'')||(a.process||'').localeCompare(b.process||'')||(a.defect||'').localeCompare(b.defect||''));
}
export function workOrderRows(analysis,filters={}){
 const groups=new Map();for(const row of attributedRows(analysis,filters)){const key=JSON.stringify([row.product,row.order||'']),group=groups.get(key)||{product:row.product,ic:row.ic,model:row.model,order:row.order||'【未填工單】',count:0,dates:new Set(),defects:new Set(),units:new Set()};group.count++;group.units.add(row.serial);group.dates.add(row.date);group.defects.add(row.defect);groups.set(key,group);}
 for(const row of filteredObservations(analysis,filters)){const group=groups.get(JSON.stringify([row.product,row.order||'']));if(group)group.units.add(row.serial);}
 return [...groups.values()].map(group=>({...group,input:group.units.size,dates:[...group.dates].sort().join('、'),defects:[...group.defects].join('；'),contribution:analysis.total?group.count/analysis.total:0,units:undefined})).sort((a,b)=>b.count-a.count||a.order.localeCompare(b.order));
}
