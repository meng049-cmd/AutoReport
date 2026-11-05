import {isStageProcess,summarizeStage} from './stage-metrics.mjs';
export const dimensions=['product','date','process','defect'];
export const dimensionNames={product:'產品',date:'日期',process:'製程',defect:'不良項目'};
export function defectDimensions(first='product'){if(first==='date')return ['date','process','defect','product'];return ['product','defect'].includes(first)?[first,...dimensions.filter(key=>key!==first)]:[...dimensions];}
export const usesGroupInputRate=dimension=>['date','process','defect'].includes(dimension);
export const defectChartValue=(group,dimension)=>usesGroupInputRate(dimension)?group.rate:group.contribution;
export const defectKey=(_process,defect)=>defect;
export function parseDefectKey(value){return typeof value==='string'&&value?{defect:value}:null;}
export function defectFilterLabel(value){return parseDefectKey(value)?.defect||value||'';}
function processScope(filters){return filters;}
export function defectOptions(analysis,filters={}){
 const map=new Map();for(const row of attributedRows(analysis,{...filters,defect:''})){const key=row.defect;map.set(key,[key,key]);}return [...map.values()].sort((a,b)=>a[1].localeCompare(b[1]));
}
const dayMs=86400000, iso=time=>new Date(time).toISOString().slice(0,10);
function weekYearStart(year){const jan11=Date.UTC(year,0,11);return jan11+((7-new Date(jan11).getUTCDay())%7)*dayMs;}
export function calendarDates(start,end){const dates=[];for(let time=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');Number.isFinite(time)&&time<=last;time+=dayMs)dates.push(iso(time));return dates;}
export function periodKey(date,mode='day'){
 if(mode==='month')return date.slice(0,7);if(mode!=='week')return date;
 const day=Date.parse(date+'T00:00:00Z'),weekStart=day-new Date(day).getUTCDay()*dayMs;let year=new Date(day).getUTCFullYear();if(weekStart<weekYearStart(year))year--;
 return year+'-W'+String(Math.floor((weekStart-weekYearStart(year))/(7*dayMs))+1).padStart(2,'0');
}
export function periodBounds(key,mode='day'){
 if(mode==='month'){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))return null;const [y,m]=key.split('-').map(Number);return {start:key+'-01',end:iso(Date.UTC(y,m,0))};}
 if(mode==='week'){if(!/^\d{4}-W\d{2}$/.test(key))return null;const [y,w]=key.split('-W').map(Number),start=weekYearStart(y)+(w-1)*7*dayMs;if(periodKey(iso(start),'week')!==key)return null;return {start:iso(start),end:iso(start+6*dayMs)};}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!Number.isFinite(Date.parse(key+'T00:00:00Z'))||iso(Date.parse(key+'T00:00:00Z'))!==key)return null;return {start:key,end:key};
}
export function periodLabel(key,mode='day'){
 if(mode!=='week')return key;const bounds=periodBounds(key,'week');if(!bounds)return key;return bounds.start.slice(0,4)===bounds.end.slice(0,4)?bounds.start.slice(5).replace('-','/')+'–'+bounds.end.slice(5).replace('-','/'):bounds.start.replaceAll('-','/')+'–'+bounds.end.replaceAll('-','/');
}
export function calendarBuckets(start,end,mode='day'){
 const map=new Map();for(const date of calendarDates(start,end)){const key=periodKey(date,mode);if(!map.has(key))map.set(key,{key,label:periodLabel(key,mode),...periodBounds(key,mode)});}return [...map.values()];
}
export function scopedBuckets(start,end,filters={}){const buckets=calendarBuckets(start,end,filters.granularity);return filters.granularity==='day'&&filters.days?.length?buckets.filter(bucket=>filters.days.includes(bucket.key)):buckets;}
export const orderName=value=>String(value??'').trim()||'【未填工單】';
export const dateFilterUnit=filters=>filters.dateUnit||filters.granularity||'day';
function matches(row,filters,ignoreDefect=false){return !filters.invalidProcess&&(!filters.stage||isStageProcess(row.process,filters.stage))&&(!filters.order||orderName(row.order)===filters.order)&&(!filters.startDate||row.date>=filters.startDate)&&(!filters.endDate||row.date<=filters.endDate)&&(!filters.days?.length||filters.days.includes(row.date))&&(!filters.date||periodKey(row.date,dateFilterUnit(filters))===filters.date)&&['product','process',...(ignoreDefect?[]:['defect'])].every(key=>!filters[key]||row[key]===filters[key]);}
export function attributedRows(analysis,filters={}){const scope=processScope(filters);return analysis.attribution.filter(row=>matches(row,scope));}
export function filteredObservations(analysis,filters={}){const scope=processScope(filters);return (analysis.observations||[]).filter(row=>matches(row,scope,true));}
/** Current-period quality uses actual scoped observations, with each PPID counted once. */
export function scopedQualitySummary(analysis,filters={}){
 const units=new Map();for(const row of filteredObservations(analysis,{...filters,defect:''}))units.set(row.serial,Boolean(units.get(row.serial)||row.fail));
 const total=units.size,fail=[...units.values()].filter(Boolean).length,good=total-fail;
 return {total,fail,good,yield:total?good/total:null,badRate:total?fail/total:null};
}
const cohortCaches=new WeakMap();
export function cohortInput(analysis,filters={}){
 filters=processScope(filters);if(filters.invalidProcess)return 0;
 let cache=cohortCaches.get(analysis);if(!cache){cache=new Map();cohortCaches.set(analysis,cache);}
 const granularity=filters.date?dateFilterUnit(filters):(filters.granularity||'day');
 const rangeKey=JSON.stringify([filters.startDate||'',filters.endDate||'',granularity,filters.order||'',filters.stage||'',filters.days||[]]);
 if(analysis.observations){let totals=cache.get(rangeKey);if(!totals){const sets=new Map();for(const row of analysis.observations){if(filters.stage&&!isStageProcess(row.process,filters.stage))continue;if(filters.order&&orderName(row.order)!==filters.order)continue;if((filters.startDate&&row.date<filters.startDate)||(filters.endDate&&row.date>filters.endDate)||(filters.days?.length&&!filters.days.includes(row.date)))continue;const bucket=periodKey(row.date,granularity);for(const product of ['',row.product])for(const date of ['',bucket])for(const process of ['',row.process]){const key=JSON.stringify([product,date,process]);let set=sets.get(key);if(!set){set=new Set();sets.set(key,set);}set.add(row.serial);}}totals=new Map([...sets].map(([key,set])=>[key,set.size]));cache.set(rangeKey,totals);}return totals.get(JSON.stringify([filters.product||'',filters.date||'',filters.process||'']))||0;}
 let count;if(!filters.date&&!filters.startDate&&!filters.endDate)count=filters.product?(filters.process?analysis.productProcesses.find(p=>p.product===filters.product&&p.process===filters.process)?.total:analysis.products.find(p=>p.id===filters.product)?.total):(filters.process?analysis.processes.find(p=>p.process===filters.process)?.total:analysis.total);
 else {count=0;const totals=filters.process?analysis.dailyProcessTotals:analysis.dailyProductTotals;for(const [key,total] of totals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))count+=total;}}
 return count||0;
}
const dateAuditCaches=new WeakMap();
export function dateInputAudits(analysis,filters={}){
 filters=processScope(filters);
 let cache=dateAuditCaches.get(analysis);if(!cache){cache=new Map();dateAuditCaches.set(analysis,cache);}
 const key=JSON.stringify([filters.startDate,filters.endDate,filters.granularity||'day',filters.product||'',filters.order||'',filters.process||'',filters.stage||'',filters.days||[]]);if(cache.has(key))return cache.get(key);
 const buckets=scopedBuckets(filters.startDate||analysis.start_date,filters.endDate||analysis.end_date,filters),sets=new Map(buckets.map(bucket=>[bucket.key,{units:new Set(),processes:new Map()}]));
 for(const row of filteredObservations(analysis,{...filters,date:'',defect:''})){const group=sets.get(periodKey(row.date,filters.granularity));if(!group)continue;group.units.add(row.serial);let process=group.processes.get(row.process);if(!process){process=new Set();group.processes.set(row.process,process);}process.add(row.serial);}
 const result=buckets.map(bucket=>{const group=sets.get(bucket.key),uniqueInput=group.units.size,processInputSum=[...group.processes.values()].reduce((sum,units)=>sum+units.size,0),input=cohortInput(analysis,{...filters,date:bucket.key});return {...bucket,uniqueInput,processInputSum,repeatedInput:processInputSum-uniqueInput,input,consistent:input===uniqueInput};});cache.set(key,result);return result;
}
export function defectBreakdown(analysis,filters={},dates=[],order=dimensions){
 const records=attributedRows(analysis,filters),dimension=order.find(key=>!filters[key])||null,groupMap=new Map();
 const ensure=(key,label,meta={})=>{if(!groupMap.has(key))groupMap.set(key,{key,label,count:0,...meta});return groupMap.get(key);};
 if(dimension==='product')for(const product of analysis.products)if(cohortInput(analysis,{...filters,product:product.id})||records.some(row=>row.product===product.id))ensure(product.id,product.ic+'／'+product.model);
 if(dimension==='date'){const start=filters.startDate||dates[0]||analysis.start_date,end=filters.endDate||dates.at(-1)||analysis.end_date;for(const bucket of scopedBuckets(start,end,filters))ensure(bucket.key,bucket.label);}
 if(dimension==='process'){if(analysis.observations)for(const row of filteredObservations(analysis,filters))ensure(row.process,row.process);else for(const [key] of analysis.dailyProcessTotals||[]){const [product,date,process]=JSON.parse(key);if(matches({product,date,process},filters,true))ensure(process,process);}}
 for(const row of records)if(dimension){const key=dimension==='date'?periodKey(row.date,filters.granularity):dimension==='defect'?row.defect:row[dimension],label=dimension==='product'?row.ic+'／'+row.model:dimension==='defect'?row.defect:key;ensure(key,label,dimension==='defect'?{defect:row.defect}:{}).count++;}
 const groups=[...groupMap.values()].map(group=>{const input=cohortInput(analysis,{...filters,[dimension]:group.key,...(dimension==='date'?{dateUnit:filters.granularity}:null)});return {...group,input,rate:input?group.count/input:null,contribution:analysis.total?group.count/analysis.total:0};}).filter(group=>dimension!=='date'||group.input>0);
 if(dimension!=='date')groups.sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
 return {dimension,groups,records,input:cohortInput(analysis,filters),count:records.length,contribution:analysis.total?records.length/analysis.total:0};
}
export function allDefectLevels(analysis,filters={},order=dimensions){
 const groups=new Map();for(const row of attributedRows(analysis,filters)){const path={};for(const dimension of order){path[dimension]=dimension==='date'?periodKey(row.date,filters.granularity):row[dimension];const key=JSON.stringify(path),item=groups.get(key)||{...path,level:dimension,count:0,ic:path.product?row.ic:'全部產品',model:path.product?row.model:'全部機種'};item.count++;groups.set(key,item);}}
 return [...groups.values()].map(row=>{const input=cohortInput(analysis,{...filters,...row,process:row.process||row.defectProcess||filters.process});return {...row,input,rate:input?row.count/input:null,contribution:analysis.total?row.count/analysis.total:0};}).sort((a,b)=>{for(const key of order){const difference=(a[key]||'').localeCompare(b[key]||'');if(difference)return difference;}return 0;});
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
 if(filters.stage)return stageDefectTrend(analysis,filters);
 const buckets=scopedBuckets(filters.startDate||analysis.start_date,filters.endDate||analysis.end_date,filters),inputs=new Map(buckets.map(b=>[b.key,new Set()])),counts=new Map(),bad=new Map(),items=new Set(),scope={...filters,date:'',defect:''};
 for(const row of filteredObservations(analysis,scope))inputs.get(periodKey(row.date,filters.granularity))?.add(row.serial);
 for(const row of attributedRows(analysis,scope)){if(filters.defect&&row.defect!==filters.defect)continue;const key=periodKey(row.date,filters.granularity);items.add(row.defect);const group=counts.get(row.defect)||new Map();group.set(key,(group.get(key)||0)+1);counts.set(row.defect,group);bad.set(key,(bad.get(key)||0)+1);}
 if(filters.defect)items.add(filters.defect);
 const dates=buckets.map(b=>({...b,input:inputs.get(b.key).size,count:bad.get(b.key)||0,rate:inputs.get(b.key).size?(bad.get(b.key)||0)/inputs.get(b.key).size:null})).filter(date=>date.input>0);
 const series=[...items].sort().map(defect=>({defect,points:dates.map(b=>({...b,count:counts.get(defect)?.get(b.key)||0,rate:b.input?(counts.get(defect)?.get(b.key)||0)/b.input:null}))}));
 return {dates,series};
}
export function selectTrendSeries(trend,names){
 const selected=names==null?null:new Set(names),series=trend.series.filter(item=>selected==null||selected.has(item.key||item.defect));
 if(trend.method==='process-denominator')return {...trend,series};
 const dates=trend.dates.map((date,index)=>{const count=series.reduce((sum,item)=>sum+(item.points[index]?.count||0),0);return {...date,count,rate:date.input?series.reduce((sum,item)=>sum+(item.points[index]?.rate||0),0):null,uniqueRate:date.input?count/date.input:null};});
 return {...trend,dates,series};
}
export function orderStageSeries(analysis,stage,filters={},dates=[]){
 const rows=filteredObservations(analysis,{...filters,date:'',process:'',defect:'',stage});
 return dates.map(date=>({date,...summarizeStage(rows.filter(row=>row.date===date),stage)}));
}
/** Compare both stages for each visible day/week/month, pooling products before process means. */
export function stageComparisonRows(analysis,filters={}){
 const buckets=scopedBuckets(filters.startDate||analysis.start_date,filters.endDate||analysis.end_date,filters),rows=filteredObservations(analysis,{...filters,date:'',defect:''}),groups=new Map();
 for(const row of rows){const key=periodKey(row.date,filters.granularity),group=groups.get(key)||[];group.push(row);groups.set(key,group);}
 return buckets.flatMap(bucket=>(['前段','後段'].includes(filters.stage)?[filters.stage]:['前段','後段']).map(stage=>({...bucket,stage,...summarizeStage(groups.get(bucket.key)||[],stage)}))).filter(row=>row.input>0);
}

