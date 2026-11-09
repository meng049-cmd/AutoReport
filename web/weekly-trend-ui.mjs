import {periods} from './detail-index.mjs';
import {getWeeklyTrendCache,saveWeeklyTrendCache} from './analysis-cache.mjs';
import {createDefectTrendWorkbook,trendColors} from './chart-export.mjs';
import {renderTrendProductChart} from './quality-extras.mjs';
import {poolTrendCounts} from './defect-analysis.mjs';
import {createTrendPicker} from './trend-picker.mjs';

const $=id=>document.getElementById(id);
const number=value=>value==null?'—':value.toLocaleString();
const percent=value=>value==null?'—':(value*100).toFixed(2)+'%';
const DAY=86400000;
let results=[],sourceFiles=[],selection=new Set(),available=[],trend,controller,mode='week',productDetail;
const hidden=new Set();
const unitLabel=()=>mode==='day'?'日':'週';
const periodLabel=()=>mode==='day'?'當日':'本週';
const productPicker = createTrendPicker($('weeklyTrendProduct'), '產品', changeTrendScope);
const processPicker = createTrendPicker($('weeklyTrendProcess'), '製程', changeTrendScope);
function changeTrendScope() {
 updateAvailable(selection);
}


function buildJobs(range,sources,unit){
 const jobs=new Map();
 function jobFor(bucket){
  if(!jobs.has(bucket.key)){
   const start=bucket.start_date<range.start_date?range.start_date:bucket.start_date;
   const end=bucket.end_date>range.end_date?range.end_date:bucket.end_date;
   const label=unit==='day'?bucket.key:bucket.key.replace('_w','-W').replace(/_$/,'');
   jobs.set(bucket.key,{period:{start_date:start,end_date:end},label,sources:[]});
  }
  return jobs.get(bucket.key);
 }
 if(unit==='week')for(let date=range.start_date;date<=range.end_date;){
  const week=periods.periodFor(date,unit);
  jobFor(week);
  date=new Date(Date.parse(week.end_date+'T00:00:00Z')+DAY).toISOString().slice(0,10);
 }
 for(const {id,key,name,dayCounts} of sources){
  const counts=new Map();
  for(const [day,count] of Object.entries(dayCounts||{})){
   if(!count||!periods.contains(range,day))continue;
   const job=jobFor(periods.periodFor(day,unit));
   counts.set(job,(counts.get(job)||0)+count);
  }
  for(const [job,rows] of counts)job.sources.push({id,key,name,rows});
 }
 return [...jobs.values()].sort((a,b)=>a.period.start_date.localeCompare(b.period.start_date));
}
function calculate(job,skipInvalidRows,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./weekly-trend-worker.js?v='+__BUILD_ID__,import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(signal.reason);};
  signal.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data})=>{cleanup();data.error?reject(Error(data.error)):resolve(data);};
  worker.onerror=()=>{cleanup();reject(Error(periodLabel()+'計算未完成，請確認來源檔及瀏覽器可用記憶體。'));};
  worker.postMessage({period:job.period,sources:job.sources,skipInvalidRows,mode});
 });
}

