const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version,'vendor/jszip.min.js'+version,'merge-core.js'+version);

function attribute(tag,name){return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]||'';}
function decodeXml(value){return value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function worksheetPath(name,workbookXml,relsXml){
 const tag=workbookXml.match(/<sheet\b[^>]*>/g)?.find(item=>decodeXml(attribute(item,'name')).trim()===name.trim());
 const id=tag&&attribute(tag,'r:id');if(!id)throw Error(`${name} 分頁無法定位。`);
 const relation=relsXml.match(/<Relationship\b[^>]*>/g)?.find(item=>attribute(item,'Id')===id);
 const target=relation&&decodeXml(attribute(relation,'Target'));if(!target)throw Error(`${name} 分頁來源路徑無效。`);
 return target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
}
function rowTagNumber(tag){return Number(tag.match(/\br="(\d+)"/)?.[1]||0);}

async function inspect(file,includeBytes){
 const source=await file.arrayBuffer();
 const signature=new Uint8Array(source,0,Math.min(source.byteLength,4));
 if(signature[0]!==0x50||signature[1]!==0x4b)throw Error('檔案不是可讀取的 XLSX。');
 let book;
 try{book=XLSX.read(source,{type:'array',dense:true,cellDates:false,cellHTML:false,cellText:false});}
 catch{throw Error('XLSX 無法讀取，未變更此檔案。');}
 const names=book.SheetNames.filter(name=>/^detail(?:_\d+)?$/i.test(name.trim()));
 if(!names.some(name=>name.trim().toLowerCase()==='detail'))throw Error('找不到 Detail 分頁，未變更此檔案。');
 const plans=[];let keptRows=0,removedRows=0;
 for(const name of names){
  const sheet=book.Sheets[name],range=sheet?.['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;
  if(!range||range.s.r!==0)throw Error(`${name} 的欄名不在第 1 列，未變更此檔案。`);
  const header=sheet[0]||[];
  if(header[0]?.v!=='製程'||header[4]?.v!=='小板序號')throw Error(`${name} 欄位須為 A 製程、E 小板序號，未變更此檔案。`);
  const removed=[];let sheetLastRow=0,sheetMaxColumn=range.s.c;
  for(let column=range.s.c;column<=range.e.c;column++)if(header[column]?.v!=null&&header[column].v!=='')sheetMaxColumn=Math.max(sheetMaxColumn,column);
  for(let rowIndex=1;rowIndex<=range.e.r;rowIndex++){
   const row=sheet[rowIndex]||[],populated=row.some(cell=>cell&&cell.v!=null&&cell.v!=='');if(!populated)continue;
   if(!globalThis.isAnalysisProcess(row[0]?.v)){removed.push(rowIndex+1);removedRows++;continue;}
   if(row.some(cell=>cell?.f||cell?.F))throw Error(`${name} 第 ${rowIndex+1} 列含公式，為避免改變計算結果，未變更此檔案。`);
   keptRows++;sheetLastRow=rowIndex;for(let column=0;column<row.length;column++)if(row[column]?.v!=null&&row[column].v!=='')sheetMaxColumn=Math.max(sheetMaxColumn,column);
  }
  plans.push({name,removed,lastKeptRow:sheetLastRow,maxColumn:sheetMaxColumn});
 }
 const stats={name:file.name,beforeSize:file.size,keptRows,removedRows,afterSize:file.size};
 if(!removedRows)return {stats,bytes:null};
 const zip=await JSZip.loadAsync(source),workbookXml=await zip.file('xl/workbook.xml')?.async('string'),relsXml=await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
 if(!workbookXml||!relsXml)throw Error('活頁簿結構不完整，未變更此檔案。');
 for(const plan of plans){
  if(!plan.removed.length)continue;
  const path=worksheetPath(plan.name,workbookXml,relsXml),entry=zip.file(path);
  if(!entry)throw Error(`${plan.name} XML 缺失，未變更此檔案。`);
  let xml=await entry.async('string');const remove=new Set(plan.removed);
  xml=xml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,tag=>remove.has(rowTagNumber(tag))?'':tag);
  const dimension=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:plan.lastKeptRow,c:plan.maxColumn}});
  xml=xml.replace(/<dimension\b([^>]*\bref=")[^"]+("[^>]*\/?\s*>)/,`<dimension$1${dimension}$2`);
  zip.file(path,xml);
 }
 const bytes=await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE',compressionOptions:{level:6}});
 stats.afterSize=bytes.byteLength;
 return {stats,bytes:includeBytes?bytes:null};
}

self.onmessage=async({data:{id,file,mode}})=>{
 try{
  const result=await inspect(file,mode==='compact');
  self.postMessage({id,type:'complete',...result.stats,...(result.bytes?{bytes:result.bytes}:{})},result.bytes?[result.bytes]:[]);
 }catch(error){self.postMessage({id,type:'error',message:error.message||'檔案精簡失敗；此檔案未變更。'});}
};
