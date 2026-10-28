(function(root){
'use strict';
const preferred=['DAF外觀','DAF熱壓投入','功能一測試','功能二測試','外觀檢查點亮測試','輝度機測試'];
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
  if(!root.isAnalysisProcess(value.row[0]))continue;
  const row=value.row,rawIC=String(row[9]??'').trim(),rawModel=String(row[10]??'').trim(),identity=identities?.get(String(row[4]).trim()),ic=identity?.ic||rawIC,model=identity?.model||rawModel;
  const incomplete=identity?identity.pending:!ic||!model;if(!rawIC||!rawModel)pendingRows.push(row);
  const product=identity?.id||JSON.stringify([ic,model]),process=canonical(row[0]),key=JSON.stringify([product,value.day,process]);
  products.set(product,{ic:ic||'【待補 IC】',model:model||'【待補機種】',incomplete});processes.add(process);
  const count=counts.get(key)||{product,ic,model,day:value.day,process,good:0,fail:0,units:new Map()};
  const serial=String(row[4]).trim();count.units.set(serial,Boolean(count.units.get(serial)||merger.hasDefect(value)));
  counts.set(key,count);
 }
 for(const count of counts.values()){count.fail=[...count.units.values()].filter(Boolean).length;count.good=count.units.size-count.fail;}
 const stageComparisons=[['日期','IC','機種','階段','採用：AGGREGATE製程平均良率','唯一PPID良率（比較）','良率差異（平均減唯一，百分點）','唯一投入PPID','唯一不良PPID','唯一PPID不良率','有資料製程數']],stageChecks=[],stageDetails=[['日期','IC','機種','階段','唯一良品PPID','唯一不良PPID','唯一投入PPID','良率','不良率']];
 const merged=merger.finish({dense:true,analysisOnly:true}),dates=[];
 for(let time=Date.parse(merged.start_date+'T00:00:00Z');time<=Date.parse(merged.end_date+'T00:00:00Z');time+=86400000)dates.push(new Date(time).toISOString().slice(0,10));
 if(dates.length>16383)throw Error('日期範圍超過 Excel 欄數上限，請縮小主檔範圍。');
 const details=[['日期','IC','機種','製程','良品數量','不良數量','總數','良率','不良率']],indices=new Map();
 const entries=[...counts.entries()].sort((a,b)=>a[1].day.localeCompare(b[1].day)||a[1].ic.localeCompare(b[1].ic)||a[1].model.localeCompare(b[1].model)||a[1].process.localeCompare(b[1].process));
 for(const [key,c] of entries){indices.set(key,details.length+1);details.push([c.day,c.ic,c.model,c.process,c.good,c.fail,c.good+c.fail,c.good/(c.good+c.fail),c.fail/(c.good+c.fail)]);}
 const detailSheet=XLSX.utils.aoa_to_sheet(details);
 for(let r=2;r<=details.length;r++){detailSheet['H'+r]={t:'n',v:details[r-1][7],f:`E${r}/(E${r}+F${r})`,z:'0.00%'};detailSheet['I'+r]={t:'n',v:details[r-1][8],f:`F${r}/(E${r}+F${r})`,z:'0.00%'};}
 detailSheet['!cols']=[{wch:14},{wch:20},{wch:20},{wch:26},...Array.from({length:5},()=>({wch:16}))];
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
  for(const [stage,offset,length] of [['SMT',6,0],['前段',0,3],['後段',3,3]]){
   const r=stageRows.length+1;stageRows.push([stage]);
   for(let c=0;c<dates.length;c++){
    const selected=order.slice(offset,offset+length),units=new Map(),processStats=[];
    for(const process of selected){const cell=counts.get(JSON.stringify([product,dates[c],process]));if(cell){processStats.push({process,input:cell.units.size,good:cell.good,fail:cell.fail});for(const [serial,fail] of cell.units)units.set(serial,Boolean(units.get(serial)||fail));}}
    const input=units.size,fail=[...units.values()].filter(Boolean).length,good=input-fail;
    const average=processStats.length?processStats.reduce((sum,row)=>sum+row.good/row.input,0)/processStats.length:null;let formula='""';
    if(input){stageDetails.push([dates[c],ic,model,stage,good,fail,input,good/input,fail/input]);const column=XLSX.utils.encode_col(c+1),from=start+offset,to=from+length-1;formula=`IFERROR(_xlfn.AGGREGATE(1,6,'每日製程良率'!${column}${from}:${column}${to}),"")`;stageChecks.push({product,ic,model,date:dates[c],stage,input,good,fail,yield:average,uniqueYield:good/input,difference:average-good/input,processes:selected,processStats});stageComparisons.push([dates[c],ic,model,stage,average,good/input,(average-good/input)*100,input,fail,fail/input,processStats.length]);}
    stageSheet[XLSX.utils.encode_cell({r:r-1,c:c+1})]={t:input?'n':'s',v:input?average:'',f:formula,z:'0.00%'};
   }
  }
  stageRows.push([]);
 }
 for(const date of dates)for(const [stage,selected] of [['前段',preferred.slice(0,3)],['後段',preferred.slice(3,6)]]){
  const units=new Map(),processUnits=new Map();for(const cell of counts.values())if(cell.day===date&&selected.includes(cell.process)){const group=processUnits.get(cell.process)||new Map();for(const [serial,fail] of cell.units){units.set(serial,Boolean(units.get(serial)||fail));group.set(serial,Boolean(group.get(serial)||fail));}processUnits.set(cell.process,group);}
  const input=units.size,fail=[...units.values()].filter(Boolean).length,values=[...processUnits.values()].map(items=>[...items.values()].filter(fail=>!fail).length/items.size),average=values.length?values.reduce((s,v)=>s+v,0)/values.length:null,unique=input?(input-fail)/input:null;
  stageComparisons.push([date,'全部產品','全部機種',stage,average,unique,average==null?null:(average-unique)*100,input,fail,input?fail/input:null,values.length]);
 }
 const finish=(rows,cells)=>{if(!rows.length)rows=[['無納入分析的製程',...dates]];const sheet=XLSX.utils.aoa_to_sheet(rows);Object.assign(sheet,cells);sheet['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:dates.length}});sheet['!cols']=[{wch:28},...dates.map(()=>({wch:16}))];return sheet;};
 const book=XLSX.utils.book_new();book.Custprops=merged.book.Custprops;
 XLSX.utils.book_append_sheet(book,finish(processRows,processSheet),'每日製程良率');
 XLSX.utils.book_append_sheet(book,finish(stageRows,stageSheet),'每日階段良率');
 const stageDetailSheet=XLSX.utils.aoa_to_sheet(stageDetails);
 for(let r=2;r<=stageDetails.length;r++){stageDetailSheet['H'+r]={t:'n',v:stageDetails[r-1][7],f:`E${r}/G${r}`,z:'0.00%'};stageDetailSheet['I'+r]={t:'n',v:stageDetails[r-1][8],f:`F${r}/G${r}`,z:'0.00%'};}
 const comparisonSheet=XLSX.utils.aoa_to_sheet(stageComparisons);for(let r=2;r<=stageComparisons.length;r++){for(const col of ['E','F','J'])if(comparisonSheet[col+r])comparisonSheet[col+r].z='0.00%';comparisonSheet['G'+r]={t:stageComparisons[r-1][6]==null?'s':'n',v:stageComparisons[r-1][6]??'',f:`IF(OR(E${r}="",F${r}=""),"",(E${r}-F${r})*100)`,z:'0.0000'};}comparisonSheet['!cols']=stageComparisons[0].map(()=>({wch:25}));XLSX.utils.book_append_sheet(book,comparisonSheet,'階段良率比較');
 XLSX.utils.book_append_sheet(book,stageDetailSheet,'階段計算明細');
 XLSX.utils.book_append_sheet(book,detailSheet,'計算明細');
 const detailRows=[...merger.rows.values()].sort((a,b)=>a.timestamp-b.timestamp);for(let offset=0,part=1;offset<detailRows.length;offset+=1048575,part++){const sheet=XLSX.utils.aoa_to_sheet([merger.header,...detailRows.slice(offset,offset+1048575).map(value=>value.row)],{dense:true});for(let r=1;r<sheet.length;r++)if(sheet[r]?.[merger.time])sheet[r][merger.time].z='yyyy-mm-dd hh:mm:ss';XLSX.utils.book_append_sheet(book,sheet,part===1?'Detail':'Detail_'+part);}
 if(pendingRows.length){const pending=XLSX.utils.aoa_to_sheet([merger.header,...pendingRows]);for(let r=2;r<=pendingRows.length+1;r++)if(pending['F'+r])pending['F'+r].z='yyyy-mm-dd hh:mm:ss';XLSX.utils.book_append_sheet(book,pending,'待補產品資料');}
 book.Workbook={CalcPr:{calcMode:'auto',fullCalcOnLoad:true}};
 return {book,calculation:{stageChecks,dailyCounts:[...counts.values()].map(({units,...count})=>count)},filename:merged.filename.replace('.xlsx','_每日良率.xlsx'),product_count:[...products.values()].filter(p=>!p.incomplete).length,pending_product_count:[...products.values()].filter(p=>p.incomplete).length,missing_product_rows:pendingRows.length,date_count:dates.length,input_rows:merged.input_rows,output_rows:merged.output_rows,removed_rows:merged.removed_rows,start_date:merged.start_date,end_date:merged.end_date};
}
root.buildYieldReport=buildYieldReport;root.canonicalProcess=canonical;
})(typeof self!=='undefined'?self:globalThis);
