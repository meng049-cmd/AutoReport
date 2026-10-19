importScripts('browser-storage.js?v=2');
let runtime;
const get=async path=>{const r=await fetch(new URL(path,self.location.href));if(!r.ok)throw Error('無法載入瀏覽器資料庫工具。');return new Uint8Array(await r.arrayBuffer());};
async function initialize(){
 if(runtime)return runtime;
 importScripts('vendor/pyodide/pyodide.js');const py=await loadPyodide({indexURL:new URL('vendor/pyodide/',self.location.href).href});
 await py.loadPackage('sqlite3');py.FS.mkdirTree('/app/packages');py.FS.mkdirTree('/app/data');
 for(const name of ['openpyxl-3.1.5-py2.py3-none-any.whl','et_xmlfile-2.0.0-py3-none-any.whl','opencc_python_reimplemented-0.1.7-py2.py3-none-any.whl'])py.unpackArchive(await get('vendor/python/'+name),'zip',{extractDir:'/app/packages'});
 for(const name of ['autoreport.py','update_database.py'])py.FS.writeFile('/app/'+name,await get('browser-python/'+name));
 await py.runPythonAsync("import sys\nsys.path[:0]=['/app','/app/packages']\nimport autoreport, update_database");runtime=py;return runtime;
}
self.onmessage=({data:{id,type,file}})=>{if(!navigator.locks){self.postMessage({id,error:'請使用支援本地資料庫更新的最新版 Chrome／Edge。'});return;}navigator.locks.request('AutoReport-local-database',async()=>{try{
 let state=await readBrowserDatabase();
 if(type==='clear'){
  self.postMessage({id,progress:'正在清空本瀏覽器資料庫…'});
  const py=await initialize();const path='/app/data/cleared.sqlite3';
  if(py.FS.analyzePath(path).exists)py.FS.unlink(path);
  const stats=JSON.parse(await py.runPythonAsync("import json\nwith autoreport.connect('/app/data/cleared.sqlite3') as db:\n    db.commit()\n    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'\n    assert all(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0 for table in ('sources','sheets','records','lookup_keys','raw_rows','work_orders'))\n    stats=autoreport.stats(db)\njson.dumps(stats,ensure_ascii=False)"));
  const reference={stats,records:[],keys:[],uploaded_files:[],source_files:[],database_update:null,cleared_at:new Date().toISOString()};
  const database=py.FS.readFile(path).slice().buffer;
  await saveBrowserDatabase({version:1,database,reference});
  const stored=await readBrowserDatabase(),saved=stored?.database&&new Uint8Array(stored.database),expected=new Uint8Array(database);
  if(!saved||saved.length!==expected.length||!saved.every((byte,i)=>byte===expected[i])||stored.reference.records.length||stored.reference.keys.length||stored.reference.uploaded_files.length||stored.reference.source_files.length)throw Error('無法驗證資料庫已清空，請重新整理後確認。');
  py.FS.unlink(path);self.postMessage({id,result:{reference}});return;
 }
 if(type==='download'){const bytes=state?.database?new Uint8Array(state.database):await get('autoreport.sqlite3');self.postMessage({id,result:bytes.buffer},[bytes.buffer]);return;}
 if(!file||!/\.xlsx$/i.test(file.name)||!file.size||file.size>20*1024*1024)throw Error('請選擇一份 20 MB 以內的 .xlsx 原始對照檔。');
 self.postMessage({id,progress:'首次更新正在載入本地運算工具，請稍候…'});const py=await initialize();
 py.FS.writeFile('/app/data/active.sqlite3',state?.database?new Uint8Array(state.database):await get('autoreport.sqlite3'));
 const filename=file.name.split(/[\\/]/).at(-1);py.FS.writeFile('/app/'+filename,new Uint8Array(await file.arrayBuffer()));
 py.globals.set('upload_filename',filename);self.postMessage({id,progress:'正在檢查分頁、追加對照並跳過重複資料…'});
 const summary=JSON.parse(await py.runPythonAsync(`import json\nresult=update_database.append_excel('/app/data/active.sqlite3','/app/'+upload_filename)\njson.dumps(result,ensure_ascii=False)`));
 py.FS.unlink('/app/'+filename);
 if(summary.unchanged){self.postMessage({id,result:{summary,reference:state?.reference||null}});return;}
 const reference=JSON.parse(await py.runPythonAsync(`with autoreport.connect('/app/data/active.sqlite3') as db:\n    records=[]\n    for row in db.execute(autoreport.RECORD_SQL+' ORDER BY r.id'):\n        r=autoreport.present(row)\n        r['search_text']=row['search_text']\n        records.append(r)\n    data={'stats':autoreport.stats(db),'records':records,'keys':[list(r) for r in db.execute('SELECT kind,value,record_id FROM lookup_keys ORDER BY kind,value,record_id')]}\njson.dumps(data,ensure_ascii=False)`));
 const uploaded=[...(state?.reference?.uploaded_files||[]),{name:filename,size:file.size,imported_at:summary.updated_at}];
 reference.uploaded_files=uploaded;reference.source_files=[...new Set(reference.records.map(r=>r.source_file))].sort();reference.database_update=summary;
 const database=py.FS.readFile('/app/data/active.sqlite3').slice().buffer;await saveBrowserDatabase({version:1,database,reference});
 self.postMessage({id,result:{summary,reference}});
}catch(error){self.postMessage({id,error:(error.message||'資料庫更新失敗，既有資料未變更。').trim().split('\n').at(-1).replace(/^[\w.]+Error: /,'')});}}).catch(error=>self.postMessage({id,error:error.message}));};
