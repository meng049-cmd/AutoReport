import {libraryReady,listLibraryFiles,libraryCollection} from './file-library.mjs';
import {navigate} from './navigation.mjs';
import ExcelJS from 'exceljs';

const $=id=>document.getElementById(id),worker=new Worker(new URL('../ppid-lookup-worker.js?v='+__BUILD_ID__,import.meta.url));
let nextId=0,scopeIds=null,scopeCollection='detail',lastMatches=[],lastPpids=[],lastWarnings=[],lastTruncated=false;
const pending=new Map();
worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data);};
worker.onerror=()=>{for(const request of pending.values())request.reject(Error('PPID 查找工具載入失敗，請重新整理頁面。'));pending.clear();};
function call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,type,...payload},transfer);});}
function canonical(value){return String(value??'').normalize('NFKC').trim().toLocaleUpperCase('en-US');}
function setStatus(value,error=false){$('ppidStatus').textContent=value;$('ppidStatus').className=error?'warn':'muted';}
function clearResults(){ $('ppidResults').replaceChildren();$('ppidSummary').textContent='';$('ppidDownload').disabled=true;lastMatches=[];lastPpids=[];lastWarnings=[];lastTruncated=false; }
function button(label,action){const element=document.createElement('button');element.type='button';element.className='secondary';element.textContent=label;element.onclick=action;return element;}
function libraryButton(match){return button(match.collection==='analysis'?'查看分析報表':'查看 Detail 比對檔案',()=>window.dispatchEvent(new CustomEvent('library-open-ppid-file',{detail:{id:match.id}})));}
function visibleMatches(){const process=canonical($('ppidProcess').value);return process?lastMatches.filter(item=>canonical(item.process)===process):lastMatches;}
function resultColumns(matches){const columns=[],seen=new Set();for(const match of matches){const counts=new Map();for(const name of match.headers||[]){const occurrence=(counts.get(name)||0)+1;counts.set(name,occurrence);const key=JSON.stringify([name,occurrence]);if(!seen.has(key)){seen.add(key);columns.push({name,key});}}}return columns;}
function rowValues(match,columns){const values=new Map(),counts=new Map();(match.headers||[]).forEach((name,index)=>{const occurrence=(counts.get(name)||0)+1;counts.set(name,occurrence);values.set(JSON.stringify([name,occurrence]),match.rowData?.[index]??'');});return columns.map(column=>values.get(column.key)??'');}
function renderResults(ppids,matches,warnings,truncated){
 const selectedProcess=$('ppidProcess').value;
 const visible=selectedProcess?matches.filter(item=>canonical(item.process)===canonical(selectedProcess)):matches;
 const processes=[...new Set(matches.map(item=>item.process).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
 const processSelect=$('ppidProcess'),previous=processSelect.value;
 processSelect.replaceChildren(new Option('全部製程',''),...processes.map(value=>new Option(value,value)));
 if(processes.some(value=>canonical(value)===canonical(previous)))processSelect.value=processes.find(value=>canonical(value)===canonical(previous));
 const found=new Set(matches.map(match=>canonical(match.ppid))),missing=ppids.filter(item=>!found.has(item.canonical));
 const reportCount=visible.filter(item=>item.collection==='analysis').length,detailCount=visible.length-reportCount;
 $('ppidSummary').textContent=`輸入 ${ppids.length} 個 PPID；符合目前製程 ${visible.length} 筆（分析報表 ${reportCount} 筆、Detail 比對 ${detailCount} 筆）；未找到 ${missing.length} 個。`+(truncated?' 已達 10,000 筆結果上限。':'');
 const table=document.createElement('table'),head=table.createTHead().insertRow();
 const columns=resultColumns(visible);
 for(const label of ['查找來源','檔案','分頁／列號',...columns.map(column=>column.name),'返回檔案庫']){const th=document.createElement('th');th.textContent=label;head.append(th);}
 const body=table.createTBody();
 for(const match of visible){const row=body.insertRow();for(const value of [match.source,match.name,`${match.sheet}／${match.row}`,...rowValues(match,columns)])row.insertCell().textContent=value||'—';row.insertCell().append(libraryButton(match));}
 for(const item of missing){const row=body.insertRow();row.className='warn';row.insertCell().textContent=item.label;const cell=row.insertCell();cell.colSpan=columns.length+3;cell.textContent=`所選${scopeCollection==='detail'?'Detail 比對':'分析報表'}檔案庫沒有此 PPID。`;}
 $('ppidResults').replaceChildren(table);
 $('ppidDownload').disabled=!ppids.length;
 if(warnings.length)setStatus('部分檔案略過：'+warnings.join('；'),true);
 else if(ppids.length)setStatus('查找完成。');
}
async function search(){
 const pasted=$('ppidText').value,sourceFile=$('ppidExcel').files[0];
 if(!pasted.trim()&&!sourceFile){setStatus('請批次貼上 PPID，或選擇 Excel／CSV 清單。',true);return;}
 const button=$('ppidSearch'),cancelText=button.textContent;button.disabled=true;button.textContent='正在查找…';clearResults();$('ppidProcess').value='';
 try{
  await libraryReady;
  setStatus('正在整理 PPID 清單…');
  const inputBuffer=sourceFile?await sourceFile.arrayBuffer():null,parsed=await call('parse',{text:pasted,name:sourceFile?.name,buffer:inputBuffer},inputBuffer?[inputBuffer]:[]),ppids=parsed.ppids;
  if(!ppids.length)throw Error('沒有讀到可查找的 PPID，請確認 Excel 第一欄或欄名 PPID／小板序號。');
  const all=listLibraryFiles(),files=all.filter(item=>libraryCollection(item)===scopeCollection&&(scopeCollection==='analysis'?item.kind==='analysis':item.detail)&&(!scopeIds||scopeIds.has(item.id)));
  const matches=[],warnings=[];let truncated=false;
  const scan=async(files,source)=>{
   for(let index=0;index<files.length;index++){
    if(matches.length>=10000)break;
    const entry=files[index];setStatus(`正在查找${source}：${index+1}/${files.length}（${entry.name}）`);
    if(entry.size>100*1024*1024){warnings.push(`${entry.name} 超過 100 MB`);continue;}
    try{
     const buffer=await entry.blob.arrayBuffer(),result=await call('search',{file:{id:entry.id,name:entry.name,collection:libraryCollection(entry),source},targets:ppids,buffer},[buffer]);
     if(result.warning)warnings.push(`${entry.name}：${result.warning}`);
     for(const match of result.matches)matches.push(match);
     if(result.truncated){truncated=true;break;}
     if(matches.length>=10000){truncated=true;break;}
    }catch(error){warnings.push(`${entry.name}：${error.message}`);}
   }
  };
  if(!files.length)setStatus(`所選${scopeCollection==='detail'?'Detail 比對':'分析報表'}檔案庫沒有可查檔案。`);
  await scan(files,scopeCollection==='analysis'?'良率與不良分析':'Detail 比對');
  lastMatches=matches;lastPpids=ppids;lastWarnings=warnings;lastTruncated=truncated;
  renderResults(ppids,matches,warnings,truncated);
 }catch(error){setStatus(error.message,true);}finally{button.disabled=false;button.textContent=cancelText;}
}
$('ppidSearch').onclick=search;
$('ppidProcess').onchange=()=>renderResults(lastPpids,lastMatches,lastWarnings,lastTruncated);
$('ppidDownload').onclick=async()=>{
 if(!lastPpids.length)return;
 const download=$('ppidDownload');download.disabled=true;
 try{
  const matches=visibleMatches(),columns=resultColumns(matches),workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('PPID 查找結果');
  sheet.addRow(['查找來源','來源檔案','分頁','列號',...columns.map(column=>column.name)]);
  for(const match of matches)sheet.addRow([match.source,match.name,match.sheet,match.row,...rowValues(match,columns)]);
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:{row:1,column:Math.max(4,4+columns.length)}};
  sheet.getRow(1).font={bold:true};sheet.columns.forEach((column,index)=>{column.width=index<4?20:24;column.numFmt='@';});
  const found=new Set(lastMatches.map(item=>canonical(item.ppid))),missing=lastPpids.filter(item=>!found.has(item.canonical));
  if(missing.length){const absent=workbook.addWorksheet('未找到 PPID');absent.addRow(['PPID','查找來源']);for(const item of missing)absent.addRow([item.label,scopeCollection==='detail'?'Detail 比對':'分析報表']);absent.getColumn(1).width=36;absent.getColumn(1).numFmt='@';absent.getColumn(2).width=22;absent.getRow(1).font={bold:true};}
  const bytes=await workbook.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`AUTOREPORT_PPID查找結果_${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})}.xlsx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){setStatus('下載失敗：'+error.message,true);}finally{download.disabled=false;}
};
$('ppidClear').onclick=()=>{$('ppidText').value='';$('ppidExcel').value='';$('ppidProcess').value='';clearResults();setStatus('');};
$('ppidChooseReports').onclick=()=>window.dispatchEvent(new CustomEvent('library-choose-ppid',{detail:{collection:'analysis'}}));
$('ppidChooseDetails').onclick=()=>window.dispatchEvent(new CustomEvent('library-choose-ppid',{detail:{collection:'detail'}}));
window.addEventListener('ppid-lookup-files',({detail})=>{const ids=detail?.ids||[];scopeCollection=detail?.collection==='analysis'?'analysis':'detail';scopeIds=ids.length?new Set(ids):null;clearResults();$('ppidProcess').replaceChildren(new Option('全部製程',''));navigate('ppidLookup');setStatus(scopeIds?`查找範圍：已選取 ${ids.length} 份${scopeCollection==='detail'?'Detail 比對':'分析報表'}檔案。`:`查找範圍：全部${scopeCollection==='detail'?'Detail 比對':'分析報表'}檔案。`);});
