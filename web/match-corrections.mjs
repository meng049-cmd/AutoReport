import {norm,text} from './matcher.mjs';

export function correctionOptions(records=[]){
 const collect=field=>{
  const values=new Map(),missing=new Set(['','-','n/a','na','none','无','未知']);
  for(const record of records){const value=text(record[field]),key=norm(value);if(!missing.has(key)&&!values.has(key))values.set(key,value);}
  return [...values.values()].sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true}));
 };
 return {ics:collect('ic'),models:collect('model')};
}

export function canonicalCorrectionName(value,options=[]){
 const label=text(value),key=norm(label);
 return options.find(option=>norm(option)===key)||label;
}

const stageProcesses=new Set(['DAF外觀','DAF熱壓投入','功能一測試','功能二測試','外觀檢查點亮測試','輝度機測試'].map(norm));
const stageProcessAliases=new Map([
 ['DAF外觀檢查','DAF外觀'],['DAF熱壓入','DAF熱壓投入'],['功能一測','功能一測試'],['功能一測試站','功能一測試'],
 ['功能二測','功能二測試'],['功能二測試站','功能二測試'],['外觀檢查點亮','外觀檢查點亮測試'],['輝度機測','輝度機測試']
].map(([alias,canonical])=>[norm(alias),norm(canonical)]));

function correctionProcess(row){
 const source=row['原始資料'];if(!Array.isArray(source))return {available:false,value:''};
 if(row['分頁']==='Detail')return {available:true,value:text(source[0])};
 const cell=source.find(item=>item&&typeof item==='object'&&(/制程|工序|站别|工位|站点|process|station/.test(norm(item['欄位']))));
 return cell?{available:true,value:text(cell['值'])}:{available:false,value:''};
}

function needsStageCorrection(row){
 const {available,value}=correctionProcess(row);
 // Query sheets without a process field retain the existing lookup behavior.
 if(!available)return row['分頁']!=='Detail';
 const process=norm(value);if(!process)return false;
 return stageProcesses.has(stageProcessAliases.get(process)||process);
}

function identity(result,row){
 const criteria=(row['查找條件']||[]).map(item=>[item['欄位類別'],text(item['查找值'])]).filter(([,value])=>value);
 const order=criteria.find(([kind])=>kind==='order')?.[1]||'';
 const part=criteria.find(([kind])=>kind==='part')?.[1]||'';
 const terms=order?[['order',norm(order)],...(part?[['part',norm(part)]]:[])]:criteria.map(([kind,value])=>[kind,norm(value)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 // Rows without identifiers must never share a correction just because both are blank.
 const key=JSON.stringify(terms.length?terms:[['file',result['檔名']],['sheet',row['分頁']],['row',row['列號']]]);
 return {key,order,part,query:criteria.map(([,value])=>value).join('／')};
}

export function matchCorrectionIdentity(result,row){return identity(result,row);}

export function summarizeMatchCorrections(result){
 const groups=new Map();
 for(const row of result['結果']){
  if(row['狀態']==='唯一匹配'||!needsStageCorrection(row))continue;
  const item=identity(result,row);
  if(!groups.has(item.key))groups.set(item.key,{...item,rows:0,pending:0,statuses:new Set(),sheets:new Set()});
  const group=groups.get(item.key);group.rows++;if(row['狀態']!=='手動補填')group.pending++;
  group.statuses.add(row['狀態']);group.sheets.add(row['分頁']);
 }
 return [...groups.values()].map(group=>({...group,statuses:[...group.statuses],sheets:[...group.sheets]}));
}

export function summarizeResolvedPPIDMappings(result){
 const groups=new Map();
 for(const row of result['結果']){
  if(!['唯一匹配','手動補填'].includes(row['狀態'])||!needsStageCorrection(row))continue;
  const serial=text(row.compactValues?.[4]??row['原始資料']?.[4]),ic=text(row.IC),model=text(row['機種']);
  if(!serial||(!ic&&!model))continue;
  const item=identity(result,row),key=JSON.stringify([serial,item.key,ic,model]);
  if(!groups.has(key))groups.set(key,{serial,...item,ic,model,rows:0});
  groups.get(key).rows++;
 }
 return [...groups.values()];
}

export function applyMatchCorrections(result,corrections=[],options={}){
 const updates=new Map();
 for(const correction of corrections){
  const model=canonicalCorrectionName(correction.model,options.models),ic=canonicalCorrectionName(correction.ic,options.ics);
  if(!correction.key||!model||!ic)throw Error('補填對照必須完整填寫 IC 與機種。');
  const previous=updates.get(correction.key);
  if(previous&&(previous.model!==model||previous.ic!==ic))throw Error('同一工單／料號有不同補填對照，請確認後再試。');
  updates.set(correction.key,{model,ic});
 }
 if(!updates.size)return result;
 for(const row of result['結果']){
  const update=updates.get(identity(result,row).key);if(!update)continue;
  const source={'檔案':'本批次手動補填','分頁':row['分頁'],'列號':row['列號']};
  row['原比對狀態']=row['狀態'];row['狀態']='手動補填';row.IC=update.ic;row['機種']=update.model;
  row['候選']=[{IC:update.ic,'機種':update.model,'產品系列':[],'來源':[source]}];
  row['查找依據']=[...(row['查找依據']||[]),source];
 }
 return result;
}