export function addTrendProcessUnit(units,row){
 const old=units.get(row.serial);
 if(!old||(!old.fail&&row.fail)||(row.fail&&row.status==='FAIL'&&old.status!=='FAIL'))units.set(row.serial,row);
}
export const trendDefectName=row=>row.defect||'【未填不良項目】';

/** Use the same PPID selection as each plotted period, then deduplicate the detail range. */
export function trendProductBreakdown(analysis,filters,series,bucket){
 const scope={...filters,date:bucket?.key||'',defect:'',process:series.process||filters.process};
 const products=new Map(analysis.products.map(product=>[product.id,product])),groups=new Map();
 function groupFor(row){
  if(!groups.has(row.product)){
   const product=products.get(row.product);
   groups.set(row.product,{ic:product?.ic||row.ic||'【待補 IC】',model:product?.model||row.model||'【待補機種】',inputs:new Set(),defects:new Set()});
  }
  return groups.get(row.product);
 }
 const rows=filteredObservations(analysis,scope);
 if(series.process){
  const periods=new Map();
  for(const row of rows){
   if(row.attributionOnly)continue;
   const key=periodKey(row.date,scope.granularity);
   if(!periods.has(key))periods.set(key,new Map());
   addTrendProcessUnit(periods.get(key),row);
  }
  for(const units of periods.values())for(const row of units.values()){
   const group=groupFor(row);
   group.inputs.add(row.serial);
   if(row.fail&&trendDefectName(row)===series.defectName)group.defects.add(row.serial);
  }
 }else{
  for(const row of rows)groupFor(row).inputs.add(row.serial);
  for(const row of attributedRows(analysis,{...scope,defect:series.defect}))groupFor(row).defects.add(row.serial);
 }
 return [...groups.values()].filter(group=>group.defects.size).map(({ic,model,inputs,defects})=>({
  ic,model,input:inputs.size,count:defects.size,rate:inputs.size?defects.size/inputs.size:null
 })).sort((a,b)=>b.count-a.count||a.model.localeCompare(b.model,'zh-Hant')||a.ic.localeCompare(b.ic,'zh-Hant'));
}

