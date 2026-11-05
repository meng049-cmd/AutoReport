import {periods} from './detail-index.mjs';
import {getWeeklyTrendCache,saveWeeklyTrendCache} from './analysis-cache.mjs';
import {createDefectTrendWorkbook,trendColors} from './chart-export.mjs';

const $=id=>document.getElementById(id);
const number=value=>value==null?'—':value.toLocaleString();
const percent=value=>value==null?'—':(value*100).toFixed(2)+'%';
const DAY=86400000;
let results=[],sourceFiles=[],selection=new Set(),available=[],trend,controller;

function buildJobs(range,sources){
 const weeks=new Map();
 for(let date=range.start_date;date<=range.end_date;){
  const week=periods.periodFor(date,'week');
  const start=week.start_date<range.start_date?range.start_date:week.start_date;
  const end=week.end_date>range.end_date?range.end_date:week.end_date;
  const label=week.key.replace('_w','-W').replace(/_$/,'');
  weeks.set(week.key,{period:{start_date:start,end_date:end},key:week.key,label,sources:[]});
  date=new Date(Date.parse(week.end_date+'T00:00:00Z')+DAY).toISOString().slice(0,10);
 }
 for(const {id,key,name,dayCounts} of sources){
  const counts=new Map();
  for(const [day,count] of Object.entries(dayCounts||{})){
   if(!count||!periods.contains(range,day))continue;
   const week=periods.periodFor(day,'week').key;
   counts.set(week,(counts.get(week)||0)+count);
  }
  for(const [week,rows] of counts)weeks.get(week).sources.push({id,key,name,rows});
 }
 return [...weeks.values()];
}
function calculate(job,skipInvalidRows,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./weekly-trend-worker.js?v='+__BUILD_ID__,import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(signal.reason);};
  signal.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data})=>{cleanup();data.error?reject(Error(data.error)):resolve(data);};
  worker.onerror=()=>{cleanup();reject(Error('本週計算未完成，請確認來源檔及瀏覽器可用記憶體。'));};
  worker.postMessage({period:job.period,sources:job.sources,skipInvalidRows});
 });
}

