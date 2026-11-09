(function(root){
'use strict';
// Keep every export row, spreading large tables over valid Excel worksheets.
function splitReportSheets(XLSX,book,maxRows=1048576){
 const original=book.SheetNames.slice(),hidden=new Map((book.Workbook?.Sheets||[]).map(s=>[s.name,s.Hidden]));
 const oversized=original.filter(name=>XLSX.utils.decode_range(book.Sheets[name]['!ref']||'A1').e.r>=maxRows);
 if(!oversized.length)return;
 // Cached results remain correct after partitioning; references to old row addresses do not.
 for(const name of original){const sheet=book.Sheets[name];if(Array.isArray(sheet)){for(const row of sheet)for(const cell of row||[])if(cell?.f)delete cell.f;}else for(const [key,cell] of Object.entries(sheet))if(!key.startsWith('!')&&cell?.f)delete cell.f;}
 for(const name of oversized){
  const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']),names=[],parts=Math.ceil(range.e.r/(maxRows-1));
  for(let part=0;part<parts;part++){let title=part?name.slice(0,24)+'_'+(part+1):name;while(part&&book.Sheets[title])title+='x';const out=Array.isArray(sheet)?[]:{},start=part*(maxRows-1)+1,end=Math.min(range.e.r,start+maxRows-2);
   const copy=(src,dst)=>{if(Array.isArray(sheet)){out[dst]=sheet[src]||[];return;}for(let c=range.s.c;c<=range.e.c;c++){const cell=sheet[XLSX.utils.encode_cell({r:src,c})];if(cell)out[XLSX.utils.encode_cell({r:dst,c})]=cell;}};
   copy(0,0);for(let row=start;row<=end;row++)copy(row,row-start+1);out['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:end-start+1,c:range.e.c}});if(sheet['!cols'])out['!cols']=sheet['!cols'];book.Sheets[title]=out;names.push(title);hidden.set(title,hidden.get(name)||0);
  }
  book.SheetNames.splice(book.SheetNames.indexOf(name),1,...names);
 }
 book.Workbook={...book.Workbook,Sheets:book.SheetNames.map(name=>({name,Hidden:hidden.get(name)||0}))};
}
root.splitReportSheets=splitReportSheets;
})(typeof self!=='undefined'?self:globalThis);
