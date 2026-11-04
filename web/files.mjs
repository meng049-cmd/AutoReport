import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import XLSX from '../vendor/xlsx.full.min.js';
import '../merge-core.js';
import {MAX_BYTES,MAX_ROWS,MAX_COLUMNS} from './limits.mjs';
export {MAX_BYTES} from './limits.mjs';
import {text,role,matchTables} from './matcher.mjs';

function csvRows(s){
  const rows=[];let row=[],value='',quoted=false,column=0;
  const pushCell=()=>{if(value)row[column]=value;column++;value='';};
  s=s.replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++;}else if(quoted||!value)quoted=!quoted;else value+=c;}
    else if(c===','&&!quoted){pushCell();}
    else if((c==='\n'||c==='\r')&&!quoted){pushCell();rows.push(row);row=[];column=0;if(c==='\r'&&s[i+1]==='\n')i++;}
    else value+=c;
  }
  if(quoted)throw Error('CSV 引號未正確結束。');
  if(column||value){pushCell();rows.push(row);}
  return rows;
}
export async function inputTables(bytes,filename,{analysisOnly=false}={}){
  if(!analysisOnly&&bytes.byteLength>MAX_BYTES)throw Error('檔案超過 100 MB。');
  if(/\.csv$/i.test(filename)){
    let decoded;
    for(const encoding of ['utf-8','big5','gb18030']){try{decoded=new TextDecoder(encoding,{fatal:true}).decode(bytes);break;}catch{}}
    if(decoded===undefined)throw Error('CSV 編碼無法辨識，請使用 UTF-8。');
    const rows=csvRows(decoded),width=rows.reduce((width,r)=>Math.max(width,r.length),0);
    if(width>MAX_COLUMNS||rows.length>MAX_ROWS)throw Error('CSV 超過 Excel 工作表上限（16384 欄、1048576 列），請拆分檔案。');
    const raw=rows.map(row=>row.map(text));
    return [{name:filename.replace(/\.csv$/i,''),raw,expanded:raw}];
  }
  if(!/\.xlsx$/i.test(filename))throw Error('請上傳 .xlsx 或 .csv 檔案。');
  const signature=new Uint8Array(bytes.buffer||bytes,bytes.byteOffset||0,Math.min(bytes.byteLength,8));
  if(signature[0]!==0x50||signature[1]!==0x4b||signature[2]!==0x03||signature[3]!==0x04){
    throw Error('檔案內容不是可讀的標準 XLSX。可能是加密、損毀或副檔名與格式不符；請在可正常開啟的 Excel 中重新另存為未加密的 .xlsx，再上傳。');
  }
  let book;
  try{const names=XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames;book=XLSX.read(bytes,{type:'array',dense:true,sheets:names.includes('Detail')?['Detail']:names,cellDates:!analysisOnly,cellHTML:false,cellText:false});}
  catch{throw Error('無法讀取 XLSX 內容，檔案可能不完整或損毀。請在 Excel 中重新另存為 .xlsx，再上傳。');}
  return book.SheetNames.filter(name=>book.Sheets[name]).map(name=>{
    const sheet=book.Sheets[name],raw=[],nativeRows=new Map(),existingMatchRows=new Set();let excludedRows=0;
    // Keep only populated cells; a far-right cell never expands every row into a rectangle.
    sheet.forEach((row,r)=>{if(analysisOnly&&name==='Detail'&&r>0&&!globalThis.isAnalysisProcess(row?.[0]?.v)){if(row?.some(cell=>cell?.v!=null&&cell.v!==''))excludedRows++;return;}if(analysisOnly&&name==='Detail'&&row.slice(9,11).some(cell=>cell?.v!=null&&cell.v!==''))existingMatchRows.add(r);const values=[];row.forEach((cell,c)=>{if(analysisOnly&&name==='Detail'&&c>8)return;const value=cell?.t==='e'?'':cell?.v instanceof Date?cell.v.toISOString().replace(/\.000Z$/,''):text(cell?.v);if(value){if(r>=MAX_ROWS||c>=MAX_COLUMNS)throw Error('資料超過 Excel 工作表上限（16384 欄、1048576 列），請拆分檔案。');values[c]=value;}});if(values.some(Boolean)){raw[r]=values;if(analysisOnly&&name==='Detail'){const native=Array.from({length:9},(_,c)=>row[c]?.t==='e'?null:row[c]?.v??null);if(typeof native[5]==='number'&&book.Workbook?.WBProps?.date1904)native[5]+=1462;nativeRows.set(r,native);}}});
    const expanded=raw.map(row=>row.slice()),columns=new Set(name==='Detail'?[1,2]:[]);
    for(let r=0;r<Math.min(raw.length,50);r++)(raw[r]||[]).forEach((value,c)=>{if(role(value))columns.add(c);});
    for(const merge of sheet['!merges']||[]){const value=raw[merge.s.r]?.[merge.s.c];if(!value)continue;const relevant=[...columns].filter(c=>c>=merge.s.c&&c<=merge.e.c);if(!relevant.length)continue;
      raw.forEach((row,r)=>{if(r<merge.s.r||r>merge.e.r)return;for(const c of relevant){if(row[c]==null)row[c]='';if(!expanded[r][c])expanded[r][c]=value;}});
    }
    return {name,raw,expanded,nativeRows,existingMatchRows,excludedRows};
  });
}

