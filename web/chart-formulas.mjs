import {dateInputAudits,dimensionNames} from './defect-analysis.mjs';
const pct=value=>Number.isFinite(value)?(value*100).toFixed(4)+'%':'—';
const ratio=(good,input)=>input?`${good} ÷ ${input} = ${pct(good/input)}`:'無投入，留白';
function text(host,value){const line=document.createElement('p');line.textContent=value;host.append(line);}
function table(headers,rows){const scroll=document.createElement('div');scroll.className='scroll formula-table';const node=document.createElement('table'),header=node.createTHead().insertRow();for(const label of headers){const th=document.createElement('th');th.textContent=label;header.append(th);}const body=node.createTBody();for(const row of rows){const line=body.insertRow();for(const value of row)line.insertCell().textContent=value??'';}scroll.append(node);return scroll;}

export function stageFormulaContent(view){
 const host=document.createElement('div');host.className='stage-formula-content';const {parent,dimension,groups}=view;
 if(dimension==='process'){
  text(host,'每個製程與產品先以實際片數計算：N = 範圍內唯一投入 PPID，B = 同範圍任一紀錄不良的唯一 PPID，G = N − B，製程良率 Y = G ÷ N；日期階段主要值另採各有效製程良率平均。FAIL／Scrap 或有不良項目的 GOOD 均計不良。');
  host.append(table(['層級','運算公式','回算方式'],[
   ['日期階段（主要日期柱）','Y平均(日) = AGGREGATE(1,6,該階段有資料製程的良率)','先合併各產品片數計算製程良率，再平均製程；空白略過、0%納入。唯一投入仍為製程PPID聯集。'],
   ['製程柱','Y(s) = (N(s) − B(s)) ÷ N(s)','同片在各製程各計一次；主要日期良率平均製程比例，投入及唯一PPID比較值另以聯集去重。'],
   ['產品於本製程','Y(p,s) = G(p,s) ÷ N(p,s)','產品身份互斥，Σ產品投入 = 製程投入；Σ產品良品 ÷ Σ產品投入 = 製程良率。'],
   ['不良項目','R(d) = B(d) ÷ 上層產品／製程投入 N','各項共用同一母數；良品 + 各項不良 = N，1 − ΣR(d) = 上層良率。'],
   ['產品於當日階段','Y(p) = 產品跨製程唯一良品 ÷ 產品跨製程唯一投入','投入權重 = N(p) ÷ N(日)；Σ[Y(p) × 投入權重] = 日期唯一PPID比較良率；不是主要製程平均良率。'],
  ]));
  const c=view.comparison;host.append(table(['同一天的口徑比較','實際結果','用途'],[
   ['採用：AGGREGATE(1,6,…) 製程平均良率',pct(c.directProcessMean),'對下方有資料製程柱取算術平均。沒有再平均產品。'],
   ['比較：唯一 PPID 良率',ratio(parent.good,parent.input),'1－同階段唯一不良／同階段唯一投入。只取同一天、同階段三個指定製程。'],
   ['兩算法差異（百分點）',c.difference==null?'—':(c.difference*100).toFixed(4),'製程平均良率－唯一PPID良率，乘100；不是相對百分比。'],
   ['重複過站投入加權比例',ratio(c.processGood,c.processInput),'僅作差異比較。跨製程同片重複，母數不等於唯一投入，因此不採用。'],
  ]));
  text(host,'下表只分解「唯一PPID比較良率」：產品身份互斥，投入、良品、不良與比較貢獻可相加。主要日期柱平均的是製程良率，不再平均產品百分比。');
  host.append(table(['產品','跨製程唯一投入','唯一良品','唯一不良','產品良率','投入權重','對日期唯一PPID良率貢獻（比較）','對日期唯一PPID不良率貢獻（比較）'],view.productSummaries.map(row=>[row.label,row.input,row.good,row.count,pct(row.value),pct(row.weight),pct(row.contribution),pct(row.badContribution)])));
 }else if(dimension==='product'){
  text(host,'本層產品柱表示「良率」。同一範圍的不良率 = 不良 PPID ÷ 投入 PPID = 1 − 良率。');
  host.append(table(['層級','公式與實際結果','比較'],[
   ['上層製程合併良率',ratio(parent.good,parent.input),'各產品依投入量加權，不是各產品百分比等權平均。'],
   ['本層產品良率','Y(p,s) = (N(p,s) − B(p,s)) ÷ N(p,s)','每個產品只用自身當日當製程的唯一投入。'],
   ['回算上層製程','Σp G(p,s) ÷ N(s) = Σp [Y(p,s) × N(p,s) ÷ N(s)]','產品身份互斥，產品良品合計及投入合計可回到該製程。'],
  ]));
  host.append(table(['產品','唯一投入','良品','不良','本層柱：良率','同範圍不良率','投入權重','對製程良率貢獻'],groups.map(row=>[row.label,row.input,row.good,row.count,pct(row.value),pct(row.input?row.count/row.input:null),pct(parent.input?row.input/parent.input:null),pct(row.contribution)])));
 }else{
  text(host,'本層不良項目柱表示「不良率」。同片在當日、當製程只歸屬一個不良項目，FAIL／Scrap 優先，其次為有不良項目的 GOOD。');
  host.append(table(['層級','運算公式','與上層的差異'],[
   ['不良項目柱','R(d) = 該項唯一不良 PPID B(d) ÷ 上層產品／製程唯一投入 N','這是單一項目的不良率，不是良率。各項共用 N，不重複相加母數。'],
   ['上層產品良率',ratio(parent.good,parent.input),'Y = 1 − Σd R(d)；良品 + 各項唯一不良片數 = N。'],
   ['完整不良分析','使用全檔跨日期、跨製程的首次不良歸屬','此處細分當日當製程的不良，以對應每日製程良率，範圍不同。'],
  ]));
 }
 return host;
}

