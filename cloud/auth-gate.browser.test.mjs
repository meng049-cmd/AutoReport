import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

test('analysis stays unloaded until verified login; logout, expired auth and account changes relock it',async()=>{
 const root=path.resolve('dist');const server=createServer(async(req,res)=>{try{let name=new URL(req.url,'http://local').pathname;if(name==='/')name='/index.html';const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage();let confirmed=false,user='owner-a',denyHead=false,signupRedirect=false;const appRequests=[];
  page.on('request',request=>{if(/\/assets\/app\.js/.test(request.url()))appRequests.push(request.url());});
  await context.route('https://dtrusgylbpulpycjwhrt.supabase.co/**',route=>{
   const url=new URL(route.request().url()),profile={id:user,email:'login@example.test',...(confirmed?{email_confirmed_at:'2026-10-24T00:00:00Z'}:{})};
   if(url.pathname==='/auth/v1/signup'){signupRedirect=url.searchParams.has('redirect_to');return route.fulfill({json:{user:profile,session:null}});}
   if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:profile}});
   if(url.pathname==='/auth/v1/user')return route.fulfill({json:profile});
   if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
   if(url.pathname==='/rest/v1/autoreport_workspaces')return route.fulfill(denyHead?{status:401,json:{message:'expired'}}:{json:[]});
   return route.fulfill({status:404,json:{message:'not found'}});
  });
  const site=`http://127.0.0.1:${server.address().port}/`;await page.goto(site);await page.waitForSelector('.cloud-sync');
  assert.equal(await page.locator('#analysisApp').isHidden(),true);assert.equal(appRequests.length,0,'anonymous users must not load the analysis module');await page.evaluate(()=>import('/cloud/cloud-sync.mjs?verification-copy=1'));assert.equal(await page.locator('.cloud-sync').count(),1,'reimporting the versioned module must not create a second login panel');
  await page.locator('.cloud-login [name=email]').fill('login@example.test');await page.locator('.cloud-login [name=password]').fill('test-password');
  await page.locator('[data-action=signup]').click();await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('查看確認信'));assert.equal(signupRedirect,true);assert.equal(appRequests.length,0);
  async function login(){await page.locator('.cloud-login [name=password]').fill('test-password');await page.locator('.cloud-login button[type=submit]').click();}
  await login();await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('請先完成信箱驗證'));assert.equal(appRequests.length,0,'unconfirmed account must stay blocked');
  confirmed=true;await login();await page.waitForFunction(()=>!document.querySelector('#analysisApp').hidden);await page.waitForFunction(()=>!document.querySelector('#match').disabled);assert.equal(appRequests.length,1);
  denyHead=true;await page.locator('[data-action=head]').click();await page.waitForFunction(()=>document.querySelector('#analysisApp').hidden);assert.equal(await page.locator('.cloud-login').isVisible(),true,'HTTP 401 must lock analysis');
  denyHead=false;await login();await page.waitForFunction(()=>!document.querySelector('#analysisApp').hidden);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('AutoReport-file-library',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put({id:'local-a-file',name:'local-a.csv',blob:new Blob(['private-a'])});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
  const ownBackup=page.waitForEvent('download');await page.locator('[data-action=local-backup]').click();assert.match(await readFile(await(await ownBackup).path(),'utf8'),/local-a-file/,'only the owner can export its local files');
  await page.locator('[data-action=logout]').click();await page.waitForFunction(()=>document.querySelector('#analysisApp').hidden);assert.equal(await page.locator('.cloud-login').isVisible(),true);
  user='owner-b';await login();await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('另一個帳號'));assert.equal(await page.locator('#analysisApp').isHidden(),true);assert.equal(await page.locator('.cloud-actions').isHidden(),true,'different account must not upload previous local files');assert.equal(await page.locator('[data-action=logout]').isVisible(),true,'account switch can be cancelled without clearing data');
  page.on('dialog',dialog=>dialog.accept());let downloads=0;page.on('download',()=>downloads++);await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'切換帳號並清除本機副本'}).click()]);assert.equal(downloads,0,'switching must not export previous account files to the new account');await page.waitForFunction(()=>!document.querySelector('#analysisApp').hidden);const count=await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('AutoReport-file-library',1);request.onsuccess=()=>{const db=request.result,r=db.transaction('files').objectStore('files').count();r.onsuccess=()=>{db.close();resolve(r.result);};};}));assert.equal(count,0,'new account starts without previous account files');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