export async function runWeeklyTrend(range,sources,files,{skipInvalidRows=false}={}){
 if(controller)return;
 controller=new AbortController();
 const {signal}=controller,progress=$('weeklyTrendStatus'),cancel=$('weeklyTrendCancel');
 cancel.hidden=false;cancel.disabled=false;
 $('weeklyTrendResult').hidden=true;
 sourceFiles=files;
 const completed=[];
 let jobs=[],fromCache=0,temporary=0,failure='';
 try{
  jobs=buildJobs(range,sources);
  for(const [i,job] of jobs.entries()){
   signal.throwIfAborted();
   progress.textContent='跨週推移 '+(i+1)+'／'+jobs.length+'：'+job.label;
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
 const counts=status=>results.filter(week=>week.status===status).length;
 progress.textContent=(signal.aborted?'已取消，保留已完成的週。':'跨週推移已完成。')+' 有投入 '+counts('ready')+' 週，無投入 '+counts('empty')+' 週，無法計算 '+counts('error')+' 週。'+(fromCache?' 已重用 '+fromCache+' 週摘要。':'')+(temporary?' '+temporary+' 週摘要暫存於本分頁。':'')+(results.some(week=>week.skipped)?' 有來源檔已略過錯誤列。':'');
 if(!results.length)return;
 showResult(range);
}

function setOptions(id,values,empty){
 const select=$(id),old=select.value;
 select.replaceChildren(...(empty?[['',empty],...values]:values).map(([key,label])=>{
  const option=document.createElement('option');option.value=key;option.textContent=label;return option;
 }));
 if([...select.options].some(option=>option.value===old))select.value=old;
}
function showResult(range){
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
 $('weeklyTrendScope').textContent=range.start_date+' ～ '+range.end_date+' · 共 '+results.length+' 週';
 $('weeklyTrendProduct').value='';$('weeklyTrendProcess').value='';
 setOptions('weeklyTrendProduct',[...products].sort((a,b)=>a[1].localeCompare(b[1],'zh-Hant')),'全部產品');
 setOptions('weeklyTrendProcess',[...processes].sort().map(process=>[process,process]),'全部製程');
 setOptions('weeklyTrendWeek',results.map((week,i)=>[i,week.label+'（'+week.start_date+' ～ '+week.end_date+'）']));
 $('weeklyTrendWeek').value=String(Math.max(0,results.findIndex(week=>week.status==='ready')));
 $('weeklyTrendPointDetails').open=false;
 $('weeklyTrendItems').open=false;
 $('weeklyTrendResult').hidden=false;
 updateAvailable();
}
function updateAvailable(){
 const product=$('weeklyTrendProduct').value,process=$('weeklyTrendProcess').value,definitions=new Map();
 for(const week of results){
  week.groups=new Map();
  for(const [name,all] of week.summary?.processes||[]){
   if(process&&process!==name)continue;
   const group=product?all.products.find(([id])=>id===product)?.[1]:all;
   if(!group)continue;
   const defects=new Map(group.defects);
   week.groups.set(name,{input:group.input,count:group.count,defects});
   for(const [defect,count] of defects){
    const key=JSON.stringify([name,defect]);
    if(!definitions.has(key))definitions.set(key,{key,process:name,defectName:defect,defect:name+'｜'+defect,total:0});
    definitions.get(key).total+=count;
   }
  }
 }
 available=[...definitions.values()].sort((a,b)=>b.total-a.total||a.defect.localeCompare(b.defect,'zh-Hant'));
 selection=new Set(available.slice(0,5).map(item=>item.key));
 $('weeklyTrendSearch').value='';
 renderChoices();
 renderTrend();
}
function renderChoices(){
 const host=$('weeklyTrendChoices'),query=$('weeklyTrendSearch').value.trim().toLowerCase();
 $('weeklyTrendItemCount').textContent='不良項目（已選 '+selection.size+'／'+available.length+'）';
 host.replaceChildren();
 for(const item of available){
  if(query&&!item.defect.toLowerCase().includes(query))continue;
  const label=document.createElement('label'),check=document.createElement('input');
  check.type='checkbox';check.checked=selection.has(item.key);
  check.onchange=()=>{
   check.checked?selection.add(item.key):selection.delete(item.key);
   $('weeklyTrendItemCount').textContent='不良項目（已選 '+selection.size+'／'+available.length+'）';
   renderTrend();
  };
  label.append(check,item.defect);host.append(label);
 }
 if(!host.children.length)host.textContent=available.length?'沒有符合的項目。':'目前條件沒有不良項目。';
}
function renderTrend(){
 const product=$('weeklyTrendProduct').value,process=$('weeklyTrendProcess').value;
 const dates=results.map(week=>{
  const group=process?week.groups.get(process):product?week.summary?.products.find(item=>item.id===product):week.summary;
  return {label:week.label,start:week.start_date,end:week.end_date,input:group?.input||null,count:group?.count??null,rate:null};
 });
 const series=available.flatMap((item,i)=>selection.has(item.key)?[{
  ...item,color:trendColors[i%trendColors.length],points:results.map((week,j)=>{
   const group=week.groups.get(item.process),input=group?.input||null,count=input?(group.defects.get(item.defectName)||0):null;
   return {...dates[j],input,count,rate:input?count/input:null};
  })
 }]:[]);
 for(const line of series)line.points.forEach((point,i)=>{
  if(point.rate!=null)dates[i].rate=Math.max(dates[i].rate??0,point.rate);
 });
 trend={dates,series,method:'process-denominator'};
 $('weeklyTrendExport').disabled=!series.length;
 drawChart();
 renderWeekDetail();
}
function drawChart(){
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
 const step=Math.max(1,Math.ceil(62/slot));
 for(let i=0;i<dates.length;i+=step){
  ctx.fillStyle=dates[i].input?'#17324a':'#64778a';
  ctx.fillText(dates[i].label,x(i),height-29);
  if(slot>=76)ctx.fillText(dates[i].start.slice(5)+'～'+dates[i].end.slice(5),x(i),height-12);
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
  ctx.fillText(available.length?'請選擇要顯示的不良項目。':'目前條件沒有可繪製的不良項目。',width/2,height/2);
 }
 const legend=$('weeklyTrendLegend');legend.replaceChildren();
 for(const line of series){
  const label=document.createElement('span'),dot=document.createElement('i');
  dot.style.backgroundColor=line.color;label.append(dot,line.defect);legend.append(label);
 }
 canvas.onclick=event=>{
  const i=Math.floor((event.clientX-canvas.getBoundingClientRect().left-left)/slot);
  if(!dates[i])return;
  $('weeklyTrendWeek').value=String(i);
  $('weeklyTrendPointDetails').open=true;
  renderWeekDetail();
 };
}
function renderWeekDetail(){
 const index=Number($('weeklyTrendWeek').value),week=results[index],host=$('weeklyTrendPointTable');
 host.replaceChildren();
 if(!week)return;
 const status=$('weeklyTrendPointStatus');
 if(week.status!=='ready'){
  status.textContent={empty:'本週無投入。',pending:'本週尚未計算。',error:'本週無法計算：'+week.error}[week.status];
  return;
 }
 const date=trend.dates[index],rows=trend.series.filter(line=>line.points[index].input);
 status.textContent=date.input?'範圍唯一投入 '+number(date.input)+' PPID'+(rows.length?'。':'。本週沒有符合目前選擇的不良項目。'):'目前篩選條件在本週無投入。';
 if(!rows.length)return;
 const table=document.createElement('table'),head=table.createTHead().insertRow(),body=table.createTBody();
 for(const title of ['製程','不良項目','投入 PPID','不良 PPID','不良率']){
  const th=document.createElement('th');th.scope='col';th.textContent=title;head.append(th);
 }
 for(const line of rows){
  const point=line.points[index],row=body.insertRow();
  for(const value of [line.process,line.defectName,number(point.input),number(point.count),percent(point.rate)])row.insertCell().textContent=value;
 }
 host.append(table);
}

$('weeklyTrendCancel').onclick=()=>{if(controller){$('weeklyTrendCancel').disabled=true;controller.abort();}};
$('weeklyTrendProduct').onchange=updateAvailable;
$('weeklyTrendProcess').onchange=updateAvailable;
$('weeklyTrendSearch').oninput=renderChoices;
$('weeklyTrendWeek').onchange=renderWeekDetail;
$('weeklyTrendClear').onclick=()=>{selection.clear();renderChoices();renderTrend();};
$('weeklyTrendExport').onclick=async()=>{
 const button=$('weeklyTrendExport'),error=$('weeklyTrendExportError'),canvas=$('weeklyTrendChart');
 if(!trend?.series.length)return;
 error.hidden=true;button.disabled=true;
 const snapshot=canvas.toDataURL('image/png');
 try{
  const bytes=await createDefectTrendWorkbook(trend,{
   keepEmptyPeriods:true,sources:sourceFiles,snapshot,imageWidth:parseFloat(canvas.style.width),imageHeight:260,
   scope:[$('weeklyTrendScope').textContent,$('weeklyTrendProduct').selectedOptions[0]?.textContent,$('weeklyTrendProcess').selectedOptions[0]?.textContent].filter(Boolean).join(' · '),
   notes:[['週別去重','每個週點獨立計算，同一 PPID 跨週可在各週計入一次。']],
   sheets:[{name:'各週狀態',rows:[['週別','納入起日','納入迄日','狀態'],...results.map(week=>[week.label,week.start_date,week.end_date,week.error||{ready:'已計算',empty:'無投入',pending:'尚未計算'}[week.status]])]}]
  });
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download='AutoReport_跨週不良率推移.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }catch(e){error.textContent=e.message;error.hidden=false;}
 finally{button.disabled=!trend?.series.length;}
};
