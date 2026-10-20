import {clearQuality,renderQuality} from './quality-ui.mjs';
import {getReferenceSources} from './report-context.mjs';
const $=id=>document.getElementById(id);let downloadUrl,worker;
export function calculateYieldFile(file,onProgress=()=>{},context={}){
 return new Promise((resolve,reject)=>{
  const w=new Worker(new URL('../yield-worker.js?v='+__BUILD_ID__,import.meta.url));
  w.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.message);return;}w.terminate();if(data.type==='error')reject(Error(data.message));else resolve(data);};
  w.onerror=()=>{w.terminate();reject(Error('瀏覽器無法完成計算，請使用桌面版 Chrome／Edge 或縮小主檔。'));};w.postMessage({file,referenceSources:getReferenceSources(),...context});
 });
}
function clear(){clearQuality();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('yieldResult').hidden=true;$('yieldMessage').textContent='';$('thresholdDashboard').hidden=true;}
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
  $('yieldMessage').textContent='分析完成，報表已備妥，可點擊下載。';
  renderQuality(data.analysis,data.start_date,data.end_date,data.stageChecks);$('thresholdDashboard').hidden=true;
  $('yieldResult').hidden=false;done();
 };
 worker.onerror=()=>{$('yieldMessage').textContent='瀏覽器無法完成計算，請使用桌面版 Chrome／Edge 或縮小主檔。';done();};worker.postMessage({file,referenceSources:getReferenceSources()});
 }catch(error){$('yieldMessage').textContent=error.message;done();}
};
