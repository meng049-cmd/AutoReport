import test from 'node:test';
import assert from 'node:assert/strict';
import {encode, decode, validateSnapshot, CloudClient} from './cloud-sync.mjs';
const empty = () => ({format:1, app:'autoreport', databases:{'AutoReport-local-database':{state:{keys:[],values:[]}},'AutoReport-file-library':{files:{keys:[],values:[]}}},local:{}});
test('snapshot preserves file bytes, views, dates, undefined and arbitrary object keys', async () => {
 const value={file:new File([new Uint8Array([0,255,128])],'工單.xlsx',{type:'application/x-test',lastModified:123}),view:new Uint16Array([1,60000]),buffer:new Uint8Array([9,8]).buffer,date:new Date('2026-10-24T00:00:00Z'),missing:undefined,array:[null,true,3],object:JSON.parse('{"__proto__":{"polluted":true},"binary":"user text"}')};
 const result=decode(JSON.parse(JSON.stringify(await encode(value))));
 assert.deepEqual([...new Uint8Array(await result.file.arrayBuffer())],[0,255,128]);assert.equal(result.file.name,'工單.xlsx');assert.equal(result.file.lastModified,123);assert.deepEqual([...result.view],[1,60000]);assert.deepEqual([...new Uint8Array(result.buffer)],[9,8]);assert.deepEqual(result.date,value.date);assert.ok(Object.hasOwn(result,'missing'));assert.equal({}.polluted,undefined);assert.ok(Object.hasOwn(result.object,'__proto__'));
});
test('reject malformed or foreign snapshots before any local restore', () => {
 assert.throws(()=>decode(['binary','AA==',null,null,null,'Function']));assert.throws(()=>decode(['object',[[0,['scalar','x']]]]));
 assert.throws(()=>validateSnapshot({...empty(),app:'twstocksearch'},'autoreport'));assert.throws(()=>validateSnapshot({...empty(),local:{'cloud-session:secret':'bad'}},'autoreport'));
 const data=empty();data.databases['AutoReport-file-library'].files={keys:['x'],values:[{}]};assert.throws(()=>validateSnapshot(data,'autoreport'));
 assert.equal(validateSnapshot(empty(),'autoreport').format,1);
});
function fakeBackend(){
 const tokens=new Map(),objects=new Map(),heads=new Map(),calls=[];let counter=0;
 const fetcher=async (url,options={})=>{
  const path=new URL(url).pathname,body=options.body&&JSON.parse(options.body),token=options.headers.Authorization?.replace('Bearer ',''),user=tokens.get(token);calls.push({path,options});
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(path==='/auth/v1/token'){const id=body.email==='b@example.com'?'bob':'alice',access_token='access-'+(++counter);tokens.set(access_token,id);return reply({access_token,refresh_token:id+'-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:body.email||'a@example.com'}});}
  if(!user)return reply({message:'unauthorized'},401);
  if(path==='/rest/v1/autoreport_workspaces')return reply(heads.has(user)?[heads.get(user)]:[]);
  if(path==='/storage/v1/object/autoreport-sync' && options.method==='DELETE'){for(const key of body.prefixes){if(!key.startsWith(user+'/'))return reply({},403);objects.delete(key);}return reply({});}
  const prefix='/storage/v1/object/autoreport-sync/';
  if(path.startsWith(prefix)){const key=path.slice(prefix.length);if(!key.startsWith(user+'/'))return reply({},403);if(options.method==='DELETE'){objects.delete(key);return reply({});}objects.set(key,body);return reply({Key:key});}
  if(path==='/rest/v1/rpc/commit_autoreport_workspace'){const old=heads.get(user)||{revision:0};if(old.revision!==body.p_expected_revision)return reply({code:'40001'},409);const next={revision:old.revision+1,object_path:body.p_object_path};heads.set(user,next);return reply(next.revision);}
  if(path.startsWith('/storage/v1/object/authenticated/autoreport-sync/')){const key=path.split('/autoreport-sync/')[1];if(!key.startsWith(user+'/'))return reply({},403);return reply(objects.get(key));}
  return reply({});
 };
 return {fetcher,objects,calls};
}
function client(backend,app='autoreport'){const map=new Map();return new CloudClient({url:'https://test.supabase.co',publishableKey:'public-key',app},{fetcher:backend.fetcher,session:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}});}
test('two devices cannot silently overwrite a newer cloud version; failed commit removes only its own upload',async()=>{
 const backend=fakeBackend(),a=client(backend),b=client(backend);await a.login('a@example.com','password');await b.login('a@example.com','password');await a.head();await b.head();await a.upload(empty());assert.equal(backend.objects.size,1);await assert.rejects(()=>b.upload(empty()),/另一台裝置/);assert.equal(backend.objects.size,1);assert.deepEqual(await b.download(),empty());
 const stranger=client(backend);await stranger.login('b@example.com','password');assert.equal((await stranger.head()).revision,0);await assert.rejects(()=>stranger.download({object_path:a.session.user.id+'/autoreport/x.json'}),/路徑不符/);
 assert.ok(backend.calls.filter(c=>c.path.startsWith('/rest/')).every(c=>c.options.headers.Authorization?.startsWith('Bearer access-')));
});
test('upload requires login and a loaded baseline; rejects oversized content before uploading',async()=>{
 const backend=fakeBackend(),a=client(backend);await assert.rejects(()=>a.head(),/登入/);await a.login('a@example.com','password');await assert.rejects(()=>a.upload(empty()),/讀取雲端版本/);await a.head();const snapshot=empty();snapshot.databases['AutoReport-local-database'].state={keys:['active'],values:['x'.repeat(51*1024*1024)]};await assert.rejects(()=>a.upload(snapshot),/50 MB/);assert.equal(backend.objects.size,0);
});

test('refuses non-HTTPS endpoints and privileged server credentials',()=>{const options={fetcher:async()=>{},session:{}};for(const settings of [{url:'http://test.supabase.co',publishableKey:'public'},{url:'https://test.supabase.co',publishableKey:'sb_secret_do-not-publish'},{url:'https://test.supabase.co',publishableKey:'x.'+btoa(JSON.stringify({role:'service_role'}))+'.x'}])assert.throws(()=>new CloudClient({...settings,app:'autoreport'},options));});
