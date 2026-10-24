// Explicit opt-in integration check against the deployed site and real Supabase.
// Use dedicated, email-confirmed test accounts; never production user accounts.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
const names=['AUTOREPORT_TEST_EMAIL','AUTOREPORT_TEST_PASSWORD','AUTOREPORT_TEST_EMAIL_B','AUTOREPORT_TEST_PASSWORD_B'];
if(names.some(name=>!process.env[name])){console.error('Missing secure test-account settings: '+names.filter(name=>!process.env[name]).join(', '));process.exit(2);}
for(const name of ['AUTOREPORT_TEST_EMAIL','AUTOREPORT_TEST_EMAIL_B']){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env[name])){console.error('Invalid email format in '+name+'; update its value in environment settings.');process.exit(2);}}
const site=(process.env.LIVE_SITE_URL||'https://meng049-cmd.github.io/AutoReport/').replace(/\/?$/,'/');
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox'],...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
async function login(page,email,password){
 await page.goto(site);await page.locator('.cloud-sync summary').click();
 await page.evaluate(({email,password})=>{const form=document.querySelector('.cloud-login');form.elements.email.value=email;form.elements.password.value=password;form.requestSubmit();},{email,password});
 try {await page.waitForFunction(()=>!document.querySelector('.cloud-actions').hidden,{},{timeout:30000});} catch {const state=await page.evaluate(()=>({status:document.querySelector('.cloud-status')?.textContent,valid:document.querySelector('.cloud-login')?.checkValidity(),emailValid:document.querySelector('.cloud-login [name=email]')?.validity.valid,passwordValid:document.querySelector('.cloud-login [name=password]')?.validity.valid}));throw Error('Login did not complete: '+JSON.stringify(state));}
 await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('雲端版本'),{},{timeout:30000});
}
async function remote(page,action,arg){return page.evaluate(async({action,arg,site})=>{
 const {CloudClient,capture,encode}=await import(new URL('cloud/cloud-sync.mjs',site).href),{default:config}=await import(new URL('cloud/cloud-config.js',site).href);
 const client=new CloudClient(config);await client.resume();
 if(action==='head')return client.head();
 if(action==='snapshot')return encode(await capture('autoreport'));
 if(action==='cloud-snapshot')return encode(await client.download());
 if(action==='stale'){client.revision=arg;try{await client.upload(await capture('autoreport'));return 'unexpected-success';}catch(error){return error.message;}}
 if(action==='foreign'){
  const response=await fetch(config.url+'/storage/v1/object/authenticated/autoreport-sync/'+arg,{headers:{apikey:config.publishableKey,Authorization:'Bearer '+await client.access()}});
  return {status:response.status,body:response.ok?await response.text():null};
 }
}, {action,arg,site});}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
 const contexts=await Promise.all([browser.newContext({acceptDownloads:true}),browser.newContext({acceptDownloads:true}),browser.newContext({acceptDownloads:true})]);
 const [first,second,other]=await Promise.all(contexts.map(context=>context.newPage()));
 for(const page of [first,second,other])page.on('dialog',dialog=>dialog.accept());
 await login(first,process.env.AUTOREPORT_TEST_EMAIL,process.env.AUTOREPORT_TEST_PASSWORD);
 await login(second,process.env.AUTOREPORT_TEST_EMAIL,process.env.AUTOREPORT_TEST_PASSWORD);
 const resume=process.env.AUTOREPORT_RESUME_ACCOUNT_A==='1';let before,head;
 if(!resume)assert.equal((await remote(first,'head')).revision,0,'Use new dedicated test accounts with no cloud backups.');
 console.log('PASS: account A logs in on two independent device sessions.');
 if(!resume){
 const book=new ExcelJS.Workbook();for(const name of ['工單（A16）','CY26','工單（CY24&25）','重工工單1','NPI'])book.addWorksheet(name).addRows([['機種','IC','料號','工單'],['CloudSyncTestModel','Goodix','CLOUD-TEST-PART','CLOUDSYNC123']]);
 await first.evaluate(()=>{location.hash='#/database';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await first.locator('#databaseFile').setInputFiles({name:'cloud-sync-synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
 await first.locator('#databaseUpload').click();await first.waitForFunction(()=>document.querySelector('#databaseStatus').textContent.includes('已儲存在本瀏覽器'),{},{timeout:120000});
 await first.evaluate(()=>{location.hash='#matching';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await first.locator('#file').setInputFiles({name:'cloud-query.csv',mimeType:'text/csv',buffer:Buffer.from('工單號碼\nCLOUDSYNC123\n')});await first.locator('#match').click();await first.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('完成'),{},{timeout:60000});
 before=await remote(first,'snapshot');
 await first.locator('[data-action=upload]').click();await first.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('上傳完成'),{},{timeout:60000});
 head=await remote(first,'head');assert.equal(head.revision,1);
 console.log('PASS: real Excel import, CSV matching, private Supabase snapshot upload.');
 }else{head=await remote(first,'head');assert.ok(head.revision>=1);before=await remote(first,'cloud-snapshot');console.log('RESUME: validating existing dedicated test backup without uploading or overwriting it.');}
 if(resume){assert.match(await remote(second,'stale',head.revision-1),/另一台裝置已更新/);}else{
 await second.locator('[data-action=upload]').click();await second.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('另一台裝置已更新'),{},{timeout:60000});assert.equal((await remote(first,'head')).revision,1);}
 assert.equal((await remote(first,'head')).revision,head.revision);
 console.log('PASS: stale device upload rejected without replacing cloud version.');
 const backup=second.waitForEvent('download');await second.locator('[data-action=restore]').click();await backup;await second.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('資料已還原'),{},{timeout:60000});
 assert.equal(hash(await remote(second,'snapshot')),hash(before),'Restored SQLite, file bytes and metadata must match the original snapshot.');await second.reload();
 await second.evaluate(()=>{location.hash='#matching';window.dispatchEvent(new HashChangeEvent('hashchange'));});await second.locator('#query').fill(resume?'CLOUD-TEST-PART':'CLOUDSYNC123');await second.locator('#lookup').click();await second.locator('#searchResults').getByText('唯一匹配').waitFor();
 await second.locator('#file').setInputFiles({name:'restored-check.csv',mimeType:'text/csv',buffer:Buffer.from('產品料號\nCLOUD-TEST-PART\n')});await second.locator('#match').click();await second.waitForFunction(()=>document.querySelector('#message').textContent.includes('唯一匹配 1 筆'),{},{timeout:60000});
 console.log('PASS: second device restores identical SQLite/files, queries the imported part and uniquely matches a fresh CSV.');
 if(process.env.AUTOREPORT_SKIP_ACCOUNT_B==='1'){console.log('NOT RUN: account B isolation requires corrected test credentials.');process.exitCode=2;} else {
 await login(other,process.env.AUTOREPORT_TEST_EMAIL_B,process.env.AUTOREPORT_TEST_PASSWORD_B);
 assert.equal((await remote(other,'head')).revision,0);const denied=await remote(other,'foreign',head.object_path);assert.ok(denied.status>=400,'Other account must not download the snapshot.');assert.equal(denied.body,null);
 console.log('PASS: account B cannot list account A workspace or download account A private snapshot.');
 }
 await first.locator('[data-action=logout]').click();await first.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('已登出'));
 console.log('PASS: logout. Synthetic test backup retained in dedicated test account; no user data touched.');
} catch(error){console.error('LIVE CHECK FAILED: '+error.message);process.exitCode=1;} finally{await browser.close();}
