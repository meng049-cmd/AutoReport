import {createStageChartWorkbook} from './chart-export.mjs';

const $=id=>document.getElementById(id);let analysis,stageChecks=[],selection='',periodStart='',periodEnd='';
const stages=[{key:'SMT',title:'SMT',target:.995,color:'#f4b400'},{key:'前段',title:'前段（DAF＋FT1）',target:.985,color:'#d54545'},{key:'後段',title:'後段（ASM＋FT2）',target:.99,color:'#d54545'}];
const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';
function dateRange(){const out=[];for(let time=Date.parse(periodStart+'T00:00:00Z'),end=Date.parse(periodEnd+'T00:00:00Z');Number.isFinite(time)&&time<=end;time+=86400000)out.push(new Date(time).toISOString().slice(0,10));return out;}
function daily(stage,productId){
 const rows=stageChecks.filter(r=>r.stage===stage&&(!productId||r.product===productId));const byDate=new Map();
 for(const r of rows){const a=byDate.get(r.date)||[];a.push(r.yield);byDate.set(r.date,a);}
 return dateRange().map(date=>{const values=byDate.get(date)||[];return {date,value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};});
}
function drawStageChart(stage){
 const canvas=$('stage-'+stage.key),ctx=canvas.getContext('2d'),ratio=window.devicePixelRatio||1,hostWidth=canvas.parentElement.clientWidth||760,height=320,rows=daily(stage.key,$('qualityProduct').value),left=58,right=20,width=Math.max(hostWidth,rows.length*62+left+right);canvas.style.width=width+'px';canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
 const measured=rows.filter(r=>r.value!=null).map(r=>r.value),min=Math.min(.95,Math.floor((measured.length?Math.min(...measured):.95)*20)/20),max=1.005,step=min<.4?.1:min<.9?.05:.01,top=42,bottom=62,plotW=width-left-right,plotH=height-top-bottom,slot=rows.length?plotW/rows.length:plotW,barW=Math.min(30,Math.max(4,slot*.54));
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.font='12px system-ui';ctx.textAlign='right';
 for(let value=min;value<=1.00001;value+=step){const y=top+(max-value)/(max-min)*plotH;ctx.strokeStyle='#e6ebf0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.fillStyle='#788898';ctx.fillText((value*100).toFixed(0)+'%',left-8,y+4);}
 const ty=top+(max-stage.target)/(max-min)*plotH;ctx.strokeStyle='#396ed4';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(left,ty);ctx.lineTo(width-right,ty);ctx.stroke();ctx.fillStyle='#396ed4';ctx.textAlign='right';ctx.font='600 11px system-ui';ctx.fillText('目標 '+pct(stage.target),width-right,ty-7);
 ctx.textAlign='center';ctx.font='11px system-ui';
 rows.forEach((r,i)=>{const x=left+slot*i+(slot-barW)/2;if(r.value!=null){const unclamped=top+(max-r.value)/(max-min)*plotH,y=Math.max(top,Math.min(top+plotH,unclamped));ctx.fillStyle=stage.color;ctx.fillRect(x,y,barW,top+plotH-y);ctx.fillStyle='#263748';ctx.font='600 10px system-ui';ctx.fillText(pct(r.value),x+barW/2,Math.max(top-5,y-7));}ctx.fillStyle='#687b8c';ctx.font='11px system-ui';ctx.fillText(r.date.slice(5),x+barW/2,height-27);});
 ctx.fillStyle='#263748';ctx.textAlign='left';ctx.font='700 15px system-ui';ctx.fillText(stage.title+' 每日良率',left,22);
 const show=index=>{const row=rows[index];if(!row)return;selection=`${stage.title} · ${row.date} · ${pct(row.value)}`;$('qualitySelection').textContent=selection;canvas.title=selection;};
 const hit=e=>{const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left-left,index=Math.floor(x/slot);if(index>=0&&index<rows.length)show(index);};canvas.onmousemove=hit;canvas.onclick=hit;canvas.tabIndex=0;canvas.onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();canvas.dataset.activeIndex=String(Math.max(0,Math.min(rows.length-1,(Number(canvas.dataset.activeIndex)||0)+(e.key==='ArrowRight'?1:-1))));show(Number(canvas.dataset.activeIndex));};
 canvas.dataset.points=rows.length;canvas.setAttribute('aria-label',`${stage.title}每日良率圖；方向鍵逐日檢視。日期範圍 ${periodStart} 至 ${periodEnd}，共 ${rows.length} 天，無資料日保留空檔`);
}
async function downloadStageExcel(stage){
 const button=$('download-'+stage.key);button.disabled=true;const old=button.textContent;button.textContent='正在產生 Excel…';
 try{const rows=daily(stage.key,$('qualityProduct').value),bytes=await createStageChartWorkbook(stage,rows),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=stage.key+'_每日階段良率.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);button.textContent='Excel 已下載';setTimeout(()=>button.textContent=old,1400);}
 catch(error){$('qualitySelection').textContent='Excel 圖表產生失敗：'+error.message;button.textContent=old;}
 finally{button.disabled=false;}
}
function render(){if(!analysis)return;const id=$('qualityProduct').value,products=id?analysis.products.filter(p=>p.id===id):analysis.products;
 const total=products.reduce((n,p)=>n+p.total,0),bad=products.reduce((n,p)=>n+p.fail,0),metrics=$('qualityMetrics');metrics.replaceChildren();
 for(const [label,value] of [['投入 PPID',total.toLocaleString()],['不良 PPID',bad.toLocaleString()],['PPID 不良率',pct(total?bad/total:0)],['分析日期',dateRange().length.toLocaleString()+' 天']]){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=label;div.append(strong,span);metrics.append(div);}
 for(const stage of stages){drawStageChart(stage);const data=daily(stage.key,id),valid=data.filter(r=>r.value!=null);$('summary-'+stage.key).textContent=`${periodStart} 至 ${periodEnd} · ${valid.length}/${data.length} 天有資料 · 平均 ${valid.length?pct(valid.reduce((n,r)=>n+r.value,0)/valid.length):'—'} · 目標 ${pct(stage.target)}`;}
 $('qualityPeriod').textContent='點選圖表可檢視日期與良率；日期範圍內無資料的日期仍保留空位。每張圖可下載含原生可編輯 Excel 圖表與資料的活頁簿。';
}
export function clearQuality(){analysis=null;stageChecks=[];selection='';periodStart='';periodEnd='';$('qualityDashboard').hidden=true;}
export function renderQuality(data,start,end,checks=[]){analysis=data;stageChecks=checks||[];periodStart=start;periodEnd=end;selection='';const select=$('qualityProduct');select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部產品';select.append(all);for(const p of data.products){const o=document.createElement('option');o.value=p.id;o.textContent=p.ic+'／'+p.model;select.append(o);}$('qualityDashboard').hidden=false;render();}
$('qualityProduct').onchange=render;window.addEventListener('resize',()=>{if(analysis)render();});
for(const stage of stages)$('download-'+stage.key).onclick=()=>downloadStageExcel(stage);
