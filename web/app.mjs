import './navigation.mjs';
import './file-library-ui.mjs';
import {addLibraryFile,clearFileLibrary,beginFileOperation,endFileOperation,libraryIsBusy} from './file-library.mjs';
import {MAX_BYTES} from './limits.mjs';
import JSZip from 'jszip';
import {mergeFiles,mergeFilesToBytes,clearMergedDownload} from './merge-ui.mjs';
import {calculateYieldFile} from './yield-ui.mjs';
import {renderQuality} from './quality-ui.mjs';
import {setReferenceSources} from './report-context.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const worker=new Worker(new URL('./worker.js?v='+__BUILD_ID__,import.meta.url),{type:'module'});
let nextId=0,downloads=[],downloadUrl=null;const pending=new Map();
worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data.result);};
worker.onerror=()=>{for(const r of pending.values())r.reject(Error('比對工具載入失敗，請重新整理頁面。'));pending.clear();};
function call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,type,payload},transfer);});}
function table(head,rows){return '<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function sources(items){return '<details><summary>'+items.length+' 筆來源</summary>'+items.map(s=>esc(s['檔案'])+' · '+esc(s['分頁'])+' 第 '+esc(s['列號'])+' 列'+(s['原始IC／機型']?' · 原始 IC／機型：'+esc(s['原始IC／機型']):'')+(s['整理依據']?.length?'<br>'+s['整理依據'].filter(n=>typeof n==='string').map(esc).join('；'):'')).join('<br>')+'</details>'}
function candidates(items){return items.map(c=>'<b>'+esc(c['機種']||'機種未填')+'</b> / '+esc(c.IC||'未標示')+(c['產品系列'].length?' <span class="badge">'+esc(c['產品系列'].join('、'))+'</span>':'')+sources(c['來源'])).join('<br>')||'—'}
function clearDownload(){$('mergeMatched').disabled=true;clearMergedDownload();$('autoResult').hidden=true;if(downloadUrl)URL.revokeObjectURL(downloadUrl);for(const d of downloads)URL.revokeObjectURL(d.url);downloadUrl=null;downloads=[];$('export').disabled=true;}
function saveDownload(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function error(e){$('message').textContent=e.message;$('message').className='warn'}

async function query(fulltext=false){
 $('message').textContent='';const q=$('query').value.trim();if(!q)return;$('searchResults').replaceChildren();
 try{if(fulltext){const rows=await call('search',{query:q});$('searchResults').innerHTML='<p>文字搜尋顯示最多 100 列，不會自動補值。</p>'+table(['機種','IC','產品系列','料號','來源'],rows.map(r=>[esc(r.model),esc(r.ic),esc(r.family),esc(r.parts.join('、')),esc(r.sheet)+' · 第 '+r.row_number+' 列']));}
 else{const r=await call('query',{query:q,kind:$('kind').value});$('searchResults').innerHTML='<p class="'+(r['狀態']==='唯一匹配'?'ok':'warn')+'">'+esc(r['狀態'])+'</p>'+candidates(r['候選']);}}catch(e){error(e)}
}
$('queryForm').onsubmit=e=>{e.preventDefault();query()};$('fulltext').onclick=()=>query(true);
$('match').onclick=async()=>{
 const files=Array.from($('file').files);if(!files.length){error(Error('請先選擇檔案。'));return;}
 if(!beginFileOperation())return;$('match').disabled=true;$('file').disabled=true;clearDownload();$('uploadResults').innerHTML='';$('message').className='';
 const used=new Set();let failed=0,total=0;const reports=[];
 try{
 for(let index=0;index<files.length;index++){
  const file=files[index];$('message').textContent=`正在處理 ${index+1}/${files.length}：${file.name}`;
  try{
   if(file.size>MAX_BYTES)throw Error('檔案超過 100 MB。');
   const bytes=await file.arrayBuffer();const r=await call('match',{bytes,filename:file.name},[bytes]);
   const summary='完成 '+r['筆數']+' 筆：'+Object.entries(r.counts).map(([k,v])=>k+' '+v+' 筆').join('、');
   total+=r['筆數'];
   if(r['筆數']){
    $('message').textContent=`正在準備下載 ${index+1}/${files.length}：${file.name}`;
    const output=await call('export');const base=file.name.replace(/\.(xlsx|csv)$/i,'')+'_IC機種';let name=base+'.xlsx',suffix=2;
    while(used.has(name.toLowerCase()))name=base+'_'+suffix+++'.xlsx';used.add(name.toLowerCase());
    const blob=new File([output],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const item={name,blob,url:URL.createObjectURL(blob),detail:r.detail};downloads.push(item);
    await addLibraryFile(blob,{kind:'matched',detail:r.detail,rows:r['筆數'],sources:[{name:file.name,size:file.size,kind:r.detail?'Detail':'查詢檔'}]});
   }
   if(files.length===1)$('message').textContent=summary+(r['筆數']?'；已加入檔案庫，可勾選、取消勾選或刪除。':'');
  }catch(e){failed++;reports.push(file.name+'：'+e.message);if(files.length===1)error(e);}
  $('uploadResults').replaceChildren();if(reports.length){$('message').textContent=reports.join('；');$('message').className='warn';}
 }
 if(downloads.length>1){
  $('message').textContent='正在打包全部下載檔…';const zip=new JSZip();for(const d of downloads)zip.file(d.name,await d.blob.arrayBuffer());
  downloadUrl=URL.createObjectURL(await zip.generateAsync({type:'blob',compression:'STORE'}));
 }
 $('mergeMatched').disabled=!downloads.some(d=>d.detail);$('export').disabled=!downloads.length;$('export').textContent=downloads.length>1?'下載全部結果（ZIP）':'匯出 Excel';
 if(files.length>1)$('message').textContent=`批次完成 ${files.length} 個檔案，共 ${total} 筆；可下載 ${downloads.length} 份結果，失敗 ${failed} 個檔案；已加入檔案庫 ${downloads.length} 份。`+(reports.length?' '+reports.join('；'):'');
 }catch(e){error(e);$('export').disabled=!downloads.length;}
 finally{$('match').disabled=false;$('file').disabled=false;endFileOperation();}
};
$('mergeMatched').onclick=()=>mergeFiles(downloads.filter(d=>d.detail).map(d=>new File([d.blob],d.name)),{matched:true});
$('autoAnalyze').onclick=async()=>{
 const files=Array.from($('file').files);if(!files.length){error(Error('請先選擇含 Detail 分頁的 Excel。'));return;}
 if(files.length>30||files.some(f=>!f.name.toLowerCase().endsWith('.xlsx'))||files.reduce((n,f)=>n+f.size,0)>100*1024*1024){error(Error('一鍵流程支援 1 至 30 份 .xlsx，原始檔合計 100 MB 以內。'));return;}
 if(!beginFileOperation())return;const button=$('autoAnalyze');button.disabled=true;$('match').disabled=true;$('mergeMatched').disabled=true;$('file').disabled=true;$('export').disabled=true;
 if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
 $('uploadResults').replaceChildren();$('matchedMergeResult').hidden=true;$('autoResult').hidden=true;$('message').className='';
 try{
  const matched=[];
  for(let i=0;i<files.length;i++){
   $('message').textContent=`一鍵處理：比對檔案 ${i+1}/${files.length}…`;
   const bytes=await files[i].arrayBuffer();const result=await call('match',{bytes,filename:files[i].name},[bytes]);
   if(!result.detail)throw Error(`${files[i].name} 沒有可合併的 Detail 分頁；請選擇 Detail 格式的 .xlsx。`);
   $('message').textContent=`一鍵處理：整理比對結果 ${i+1}/${files.length}…`;
   const output=await call('export'),file=new File([output],files[i].name.replace(/\.xlsx$/i,'_IC機種.xlsx'));matched.push(file);await addLibraryFile(file,{kind:'matched',sources:[{name:files[i].name,size:files[i].size,kind:'Detail'}],rows:result['筆數']});
  }
  $('message').textContent='一鍵處理：合併並依網站規則去重…';
  const merged=await mergeFilesToBytes(matched,msg=>{$('message').textContent='一鍵處理：'+msg;});
  const mergedFile=new File([merged.bytes],merged.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  await addLibraryFile(mergedFile,{kind:'merged',sources:files.map(file=>({name:file.name,size:file.size,kind:'Detail'})),rows:merged.output_rows});
  $('message').textContent='一鍵處理：計算每日階段良率與不良分析…';
  const report=await calculateYieldFile(mergedFile,msg=>{$('message').textContent='一鍵處理：'+msg;},{sources:files.map(file=>({name:file.name,size:file.size,kind:'Detail'}))});
  await addLibraryFile(new File([report.bytes],report.filename),{kind:'analysis',sources:report.analysis.sources,rows:report.output_rows});
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(new Blob([report.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=$('autoDownload');link.href=downloadUrl;link.download=report.filename;link.textContent='下載完整報表：'+report.filename;$('autoResult').hidden=false;
  renderQuality(report.analysis,report.start_date,report.end_date,report.stageChecks,{url:downloadUrl,filename:report.filename});
  $('message').textContent='一鍵流程完成。所有產出檔案已加入清單；完整報表可點擊下載。';$('message').className='ok';
 }catch(e){$('message').textContent=e.message;$('message').className='warn';}
 finally{button.disabled=false;$('match').disabled=false;$('file').disabled=false;$('mergeMatched').disabled=!downloads.some(d=>d.detail);$('export').disabled=!downloads.length;endFileOperation();}
};
$('uploadResults').onclick=e=>{const button=e.target.closest('[data-download]');if(!button)return;const d=downloads[Number(button.dataset.download)];if(d)saveDownload(d.url,d.name);};
$('file').onchange=()=>{clearDownload();$('uploadResults').innerHTML='';$('export').textContent='匯出 Excel';$('message').textContent='已選擇 '+$('file').files.length+' 個檔案，請點「開始比對」。';};
$('export').onclick=()=>{
 if(!downloads.length){error(Error('請先點「開始比對」，完成後即可下載。'));return;}
 const name=downloadUrl?'AutoReport_批次結果.zip':downloads[0].name;
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
 if(!beginFileOperation())return;const controls=['databaseUpload','databaseClear','databaseDownload','databaseFile','lookup','match','fulltext','file','export','autoAnalyze','libraryMerge','libraryAnalyze'];const before=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 try{let added=0,skipped=0,success=0,unchanged=0;const failures=[];
  for(let i=0;i<files.length;i++){try{$('databaseStatus').textContent=`正在匯入 ${i+1}/${files.length}：${files[i].name}`;const {summary,reference}=await databaseCall('upload',files[i]);if(reference){await call('reload',{reference});applyDatabaseStats(await call('stats'));}added+=summary.added_records||0;skipped+=summary.skipped_records||0;success++;if(summary.unchanged)unchanged++;}catch(error){failures.push(files[i].name+'：'+error.message);}}
  clearDownload();$('uploadResults').replaceChildren();$('searchResults').replaceChildren();if(success)databaseChannel?.postMessage('changed');
  $('databaseStatus').textContent=(success?(success===unchanged?'沒有新對照，既有資料庫未變更。':`已儲存在本瀏覽器：新增 ${added} 筆，跳過重複 ${skipped} 筆。`):'')+(files.length>1?` 成功 ${success} 份，失敗 ${failures.length} 份。`:'')+(failures.length?' '+failures.join('；'):'');
 }catch(e){$('databaseStatus').textContent=e.message;}finally{controls.forEach((id,i)=>$(id).disabled=before[i]);$('export').disabled=true;endFileOperation();}

};
$('databaseDownload').onclick=async()=>{try{const bytes=await databaseCall('download');if(databaseDownloadUrl)URL.revokeObjectURL(databaseDownloadUrl);databaseDownloadUrl=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.sqlite3'}));saveDownload(databaseDownloadUrl,'AutoReport_瀏覽器資料庫.sqlite3');}catch(e){$('databaseStatus').textContent=e.message;}};

const databaseChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('AutoReport-database-changes'):null;
function clearDatabaseResults(){clearDownload();$('uploadResults').innerHTML='';$('searchResults').innerHTML='';if(databaseDownloadUrl){URL.revokeObjectURL(databaseDownloadUrl);databaseDownloadUrl=null;}}
if(databaseChannel)databaseChannel.onmessage=async({data})=>{if(data==='cleared'){for(const input of document.querySelectorAll('input[type=file]'))input.value='';location.reload();return;}try{await call('refresh');applyDatabaseStats(await call('stats'));clearDatabaseResults();$('databaseStatus').textContent='另一個分頁已更新資料庫，已同步最新資料。';}catch(e){$('databaseStatus').textContent=e.message;}};
$('databaseClear').onclick=async()=>{
 if(libraryIsBusy())return;if(!confirm('確定清空本瀏覽器資料庫？所有對照及匯入清單將刪除，無法復原。建議先下載 SQLite 備份。'))return;
 if(!beginFileOperation())return;const controls=['databaseClear','databaseUpload','databaseDownload','databaseFile','lookup','match','fulltext','file','export'];
 const before=controls.map(id=>$(id).disabled);controls.forEach(id=>$(id).disabled=true);
 try{await databaseCall('clear');await clearFileLibrary();clearDatabaseResults();for(const input of document.querySelectorAll('input')){if(input.type==='file'||input.type==='text')input.value='';}databaseChannel?.postMessage('cleared');location.reload();}
 catch(e){$('databaseStatus').textContent=e.message;}
 finally{controls.forEach((id,i)=>$(id).disabled=before[i]);$('export').disabled=!downloads.length;endFileOperation();}
};
