import {navigate} from './navigation.mjs';
import JSZip from 'jszip';
import {libraryReady,libraryEvents,libraryCollection,listLibraryFiles,addLibraryFile,replaceLibraryFile,removeLibraryFiles,entryFile,entrySources,libraryIsBusy,beginFileOperation,endFileOperation} from './file-library.mjs';
import {analyzeYieldFiles,getYieldOptions} from './yield-ui.mjs';
import {indexDetailFiles,existingIndex,indexKey,periods} from './detail-index.mjs';
const $=id=>document.getElementById(id),urls=new Map(),states={raw:{selected:new Set(),search:'',kind:'',page:0,purpose:''},detail:{selected:new Set(),search:'',kind:'',page:0,purpose:''},mergedDetail:{selected:new Set(),search:'',kind:'',page:0,purpose:''},analysis:{selected:new Set(),search:'',kind:'analysis',page:0,purpose:''}};
let active='detail',selected=states.detail.selected;
const kindNames={raw:'比對前原始檔',matched:'比對完成',merged:'舊版合併 Detail',analysis:'良率與不良分析',input:'上傳主檔'};
let page=0,periodScope=null,indexController,compactWorker,compactSequence=0,compactPreview=null;let refreshingLibraryMetadata=false;const periodMetas=new Map(),periodOptions=new Map(),compactPending=new Map();
function visibleFiles(){const query=$('librarySearch').value.trim().normalize('NFKC').toLowerCase(),kind=$('libraryKind').value;return listLibraryFiles().filter(item=>libraryCollection(item)===active&&(!periodScope||periods.rowsIn(periodMetas.get(item.id)||{},periodScope)>0)&&(!kind||item.kind===kind)&&(!query||item.name.normalize('NFKC').toLowerCase().includes(query)));}
function selection(){const entries=new Map(listLibraryFiles().map(item=>[item.id,item]));return [...selected].map(id=>entries.get(id)).filter(item=>item&&libraryCollection(item)===active);}
function detailLibraryItems(){return listLibraryFiles().filter(item=>libraryCollection(item)==='detail'&&item.detail);}
function compactFingerprint(items=detailLibraryItems()){return JSON.stringify(items.map(item=>[item.id,item.blob?.size??item.size,item.lastModified||0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
function updateCompactActions(){const items=detailLibraryItems(),current=compactPreview?.fingerprint===compactFingerprint(items);$('libraryCompactControls').hidden=active!=='detail';$('libraryCompactHint').hidden=active!=='detail';$('libraryCompactPreview').disabled=libraryIsBusy()||!items.length;$('libraryCompactApply').disabled=libraryIsBusy()||!current||!compactPreview?.removedRows||compactPreview.failures.length>0;}
function updateActions(){updatePeriodStatus();const items=selection(),detail=!libraryIsBusy()&&items.length&&items.every(item=>item.detail),mergeScope=['detail','mergedDetail'].includes(active);$('libraryMatch').disabled=libraryIsBusy()||!items.length||active!=='raw';$('libraryAnalyze').disabled=!detail||active==='raw'||Boolean(periodScope&&periodEntries().some(item=>!periodMetas.has(item.id))); $('libraryMerge').hidden=true;$('libraryMerge').textContent=active==='mergedDetail'?'再次合併所選 Detail':'合併所選 Detail';$('libraryMerge').disabled=libraryIsBusy()||!detail||!mergeScope;$('libraryPpidLookup').disabled=libraryIsBusy()||!listLibraryFiles().some(item=>libraryCollection(item)==='raw');$('libraryDownload').disabled=libraryIsBusy()||!items.length;$('libraryRemove').disabled=libraryIsBusy()||!items.length;$('librarySelected').textContent='已勾選 '+items.length+' 份';const visible=visibleFiles(),marked=visible.filter(item=>selected.has(item.id)).length,header=$('librarySelectVisible');if(header){header.checked=visible.length>0&&marked===visible.length;header.indeterminate=marked>0&&marked<visible.length;header.disabled=libraryIsBusy()||!visible.length;}$('librarySelectAll').disabled=libraryIsBusy()||!visible.length;$('libraryClearSelection').disabled=libraryIsBusy()||!items.length;const incompatible=active!=='raw'&&items.some(item=>!item.detail);if(incompatible)$('libraryPurpose').textContent='分析請選擇含 Detail 分頁的檔案。';else if($('libraryPurpose').textContent==='分析請選擇含 Detail 分頁的檔案。')$('libraryPurpose').textContent='';updateCompactActions();}
function render(){
 const all=listLibraryFiles();for(const item of all)if(periodMetas.has(item.id)&&periodMetas.get(item.id).key!==indexKey(entryFile(item),item.id))periodMetas.delete(item.id);const known=new Set(all.map(item=>item.id));for(const [id,url] of urls)if(!known.has(id)){URL.revokeObjectURL(url);urls.delete(id);}for(const id of selected)if(!known.has(id))selected.delete(id);
 const items=visibleFiles(),pages=Math.max(1,Math.ceil(items.length/20));page=Math.min(page,pages-1);$('libraryCount').textContent=all.filter(item=>libraryCollection(item)===active).length+' 份檔案';$('libraryPrev').disabled=page===0;$('libraryNext').disabled=page===pages-1;$('libraryPage').textContent=(page+1)+' / '+pages;
 const table=document.createElement('table'),head=table.createTHead().insertRow();for(const label of ['勾選','檔名','類型','大小','時間','操作']){const th=document.createElement('th');if(label==='勾選'){const check=document.createElement('input');check.id='librarySelectVisible';check.type='checkbox';check.setAttribute('aria-label','勾選目前篩選的全部檔案');check.onchange=()=>{selectFiltered(check.checked);for(const input of document.querySelectorAll('#fileLibraryTable tbody input[type=checkbox]'))input.checked=selected.has(input.closest('tr').dataset.fileId);updateActions();};th.append(check);}else th.textContent=label;head.append(th);}const body=table.createTBody();
 for(const item of items.slice(page*20,page*20+20)){const row=body.insertRow();row.dataset.fileId=item.id;row.dataset.kind=item.kind;row.dataset.collection=libraryCollection(item);const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(item.id);input.disabled=libraryIsBusy();input.setAttribute('aria-label','選擇 '+item.name);input.onchange=()=>{input.checked?selected.add(item.id):selected.delete(item.id);updateActions();};row.insertCell().append(input);row.insertCell().textContent=item.name;row.insertCell().textContent=(item.kind==='matched'?(item.detail?'Detail 比對':'查詢比對'):kindNames[item.kind])+(item.persistent?'':'（本次暫存）');row.insertCell().textContent=(item.size/1024).toFixed(1)+' KB';row.insertCell().textContent=new Date(item.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});const link=document.createElement('a');if(!urls.has(item.id))urls.set(item.id,URL.createObjectURL(item.blob));link.href=urls.get(item.id);link.download=item.name;link.textContent='下載';const actions=document.createElement('div');actions.className='library-row-actions';const remove=document.createElement('button');remove.type='button';remove.className='secondary library-delete';remove.textContent='刪除';remove.disabled=libraryIsBusy();remove.setAttribute('aria-label','刪除 '+item.name);remove.onclick=()=>deleteFiles([item.id]);if(item.kind==='analysis'){const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='開啟看板';open.disabled=libraryIsBusy();open.onclick=()=>{analyzeYieldFiles([entryFile(item)],{sources:entrySources([item]),fromLibrary:true,saveReport:false,reportId:item.id,onProgress:text=>$('libraryPurpose').textContent=text});};actions.append(open);}actions.append(link,remove);row.insertCell().append(actions);}
 $('fileLibraryTable').replaceChildren(table);updateActions();
}
function chooseYieldFiles(){navigate('files');$('libraryKind').value='';$('librarySearch').value='';page=0;render();$('libraryPurpose').textContent='勾選含 Detail 分頁的檔案，再點「分析所選檔案」；分析完成後，報表會存入良率與不良分析檔案庫。';$('fileLibrary').scrollIntoView({behavior:'smooth',block:'start'});$('librarySearch').focus({preventScroll:true});}
$('chooseYieldFiles').onclick=chooseYieldFiles;
$('librarySearch').oninput=()=>{page=0;render();};$('libraryKind').onchange=()=>{page=0;render();};$('libraryPrev').onclick=()=>{page--;render();};$('libraryNext').onclick=()=>{page++;render();};
function selectFiltered(checked){for(const item of visibleFiles())checked?selected.add(item.id):selected.delete(item.id);}
async function deleteFiles(ids){if(!ids.length||!beginFileOperation())return;try{await removeLibraryFiles(ids);$('libraryPurpose').textContent='已刪除 '+ids.length+' 份檔案。';}catch(error){$('libraryPurpose').textContent=error.message;}finally{endFileOperation();}}
$('librarySelectAll').onclick=()=>{selectFiltered(true);render();};
$('libraryClearSelection').onclick=()=>{selected.clear();render();};
$('libraryRemove').onclick=()=>deleteFiles(selection().map(item=>item.id));
function requestDetailCompaction(file,mode){
 if(!compactWorker){compactWorker=new Worker(new URL('../detail-compaction-worker.js?v='+__BUILD_ID__,import.meta.url));compactWorker.onmessage=({data})=>{const pending=compactPending.get(data.id);if(!pending)return;if(data.type==='progress'){pending.onProgress?.(data.message);return;}compactPending.delete(data.id);data.type==='error'?pending.reject(Error(data.message)):pending.resolve(data);};compactWorker.onerror=()=>{for(const pending of compactPending.values())pending.reject(Error('Detail 精簡工作程式中斷；尚未寫入的檔案保持不變。'));compactPending.clear();compactWorker.terminate();compactWorker=null;};}
 const id=++compactSequence;return new Promise((resolve,reject)=>{compactPending.set(id,{resolve,reject});compactWorker.postMessage({id,file,mode});});
}
function readableBytes(value){const units=['B','KB','MB','GB'];let size=Math.max(0,Number(value)||0),unit=0;while(size>=1024&&unit<units.length-1){size/=1024;unit++;}return `${size.toFixed(unit?1:0)} ${units[unit]}`;}
async function previewDetailCompaction(){
 const items=detailLibraryItems();if(!items.length){$('libraryCompactStatus').textContent='Detail 檔案庫目前沒有可精簡的檔案。';return;}if(!beginFileOperation())return;
 const fingerprint=compactFingerprint(items),results=[],failures=[];
 try{
  for(let i=0;i<items.length;i++){
   const item=items[i];$('libraryCompactStatus').textContent=`正在掃描 ${i+1}/${items.length}：${item.name}`;
   if(!item.persistent){failures.push(`${item.name}：未儲存在本機資料庫。`);continue;}
   try{results.push({...await requestDetailCompaction(entryFile(item),'preview'),id:item.id});}catch(error){failures.push(`${item.name}：${error.message}`);}
  }
 }finally{endFileOperation();}
 if(compactFingerprint()!==fingerprint){compactPreview=null;$('libraryCompactStatus').textContent='掃描期間檔案庫有變動，請重新掃描。';updateActions();return;}
 const removedRows=results.reduce((sum,item)=>sum+item.removedRows,0),keptRows=results.reduce((sum,item)=>sum+item.keptRows,0),beforeSize=results.reduce((sum,item)=>sum+item.beforeSize,0),afterSize=results.reduce((sum,item)=>sum+item.afterSize,0);
 compactPreview={fingerprint,results,failures,removedRows,keptRows,beforeSize,afterSize};
 if(failures.length){$('libraryCompactStatus').textContent=`已掃描 ${items.length} 份，保留 ${keptRows.toLocaleString()} 筆六製程、預計移除 ${removedRows.toLocaleString()} 筆其他製程；${failures.length} 份無法安全處理，確認按鈕已停用。${failures.slice(0,4).join('；')}`;}
 else if(!removedRows){$('libraryCompactStatus').textContent=`已掃描 ${items.length} 份：所有資料均屬六製程，無需精簡。`;}
 else{$('libraryCompactStatus').textContent=`預覽 ${items.length} 份：保留 ${keptRows.toLocaleString()} 筆六製程、移除 ${removedRows.toLocaleString()} 筆其他製程；檔案庫容量約 ${readableBytes(beforeSize)} → ${readableBytes(afterSize)}。這只縮小本機檔案，不會提高 60 萬筆分析上限（索引已只取六製程）。`;
 }
 updateActions();
}
async function compactDetailLibrary(){
 const preview=compactPreview,items=detailLibraryItems();if(!preview||preview.failures.length||preview.fingerprint!==compactFingerprint(items)){compactPreview=null;$('libraryCompactStatus').textContent='檔案庫已變動或預覽無法使用，請重新掃描。';updateActions();return;}
 const targets=preview.results.filter(item=>item.removedRows>0);if(!targets.length)return;
 const estimate=preview.beforeSize-preview.afterSize,estimateText=estimate>=0?`預估釋放 ${readableBytes(estimate)}`:`預估檔案大小增加 ${readableBytes(-estimate)}`;
 const confirmed=confirm(`將在此瀏覽器的本機 Detail 資料庫中，覆寫 ${targets.length} 份檔案並永久移除 ${preview.removedRows.toLocaleString()} 筆非六製程資料，保留 ${preview.keptRows.toLocaleString()} 筆六製程資料。${estimateText}。其他工作表與 Raw Data 原始檔不變；不會上傳雲端。此操作無法從 Detail 檔案庫復原，建議先下載備份。確定執行？`);
 if(!confirmed)return;if(!beginFileOperation())return;compactPreview=null;
 let changedFiles=0,removedRows=0,keptRows=0,savedBytes=0,indexesPreserved=0;const failures=[];
 try{
  for(let i=0;i<targets.length;i++){
   const expected=targets[i],item=listLibraryFiles().find(file=>file.id===expected.id);if(!item){failures.push(`${expected.name}：檔案已不存在。`);continue;}
   $('libraryCompactStatus').textContent=`正在精簡 ${i+1}/${targets.length}：${item.name}`;
   try{
    const output=await requestDetailCompaction(entryFile(item),'compact');
    if(output.removedRows!==expected.removedRows||output.keptRows!==expected.keptRows||!output.bytes)throw Error('掃描結果與預覽不一致；此檔案未更新。');
    const blob=new Blob([output.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),updated=await replaceLibraryFile(item.id,blob);
    changedFiles++;removedRows+=output.removedRows;keptRows+=output.keptRows;savedBytes+=output.beforeSize-output.afterSize;if(updated.indexPreserved)indexesPreserved++;
   }catch(error){failures.push(`${item.name}：${error.message}`);}
  }
 }finally{endFileOperation();}
 const result=`本機精簡完成：更新 ${changedFiles} 份 Detail，移除 ${removedRows.toLocaleString()} 筆非六製程資料，保留 ${keptRows.toLocaleString()} 筆六製程資料；${savedBytes>=0?'減少':'增加'} ${readableBytes(Math.abs(savedBytes))}。${indexesPreserved} 份日期索引直接沿用。`;
 $('libraryCompactStatus').textContent=result+(failures.length?` ${failures.length} 份未更新：${failures.slice(0,4).join('；')}`:'')+' 不會提高 60 萬筆分析上限，因為分析索引本來就只計六製程。';updateActions();
}
$('libraryCompactPreview').onclick=previewDetailCompaction;$('libraryCompactApply').onclick=compactDetailLibrary;
function openReports(){navigate('reports');$('libraryKind').value='analysis';$('librarySearch').value='';page=0;render();}
$('viewYieldFiles').onclick=openReports;window.addEventListener('library-reports',openReports);
$('viewRawFiles').onclick=()=>navigate('raw');
$('libraryMatch').onclick=()=>{const items=selection();if(!items.length||libraryIsBusy())return;navigate('matching');window.dispatchEvent(new CustomEvent('library-match',{detail:{files:items.map(entryFile),ids:items.map(item=>item.id)}}));};
$('viewMatchedFiles').onclick=()=>{navigate('files');$('libraryKind').value='matched';$('librarySearch').value='';page=0;render();$('fileLibrary').scrollIntoView({behavior:'smooth',block:'start'});};
$('libraryAnalyze').onclick=()=>{const items=selection();if(periodScope&&periodEntries().some(item=>periodMetas.get(item.id)?.invalidRows)&&!getYieldOptions().skipInvalidRows){$('libraryPurpose').textContent='日期索引發現錯誤列，部分資料無法歸入日／週／月。請修正來源並重新匯入；如要略過，請先在每日良率分析啟用「略過錯誤列」後再分析。';return;}navigate('yield');analyzeYieldFiles(items.map(entryFile),{sources:entrySources(items),fromLibrary:true,fileIds:items.map(item=>item.id),period:periodScope});};
$('libraryPpidLookup').onclick=()=>window.dispatchEvent(new CustomEvent('ppid-lookup-files'));
$('libraryDownload').onclick=async()=>{const items=selection();if(!items.length)return;const button=$('libraryDownload');button.disabled=true;try{const zip=new JSZip(),used=new Set();for(const item of items){let name=item.name,index=2;const dot=item.name.lastIndexOf('.'),base=dot>0?item.name.slice(0,dot):item.name,extension=dot>0?item.name.slice(dot):'';while(used.has(name.toLowerCase()))name=base+'_'+index+++extension;used.add(name.toLowerCase());zip.file(name,item.blob);}const url=URL.createObjectURL(await zip.generateAsync({type:'blob',compression:'STORE'})),link=document.createElement('a');link.href=url;link.download='AutoReport_檔案清單.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(error){$('libraryPurpose').textContent=error.message;}finally{updateActions();}};
libraryEvents.addEventListener('change',event=>{if(event.detail?.type==='files')compactPreview=null;render();void refreshPeriodMetadata();});libraryReady.then(render);

window.addEventListener('library-open-ppid-file',({detail:{id}})=>{
 const item=listLibraryFiles().find(entry=>entry.id===id);if(!item)return;
 const collection=libraryCollection(item),state=states[collection],route=collection==='raw'?'raw':collection==='analysis'?'reports':collection==='mergedDetail'?'mergedDetail':'files';
 state.selected.clear();state.selected.add(item.id);Object.assign(state,{search:item.name,kind:item.kind,page:0,purpose:'PPID 查找到此檔案。'});
 navigate(route);
 $('librarySearch').value=state.search;$('libraryKind').value=state.kind;page=0;render();
 requestAnimationFrame(()=>[...document.querySelectorAll('#fileLibraryTable tbody tr')].find(row=>row.dataset.fileId===item.id)?.scrollIntoView({behavior:'smooth',block:'center'}));
});


function configureCollection(){
 const names=active==='raw'?[['','全部原始檔'],['raw','比對前原始檔']]:active==='detail'?[['','全部 Detail 檔案'],['matched','比對完成'],['merged','舊版合併檔']]:active==='mergedDetail'?[['','全部合併 Detail'],['merged','合併結果']]:[['','全部分析檔案'],['input','分析主檔'],['merged','分析合併主檔'],['analysis','良率與不良分析報表']];
 $('libraryKind').replaceChildren(...names.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 $('referenceFiles').hidden=active!=='detail';$('libraryTitle').textContent=active==='raw'?'Raw Data 原始檔案庫':active==='detail'?'Detail 比對檔案庫':active==='mergedDetail'?'舊版合併檔（歷史資料）':'每日良率與不良分析檔案庫';
 $('libraryPeriodControls').hidden=!['detail','mergedDetail'].includes(active);
 $('libraryMergeHint').hidden=active!=='mergedDetail';
 $('libraryMatch').hidden=active!=='raw';
 $('libraryAnalyze').hidden=active==='raw';$('libraryPpidLookup').hidden=false;$('libraryPpidLookup').textContent='查找 Raw Data PPID 履歷';
 for(const link of document.querySelectorAll('.file-tabs a'))link.setAttribute('aria-current',link.getAttribute('href')===(active==='raw'?'#/raw':active==='detail'?'#/files':active==='mergedDetail'?'#/mergedDetail':'#/reports')?'page':'false');
}
window.addEventListener('viewchange',({detail:{page:pageName}})=>{
 if(['raw','files','mergedDetail','reports'].includes(pageName)){const next=pageName==='raw'?'raw':pageName==='reports'?'analysis':pageName==='mergedDetail'?'mergedDetail':'detail';if(next!==active){Object.assign(states[active],{search:$('librarySearch').value,kind:$('libraryKind').value,page,purpose:$('libraryPurpose').textContent});active=next;periodScope=null;$('libraryPeriodMode').value='all';$('libraryRangeStartLabel').hidden=$('libraryRangeEndLabel').hidden=true;selected=states[active].selected;selected.clear();configureCollection();$('librarySearch').value=states[active].search;$('libraryKind').value=states[active].kind;page=states[active].page;$('libraryPurpose').textContent=states[active].purpose;}else{const kind=$('libraryKind').value;configureCollection();$('libraryKind').value=kind;}}
 render();
});
configureCollection();

function periodEntries(){return listLibraryFiles().filter(item=>libraryCollection(item)===active&&item.detail);}
function updatePeriodStatus(){
 const entries=periodEntries(),indexed=entries.filter(item=>periodMetas.has(item.id)),count=periodScope?indexed.reduce((sum,item)=>sum+periods.rowsIn(periodMetas.get(item.id),periodScope),0):0;
 $('libraryPeriodStatus').textContent=indexed.length<entries.length?`日期索引已完成 ${indexed.length}/${entries.length} 份；請先完成全部索引，日／週／月選單才會涵蓋完整檔案庫。`:periodScope?`${periodScope.start_date} ～ ${periodScope.end_date}；${visibleFiles().length} 份檔案、${count.toLocaleString()} 筆期間索引資料（分析時統一去重）。`:`日期索引已完成 ${indexed.length}/${entries.length} 份；先建立索引，再選擇按週或按月。`;
 const invalid=indexed.reduce((sum,item)=>sum+(periodMetas.get(item.id).invalidRows||0),0);if(invalid)$('libraryPeriodStatus').textContent+=` 發現 ${invalid.toLocaleString()} 筆錯誤列，請修正來源或明確啟用略過錯誤列。`;
 for(const id of ['libraryIndexDates','libraryPeriodMode','libraryPeriod','libraryPeriodEnd'])$(id).disabled=libraryIsBusy();
}
async function refreshPeriodMetadata(){
 if(refreshingLibraryMetadata||libraryIsBusy())return;refreshingLibraryMetadata=true;
 for(const item of listLibraryFiles().filter(item=>item.detail&&['detail','mergedDetail'].includes(libraryCollection(item)))){
  if(periodMetas.get(item.id)?.key===indexKey(entryFile(item),item.id))continue;const meta=await existingIndex(entryFile(item),item.id).catch(()=>null);if(meta)periodMetas.set(item.id,meta);
 }
 refreshingLibraryMetadata=false;render();
}
function applyPeriod(changed){
 let first=periodOptions.get($('libraryPeriod').value),last=periodOptions.get($('libraryPeriodEnd').value);
 if(first&&last&&first.start_date>last.start_date){if(changed==='end'){$('libraryPeriod').value=last.key;first=last;}else{$('libraryPeriodEnd').value=first.key;last=first;}}
 periodScope=first&&last?periods.rangeFor(first,last):null;selected.clear();$('librarySearch').value='';$('libraryKind').value='';page=0;
 if(periodScope)for(const item of visibleFiles().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})))selected.add(item.id);
 render();
}
function populatePeriods(){
 const mode=$('libraryPeriodMode').value;periodOptions.clear();$('libraryRangeStartLabel').hidden=$('libraryRangeEndLabel').hidden=mode==='all';
 if(mode==='all'){periodScope=null;selected.clear();render();return;}
 const entries=periodEntries(),metas=entries.map(item=>periodMetas.get(item.id)).filter(Boolean),options=metas.length===entries.length?periods.periodsFor(metas,mode):[];
 for(const period of options)periodOptions.set(period.key,period);
 for(const id of ['libraryPeriod','libraryPeriodEnd']){$(id).replaceChildren(...options.map(period=>{const option=document.createElement('option');option.value=period.key;option.textContent=`${period.key}（${period.start_date} ～ ${period.end_date}）`;return option;}));if(!options.length){const option=document.createElement('option');option.textContent='請先建立日期索引';option.value='';$(id).append(option);}}
 applyPeriod();
}
$('libraryPeriodMode').onchange=populatePeriods;$('libraryPeriod').onchange=()=>applyPeriod('start');$('libraryPeriodEnd').onchange=()=>applyPeriod('end');
$('libraryCancelIndex').onclick=()=>indexController?.abort();
$('libraryIndexDates').onclick=async()=>{
 const items=periodEntries();if(!items.length||!beginFileOperation())return;indexController=new AbortController();$('libraryCancelIndex').hidden=false;
 try{
  const metas=await indexDetailFiles(items.map(entryFile),{ids:items.map(item=>item.id),signal:indexController.signal,onProgress:message=>$('libraryPurpose').textContent=message});
  items.forEach((item,i)=>periodMetas.set(item.id,metas[i]));$('libraryPurpose').textContent='日期索引已完成。請選擇按週／按月，系統會自動勾選全部相關檔案；分析只讀取選定期間資料。';populatePeriods();
 }catch(error){$('libraryPurpose').textContent=error.message;await refreshPeriodMetadata();}
 finally{indexController=null;$('libraryCancelIndex').hidden=true;endFileOperation();}
};
libraryReady.then(refreshPeriodMetadata);