export async function runWeeklyTrend(range,sources,files,{skipInvalidRows=false,unit='week',preserveFilters=false}={}){
 if(controller)return;
 mode=unit==='day'?'day':'week';
 const axis=unitLabel(),title=mode==='day'?'日推移':'跨週推移';
 controller=new AbortController();
 const {signal}=controller,progress=$('weeklyTrendStatus'),cancel=$('weeklyTrendCancel');
 cancel.hidden=false;cancel.disabled=false;
 $('weeklyTrendResult').hidden=true;
 sourceFiles=files;
 const completed=[];
 let jobs=[],fromCache=0,temporary=0,failure='';
 try{
  jobs=buildJobs(range,sources,mode);
  for(const [i,job] of jobs.entries()){
   signal.throwIfAborted();
   progress.textContent=title+' '+(i+1)+'／'+jobs.length+'：'+job.label;
   const week={label:job.label,...job.period};
   if(!job.sources.length){completed.push({...week,status:'empty'});continue;}
   const cacheKey=JSON.stringify([job.period,skipInvalidRows,job.sources.map(source=>source.key)]);
   try{
    let data=await getWeeklyTrendCache(cacheKey);
    signal.throwIfAborted();
    if(data)fromCache++;
    else{
     data=await calculate(job,skipInvalidRows,signal);
     if(!await saveWeeklyTrendCache(cacheKey,data,job.sources.map(source=>source.id)))temporary++;
    }
    completed.push({...week,status:data.summary.input?'ready':'empty',...data});
   }catch(error){
    if(signal.aborted)break;
    completed.push({...week,status:'error',error:error.message});
   }
  }
 }catch(error){if(!signal.aborted)failure=error.message;}
 finally{controller=null;cancel.hidden=true;}
 if(failure){progress.textContent=failure;return;}
 results=jobs.map((job,i)=>completed[i]||{label:job.label,...job.period,status:'pending'});
 if(mode==='day')results=results.filter(period=>period.status!=='empty');
 if(!results.length){progress.textContent='所選期間沒有可顯示的日期。';return;}
 const counts=status=>results.filter(period=>period.status===status).length;
 progress.textContent=(signal.aborted?'已取消，保留已完成的摘要。':title+'已完成。')+' 有投入 '+counts('ready')+' '+axis+(mode==='week'?'，無投入 '+counts('empty')+' 週':'')+'，無法計算 '+counts('error')+' '+axis+'。'+(fromCache?' 已重用 '+fromCache+' '+axis+'摘要。':'')+(temporary?' '+temporary+' '+axis+'摘要暫存於本分頁。':'')+(results.some(period=>period.skipped)?' 有來源檔已略過錯誤列。':'');
 showResult(range,preserveFilters);
}

