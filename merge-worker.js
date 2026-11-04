const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version, 'merge-core.js'+version);

const MAX_OUTPUT_BYTES=100*1024*1024;
const TARGET_ESTIMATED_BYTES=24*1024*1024;
let acknowledgeOutput=null;

function waitForOutputSave(){
  return new Promise(resolve=>{acknowledgeOutput=resolve;});
}

function estimateRowBytes(value){
  return Math.max(256,JSON.stringify(value.row).length*3+128);
}

function partitionRows(rows){
  const ranges=[];
  let start=0,estimated=0;
  for(let i=0;i<rows.length;){
    const day=rows[i].day;
    let end=i+1,dayEstimate=estimateRowBytes(rows[i]);
    while(end<rows.length&&rows[end].day===day){dayEstimate+=estimateRowBytes(rows[end]);end++;}
    if(dayEstimate>TARGET_ESTIMATED_BYTES){
      if(start<i)ranges.push([start,i]);
      let subStart=i,subEstimate=0;
      for(let j=i;j<end;j++){
        const rowEstimate=estimateRowBytes(rows[j]);
        if(j>subStart&&subEstimate+rowEstimate>TARGET_ESTIMATED_BYTES){ranges.push([subStart,j]);subStart=j;subEstimate=0;}
        subEstimate+=rowEstimate;
      }
      if(subStart<end)ranges.push([subStart,end]);
      start=end;estimated=0;
    }else{
      if(i>start&&estimated+dayEstimate>TARGET_ESTIMATED_BYTES){ranges.push([start,i]);start=i;estimated=0;}
      estimated+=dayEstimate;
    }
    i=end;
  }
  if(start<rows.length)ranges.push([start,rows.length]);
  return ranges;
}

function arrayBufferOf(bytes){
  return bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}

function withPart(filename,part){
  const dot=filename.lastIndexOf('.');
  return filename.slice(0,dot)+`_part${String(part).padStart(2,'0')}`+filename.slice(dot);
}

async function mergeFiles(data){
  try{
    const files=Array.isArray(data)?data:data.files;
    if(!Array.isArray(files)||!files.length)throw new Error('請先勾選含 Detail 分頁的檔案。');
    if(files.some(file=>!file?.name?.toLowerCase().endsWith('.xlsx')||!file.size||typeof file.arrayBuffer!=='function'))throw new Error('請選擇有效的 .xlsx Detail 檔案。');
    const merger=new DetailMerger(XLSX,{skipInvalidRows:!Array.isArray(data)&&data.skipInvalidRows===true});
    for(let i=0;i<files.length;i++){
      self.postMessage({type:'progress',message:`正在讀取 ${i+1}/${files.length}：${files[i].name}`});
      const bytes=await files[i].arrayBuffer();
      merger.add(DetailMerger.readBook(XLSX,bytes),files[i].name);
    }
    const ordered=[...merger.rows.values()].sort((a,b)=>a.timestamp-b.timestamp);
    if(!ordered.length)throw new Error(merger.skippedRows.length?`已略過 ${merger.skippedRows.length} 列錯誤資料，Detail 沒有可分析的有效資料。`:'Detail 沒有可合併的資料。');
    const ranges=partitionRows(ordered),totalBytes=files.reduce((sum,file)=>sum+(file.size||0),0);
    let part=0,outputRows=0;
    async function writePart(rows,includeSkippedRows){
      self.postMessage({type:'progress',message:`正在產生分檔 ${part+1}，資料日期 ${rows[0].day} 至 ${rows[rows.length-1].day}…`});
      const {book,...stats}=merger.finish({selectedRows:rows,includeSkippedRows});
      const written=XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});
      const bytes=arrayBufferOf(written);
      if(bytes.byteLength>MAX_OUTPUT_BYTES){
        if(rows.length<2)throw new Error(`日期 ${rows[0].day} 的單筆資料已超過 100 MB，無法再拆分。`);
        let split=Math.floor(rows.length/2);
        const midpoint=rows[split].day;
        let boundary=split;
        while(boundary>0&&rows[boundary-1].day===midpoint)boundary--;
        if(boundary>0&&boundary<rows.length)split=boundary;
        await writePart(rows.slice(0,split),includeSkippedRows);
        await writePart(rows.slice(split),false);
        return;
      }
      part++;
      outputRows+=stats.output_rows;
      const filename=withPart(stats.filename,part);
      const saved=waitForOutputSave();
      self.postMessage({type:'file',file:{filename,bytes,start_date:stats.start_date,end_date:stats.end_date,output_rows:stats.output_rows,part,bytes_size:bytes.byteLength}},[bytes]);
      await saved;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    for(let i=0;i<ranges.length;i++){
      const [start,end]=ranges[i];
      await writePart(ordered.slice(start,end),i===0);
    }
    self.postMessage({type:'complete',input_files:files.length,input_bytes:totalBytes,output_files:part,output_rows:outputRows,start_date:ordered[0].day,end_date:ordered[ordered.length-1].day});
  }catch(error){
    self.postMessage({type:'error',message:error.message||'處理失敗，請確認檔案格式。'});
  }
}

self.onmessage=({data})=>{
  if(data?.type==='file-stored'){acknowledgeOutput?.();acknowledgeOutput=null;return;}
  if(data?.type==='merge')mergeFiles(data.payload);
  else if(data?.files||Array.isArray(data))mergeFiles(data);
};
