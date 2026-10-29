import '../browser-storage.js';
import {Matcher} from './matcher.mjs';
import {matchFile,exportMatches} from './files.mjs';
import {applyMatchCorrections,summarizeMatchCorrections,correctionOptions} from './match-corrections.mjs';
let matcher,lastResult;
const ready=fetch(new URL('../reference.json',import.meta.url),{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('對照資料載入失敗，請重新整理。');const local=await readBrowserDatabase().catch(()=>null);matcher=new Matcher(local?.reference||await r.json());});
self.onmessage=async({data:{id,type,payload}})=>{
  try{
    await ready;let result;
    if(type==='refresh'){const local=await readBrowserDatabase();const reference=local?.reference||await(await fetch(new URL('../reference.json',import.meta.url),{cache:'no-store'})).json();matcher=new Matcher(reference);lastResult=null;result=true;}
    else if(type==='reload'){matcher=new Matcher(payload.reference);lastResult=null;result=true;}
    else if(type==='stats')result={...matcher.data.stats,database_update:matcher.data.database_update,cleared_at:matcher.data.cleared_at,uploaded_files:matcher.data.uploaded_files,source_files:matcher.data.source_files,correctionOptions:correctionOptions(matcher.data.records)};
    else if(type==='query')result=matcher.lookup([[payload.kind,payload.query]]);
    else if(type==='search')result=matcher.search(payload.query);
    else if(type==='match'){lastResult=null;lastResult=applyMatchCorrections(await matchFile(matcher,payload.bytes,payload.filename),payload.corrections,correctionOptions(matcher.data.records));const counts={};for(const row of lastResult['結果'])counts[row['狀態']]=(counts[row['狀態']]||0)+1;result={'檔名':lastResult['檔名'],'筆數':lastResult['筆數'],'提示':lastResult['提示'],counts,corrections:summarizeMatchCorrections(lastResult),detail:Boolean(lastResult.detailBytes)};}
    else if(type==='export'){if(!lastResult)throw Error('請先比對檔案。');const bytes=await exportMatches(lastResult);result=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
    else throw Error('未知操作。');
    self.postMessage({id,result},result instanceof ArrayBuffer?[result]:[]);
  }catch(e){self.postMessage({id,error:e.message||'檔案無法讀取。'});}
};
