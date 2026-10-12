import JSZip from 'jszip';
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
function clearDownload(){if(downloadUrl)URL.revokeObjectURL(downloadUrl);for(const d of downloads)URL.revokeObjectURL(d.url);downloadUrl=null;downloads=[];$('export').disabled=true;}
function saveDownload(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function error(e){$('message').textContent=e.message;$('message').className='warn'}

async function query(fulltext=false){
 $('message').textContent='';const q=$('query').value.trim();if(!q)return;
 try{if(fulltext){const rows=await call('search',{query:q});$('searchResults').innerHTML='<p>文字搜尋顯示最多 100 列，不會自動補值。</p>'+table(['機種','IC','產品系列','料號','來源'],rows.map(r=>[esc(r.model),esc(r.ic),esc(r.family),esc(r.parts.join('、')),esc(r.sheet)+' · 第 '+r.row_number+' 列']));}
 else{const r=await call('query',{query:q,kind:$('kind').value});$('searchResults').innerHTML='<p class="'+(r['狀態']==='唯一匹配'?'ok':'warn')+'">'+esc(r['狀態'])+'</p>'+candidates(r['候選']);}}catch(e){error(e)}
}
$('queryForm').onsubmit=e=>{e.preventDefault();query()};$('fulltext').onclick=()=>query(true);
$('match').onclick=async()=>{
 const files=Array.from($('file').files);if(!files.length){error(Error('請先選擇檔案。'));return;}
 $('match').disabled=true;$('file').disabled=true;clearDownload();$('uploadResults').innerHTML='';$('message').className='';
 const used=new Set();let failed=0,total=0;const reports=[];
 try{
 for(let index=0;index<files.length;index++){
  const file=files[index];$('message').textContent=`正在處理 ${index+1}/${files.length}：${file.name}`;
  try{
   if(file.size>20*1024*1024)throw Error('檔案超過 20 MB。');
   const bytes=await file.arrayBuffer();const r=await call('match',{bytes,filename:file.name},[bytes]);
   const counts={};for(const row of r['結果'])counts[row['狀態']]=(counts[row['狀態']]||0)+1;
   const summary='完成 '+r['筆數']+' 筆：'+Object.entries(counts).map(([k,v])=>k+' '+v+' 筆').join('、')+(r['提示'].length?'\n'+r['提示'].join('\n'):'');
   total+=r['筆數'];let button='';
   if(r['筆數']){
    $('message').textContent=`正在準備下載 ${index+1}/${files.length}：${file.name}`;
    const output=await call('export');const base=file.name.replace(/\.(xlsx|csv)$/i,'')+'_IC機種';let name=base+'.xlsx',suffix=2;
    while(used.has(name.toLowerCase()))name=base+'_'+suffix+++'.xlsx';used.add(name.toLowerCase());
    const blob=new Blob([output],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const item={name,blob,url:URL.createObjectURL(blob)};downloads.push(item);
    button='<button type="button" data-download="'+(downloads.length-1)+'" class="secondary">下載此檔結果</button>';
   }
   reports.push('<section><h3>'+esc(file.name)+'</h3><p style="white-space:pre-wrap">'+esc(summary)+'</p>'+button+table(['分頁／列號','狀態','機種','IC','候選與來源'],r['結果'].slice(0,200).map(i=>[esc(i['分頁'])+' / '+i['列號'],esc(i['狀態']),esc(i['機種']),esc(i.IC),candidates(i['候選'])]))+(r['筆數']>200?'<p>畫面顯示前 200 筆，下載包含全部結果。</p>':'')+'</section>');
   if(files.length===1)$('message').textContent=summary;
  }catch(e){failed++;reports.push('<section><h3>'+esc(file.name)+'</h3><p class="warn">'+esc(e.message)+'</p></section>');if(files.length===1)error(e);}
  $('uploadResults').innerHTML=reports.join('');
 }
 if(downloads.length>1){
  $('message').textContent='正在打包全部下載檔…';const zip=new JSZip();for(const d of downloads)zip.file(d.name,await d.blob.arrayBuffer());
  downloadUrl=URL.createObjectURL(await zip.generateAsync({type:'blob',compression:'STORE'}));
 }
 $('export').disabled=!downloads.length;$('export').textContent=downloads.length>1?'下載全部結果（ZIP）':'匯出 Excel';
 if(files.length>1)$('message').textContent=`批次完成 ${files.length} 個檔案，共 ${total} 筆；可下載 ${downloads.length} 份結果，失敗 ${failed} 個檔案。`;
 }catch(e){error(e);$('export').disabled=!downloads.length;}
 finally{$('match').disabled=false;$('file').disabled=false;}
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
 const rows=[...uploadedFiles.map(f=>({...f,kind:'已存於 GitHub'})),...sourceFiles.filter(name=>!known.has(name)).map(name=>({name,kind:'既有資料庫來源'}))];
 const filtered=rows.filter(f=>f.name.normalize('NFKC').toLowerCase().includes(query));
 const exact=query&&rows.some(f=>f.name.normalize('NFKC').toLowerCase()===query);
 $('uploadedFiles').innerHTML=(exact?'<p class="warn">已有同名檔案，請確認後再上傳；若要保留兩份檔案，請先改名。</p>':'')+table(['檔名','狀態','大小','查看'],filtered.map(f=>[esc(f.name),esc(f.kind),f.size==null?'—':esc((f.size/1024).toFixed(1)+' KB'),f.path?'<a target="_blank" rel="noopener noreferrer" href="https://github.com/meng049-cmd/AutoReport/blob/codex/autoreport-database/'+f.path.split('/').map(encodeURIComponent).join('/')+'">查看檔案</a>':'—']))+(!filtered.length?'<p>沒有符合的檔名。</p>':'');
}
async function refreshUploadedFiles(){
 if(!filesReady)return;
 $('refreshUploadedFiles').disabled=true;$('uploadedFilesStatus').textContent='正在向 GitHub 取得最新檔案清單…';
 try{
  const response=await fetch('https://api.github.com/repos/meng049-cmd/AutoReport/git/trees/codex%2Fautoreport-database?recursive=1',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('GitHub 清單暫時無法讀取');
  const data=await response.json();if(data.truncated||!Array.isArray(data.tree))throw Error('GitHub 清單不完整');
  uploadedFiles=data.tree.filter(f=>f.type==='blob'&&f.path.startsWith('database-inputs/')&&/\.xlsx$/i.test(f.path)).map(f=>({name:f.path.split('/').at(-1),path:f.path,size:f.size}));
  renderUploadedFiles();$('uploadedFilesStatus').textContent='GitHub 最新清單：'+uploadedFiles.length+' 份 Excel。';
 }catch{
  renderUploadedFiles();$('uploadedFilesStatus').textContent='目前顯示最近取得的清單。無法讀取 GitHub 最新清單時，請點「在 GitHub 查看全部檔案」確認最新內容。';
 }finally{$('refreshUploadedFiles').disabled=false;}
}
$('uploadedFileFilter').oninput=renderUploadedFiles;
$('refreshUploadedFiles').onclick=refreshUploadedFiles;
call('stats').then(s=>{uploadedFiles=s.uploaded_files||[];sourceFiles=s.source_files||[];filesReady=true;renderUploadedFiles();refreshUploadedFiles();$('sheetCount').textContent=new Set(s['分頁'].map(r=>r.name)).size;const update=s.database_update;$('databaseUpdated').textContent=update?.updated_at?'資料更新時間：'+new Date(update.updated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'（台北時間） · 最近新增 '+update.added_records+' 筆、跳過重複 '+update.skipped_records+' 筆':'目前使用既有對照資料；尚無透過新上傳流程更新的紀錄。';$('orderCount').textContent=s['不重複工單'].toLocaleString();$('pairCount').textContent=s['機種IC組合'];$('sources').innerHTML=table(['分頁','表頭列','原始非空資料列','可查找列'],s['分頁'].map(r=>[esc(r.name),r.header_row??'未標示',r.raw_rows,r.indexed_rows]));for(const id of ['lookup','match','fulltext'])$(id).disabled=false;$('message').textContent='對照資料已載入，可以查找或上傳檔案。';}).catch(error);
