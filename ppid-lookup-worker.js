const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version);

function text(value){return String(value??'').normalize('NFKC').trim();}
function key(value){return text(value).toLocaleUpperCase('en-US');}
function compact(value){return key(value).replace(/[\s_\-./\\#()：:]/g,'');}
const ppidHeaders=new Set(['PPID','小板序號','小板序号','序號','序号','序列號','序列号','板序號','板序号','單板序號','单板序号','SERIAL','SERIALNUMBER','SERIALNO','SERIALID','小板']);
function isPpidHeader(value){
 const header=compact(value);
 return ppidHeaders.has(header)||/^(?:PPID(?:NO|NUMBER|ID|SN|SERIAL|SERIALNO|KEY|編號|编号|號|号|小板序號|小板序号|序號|序号)?|(?:小板序號|小板序号|序號|序号|序列號|序列号|板序號|板序号|單板序號|单板序号)(?:PPID|SN)?|SERIAL(?:NO|NUMBER|ID)?|小板(?:序號|序号|SN))$/.test(header);
}
function isPpidHeaderLabel(value){return isPpidHeader(value);}
function parseList(textValue,buffer){
 const values=[];
 if(textValue)values.push(...String(textValue).replace(/^\uFEFF/,'').split(/[\t\r\n,，;；]+/));
 if(buffer){
  const book=XLSX.read(buffer,{type:'array',dense:true,cellDates:true});
  for(const sheetName of book.SheetNames){
   const sheet=book.Sheets[sheetName],range=sheet?.['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;if(!range)continue;
   const read=(r,c)=>{const cell=Array.isArray(sheet)?sheet[r]?.[c]:sheet[XLSX.utils.encode_cell({r,c})];return cell?.v??'';};
   let headerRow=-1,column=range.s.c;
   for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+9);r++){
    for(let c=range.s.c;c<=range.e.c;c++)if(isPpidHeader(read(r,c))){headerRow=r;column=c;break;}
    if(headerRow>=0)break;
   }
   if(headerRow<0){if(book.SheetNames.length>1)continue;column=range.s.c;}
   const first=headerRow>=0?headerRow+1:range.s.r;
   for(let r=first;r<=range.e.r;r++)values.push(read(r,column));
  }
 }
 const unique=new Map();
 for(const value of values){const label=text(value);if(!label||isPpidHeaderLabel(label))continue;const canonical=key(label);if(!unique.has(canonical))unique.set(canonical,label);}
 return [...unique].map(([canonical,label])=>({canonical,label}));
}
function cellValue(sheet,row,col,dense){
 const cell=dense?sheet[row]?.[col]:sheet[XLSX.utils.encode_cell({r:row,c:col})];
 if(cell?.v instanceof Date)return cell.v.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');
 const value=cell?.v;return value==null?'':String(value);
}
function findPpidColumn(headers){
 for(let index=0;index<headers.length;index++)if(isPpidHeader(headers[index]))return index;
 return -1;
}
function readHeaders(sheet,range,dense,row){
 const headers=[];
 for(let c=range.s.c;c<=range.e.c;c++)headers.push(cellValue(sheet,row,c,dense));
 return headers;
}
const waitingAcks=new Map();
async function emitChunk(id,schema,rows){
 const acknowledged=new Promise(resolve=>waitingAcks.set(id,resolve));
 self.postMessage({id,type:'chunk',schema,rows});
 await acknowledged;
}
async function searchFile({id,buffer,file,targets}){
 const targetMap=new Map(targets.map(item=>[item.canonical,item.label])),book=XLSX.read(buffer,{type:'array',dense:true,cellDates:true,cellHTML:false,cellText:false});
 let matches=0,sheetsScanned=0,batch=[];
 for(const sheetName of book.SheetNames){
  const sheet=book.Sheets[sheetName],ref=sheet?.['!ref'];if(!ref)continue;
  const range=XLSX.utils.decode_range(ref),dense=Array.isArray(sheet),scanEnd=Math.min(range.e.r,range.s.r+49);
  let headerRow=-1,serialColumn=-1,headers=[],headerScore=-1;
  for(let r=range.s.r;r<=scanEnd;r++){
   const candidate=readHeaders(sheet,range,dense,r),column=findPpidColumn(candidate);
   const score=candidate.filter(value=>String(value).trim()).length;
   if(column>=0&&score>headerScore){headerRow=r;serialColumn=range.s.c+column;headers=candidate;headerScore=score;}
  }
  if(headerRow<0&&/^detail(?:_\d+)?$/i.test(sheetName.trim())){
   headerRow=range.s.r;serialColumn=Math.min(range.s.c+4,range.e.c);headers=readHeaders(sheet,range,dense,headerRow);
  }
  if(headerRow<0)continue;
  sheetsScanned++;
  headers=headers.map((value,index)=>String(value).trim()?value:`欄位 ${range.s.c+index+1}`);
  const schema={id:`${file.id}\u0000${sheetName}`,sheet:sheetName,headers};
  for(let r=headerRow+1;r<=range.e.r;r++){
   const ppid=cellValue(sheet,r,serialColumn,dense),canonical=key(ppid);if(!targetMap.has(canonical))continue;
   const rowData=[];for(let c=range.s.c;c<=range.e.c;c++)rowData.push(cellValue(sheet,r,c,dense));
   batch.push({ppid:targetMap.get(canonical),row:r+1,rowData});matches++;
   if(batch.length>=500){await emitChunk(id,schema,batch);batch=[];}
  }
  if(batch.length){await emitChunk(id,schema,batch);batch=[];}
 }
 return {matches,sheetsScanned};
}
self.onmessage=async({data})=>{
 if(data.type==='ack'){const resolve=waitingAcks.get(data.id);if(resolve){waitingAcks.delete(data.id);resolve();}return;}
 try{
  if(data.type==='parse')self.postMessage({id:data.id,type:'result',ppids:parseList(data.text,data.buffer)});
  else if(data.type==='search')self.postMessage({id:data.id,type:'complete',...await searchFile(data)});
  else self.postMessage({id:data.id,type:'result',error:'未知查找操作。'});
 }catch(error){self.postMessage({id:data.id,type:'complete',error:error.message||'檔案無法讀取。'});}
};
