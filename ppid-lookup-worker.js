const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version);

function text(value){return String(value??'').normalize('NFKC').trim();}
function key(value){return text(value).toLocaleUpperCase('en-US');}
function parseList(textValue,buffer,name){
 const values=[];
 if(textValue)values.push(...String(textValue).replace(/^\uFEFF/,'').split(/[\t\r\n,，;；]+/));
 if(buffer){
  const book=XLSX.read(buffer,{type:'array',dense:true,cellDates:true});
  const headerNames=new Set(['PPID','小板序號','序號','SERIAL','SERIALNUMBER','小板']);
  for(const sheetName of book.SheetNames){
   const sheet=book.Sheets[sheetName],range=sheet?.['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;if(!range)continue;
   const read=(r,c)=>{const cell=Array.isArray(sheet)?sheet[r]?.[c]:sheet[XLSX.utils.encode_cell({r,c})];return cell?.v??'';};
   let headerRow=-1,column=0;
   for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+9);r++){
    for(let c=range.s.c;c<=range.e.c;c++)if(headerNames.has(key(read(r,c)).replace(/[\s_\-]/g,''))){headerRow=r;column=c;break;}
    if(headerRow>=0)break;
   }
   const first=headerRow>=0?headerRow+1:range.s.r,startColumn=headerRow>=0?column:range.s.c;
   for(let r=first;r<=range.e.r;r++)values.push(read(r,startColumn));
  }
 }
 const unique=new Map();
 for(const value of values){const label=text(value);if(!label||['PPID','小板序號','序號','SERIAL','SERIALNUMBER','小板'].includes(key(label).replace(/[\s_\-]/g,'')))continue;const canonical=key(label);if(!unique.has(canonical))unique.set(canonical,label);}
 if(unique.size>10000)throw Error('一次最多查找 10,000 個 PPID，請分批輸入。');
 return [...unique].map(([canonical,label])=>({canonical,label}));
}
function cellValue(sheet,row,col,dense){
 const cell=dense?sheet[row]?.[col]:sheet[XLSX.utils.encode_cell({r:row,c:col})];
 if(cell?.v instanceof Date)return cell.v.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');
 return text(cell?.v??'');
}
function findColumn(headers,aliases,fallback){const wanted=new Set(aliases.map(value=>key(value).replace(/[\s_\-]/g,'')));const index=headers.findIndex(value=>wanted.has(key(value).replace(/[\s_\-]/g,'')));return index<0?fallback:index;}
function searchFile({buffer,file,targets}){
 const targetMap=new Map(targets.map(item=>[item.canonical,item.label]));
 const list=XLSX.read(buffer,{type:'array',bookSheets:true}).SheetNames.filter(name=>/^detail(?:_\d+)?$/i.test(name.trim()));
 if(!list.length)return {matches:[],warning:'找不到 Detail 分頁'};
 const book=XLSX.read(buffer,{type:'array',dense:true,sheets:list,cellDates:true,cellHTML:false,cellText:false});
 const matches=[];let truncated=false;
 for(const sheetName of list){
  const sheet=book.Sheets[sheetName],ref=sheet?.['!ref'];if(!ref)continue;const range=XLSX.utils.decode_range(ref),dense=Array.isArray(sheet),headers=[];
  for(let c=range.s.c;c<=range.e.c;c++)headers[c]=cellValue(sheet,range.s.r,c,dense);
  const columns={process:findColumn(headers,['製程','Process'],0),order:findColumn(headers,['工單','工單號碼','Order'],1),part:findColumn(headers,['料號','產品料號','Part'],2),serial:findColumn(headers,['小板序號','PPID','Serial','序號'],4),time:findColumn(headers,['產出時間','時間','Time','Date'],5),defect:findColumn(headers,['不良項目','不良','Defect'],7),status:findColumn(headers,['狀態','Status','Result'],8),ic:findColumn(headers,['IC','IC型號'],9),model:findColumn(headers,['機種','Model'],10)};
  for(let r=range.s.r+1;r<=range.e.r;r++){
   const serial=cellValue(sheet,r,columns.serial,dense),canonical=key(serial);if(!targetMap.has(canonical))continue;
   matches.push({id:file.id,name:file.name,collection:file.collection,source:file.source,ppid:targetMap.get(canonical),process:cellValue(sheet,r,columns.process,dense),order:cellValue(sheet,r,columns.order,dense),part:cellValue(sheet,r,columns.part,dense),time:cellValue(sheet,r,columns.time,dense),defect:cellValue(sheet,r,columns.defect,dense),status:cellValue(sheet,r,columns.status,dense),ic:cellValue(sheet,r,columns.ic,dense),model:cellValue(sheet,r,columns.model,dense),sheet:sheetName,row:r-range.s.r+1});
   if(matches.length>=10000){truncated=true;break;}
  }
  if(truncated)break;
 }
 return {matches,truncated};
}
self.onmessage=({data})=>{
 try{
  if(data.type==='parse')self.postMessage({id:data.id,ppids:parseList(data.text,data.buffer,data.name)});
  else if(data.type==='search')self.postMessage({id:data.id,...searchFile(data)});
  else self.postMessage({id:data.id,error:'未知查找操作。'});
 }catch(error){self.postMessage({id:data.id,error:error.message||'檔案無法讀取。'});}
};
