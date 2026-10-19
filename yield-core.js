(function(root){
'use strict';
const preferred=['DAF外觀','DAF熱壓投入','功能一測試','功能二測試','外觀檢查點亮測試','輝度機測試','正面AOI','背面AOI'];
function canonical(value){
 const name=String(value).trim().replace(/\s+/g,'');
 const aliases={'DAF外觀檢查':'DAF外觀','DAF熱壓入':'DAF熱壓投入','功能一測試':'功能一測試','功能一測':'功能一測試','功能一測試站':'功能一測試','功能二測':'功能二測試','功能二測試站':'功能二測試','外觀檢查點亮測試':'外觀檢查點亮測試','外觀檢查點亮':'外觀檢查點亮測試','輝度機測試':'輝度機測試','輝度機測':'輝度機測試'};
 return aliases[name]||name;
}
function buildYieldReport(merger,identities){
 const XLSX=merger.XLSX,counts=new Map(),products=new Map(),processes=new Set(preferred),pendingRows=[];
 if(merger.time!==5)throw Error('主檔 F 欄須為產出時間。');
 if(merger.header?.[9]!=='IC'||merger.header?.[10]!=='機種')throw Error('主檔 J 欄須為 IC、K 欄須為機種，請先完成比對。');
 for(const value of merger.rows.values()){
  const row=value.row,rawIC=String(row[9]??'').trim(),rawModel=String(row[10]??'').trim(),identity=identities?.get(String(row[4]).trim()),ic=identity?.ic||rawIC,model=identity?.model||rawModel;
  const incomplete=identity?identity.pending:!ic||!model;if(!rawIC||!rawModel)pendingRows.push(row);
  const product=identity?.id||JSON.stringify([ic,model]),process=canonical(row[0]),key=JSON.stringify([product,value.day,process]);
  products.set(product,{ic:ic||'【待補 IC】',model:model||'【待補機種】',incomplete});processes.add(process);
  const count=counts.get(key)||{product,ic,model,day:value.day,process,good:0,fail:0,units:new Map()};
  const serial=String(row[4]).trim();count.units.set(serial,Boolean(count.units.get(serial)||String(row[merger.status]).trim().toUpperCase()==='FAIL'));
  counts.set(key,count);
 }
 for(const count of counts.values()){count.fail=[...count.units.values()].filter(Boolean).length;count.good=count.units.size-count.fail;}
 const stageChecks=[];
 const merged=merger.finish(),dates=[];
 for(let time=Date.parse(merged.start_date+'T00:00:00Z');time<=Date.parse(merged.end_date+'T00:00:00Z');time+=86400000)dates.push(new Date(time).toISOString().slice(0,10));
 if(dates.length>16383)throw Error('日期範圍超過 Excel 欄數上限，請縮小主檔範圍。');
 const details=[['日期','IC','機種','製程','GOOD數量','FAIL數量','總數','良率']],indices=new Map();
 const entries=[...counts.entries()].sort((a,b)=>a[1].day.localeCompare(b[1].day)||a[1].ic.localeCompare(b[1].ic)||a[1].model.localeCompare(b[1].model)||a[1].process.localeCompare(b[1].process));
 for(const [key,c] of entries){indices.set(key,details.length+1);details.push([c.day,c.ic,c.model,c.process,c.good,c.fail,c.good+c.fail,c.good/(c.good+c.fail)]);}
 const detailSheet=XLSX.utils.aoa_to_sheet(details);
 for(let r=2;r<=details.length;r++)detailSheet['H'+r]={t:'n',v:details[r-1][7],f:`E${r}/(E${r}+F${r})`,z:'0.00%'};
 detailSheet['!cols']=[{wch:14},{wch:20},{wch:20},{wch:26},...Array.from({length:4},()=>({wch:16}))];
 const processRows=[],stageRows=[],processSheet={},stageSheet={};
 const order=[...preferred,...[...processes].filter(p=>!preferred.includes(p)).sort()];
 const productList=[...products.entries()].sort((a,b)=>a[1].model.localeCompare(b[1].model)||a[1].ic.localeCompare(b[1].ic));
 if(productList.length*(order.length+4)>1048576)throw Error('產品與製程超過 Excel 列數上限。');
 for(const [product,{ic,model}] of productList){
  processRows.push([model]);processRows.push([ic,...dates]);const start=processRows.length+1;
  for(const process of order){
   const r=processRows.length+1;processRows.push([process]);
   for(let c=0;c<dates.length;c++){
    const key=JSON.stringify([product,dates[c],process]),count=counts.get(key);
    if(count){const index=indices.get(key);processSheet[XLSX.utils.encode_cell({r:r-1,c:c+1})]={t:'n',v:count.good/(count.good+count.fail),f:`'計算明細'!H${index}`,z:'0.00%'};}
   }
  }
  processRows.push([]);
  stageRows.push([model]);stageRows.push([ic,...dates]);
  for(const [stage,offset,length] of [['SMT',6,1],['前段',0,3],['後段',3,3]]){
   const r=stageRows.length+1;stageRows.push([stage]);
   for(let c=0;c<dates.length;c++){
    const column=XLSX.utils.encode_col(c+1),from=start+offset,to=from+length-1;
    const values=order.slice(offset,offset+length).map(process=>counts.get(JSON.stringify([product,dates[c],process]))).filter(Boolean).map(v=>v.good/(v.good+v.fail));
    const formula=stage==='SMT'?`IF('每日製程良率'!${column}${from}="","",'每日製程良率'!${column}${from})`:`IFERROR(_xlfn.AGGREGATE(1,6,'每日製程良率'!${column}${from}:${column}${to}),"")`;
    if(values.length)stageChecks.push({product,ic,model,date:dates[c],stage,yield:values.reduce((a,b)=>a+b,0)/values.length,processes:order.slice(offset,offset+length)});
    stageSheet[XLSX.utils.encode_cell({r:r-1,c:c+1})]={t:values.length?'n':'s',v:values.length?values.reduce((a,b)=>a+b,0)/values.length:'',f:formula,z:'0.00%'};
   }
  }
  stageRows.push([]);
 }
 const finish=(rows,cells)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);Object.assign(sheet,cells);sheet['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:dates.length}});sheet['!cols']=[{wch:28},...dates.map(()=>({wch:16}))];return sheet;};
 const book=XLSX.utils.book_new();book.Custprops=merged.book.Custprops;
 XLSX.utils.book_append_sheet(book,finish(processRows,processSheet),'每日製程良率');
 XLSX.utils.book_append_sheet(book,finish(stageRows,stageSheet),'每日階段良率');
 XLSX.utils.book_append_sheet(book,detailSheet,'計算明細');
 XLSX.utils.book_append_sheet(book,merged.book.Sheets.Detail,'Detail');
 if(pendingRows.length){const pending=XLSX.utils.aoa_to_sheet([merger.header,...pendingRows]);for(let r=2;r<=pendingRows.length+1;r++)if(pending['F'+r])pending['F'+r].z='yyyy-mm-dd hh:mm:ss';XLSX.utils.book_append_sheet(book,pending,'待補產品資料');}
 book.Workbook={CalcPr:{calcMode:'auto',fullCalcOnLoad:true}};
 return {book,calculation:{stageChecks,dailyCounts:[...counts.values()].map(({units,...count})=>count)},filename:merged.filename.replace('.xlsx','_每日良率.xlsx'),product_count:[...products.values()].filter(p=>!p.incomplete).length,pending_product_count:[...products.values()].filter(p=>p.incomplete).length,missing_product_rows:pendingRows.length,date_count:dates.length,input_rows:merged.input_rows,output_rows:merged.output_rows,removed_rows:merged.removed_rows,start_date:merged.start_date,end_date:merged.end_date};
}
root.buildYieldReport=buildYieldReport;root.canonicalProcess=canonical;
})(typeof self!=='undefined'?self:globalThis);
