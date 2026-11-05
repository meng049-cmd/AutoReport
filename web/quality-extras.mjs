import {stageComparisonRows,stageComparisonSheet,defectTrend,orderYieldRows,selectTrendSeries,trendProductBreakdown} from './defect-analysis.mjs';
import {createDefectTrendWorkbook,createStageChartWorkbook,trendColors} from './chart-export.mjs';
import {stageProcesses} from './stage-metrics.mjs';
const $=id=>document.getElementById(id),pct=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':'—';
let analysis,filters={},onOrder=()=>{},orderRows=[],orderPage=0,trend,globalProduct='',hidden=new Set(),colors=new Map(),selectedItems=null,availableItems=[];
let trendDetailsTrigger=null;
const dateUnitLabels={day:'日',week:'週',month:'月'};
export const chartDateUnitLabel=unit=>dateUnitLabels[unit]||dateUnitLabels.day;
export function syncChartDateUnits(select,rangeUnit,preferred=select.value){
 const units=['month','week','day'];
 const options=units.slice(units.includes(rangeUnit)?units.indexOf(rangeUnit):2);
 select.replaceChildren(...options.map(unit=>{
  const option=document.createElement('option');option.value=unit;option.textContent=chartDateUnitLabel(unit);return option;
 }));
 select.value=options.includes(preferred)?preferred:options[0];
 select.disabled=options.length===1;
}
function selectOptions(id,empty,values,value){const select=$(id);select.replaceChildren();for(const [key,label] of [['',empty],...values]){const option=document.createElement('option');option.value=key;option.textContent=label;select.append(option);}select.value=value||'';}
function save(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function downloading(button,fn){
 const label=button.textContent,errorMessage=$('qualityExtraExportError');
 errorMessage.hidden=true;
 button.disabled=true;
 button.textContent='產生中…';
 try{await fn();}
 catch(error){errorMessage.textContent=label+'失敗：'+error.message;errorMessage.hidden=false;}
 finally{button.textContent=label;button.disabled=button.id==='trendDownload'&&!trend?.series.some(item=>!hidden.has(item.key||item.defect));}
}
function sourceOptions(forOrder=false){const product=forOrder?analysis.products.find(p=>p.id===filters.product):null,trendProcess=$('trendProcess')?.value||filters.process||'';return {sources:analysis.sources||[],referenceSources:analysis.referenceSources||[],notes:[['略過錯誤列',String(analysis.skippedRows?.length||0)+' 列；未納入投入與良率。詳見原分析報表略過錯誤明細。']],scope:[filters.startDate+' — '+filters.endDate,filters.stage,filters.order,filters.process,forOrder?(product?product.ic+'／'+product.model:'全部產品'):$('trendProduct').selectedOptions[0]?.textContent,forOrder?filters.date:(trendProcess||'全部製程'),forOrder?'':trend.series.filter(item=>!hidden.has(item.key||item.defect)).map(item=>item.defect).join('、')].filter(Boolean).join(' · ')};}
function searchedOrders(){const query=$('orderYieldSearch').value.trim().toLowerCase();return orderRows.filter(row=>[row.order,row.ic,row.model].some(value=>String(value).toLowerCase().includes(query)));}
function renderOrders(){const rows=searchedOrders(),pages=Math.max(1,Math.ceil(rows.length/30));orderPage=Math.min(orderPage,pages-1);const table=document.createElement('table'),header=table.createTHead().insertRow();for(const label of ['工單','IC／機種','投入 PPID','良品 PPID','不良 PPID','工單良率','不良率','日期']){const th=document.createElement('th');th.textContent=label;header.append(th);}const body=table.createTBody();for(const row of rows.slice(orderPage*30,orderPage*30+30)){const tr=body.insertRow(),button=document.createElement('button');button.type='button';button.className='secondary';button.style.padding='4px 7px';button.textContent=row.order;button.onclick=()=>onOrder(row.order);tr.insertCell().append(button);for(const value of [row.ic+'／'+row.model,row.total,row.good,row.fail,pct(row.yield),pct(row.badRate),row.start+' — '+row.end])tr.insertCell().textContent=value;}$('orderYieldTable').replaceChildren(table);$('orderYieldPage').textContent=(orderPage+1)+' / '+pages+' · '+rows.length+' 筆';$('orderYieldPrev').disabled=orderPage===0;$('orderYieldNext').disabled=orderPage===pages-1;$('orderYieldDownload').disabled=!rows.length;}
function updateTrendSummary(){const count=availableItems.filter(name=>selectedItems==null||selectedItems.has(name)).length;$('trendItemsSummary').textContent=count===availableItems.length?'全部不良項目（'+count+'）':'已選 '+count+'／'+availableItems.length+' 項';}
function renderTrendChoices(){
 const query=$('trendItemSearch').value.trim().normalize('NFKC').toLowerCase(),host=$('trendDefectChoices');host.replaceChildren();
 for(const name of availableItems.filter(name=>name.normalize('NFKC').toLowerCase().includes(query))){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=name;check.checked=selectedItems==null||selectedItems.has(name);check.onchange=()=>{if(selectedItems==null)selectedItems=new Set(availableItems);check.checked?selectedItems.add(name):selectedItems.delete(name);hidden.clear();updateTrendSummary();renderTrend();};label.append(check,document.createTextNode(name));host.append(label);}
 if(!host.children.length)host.textContent=availableItems.length?'沒有符合的項目':'目前沒有不良項目';updateTrendSummary();
}
function trendScope(){return {...filters,granularity:$('trendChartDateUnit').value||filters.granularity,product:$('trendProduct').value,process:$('trendProcess').value||filters.process||'',date:'',dateUnit:'',defect:''};}
function closeTrendProductDetails(restoreFocus=false){
 $('trendProductDetails').hidden=true;
 $('trendProductDetailTable').replaceChildren();
 trendDetailsTrigger?.setAttribute('aria-expanded','false');
 if(restoreFocus)trendDetailsTrigger?.focus();
 trendDetailsTrigger=null;
}
export function renderTrendProductChart(rows,color,host=$('trendProductDetailTable'),periodTotals=false){
 const maxRate=rows.reduce((max,row)=>Math.max(max,row.rate??0),0);
 const step=Math.max(.0001,maxRate/4);
 const magnitude=10**Math.floor(Math.log10(step));
 const tickSize=[magnitude,2*magnitude,5*magnitude].find(size=>size>=step)??10*magnitude;
 const limit=Math.min(1,tickSize*4);

 const table=document.createElement('table');
 table.className='trend-product-chart';
 table.setAttribute('aria-label','機種／IC 不良率橫向長條圖');
 if(color)table.style.setProperty('--trend-bar-color',color);
 const head=table.createTHead().insertRow();
 for(const label of ['機種','IC',periodTotals?'投入 PPID 合計':'投入 PPID',periodTotals?'不良 PPID 合計':'不良 PPID',periodTotals?'合計不良率':'不良率']){
  const th=document.createElement('th');
  th.scope='col';
  th.textContent=label;
  head.append(th);
 }
 const axisLayout=document.createElement('div'),axis=document.createElement('div');
 axisLayout.className='trend-rate-layout';
 axisLayout.setAttribute('aria-hidden','true');
 axis.className='trend-rate-axis';
 for(let i=0;i<=4;i++){
  const tick=document.createElement('span');
  tick.style.left=i*25+'%';
  tick.textContent=pct(limit*i/4);
  axis.append(tick);
 }
 axisLayout.append(axis);
 head.lastElementChild.append(axisLayout);

 const body=table.createTBody();
 for(const row of rows){
  const tr=body.insertRow();
  for(const value of [row.model,row.ic,row.input.toLocaleString(),row.count.toLocaleString()])tr.insertCell().textContent=value;
  const layout=document.createElement('div'),track=document.createElement('span'),bar=document.createElement('span'),value=document.createElement('span');
  layout.className='trend-rate-layout';
  track.className='trend-rate-track';
  track.setAttribute('aria-hidden','true');
  bar.className='trend-rate-bar';
  bar.style.width=Math.min(100,(row.rate??0)/limit*100)+'%';
  value.className='trend-rate-value';
  value.textContent=pct(row.rate);
  track.append(bar);
  layout.append(track,value);
  tr.insertCell().append(layout);
 }
 host.append(table);
}
function showTrendProductDetails(series,bucket,trigger){
 closeTrendProductDetails();
 const scope=trendScope(),rows=trendProductBreakdown(analysis,scope,series,bucket);
 trendDetailsTrigger=trigger;
 trigger.setAttribute('aria-expanded','true');
 $('trendProductDetailHeading').textContent=series.defect+' 的機種／IC 明細';
 const period=bucket?.label||(scope.days?.length?scope.days.join('、'):scope.startDate+' ～ '+scope.endDate);
 $('trendProductDetailScope').textContent=period+' · '+(rows.length?rows.length+' 組有此不良的機種／IC':'這個期間沒有此項不良');
 if(rows.length)renderTrendProductChart(rows,series.color);
 $('trendProductDetails').hidden=false;
 $('trendProductDetailHeading').focus();
}
function refreshTrendOptions(){
 const processes=stageProcesses(filters.stage),availableProcesses=filters.process?[]:processes,current=$('trendProcess').value,selected=availableProcesses.includes(current)?current:'';
 selectOptions('trendProcess',filters.process?'沿用上方篩選：'+filters.process:'全部製程',availableProcesses.map(process=>[process,process]),selected);
 availableItems=[...new Set(defectTrend(analysis,trendScope()).series.map(row=>row.item||row.defectName||row.defect))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 renderTrendChoices();
}
function renderTrend(){
 if(!analysis)return;
 closeTrendProductDetails();
 $('trendPointContext').textContent='';
 $('trendSelection').textContent='將游標移到圖上，或使用左右方向鍵查看點位。';
 const source=defectTrend(analysis,trendScope()),selectedKeys=source.series.filter(series=>selectedItems==null||selectedItems.has(series.item||series.defectName||series.defect)).map(series=>series.key||series.defect);
 trend=selectTrendSeries(source,selectedKeys);
 for(const series of trend.series){const key=series.key||series.defect;if(!colors.has(key))colors.set(key,trendColors[colors.size%trendColors.length]);series.color=colors.get(key);}
 const canvas=$('defectTrendChart'),ratio=window.devicePixelRatio||1,height=260,left=59,right=20,width=Math.min(30000,Math.max(canvas.parentElement.clientWidth||700,trend.dates.length*72+left+right)),ctx=canvas.getContext('2d');
 canvas.removeAttribute('title');
 canvas.style.width=width+'px';canvas.style.height=height+'px';canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
 const visible=trend.series.filter(series=>!hidden.has(series.key||series.defect)),maxValue=visible.reduce((max,series)=>series.points.reduce((m,point)=>Math.max(m,point.rate||0),max),0),max=Math.min(1,Math.max(.01,maxValue*1.15)),showPointLabels=visible.length===1||selectedItems?.size===1,top=34+(showPointLabels?Math.min(visible.length,6)*12:0),bottom=51,plotH=height-top-bottom,slot=(width-left-right)/(trend.dates.length||1),x=index=>left+slot*(index+.5),y=value=>top+plotH*(1-value/max),processScoped=trend.method==='process-denominator',scopeInputLabel=processScoped?(trendScope().process?'製程唯一投入 ':'跨製程唯一投入 '):'投入 ';
 ctx.font='11px system-ui';for(let i=0;i<=5;i++){const value=max*i/5,yy=y(value);ctx.strokeStyle='#e3ebee';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#738697';ctx.fillText(pct(value),left-8,yy+4);}
 ctx.textAlign='center';for(let i=0;i<trend.dates.length;i++){const date=trend.dates[i];ctx.fillStyle='#687b8c';ctx.fillText(date.label.slice(0,4).match(/^\d{4}$/)&&date.label.length===10?date.label.slice(5):date.label,x(i),height-26);ctx.font='9px system-ui';ctx.fillText(scopeInputLabel+date.input,x(i),height-8);ctx.font='11px system-ui';}
 for(const [seriesIndex,series] of visible.entries()){
  ctx.strokeStyle=series.color;ctx.lineWidth=2.2;ctx.beginPath();let connected=false;
  series.points.forEach((point,index)=>{if(point.rate==null){connected=false;return;}connected?ctx.lineTo(x(index),y(point.rate)):ctx.moveTo(x(index),y(point.rate));connected=true;});ctx.stroke();
  if(series.points.length<250||showPointLabels)for(let i=0;i<series.points.length;i++){const point=series.points[i];if(point.rate==null)continue;ctx.beginPath();ctx.fillStyle=series.color;ctx.arc(x(i),y(point.rate),3.2,0,Math.PI*2);ctx.fill();if(showPointLabels){ctx.fillStyle=series.color;ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.fillText(pct(point.rate),x(i),Math.max(12,y(point.rate)-9-seriesIndex*12));}}
 }
 if(!trend.dates.length||!visible.length){ctx.textAlign='center';ctx.fillStyle='#6f8493';ctx.fillText(!trend.dates.length?'目前範圍沒有投入資料':!availableItems.length?'目前條件沒有不良項目':!trend.series.length?'請勾選不良項目':'所有已選項目均已關閉',(width+left-right)/2,top+plotH/2);}
 const legend=$('trendLegend');
 legend.replaceChildren();
 for(const series of trend.series){
  const key=series.key||series.defect,item=document.createElement('span'),details=document.createElement('button'),toggle=document.createElement('button'),dot=document.createElement('i');
  item.className='trend-legend-item';
  dot.style.background=series.color;
  details.type=toggle.type='button';
  details.dataset.defect=series.item||series.defectName||series.defect;
  details.dataset.process=series.process||'';
  details.setAttribute('aria-controls','trendProductDetails');
  details.setAttribute('aria-expanded','false');
  details.append(dot,document.createTextNode(series.defect));
  details.onclick=()=>showTrendProductDetails(series,null,details);
  toggle.setAttribute('aria-pressed',String(!hidden.has(key)));
  toggle.setAttribute('aria-label','顯示曲線：'+series.defect);
  toggle.textContent=hidden.has(key)?'OFF':'ON';
  toggle.onclick=()=>{hidden.has(key)?hidden.delete(key):hidden.add(key);renderTrend();};
  item.append(details,toggle);
  legend.append(item);
 }
 let inspectedIndex=-1;
 const inspect=index=>{
  const date=trend.dates[index];
  if(!date||index===inspectedIndex)return;
  inspectedIndex=index;
  const context=date.label+' · '+scopeInputLabel+date.input.toLocaleString()+' PPID';
  const values=visible.map(series=>{
   const point=series.points[index];
   return series.defect+' '+pct(point?.rate)+'（不良唯一PPID '+(point?.count||0)+'／製程唯一投入PPID '+(point?.input||0)+'）';
  });
  $('trendPointContext').textContent=' · '+context;
  $('trendSelection').textContent=values.length?context+' · '+values.join(' · '):context+' · 目前沒有顯示的項目';
  canvas.title=context;
 };
 const pointerIndex=event=>Math.floor((event.clientX-canvas.getBoundingClientRect().left-left)/slot);
 canvas.onmousemove=event=>inspect(pointerIndex(event));
 canvas.onclick=event=>{
  const index=pointerIndex(event),bucket=trend.dates[index];
  if(!bucket)return;
  inspect(index);
  const rect=canvas.getBoundingClientRect();
  let selected=null,nearest=10;
  for(const series of visible){
   const point=series.points[index];
   if(point?.rate==null||(series.points.length>=250&&!showPointLabels))continue;
   const distance=Math.hypot(event.clientX-rect.left-x(index),event.clientY-rect.top-y(point.rate));
   if(distance<nearest){selected=series;nearest=distance;}
  }
  if(selected)showTrendProductDetails(selected,bucket,canvas);
 };
 canvas.tabIndex=0;
 canvas.setAttribute('aria-controls','trendProductDetails');
 canvas.setAttribute('aria-expanded','false');
 canvas.dataset.activeIndex='0';
 canvas.onkeydown=event=>{
  const active=Number(canvas.dataset.activeIndex)||0;
  if(event.key==='Enter'&&visible.length===1&&trend.dates[active]){
   event.preventDefault();
   showTrendProductDetails(visible[0],trend.dates[active],canvas);
  }else if(['ArrowLeft','ArrowRight'].includes(event.key)){
   event.preventDefault();
   const index=Math.max(0,Math.min(trend.dates.length-1,active+(event.key==='ArrowRight'?1:-1)));
   canvas.dataset.activeIndex=String(index);
   inspect(index);
  }
 };
 canvas.dataset.points=trend.dates.length;canvas.dataset.series=trend.series.length;canvas.dataset.visibleSeries=visible.length;$('trendDownload').disabled=!visible.length;canvas.setAttribute('aria-label','不良項目推移圖；各製程依該製程唯一投入PPID計算，單一不良項目會標示點位不良率；只顯示有投入PPID的日期或區間');$('trendSummary').textContent=trend.dates.length+' 個有投入的日期區間 · 製程：'+(trendScope().process||'全部製程')+' · 顯示 '+visible.length+'／'+trend.series.length+' 條線';
}
export function renderQualityExtras(data,scope,selectOrder){const changed=analysis!==data,productChanged=globalProduct!==scope.product,unitChanged=filters.granularity!==scope.granularity;analysis=data;filters={...scope};syncChartDateUnits($('trendChartDateUnit'),scope.granularity,changed||unitChanged?scope.granularity:undefined);onOrder=selectOrder;if(changed||productChanged){selectedItems=null;hidden.clear();$('trendItemSearch').value='';}if(changed){$('trendPointDetails').open=false;globalProduct='';hidden=new Set();colors=new Map([...new Set(data.attribution.map(row=>row.defect))].sort().map((name,i)=>[name,trendColors[i%trendColors.length]]));$('orderYieldSearch').value='';orderPage=0;}const product=changed||productChanged?scope.product||'':$('trendProduct').value;globalProduct=scope.product;selectOptions('trendProduct','全部產品',data.products.map(p=>[p.id,p.ic+'／'+p.model]),product);refreshTrendOptions();orderRows=orderYieldRows(data,scope);renderOrders();renderTrend();renderComparison();}
$('orderYieldSearch').oninput=()=>{orderPage=0;renderOrders();};$('orderYieldPrev').onclick=()=>{orderPage--;renderOrders();};$('orderYieldNext').onclick=()=>{orderPage++;renderOrders();};$('trendProduct').onchange=()=>{hidden.clear();selectedItems=null;$('trendItemSearch').value='';refreshTrendOptions();renderTrend();};$('trendProcess').onchange=()=>{hidden.clear();selectedItems=null;$('trendItemSearch').value='';refreshTrendOptions();renderTrend();};
$('trendChartDateUnit').onchange=()=>{refreshTrendOptions();renderTrend();};
$('trendDownload').onclick=()=>downloading($('trendDownload'),async()=>{const canvas=$('defectTrendChart'),series=trend.series.filter(item=>!hidden.has(item.key||item.defect));if(!series.length)return;const granularity=trendScope().granularity,options=sourceOptions();save(await createDefectTrendWorkbook(selectTrendSeries(trend,series.map(item=>item.key||item.defect)),{...options,notes:[...options.notes,['圖表日期單位',chartDateUnitLabel(granularity)]],showPointLabels:selectedItems?.size===1||series.length===1,snapshot:canvas.toDataURL('image/png'),imageWidth:canvas.width/(window.devicePixelRatio||1),imageHeight:260,sheets:[stageComparisonSheet(analysis,{...filters,granularity,product:$('trendProduct').value,date:'',defect:''})]}),'AutoReport_不良率項目推移圖.xlsx');});
$('orderYieldDownload').onclick=()=>downloading($('orderYieldDownload'),async()=>{const rows=searchedOrders();save(await createStageChartWorkbook({key:'工單良率',title:'工單良率',sheetName:'工單良率圖表',referenceLabel:'全檔唯一PPID良率',target:analysis.yield??0,color:'#117b73'},rows.map(row=>({date:row.order+'／'+row.model,value:row.yield})),{...sourceOptions(true),notes:[...sourceOptions(true).notes,['工單良率','(工單投入唯一PPID－首次歸屬此工單的不良PPID)／工單投入唯一PPID。沿用全檔首次FAIL優先，其次GOOD有不良項目；不因選擇不良項目而改變工單良率。'],['明細範圍','工單表依產品、工單、日期區間、單一日期與製程篩選；文字搜尋：'+($('orderYieldSearch').value||'無')]],sheets:[{name:'工單良率明細',rows:[['工單','IC','機種','投入PPID','良品PPID','首次歸屬不良PPID','工單良率','工單不良率','開始日期','結束日期'],...rows.map(row=>[row.order,row.ic,row.model,row.total,row.good,row.fail,row.yield,row.badRate,row.start,row.end])],percentColumns:[6,7]}]}),'AutoReport_工單良率分析.xlsx');});

$('trendItemSearch').oninput=renderTrendChoices;
$('trendSelectAll').onclick=()=>{selectedItems=null;hidden.clear();renderTrendChoices();renderTrend();};
$('trendSelectNone').onclick=()=>{selectedItems=new Set();hidden.clear();renderTrendChoices();renderTrend();};
function closeTrendPicker(){$('trendItemPicker').open=false;$('trendItemsSummary').focus({preventScroll:true});}
$('trendPickerClose').onclick=closeTrendPicker;
$('trendProductDetailClose').onclick=()=>closeTrendProductDetails(true);
$('trendItemPicker').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeTrendPicker();}};
document.addEventListener('pointerdown',event=>{if(!$('trendItemPicker').contains(event.target))$('trendItemPicker').open=false;});

function renderComparison(){
 const table=document.createElement('table'),head=table.createTHead().insertRow();for(const label of ['日期區間','階段','採用：製程平均良率','唯一PPID良率','唯一不良／唯一投入','差異（百分點）','唯一投入','唯一不良']){const th=document.createElement('th');th.textContent=label;head.append(th);}const body=table.createTBody();
 for(const row of stageComparisonRows(analysis,filters)){const tr=body.insertRow();tr.dataset.stage=row.stage;for(const value of [row.label,row.stage,pct(row.value),pct(row.uniqueYield),pct(row.uniqueBadRate),row.difference==null?'—':(row.difference*100).toFixed(4),row.input,row.count])tr.insertCell().textContent=value;}
 $('stageComparisonTable').replaceChildren(table);
}
