const $=id=>document.getElementById(id);let analysis,selectedProcess='',selectedDefect='';
const percent=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':'—';
function table(target,headers,rows){
 const wrap=document.createElement('div');wrap.className='scroll';const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),tr=document.createElement('tr');
 for(const label of headers){const th=document.createElement('th');th.textContent=label;tr.append(th);}head.append(tr);
 for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=typeof value==='number'?value.toLocaleString():String(value??'');tr.append(td);}body.append(tr);}
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='沒有不良或沒有符合的資料。';tr.append(td);body.append(tr);}
 table.append(head,body);wrap.append(table);$(target).replaceChildren(wrap);
}
function ranking(target,items,total){
 table(target,['排名','歸屬製程','不良項目','不良片數','分母：總片數','不良比例'],items.slice(0,5).map(d=>[d.rank,d.process,d.defect,d.count,total,percent(d.count/total)]));
 const count=items.reduce((sum,d)=>sum+d.count,0),note=document.createElement('p');note.className='muted';note.textContent=`全部項目加總 ${count.toLocaleString()} 不良片 ÷ ${total.toLocaleString()} 總片＝${percent(total?count/total:0)}。畫面僅顯示 TOP5；每片僅歸屬一個製程＋不良項目，完整資料保留於 Excel。`;$(target).append(note);
}

