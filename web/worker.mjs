import {Matcher} from './matcher.mjs';
import {matchFile,exportMatches} from './files.mjs';
let matcher,lastResult;
const ready=fetch(new URL('../reference.json',import.meta.url),{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('對照資料載入失敗，請重新整理。');matcher=new Matcher(await r.json());});
self.onmessage=async({data:{id,type,payload}})=>{
  try{
    await ready;let result;
    if(type==='stats')result={...matcher.data.stats,database_update:matcher.data.database_update,uploaded_files:matcher.data.uploaded_files,source_files:matcher.data.source_files};
    else if(type==='query')result=matcher.lookup([[payload.kind,payload.query]]);
    else if(type==='search')result=matcher.search(payload.query);
    else if(type==='match'){lastResult=null;lastResult=await matchFile(matcher,payload.bytes,payload.filename);const {detailBytes,...summary}=lastResult;result=summary;}
    else if(type==='export'){if(!lastResult)throw Error('請先比對檔案。');const bytes=await exportMatches(lastResult);result=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
    else throw Error('未知操作。');
    self.postMessage({id,result},result instanceof ArrayBuffer?[result]:[]);
  }catch(e){self.postMessage({id,error:e.message||'檔案無法讀取。'});}
};
