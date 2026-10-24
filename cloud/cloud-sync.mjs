import config from './cloud-config.js';

const MAX_BYTES = 50 * 1024 * 1024;
const APPS = {
  autoreport: {databases: {'AutoReport-local-database': {version: 2, stores: {state: {}}}, 'AutoReport-file-library': {version: 1, stores: {files: {keyPath: 'id'}}}}, local: () => false},
  twstocksearch: {databases: {'TWStockSearch-research': {version: 1, stores: {workspace: {}}}}, local: key => key === 'twstocksearch-theme' || key === 'twstocksearch-research-v1' || key.startsWith('turning-note-')}
};

// Every value is tagged, so uploaded user objects cannot collide with type markers.
export async function encode(value) {
  if (value === undefined) return ['undefined'];
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return ['scalar', value];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const blob = value instanceof Blob ? value : new Blob([value]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return ['binary', btoa(binary), value instanceof Blob ? value.type : null, typeof File !== 'undefined' && value instanceof File ? value.name : null, value.lastModified ?? null, value instanceof Blob ? 'blob' : value instanceof ArrayBuffer ? 'buffer' : value.constructor.name];
  }
  if (Array.isArray(value)) return ['array', await Promise.all(value.map(encode))];
  if (Object.getPrototypeOf(value) !== Object.prototype) throw Error('資料含不支援的格式，未上傳。');
  return ['object', await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encode(item)]))];
}

export function decode(value, depth = 0) {
  if (depth > 100 || !Array.isArray(value)) throw Error('雲端資料格式錯誤。');
  const [tag, data, mime, name, modified, type] = value;
  if (tag === 'undefined') return undefined;
  if (tag === 'scalar' && (data === null || ['string', 'boolean', 'number'].includes(typeof data))) return data;
  if (tag === 'date') {const date = new Date(data); if (!Number.isFinite(+date)) throw Error('日期格式錯誤。'); return date;}
  if (tag === 'array' && Array.isArray(data)) return data.map(item => decode(item, depth + 1));
  if (tag === 'object' && Array.isArray(data)) return Object.fromEntries(data.map(pair => {if (!Array.isArray(pair) || typeof pair[0] !== 'string') throw Error('物件格式錯誤。'); return [pair[0], decode(pair[1], depth + 1)];}));
  if (tag === 'binary' && typeof data === 'string') {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (type === 'blob') return name === null ? new Blob([bytes], {type: mime}) : new File([bytes], name, {type: mime, lastModified: modified});
    if (type === 'buffer') return bytes.buffer;
    const types = {Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array};
    if (Object.hasOwn(types, type)) return new types[type](bytes.buffer);
  }
  throw Error('雲端資料格式不支援。');
}

