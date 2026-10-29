import './navigation.mjs';
import './file-library-ui.mjs';
import './ppid-lookup-ui.mjs';
import {addLibraryFile,clearFileLibrary,beginFileOperation,endFileOperation,libraryIsBusy} from './file-library.mjs';
import {MAX_BYTES} from './limits.mjs';
import JSZip from 'jszip';
import {setReferenceSources} from './report-context.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const worker=new Worker(new URL('./worker.js?v='+__BUILD_ID__,import.meta.url),{type:'module'});
let nextId=0,downloads=[],downloadUrl=null,batchFiles=[],batchEntries=new Map(),batchCorrections=new Map(),correctionGroups=new Map(),correctionDrafts=new Map(),correctionPage=0;const pending=new Map();
worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data.result);};
worker.onerror=()=>{for(const r of pending.values())r.reject(Error('比對工具載入失敗，請重新整理頁面。'));pending.clear();};
function call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,type,payload},transfer);});}
function table(head,rows){return '<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function sources(items){return '<details><summary>'+items.length+' 筆來源</summary>'+items.map(s=>esc(s['檔案'])+' · '+esc(s['分頁'])+' 第 '+esc(s['列號'])+' 列'+(s['原始IC／機型']?' · 原始 IC／機型：'+esc(s['原始IC／機型']):'')+(s['整理依據']?.length?'<br>'+s['整理依據'].filter(n=>typeof n==='string').map(esc).join('；'):'')).join('<br>')+'</details>'}
function candidates(items){return items.map(c=>'<b>'+esc(c['機種']||'機種未填')+'</b> / '+esc(c.IC||'未標示')+(c['產品系列'].length?' <span class="badge">'+esc(c['產品系列'].join('、'))+'</span>':'')+sources(c['來源'])).join('<br>')||'—'}
function clearDownload(){if(downloadUrl)URL.revokeObjectURL(downloadUrl);for(const d of downloads)URL.revokeObjectURL(d.url);downloadUrl=null;downloads=[];$('export').disabled=true;}
function saveDownload(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function error(e){$('message').textContent=e.message;$('message').className='warn'}
function resetMatchCorrections(files=[]){batchFiles=[...files];batchEntries.clear();batchCorrections.clear();correctionGroups.clear();correctionDrafts.clear();correctionPage=0;$('matchCorrections').hidden=true;$('matchCorrectionTable').replaceChildren();}
function collectMatchCorrections(items,filename){
 for(const item of items||[]){
  if(!correctionGroups.has(item.key))correctionGroups.set(item.key,{...item,rows:0,pending:0,statuses:new Set(),files:new Set()});
  const group=correctionGroups.get(item.key);group.rows+=item.rows;group.pending+=item.pending;item.statuses.forEach(status=>group.statuses.add(status));group.files.add(filename);
 }
}
function renderMatchCorrections(){
 const groups=[...correctionGroups.values()];$('matchCorrections').hidden=!groups.length;
 if(!groups.length)return;
 const pending=groups.reduce((sum,group)=>sum+group.pending,0),filled=groups.reduce((sum,group)=>sum+group.rows-group.pending,0);
 $('matchCorrectionSummary').textContent=`共 ${groups.length} 組工單／料號，${pending} 筆待補填、${filled} 筆已手動補填。請完整填寫需要補填列的 IC 與機種。`;
 correctionPage=Math.min(correctionPage,Math.ceil(groups.length/50)-1);const offset=correctionPage*50;
 $('matchCorrectionPage').textContent=`第 ${correctionPage+1}／${Math.ceil(groups.length/50)} 頁 · 共 ${groups.length} 組`;$('matchCorrectionPrev').disabled=correctionPage===0;$('matchCorrectionNext').disabled=offset+50>=groups.length;
 $('matchCorrectionTable').innerHTML=table(['工單號碼','料號／查找值','來源檔案','筆數','比對狀態','IC','機種'],groups.slice(offset,offset+50).map((group,position)=>{
  const index=offset+position,value=correctionDrafts.get(group.key)||batchCorrections.get(group.key)||{};
  return [esc(group.order||'未提供工單'),esc(group.part||(!group.order?group.query:'')||'—'),[...group.files].map(esc).join('<br>'),String(group.rows),[...group.statuses].map(esc).join('<br>'),`<input type="text" data-correction-ic="${index}" aria-label="第 ${index+1} 組 IC" value="${esc(value.ic||'')}" placeholder="例如 GOODIX">`,`<input type="text" data-correction-model="${index}" aria-label="第 ${index+1} 組機種" value="${esc(value.model||'')}" placeholder="例如 CY26-16">`];
 }));
}

async function query(fulltext=false){
 $('message').textContent='';const q=$('query').value.trim();if(!q)return;$('searchResults').replaceChildren();
 try{if(fulltext){const rows=await call('search',{query:q});$('searchResults').innerHTML='<p>文字搜尋顯示最多 100 列，不會自動補值。</p>'+table(['機種','IC','產品系列','料號','來源'],rows.map(r=>[esc(r.model),esc(r.ic),esc(r.family),esc(r.parts.join('、')),esc(r.sheet)+' · 第 '+r.row_number+' 列']));}
 else{const r=await call('query',{query:q,kind:$('kind').value});$('searchResults').innerHTML='<p class="'+(r['狀態']==='唯一匹配'?'ok':'warn')+'">'+esc(r['狀態'])+'</p>'+candidates(r['候選']);}}catch(e){error(e)}
}
$('queryForm').onsubmit=e=>{e.preventDefault();query()};$('fulltext').onclick=()=>query(true);
async function archiveRawFiles(files){
 for(const file of files)if(file.size<=MAX_BYTES)await addLibraryFile(file,{kind:'raw',collection:'raw',detail:false,sources:[{name:file.name,size:file.size,kind:'比對前原始檔'}]});
}
async function matchFiles(files,{archive=true,regenerate=false}={}){
 if(!files.length){error(Error('請先選擇檔案。'));return;}
 if(!beginFileOperation())return;if(!regenerate)resetMatchCorrections(files);correctionGroups.clear();$('matchCorrectionFields').disabled=true;$('match').disabled=true;$('file').disabled=true;clearDownload();$('uploadResults').innerHTML='';$('message').className='';
 const used=new Set();let failed=0,total=0;const reports=[];
 try{
 if(archive)await archiveRawFiles(files);
 for(let index=0;index<files.length;index++){
  const file=files[index];$('message').textContent=`正在處理 ${index+1}/${files.length}：${file.name}`;
  try{
   if(file.size>MAX_BYTES)throw Error('檔案超過 100 MB。');
   const bytes=await file.arrayBuffer();const r=await call('match',{bytes,filename:file.name,corrections:[...batchCorrections.values()]},[bytes]);
   collectMatchCorrections(r.corrections,file.name);
   const summary='完成 '+r['筆數']+' 筆：'+Object.entries(r.counts).map(([k,v])=>k+' '+v+' 筆').join('、');
   total+=r['筆數'];
   if(r['筆數']){
    $('message').textContent=`正在準備下載 ${index+1}/${files.length}：${file.name}`;
    const output=await call('export');const base='AUTOREPORT 工單查找與品質分析_'+file.name.replace(/\.(xlsx|csv)$/i,'')+'_IC機種';let name=base+'.xlsx',suffix=2;
    while(used.has(name.toLowerCase()))name=base+'_'+suffix+++'.xlsx';used.add(name.toLowerCase());
    const blob=new File([output],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const item={name,blob,url:URL.createObjectURL(blob),detail:r.detail};downloads.push(item);
    const entry=await addLibraryFile(blob,{kind:'matched',detail:r.detail,rows:r['筆數'],replaceId:regenerate?batchEntries.get(index):undefined,sources:[{name:file.name,size:file.size,kind:r.detail?'Detail':'查詢檔'}]});batchEntries.set(index,entry.id);
   }
   if(files.length===1)$('message').textContent=summary+(r['筆數']?'；已加入檔案庫，可勾選、取消勾選或刪除。':'');
  }catch(e){failed++;reports.push(file.name+'：'+e.message);if(files.length===1)error(e);}
  if(reports.length){$('message').textContent=reports.join('；');$('message').className='warn';}
 }
 if(downloads.length>1){
  $('message').textContent='正在打包全部下載檔…';const zip=new JSZip();for(const d of downloads)zip.file(d.name,await d.blob.arrayBuffer());
  downloadUrl=URL.createObjectURL(await zip.generateAsync({type:'blob',compression:'STORE'}));
 }
 $('export').disabled=!downloads.length;$('export').textContent=downloads.length>1?'下載全部結果（ZIP）':'匯出 Excel';
 if(files.length>1)$('message').textContent=`批次完成 ${files.length} 個檔案，共 ${total} 筆；可下載 ${downloads.length} 份結果，失敗 ${failed} 個檔案；已加入檔案庫 ${downloads.length} 份。`+(reports.length?' '+reports.join('；'):'');
 const unresolved=[...correctionGroups.values()].reduce((sum,group)=>sum+group.pending,0);
 if(unresolved){$('message').textContent+=` 有 ${unresolved} 筆需要確認，請在下方工單表補填 IC／機種後重新產生。`;$('message').className='warn';}
 else if(regenerate){$('message').textContent+=' 補填已套用，下載結果與檔案庫已更新。';$('message').className=failed?'warn':'ok';}
 }catch(e){error(e);$('export').disabled=!downloads.length;}
 finally{$('uploadResults').innerHTML=downloads.length?table(['比對後檔案','下載'],downloads.map((item,index)=>[esc(item.name),`<button type="button" class="secondary" data-download="${index}">下載 Excel</button>`])):'';$('match').disabled=false;$('file').disabled=false;$('matchCorrectionFields').disabled=false;endFileOperation();renderMatchCorrections();}
}
$('match').onclick=()=>matchFiles(Array.from($('file').files));
window.addEventListener('library-match',({detail:{files}})=>matchFiles(files,{archive:false}));
$('uploadResults').onclick=e=>{const button=e.target.closest('[data-download]');if(!button)return;const d=downloads[Number(button.dataset.download)];if(d)saveDownload(d.url,d.name);};
$('file').onchange=()=>{clearDownload();resetMatchCorrections();$('uploadResults').innerHTML='';$('message').textContent='已選擇 '+$('file').files.length+' 個檔案，請點「開始比對」。';};
$('matchRegenerate').onclick=async()=>{
 if(libraryIsBusy())return;
 try{
  const updates=new Map(),groups=[...correctionGroups.values()];
  for(let index=0;index<groups.length;index++){
   const value=correctionDrafts.get(groups[index].key)||batchCorrections.get(groups[index].key)||{},ic=(value.ic||'').trim(),model=(value.model||'').trim();
   if(!ic&&!model)continue;
   if(!ic||!model)throw Error(`第 ${index+1} 組工單／料號請完整填寫 IC 與機種。`);
   updates.set(groups[index].key,{key:groups[index].key,ic,model});
  }
  if(!updates.size)throw Error('請先在下方表格填寫 IC 與機種。');
  batchCorrections=updates;await matchFiles(batchFiles,{archive:false,regenerate:true});
 }catch(e){error(e);}
};
$('matchCorrectionTable').oninput=event=>{
 const input=event.target,kind=input.hasAttribute('data-correction-ic')?'ic':input.hasAttribute('data-correction-model')?'model':null;if(!kind)return;
 const index=Number(kind==='ic'?input.dataset.correctionIc:input.dataset.correctionModel),group=[...correctionGroups.values()][index];if(!group)return;
 const value={...(correctionDrafts.get(group.key)||batchCorrections.get(group.key)||{})};value[kind]=input.value;correctionDrafts.set(group.key,value);
};
$('matchCorrectionPrev').onclick=()=>{if(correctionPage>0){correctionPage--;renderMatchCorrections();}};
$('matchCorrectionNext').onclick=()=>{if((correctionPage+1)*50<correctionGroups.size){correctionPage++;renderMatchCorrections();}};
$('export').onclick=()=>{
 if(!downloads.length){error(Error('請先點「開始比對」，完成後即可下載。'));return;}
 const name=downloadUrl?'AUTOREPORT 工單查找與品質分析_批次結果.zip':downloads[0].name;
 saveDownload(downloadUrl||downloads[0].url,name);$('message').textContent='已送出下載：'+name+'。若沒有出現，請檢查瀏覽器的下載清單或下載權限。';
};

let uploadedFiles=[],sourceFiles=[],filesReady=false;
function renderUploadedFiles(){
 const query=$('uploadedFileFilter').value.trim().normalize('NFKC').toLowerCase();
 const known=new Set(uploadedFiles.map(f=>f.name));
 const rows=[...uploadedFiles.map(f=>({...f,kind:'本瀏覽器匯入'})),...sourceFiles.filter(name=>!known.has(name)).map(name=>({name,kind:'既有資料庫來源'}))];
 if(!rows.length){$('uploadedFiles').replaceChildren();return;}
 const filtered=rows.filter(f=>f.name.normalize('NFKC').toLowerCase().includes(query));
 const exact=query&&rows.some(f=>f.name.normalize('NFKC').toLowerCase()===query);
 $('uploadedFiles').innerHTML=(exact?'<p class="warn">已有同名檔案，請確認後再上傳；若要保留兩份檔案，請先改名。</p>':'')+table(['檔名','狀態','大小','查看'],filtered.map(f=>[esc(f.name),esc(f.kind),f.size==null?'—':esc((f.size/1024).toFixed(1)+' KB'),f.path?'<a target="_blank" rel="noopener noreferrer" href="https://github.com/meng049-cmd/AutoReport/blob/codex/autoreport-database/'+f.path.split('/').map(encodeURIComponent).join('/')+'">查看檔案</a>':'—']))+(!filtered.length?'<p>沒有符合的檔名。</p>':'');
}
function renderUploadedFilesStatus(){$('uploadedFilesStatus').textContent=uploadedFiles.length?'本瀏覽器匯入清單：'+uploadedFiles.length+' 份 Excel。':'尚無匯入資料。';}
async function refreshUploadedFiles(){if(!filesReady)return;await call('refresh');applyDatabaseStats(await call('stats'));}
$('uploadedFileFilter').oninput=renderUploadedFiles;
$('refreshUploadedFiles').onclick=refreshUploadedFiles;
function applyDatabaseStats(s){uploadedFiles=s.uploaded_files||[];sourceFiles=s.source_files||[];setReferenceSources([...sourceFiles,...uploadedFiles.map(file=>file.name)]);filesReady=true;renderUploadedFiles();renderUploadedFilesStatus();$('databaseMetrics').hidden=!s['索引資料列'];if(!s['索引資料列']){$('query').value='';$('uploadedFileFilter').value='';for(const input of document.querySelectorAll('input[type=file]'))input.value='';}if(s.cleared_at&&!s['索引資料列'])$('databaseStatus').textContent='已清空本瀏覽器資料庫。所有資料與匯入清單已移除，可重新上傳。';$('sheetCount').textContent=new Set(s['分頁'].map(r=>r.name)).size;const update=s.database_update;$('databaseUpdated').textContent=update?.updated_at?'資料更新時間：'+new Date(update.updated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'（台北時間） · 最近新增 '+update.added_records+' 筆、跳過重複 '+update.skipped_records+' 筆':(s['索引資料列']?'目前使用既有對照資料；尚無透過新上傳流程更新的紀錄。':'資料庫目前為空，請上傳原始對照 Excel。');$('orderCount').textContent=s['不重複工單'].toLocaleString();$('pairCount').textContent=s['機種IC組合'];$('sources').innerHTML=s['分頁'].length?table(['分頁','表頭列','原始非空資料列','可查找列'],s['分頁'].map(r=>[esc(r.name),r.header_row??'未標示',r.raw_rows,r.indexed_rows])):'';for(const id of ['lookup','match','fulltext','databaseUpload','databaseClear'])$(id).disabled=false;$('message').textContent='對照資料已載入，可以查找或上傳檔案。';}
call('stats').then(applyDatabaseStats).catch(error);

const databaseWorker=new Worker(new URL('../browser-db-worker.js?v='+__BUILD_ID__,import.meta.url));let databaseId=0,databasePending=new Map(),databaseDownloadUrl;
databaseWorker.onmessage=({data})=>{if(data.progress){$('databaseStatus').textContent=data.progress;return;}const p=databasePending.get(data.id);if(!p)return;databasePending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
databaseWorker.onerror=()=>{for(const p of databasePending.values())p.reject(Error('瀏覽器資料庫工具載入失敗，請重新整理再試。'));databasePending.clear();};
function databaseCall(type,file){return new Promise((resolve,reject)=>{const id=++databaseId;databasePending.set(id,{resolve,reject});databaseWorker.postMessage({id,type,file});});}
$('databaseUpload').onclick=async()=>{
 const files=Array.from($('databaseFile').files);if(!files.length){$('databaseStatus').textContent='請先選擇原始對照 Excel。';return;}
 if(!beginFileOperation())return;const controls=['databaseUpload','databaseClear','databaseDownload','databaseFile','lookup','match','fulltext','file','export','libraryAnalyze'];const before=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 try{let added=0,skipped=0,success=0,unchanged=0;const failures=[];
  for(let i=0;i<files.length;i++){try{$('databaseStatus').textContent=`正在匯入 ${i+1}/${files.length}：${files[i].name}`;const {summary,reference}=await databaseCall('upload',files[i]);if(reference){await call('reload',{reference});applyDatabaseStats(await call('stats'));}added+=summary.added_records||0;skipped+=summary.skipped_records||0;success++;if(summary.unchanged)unchanged++;}catch(error){failures.push(files[i].name+'：'+error.message);}}
  clearDownload();resetMatchCorrections();$('uploadResults').replaceChildren();$('searchResults').replaceChildren();if(success)databaseChannel?.postMessage('changed');
  $('databaseStatus').textContent=(success?(success===unchanged?'沒有新對照，既有資料庫未變更。':`已儲存在本瀏覽器：新增 ${added} 筆，跳過重複 ${skipped} 筆。`):'')+(files.length>1?` 成功 ${success} 份，失敗 ${failures.length} 份。`:'')+(failures.length?' '+failures.join('；'):'');
 }catch(e){$('databaseStatus').textContent=e.message;}finally{controls.forEach((id,i)=>$(id).disabled=before[i]);$('export').disabled=true;endFileOperation();}

};
$('databaseDownload').onclick=async()=>{try{const bytes=await databaseCall('download');if(databaseDownloadUrl)URL.revokeObjectURL(databaseDownloadUrl);databaseDownloadUrl=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.sqlite3'}));saveDownload(databaseDownloadUrl,'AutoReport_瀏覽器資料庫.sqlite3');}catch(e){$('databaseStatus').textContent=e.message;}};

const databaseChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('AutoReport-database-changes'):null;
function clearDatabaseResults(){clearDownload();resetMatchCorrections();$('uploadResults').innerHTML='';$('searchResults').innerHTML='';if(databaseDownloadUrl){URL.revokeObjectURL(databaseDownloadUrl);databaseDownloadUrl=null;}}
if(databaseChannel)databaseChannel.onmessage=async({data})=>{if(data==='cleared'){for(const input of document.querySelectorAll('input[type=file]'))input.value='';location.reload();return;}try{await call('refresh');applyDatabaseStats(await call('stats'));clearDatabaseResults();$('databaseStatus').textContent='另一個分頁已更新資料庫，已同步最新資料。';}catch(e){$('databaseStatus').textContent=e.message;}};
$('databaseClear').onclick=async()=>{
 if(libraryIsBusy())return;if(!confirm('確定清空本瀏覽器資料庫？所有對照及匯入清單將刪除，無法復原。建議先下載 SQLite 備份。'))return;
 if(!beginFileOperation())return;const controls=['databaseClear','databaseUpload','databaseDownload','databaseFile','lookup','match','fulltext','file','export'];
 const before=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 try{await databaseCall('clear');await clearFileLibrary();clearDatabaseResults();for(const input of document.querySelectorAll('input')){if(input.type==='file'||input.type==='text')input.value='';}databaseChannel?.postMessage('cleared');location.reload();}
 catch(e){$('databaseStatus').textContent=e.message;}
 finally{controls.forEach((id,i)=>$(id).disabled=before[i]);$('export').disabled=!downloads.length;endFileOperation();}
};
