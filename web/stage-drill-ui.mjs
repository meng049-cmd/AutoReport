import {stageDrillView} from './stage-analysis.mjs';
const pct=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':'—';
const names={process:'製程',product:'產品',defect:'不良項目'};
function button(text,action){const node=document.createElement('button');node.type='button';node.className='secondary';node.textContent=text;node.onclick=action;return node;}
function table(headers,rows){const node=document.createElement('table'),header=node.createTHead().insertRow();for(const label of headers){const cell=document.createElement('th');cell.textContent=label;header.append(cell);}const body=node.createTBody();for(const row of rows){const line=body.insertRow();for(const value of row)line.insertCell().textContent=value??'';}return node;}

function auditPanel(view){
 const {parent,audit,dimension}=view,host=document.createElement('div');host.className='stage-reconcile';host.dataset.pass=String(audit.inputOK&&audit.yieldOK&&audit.reportOK);
 const quantity=document.createElement('p'),yieldLine=document.createElement('p');quantity.className='stage-input-audit';yieldLine.className='stage-yield-audit';
 quantity.textContent=dimension==='defect'?`投入驗算：良品 ${parent.good} ＋ 不良項目唯一 PPID ${audit.uniqueInput} ＝ 上層唯一投入 ${parent.input}`:`投入驗算：子層投入合計 ${audit.sumInput} − 重複計入 ${audit.overlap} ＝ 上層唯一投入 ${parent.input}`;
 const method=dimension==='process'?'各製程階段貢獻合計':dimension==='product'?'Σ（產品良品數 ÷ 本製程唯一投入）':'1 − 各不良項目不良率合計';
 yieldLine.textContent=`良率驗算：${method} ${pct(audit.reconstructed)} ＝ 上層良率 ${pct(parent.value)}${host.dataset.pass==='true'?' · 通過':' · 尚未吻合'}`;
 const bad=document.createElement('p');bad.textContent=`不良驗算：子層不良合計 ${audit.count} − 重複計入 ${audit.badOverlap} ＝ 上層唯一不良 ${parent.count}`;
 host.append(quantity,bad,yieldLine);
 const details=document.createElement('details');details.className='stage-audit-details';const summary=document.createElement('summary');summary.textContent='展開良率回算明細';details.append(summary);
 if(dimension==='process'){
  const info=document.createElement('p');info.textContent='日期階段良率依「產品內平均製程，再平均產品」回算；製程柱值為該製程各產品合併後的良品／唯一投入。兩者透過下列平均權重及貢獻對照。';details.append(info);
  details.append(table(['製程','產品','唯一投入','良品','不良','製程良率','階段平均權重','對日期良率貢獻'],view.contributors.map(row=>[row.process,row.label,row.input,row.good,row.count,pct(row.value),(row.weight*100).toFixed(6)+'%',(row.contribution*100).toFixed(6)+'%'])));
 }else{
  if(dimension==='defect'){const info=document.createElement('p');info.textContent='依當日、當製程、當產品的唯一 PPID 分解不良，FAIL／Scrap 優先；每片只列一項。各項共用上層投入母數，不將母數重複相加；良品數加各項唯一不良片數等於投入。此處對應每日製程良率，完整不良分析另沿用全檔首次不良歸屬。';details.append(info);}
  details.append(table(['項目',dimension==='defect'?'共同基準投入':'唯一投入','良品',dimension==='defect'?'項目唯一 PPID':'不良',dimension==='defect'?'不良項目不良率':'良率',dimension==='defect'?'良率扣除值':'對上層良率貢獻'],view.groups.map(row=>[row.label,row.input,row.good,row.count,pct(row.value),pct(row.contribution)])));
 }
 host.append(details);return host;
}