function setOptions(id,values,empty){
 const select=$(id),old=select.value;
 select.replaceChildren(...(empty?[['',empty],...values]:values).map(([key,label])=>{
  const option=document.createElement('option');option.value=key;option.textContent=label;return option;
 }));
 if([...select.options].some(option=>option.value===old))select.value=old;
}
function showResult(range,preserveFilters){
 const products=new Map(),processes=new Set(),warnings=$('weeklyTrendWarnings');
 warnings.replaceChildren();
 for(const week of results){
  if(week.status==='error'){
   const li=document.createElement('li');li.textContent=week.label+'：'+week.error;warnings.append(li);
  }
  for(const product of week.summary?.products||[])products.set(product.id,product.ic+'／'+product.model);
  for(const [process] of week.summary?.processes||[])processes.add(process);
 }
 warnings.parentElement.hidden=!warnings.children.length;
 const daily=mode==='day',axis=unitLabel();
 $('weeklyTrendTitle').textContent='不良率項目推移圖（'+axis+'）';
 $('weeklyTrendExport').textContent='下載'+(daily?'日推移':'跨週推移')+' Excel';
 $('weeklyTrendScope').textContent=range.start_date+' ～ '+range.end_date+' · 共 '+results.length+' '+axis;
 $('weeklyTrendPeriodLabel').textContent=daily?'日期':'週別';
 $('weeklyTrendDetailSummary').textContent=daily?'每日統計明細':'每週統計明細';
 $('weeklyTrendWeek').setAttribute('aria-label',daily?'日推移統計日期':'跨週統計明細週別');
 $('weeklyTrendChart').setAttribute('aria-label','逐'+axis+'不良率折線圖');
 $('weeklyTrendWarningsTitle').textContent=daily?'查看無法計算的日期':'查看無法計算的週';
 $('weeklyTrendHelp').textContent=daily
  ?'每天獨立去重。有投入但該項無不良時顯示 0%。沒有來源投入的日期略過，無法計算的日期留空。'
  :'每個週點獨立去重。該製程有投入、該項無不良時顯示 0%；無投入或未完成的週留空。';
 $('weeklyTrendHelp').textContent+=' 點圖例或圓點可查看機種／IC。';
 $('weeklyTrendExportError').hidden=true;
 if (!preserveFilters) hidden.clear();
 productPicker.setOptions([...products].sort((a,b) => a[1].localeCompare(b[1],'zh-Hant')), preserveFilters ? productPicker.selection : null);
 processPicker.setOptions([...processes].sort().map(process => [process,process]), preserveFilters ? processPicker.selection : null);
 setOptions('weeklyTrendWeek',results.map((week,i)=>[i,daily?week.label:week.label+'（'+week.start_date+' ～ '+week.end_date+'）']));
 $('weeklyTrendWeek').value=String(Math.max(0,results.findIndex(week=>week.status==='ready')));
 $('weeklyTrendPointDetails').open=false;
 $('weeklyTrendItems').open=false;
 $('weeklyTrendResult').hidden=false;
 updateAvailable(preserveFilters?selection:null);
}
function updateAvailable(previousSelection=null){
 const productIds = productPicker.selection, processNames = processPicker.selection;
 const definitions = new Map(), processInputs = new Map();
 for (const week of results) {
  week.groups = new Map();
  for (const [name,all] of week.summary?.processes || []) {
   if (processNames && !processNames.has(name)) continue;
   const group = productIds === null
    ? all
    : poolTrendCounts(all.products.filter(([id]) => productIds.has(id)).map(([,stats]) => stats));
   if (!group.input) continue;
   processInputs.set(name,(processInputs.get(name)||0)+group.input);
   const defects = new Map(group.defects);
   week.groups.set(name,{input:group.input,count:group.count,defects});
   for(const [defect,count] of defects){
    const key=JSON.stringify([name,defect]);
    if(!definitions.has(key))definitions.set(key,{key,process:name,defectName:defect,defect:name+'｜'+defect,total:0});
    definitions.get(key).total+=count;
   }
  }
 }
 available=[...definitions.values()].map(item=>({...item,rate:item.total/processInputs.get(item.process)})).sort((a,b)=>b.total-a.total||a.defect.localeCompare(b.defect,'zh-Hant'));
 if(!previousSelection)hidden.clear();
 const retained=previousSelection&&available.filter(item=>previousSelection.has(item.key));
 const displayed=retained&&(retained.length||!previousSelection.size)?retained:available.slice(0,5);
 if (available.length || !previousSelection) selection=new Set(displayed.map(item=>item.key));
 $('weeklyTrendSearch').value='';
 renderChoices();
 renderTrend();
}
function updateItemCount(){
 const chosen=available.filter(item=>selection.has(item.key));
 const visible=chosen.filter(item=>!hidden.has(item.key)).length;
 $('weeklyTrendItemCount').textContent='不良項目（已選 '+chosen.length+'／'+available.length+' · 顯示 '+visible+'）';
}
function renderChoices(){
 const host=$('weeklyTrendChoices'),query=$('weeklyTrendSearch').value.trim().toLowerCase();
 updateItemCount();
 host.replaceChildren();
 for(const item of available){
  if(query&&!item.defect.toLowerCase().includes(query))continue;
  const label=document.createElement('label'),check=document.createElement('input');
  check.type='checkbox';check.checked=selection.has(item.key);
  check.onchange=()=>{
   check.checked?selection.add(item.key):selection.delete(item.key);
   hidden.delete(item.key);
   updateItemCount();
   renderTrend();
  };
  label.append(check,item.defect);host.append(label);
 }
 if(!host.children.length)host.textContent=available.length?'沒有符合的項目。':'目前條件沒有不良項目。';
}
function renderTrend(){
 closeProductDetail();
 const productIds = productPicker.selection, processNames = processPicker.selection;
 const dates = results.map(week => {
  // Process summaries overlap in PPID. Only publish a combined total when it is exact.
  let group;
  if (processNames === null) {
   group = productIds === null ? week.summary : poolTrendCounts(week.summary?.products.filter(item => productIds.has(item.id)) || []);
  } else if (processNames.size === 1) {
   group = week.groups.get([...processNames][0]);
  }
  return {label:week.label,start:week.start_date,end:week.end_date,input:group?.input||null,count:group?.input?group.count:null,hasInput:week.groups.size>0,rate:null};
 });
 const chosen=available.flatMap((item,i)=>selection.has(item.key)?[{...item,color:trendColors[i%trendColors.length]}]:[]);
 const series=chosen.filter(item=>!hidden.has(item.key)).map(item=>({
  ...item,points:results.map((week,j)=>{
   const group=week.groups.get(item.process),input=group?.input||null,count=input?(group.defects.get(item.defectName)||0):null;
   return {...dates[j],input,count,rate:input?count/input:null};
  })
 }));
 for(const line of series)line.points.forEach((point,i)=>{
  if(point.rate!=null)dates[i].rate=Math.max(dates[i].rate??0,point.rate);
 });
 trend={dates,series,method:'process-denominator'};
 $('weeklyTrendExport').disabled=!series.length;
 drawChart(chosen);
 renderWeekDetail();
}
function drawChart(chosen){
 const canvas=$('weeklyTrendChart'),ctx=canvas.getContext('2d'),{dates,series}=trend,height=260,left=62,right=20,top=24,bottom=52;
 const width=Math.min(15000,Math.max(560,canvas.parentElement.clientWidth||0,dates.length*82+left+right));
 const ratio=Math.min(window.devicePixelRatio||1,2,16000/width),slot=(width-left-right)/dates.length;
 canvas.style.width=width+'px';canvas.style.height=height+'px';canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
 ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
 const maximum=Math.min(1,dates.reduce((max,date)=>Math.max(max,(date.rate||0)*1.12),.01));
 const x=i=>left+slot*(i+.5),y=rate=>top+(height-top-bottom)*(1-rate/maximum);
 ctx.font='11px system-ui';ctx.textAlign='right';
 for(let i=0;i<=5;i++){
  const rate=maximum*i/5,yy=y(rate);
  ctx.strokeStyle='#dce6ed';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();
  ctx.fillStyle='#536b7b';ctx.fillText(percent(rate),left-7,yy+4);
 }
 ctx.textAlign='center';
 const step=Math.max(1,Math.ceil((mode==='day'?78:62)/slot));
 for(let i=0;i<dates.length;i+=step){
  ctx.fillStyle=dates[i].hasInput?'#17324a':'#64778a';
  ctx.fillText(dates[i].label,x(i),height-(mode==='day'?20:29));
  if(mode==='week'&&slot>=76)ctx.fillText(dates[i].start.slice(5)+'～'+dates[i].end.slice(5),x(i),height-12);
 }
 for(const line of series){
  ctx.strokeStyle=line.color;ctx.fillStyle=line.color;ctx.lineWidth=2;
  ctx.beginPath();let connected=false;
  line.points.forEach(({rate},i)=>{
   if(rate==null){connected=false;return;}
   if(connected)ctx.lineTo(x(i),y(rate));else ctx.moveTo(x(i),y(rate));
   connected=true;
  });
  ctx.stroke();
  line.points.forEach(({rate},i)=>{
   if(rate==null)return;
   ctx.beginPath();ctx.arc(x(i),y(rate),3,0,Math.PI*2);ctx.fill();
  });
 }
 if(!series.length){
  ctx.fillStyle='#536b7b';
  ctx.fillText(chosen.length?'已選項目目前皆為 OFF。':available.length?'請選擇要顯示的不良項目。':'目前條件沒有可繪製的不良項目。',width/2,height/2);
 }
 renderLegend(chosen);
 canvas.onclick=event=>{
  const rect=canvas.getBoundingClientRect(),xx=event.clientX-rect.left,yy=event.clientY-rect.top;
  const i=Math.floor((xx-left)/slot);
  if(!dates[i])return;
  closeProductDetail();
  $('weeklyTrendWeek').value=String(i);
  $('weeklyTrendPointDetails').open=true;
  renderWeekDetail();
  let nearest=null,distance=10;
  for(const line of series){
   const rate=line.points[i].rate;
   if(rate==null)continue;
   const delta=Math.hypot(xx-x(i),yy-y(rate));
   if(delta<distance){nearest=line;distance=delta;}
  }
  if(nearest)openProductDetail(nearest,i);
 };
}
function renderLegend(chosen){
 const legend=$('weeklyTrendLegend');
 legend.replaceChildren();
 for(const line of chosen){
  const item=document.createElement('span'),details=document.createElement('button'),toggle=document.createElement('button'),dot=document.createElement('i');
  item.className='trend-legend-item';
  dot.style.backgroundColor=line.color;
  details.type=toggle.type='button';
  details.setAttribute('aria-controls','weeklyTrendMachineDetails');
  details.setAttribute('aria-expanded','false');
  details.append(dot,line.defect);
  details.onclick=()=>openProductDetail(line,null,details);
  const visible=!hidden.has(line.key);
  toggle.setAttribute('aria-pressed',String(visible));
  toggle.setAttribute('aria-label','顯示曲線：'+line.defect);
  toggle.textContent=visible?'ON':'OFF';
  toggle.dataset.seriesKey=line.key;
  toggle.onclick=()=>{
   if(hidden.has(line.key))hidden.delete(line.key);else hidden.add(line.key);
   updateItemCount();renderTrend();
   [...legend.querySelectorAll('button[data-series-key]')].find(button=>button.dataset.seriesKey===line.key)?.focus({preventScroll:true});
  };
  item.append(details,toggle);legend.append(item);
 }
}
function closeProductDetail(restoreFocus=false){
 $('weeklyTrendMachineDetails').hidden=true;
 productDetail?.trigger?.setAttribute('aria-expanded','false');
 if(restoreFocus)productDetail?.trigger?.focus();
 productDetail=null;
}
function openProductDetail(line,index,trigger){
 closeProductDetail();
 productDetail={line,trigger};
 trigger?.setAttribute('aria-expanded','true');
 const select=$('weeklyTrendMachinePeriod');
 setOptions('weeklyTrendMachinePeriod',[
  ['', '整段期間（各點合計）'],...results.map((period,i)=>[i,period.label])
 ]);
 select.value=index==null?'':String(index);
 $('weeklyTrendMachineHeading').textContent=line.defect+' 的機種／IC 明細';
 $('weeklyTrendMachineDetails').hidden=false;
 renderProductDetail();
 $('weeklyTrendMachineHeading').focus();
}
function renderProductDetail(){
 const host=$('weeklyTrendMachineTable'),scope=$('weeklyTrendMachineScope');
 host.replaceChildren();
 if(!productDetail)return;
 const {line}=productDetail,productIds=productPicker.selection,value=$('weeklyTrendMachinePeriod').value;
 const totals=value==='',periods=totals?results:[results[Number(value)]],groups=new Map();
 for(const period of periods){
  const process=period?.summary?.processes.find(([name])=>name===line.process)?.[1];
  if(!process)continue;
  const products=new Map(period.summary.products.map(product=>[product.id,product]));
  for(const [id,stats] of process.products){
   if(productIds&&!productIds.has(id))continue;
   let group=groups.get(id);
   if(!group){
    const product=products.get(id);
    group={ic:product?.ic||'【待補 IC】',model:product?.model||'【待補機種】',input:0,count:0};
    groups.set(id,group);
   }
   group.input+=stats.input;
   group.count+=stats.defects.find(([name])=>name===line.defectName)?.[1]||0;
  }
 }
 const rows=[...groups.values()].filter(row=>row.count).map(row=>({...row,rate:row.count/row.input}))
  .sort((a,b)=>b.count-a.count||a.model.localeCompare(b.model,'zh-Hant')||a.ic.localeCompare(b.ic,'zh-Hant'));
 const missing=periods.filter(period=>period?.status==='error'||period?.status==='pending').length;
 const label=totals?'各'+unitLabel()+'投入與不良分別加總，同一 PPID 跨'+unitLabel()+'可能重複。':periods[0]?.label||'';
 scope.textContent=label+(missing?' 有 '+missing+' '+unitLabel()+'未取得結果。':'')+(rows.length?' '+rows.length+' 組有此不良的機種／IC。':' 沒有可顯示的機種／IC 不良。');
 if(rows.length)renderTrendProductChart(rows,line.color,host,totals);
}
function renderWeekDetail(){
 const index=Number($('weeklyTrendWeek').value),week=results[index],host=$('weeklyTrendPointTable');
 host.replaceChildren();
 if(!week)return;
 const status=$('weeklyTrendPointStatus');
 if(week.status!=='ready'){
  status.textContent=periodLabel()+{empty:'無投入。',pending:'尚未計算。',error:'無法計算：'+week.error}[week.status];
  return;
 }
 const date=trend.dates[index],rows=trend.series.filter(line=>line.points[index].input);
 if (date.input) {
  status.textContent = '範圍唯一投入 '+number(date.input)+' PPID。'+(rows.length ? '' : periodLabel()+'沒有符合目前選擇的不良項目。');
 } else {
  status.textContent = date.hasInput ? '各製程的唯一投入 PPID 如下。' : '目前篩選條件在'+periodLabel()+'無投入。';
 }
 if(!rows.length)return;
 const table=document.createElement('table'),head=table.createTHead().insertRow(),body=table.createTBody();
 for(const title of ['製程','不良項目','投入 PPID','不良 PPID','不良率']){
  const th=document.createElement('th');th.scope='col';th.textContent=title;head.append(th);
 }
 for(const line of rows){
  const point=line.points[index],row=body.insertRow(),button=document.createElement('button');
  row.insertCell().textContent=line.process;
  button.type='button';button.className='secondary';button.textContent=line.defectName;
  button.setAttribute('aria-controls','weeklyTrendMachineDetails');button.setAttribute('aria-expanded','false');
  button.onclick=()=>openProductDetail(line,index,button);
  row.insertCell().append(button);
  for(const value of [number(point.input),number(point.count),percent(point.rate)])row.insertCell().textContent=value;
 }
 host.append(table);
}

