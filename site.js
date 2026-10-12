'use strict';
const form=document.querySelector('#form'), files=document.querySelector('#files'), button=document.querySelector('#submit'), message=document.querySelector('#message'), result=document.querySelector('#result');
let downloadUrl;
files.addEventListener('change', () => {
  const list=document.querySelector('#list'); list.replaceChildren();
  for (const file of files.files) { const item=document.createElement('li'); item.textContent=file.name; list.append(item); }
  result.hidden=true; message.textContent='';
});
form.addEventListener('submit', event => {
  event.preventDefault(); result.hidden=true; message.className='';
  const inputs=[...files.files];
  if (!inputs.length || inputs.length>30 || inputs.reduce((sum,file)=>sum+file.size,0)>100*1024*1024 || inputs.some(file=>!file.name.toLowerCase().endsWith('.xlsx'))) {
    message.className='error'; message.textContent='請選擇 1 至 30 份 .xlsx，合計 100 MB 以內。'; return;
  }
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl=undefined; }
  button.disabled=true; files.disabled=true; message.textContent='正在準備合併…';
  let worker;
  const cleanup=()=>{worker?.terminate(); button.disabled=false; files.disabled=false;};
  try {
    worker=new Worker('merge-worker.js');
    worker.onmessage=({data})=>{
      if (data.type==='progress') { message.textContent=data.message; return; }
      if (data.type==='error') { message.className='error'; message.textContent=data.message; cleanup(); return; }
      document.querySelector('#dates').textContent=`${data.start_date} 至 ${data.end_date}`;
      const stats=document.querySelector('#stats'); stats.replaceChildren();
      for (const [label,value] of [['原始筆數',data.input_rows],['移除重複',data.removed_rows],['保留筆數',data.output_rows]]) {
        const block=document.createElement('div'), strong=document.createElement('strong'); strong.textContent=value.toLocaleString(); block.append(strong,document.createTextNode(label)); stats.append(block);
      }
      downloadUrl=URL.createObjectURL(new Blob([data.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.querySelector('#download'); link.href=downloadUrl; link.download=data.filename; link.textContent=`下載 ${data.filename}`;
      result.hidden=false; message.textContent='處理完成，可點選下載檔案。'; cleanup();
    };
    worker.onerror=()=>{message.className='error';message.textContent='瀏覽器無法完成處理，請減少檔案數量或使用桌面版 Chrome／Edge 重試。';cleanup();};
    worker.postMessage(inputs);
  } catch (error) {message.className='error';message.textContent=error.message;cleanup();}
});