export async function matchFile(matcher,bytes,filename,{analysisOnly=false}={}){
  const tables=await inputTables(bytes,filename,{analysisOnly});
  const detail=tables.find(t=>t.name==='Detail');
  if(!detail)return matchTables(matcher,tables,filename);
  if(analysisOnly&&(detail.raw[0]?.[0]!=='製程'||detail.raw[0]?.[4]!=='小板序號'||detail.raw[0]?.[5]!=='產出時間'||detail.raw[0]?.[8]!=='狀態'))throw Error('Detail 欄位須為 A製程、E小板序號、F產出時間、I狀態，請確認原始檔欄位。');
  const results=[],lookups=new Map();
  for(let i=1;i<detail.raw.length;i++){
    const row=detail.raw[i]||[];if(!row.slice(0,9).some(Boolean))continue;
    if(row.slice(9,11).some(Boolean)||detail.existingMatchRows?.has(i))throw Error(`Detail 第 ${i+1} 列 J/K 已有資料，請先確認，避免覆蓋。`);
    const criteria=[['order',detail.expanded[i][1]],['part',detail.expanded[i][2]]].filter(([,v])=>v);
    const key=JSON.stringify(criteria);if(!lookups.has(key))lookups.set(key,matcher.lookup(criteria));const match=lookups.get(key),unique=match['狀態']==='唯一匹配'?match['候選'][0]:{};
    const original=detail.nativeRows.get(i);if(original){original[0]=globalThis.canonicalAnalysisProcess(original[0]);for(const c of [1,2])if(original[c]==null||original[c]==='')original[c]=detail.expanded[i][c]||null;}
    results.push({...(original?{compactValues:original}:{}),'分頁':'Detail','列號':i+1,'原始資料':row.slice(0,9),'機種':unique['機種']||'',IC:unique.IC||'',...match});
  }
  return {'檔名':filename,'筆數':results.length,'提示':[analysisOnly?'只保留六個分析製程與 A–K 必要欄位，原始檔完整保留於 Raw Data 檔案庫。':'僅比對 Detail 的 B（工單）／C（料號）；下載保留原檔，J 為 IC、K 為機種。未唯一匹配的 J/K 留白。'],'結果':results,...(analysisOnly?{compactDetail:true,excludedRows:detail.excludedRows}:{detailBytes:bytes})};
}
function exportAnalysisDetail(result){const rows=[['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種']];for(const r of result['結果'])rows.push([...r.compactValues,r.IC||'',r['機種']||'']);const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows,{dense:true});for(let i=1;i<rows.length;i++)if(sheet[i]?.[5])sheet[i][5].z='yyyy-mm-dd hh:mm:ss';XLSX.utils.book_append_sheet(book,sheet,'Detail');book.Custprops={AutoReportSources:JSON.stringify([result['檔名']]).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0')),AutoReportDetailPolicy:'six-processes-v1'};return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}));}
export async function exportMatches(result){
  if(result.compactDetail)return exportAnalysisDetail(result);
  if(result.detailBytes)return exportDetail(result);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('比對結果');
  sheet.addRow(['來源分頁','來源列號','比對狀態','機種','IC','候選機種與IC','查找條件','資料庫來源','原始資料']);
  for(const r of result['結果'])sheet.addRow([r['分頁'],r['列號'],r['狀態'],r['機種'],r.IC,JSON.stringify(r['候選']),JSON.stringify(r['查找條件']),JSON.stringify(r['查找依據']),JSON.stringify(r['原始資料'])]);
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`I${sheet.rowCount}`};
  [25,12,22,22,18,55,45,45,55].forEach((width,i)=>sheet.getColumn(i+1).width=width);
  return book.xlsx.writeBuffer();
}

// Patch only Detail worksheet XML; all other workbook entries and A–I cells stay intact.
async function exportDetail(result){
  const zip=await JSZip.loadAsync(result.detailBytes);
  const workbook=await zip.file('xl/workbook.xml').async('string');
  const tag=workbook.match(/<sheet\b[^>]*\bname="Detail"[^>]*\/?\s*>/)?.[0];
  const id=tag?.match(/\br:id="([^"]+)"/)?.[1];
  const rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel=rels.match(/<Relationship\b[^>]*>/g)?.find(t=>t.match(/\bId="([^"]+)"/)?.[1]===id);
  const target=rel?.match(/\bTarget="([^"]+)"/)?.[1];
  if(!target)throw Error('無法定位 Detail 分頁。');
  const file=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
  let xml=await zip.file(file).async('string');
  const values=new Map([[1,['IC','機種']]]);
  let lastRow=1;
  for(const row of result['結果']){
    values.set(row['列號'],[row.IC,row['機種']]);
    lastRow=Math.max(lastRow,row['列號']);
  }
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  xml=xml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,(original,attrs,body='')=>{
    const n=Number(attrs.match(/\br="(\d+)"/)?.[1]);if(!values.has(n))return original;
    const cells=values.get(n).map((v,i)=>`<c r="${i===0?'J':'K'}${n}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('');
    body=body.replace(/<c\b[^>]*\br="[JK]\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,'');
    const after=body.search(/<c\b[^>]*\br="(?:[L-Z]|[A-Z]{2,})\d+"/);
    body=after<0?body+cells:body.slice(0,after)+cells+body.slice(after);
    return `<row${attrs}>${body}</row>`;
  });
  xml=xml.replace(/<dimension\b[^>]*\bref="([^"]+)"[^>]*\/>/,(original,ref)=>{
    const end=ref.split(':').at(-1).match(/^([A-Z]+)(\d+)$/);
    if(!end)return original;
    const col=[...end[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
    if(col>=11)return original;
    return original.replace(`ref="${ref}"`,`ref="${ref.includes(':')?ref.split(':')[0]:'A1'}:K${Math.max(Number(end[2]),lastRow)}"`);
  });
  zip.file(file,xml);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