$('weeklyTrendCancel').onclick=()=>{if(controller){$('weeklyTrendCancel').disabled=true;controller.abort();}};
$('weeklyTrendSearch').oninput=renderChoices;
$('weeklyTrendWeek').onchange=()=>{closeProductDetail();renderWeekDetail();};
$('weeklyTrendMachinePeriod').onchange=renderProductDetail;
$('weeklyTrendMachineClose').onclick=()=>closeProductDetail(true);
function selectItems(items){
 selection=new Set(items.map(item=>item.key));hidden.clear();renderChoices();renderTrend();
}
$('weeklyTrendCountTop').onclick=()=>selectItems(available.slice(0,5));
$('weeklyTrendRateTop').onclick=()=>selectItems([...available].sort((a,b)=>b.rate-a.rate||b.total-a.total||a.defect.localeCompare(b.defect,'zh-Hant')).slice(0,5));
$('weeklyTrendAll').onclick=()=>selectItems(available);
$('weeklyTrendClear').onclick=()=>selectItems([]);
$('weeklyTrendExport').onclick=async()=>{
 const button=$('weeklyTrendExport'),error=$('weeklyTrendExportError'),canvas=$('weeklyTrendChart');
 if(!trend?.series.length)return;
 error.hidden=true;button.disabled=true;
 const snapshot=canvas.toDataURL('image/png'),daily=mode==='day',axis=unitLabel();
 try{
  const bytes=await createDefectTrendWorkbook(trend,{
   keepEmptyPeriods:true,sources:sourceFiles,snapshot,imageWidth:parseFloat(canvas.style.width),imageHeight:260,
   scope:[$('weeklyTrendScope').textContent,productPicker.label,processPicker.label].filter(Boolean).join(' · '),
   notes:[['橫軸日期單位',axis],['製程複選','選取部分且多個製程時，請查看推移明細中的各製程投入。日期投入頁的範圍唯一投入與不良欄位留空。'],['去重口徑','每個'+axis+'點獨立計算，同一 PPID 跨'+axis+'可在各'+axis+'計入一次。']],
   sheets:[{name:daily?'各日狀態':'各週狀態',rows:[[daily?'日期':'週別','納入起日','納入迄日','狀態'],...results.map(week=>[week.label,week.start_date,week.end_date,week.error||{ready:'已計算',empty:'無投入',pending:'尚未計算'}[week.status]])]}]
  });
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=daily?'AutoReport_每日不良率推移.xlsx':'AutoReport_跨週不良率推移.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }catch(e){error.textContent=e.message;error.hidden=false;}
 finally{button.disabled=!trend?.series.length;}
};
