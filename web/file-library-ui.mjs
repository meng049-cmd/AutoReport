import {navigate} from './navigation.mjs';
import JSZip from 'jszip';
import {libraryReady,libraryEvents,libraryCollection,listLibraryFiles,removeLibraryFiles,entryFile,entrySources,libraryIsBusy,beginFileOperation,endFileOperation} from './file-library.mjs';
import {analyzeYieldFiles} from './yield-ui.mjs';
const $=id=>document.getElementById(id),urls=new Map(),states={raw:{selected:new Set(),search:'',kind:'',page:0,purpose:''},detail:{selected:new Set(),search:'',kind:'',page:0,purpose:''},analysis:{selected:new Set(),search:'',kind:'analysis',page:0,purpose:''}};
let active='detail',selected=states.detail.selected;
const kindNames={raw:'比對前原始檔',matched:'比對完成',merged:'Detail 合併',analysis:'良率與不良分析',input:'上傳主檔'};
let page=0;
function visibleFiles(){const query=$('librarySearch').value.trim().normalize('NFKC').toLowerCase(),kind=$('libraryKind').value;return listLibraryFiles().filter(item=>libraryCollection(item)===active&&(!kind||item.kind===kind)&&(!query||item.name.normalize('NFKC').toLowerCase().includes(query)));}
function selection(){const entries=new Map(listLibraryFiles().map(item=>[item.id,item]));return [...selected].map(id=>entries.get(id)).filter(item=>item&&libraryCollection(item)===active);}
function updateActions(){const items=selection(),detail=!libraryIsBusy()&&items.length&&items.every(item=>item.detail);$('libraryMatch').disabled=libraryIsBusy()||!items.length||active!=='raw';$('libraryAnalyze').disabled=!detail||active==='raw';$('libraryPpidLookup').disabled=libraryIsBusy()||active!=='analysis'||!items.length||!items.every(item=>item.kind==='analysis');$('libraryDownload').disabled=libraryIsBusy()||!items.length;$('libraryRemove').disabled=libraryIsBusy()||!items.length;$('librarySelected').textContent='已勾選 '+items.length+' 份';const visible=visibleFiles(),marked=visible.filter(item=>selected.has(item.id)).length,header=$('librarySelectVisible');if(header){header.checked=visible.length>0&&marked===visible.length;header.indeterminate=marked>0&&marked<visible.length;header.disabled=libraryIsBusy()||!visible.length;}$('librarySelectAll').disabled=libraryIsBusy()||!visible.length;$('libraryClearSelection').disabled=libraryIsBusy()||!items.length;const incompatible=active!=='raw'&&items.some(item=>!item.detail);if(incompatible)$('libraryPurpose').textContent='分析請選擇含 Detail 分頁的檔案。';else if($('libraryPurpose').textContent==='分析請選擇含 Detail 分頁的檔案。')$('libraryPurpose').textContent='';}
function render(){
 const all=listLibraryFiles(),known=new Set(all.map(item=>item.id));for(const [id,url] of urls)if(!known.has(id)){URL.revokeObjectURL(url);urls.delete(id);}for(const id of selected)if(!known.has(id))selected.delete(id);
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
function openReports(){navigate('reports');$('libraryKind').value='analysis';$('librarySearch').value='';page=0;render();}
$('viewYieldFiles').onclick=openReports;window.addEventListener('library-reports',openReports);
$('viewRawFiles').onclick=()=>navigate('raw');
$('libraryMatch').onclick=()=>{const items=selection();if(!items.length||libraryIsBusy())return;navigate('matching');window.dispatchEvent(new CustomEvent('library-match',{detail:{files:items.map(entryFile)}}));};
$('viewMatchedFiles').onclick=()=>{navigate('files');$('libraryKind').value='matched';$('librarySearch').value='';page=0;render();$('fileLibrary').scrollIntoView({behavior:'smooth',block:'start'});};
$('libraryAnalyze').onclick=()=>{const items=selection();navigate('yield');analyzeYieldFiles(items.map(entryFile),{sources:entrySources(items),fromLibrary:true,fileIds:items.map(item=>item.id)});};
$('libraryPpidLookup').onclick=()=>{const items=selection().filter(item=>item.kind==='analysis');if(!items.length)return;window.dispatchEvent(new CustomEvent('ppid-lookup-files',{detail:{ids:items.map(item=>item.id)}}));};
$('libraryDownload').onclick=async()=>{const items=selection();if(!items.length)return;const button=$('libraryDownload');button.disabled=true;try{const zip=new JSZip(),used=new Set();for(const item of items){let name=item.name,index=2;const dot=item.name.lastIndexOf('.'),base=dot>0?item.name.slice(0,dot):item.name,extension=dot>0?item.name.slice(dot):'';while(used.has(name.toLowerCase()))name=base+'_'+index+++extension;used.add(name.toLowerCase());zip.file(name,item.blob);}const url=URL.createObjectURL(await zip.generateAsync({type:'blob',compression:'STORE'})),link=document.createElement('a');link.href=url;link.download='AutoReport_檔案清單.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(error){$('libraryPurpose').textContent=error.message;}finally{updateActions();}};
libraryEvents.addEventListener('change',render);libraryReady.then(render);

window.addEventListener('library-choose-ppid',()=>{navigate('reports');$('libraryKind').value='analysis';$('librarySearch').value='';page=0;render();$('libraryPurpose').textContent='勾選分析報表後，點「帶入 PPID 查找」；未命中時會自動回查 Detail 比對檔案庫。';$('fileLibrary').scrollIntoView({behavior:'smooth',block:'start'});});
window.addEventListener('library-open-ppid-file',({detail:{id}})=>{
 const item=listLibraryFiles().find(entry=>entry.id===id);if(!item)return;
 const collection=libraryCollection(item),state=states[collection],route=collection==='raw'?'raw':collection==='analysis'?'reports':'files';
 state.selected.clear();state.selected.add(item.id);Object.assign(state,{search:item.name,kind:item.kind,page:0,purpose:'PPID 查找到此檔案。'});
 navigate(route);
 $('librarySearch').value=state.search;$('libraryKind').value=state.kind;page=0;render();
 requestAnimationFrame(()=>[...document.querySelectorAll('#fileLibraryTable tbody tr')].find(row=>row.dataset.fileId===item.id)?.scrollIntoView({behavior:'smooth',block:'center'}));
});


function configureCollection(){
 const names=active==='raw'?[['','全部原始檔'],['raw','比對前原始檔']]:active==='detail'?[['','全部 Detail 檔案'],['matched','比對完成'],['merged','Detail 合併']]:[['','全部分析檔案'],['input','分析主檔'],['merged','分析合併主檔'],['analysis','良率與不良分析報表']];
 $('libraryKind').replaceChildren(...names.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 $('referenceFiles').hidden=active!=='detail';$('libraryTitle').textContent=active==='raw'?'Raw Data 原始檔案庫':active==='detail'?'Detail 比對檔案庫':'每日良率與不良分析檔案庫';
 $('libraryMatch').hidden=active!=='raw';
 $('libraryAnalyze').hidden=active==='raw';$('libraryPpidLookup').hidden=active!=='analysis';
 for(const link of document.querySelectorAll('.file-tabs a'))link.setAttribute('aria-current',link.getAttribute('href')===(active==='raw'?'#/raw':active==='detail'?'#/files':'#/reports')?'page':'false');
}
window.addEventListener('viewchange',({detail:{page:pageName}})=>{
 if(['raw','files','reports'].includes(pageName)){const next=pageName==='raw'?'raw':pageName==='reports'?'analysis':'detail';if(next!==active){Object.assign(states[active],{search:$('librarySearch').value,kind:$('libraryKind').value,page,purpose:$('libraryPurpose').textContent});active=next;selected=states[active].selected;configureCollection();$('librarySearch').value=states[active].search;$('libraryKind').value=states[active].kind;page=states[active].page;$('libraryPurpose').textContent=states[active].purpose;}else{const kind=$('libraryKind').value;configureCollection();$('libraryKind').value=kind;}}
 render();
});
configureCollection();
