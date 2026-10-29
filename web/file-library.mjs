import {removeAnalysisCaches,clearAnalysisCaches} from './analysis-cache.mjs';
const entries=new Map();
export const libraryEvents=new EventTarget();
let db,operationBusy=false;
export const libraryIsBusy=()=>operationBusy;
export function beginFileOperation(){if(operationBusy)return false;operationBusy=true;changed();return true;}
export function endFileOperation(){operationBusy=false;changed();}
export const libraryReady=new Promise(resolve=>{
 if(!globalThis.indexedDB){resolve();return;}
 const request=indexedDB.open('AutoReport-file-library',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
 request.onerror=()=>resolve();request.onsuccess=()=>{db=request.result;db.onversionchange=()=>{db.close();db=null;};const read=db.transaction('files').objectStore('files').getAll();read.onsuccess=()=>{for(const item of read.result)entries.set(item.id,item);resolve();};read.onerror=()=>resolve();};
});
function changed(){libraryEvents.dispatchEvent(new Event('change'));}
function write(mode,action){return new Promise((resolve,reject)=>{if(!db){reject(Error('檔案清單暫存於此分頁'));return;}const tx=db.transaction('files',mode);action(tx.objectStore('files'));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export function listLibraryFiles(){return [...entries.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));}
export function libraryCollection(entry){return ['raw','detail','analysis'].includes(entry.collection)?entry.collection:entry.kind==='raw'?'raw':['analysis','input'].includes(entry.kind)?'analysis':'detail';}
export async function addLibraryFile(file,{kind='matched',detail=true,sources=[],rows=null,collection,sourceFileId,replaceId}={}){
 await libraryReady;const previous=replaceId?entries.get(replaceId):null;const entry={id:previous?.id||crypto.randomUUID(),name:file.name,blob:file,size:file.size,lastModified:file.lastModified,kind,detail,sources,rows,collection:libraryCollection({kind,collection}),sourceFileId,createdAt:previous?.createdAt||new Date().toISOString(),persistent:true};
 try{await write('readwrite',store=>store.put(entry));}catch{entry.persistent=false;}
 entries.set(entry.id,entry);if(previous)await removeAnalysisCaches([entry.id]);changed();return entry;
}
export async function removeLibraryFiles(ids){await libraryReady;if(db)await write('readwrite',store=>ids.forEach(id=>store.delete(id)));else if(ids.some(id=>entries.get(id)?.persistent))throw Error('檔案清單連線已更新，請重新整理後再移除。');ids.forEach(id=>entries.delete(id));await removeAnalysisCaches(ids);changed();}
export async function clearFileLibrary(){await libraryReady;if(db)await write('readwrite',store=>store.clear());else if([...entries.values()].some(item=>item.persistent))throw Error('檔案清單連線已更新，請重新整理後再清空。');entries.clear();await clearAnalysisCaches();changed();}
export function entryFile(entry){return new File([entry.blob],entry.name,{type:entry.blob.type||(/\.csv$/i.test(entry.name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),lastModified:entry.lastModified??entry.blob.lastModified??new Date(entry.createdAt).getTime()});}
export function entrySources(items){const map=new Map();for(const item of items)for(const source of item.sources?.length?item.sources:[{name:item.name,size:item.size,kind:'Detail'}])if(!map.has(source.name))map.set(source.name,source);return [...map.values()];}
