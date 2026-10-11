const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let nextId=0,lastFile=null;const pending=new Map();
worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data.result);};
worker.onerror=()=>{for(const r of pending.values())r.reject(Error('比對工具載入失敗，請重新整理頁面。'));pending.clear();};
function call(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,type,payload},transfer);});}
function table(head,rows){return '<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function sources(items){return '<details><summary>'+items.length+' 筆來源</summary>'+items.map(s=>esc(s['檔案'])+' · '+esc(s['分頁'])+' 第 '+esc(s['列號'])+' 列'+(s['原始IC／機型']?' · 原始 IC／機型：'+esc(s['原始IC／機型']):'')+(s['整理依據']?.length?'<br>'+s['整理依據'].filter(n=>typeof n==='string').map(esc).join('；'):'')).join('<br>')+'</details>'}
function candidates(items){return items.map(c=>'<b>'+esc(c['機種']||'機種未填')+'</b> / '+esc(c.IC||'未標示')+(c['產品系列'].length?' <span class="badge">'+esc(c['產品系列'].join('、'))+'</span>':'')+sources(c['來源'])).join('<br>')||'—'}
function error(e){$('message').textContent=e.message;$('message').className='warn'}

async function query(fulltext=false){
 $('message').textContent='';const q=$('query').value.trim();if(!q)return;
 try{if(fulltext){const rows=await call('search',{query:q});$('searchResults').innerHTML='<p>文字搜尋顯示最多 100 列，不會自動補值。</p>'+table(['機種','IC','產品系列','料號','來源'],rows.map(r=>[esc(r.model),esc(r.ic),esc(r.family),esc(r.parts.join('、')),esc(r.sheet)+' · 第 '+r.row_number+' 列']));}
 else{const r=await call('query',{query:q,kind:$('kind').value});$('searchResults').innerHTML='<p class="'+(r['狀態']==='唯一匹配'?'ok':'warn')+'">'+esc(r['狀態'])+'</p>'+candidates(r['候選']);}}catch(e){error(e)}
}
$('queryForm').onsubmit=e=>{e.preventDefault();query()};$('fulltext').onclick=()=>query(true);
$('match').onclick=async()=>{
 const file=$('file').files[0];if(!file){error(Error('請先選擇檔案。'));return;}
 if(file.size>20*1024*1024){error(Error('檔案超過 20 MB。'));return;}
 $('match').disabled=true;$('file').disabled=true;$('export').disabled=true;lastFile=null;$('uploadResults').innerHTML='';$('message').className='';$('message').textContent='比對中…';
 try{const bytes=await file.arrayBuffer();const r=await call('match',{bytes,filename:file.name},[bytes]);lastFile=file;$('export').disabled=!r['筆數'];const counts={};for(const row of r['結果'])counts[row['狀態']]=(counts[row['狀態']]||0)+1;
 $('message').textContent='完成 '+r['筆數']+' 筆：'+Object.entries(counts).map(([k,v])=>k+' '+v+' 筆').join('、')+(r['提示'].length?'\n'+r['提示'].join('\n'):'');
 $('uploadResults').innerHTML=table(['分頁／列號','狀態','機種','IC','候選與來源'],r['結果'].slice(0,200).map(i=>[esc(i['分頁'])+' / '+i['列號'],esc(i['狀態']),esc(i['機種']),esc(i.IC),candidates(i['候選'])]))+(r['筆數']>200?'<p>畫面顯示前 200 筆，匯出包含全部結果。</p>':'');
 }catch(e){error(e)}finally{$('match').disabled=false;$('file').disabled=false;}
};
$('file').onchange=()=>{lastFile=null;$('export').disabled=true;$('uploadResults').innerHTML='';};
$('export').onclick=async()=>{if(!lastFile)return;$('export').disabled=true;try{const bytes=await call('export'),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='機種IC_比對結果.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){error(e)}finally{$('export').disabled=false;}};
call('stats').then(s=>{$('sheetCount').textContent=s['分頁'].length;$('orderCount').textContent=s['不重複工單'].toLocaleString();$('pairCount').textContent=s['機種IC組合'];$('sources').innerHTML=table(['分頁','表頭列','原始非空資料列','可查找列'],s['分頁'].map(r=>[esc(r.name),r.header_row??'未標示',r.raw_rows,r.indexed_rows]));for(const id of ['lookup','match','fulltext'])$(id).disabled=false;$('message').textContent='對照資料已載入，可以查找或上傳檔案。';}).catch(error);
