export const dimensions=['product','date','process','defect'];
export const dimensionNames={product:'產品',date:'日期',process:'製程',defect:'不良項目'};
export function defectDimensions(first='product'){return ['product','defect','date'].includes(first)?[first,...dimensions.filter(key=>key!==first)]:[...dimensions];}
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
export const orderName=value=>String(value??'').trim()||'【未填工單】';
function matches(row,filters,ignoreDefect=false){return (!filters.order||orderName(row.order)===filters.order)&&(!filters.startDate||row.date>=filters.startDate)&&(!filters.endDate||row.date<=filters.endDate)&&(!filters.date||periodKey(row.date,filters.granularity)===filters.date)&&['product','process',...(ignoreDefect?[]:['defect'])].every(key=>!filters[key]||row[key]===filters[key]);}
export function attributedRows(analysis,filters={}){return analysis.attribution.filter(row=>matches(row,filters));}
export function filteredObservations(analysis,filters={}){return (analysis.observations||[]).filter(row=>matches(row,filters,true));}
const cohortCaches=new WeakMap();
export function cohortInput(analysis,filters={}){
 let cache=cohortCaches.get(analysis);if(!cache){cache=new Map();cohortCaches.set(analysis,cache);}
 const rangeKey=JSON.stringify([filters.startDate||'',filters.endDate||'',filters.granularity||'day',filters.order||'']);
 if(analysis.observations){let totals=cache.get(rangeKey);if(!totals){const sets=new Map();for(const row of analysis.observations){if(filters.order&&orderName(row.order)!==filters.order)continue;if((filters.startDate&&row.date<filters.startDate)||(filters.endDate&&row.date>filters.endDate))continue;const bucket=periodKey(row.date,filters.granularity);for(const product of ['',row.product])for(const date of ['',bucket])for(const process of ['',row.process]){const key=JSON.stringify([product,date,process]);let set=sets.get(key);if(!set){set=new Set();sets.set(key,set);}set.add(row.serial);}}totals=new Map([...sets].map(([key,set])=>[key,set.size]));cache.set(rangeKey,totals);}return totals.get(JSON.stringify([filters.product||'',filters.date||'',filters.process||'']))||0;}
 let count;if(!filters.date&&!filters.startDate&&!filters.endDate)count=filters.product?(filters.process?analysis.productProcesses.find(p=>p.product===filters.product&&p.process===filters.process)?.total:analysis.products.find(p=>p.id===filters.product)?.total):(filters.process?analysis.processes.find(p=>p.process===filters.process)?.total:analysis.total);
 else {count=0;const totals=filters.process?analysis.dailyProcessTotals:analysis.dailyProductTotals;for(const [key,total] of totals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))count+=total;}}
 return count||0;
}
export function defectBreakdown(analysis,filters={},dates=[],order=dimensions){
 const records=attributedRows(analysis,filters),dimension=order.find(key=>!filters[key])||null,groupMap=new Map();
 const ensure=(key,label)=>{if(!groupMap.has(key))groupMap.set(key,{key,label,count:0});return groupMap.get(key);};
 if(dimension==='product')for(const product of analysis.products)if(cohortInput(analysis,{...filters,product:product.id})||records.some(row=>row.product===product.id))ensure(product.id,product.ic+'／'+product.model);
 if(dimension==='date'){const start=filters.startDate||dates[0]||analysis.start_date,end=filters.endDate||dates.at(-1)||analysis.end_date;for(const bucket of calendarBuckets(start,end,filters.granularity))ensure(bucket.key,bucket.label);}
 if(dimension==='process'){if(analysis.observations)for(const row of filteredObservations(analysis,filters))ensure(row.process,row.process);else for(const [key] of analysis.dailyProcessTotals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))ensure(process,process);}}
 for(const row of records)if(dimension){const key=dimension==='date'?periodKey(row.date,filters.granularity):row[dimension];ensure(key,dimension==='product'?row.ic+'／'+row.model:key).count++;}
 const groups=[...groupMap.values()].map(group=>{const input=cohortInput(analysis,{...filters,[dimension]:group.key});return {...group,input,rate:input?group.count/input:null,contribution:analysis.total?group.count/analysis.total:0};});
 if(dimension!=='date')groups.sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
 return {dimension,groups,records,input:cohortInput(analysis,filters),count:records.length,contribution:analysis.total?records.length/analysis.total:0};
}
export function allDefectLevels(analysis,filters={},order=dimensions){
 const groups=new Map();for(const row of attributedRows(analysis,filters)){const path={};for(const dimension of order){path[dimension]=dimension==='date'?periodKey(row.date,filters.granularity):row[dimension];const key=JSON.stringify(path),item=groups.get(key)||{...path,level:dimension,count:0,ic:path.product?row.ic:'全部產品',model:path.product?row.model:'全部機種'};item.count++;groups.set(key,item);}}
 return [...groups.values()].map(row=>{const input=cohortInput(analysis,{...filters,...row});return {...row,input,rate:input?row.count/input:null,contribution:analysis.total?row.count/analysis.total:0};}).sort((a,b)=>{for(const key of order){const difference=(a[key]||'').localeCompare(b[key]||'');if(difference)return difference;}return 0;});
}
export function workOrderRows(analysis,filters={}){
 const groups=new Map();for(const row of attributedRows(analysis,filters)){const key=JSON.stringify([row.product,row.order||'']),group=groups.get(key)||{product:row.product,ic:row.ic,model:row.model,order:row.order||'【未填工單】',count:0,dates:new Set(),defects:new Set(),units:new Set()};group.count++;group.units.add(row.serial);group.dates.add(row.date);group.defects.add(row.defect);groups.set(key,group);}
 for(const row of filteredObservations(analysis,filters)){const group=groups.get(JSON.stringify([row.product,row.order||'']));if(group)group.units.add(row.serial);}
 return [...groups.values()].map(group=>({...group,input:group.units.size,dates:[...group.dates].sort().join('、'),defects:[...group.defects].join('；'),contribution:analysis.total?group.count/analysis.total:0,units:undefined})).sort((a,b)=>b.count-a.count||a.order.localeCompare(b.order));
}


