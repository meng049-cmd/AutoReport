import {libraryReady,listLibraryFiles,libraryCollection} from './file-library.mjs';
import {navigate} from './navigation.mjs';

const $=id=>document.getElementById(id),worker=new Worker(new URL('../ppid-lookup-worker.js?v='+__BUILD_ID__,import.meta.url));
let nextId=0,scopeIds=null;
const pending=new Map();
worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data);};
worker.onerror=()=>{for(const request of pending.values())request.reject(Error('PPID 查找工具載入失敗，請重新整理頁面。'));pending.clear();};
function call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,type,...payload},transfer);});}
function canonical(value){return String(value??'').normalize('NFKC').trim().toLocaleUpperCase('en-US');}
function setStatus(value,error=false){$('ppidStatus').textContent=value;$('ppidStatus').className=error?'warn':'muted';}
function clearResults(){ $('ppidResults').replaceChildren();$('ppidSummary').textContent=''; }
function button(label,action){const element=document.createElement('button');element.type='button';element.className='secondary';element.textContent=label;element.onclick=action;return element;}
function libraryButton(match){return button(match.collection==='analysis'?'查看分析報表':'查看 Detail 比對檔案',()=>window.dispatchEvent(new CustomEvent('library-open-ppid-file',{detail:{id:match.id}})));}
function renderResults(ppids,matches,warnings,truncated){
 const found=new Set(matches.map(match=>canonical(match.ppid))),missing=ppids.filter(item=>!found.has(item.canonical));
 const reportCount=matches.filter(item=>item.collection==='analysis').length,detailCount=matches.length-reportCount;
 $('ppidSummary').textContent=`輸入 ${ppids.length} 個 PPID；找到 ${matches.length} 筆（分析報表 ${reportCount} 筆、Detail 比對 ${detailCount} 筆）；未找到 ${missing.length} 個。`+(truncated?' 已達 10,000 筆結果上限。':'');
 const table=document.createElement('table'),head=table.createTHead().insertRow();
 for(const label of ['PPID','查找來源','分析檔案','IC','機種','製程','狀態','不良項目','產出時間','工單','分頁／列號','返回檔案庫']){const th=document.createElement('th');th.textContent=label;head.append(th);}
 const body=table.createTBody();
 for(const match of matches){const row=body.insertRow();for(const value of [match.ppid,match.source,match.name,match.ic,match.model,match.process,match.status,match.defect,match.time,match.order,`${match.sheet}／${match.row}`])row.insertCell().textContent=value||'—';row.insertCell().append(libraryButton(match));}
 for(const item of missing){const row=body.insertRow();row.className='warn';row.insertCell().textContent=item.label;row.insertCell().textContent='未找到';const cell=row.insertCell();cell.colSpan=10;cell.textContent='分析報表及 Detail 比對檔案庫都沒有此 PPID。';}
 $('ppidResults').replaceChildren(table);
 if(warnings.length)setStatus('部分檔案略過：'+warnings.join('；'),true);
 else setStatus('查找完成。');
}
async function search(){
 const pasted=$('ppidText').value,sourceFile=$('ppidExcel').files[0];
 if(!pasted.trim()&&!sourceFile){setStatus('請批次貼上 PPID，或選擇 Excel／CSV 清單。',true);return;}
 const button=$('ppidSearch'),cancelText=button.textContent;button.disabled=true;button.textContent='正在查找…';clearResults();
 try{
  await libraryReady;
  setStatus('正在整理 PPID 清單…');
  const inputBuffer=sourceFile?await sourceFile.arrayBuffer():null,parsed=await call('parse',{text:pasted,name:sourceFile?.name,buffer:inputBuffer},inputBuffer?[inputBuffer]:[]),ppids=parsed.ppids;
  if(!ppids.length)throw Error('沒有讀到可查找的 PPID，請確認 Excel 第一欄或欄名 PPID／小板序號。');
  const all=listLibraryFiles(),analysisFiles=all.filter(item=>libraryCollection(item)==='analysis'&&item.kind==='analysis'&&(!scopeIds||scopeIds.has(item.id))),detailFiles=all.filter(item=>libraryCollection(item)==='detail'&&item.detail);
  const matches=[],warnings=[];let truncated=false;
  const scan=async(files,targets,source)=>{
   const found=new Set();
   for(let index=0;index<files.length;index++){
    const unresolved=targets.filter(item=>!found.has(item.canonical));if(!unresolved.length||matches.length>=10000)break;
    const entry=files[index];setStatus(`正在查找${source}：${index+1}/${files.length}（${entry.name}）`);
    if(entry.size>100*1024*1024){warnings.push(`${entry.name} 超過 100 MB`);continue;}
    try{
     const buffer=await entry.blob.arrayBuffer(),result=await call('search',{file:{id:entry.id,name:entry.name,collection:libraryCollection(entry),source},targets:unresolved,buffer},[buffer]);
     if(result.warning)warnings.push(`${entry.name}：${result.warning}`);
     for(const match of result.matches){matches.push(match);found.add(canonical(match.ppid));}
     if(result.truncated){truncated=true;break;}
     if(matches.length>=10000){truncated=true;break;}
    }catch(error){warnings.push(`${entry.name}：${error.message}`);}
   }
   return found;
  };
  const analysisFound=analysisFiles.length?await scan(analysisFiles,ppids,'良率與不良分析'):new Set();
  const fallback=ppids.filter(item=>!analysisFound.has(item.canonical));
  if(fallback.length&&!truncated){setStatus(analysisFiles.length?'分析報表沒有全部命中，正在回查 Detail 比對檔案庫…':'沒有可查的分析報表，正在查詢 Detail 比對檔案庫…');await scan(detailFiles,fallback,'Detail 比對');}
  renderResults(ppids,matches,warnings,truncated);
 }catch(error){setStatus(error.message,true);}finally{button.disabled=false;button.textContent=cancelText;}
}
$('ppidSearch').onclick=search;
$('ppidClear').onclick=()=>{$('ppidText').value='';$('ppidExcel').value='';clearResults();setStatus('');};
$('ppidChooseReports').onclick=()=>window.dispatchEvent(new CustomEvent('library-choose-ppid'));
$('ppidAllReports').onclick=()=>{scopeIds=null;setStatus('查找範圍：全部良率與不良分析檔案庫。');};
$('ppidOpenReports').onclick=()=>navigate('reports');
$('ppidOpenDetails').onclick=()=>navigate('files');
window.addEventListener('ppid-lookup-files',({detail})=>{const ids=detail?.ids||[];scopeIds=ids.length?new Set(ids):null;navigate('ppidLookup');setStatus(scopeIds?`查找範圍：已選取 ${ids.length} 份分析報表；未命中時仍會回查 Detail 比對檔案庫。`:'查找範圍：全部良率與不良分析檔案庫。');});
