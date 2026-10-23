import {calendarDates} from './defect-analysis.mjs';

export const stageProcesses=stage=>stage==='前段'?['DAF外觀','DAF熱壓投入','功能一測試']:['功能二測試','外觀檢查點亮測試','輝度機測試'];
const mean=values=>values.length?values.reduce((sum,n)=>sum+n,0)/values.length:null;
const close=(a,b)=>a==null||b==null?a===b:Math.abs(a-b)<1e-10;
function addUnit(units,row){
 const old=units.get(row.serial);
 if(!old||(!old.fail&&row.fail)||(row.fail&&row.status==='FAIL'&&old.status!=='FAIL'))units.set(row.serial,row);
}
function stats(units){const input=units.size,count=[...units.values()].filter(row=>row.fail).length;return {input,count,good:input-count,value:input?(input-count)/input:null};}
function union(groups){const units=new Map();for(const group of groups)for(const row of group.units.values())addUnit(units,row);return units;}

/** Every stage scope uses the same unique-PPID good/input ratio. */
export function buildStageAnalysis(analysis,stage,start,end,checks=[]){
 const allowed=new Set(stageProcesses(stage)),days=new Map(),products=new Map(analysis.products.map(product=>[product.id,product])),savedByDate=new Map();
 for(const check of checks)if(check.stage===stage&&Number.isFinite(check.yield)){const values=savedByDate.get(check.date)||[];values.push(check);savedByDate.set(check.date,values);}
 for(const row of analysis.observations||[]){
  if(row.attributionOnly||!allowed.has(row.process)||row.date<start||row.date>end)continue;
  let day=days.get(row.date);if(!day){day=new Map();days.set(row.date,day);}
  let product=day.get(row.product);if(!product){product=new Map();day.set(row.product,product);}
  let cell=product.get(row.process);if(!cell){cell={product:row.product,process:row.process,units:new Map()};product.set(row.process,cell);}
  addUnit(cell.units,row);
 }
 const daily=calendarDates(start,end).map(date=>{
  const day=days.get(date)||new Map(),cells=[...day.values()].flatMap(processes=>[...processes.values()]),units=union(cells),value=stats(units).value;
  const saved=savedByDate.get(date),savedInput=saved?.reduce((n,row)=>n+(row.input||0),0),expected=savedInput?saved.reduce((n,row)=>n+row.good,0)/savedInput:value;
  return {date,...stats(units),calculated:value,expected,consistent:close(value,expected)};
 });
 const allCells=[...days.values()].flatMap(day=>[...day.values()].flatMap(processes=>[...processes.values()])),sumDailyInput=daily.reduce((sum,row)=>sum+row.input,0),period={...stats(union(allCells)),sumDailyInput};period.repeatedInput=sumDailyInput-period.input;
 return {stage,start,end,days,products,daily,period};
}

export function stageDrillView(model,path){
 const date=path[0]?.key,day=model.days.get(date)||new Map(),dimension=path.length===1?'process':path.length===2?'product':'defect';
 const process=path[1]?.key,product=path[2]?.key,label=id=>{const item=model.products.get(id);return item?item.ic+'／'+item.model:id;};
 let groups=[],parent,contributors=[],productSummaries=[],comparison=null;
 if(path.length===1){
  const map=new Map();
  for(const processes of day.values())for(const cell of processes.values()){
   const group=map.get(cell.process)||{key:cell.process,label:cell.process,units:new Map(),allocatedInput:0,allocatedGood:0,allocatedBad:0};
   for(const row of cell.units.values())addUnit(group.units,row);map.set(cell.process,group);
  }
  groups=[...map.values()].map(group=>({...group,...stats(group.units)}));
  parent=model.daily.find(row=>row.date===date)||{input:0,count:0,good:0,value:null,consistent:true};
  // Allocate each union PPID once for an additive proof; raw process inputs stay unchanged.
  const owned=union(groups),byProcess=new Map(groups.map(group=>[group.key,group]));
  for(const row of owned.values()){const group=byProcess.get(row.process);group.allocatedInput++;group[row.fail?'allocatedBad':'allocatedGood']++;}
  for(const group of groups)group.contribution=parent.input?group.allocatedGood/parent.input:0;
  productSummaries=[...day].map(([id,processes])=>{const s=stats(union([...processes.values()])),weight=parent.input?s.input/parent.input:0;return {key:id,label:label(id),...s,processCount:processes.size,weight,inputShare:weight,contribution:parent.input?s.good/parent.input:0,badContribution:parent.input?s.count/parent.input:0};}).sort((a,b)=>b.badContribution-a.badContribution||a.label.localeCompare(b.label));
  contributors=productSummaries;
  const processInput=groups.reduce((sum,row)=>sum+row.input,0),processGood=groups.reduce((sum,row)=>sum+row.good,0);
  comparison={stageYield:parent.value,directProcessMean:mean(groups.map(row=>row.value)),processPooledYield:processInput?processGood/processInput:null,uniqueYield:parent.value,processInput,processGood};
 }else if(path.length===2){
  for(const [id,processes] of day){const cell=processes.get(process);if(cell)groups.push({key:id,label:label(id),units:cell.units,...stats(cell.units)});}
  parent=stats(union(groups));for(const group of groups)group.contribution=parent.input?group.good/parent.input:0;
 }else{
  const cell=day.get(product)?.get(process),units=cell?.units||new Map();parent=stats(units);const map=new Map();
  for(const row of units.values())if(row.fail){const name=String(row.defect||'').trim()||'【未填不良項目】',group=map.get(name)||{key:name,label:name,units:new Map(),records:[]};group.units.set(row.serial,row);group.records.push({...row,ic:model.products.get(product)?.ic,model:model.products.get(product)?.model});map.set(name,group);}
  groups=[...map.values()].map(group=>({...group,input:parent.input,affected:group.units.size,count:group.units.size,good:0,value:parent.input?group.units.size/parent.input:null,contribution:parent.input?group.units.size/parent.input:0}));
 }
 groups.sort((a,b)=>(dimension==='defect'?b.count-a.count:b.input-a.input)||a.label.localeCompare(b.label));
 const all=union(groups),sumInput=groups.reduce((sum,group)=>sum+group.input,0),uniqueInput=all.size,overlap=dimension==='defect'?0:sumInput-uniqueInput;
 const count=groups.reduce((sum,group)=>sum+group.count,0),reconstructed=parent.input?(dimension==='defect'?1-groups.reduce((sum,group)=>sum+group.value,0):dimension==='process'?stats(all).value:groups.reduce((sum,group)=>sum+group.contribution,0)):null;
 const inputOK=dimension==='defect'?parent.good+uniqueInput===parent.input:uniqueInput===parent.input;
 return {date,dimension,groups,parent,contributors,productSummaries,comparison,audit:{sumInput,uniqueInput,overlap,count,badOverlap:count-parent.count,reconstructed,inputOK,yieldOK:close(reconstructed,parent.value),reportOK:parent.consistent!==false}};
}

