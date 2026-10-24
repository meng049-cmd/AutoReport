import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

test('browser login UI and independent-device snapshots preserve SQLite, file bytes and research notes',async()=>{
 const root=path.resolve('dist'), server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const first=await browser.newContext(),second=await browser.newContext();
  for(const context of [first,second]){
   await context.route('**/cloud/cloud-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export default {url:"https://test.supabase.co",publishableKey:"public",app:"autoreport"};'}));
   await context.route('https://test.supabase.co/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-a',email:'test@example.com'}}});if(url.pathname==='/rest/v1/autoreport_workspaces')return route.fulfill({json:[]});return route.fulfill({status:401,json:{message:'denied'}});});
  }
  const a=await first.newPage(),b=await second.newPage(),site=`http://127.0.0.1:${server.address().port}`;
  const smoke=await first.newPage(); await smoke.goto(site+'/index.html'); await smoke.waitForSelector('.cloud-sync summary'); assert.equal(await smoke.locator('.cloud-sync').count(),1,'production build mounts the login UI'); await smoke.close();
  // Isolate persistence tests from the application workers.
  for(const page of [a,b]){await page.goto(site+'/cloud/cloud-config.js');await page.evaluate(async()=>{document.body.innerHTML='<main></main>';await import('/cloud/cloud-sync.mjs');});}
  await a.locator('.cloud-sync summary').click();await a.locator('input[name=email]').fill('test@example.com');await a.locator('input[name=password]').fill('password123');await a.locator('.cloud-login button[type=submit]').click();await a.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('已登入 test@example.com'));
  const packed=await a.evaluate(async()=>{
   const m=await import('/cloud/cloud-sync.mjs');let snapshot=await m.capture('autoreport');snapshot.databases['AutoReport-local-database'].state={keys:['active'],values:[{version:1,database:new Uint8Array([83,81,76,105,116,101]).buffer,reference:{orders:['TEST']}}]};snapshot.databases['AutoReport-file-library'].files={keys:['one'],values:[{id:'one',name:'工單.xlsx',blob:new File([new Uint8Array([0,255,2])],'工單.xlsx',{type:'application/test',lastModified:5})}]};await m.restore(snapshot,'autoreport');return await m.encode(await m.capture('autoreport'));
  });
  const result=await b.evaluate(async packed=>{const m=await import('/cloud/cloud-sync.mjs');await m.restore(m.decode(packed),'autoreport');const copy=await m.capture('autoreport');return {database:[...new Uint8Array(copy.databases['AutoReport-local-database'].state.values[0].database)],file:[...new Uint8Array(await copy.databases['AutoReport-file-library'].files.values[0].blob.arrayBuffer())],name:copy.databases['AutoReport-file-library'].files.values[0].blob.name};},packed);
  assert.deepEqual(result,{database:[83,81,76,105,116,101],file:[0,255,2],name:'工單.xlsx'});
  await b.evaluate(async()=>{const m=await import('/cloud/cloud-sync.mjs');const snapshot=await m.capture('twstocksearch');snapshot.databases['TWStockSearch-research'].workspace={keys:['main'],values:[{notes:{'2330':'保留研究筆記'},rules:[{enabled:true}]}]};snapshot.local={'twstocksearch-theme':'light','turning-note-2330':'研究'};await m.restore(snapshot,'twstocksearch');const before=await m.capture('twstocksearch');try{await m.restore({...before,local:{'cloud-session:bad':'injected'}},'twstocksearch');throw Error('unexpected success');}catch(error){if(error.message==='unexpected success')throw error;}const after=await m.capture('twstocksearch');if(JSON.stringify(before)!==JSON.stringify(after))throw Error('invalid restore changed local data');});
  assert.equal(await b.evaluate(()=>sessionStorage.length),0,'other device does not inherit login');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
