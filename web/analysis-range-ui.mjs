import {libraryReady,libraryEvents,listLibraryFiles,libraryCollection,entryFile,entrySources,libraryIsBusy,beginFileOperation,endFileOperation} from './file-library.mjs';
import {existingIndex,indexDetailFiles,indexKey,periods} from './detail-index.mjs';
import {analyzeYieldFiles,getYieldOptions} from './yield-ui.mjs';
import {runWeeklyTrend} from './weekly-trend-ui.mjs';
const $=id=>document.getElementById(id),metas=new Map(),choices=new Map();
let range=null,selected=[],signature='',refreshing=false,indexing=false,controller;
const entries=()=>listLibraryFiles().filter(item=>item.detail&&libraryCollection(item)===$('yieldRangeSource').value);
function validMeta(item){const meta=metas.get(item.id);return meta?.key===indexKey(entryFile(item),item.id)?meta:null;}
function update(){
 const files=entries(),indexed=files.filter(validMeta),busy=libraryIsBusy()||refreshing;
 for(const id of ['yieldRangeSource','yieldRangeMode','yieldRangeStart','yieldRangeEnd','yieldIndexDates'])$(id).disabled=busy;
 $('weeklyTrendAxis').disabled=$('weeklyTrendCalculate').disabled=$('yieldCalculate').disabled=busy||!range||!selected.length||indexed.length!==files.length;
 $('yieldIndexDates').disabled=busy||!files.length;
 if(indexing)return;
 const count=range?selected.reduce((n,item)=>n+periods.rowsIn(validMeta(item),range),0):0;
 $('yieldRangeStatus').textContent=indexed.length!==files.length?`日期索引 ${indexed.length}/${files.length} 份；請先建立／更新索引。`:
 range?`${range.start_date} ～ ${range.end_date}；自動選取 ${selected.length} 份 Detail、${count.toLocaleString()} 筆索引紀錄。範圍內逐日計算，PPID 統一去重。`:'目前沒有可分析的六製程 Detail，請先從 Raw Data 比對。';
}
function apply(changed){
 let first=choices.get($('yieldRangeStart').value),last=choices.get($('yieldRangeEnd').value);
 if(first&&last&&first.start_date>last.start_date){if(changed==='end'){$('yieldRangeStart').value=last.key;first=last;}else{$('yieldRangeEnd').value=first.key;last=first;}}
 range=first&&last?periods.rangeFor(first,last):null;
 selected=range?entries().filter(item=>validMeta(item)&&periods.rowsIn(validMeta(item),range)>0).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})):[];update();
}
function populate(){
 const files=entries(),mode=$('yieldRangeMode').value,ready=files.every(validMeta),options=ready?periods.periodsFor(files.map(validMeta),mode):[];
 choices.clear();for(const p of options)choices.set(p.key,p);
 for(const id of ['yieldRangeStart','yieldRangeEnd']){const old=$(id).value;$(id).replaceChildren(...options.map(p=>{const option=document.createElement('option');option.value=p.key;option.textContent=`${p.key}（${p.start_date} ～ ${p.end_date}）`;return option;}));if(choices.has(old))$(id).value=old;}
 apply();
}
async function refresh(force=false){
 if(libraryIsBusy()||refreshing){update();return;}
 const files=entries(),next=files.map(item=>indexKey(entryFile(item),item.id)).join('|');
 if(!force&&next===signature&&files.every(validMeta)){update();return;}signature=next;refreshing=true;update();
 try{for(const item of files){if(validMeta(item))continue;const meta=await existingIndex(entryFile(item),item.id);if(meta)metas.set(item.id,meta);else metas.delete(item.id);}}
 catch(error){$('yieldRangeStatus').textContent=error.message;}
 finally{refreshing=false;populate();}
}
$('yieldRangeSource').onchange=()=>refresh(true);$('yieldRangeMode').onchange=populate;
$('yieldRangeStart').onchange=()=>apply('start');$('yieldRangeEnd').onchange=()=>apply('end');
$('yieldCancelDateIndex').onclick=()=>controller?.abort();
$('yieldIndexDates').onclick=async()=>{
 const files=entries();if(!files.length||!beginFileOperation())return;indexing=true;controller=new AbortController();$('yieldCancelDateIndex').hidden=false;
 try{const result=await indexDetailFiles(files.map(entryFile),{ids:files.map(item=>item.id),knownMetas:metas,signal:controller.signal,onProgress:text=>$('yieldRangeStatus').textContent=text});files.forEach((item,i)=>metas.set(item.id,result[i]));populate();}
 catch(error){$('yieldMessage').textContent=error.message;signature='';}
 finally{indexing=false;controller=null;$('yieldCancelDateIndex').hidden=true;endFileOperation();}
};
$('yieldCalculate').onclick=()=>{
 if(!range||!selected.length)return;
 if(entries().some(item=>validMeta(item)?.invalidRows)&&!getYieldOptions().skipInvalidRows){$('yieldMessage').textContent='索引含有錯誤列，請修正來源；如要排除錯誤列，請明確啟用「略過錯誤列」。';return;}
 analyzeYieldFiles(selected.map(entryFile),{fileIds:selected.map(item=>item.id),sources:entrySources(selected),fromLibrary:true,period:range});
};
async function calculateTrend(preserveFilters=false){
 if($('weeklyTrendCalculate').disabled||!range||!selected.length||!beginFileOperation())return;
 const unit=$('weeklyTrendAxis').value;
 const {skipInvalidRows}=getYieldOptions(),toggle=$('yieldSkipErrors'),disabled=toggle.disabled;
 toggle.disabled=true;
 try{
  const sources=selected.map(item=>({id:item.id,...validMeta(item)}));
  await runWeeklyTrend(range,sources,entrySources(selected),{skipInvalidRows,unit,preserveFilters});
 }catch(error){$('weeklyTrendStatus').textContent=error.message;}
 finally{toggle.disabled=disabled;endFileOperation();}
}
$('weeklyTrendCalculate').onclick=()=>calculateTrend();
$('weeklyTrendAxis').onchange=()=>{
 if(!$('weeklyTrendResult').hidden)calculateTrend(true);
};
libraryEvents.addEventListener('change',()=>refresh());libraryReady.then(()=>refresh(true));
