const $=id=>document.getElementById(id);let downloadUrl,worker;
function clear(){if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldMessage').textContent='';}
$('yieldFile').onchange=clear;
$('yieldCalculate').onclick=()=>{
 if(worker)return;clear();const file=$('yieldFile').files[0];
 if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>100*1024*1024){$('yieldMessage').textContent='請選擇一份 .xlsx 主檔（100 MB 以內）。';return;}
 $('yieldCalculate').disabled=true;$('yieldFile').disabled=true;
 const done=()=>{worker?.terminate();worker=null;$('yieldCalculate').disabled=false;$('yieldFile').disabled=false;};
 try{worker=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));
 worker.onmessage=({data})=>{
  if(data.type==='progress'){$('yieldMessage').textContent=data.message;return;}
  if(data.type==='error'){$('yieldMessage').textContent=data.message;done();return;}
  downloadUrl=URL.createObjectURL(new Blob([data.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=$('yieldDownload');link.href=downloadUrl;link.download=data.filename;link.textContent='下載 '+data.filename;
  $('yieldMessage').textContent=`完成 ${data.product_count} 個 IC＋機種組合、${data.date_count} 天，共 ${data.output_rows.toLocaleString()} 筆資料；移除 ${data.removed_rows} 筆重複。日期：${data.start_date} 至 ${data.end_date}。`;
  if(data.missing_product_rows)$('yieldMessage').textContent+=` 另有 ${data.missing_product_rows.toLocaleString()} 筆 IC／機種缺漏，已標記待補並列於「待補產品資料」，未猜測產品。`;
  $('yieldResult').hidden=false;done();
 };
 worker.onerror=()=>{$('yieldMessage').textContent='瀏覽器無法完成計算，請使用桌面版 Chrome／Edge 或縮小主檔。';done();};worker.postMessage(file);
 }catch(error){$('yieldMessage').textContent=error.message;done();}
};
