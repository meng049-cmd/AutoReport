(function(root){
'use strict';
let opening;
function open(){return opening||(opening=new Promise((resolve,reject)=>{
 if(!root.indexedDB){reject(Error('瀏覽器無法使用日期索引，請使用允許本機儲存的 Chrome／Edge。'));return;}
 const request=root.indexedDB.open('AutoReport-detail-index',1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('files',{keyPath:'key'});request.result.createObjectStore('rows',{keyPath:['source','day','seq']});};
 request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};request.onerror=()=>{opening=null;reject(request.error);};
}));}
async function tx(store,mode,run){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction(store,mode);let result;const request=run(t.objectStore(store));if(request)request.onsuccess=()=>{result=request.result;};t.oncomplete=()=>resolve(result);t.onerror=t.onabort=()=>reject(t.error||Error('日期索引儲存失敗，請確認本機可用空間。'));});}
const range=(key,start='',end='\uffff')=>IDBKeyRange.bound([key,start,0],[key,end,Number.MAX_SAFE_INTEGER]);
const meta=key=>tx('files','readonly',s=>s.get(key));
async function reset(key){await tx('files','readwrite',s=>s.delete(key));await tx('rows','readwrite',s=>s.delete(range(key)));}
async function putRows(rows){await tx('rows','readwrite',s=>{for(const row of rows)s.put(row);});}
async function putMeta(value){await tx('files','readwrite',s=>s.put(value));}
async function scan(key,period,visit){let from=[key,period?.start_date||'',0],exclusive=false;const to=[key,period?.end_date||'\uffff',Number.MAX_SAFE_INTEGER];
 for(;;){const batch=await tx('rows','readonly',s=>s.getAll(IDBKeyRange.bound(from,to,exclusive,false),2000));if(!batch.length)break;for(const row of batch)visit(row);const last=batch.at(-1);from=[key,last.day,last.seq];exclusive=true;}
}
async function removeForIds(ids,{keep=[]}={}){if(!root.indexedDB)return;const keys=await tx('files','readonly',s=>s.getAllKeys()),removed=new Set(ids);for(const key of keys){let id;try{id=JSON.parse(key)[1];}catch{}if(removed.has(id)&&!keep.includes(key))await reset(key);}}
async function clear(){if(!root.indexedDB)return;await tx('files','readwrite',s=>s.clear());await tx('rows','readwrite',s=>s.clear());}
async function prune(key){let id;try{id=JSON.parse(key)[1];}catch{return;}await removeForIds([id],{keep:[key]});}
root.AutoReportDetailIndex={meta,reset,putRows,putMeta,scan,removeForIds,clear,prune};
})(typeof self!=='undefined'?self:globalThis);
