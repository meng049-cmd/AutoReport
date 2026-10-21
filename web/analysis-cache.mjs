// Cache only completed calculations. Original files remain in the file library.
const memory=new Map(),LIMIT=4;
let db,epoch=0;
const ready=new Promise(resolve=>{
 if(!globalThis.indexedDB){resolve();return;}
 const request=indexedDB.open('AutoReport-analysis-cache',1);
 request.onupgradeneeded=()=>{const store=request.result.createObjectStore('results',{keyPath:'key'});store.createIndex('reportId','reportId');store.createIndex('inputIds','inputIds',{multiEntry:true});};
 request.onerror=()=>resolve();request.onsuccess=()=>{db=request.result;db.onversionchange=()=>{db.close();db=null;};resolve();};
});
const version=()=>__ANALYSIS_VERSION__;
function remember(record){memory.delete(record.key);memory.set(record.key,record);while(memory.size>LIMIT)memory.delete(memory.keys().next().value);}
function transaction(mode,run){return new Promise((resolve,reject)=>{if(!db){resolve();return;}const tx=db.transaction('results',mode);run(tx.objectStore('results'));tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});}
async function read(key){const generation=epoch;let record=memory.get(key);if(!record){await ready;if(!db)return null;try{await transaction('readonly',store=>{const request=store.get(key);request.onsuccess=()=>{record=request.result;};});}catch{return null;}}
 if(generation!==epoch||record?.version!==version())return null;if(record)remember(record);return record||null;
}
export function analysisSelectionKey(ids,options,sources,referenceSources){return ids?.length?JSON.stringify([ids,options.skipInvalidRows===true,sources,referenceSources]):null;}
export async function getAnalysisCache({reportId,selectionKey}={}){
 if(!reportId&&selectionKey){const alias=await read('selection:'+selectionKey);reportId=alias?.reportId;}
 if(!reportId)return null;return read('report:'+reportId);
}
export async function saveAnalysisCache(reportId,data,{selectionKey,inputIds=[],downloadBlob}={}){
 const {bytes,merged,...result}=data,generation=epoch,record={key:'report:'+reportId,version:version(),reportId,data:result,downloadBlob};remember(record);
 const alias=selectionKey?{key:'selection:'+selectionKey,version:version(),reportId,inputIds}:null;if(alias)remember(alias);
 await ready;if(generation!==epoch)return;try{await transaction('readwrite',store=>{store.put(record);if(alias)store.put(alias);});}catch{/* Quota or private-mode failures must never prevent analysis or downloads. */}
}
export async function removeAnalysisCaches(ids){const removed=new Set(ids);epoch++;const matches=record=>removed.has(record.reportId)||(record.inputIds||[]).some(id=>removed.has(id));for(const [key,record] of memory)if(matches(record))memory.delete(key);await ready;try{await transaction('readwrite',store=>{for(const id of removed)for(const index of ['reportId','inputIds']){const request=store.index(index).openKeyCursor(IDBKeyRange.only(id));request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;store.delete(cursor.primaryKey);cursor.continue();};}});}catch{}}
export async function clearAnalysisCaches(){epoch++;memory.clear();await ready;try{await transaction('readwrite',store=>store.clear());}catch{}}
