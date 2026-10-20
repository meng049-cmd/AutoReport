const $=id=>document.getElementById(id);let analysis,stageChecks=[],selection='';
const stages=[{key:'SMT',title:'SMT',target:.995,color:'#ffb900'},{key:'前段',title:'前段（DAF＋FT1）',target:.985,color:'#c90000'},{key:'後段',title:'後段（ASM＋FT2）',target:.99,color:'#c90000'}];
const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';
function daily(stage,productId){
 const rows=stageChecks.filter(r=>r.stage===stage&&(!productId||r.product===productId));const byDate=new Map();
 for(const r of rows){const a=byDate.get(r.date)||[];a.push(r.yield);byDate.set(r.date,a);}
 return [...byDate].map(([date,values])=>({date,value:values.reduce((a,b)=>a+b,0)/values.length})).sort((a,b)=>a.date.localeCompare(b.date));
}
function savePng(canvas,title){canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=title+'_每日階段良率.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');}
function drawStageChart(stage){
 const canvas=$('stage-'+stage.key),ctx=canvas.getContext('2d'),ratio=window.devicePixelRatio||1,width=canvas.clientWidth||760,height=290;canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
 const rows=daily(stage.key,$('qualityProduct').value),left=48,right=16,top=36,bottom=52,plotW=width-left-right,plotH=height-top-bottom,min=.95,max=1.005;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.font='12px system-ui';ctx.textAlign='right';
 for(const value of [.95,.96,.97,.98,.99,1]){const y=top+(max-value)/(max-min)*plotH;ctx.strokeStyle='#d9e0e7';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.fillStyle='#596a7d';ctx.fillText((value*100).toFixed(0)+'%',left-7,y+4);}
 const ty=top+(max-stage.target)/(max-min)*plotH;ctx.strokeStyle='#396ed4';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(left,ty);ctx.lineTo(width-right,ty);ctx.stroke();ctx.fillStyle='#396ed4';ctx.textAlign='right';ctx.fillText('Target '+pct(stage.target),width-right,ty-7);
 const slot=rows.length?plotW/rows.length:plotW,barW=Math.min(34,slot*.58);ctx.textAlign='center';
 rows.forEach((r,i)=>{const x=left+slot*i+(slot-barW)/2,y=top+(max-r.value)/(max-min)*plotH;ctx.fillStyle=stage.color;ctx.fillRect(x,y,barW,top+plotH-y);ctx.fillStyle='#22303e';ctx.fillText(pct(r.value),x+barW/2,Math.max(15,y-8));ctx.fillStyle='#596a7d';ctx.fillText(r.date.slice(5),x+barW/2,height-23);});
 ctx.fillStyle='#263748';ctx.textAlign='left';ctx.font='bold 15px system-ui';ctx.fillText(stage.title+' 每日良率',left,21);
 canvas.onclick=e=>{const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left-left,index=Math.floor(x/slot);if(rows[index]){selection=stage.title+' · '+rows[index].date+' · '+pct(rows[index].value);$('qualitySelection').textContent=selection;}};
}
function render(){if(!analysis)return;const id=$('qualityProduct').value,products=id?analysis.products.filter(p=>p.id===id):analysis.products;
 const total=products.reduce((n,p)=>n+p.total,0),bad=products.reduce((n,p)=>n+p.fail,0),metrics=$('qualityMetrics');metrics.replaceChildren();
 for(const [label,value] of [['投入 PPID',total.toLocaleString()],['不良 PPID',bad.toLocaleString()],['PPID 不良率',pct(total?bad/total:0)],['每日階段圖表',stages.length+' 張']]){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=label;div.append(strong,span);metrics.append(div);}
 for(const stage of stages){drawStageChart(stage);const data=daily(stage.key,id);$('summary-'+stage.key).textContent=data.length?`資料日 ${data.length} 天 · 平均 ${pct(data.reduce((n,r)=>n+r.value,0)/data.length)} · 目標 ${pct(stage.target)}`:'目前篩選沒有資料';}
 $('qualityPeriod').textContent='點擊柱狀圖可查看該日數值；圖表可下載 PNG。切換產品可篩選每日階段良率。';
}
export function clearQuality(){analysis=null;stageChecks=[];selection='';$('qualityDashboard').hidden=true;}
export function renderQuality(data,start,end,checks=[]){analysis=data;stageChecks=checks||[];selection='';const select=$('qualityProduct');select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部產品';select.append(all);for(const p of data.products){const o=document.createElement('option');o.value=p.id;o.textContent=p.ic+'／'+p.model;select.append(o);}$('qualityDashboard').hidden=false;render();}
$('qualityProduct').onchange=render;window.addEventListener('resize',()=>{if(analysis)render();});
for(const stage of stages)$('download-'+stage.key).onclick=()=>savePng($('stage-'+stage.key),stage.key);
