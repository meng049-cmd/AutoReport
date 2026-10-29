import {norm,text} from './matcher.mjs';

function identity(result,row){
 const criteria=(row['查找條件']||[]).map(item=>[item['欄位類別'],text(item['查找值'])]).filter(([,value])=>value);
 const order=criteria.find(([kind])=>kind==='order')?.[1]||'';
 const part=criteria.find(([kind])=>kind==='part')?.[1]||'';
 const terms=order?[['order',norm(order)],...(part?[['part',norm(part)]]:[])]:criteria.map(([kind,value])=>[kind,norm(value)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 // Rows without identifiers must never share a correction just because both are blank.
 const key=JSON.stringify(terms.length?terms:[['file',result['檔名']],['sheet',row['分頁']],['row',row['列號']]]);
 return {key,order,part,query:criteria.map(([,value])=>value).join('／')};
}

export function summarizeMatchCorrections(result){
 const groups=new Map();
 for(const row of result['結果']){
  if(row['狀態']==='唯一匹配')continue;
  const item=identity(result,row);
  if(!groups.has(item.key))groups.set(item.key,{...item,rows:0,pending:0,statuses:new Set(),sheets:new Set()});
  const group=groups.get(item.key);group.rows++;if(row['狀態']!=='手動補填')group.pending++;
  group.statuses.add(row['狀態']);group.sheets.add(row['分頁']);
 }
 return [...groups.values()].map(group=>({...group,statuses:[...group.statuses],sheets:[...group.sheets]}));
}

export function applyMatchCorrections(result,corrections=[]){
 const updates=new Map();
 for(const correction of corrections){
  const model=text(correction.model),ic=text(correction.ic);
  if(!correction.key||!model||!ic)throw Error('補填對照必須完整填寫 IC 與機種。');
  const previous=updates.get(correction.key);
  if(previous&&(previous.model!==model||previous.ic!==ic))throw Error('同一工單／料號有不同補填對照，請確認後再試。');
  updates.set(correction.key,{model,ic});
 }
 if(!updates.size)return result;
 for(const row of result['結果']){
  if(row['狀態']==='唯一匹配')continue;
  const update=updates.get(identity(result,row).key);if(!update)continue;
  const source={'檔案':'本批次手動補填','分頁':row['分頁'],'列號':row['列號']};
  row['原比對狀態']=row['狀態'];row['狀態']='手動補填';row.IC=update.ic;row['機種']=update.model;
  row['候選']=[{IC:update.ic,'機種':update.model,'產品系列':[],'來源':[source]}];
  row['查找依據']=[...(row['查找依據']||[]),source];
 }
 return result;
}