function openDatabase(name, schema) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, schema.version);
    request.onupgradeneeded = () => {for (const [store, options] of Object.entries(schema.stores)) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, options);};
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('請關閉其他網站分頁後重試。'));
  });
}
async function readDatabase(name, schema) {
  const db = await openDatabase(name, schema);
  try {return await new Promise((resolve, reject) => {
    const stores = Object.keys(schema.stores), tx = db.transaction(stores), result = {};
    for (const store of stores) {const object = tx.objectStore(store), keys = object.getAllKeys(), values = object.getAll(); values.onsuccess = () => {result[store] = {keys: keys.result, values: values.result};};}
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
  });} finally {db.close();}
}
async function writeDatabase(name, schema, contents) {
  const db = await openDatabase(name, schema);
  try {await new Promise((resolve, reject) => {
    const tx = db.transaction(Object.keys(schema.stores), 'readwrite');
    try {for (const [store, options] of Object.entries(schema.stores)) {const object = tx.objectStore(store); object.clear(); const data = contents[store]; data.values.forEach((value, i) => options.keyPath ? object.put(value) : object.put(value, data.keys[i]));}} catch (error) {tx.abort(); reject(error);}
    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || Error('還原交易未完成。'));
  });} finally {db.close();}
}
export async function capture(app) {
  const schema = APPS[app]; if (!schema) throw Error('未知的應用程式。');
  const databases = {}; for (const [name, spec] of Object.entries(schema.databases)) databases[name] = await readDatabase(name, spec);
  const local = {}; for (let i = 0; i < localStorage.length; i++) {const key = localStorage.key(i); if (schema.local(key)) local[key] = localStorage.getItem(key);}
  return {format: 1, app, databases, local};
}
export function validateSnapshot(snapshot, app) {
  const schema = APPS[app];
  if (!schema || snapshot?.format !== 1 || snapshot.app !== app || !snapshot.databases || !snapshot.local) throw Error('備份不屬於目前網站或版本不支援。');
  if (Object.keys(snapshot.databases).sort().join('|') !== Object.keys(schema.databases).sort().join('|')) throw Error('備份資料庫不完整。');
  for (const [name, spec] of Object.entries(schema.databases)) {
    const stores = snapshot.databases[name];
    if (!stores || Object.keys(stores).sort().join('|') !== Object.keys(spec.stores).sort().join('|')) throw Error('備份資料表不完整。');
    for (const [store, options] of Object.entries(spec.stores)) {const data = stores[store]; if (!Array.isArray(data?.keys) || !Array.isArray(data?.values) || data.keys.length !== data.values.length || (options.keyPath && data.values.some(value => !value || value[options.keyPath] == null))) throw Error('備份紀錄格式錯誤。');}
  }
  if (Object.entries(snapshot.local).some(([key, value]) => !schema.local(key) || typeof value !== 'string')) throw Error('備份含無效的網站設定。');
  return snapshot;
}
async function clearAnalysisCache() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('AutoReport-analysis-cache'); let absent = false;
    request.onupgradeneeded = () => {absent = true; request.transaction.abort();};
    request.onerror = () => absent ? resolve() : reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('results')) {db.close(); resolve(); return;}
      const tx = db.transaction('results', 'readwrite'); tx.objectStore('results').clear();
      tx.oncomplete = () => {db.close(); resolve();};
      tx.onerror = tx.onabort = () => {db.close(); reject(tx.error);};
    };
  });
}
export async function restore(snapshot, app) {
  validateSnapshot(snapshot, app);
  const previous = await capture(app), schema = APPS[app];
  async function apply(value) {
    for (const [name, spec] of Object.entries(schema.databases)) await writeDatabase(name, spec, value.databases[name]);
    const keys = []; for (let i = 0; i < localStorage.length; i++) {const key = localStorage.key(i); if (schema.local(key)) keys.push(key);}
    for (const key of keys) localStorage.removeItem(key);
    for (const [key, item] of Object.entries(value.local)) localStorage.setItem(key, item);
  }
  try {await apply(snapshot); if (app === 'autoreport') await clearAnalysisCache();} catch (error) {try {await apply(previous);} catch {throw Error('還原失敗且無法完整復原，請保留下載的本機備份，勿重新整理。');} throw error;}
}

