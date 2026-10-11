import ExcelJS from 'exceljs';
import {text,matchTables} from './matcher.mjs';
export const MAX_BYTES=20*1024*1024;
function csvRows(s){
  const rows=[];let row=[],value='',quoted=false;
  s=s.replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++;}else if(quoted||!value)quoted=!quoted;else value+=c;}
    else if(c===','&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){row.push(value);rows.push(row);row=[];value='';if(c==='\r'&&s[i+1]==='\n')i++;}
    else value+=c;
  }
  if(quoted)throw Error('CSV 引號未正確結束。');
  if(row.length||value){row.push(value);rows.push(row);}
  return rows;
}
function cellText(cell){
  const v=cell.value;
  if(v instanceof Date)return v.toISOString().replace(/\.000Z$/,'');
  if(v&&typeof v==='object'){
    if('formula' in v||'sharedFormula' in v)return text(v.result); // Cached result only.
    if(v.richText)return v.richText.map(t=>t.text).join('');
    if('text' in v)return text(v.text);
    if(v.error)return '';
  }
  return text(v);
}
export async function inputTables(bytes,filename){
  if(bytes.byteLength>MAX_BYTES)throw Error('檔案超過 20 MB。');
  if(/\.csv$/i.test(filename)){
    let decoded;
    for(const encoding of ['utf-8','big5','gb18030']){try{decoded=new TextDecoder(encoding,{fatal:true}).decode(bytes);break;}catch{}}
    if(decoded===undefined)throw Error('CSV 編碼無法辨識，請使用 UTF-8。');
    const rows=csvRows(decoded),width=rows.reduce((width,r)=>Math.max(width,r.length),0);
    if(width>512||rows.length>100000)throw Error('CSV 超過支援範圍（512 欄、100000 列）。');
    const raw=rows.map(r=>Array.from({length:width},(_,c)=>text(r[c])));
    return [{name:filename.replace(/\.csv$/i,''),raw,expanded:raw}];
  }
  if(!/\.xlsx$/i.test(filename))throw Error('請上傳 .xlsx 或 .csv 檔案。');
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes,{ignoreNodes:['dataValidations','conditionalFormatting','drawing','extLst']});
  return book.worksheets.map(sheet=>{
    let maxRow=0,maxCol=0;
    sheet.eachRow(row=>row.eachCell(cell=>{if(!cell.isMerged||cell.address===cell.master.address){if(cellText(cell)){maxRow=Math.max(maxRow,row.number);maxCol=Math.max(maxCol,cell.col);}}}));
    if(maxRow>100000||maxCol>512)throw Error('資料超過支援範圍（每頁 512 欄、100000 列）。');
    const raw=Array.from({length:maxRow},(_,r)=>Array.from({length:maxCol},(_,c)=>{const cell=sheet.getCell(r+1,c+1);return cell.isMerged&&cell.address!==cell.master.address?'':cellText(cell);}));
    const expanded=raw.map(row=>row.slice());
    for(const merge of sheet.model.merges||[]){const range=sheet.getCell(merge.split(':')[0]);const match=merge.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);if(!match)continue;
      const column=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
      const c1=column(match[1]),r1=+match[2],c2=column(match[3]),r2=+match[4];
      if(r1>maxRow||c1>maxCol)continue;
      for(let r=r1-1;r<Math.min(r2,maxRow);r++)for(let c=c1-1;c<Math.min(c2,maxCol);c++)if(!expanded[r][c])expanded[r][c]=cellText(range);
    }
    return {name:sheet.name,raw,expanded};
  });
}
export async function matchFile(matcher,bytes,filename){return matchTables(matcher,await inputTables(bytes,filename),filename);}
export async function exportMatches(result){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('比對結果');
  sheet.addRow(['來源分頁','來源列號','比對狀態','機種','IC','候選機種與IC','查找條件','資料庫來源','原始資料']);
  for(const r of result['結果'])sheet.addRow([r['分頁'],r['列號'],r['狀態'],r['機種'],r.IC,JSON.stringify(r['候選']),JSON.stringify(r['查找條件']),JSON.stringify(r['查找依據']),JSON.stringify(r['原始資料'])]);
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`I${sheet.rowCount}`};
  [25,12,22,22,18,55,45,45,55].forEach((width,i)=>sheet.getColumn(i+1).width=width);
  return book.xlsx.writeBuffer();
}