export function contributionFormulaDetails(analysis,view,scope){
 const details=document.createElement('details');details.className='formula-notes contribution-formulas';details.dataset.dimension=view.dimension;const summary=document.createElement('summary');summary.textContent='本層公式、投入去重與口徑比較';details.append(summary);
 let loaded=false;details.addEventListener('toggle',()=>{
  if(!details.open||loaded)return;loaded=true;
  text(details,`目前橫軸：${dimensionNames[view.dimension]}。全檔唯一投入 N全檔 = ${analysis.total}；這是全檔貢獻欄的固定母數；不良項目柱另用其所屬製程的唯一投入。只計前段（DAF熱壓投入、DAF外觀、功能一測試）與後段（輝度機測試、功能二測試、外觀檢查點亮測試）；其他製程紀錄不計。`);
  details.append(table(['數字','公式','與其他數字的差異'],[
   view.dimension==='defect'?['本層長條高度（製程內項目不良率）','R(製程,項目) = 此製程此項唯一不良 PPID ÷ 同條件下此製程唯一投入 PPID','按製程＋項目分組；同名跨製程分開，投入不使用階段合計；各項比率不跨製程相加。']:['本層長條高度（全檔不良率貢獻）','C(g) = 首次歸屬此群的不良 PPID B(g) ÷ N全檔','全檔貢獻固定全檔母數；與不良項目圖的製程內不良率不同。'],
   ['長條旁投入','N(g) = 符合日期／所屬製程／產品／工單範圍的 PPID 聯集大小','包含良品與不良品；不按不良項目縮小母數。'],
   ['該群歸屬不良率','R(g) = B(g) ÷ N(g)','只在群內計比例，與長條的全檔貢獻不同。'],
   ['唯一 PPID 全檔總良率','Y全檔 = (N全檔 − 全檔唯一不良 PPID) ÷ N全檔','全檔每片只計一次；不是各日期／製程百分比的算術平均。'],
  ]));
  if(view.dimension==='date'){
   text(details,'日期投入 N(日) = |各納入製程 PPID 的聯集|。同日同片跨兩個製程只計 1；跨週／月時亦在該期間內跨日去重。下表獨立重建各製程 PPID 集合，核對圖上每日投入。');
   const audits=dateInputAudits(analysis,scope),allowed=new Set(view.groups.map(group=>group.key)),selected=audits.filter(row=>allowed.has(row.key));
   details.dataset.inputAuditPass=String(selected.every(row=>row.consistent));
   details.append(table(['日期區間','製程投入合計','跨製程重複計入次數','PPID聯集唯一投入','圖上投入','驗算'],selected.map(row=>[row.label,row.processInputSum,row.repeatedInput,row.uniqueInput,row.input,row.consistent?'通過':'未吻合'])));
  }
  details.append(table(['項目','首次歸屬不良PPID','該群唯一投入（項目為所屬製程）','該群歸屬不良率','全檔貢獻分母','全檔不良率貢獻（另列）'],view.groups.map(row=>[row.label,row.count,row.input,pct(row.rate),analysis.total,pct(row.contribution)])));
 });return details;
}