function draw(canvas,groups,dimension,onSelect){
 const ratio=window.devicePixelRatio||1,width=Math.min(30000,Math.max(520,groups.length*118+72)),height=230,left=54,right=18,top=35,bottom=67,plotH=height-top-bottom,slot=(width-left-right)/Math.max(groups.length,1),measured=groups.map(group=>group.value).filter(Number.isFinite),min=dimension==='defect'?0:measured.length&&Math.min(...measured)<=.95?Math.max(0,Math.floor(Math.min(...measured)*20)/20-.05):.95,max=dimension==='defect'?Math.min(1,Math.max(.05,...measured)*1.2):1.005;
 canvas.width=width*ratio;canvas.height=height*ratio;canvas.style.width=width+'px';canvas.style.height=height+'px';const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.font='10px system-ui';ctx.textAlign='right';
 for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,y=top+plotH*(1-i/4);ctx.strokeStyle='#e6ebf0';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.fillStyle='#718494';ctx.fillText((value*100).toFixed(0)+'%',left-7,y+4);}
 groups.forEach((group,index)=>{const x=left+slot*(index+.5),barW=Math.min(46,slot*.52),value=group.value,y=top+plotH*(1-(value==null?0:(value-min)/(max-min)));if(value!=null){ctx.fillStyle=dimension==='defect'?'#b45354':'#d54545';ctx.fillRect(x-barW/2,y,barW,top+plotH-y);ctx.fillStyle='#263748';ctx.textAlign='center';ctx.font='600 10px system-ui';ctx.fillText(pct(value),x,y-7);}ctx.fillStyle='#506678';ctx.textAlign='center';ctx.font='10px system-ui';ctx.fillText(group.label.length>14?group.label.slice(0,13)+'…':group.label,x,height-45);ctx.fillText((dimension==='defect'?'基準投入 ':'投入 ')+group.input,x,height-30);ctx.fillText((dimension==='defect'?'項目 PPID ':'不良 ')+group.count,x,height-15);});
 const inspect=index=>{const group=groups[index];if(group)canvas.title=group.label+' · '+(dimension==='defect'?'基準投入 ':'唯一投入 ')+group.input+' PPID · 不良 '+group.count+' PPID · '+pct(group.value);};
 canvas.onclick=event=>onSelect(Math.floor((event.clientX-canvas.getBoundingClientRect().left-left)/slot));canvas.onmousemove=event=>inspect(Math.floor((event.clientX-canvas.getBoundingClientRect().left-left)/slot));canvas.tabIndex=0;
 canvas.onkeydown=event=>{if(!['Enter','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const current=Number(canvas.dataset.activeIndex)||0;if(event.key==='Enter')onSelect(current);else{const next=Math.max(0,Math.min(groups.length-1,current+(event.key==='ArrowRight'?1:-1)));canvas.dataset.activeIndex=String(next);inspect(next);}};
}

export function renderStageDrillContent(stage,model,host,path,leaf,onPath,onLeaf){
 for(let depth=1;depth<=path.length&&depth<=3;depth++){
  const prefix=path.slice(0,depth),view=stageDrillView(model,prefix),{dimension,groups}=view,section=document.createElement('section');section.className='stage-drill-level';section.dataset.dimension=dimension;
  const header=document.createElement('div');header.className='row chart-head';const title=document.createElement('h4');title.textContent=prefix.map(item=>item.label).join(' › ')+' · '+names[dimension];header.append(title,button('↑ 返回上一層',()=>onPath(prefix.slice(0,-1))));section.append(header,auditPanel(view));
  const scroll=document.createElement('div');scroll.className='stage-chart-scroll';const canvas=document.createElement('canvas');canvas.className='stage-drill-chart';canvas.setAttribute('aria-label',title.textContent+'；可點選直條繼續下鑽');
  const select=index=>{const group=groups[index];if(!group)return;dimension==='defect'?onLeaf({...group,page:0}):onPath([...prefix,{key:group.key,label:group.label}]);};
  draw(canvas,groups,dimension,select);scroll.append(canvas);section.append(scroll);const list=document.createElement('div');list.className='defect-groups';
  for(const [index,group] of groups.entries()){const choice=button(group.label+' · '+(dimension==='defect'?'基準投入 ':'投入 ')+group.input+' · '+(dimension==='defect'?'項目 PPID '+group.count+' · 不良率 ':'良率 ')+pct(group.value),()=>select(index));choice.dataset.key=group.key;choice.dataset.input=group.input;choice.dataset.bad=group.count;choice.dataset.yield=group.value;list.append(choice);}section.append(list);
  if(dimension==='defect'&&leaf){
   const records=leaf.records||[],page=Math.min(leaf.page||0,Math.max(0,Math.ceil(records.length/100)-1)),detail=document.createElement('div');detail.className='scroll';detail.style.maxHeight='320px';
   detail.append(table(['日期','製程','產品','PPID','不良項目','狀態','工單'],records.slice(page*100,page*100+100).map(row=>[row.date,row.process,row.ic+'／'+row.model,row.serial,row.defect||'【未填不良項目】',row.status,row.order])));
   const pager=document.createElement('div');pager.className='row';const prev=button('上一頁',()=>onLeaf({...leaf,page:page-1})),next=button('下一頁',()=>onLeaf({...leaf,page:page+1}));prev.disabled=!page;next.disabled=(page+1)*100>=records.length;pager.append(prev,document.createTextNode(`${page+1} / ${Math.max(1,Math.ceil(records.length/100))} · ${records.length} 筆`),next);section.append(document.createTextNode('不良 PPID 明細'),detail,pager);
  }
  host.append(section);
 }
}