function stageDefectTrend(analysis,filters){
 const buckets=scopedBuckets(filters.startDate||analysis.start_date,filters.endDate||analysis.end_date,filters),rows=filteredObservations(analysis,{...filters,date:'',defect:''}),groups=new Map(),definitions=new Map();
 for(const row of rows){if(row.attributionOnly||!isStageProcess(row.process,filters.stage))continue;const key=periodKey(row.date,filters.granularity),group=groups.get(key)||[];group.push(row);groups.set(key,group);}
 const data=buckets.map(bucket=>{const rows=groups.get(bucket.key)||[],metrics=summarizeStage(rows,filters.stage),processes=new Map(),counts=new Map();
  for(const row of rows){const units=processes.get(row.process)||new Map();addTrendProcessUnit(units,row);processes.set(row.process,units);}
  for(const [process,units] of processes)for(const row of units.values())if(row.fail){const defectName=trendDefectName(row),key=JSON.stringify([process,defectName]);definitions.set(key,{key,process,defectName,item:defectName,defect:process+'｜'+defectName});counts.set(key,(counts.get(key)||0)+1);}
  return {...bucket,...metrics,rate:null,counts,processes};
 }).filter(date=>date.input>0);
 const series=[...definitions].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,definition])=>({...definition,points:data.map(({counts,processes,...row})=>{const input=processes.get(definition.process)?.size||0,count=counts.get(key)||0;return {...row,scopeInput:row.input,input,count,rate:input?count/input:null,uniqueRate:input?count/input:null};})}));
 return {dates:data.map(({counts,processes,...row})=>row),series,method:'process-denominator'};
}
export function stageComparisonSheet(analysis,filters={}){
 return {name:'階段良率比較',rows:[['日期區間','階段','採用：AGGREGATE製程平均良率','唯一PPID良率（比較）','差異（平均減唯一，百分點）','唯一投入PPID','唯一不良PPID','唯一PPID不良率','有效製程數'],...stageComparisonRows(analysis,filters).map(row=>[row.label,row.stage,row.value,row.uniqueYield,row.difference==null?null:row.difference*100,row.input,row.count,row.uniqueBadRate,row.processCount])],percentColumns:[2,3,7]};
}
