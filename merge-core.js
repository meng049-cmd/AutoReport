(function (root) {
  'use strict';
  // A checksum prevents stale first-NG metadata from surviving manual Detail edits.
  function ngChecksum(rows) {let hash=2166136261;for(const row of rows)for(const ch of JSON.stringify(row.slice(0,11))){hash=Math.imul(hash^ch.charCodeAt(0),16777619);}return (hash>>>0).toString(16);}
  function ngRecord(row,value,statusColumn) {
    const status=String(row[statusColumn]??'').trim().toUpperCase(),defect=statusColumn===7?'':String(row[7]??'').trim();
    if(!defect)return null;
    return {serial:String(row[4]).trim(),process:String(row[0]).trim(),date:value.day,timestamp:value.timestamp,status,defect};
  }
  class DetailMerger {
    constructor(XLSX) { this.XLSX = XLSX; this.rows = new Map(); this.total = 0; this.firstNG = new Map(); this.defectKeys = new Set(); }
    add(book, filename) {
      const XLSX = this.XLSX;
      const names = book.SheetNames.filter(name => name.trim().toLowerCase() === 'detail');
      if (names.length !== 1) throw new Error(`${filename}：找不到唯一的 Detail 分頁。`);
      const data = XLSX.utils.sheet_to_json(book.Sheets[names[0]], {header: 1, defval: null, blankrows: false, raw: true});
      const header = data.shift();
      if (!header || header[0] !== '製程' || header[4] !== '小板序號') throw new Error(`${filename}：A 欄須為製程，E 欄須為小板序號。`);
      if (!this.header) {
        this.header = header;
        for (const title of ['產出時間', '狀態']) if (header.filter(value => value === title).length !== 1) throw new Error(`須包含唯一的「${title}」欄位。`);
        this.time = header.indexOf('產出時間'); this.status = header.indexOf('狀態');
      } else if (JSON.stringify(header) !== JSON.stringify(this.header)) throw new Error(`${filename}：Detail 欄位標題與順序不一致。`);
      const localNG=new Map(),localDefectKeys=new Set(),fileValues=[];
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const process = String(row[0] ?? '').trim(), serial = String(row[4] ?? '').trim();
        const status = String(row[this.status] ?? '').trim().toUpperCase();
        const timestamp = row[this.time];
        const date = typeof timestamp === 'number' && Number.isFinite(timestamp) ? XLSX.SSF.parse_date_code(timestamp, {date1904: Boolean(book.Workbook?.WBProps?.date1904)}) : null;
        if (!date || date.y < 1900 || !process || !serial || !['GOOD','FAIL'].includes(status)) throw new Error(`${filename} 第 ${i + 2} 列：日期、製程、小板序號或 GOOD／FAIL 狀態無效。`);
        const day = `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
        // Normalize Excel's optional 1904 date system into the default 1900 system.
        const normalized = timestamp + (book.Workbook?.WBProps?.date1904 ? 1462 : 0);
        row[this.time] = normalized;
        const key = JSON.stringify([day, process, serial]);
        const value={row,day,timestamp:normalized};fileValues.push(value);
        const ng=ngRecord(row,value,this.status),first=localNG.get(serial);
        if(ng){localDefectKeys.add(key);if(!first)localNG.set(serial,ng);}
        const old = this.rows.get(key);
        if (!old || (status === 'FAIL' && String(old.row[this.status]).trim().toUpperCase() !== 'FAIL')) this.rows.set(key, {row, day, timestamp: normalized});
        this.total++;
      }
      // Analysis keeps the first defect in input order, independently of the unchanged merge winner.
      let candidates=localNG,defectKeys=localDefectKeys;
      try {
        const validKeys=new Set(fileValues.map(v=>JSON.stringify([v.day,String(v.row[0]).trim(),String(v.row[4]).trim()])));
        const saved=JSON.parse(book.Custprops?.AutoReportFirstNG||'null');
        if(saved?.version===2&&saved.checksum===ngChecksum(fileValues.map(v=>v.row))&&Array.isArray(saved.records)&&Array.isArray(saved.defectKeys)){
          const keys=new Set(saved.defectKeys),serials=new Set(saved.records.map(r=>r?.serial));
          const valid=[...localDefectKeys].every(k=>keys.has(k))&&saved.defectKeys.every(k=>typeof k==='string'&&validKeys.has(k))&&serials.size===saved.records.length&&saved.records.every(r=>r&&typeof r.serial==='string'&&typeof r.process==='string'&&typeof r.defect==='string'&&r.defect.trim()&&['GOOD','FAIL'].includes(r.status)&&Number.isFinite(r.timestamp)&&typeof r.date==='string'&&keys.has(JSON.stringify([r.date,r.process,r.serial])))&&saved.defectKeys.every(k=>serials.has(JSON.parse(k)[2]));
          if(valid){candidates=new Map(saved.records.map(r=>[r.serial,r]));defectKeys=keys;}
        }
      } catch { /* Older or edited files are analyzed from their readable Detail rows. */ }
      for(const [serial,ng] of candidates)if(!this.firstNG.has(serial))this.firstNG.set(serial,ng);
      for(const key of defectKeys)this.defectKeys.add(key);
    }
    hasDefect(value) {return this.defectKeys.has(JSON.stringify([value.day,String(value.row[0]).trim(),String(value.row[4]).trim()]));}
    finish() {
      if (!this.rows.size) throw new Error('Detail 沒有可合併的資料。');
      if (this.rows.size > 1048575) throw new Error('合併結果超過 Excel 單一分頁的列數上限，請減少上傳檔案。');
      const XLSX = this.XLSX, rows = [...this.rows.values()].sort((a,b) => a.timestamp - b.timestamp);
      const first = rows[0].day, last = rows.at(-1).day;
      const date = new Date(`${first}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const year = date.getUTCFullYear();
      const week = Math.ceil((((date - Date.UTC(year,0,1)) / 86400000) + 1) / 7);
      const filename = `${year}_w${week}_${first.slice(5).replace('-','')}-${last.slice(5).replace('-','')}.xlsx`;
      const sheet = XLSX.utils.aoa_to_sheet([this.header, ...rows.map(value => value.row)]);
      for (let i = 1; i <= rows.length; i++) {
        const cell = sheet[XLSX.utils.encode_cell({r:i,c:this.time})];
        if (cell) cell.z = 'yyyy-mm-dd hh:mm:ss';
      }
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Detail');
      book.Custprops={AutoReportFirstNG:JSON.stringify({version:2,checksum:ngChecksum(rows.map(v=>v.row)),records:[...this.firstNG.values()],defectKeys:[...this.defectKeys]}).replace(/[^\x00-\x7f]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'))};
      return {book, filename, input_rows: this.total, output_rows: rows.length, removed_rows: this.total - rows.length, start_date: first, end_date: last};
    }
  }
  root.DetailMerger = DetailMerger;
  if (typeof module !== 'undefined') module.exports = DetailMerger;
})(typeof self !== 'undefined' ? self : globalThis);
