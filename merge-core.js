(function (root) {
  'use strict';
  // Preserve the original Detail cell; normalize only for validation and calculation.
  function normalizeDetailStatus(value) {const status=String(value??'').trim().toUpperCase();return status==='SCRAP'?'FAIL':status;}
  // A checksum prevents stale first-NG metadata from surviving manual Detail edits.
  function ngChecksum(rows) {let hash=2166136261;for(const row of rows)for(const ch of JSON.stringify(row.slice(0,11))){hash=Math.imul(hash^ch.charCodeAt(0),16777619);}return (hash>>>0).toString(16);}
  function ngRecord(row,value,statusColumn) {
    const status=normalizeDetailStatus(row[statusColumn]),defect=statusColumn===7?'':String(row[7]??'').trim();
    if(status!=='FAIL'&&!defect)return null;
    return {order:String(row[1]??'').trim(),serial:String(row[4]).trim(),process:String(row[0]).trim(),date:value.day,timestamp:value.timestamp,status,defect:defect||'【未填不良項目】'};
  }
  const isAnalysisProcess=value=>!['正面AOI','背面AOI'].includes(String(value??'').normalize('NFKC').replace(/\s+/g,'').toUpperCase());
  const preferNG=(next,previous)=>!previous||(next.status==='FAIL'&&previous.status!=='FAIL');
  class DetailMerger {
    constructor(XLSX,{skipInvalidRows=false}={}) { this.XLSX = XLSX; this.skipInvalidRows=skipInvalidRows;this.skippedRows=[];this.rows = new Map(); this.total = 0; this.firstNG = new Map(); this.analysisFirstNG = new Map(); this.defectKeys = new Set(); this.sources = new Set(); }
    static readBook(XLSX,bytes) {
      const names=XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames.filter(name=>/^detail(?:_\d+)?$/i.test(name.trim()));
      if(!names.some(name=>name.trim().toLowerCase()==='detail'))throw Error('找不到 Detail 分頁。');
      return XLSX.read(bytes,{type:'array',dense:true,sheets:names});
    }
    add(book, filename) {
      let sourceNames;try{const saved=JSON.parse(book.Custprops?.AutoReportSources||'null');if(Array.isArray(saved)&&saved.length&&saved.every(name=>typeof name==='string'&&name.trim()))sourceNames=saved;}catch{}
      for(const name of sourceNames||[filename])this.sources.add(name);
      const XLSX = this.XLSX;
      const names = book.SheetNames.filter(name => /^detail(?:_\d+)?$/i.test(name.trim()));
      if (!names.length) throw new Error(`${filename}：找不到唯一的 Detail 分頁。`);
      const data = [];for(const [part,name] of names.entries()){const values=XLSX.utils.sheet_to_json(book.Sheets[name], {header:1,defval:null,blankrows:true,raw:true});if(part&&JSON.stringify(values[0])!==JSON.stringify(data[0]))throw Error(`${filename}：Detail 分頁標題不一致。`);for(let i=part?1:0;i<values.length;i++)data.push(values[i]);}
      const header = data.shift();
      if (!header || header[0] !== '製程' || header[4] !== '小板序號') throw new Error(`${filename}：A 欄須為製程，E 欄須為小板序號。`);
      if (!this.header) {
        this.header = header;
        for (const title of ['產出時間', '狀態']) if (header.filter(value => value === title).length !== 1) throw new Error(`須包含唯一的「${title}」欄位。`);
        this.time = header.indexOf('產出時間'); this.status = header.indexOf('狀態');
      } else if (JSON.stringify(header) !== JSON.stringify(this.header)) throw new Error(`${filename}：Detail 欄位標題與順序不一致。`);
      const rowOffset=this.XLSX.utils.decode_range(book.Sheets[names[0]]['!ref']).s.r+2;
      const localNG=new Map(),localAnalysisNG=new Map(),localDefectKeys=new Set(),fileValues=[];
      try{const saved=JSON.parse(book.Custprops?.AutoReportSkippedRows||'null');if(Array.isArray(saved)&&saved.every(r=>r&&typeof r.filename==='string'&&Number.isInteger(r.row)&&typeof r.reason==='string'&&Array.isArray(r.values)))this.skippedRows.push(...saved);}catch{}
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if(row.every(value=>value==null||value===''))continue;
        const process = String(row[0] ?? '').trim(), serial = String(row[4] ?? '').trim();
        const status = normalizeDetailStatus(row[this.status]);
        const timestamp = row[this.time];
        const date = typeof timestamp === 'number' && Number.isFinite(timestamp) ? XLSX.SSF.parse_date_code(timestamp, {date1904: Boolean(book.Workbook?.WBProps?.date1904)}) : null;
        const invalid=[];if(!date||date.y<1900)invalid.push('產出時間無效');if(!process)invalid.push('製程空白');if(!serial)invalid.push('小板序號空白');if(!['GOOD','FAIL'].includes(status))invalid.push('狀態無效（須為 GOOD／FAIL／Scrap）');
        if(invalid.length){const reason=invalid.join('、');if(!this.skipInvalidRows)throw new Error(`${filename} 第 ${i + rowOffset} 列：${reason}。`);this.skippedRows.push({filename,row:i+rowOffset,reason,values:row.slice(0,11)});continue;}
        const day = `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
        // Normalize Excel's optional 1904 date system into the default 1900 system.
        const normalized = timestamp + (book.Workbook?.WBProps?.date1904 ? 1462 : 0);
        row[this.time] = normalized;
        const key = JSON.stringify([day, process, serial]);
        const value={row,day,timestamp:normalized,key};fileValues.push(value);
        const ng=ngRecord(row,value,this.status),first=localNG.get(serial);
        if(ng){localDefectKeys.add(key);if(preferNG(ng,first))localNG.set(serial,ng);if(isAnalysisProcess(process)&&preferNG(ng,localAnalysisNG.get(serial)))localAnalysisNG.set(serial,ng);}
        const old = this.rows.get(key);
        if (!old || (status === 'FAIL' && normalizeDetailStatus(old.row[this.status]) !== 'FAIL')) this.rows.set(key,value);
        this.total++;
      }
      // Analysis prefers the first FAIL; only PPIDs without FAIL use their first GOOD defect.
      let candidates=localNG,defectKeys=localDefectKeys;
      try {
        const validKeys=new Set(fileValues.map(v=>v.key));
        const saved=JSON.parse(book.Custprops?.AutoReportFirstNG||'null');
        if([2,3,4].includes(saved?.version)&&saved.checksum===ngChecksum(fileValues.map(v=>v.row))&&Array.isArray(saved.records)){
          if(saved.version===4){saved.records=saved.records.map(r=>({serial:r[0],process:r[1],date:r[2],timestamp:r[3],status:r[4],defect:r[5],order:r[6]||''}));saved.defectKeys=[...localDefectKeys,...saved.extraDefectKeys];}
          const keys=new Set(saved.defectKeys),serials=new Set(saved.records.map(r=>r?.serial));
          const valid=(saved.version===2||[...localDefectKeys].every(k=>keys.has(k)))&&saved.defectKeys.every(k=>typeof k==='string'&&validKeys.has(k))&&serials.size===saved.records.length&&saved.records.every(r=>r&&typeof r.serial==='string'&&typeof r.process==='string'&&typeof r.defect==='string'&&r.defect.trim()&&['GOOD','FAIL'].includes(r.status)&&Number.isFinite(r.timestamp)&&typeof r.date==='string'&&keys.has(JSON.stringify([r.date,r.process,r.serial])))&&saved.defectKeys.every(k=>serials.has(JSON.parse(k)[2]));
          if(valid){candidates=new Map(saved.records.map(r=>[r.serial,r]));for(const [serial,ng] of localNG)if(preferNG(ng,candidates.get(serial)))candidates.set(serial,ng);defectKeys=new Set([...keys,...localDefectKeys]);}
        }
      } catch { /* Older or edited files are analyzed from their readable Detail rows. */ }
      let analysisCandidates=new Map([...candidates].filter(([,ng])=>isAnalysisProcess(ng.process)));
      try{const saved=JSON.parse(book.Custprops?.AutoReportAnalysisNG||'null'),validKeys=new Set(fileValues.map(v=>v.key));
        if(saved?.version===1&&saved.checksum===ngChecksum(fileValues.map(v=>v.row))&&Array.isArray(saved.records)){
          const records=saved.records.map(r=>({serial:r[0],process:r[1],date:r[2],timestamp:r[3],status:r[4],defect:r[5],order:r[6]||''}));
          if(new Set(records.map(r=>r.serial)).size===records.length&&records.every(r=>typeof r.serial==='string'&&typeof r.process==='string'&&typeof r.defect==='string'&&typeof r.order==='string'&&r.defect.trim()&&isAnalysisProcess(r.process)&&['GOOD','FAIL'].includes(r.status)&&Number.isFinite(r.timestamp)&&validKeys.has(JSON.stringify([r.date,r.process,r.serial]))))analysisCandidates=new Map(records.map(r=>[r.serial,r]));
        }
      }catch{}
      for(const [serial,ng] of localAnalysisNG)if(preferNG(ng,analysisCandidates.get(serial)))analysisCandidates.set(serial,ng);
      const readableOrders=new Map(fileValues.map(v=>[v.key,String(v.row[1]??'').trim()]));
      for(const ng of analysisCandidates.values())if(!ng.order)ng.order=readableOrders.get(JSON.stringify([ng.date,ng.process,ng.serial]))||'';
      for(const [serial,ng] of analysisCandidates)if(preferNG(ng,this.analysisFirstNG.get(serial)))this.analysisFirstNG.set(serial,ng);
      for(const [serial,ng] of candidates)if(preferNG(ng,this.firstNG.get(serial)))this.firstNG.set(serial,ng);
      for(const key of defectKeys)this.defectKeys.add(key);
    }
    hasDefect(value) {return this.defectKeys.has(value.key||JSON.stringify([value.day,String(value.row[0]).trim(),String(value.row[4]).trim()]));}
    prepareIndexed(meta,period){
      const header=meta.header;
      if(this.header&&JSON.stringify(header)!==JSON.stringify(this.header))throw Error(`${meta.name}：Detail 欄位標題與順序不一致。`);
      if(!this.header){this.header=header;this.time=header.indexOf('產出時間');this.status=header.indexOf('狀態');}
      for(const name of meta.sources||[meta.name])this.sources.add(name);
      const inside=r=>!period||(r.date>=period.start_date&&r.date<=period.end_date);
      this.indexedEvidence=[new Map(),new Map()];
      for(const [records,target] of [[meta.firstNG,this.indexedEvidence[0]],[meta.analysisFirstNG,this.indexedEvidence[1]]])for(const r of records||[])if(inside(r))target.set(r.serial,{...r,indexedSequence:-Infinity});
      if(meta.skippedRows?.length){if(!this.skipInvalidRows){const r=meta.skippedRows[0];throw Error(`${r.filename} 第 ${r.row} 列：${r.reason}。`);}for(const r of meta.skippedRows)this.skippedRows.push(r);}
    }
    addIndexed(value){
      const status=normalizeDetailStatus(value.row[this.status]),serial=String(value.row[4]).trim(),old=this.rows.get(value.key);
      if(!old||(status==='FAIL'&&normalizeDetailStatus(old.row[this.status])!=='FAIL'))this.rows.set(value.key,{row:value.row,day:value.day,timestamp:value.timestamp,key:value.key});
      if(value.fail)this.defectKeys.add(value.key);
      const ng=ngRecord(value.row,value,this.status);
      if(ng){ng.indexedSequence=value.seq;for(const target of isAnalysisProcess(ng.process)?this.indexedEvidence:[this.indexedEvidence[0]]){const old=target.get(serial);if(preferNG(ng,old)||(old?.status===ng.status&&ng.indexedSequence<old.indexedSequence))target.set(serial,ng);}}
      this.total++;
    }
    completeIndexed(){for(const [local,target] of [[this.indexedEvidence[0],this.firstNG],[this.indexedEvidence[1],this.analysisFirstNG]])for(const [serial,ng] of local)if(preferNG(ng,target.get(serial)))target.set(serial,ng);this.indexedEvidence=null;}
    finish({dense=false,analysisOnly=false,selectedRows,includeSkippedRows=true,summaryOnly=false}={}) {
      if (!this.rows.size) throw new Error(this.skippedRows.length?`已略過 ${this.skippedRows.length} 列錯誤資料，Detail 沒有可分析的有效資料。`:'Detail 沒有可合併的資料。');
      if(!analysisOnly&&!selectedRows&&this.rows.size>1048575)throw Error('合併分檔超過 Excel 單一分頁列數上限。');
      if(summaryOnly){let first='9999',last='';for(const value of this.rows.values()){if(value.day<first)first=value.day;if(value.day>last)last=value.day;}const book=this.XLSX.utils.book_new();book.Custprops={};return {book,filename:`${first}-${last}.xlsx`,input_rows:this.total,output_rows:this.rows.size,removed_rows:this.total-this.rows.size,skipped_rows:this.skippedRows.length,start_date:first,end_date:last};}
      const XLSX = this.XLSX, rows = [...(selectedRows||this.rows.values())].sort((a,b) => a.timestamp - b.timestamp);
      if(!rows.length)throw new Error('此日期區間沒有可合併的 Detail 資料。');
      if (!analysisOnly && rows.length > 1048575) throw new Error('合併分檔超過 Excel 單一分頁列數上限，請稍後重試。');
      const rowKeys=new Set(rows.map(value=>value.key)),inside=record=>rowKeys.has(JSON.stringify([record.date,record.process,record.serial]));
      const firstNG=[...this.firstNG.values()].filter(inside),analysisFirstNG=[...this.analysisFirstNG.values()].filter(inside);
      const skippedRows=includeSkippedRows?this.skippedRows:[];
      const first = rows[0].day, last = rows.at(-1).day;
      // Same Sunday–Saturday reporting calendar as web/defect-analysis.mjs.
      const dayMs=86400000,date=new Date(`${first}T00:00:00Z`),weekStart=+date-date.getUTCDay()*dayMs;
      const yearStart=y=>{const jan11=Date.UTC(y,0,11);return jan11+((7-new Date(jan11).getUTCDay())%7)*dayMs;};
      let year=date.getUTCFullYear();if(weekStart<yearStart(year))year--;
      const week=Math.floor((weekStart-yearStart(year))/(7*dayMs))+1;
      const filename = `${year}_w${week}_${first}-${last}.xlsx`;
      const sheet = analysisOnly?null:XLSX.utils.aoa_to_sheet([this.header, ...rows.map(value => value.row)],{dense});
      for (let i = 1; sheet && i <= rows.length; i++) {
        const cell = Array.isArray(sheet)?sheet[i]?.[this.time]:sheet[XLSX.utils.encode_cell({r:i,c:this.time})];
        if (cell) cell.z = 'yyyy-mm-dd hh:mm:ss';
      }
      const book = XLSX.utils.book_new(); if(sheet)XLSX.utils.book_append_sheet(book, sheet, 'Detail');
      book.Custprops={AutoReportFirstNG:JSON.stringify({version:4,checksum:ngChecksum(rows.map(v=>v.row)),records:firstNG.map(r=>[r.serial,r.process,r.date,r.timestamp,r.status,r.defect,r.order||'']),extraDefectKeys:rows.filter(v=>this.hasDefect(v)&&!ngRecord(v.row,v,this.status)).map(v=>v.key)}).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'))};
      book.Custprops.AutoReportAnalysisNG=JSON.stringify({version:1,checksum:ngChecksum(rows.map(v=>v.row)),records:analysisFirstNG.map(r=>[r.serial,r.process,r.date,r.timestamp,r.status,r.defect,r.order||''])}).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
      book.Custprops.AutoReportSources=JSON.stringify([...this.sources]).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
      if(skippedRows.length)book.Custprops.AutoReportSkippedRows=JSON.stringify(skippedRows).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
      return {book, filename, input_rows: selectedRows?rows.length:this.total, output_rows: rows.length, removed_rows: selectedRows?0:this.total - rows.length, skipped_rows:skippedRows.length, start_date: first, end_date: last};
    }
  }
  root.DetailMerger = DetailMerger;root.isAnalysisProcess=isAnalysisProcess;root.normalizeDetailStatus=normalizeDetailStatus;
  if (typeof module !== 'undefined') module.exports = DetailMerger;
})(typeof self !== 'undefined' ? self : globalThis);