export class CloudClient {
  constructor(settings, {fetcher = globalThis.fetch.bind(globalThis), session = globalThis.sessionStorage} = {}) {
    this.config = settings; this.fetcher = fetcher; this.storage = session; this.session = null; this.revision = null;
    if (!APPS[settings.app]) throw Error('未知的應用程式。');
    const url = new URL(settings.url); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/') throw Error('雲端網址必須為 HTTPS 網域。');
    if (typeof settings.publishableKey !== 'string' || !settings.publishableKey.trim() || settings.publishableKey.startsWith('sb_secret_')) throw Error('請只使用公開的 Supabase publishable／anon key。');
    if (settings.publishableKey.split('.').length === 3) {
      try {const payload = JSON.parse(atob(settings.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.role !== 'anon') throw Error();}
      catch {throw Error('請只使用公開的 Supabase publishable／anon key。');}
    }
    this.base = url.origin; this.key = `cloud-session:${this.base}:${settings.app}`;
  }
  async request(path, {method = 'GET', body, token, raw = false} = {}) {
    const headers = {apikey: this.config.publishableKey};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetcher(this.base + path, {method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000)});
    if (!response.ok) {if(response.status===401 && token && this.session){this.storage.removeItem(this.key);this.session=null;this.revision=null;if(typeof window!=='undefined')window.dispatchEvent(new Event('autoreport-auth-expired'));}const error = await response.json().catch(() => ({})); if (error.code === 'PT409' || error.code === '40001') throw Error('另一台裝置已更新資料。請先下載雲端備份並比較，重新讀取版本後再上傳。'); throw Error(response.status === 401 ? '登入已失效，請重新登入。' : `雲端操作失敗（${response.status}）：${String(error.msg || error.message || error.error_description || error.error || '請稍後重試').slice(0, 200)}`);}
    return response.status === 204 ? null : response.json();
  }
  remember(session) {this.session = session; this.revision = null; this.storage.setItem(this.key, session.refresh_token);}
  async resume() {const token = this.storage.getItem(this.key); if (!token) return false; try {this.remember(await this.request('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: token}})); return true;} catch (error) {this.storage.removeItem(this.key); this.session = null; throw error;}}
  async login(email, password) {this.remember(await this.request('/auth/v1/token?grant_type=password', {method: 'POST', body: {email, password}}));}
  async signup(email, password) {const redirect=typeof location==='undefined'?'':('?redirect_to='+encodeURIComponent(new URL('.',location.href).href));return this.request('/auth/v1/signup'+redirect, {method: 'POST', body: {email, password}});}
  async verifiedUser() {const user=await this.request('/auth/v1/user',{token:await this.access()});if(!user.email_confirmed_at&&!user.confirmed_at)throw Error('請先完成信箱驗證，再登入使用分析。');this.session.user=user;return user;}
  async access() {
    if (!this.session) throw Error('請先登入。');
    if (this.session.expires_at * 1000 < Date.now() + 60000) {const revision = this.revision; await this.resume(); this.revision = revision;}
    return this.session.access_token;
  }
  async logout() {try {if (this.session) await this.request('/auth/v1/logout?scope=local', {method: 'POST', token: await this.access()});} finally {this.storage.removeItem(this.key); this.session = null; this.revision = null;}}
  async head() {const rows = await this.request(`/rest/v1/autoreport_workspaces?app=eq.${this.config.app}&select=revision,object_path,updated_at`, {token: await this.access()}); const head = rows[0] || {revision: 0, object_path: null}; this.revision = head.revision; return head;}
  async download(head) {
    const current = head || await this.head(); if (!current.object_path) throw Error('此帳號尚無雲端備份。');
    const prefix = `${this.session.user.id}/${this.config.app}/`; if (!current.object_path.startsWith(prefix)) throw Error('雲端檔案路徑不符。');
    const response = await this.fetcher(`${this.base}/storage/v1/object/authenticated/autoreport-sync/${current.object_path}`, {headers: {apikey: this.config.publishableKey, Authorization: `Bearer ${await this.access()}`}, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Error(`雲端備份下載失敗（${response.status}）。`);
    const blob = await response.blob(); if (blob.size > MAX_BYTES) throw Error('雲端備份超過 50 MB 上限。');
    return validateSnapshot(decode(JSON.parse(await blob.text())), this.config.app);
  }
  async upload(snapshot) {
    validateSnapshot(snapshot, this.config.app); if (this.revision === null) throw Error('請先讀取雲端版本。');
    const baseline = this.revision; const latest = await this.head(); this.revision = baseline;
    if (latest.revision !== baseline) throw Error('另一台裝置已更新資料。請先下載雲端備份並比較，重新讀取版本後再上傳。');
    const data = JSON.stringify(await encode(snapshot)); if (new Blob([data]).size > MAX_BYTES) throw Error('同步備份上限 50 MB（含編碼）；請減少檔案後重試。');
    const token = await this.access(), path = `${this.session.user.id}/${this.config.app}/${crypto.randomUUID()}.json`;
    await this.request(`/storage/v1/object/autoreport-sync/${path}`, {method: 'POST', token, body: data, raw: true});
    try {this.revision = await this.request('/rest/v1/rpc/commit_autoreport_workspace', {method: 'POST', token, body: {p_app: this.config.app, p_expected_revision: this.revision, p_object_path: path}});} catch (error) {await this.request('/storage/v1/object/autoreport-sync', {method: 'DELETE', token, body: {prefixes: [path]}}).catch(() => {}); throw error;}
    return this.revision;
  }
}

function saveBackup(snapshot, app) {
  return encode(snapshot).then(value => {const url = URL.createObjectURL(new Blob([JSON.stringify(value)], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = `${app}-before-sync-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);});
}
function mount() {
  if(document.querySelector('.cloud-sync'))return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./cloud-sync.css', import.meta.url); document.head.append(css);
  const panel = document.createElement('details'); panel.className = 'cloud-sync';
  panel.innerHTML = `<summary>帳號與雲端同步</summary><p>登入後可在不同裝置上傳與還原資料。此處僅同步 AutoReport 的對照庫與檔案庫。同步需手動操作，不會自動上傳。</p><p class="cloud-status" role="status" aria-live="polite"></p><form class="cloud-login"><label>電子郵件 <input name="email" type="email" autocomplete="username" required></label><label>密碼 <input name="password" type="password" autocomplete="current-password" minlength="8" required></label><button type="submit">登入</button><button type="button" data-action="signup">註冊</button></form><div class="cloud-actions" hidden><button type="button" data-action="head">讀取雲端版本</button><button type="button" data-action="upload">上傳本機資料</button><button type="button" data-action="download">下載雲端備份</button><button type="button" data-action="local-backup">下載本機備份</button><button type="button" data-action="restore">還原雲端資料</button><button type="button" data-action="logout">登出</button></div><p>上傳取代雲端目前版本；還原取代本裝置的網站資料。請先完成其他操作並關閉此網站的其他分頁。登出後本機資料仍保留，公用裝置請清除網站資料。每份備份上限 50 MB；分析快取不會同步。</p><label>從備份檔復原本機資料 <input class="cloud-import" type="file" accept="application/json,.json"></label>`;
  const app=document.getElementById('analysisApp'),gateRequired=!!app&&config.requireLoginForAnalysis!==false;
  (app?document.body:(document.querySelector('main')||document.body)).prepend(panel);
  if(gateRequired)panel.open=true;
  const status = panel.querySelector('.cloud-status'), form = panel.querySelector('form'), actions = panel.querySelector('.cloud-actions');
  form.onsubmit = event => event.preventDefault();
  let client, busy = false, needsReload = false, verified=false, appStarted=false, expirationTimer;
  const ownerKey='autoreport-local-owner';
  function bootstrap(allowed){if(!app)return;document.body.classList.toggle('analysis-is-locked',!allowed);app.hidden=!allowed;app.inert=!allowed;if(allowed&&!appStarted){appStarted=true;const entry=document.getElementById('analysis-entry');if(entry){const script=document.createElement('script');script.type='module';script.src=JSON.parse(entry.textContent).src;document.body.append(script);}}}
  bootstrap(!gateRequired);
  const switchAccount=document.createElement('button');switchAccount.type='button';switchAccount.textContent='切換帳號並清除本機副本';switchAccount.hidden=true;panel.append(switchAccount);
  const logoutButton=panel.querySelector('[data-action=logout]');panel.append(logoutButton);logoutButton.hidden=true;
  async function verifySession(){verified=false;const user=await client.verifiedUser();verified=true;clearTimeout(expirationTimer);expirationTimer=setTimeout(()=>{verified=false;render();show('登入已到期，請重新登入後使用分析。');},Math.max(0,client.session.expires_at*1000-Date.now()));if(gateRequired&&!localStorage.getItem(ownerKey))localStorage.setItem(ownerKey,user.id);}

  const show = message => {status.textContent = message;};
  const render = () => {const authenticated=!!client?.session&&verified,ownerMatches=!gateRequired||localStorage.getItem(ownerKey)===client?.session?.user?.id;form.hidden=authenticated;actions.hidden=!(authenticated&&ownerMatches);switchAccount.hidden=!(authenticated&&!ownerMatches);logoutButton.hidden=!client?.session;panel.querySelector('.cloud-import').disabled=!(authenticated&&ownerMatches);bootstrap(!gateRequired||(authenticated&&ownerMatches));if(authenticated&&!ownerMatches)show('此瀏覽器保留另一個帳號的資料。請由原帳號先備份，再清除本機副本以切換；不會將舊檔顯示或上傳給目前帳號。');if(!client)form.querySelectorAll('input,button').forEach(el=>el.disabled=true);};
  window.addEventListener('storage',event=>{if(event.key===ownerKey)render();});
  logoutButton.onclick=()=>run(async()=>{verified=false;clearTimeout(expirationTimer);render();await client.logout();show('已登出；本機資料仍保留，分析已鎖定。');});
  window.addEventListener('autoreport-auth-expired',()=>{verified=false;render();show('登入已失效，請重新登入。');});
  switchAccount.onclick=()=>run(async()=>{if(!confirm('將清除前一帳號的本機副本，不會匯出給新帳號。若原帳號尚未備份，請取消並重新登入原帳號先備份。雲端資料不受影響。請關閉其他分頁，確定切換？'))return;const empty={format:1,app:config.app,databases:{'AutoReport-local-database':{state:{keys:[],values:[]}},'AutoReport-file-library':{files:{keys:[],values:[]}}},local:{}};await restore(empty,config.app);localStorage.setItem(ownerKey,client.session.user.id);location.reload();});
  async function run(action) {if (busy) return; busy = true; const controls = [...panel.querySelectorAll('button,input')]; controls.forEach(el => el.disabled = true); try {await action();} catch (error) {show(error.message);} finally {busy = false; controls.forEach(el => el.disabled = needsReload); render();}}
  const replace = async snapshot => {await saveBackup(await capture(config.app), config.app); if (!confirm('已開始下載本機備份。請先確認備份已保留，並關閉此網站的其他分頁。繼續將取代本裝置的網站資料，之後須重新整理。')) return; await restore(snapshot, config.app); needsReload = true; show('資料已還原。請重新整理網頁後使用。'); const reload = document.createElement('button'); reload.textContent = '重新整理'; reload.onclick = () => location.reload(); status.append(' ', reload);};
  panel.querySelector('.cloud-import').onchange = event => run(async () => {const file = event.target.files[0]; if (!file) return; if (file.size > MAX_BYTES) throw Error('備份檔超過 50 MB。'); await replace(validateSnapshot(decode(JSON.parse(await file.text())), config.app));});
  if (!config.url || !config.publishableKey) {show('尚未設定雲端服務；目前資料仍保存在此瀏覽器。請依雲端設定說明啟用。'); form.querySelectorAll('input,button').forEach(el => el.disabled = true); return;}
  try {client = new CloudClient(config);} catch (error) {show(error.message); render(); return;}
  async function head() {const remote = await client.head(); show(`已登入 ${client.session.user.email} · 雲端版本 ${remote.revision}${remote.updated_at ? ' · ' + new Date(remote.updated_at).toLocaleString() : '（尚無資料）'}`); return remote;}
  form.onsubmit = event => {event.preventDefault(); run(async () => {await client.login(form.email.value, form.password.value); form.password.value = ''; await verifySession(); await head();});};
  panel.querySelector('[data-action="signup"]').onclick = () => {if (!form.reportValidity()) return; run(async () => {const result = await client.signup(form.email.value, form.password.value); form.password.value = ''; show(result.session || result.access_token ? '註冊成功，請按登入。' : '註冊申請已送出，請查看確認信；完成信箱驗證後回來登入。');});};
  actions.onclick = event => {const action = event.target.dataset.action; if (!action) return; run(async () => {
    if (action === 'head') await head();
    if (action === 'logout') {verified=false;clearTimeout(expirationTimer);render();await client.logout();show('已登出；本機資料仍保留，分析已鎖定。');}
    if (action === 'upload') {if (client.revision === null) await head(); if (!confirm(`將本裝置資料上傳至 ${client.session.user.email}，取代雲端版本 ${client.revision}。這可能包含工單與個人資料。確定繼續？`)) return; show('正在上傳，請勿關閉網頁…'); const revision = await client.upload(await capture(config.app)); show(`上傳完成 · 雲端版本 ${revision}。其他裝置請登入後還原。`);}
    if(action==='local-backup'){await saveBackup(await capture(config.app),config.app);show('本機備份已下載，尚未上傳的資料也會包含。');}
    if (action === 'download') {await saveBackup(await client.download(), config.app); show('雲端備份已下載，本機資料未變更。');}
    if (action === 'restore') {show('正在下載雲端資料…'); await replace(await client.download());}
  });};
  run(async () => {if(await client.resume()){await verifySession();await head();}else show(gateRequired?'請註冊並完成信箱驗證，登入後即可使用分析。':'尚未登入。');});
}
if (typeof document !== 'undefined') {if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();}
