import {libraryReady,listLibraryFiles,libraryCollection} from './file-library.mjs';
import {navigate} from './navigation.mjs';
import ExcelJS from 'exceljs';

const $=id=>document.getElementById(id);
const pageSize=100;
let nextId=0,resultPage=0,lastMatches=[],lastPpids=[],lastWarnings=[],schemas=new Map(),filesById=new Map(),lastColumns=[];
const pending=new Map();
function attachWorker(){
 const lookupWorker=new Worker(new URL('../ppid-lookup-worker.js?v='+__BUILD_ID__,import.meta.url));
 lookupWorker.onmessage=({data})=>{
  const request=pending.get(data.id);if(!request)return;
  if(data.type==='chunk'){
   try{request.onChunk?.(data);}catch(error){request.chunkError??=error;}finally{lookupWorker.postMessage({id:data.id,type:'ack'});}return;
  }
  pending.delete(data.id);
  if(data.error)request.reject(Error(data.error));else if(request.chunkError)request.reject(request.chunkError);else request.resolve(data);
 };
 lookupWorker.onerror=()=>{for(const request of pending.values())request.reject(Error('PPID 查找工作程式中斷，該檔案無法完整讀取。'));pending.clear();lookupWorker.terminate();worker=attachWorker();};
 return lookupWorker;
}
let worker=attachWorker();
function call(type,payload={},transfer=[],onChunk){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject,onChunk});worker.postMessage({id,type,...payload},transfer);});}
function canonical(value){return String(value??'').normalize('NFKC').trim().toLocaleUpperCase('en-US');}
function compact(value){return canonical(value).replace(/[\s_\-./\\#]/g,'');}
function setStatus(value,error=false){$('ppidStatus').textContent=value;$('ppidStatus').className=error?'warn':'muted';}
function clearResults(){
 $('ppidResults').replaceChildren();$('ppidSummary').textContent='';$('ppidDownload').disabled=true;
 $('ppidPager').hidden=true;$('ppidMissing').textContent='';
 lastMatches=[];lastPpids=[];lastWarnings=[];schemas=new Map();filesById=new Map();lastColumns=[];resultPage=0;
}
function button(label,action){const element=document.createElement('button');element.type='button';element.className='secondary';element.textContent=label;element.onclick=action;return element;}
function libraryButton(match){return button('查看來源檔案',()=>window.dispatchEvent(new CustomEvent('library-open-ppid-file',{detail:{id:match.fileId}})));}
function resultColumns(){
 const columns=[],seen=new Set();
 for(const schema of schemas.values()){
  const counts=new Map();
  for(const name of schema.headers){const occurrence=(counts.get(name)||0)+1;counts.set(name,occurrence);const key=JSON.stringify([name,occurrence]);if(!seen.has(key)){seen.add(key);columns.push({name,key});}}
 }
 return columns;
}
function rowValues(match,columns){
 const schema=schemas.get(match.schemaId),values=new Map(),counts=new Map();
 (schema?.headers||[]).forEach((name,index)=>{const occurrence=(counts.get(name)||0)+1;counts.set(name,occurrence);values.set(JSON.stringify([name,occurrence]),match.rowData?.[index]??'');});
 return columns.map(column=>values.get(column.key)??'');
}
function sourceLabel(collection){return collection==='raw'?'Raw Data 原始檔':collection==='mergedDetail'?'歷史合併 Detail':collection==='analysis'?'分析報表':'Detail 比對';}
function resultTimeColumns(headers){return headers.map((name,index)=>({name,index})).filter(({name})=>/(時間|日期|過站|測試|TIME|DATE|TIMESTAMP|DATETIME)/i.test(name));}
function recordTime(match){
 const columns=schemas.get(match.schemaId)?.timeColumns||[],date=columns.find(({name})=>/(日期|DATE)/i.test(name)),time=columns.find(({name})=>/(時間|TIME)/i.test(name));
 const combined=date&&time&&date.index!==time.index?[match.rowData[date.index],match.rowData[time.index]].filter(Boolean).join(' '):'';
 for(const value of [combined,...columns.map(({index})=>match.rowData[index])])if(value){const parsed=Date.parse(value);if(!Number.isNaN(parsed))return parsed;}
 return null;
}
function missingPpids(){const found=new Set(lastMatches.map(match=>canonical(match.ppid)));return lastPpids.filter(item=>!found.has(item.canonical));}
function renderResults(){
 const matches=lastMatches,missing=missingPpids(),total=matches.length,pages=Math.ceil(total/pageSize),start=resultPage*pageSize,end=Math.min(start+pageSize,total),visible=matches.slice(start,end);
 const collectionCounts=new Map();for(const match of matches){const file=filesById.get(match.fileId);if(file)collectionCounts.set(file.collection,(collectionCounts.get(file.collection)||0)+1);}
 const sourceSummary=[...collectionCounts].map(([collection,count])=>`${sourceLabel(collection)} ${count} 筆`).join('、');
 $('ppidSummary').textContent=`輸入 ${lastPpids.length} 個 PPID；Raw Data 原始履歷 ${total} 筆${sourceSummary?'（'+sourceSummary+'）':''}；未找到 ${missing.length} 個。`;
 $('ppidMissing').textContent=missing.length?`未找到履歷：${missing.map(item=>item.label).join('、')}`:'';
 $('ppidPageInfo').textContent=total?`第 ${resultPage+1}／${pages} 頁，每頁 ${pageSize} 筆（共 ${total} 筆）`:'共 0 筆履歷';
 $('ppidPrev').disabled=resultPage===0;$('ppidNext').disabled=!pages||resultPage>=pages-1;$('ppidPager').hidden=total<=pageSize;
 if(!total){$('ppidResults').replaceChildren();return;}
 const table=document.createElement('table'),head=table.createTHead().insertRow(),columns=lastColumns;
 for(const label of ['查找來源','檔案','分頁／列號','查找 PPID',...columns.map(column=>column.name),'來源檔案庫']){const th=document.createElement('th');th.textContent=label;head.append(th);}
 const body=table.createTBody();
 for(const match of visible){
  const file=filesById.get(match.fileId),row=body.insertRow();
  for(const value of [file?.source||'',file?.name||'',`${match.sheet}／${match.row}`,match.ppid,...rowValues(match,columns)])row.insertCell().textContent=value||'—';
  row.insertCell().append(libraryButton(match));
 }
 $('ppidResults').replaceChildren(table);
}
async function search(){
 const pasted=$('ppidText').value,sourceFile=$('ppidExcel').files[0];
 if(!pasted.trim()&&!sourceFile){setStatus('請批次貼上 PPID，或選擇 Excel／CSV 清單。',true);return;}
 const searchButton=$('ppidSearch'),cancelText=searchButton.textContent;searchButton.disabled=true;searchButton.textContent='正在查找…';clearResults();
 try{
  await libraryReady;setStatus('正在整理 PPID 清單…');
  const inputBuffer=sourceFile?await sourceFile.arrayBuffer():null,parsed=await call('parse',{text:pasted,name:sourceFile?.name,buffer:inputBuffer},inputBuffer?[inputBuffer]:[]),ppids=parsed.ppids;
  if(!ppids.length)throw Error('沒有讀到可查找的 PPID，請確認 Excel 第一欄或欄名 PPID／小板序號。');
  lastPpids=ppids;
  const all=listLibraryFiles().filter(item=>libraryCollection(item)==='raw'),matches=[],warnings=[];let filesCompleted=0,filesWithoutPpidColumn=0;
  if(!all.length)setStatus('Raw Data 原始檔案庫目前沒有可查找檔案。');
  for(let index=0;index<all.length;index++){
   const entry=all[index],collection=libraryCollection(entry),file={id:entry.id,name:entry.name,collection,source:sourceLabel(collection)};
   filesById.set(entry.id,file);setStatus(`正在掃描 Raw Data 原始檔案庫：${index+1}/${all.length}（${entry.name}；已找到 ${matches.length.toLocaleString()} 筆）`);
   try{
    const buffer=await entry.blob.arrayBuffer();
    const result=await call('search',{file,targets:ppids,buffer},[buffer],({schema,rows})=>{
     if(!schemas.has(schema.id)){schema.timeColumns=resultTimeColumns(schema.headers);schemas.set(schema.id,schema);}
     for(const row of rows){const match={fileId:entry.id,schemaId:schema.id,sheet:schema.sheet,row:row.row,ppid:row.ppid,rowData:row.rowData};match.time=recordTime(match);matches.push(match);}
     if(matches.length&&matches.length%10000<rows.length)setStatus(`正在掃描 Raw Data 原始檔案庫：${index+1}/${all.length}（已找到 ${matches.length.toLocaleString()} 筆）`);
    });
    if(result.warning)warnings.push(`${entry.name}：${result.warning}`);else if(!result.sheetsScanned)filesWithoutPpidColumn++;
   }catch(error){warnings.push(`${entry.name}：${error.message}`);for(let matchIndex=matches.length-1;matchIndex>=0;matchIndex--)if(matches[matchIndex].fileId===entry.id)matches.splice(matchIndex,1);for(const schemaId of schemas.keys())if(schemaId.startsWith(`${entry.id}\u0000`))schemas.delete(schemaId);}
   filesCompleted++;
  }
  const ppidOrder=new Map(ppids.map((item,index)=>[item.canonical,index]));
  matches.sort((a,b)=>{
   const order=(ppidOrder.get(canonical(a.ppid))??Number.MAX_SAFE_INTEGER)-(ppidOrder.get(canonical(b.ppid))??Number.MAX_SAFE_INTEGER);if(order)return order;
   if(a.time!==null&&b.time!==null&&a.time!==b.time)return a.time-b.time;if(a.time!==null&&b.time===null)return -1;if(a.time===null&&b.time!==null)return 1;return 0;
  });
  lastMatches=matches;lastWarnings=warnings;lastColumns=resultColumns();renderResults();$('ppidDownload').disabled=false;
  if(!all.length)setStatus('Raw Data 原始檔案庫沒有可查找的檔案。');
  else if(warnings.length)setStatus(`查找完成，共掃描 Raw Data ${filesCompleted} 份原始檔案；${filesWithoutPpidColumn} 份沒有可辨識 PPID 欄位，以下檔案無法讀取：${warnings.join('；')}`,true);
  else setStatus(`查找完成，已掃描 Raw Data 原始檔案庫 ${filesCompleted} 份檔案；${filesWithoutPpidColumn} 份沒有可辨識 PPID 欄位。`);
 }catch(error){setStatus(error.message,true);}finally{searchButton.disabled=false;searchButton.textContent=cancelText;}
}
$('ppidSearch').onclick=search;
$('ppidPrev').onclick=()=>{if(resultPage>0){resultPage--;renderResults();}};
$('ppidNext').onclick=()=>{if((resultPage+1)*pageSize<lastMatches.length){resultPage++;renderResults();}};
$('ppidDownload').onclick=async()=>{
 if(!lastPpids.length)return;
 const download=$('ppidDownload');download.disabled=true;
 try{
  const columns=lastColumns,workbook=new ExcelJS.Workbook();let sheetNumber=0,sheet,rowCount=0;
  const addResultSheet=()=>{
   const name=sheetNumber?'PPID 查找結果 '+(sheetNumber+1):'PPID 查找結果';sheet=workbook.addWorksheet(name);sheet.addRow(['查找來源','來源檔案','分頁','列號','查找 PPID',...columns.map(column=>column.name)]);sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.columns.forEach((column,index)=>{column.width=index<5?22:24;column.numFmt='@';});sheet.autoFilter={from:'A1',to:{row:1,column:Math.max(5,5+columns.length)}};sheetNumber++;rowCount=0;
  };
  const maxDataRows=1048575;
  for(let index=0;index<lastMatches.length;index++){
   if(!sheet||rowCount>=maxDataRows){addResultSheet();if(sheetNumber>1)setStatus(`正在建立完整 Excel：${index.toLocaleString()}／${lastMatches.length.toLocaleString()} 筆`);}
   const match=lastMatches[index],file=filesById.get(match.fileId);sheet.addRow([file?.source||'',file?.name||'',match.sheet,match.row,match.ppid,...rowValues(match,columns)]);rowCount++;
   if(index&&index%10000===0)setStatus(`正在建立完整 Excel：${index.toLocaleString()}／${lastMatches.length.toLocaleString()} 筆`);
  }
  const missing=missingPpids();
  if(missing.length){const absent=workbook.addWorksheet('未找到 PPID');absent.addRow(['PPID','查找範圍']);for(const item of missing)absent.addRow([item.label,'Raw Data 原始檔案庫']);absent.getColumn(1).width=36;absent.getColumn(1).numFmt='@';absent.getColumn(2).width=24;absent.getRow(1).font={bold:true};}
  for(const resultSheet of workbook.worksheets)if(resultSheet.name.startsWith('PPID 查找結果'))resultSheet.autoFilter={from:'A1',to:{row:resultSheet.rowCount,column:Math.max(5,5+columns.length)}};
  const bytes=await workbook.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`AUTOREPORT_PPID完整履歷_${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})}.xlsx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setStatus(`完整履歷 Excel 已下載，共 ${lastMatches.length.toLocaleString()} 筆。`);
 }catch(error){setStatus('下載失敗：'+error.message,true);}finally{download.disabled=false;}
};
$('ppidClear').onclick=()=>{$('ppidText').value='';$('ppidExcel').value='';clearResults();setStatus('');};
window.addEventListener('ppid-lookup-files',()=>{clearResults();navigate('ppidLookup');setStatus('查找範圍：Raw Data 原始檔案庫，不限製程或日期。');});
