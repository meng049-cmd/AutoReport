import {build} from 'esbuild';
import cloudConfig from '../cloud/cloud-config.js';
import {mkdir,copyFile,rm,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const calculationHash=createHash('sha256');for(const file of ['report-sheets.js','vendor/xlsx.full.min.js','merge-core.js','yield-core.js','quality-core.js','yield-worker.js'])calculationHash.update(await readFile(file));const calculationVersion=calculationHash.digest('hex').slice(0,16);
const anonymousCloudMode=process.env.AUTOREPORT_ANONYMOUS_CLOUD==='1';
const hash=createHash('sha256');
for(const file of ['report-sheets.js','web/stage-product-series.mjs','web/stage-metrics.mjs','web/chart-formulas.mjs','web/stage-drill-ui.mjs','web/stage-analysis.mjs','web/analysis-cache.mjs','web/quality-extras.mjs','web/navigation.mjs','web/ppid-lookup-ui.mjs','ppid-lookup-worker.js','vendor/package.json','vendor/xlsx.full.min.js','web/file-library.mjs','web/file-library-ui.mjs','web/limits.mjs','web/app.mjs','web/worker.mjs','web/files.mjs','web/matcher.mjs','web/match-corrections.mjs','web/merge-ui.mjs','merge-core.js','merge-worker.js','yield-core.js','yield-worker.js','quality-core.js','threshold-core.js','web/yield-ui.mjs','web/quality-ui.mjs','web/chart-export.mjs','web/defect-analysis.mjs','web/report-context.mjs','web/threshold-ui.mjs','web/index.html','browser-storage.js','browser-db-worker.js','autoreport.py','web/update_database.py','cloud/cloud-sync.mjs','cloud/cloud-config.js','cloud/cloud-sync.css'])hash.update(await readFile(file));
hash.update(anonymousCloudMode?'anonymous-cloud':'email-cloud');
const buildId=hash.digest('hex').slice(0,12);
await rm('dist',{recursive:true,force:true});await mkdir('dist/assets',{recursive:true});
execFileSync(existsSync('.venv/bin/python')?'.venv/bin/python':'python',['web/export_reference.py','dist/reference.json']);
await build({entryPoints:{app:'web/app.mjs',worker:'web/worker.mjs'},bundle:true,format:'esm',platform:'browser',outdir:'dist/assets',minify:true,target:['es2022'],legalComments:'linked',define:{__BUILD_ID__:JSON.stringify(buildId),__ANALYSIS_VERSION__:JSON.stringify(calculationVersion)}});
await writeFile('dist/index.html',(await readFile('web/index.html','utf8')).replace('./assets/app.js','./assets/app.js?v='+buildId).replace('./cloud/cloud-sync.mjs','./cloud/cloud-sync.mjs?v='+buildId));await writeFile('dist/.nojekyll','');
await copyFile('data/autoreport.sqlite3','dist/autoreport.sqlite3');
await mkdir('dist/vendor');
for(const file of ['report-sheets.js','ppid-lookup-worker.js','merge-core.js','merge-worker.js','yield-core.js','yield-worker.js','quality-core.js','threshold-core.js','browser-storage.js','browser-db-worker.js'])await copyFile(file,'dist/'+file);
for(const file of ['xlsx.full.min.js','LICENSE.xlsx'])await copyFile('vendor/'+file,'dist/vendor/'+file);
await mkdir('dist/downloads');
for(const name of ['AutoReport_query_template.xlsx','AutoReport_sample_results.xlsx','AutoReport_summary.xlsx'])await copyFile('downloads/'+name,'dist/downloads/'+name);
console.log('Built GitHub Pages site in dist/');

await mkdir('dist/browser-python');await copyFile('autoreport.py','dist/browser-python/autoreport.py');await copyFile('web/update_database.py','dist/browser-python/update_database.py');
await mkdir('dist/vendor/pyodide');await mkdir('dist/vendor/python');
for(const name of ['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json','sqlite3-1.0.0-cp312-cp312-pyodide_2024_0_wasm32.whl','LICENSE'])await copyFile('vendor/pyodide/'+name,'dist/vendor/pyodide/'+name);
for(const name of ['openpyxl-3.1.5-py2.py3-none-any.whl','et_xmlfile-2.0.0-py3-none-any.whl','opencc_python_reimplemented-0.1.7-py2.py3-none-any.whl'])await copyFile('vendor/python/'+name,'dist/vendor/python/'+name);

await mkdir('dist/cloud');
for (const name of ['cloud-sync.mjs','cloud-sync.css','cloud-config.js']) await copyFile('cloud/'+name, 'dist/cloud/'+name);

let sourceCommit=process.env.VERCEL_GIT_COMMIT_SHA||process.env.AUTOREPORT_SOURCE_COMMIT||null;
if(!sourceCommit){try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}}
await writeFile('dist/release.json',JSON.stringify({projectName:"AUTOREPORT 工單查找與品質分析",buildId,sourceCommit,requireLoginForAnalysis:anonymousCloudMode?false:cloudConfig.requireLoginForAnalysis===true,anonymousCloudMode,supabaseHost:new URL(cloudConfig.url).hostname,builtAt:new Date().toISOString()},null,2));