export function stageAuditSheets(model){
 const labels={process:'日期 → 製程',product:'製程 → 產品',defect:'產品 → 不良項目'};
 const rows=[['日期','層級','製程','產品／不良項目','投入唯一PPID／基準投入','良品PPID','不良PPID','良率／不良項目不良率','對上層良率貢獻／不良率扣除值','上層良率','投入驗算通過','良率驗算通過','歸屬投入（互斥驗算）','歸屬良品（互斥驗算）','歸屬不良（互斥驗算）']],weights=[['日期','產品','跨製程唯一投入','唯一良品','唯一不良','產品良率','投入權重','對日期良率貢獻','對日期不良率貢獻']],totals=[['日期','層級','製程','產品','上層唯一投入','子層投入合計／不良項目片數','重複計入次數','子層PPID聯集','良品片數','回算良率','上層良率','驗算通過']];
 const comparisons=[['日期','日期階段唯一PPID良率（日期柱）','百分比直接平均（非採用）','重複過站投入加權比例（非採用）','唯一PPID良率','當日階段唯一投入','當日階段唯一不良']];
 const add=path=>{
  const view=stageDrillView(model,path),{parent,audit,dimension}=view;
  totals.push([view.date,labels[dimension],path[1]?.label||'',path[2]?.label||'',parent.input,dimension==='defect'?audit.uniqueInput:audit.sumInput,audit.overlap,audit.uniqueInput,parent.good,audit.reconstructed,parent.value,audit.inputOK&&audit.yieldOK&&audit.reportOK]);
  for(const item of view.contributors)weights.push([view.date,item.label,item.input,item.good,item.count,item.value,item.weight,item.contribution,item.badContribution]);
  if(view.comparison){const c=view.comparison;comparisons.push([view.date,c.stageYield,c.directProcessMean,c.processPooledYield,c.uniqueYield,parent.input,parent.count]);}
  for(const group of view.groups){rows.push([view.date,labels[dimension],path[1]?.label||group.label,dimension==='process'?'全部產品':group.label,group.input,group.good,group.count,group.value,group.contribution,parent.value,audit.inputOK,audit.yieldOK,group.allocatedInput??null,group.allocatedGood??null,group.allocatedBad??null]);if(path.length<3)add([...path,{key:group.key,label:group.label}]);}
 };
 for(const day of model.daily)if(day.input)add([{key:day.date,label:day.date}]);
 return [{name:'逐層數量與良率',rows,percentColumns:[7,8,9]},{name:'日期良率貢獻明細',rows:weights,percentColumns:[5,6,7,8]},{name:'逐層驗算總表',rows:totals,percentColumns:[9,10]},{name:'日期良率口徑比較',rows:comparisons,percentColumns:[1,2,3,4]},{name:'分析期間驗算',rows:[['開始日期','結束日期','每日投入合計','跨日重複計入次數','期間唯一投入PPID','期間唯一不良PPID','期間唯一PPID良率'],[model.start,model.end,model.period.sumDailyInput,model.period.repeatedInput,model.period.input,model.period.count,model.period.value]],percentColumns:[6]}];
}
