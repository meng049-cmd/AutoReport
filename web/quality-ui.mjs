const $=id=>document.getElementById(id);let analysis;
const percent=value=>(value*100).toFixed(2)+'%';
function table(target,headers,rows){
 const wrap=document.createElement('div');wrap.className='scroll';const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),tr=document.createElement('tr');
 for(const label of headers){const th=document.createElement('th');th.textContent=label;tr.append(th);}head.append(tr);
 for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=typeof value==='number'?value.toLocaleString():String(value??'');tr.append(td);}body.append(tr);}
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='沒有不良或沒有符合的資料。';tr.append(td);body.append(tr);}
 table.append(head,body);wrap.append(table);$(target).replaceChildren(wrap);
}
function ranking(target,items,total){
 table(target,['排名','歸屬製程','不良項目','不良片數','分母：總片數','不良比例'],items.map(d=>[d.rank,d.process,d.defect,d.count,total,percent(d.count/total)]));
 const count=items.reduce((sum,d)=>sum+d.count,0),note=document.createElement('p');note.className='muted';note.textContent=`加總 ${count.toLocaleString()} 不良片 ÷ ${total.toLocaleString()} 總片＝${percent(total?count/total:0)}。每片僅歸屬一個製程＋不良項目。`;$(target).append(note);
}
function render(){
 if(!analysis)return;const product=analysis.products.find(p=>p.id===$('qualityProduct').value);
 const a=analysis,metrics=$('qualityMetrics');metrics.replaceChildren();
 for(const [label,value] of [['全產品總片數',a.total.toLocaleString()],['不重複不良片數',a.fail.toLocaleString()],['整體不良率',percent(a.badRate)],['整體總良率',percent(a.yield)]]){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=label;div.append(strong,span);metrics.append(div);}
 table('qualityProducts',['IC','機種','總片數','GOOD片','FAIL片','產品總良率','產品自身不良率','占全產品不良貢獻比例'],a.products.filter(p=>!product||p.id===product.id).map(p=>[p.ic,p.model,p.total,p.good,p.fail,percent(p.yield),percent(p.badRate),percent(p.contribution)]));
 const contribution=document.createElement('p');contribution.className='muted';contribution.textContent=`全部產品不良貢獻比例加總＝${percent(a.badRate)}（${a.fail.toLocaleString()}／${a.total.toLocaleString()}）。產品自身不良率使用各自分母，不直接相加。`; $('qualityProducts').append(contribution);
 ranking('qualityGlobalDefects',a.defects,a.total);
 $('qualityDefectTitle').textContent=product?`${product.ic}／${product.model}：不良排名`:'各產品不良排名（請選擇產品）';
 if(product)ranking('qualityProductDefects',product.defects,product.total);else $('qualityProductDefects').textContent='請在上方選擇 IC＋機種，查看該產品的製程＋不良項目排名及比例。';
 const process=product?a.productProcesses.filter(p=>p.product===product.id):a.processes;
 table('qualityProcesses',['製程','經過製程總片數','GOOD片','FAIL片','製程總良率'],process.map(p=>[p.process,p.total,p.good,p.fail,percent(p.yield)]));
 $('qualityProcessTitle').textContent=product?`${product.ic}／${product.model}：各製程總良率`:'全產品：各製程總良率';
 const chart=$('qualityChart');chart.replaceChildren();
 for(const d of (product?product.defects:a.defects).slice(0,10)){const div=document.createElement('div'),label=document.createElement('div'),track=document.createElement('div'),bar=document.createElement('div');label.textContent=`${d.process}／${d.defect}：${d.count} 片（${percent(d.count/(product?product.total:a.total))}）`;track.className='quality-track';bar.className='quality-bar';bar.style.width=((d.count/((product?product.defects:a.defects)[0]?.count||1))*100)+'%';track.append(bar);div.append(label,track);chart.append(div);}
 if(!chart.children.length)chart.textContent='沒有不良資料。';
}
export function clearQuality(){analysis=null;$('qualityDashboard').hidden=true;}
export function renderQuality(data,start,end){
 analysis=data;$('qualityPeriod').textContent=`主檔日期：${start} 至 ${end}。各產品總片數依 IC＋機種＋小板序號去重，跨日期不重複。`;
 const select=$('qualityProduct');select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部產品';select.append(all);
 for(const p of data.products){const option=document.createElement('option');option.value=p.id;option.textContent=p.ic+'／'+p.model;select.append(option);}
 $('qualityDashboard').hidden=false;render();
}
$('qualityProduct').onchange=render;