function chart(id,items,label,ratio,click,active,isYield=false){
 const node=$(id);node.replaceChildren();
 for(const item of items){const button=document.createElement('button'),text=document.createElement('span'),track=document.createElement('span'),bar=document.createElement('span');button.type='button';button.className='chart-button';button.setAttribute('aria-pressed',String(Boolean(active(item))));text.textContent=label(item);track.className='quality-track';bar.className=isYield?'quality-bar yield-bar':'quality-bar';bar.style.width=(Math.max(0,Math.min(1,ratio(item)))*100)+'%';track.append(bar);button.append(text,track);button.onclick=()=>click(item);node.append(button);}
 if(!items.length)node.textContent='沒有符合的資料。';
}
function render(){
 if(!analysis)return;const product=analysis.products.find(p=>p.id===$('qualityProduct').value);
 const a=analysis,metrics=$('qualityMetrics');metrics.replaceChildren();
 for(const [label,value] of [['全產品總片數',a.total.toLocaleString()],['不重複不良片數',a.fail.toLocaleString()],['整體不良率',percent(a.badRate)],['整體總良率',percent(a.yield)]]){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=label;div.append(strong,span);metrics.append(div);}
 table('qualityProducts',['IC','機種','唯一PPID數','PPID良品數','PPID不良數','產品總良率（日期×階段平均）','PPID不良率（唯一PPID）','占全產品不良貢獻比例'],a.products.filter(p=>!product||p.id===product.id).map(p=>[p.ic,p.model,p.total,p.good,p.fail,percent(p.yield),percent(p.badRate),percent(p.contribution)]));
 const contribution=document.createElement('p');contribution.className='muted';contribution.textContent=`產品總良率＝該機種所有有資料的日期×階段良率算術平均（納入數量依各產品而異）；此平均值不與唯一 PPID 不良率互為補數。全部產品不良貢獻比例加總＝${percent(a.badRate)}（${a.fail.toLocaleString()}／${a.total.toLocaleString()}）。`; $('qualityProducts').append(contribution);
 ranking('qualityGlobalDefects',a.defects,a.total);
 $('qualityDefectTitle').textContent=product?`${product.ic}／${product.model}：不良排名`:'各產品不良排名（請選擇產品）';
 if(product)ranking('qualityProductDefects',product.defects,product.total);else $('qualityProductDefects').textContent='請在上方選擇 IC＋機種，查看該產品的製程＋不良項目排名及比例。';
 const process=product?a.productProcesses.filter(p=>p.product===product.id):a.processes;
 table('qualityProcesses',['製程','經過製程總片數','良品片','不良片','製程總良率'],process.map(p=>[p.process,p.total,p.good,p.fail,percent(p.yield)]));
 $('qualityProcessTitle').textContent=product?`${product.ic}／${product.model}：各製程總良率`:'全產品：各製程總良率';
 chart('qualityChart',product?product.defects.slice(0,5):[],d=>`${d.process}／${d.defect}：${d.count} 片（${percent(d.count/(product?product.total:a.total))}）`,d=>d.count/((product?product.defects:a.defects)[0]?.count||1),d=>{selectedProcess=d.process;selectedDefect=d.defect;render();},d=>selectedProcess===d.process&&selectedDefect===d.defect);
 if(!product)$('qualityChart').textContent='請點選產品圖表或選擇 IC／機種，查看產品不良 TOP5。';
 chart('qualityGlobalChart',a.defects.slice(0,5),d=>`${d.process}／${d.defect}：${d.count} 片（${percent(d.rate)}）`,d=>d.count/(a.defects[0]?.count||1),d=>{selectedProcess=d.process;selectedDefect=d.defect;render();},d=>selectedProcess===d.process&&selectedDefect===d.defect);
 const linkedProducts=a.products.filter(p=>selectedDefect?p.defects.some(d=>d.process===selectedProcess&&d.defect===selectedDefect):selectedProcess?a.productProcesses.some(v=>v.product===p.id&&v.process===selectedProcess):true);
 chart('qualityProductChart',linkedProducts,p=>`${p.ic}／${p.model}：日期×階段平均良率 ${percent(p.yield)}，${p.total.toLocaleString()} 個唯一 PPID，不良貢獻 ${percent(p.contribution)}`,p=>p.yield,p=>{$('qualityProduct').value=p.id;render();},p=>p.id===product?.id,true);
 chart('qualityProcessChart',selectedProcess?process.filter(p=>p.process===selectedProcess):process,p=>`${p.process}：良率 ${percent(p.yield)}，良品 ${p.good}／不良 ${p.fail}`,p=>p.yield,p=>{selectedProcess=p.process;selectedDefect='';render();},p=>p.process===selectedProcess,true);
 $('qualitySelection').textContent=`目前連動：${product?product.ic+'／'+product.model:'全部產品'}${selectedProcess?' → '+selectedProcess:''}${selectedDefect?' → '+selectedDefect:''}`;
 const matched=a.products.filter(p=>!product||p.id===product.id).flatMap(p=>p.defects.filter(d=>(!selectedProcess||d.process===selectedProcess)&&(!selectedDefect||d.defect===selectedDefect)).map(d=>{const process=a.productProcesses.find(v=>v.product===p.id&&v.process===d.process);return [p.ic,p.model,d.process,d.defect,d.count,p.total,percent(d.rate),percent(d.count/a.total),process?.good||0,process?.fail||0];}));
 table('qualityLinkedDetails',['IC','機種','製程','不良項目','歸屬不良片數','產品總片數','產品內比例','占全體比例','製程良品片','製程不良片'],matched);
 const attributed=a.attribution.filter(r=>(!product||(r.ic===product.ic&&r.model===product.model))&&(!selectedProcess||r.process===selectedProcess)&&(!selectedDefect||r.defect===selectedDefect));
 table('qualityLinkedPPID',['IC','機種','PPID','首次NG日期','歸屬製程','不良項目'],attributed.slice(0,100).map(r=>[r.ic,r.model,r.serial,r.date,r.process,r.defect]));
 $('qualityLinkedCount').textContent=`符合 ${attributed.length.toLocaleString()} 片，顯示前 100 片，完整明細可下載 Excel。`;

}
export function clearQuality(){analysis=null;selectedProcess='';selectedDefect='';$('qualityDashboard').hidden=true;}
export function renderQuality(data,start,end){
 analysis=data;$('qualityPeriod').textContent=`主檔日期：${start} 至 ${end}。良品／不良片數只依 PPID（小板序號）去重，跨站、重複過站、跨日期不重複；產品總良率另採日期×階段良率算術平均。`;
 const select=$('qualityProduct');select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部產品';select.append(all);
 for(const p of data.products){const option=document.createElement('option');option.value=p.id;option.textContent=p.ic+'／'+p.model;select.append(option);}
 if(data.identityConflicts.length)$('qualityPeriod').textContent+=` 有 ${data.identityConflicts.length} 個 PPID 對照衝突，僅計一片，另列待確認並附明細。`;
 $('qualityDashboard').hidden=false;render();
}
$('qualityProduct').onchange=render;
$('qualityClearSelection').onclick=()=>{selectedProcess='';selectedDefect='';$('qualityProduct').value='';render();};