export function orderYieldRows(analysis,filters={}){
 const scope={...filters,defect:''},groups=new Map(),products=new Map(analysis.products.map(p=>[p.id,p]));
 const groupFor=row=>{const order=orderName(row.order),key=JSON.stringify([order,row.product]);if(!groups.has(key)){const p=products.get(row.product);groups.set(key,{order,product:row.product,ic:p?.ic||row.ic,model:p?.model||row.model,units:new Set(),bad:new Set(),dates:new Set()});}return groups.get(key);};
 for(const row of filteredObservations(analysis,scope)){const g=groupFor(row);g.units.add(row.serial);g.dates.add(row.date);}
 for(const row of attributedRows(analysis,scope)){const g=groupFor(row);g.units.add(row.serial);g.bad.add(row.serial);g.dates.add(row.date);}
 return [...groups.values()].map(g=>{const total=g.units.size,fail=g.bad.size,dates=[...g.dates].sort();return {order:g.order,product:g.product,ic:g.ic,model:g.model,total,good:total-fail,fail,yield:total?(total-fail)/total:null,badRate:total?fail/total:null,start:dates[0],end:dates.at(-1)};}).sort((a,b)=>b.fail-a.fail||a.order.localeCompare(b.order)||a.model.localeCompare(b.model));
}
export function defectTrend(analysis,filters={}){
 const buckets=calendarBuckets(filters.startDate||analysis.start_date,filters.endDate||analysis.end_date,filters.granularity),inputs=new Map(buckets.map(b=>[b.key,new Set()])),counts=new Map(),bad=new Map(),items=new Set(),scope={...filters,date:'',defect:''};
 for(const row of filteredObservations(analysis,scope))inputs.get(periodKey(row.date,filters.granularity))?.add(row.serial);
 for(const row of attributedRows(analysis,scope)){if(filters.defect&&row.defect!==filters.defect)continue;const key=periodKey(row.date,filters.granularity);items.add(row.defect);const group=counts.get(row.defect)||new Map();group.set(key,(group.get(key)||0)+1);counts.set(row.defect,group);bad.set(key,(bad.get(key)||0)+1);}
 if(filters.defect)items.add(filters.defect);
 const dates=buckets.map(b=>({...b,input:inputs.get(b.key).size,count:bad.get(b.key)||0,rate:inputs.get(b.key).size?(bad.get(b.key)||0)/inputs.get(b.key).size:null}));
 const series=[...items].sort().map(defect=>({defect,points:dates.map(b=>({...b,count:counts.get(defect)?.get(b.key)||0,rate:b.input?(counts.get(defect)?.get(b.key)||0)/b.input:null}))}));
 return {dates,series};
}
export function selectTrendSeries(trend,names){
 const selected=names==null?null:new Set(names),series=trend.series.filter(item=>selected==null||selected.has(item.defect));
 const dates=trend.dates.map((date,index)=>{const count=series.reduce((sum,item)=>sum+(item.points[index]?.count||0),0);return {...date,count,rate:date.input?count/date.input:null};});
 return {...trend,dates,series};
}
export function orderStageSeries(analysis,stage,filters={},dates=[]){
 const processes=stage==='前段'?['DAF外觀','DAF熱壓投入','功能一測試']:['功能二測試','外觀檢查點亮測試','輝度機測試'],groups=new Map();
 for(const row of filteredObservations(analysis,{...filters,date:'',process:'',defect:''})){if(!processes.includes(row.process))continue;const key=JSON.stringify([row.date,row.product,row.process]),g=groups.get(key)||{date:row.date,product:row.product,units:new Map()};g.units.set(row.serial,Boolean(g.units.get(row.serial)||row.fail));groups.set(key,g);}
 const products=new Map();for(const g of groups.values()){const key=JSON.stringify([g.date,g.product]),values=products.get(key)||[];values.push([...g.units.values()].filter(fail=>!fail).length/g.units.size);products.set(key,values);}
 const days=new Map();for(const [key,values] of products){const [date]=JSON.parse(key),items=days.get(date)||[];items.push(values.reduce((sum,v)=>sum+v,0)/values.length);days.set(date,items);}
 return dates.map(date=>{const values=days.get(date)||[];return {date,value:values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null};});
}
