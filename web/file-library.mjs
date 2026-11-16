import {removeAnalysisCaches,clearAnalysisCaches} from './analysis-cache.mjs';
import '../indexed-detail-store.js';
import {indexKey} from './detail-index.mjs';
const entries=new Map();
export const libraryEvents=new EventTarget();
let db,operationBusy=false;
export const libraryIsBusy=()=>operationBusy;
export function beginFileOperation(){if(operationBusy)return false;operationBusy=true;changed('busy');return true;}
export function endFileOperation(){operationBusy=false;changed('busy');}
export const libraryReady=new Promise(resolve=>{
 if(!globalThis.indexedDB){resolve();return;}
 const request=indexedDB.open('AutoReport-file-library',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
 request.onerror=()=>resolve();request.onsuccess=()=>{db=request.result;db.onversionchange=()=>{db.close();db=null;};const read=db.transaction('files').objectStore('files').getAll();read.onsuccess=()=>{for(const item of read.result)entries.set(item.id,item);resolve();};read.onerror=()=>resolve();};
});
function changed(type='files'){libraryEvents.dispatchEvent(new CustomEvent('change',{detail:{type}}));}
function write(mode,action){return new Promise((resolve,reject)=>{if(!db){reject(Error('檔案清單暫存於此分頁'));return;}const tx=db.transaction('files',mode);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);try{action(tx.objectStore('files'));}catch(error){tx.abort();reject(error);}});}
export function listLibraryFiles({includeHistory=false}={}){return [...entries.values()].filter(item=>includeHistory||!item.matchHistory).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));}
export function libraryCollection(entry){return entry.matchHistory?'history':['raw','detail','mergedDetail','analysis'].includes(entry.collection)?entry.collection:entry.kind==='raw'?'raw':['analysis','input'].includes(entry.kind)?'analysis':'detail';}
function historyFor(entry){return {...entry,id:'history:'+crypto.randomUUID(),matchHistory:true,originalId:entry.id,originalCollection:libraryCollection(entry),archivedAt:new Date().toISOString(),persistent:true};}
export async function addLibraryFile(file,{kind='matched',detail=true,sources=[],rows=null,collection,sourceFileId,replaceId}={}){
 await libraryReady;const previous=replaceId?entries.get(replaceId):null;const entry={id:previous?.id||crypto.randomUUID(),name:file.name,blob:file,size:file.size,lastModified:file.lastModified,kind,detail,sources,rows,collection:libraryCollection({kind,collection}),sourceFileId,createdAt:previous?.createdAt||new Date().toISOString(),persistent:true};
 const retain=['raw','matched'].includes(kind),history=retain?historyFor(entry):null;
 const previousHistory=retain&&previous&&!previous.matchHistory&&!entries.has(previous.historyId)?historyFor(previous):null;
 if(history)entry.historyId=history.id;
 if(previous?.matchHistory)throw Error('比對歷史資料不可覆寫。');
 try{await write('readwrite',store=>{store.put(entry);if(history)store.put(history);if(previousHistory)store.put(previousHistory);});}catch(error){if(retain)throw Error('原始檔或比對結果無法保存至資料庫，請確認瀏覽器儲存空間後重試；本次未宣告保存成功。');entry.persistent=false;}
 if(history)entries.set(history.id,history);
 if(previousHistory)entries.set(previousHistory.id,previousHistory);
 entries.set(entry.id,entry);if(previous){await removeAnalysisCaches([entry.id]);await globalThis.AutoReportDetailIndex.removeForIds([entry.id]).catch(()=>{});}changed();return entry;
}
export async function replaceLibraryFile(id,file){
 await libraryReady;const previous=entries.get(id);if(previous?.matchHistory)throw Error('比對歷史資料不可覆寫。');if(!db||!previous?.persistent)throw Error('此檔案沒有儲存在本機資料庫，無法直接精簡。');
 const blob=file instanceof Blob?file:new Blob([file]),lastModified=Math.max(Date.now(),(previous.lastModified||0)+1),entry={...previous,blob,size:blob.size,lastModified,persistent:true};
 const oldKey=indexKey(entryFile(previous),id),oldMeta=await globalThis.AutoReportDetailIndex.meta(oldKey).catch(()=>null),newKey=indexKey(entryFile(entry),id);
 await write('readwrite',store=>store.put(entry));entries.set(id,entry);await removeAnalysisCaches([id]).catch(()=>{});
 let indexPreserved=false;
 if(oldMeta?.complete&&globalThis.AutoReportDetailIndex.rekey){try{indexPreserved=await globalThis.AutoReportDetailIndex.rekey(oldKey,{...oldMeta,key:newKey,name:entry.name,size:blob.size,complete:true});}catch{indexPreserved=false;}}
 await globalThis.AutoReportDetailIndex.removeForIds([id],{keep:indexPreserved?[newKey]:[]}).catch(()=>{});changed();return {entry,indexPreserved};
}
export async function removeLibraryFiles(ids){
 await libraryReady;
 if(ids.some(id=>entries.get(id)?.matchHistory))throw Error('比對歷史資料不可由檔案清單刪除。');
 const histories=ids.map(id=>entries.get(id)).filter(item=>item&&['raw','matched'].includes(item.kind)&&!entries.has(item.historyId)).map(historyFor);
 if(db)await write('readwrite',store=>{histories.forEach(item=>store.put(item));ids.forEach(id=>store.delete(id));});else if(histories.length||ids.some(id=>entries.get(id)?.persistent))throw Error('無法保存比對歷史，原檔案未刪除，請重新整理後重試。');
 histories.forEach(item=>entries.set(item.id,item));ids.forEach(id=>entries.delete(id));await removeAnalysisCaches(ids);await globalThis.AutoReportDetailIndex.removeForIds(ids).catch(()=>{});changed();
}
export async function restoreMatchHistory(id){
 await libraryReady;const item=entries.get(id);if(!item?.matchHistory)throw Error('找不到比對歷史資料。');
 return addLibraryFile(entryFile(item),{kind:item.kind,detail:item.detail,sources:item.sources,rows:item.rows,collection:item.originalCollection,sourceFileId:item.sourceFileId});
}
export async function clearFileLibrary(){await libraryReady;if(db)await write('readwrite',store=>store.clear());else if([...entries.values()].some(item=>item.persistent))throw Error('檔案清單連線已更新，請重新整理後再清空。');entries.clear();await clearAnalysisCaches();await globalThis.AutoReportDetailIndex.clear().catch(()=>{});changed();}
export function entryFile(entry){return new File([entry.blob],entry.name,{type:entry.blob.type||(/\.csv$/i.test(entry.name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),lastModified:entry.lastModified??entry.blob.lastModified??new Date(entry.createdAt).getTime()});}
export function entrySources(items){const map=new Map();for(const item of items)for(const source of item.sources?.length?item.sources:[{name:item.name,size:item.size,kind:'Detail'}])if(!map.has(source.name))map.set(source.name,source);return [...map.values()];}
