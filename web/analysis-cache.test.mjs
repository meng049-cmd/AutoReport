import test from 'node:test';import assert from 'node:assert/strict';
import {analysisSelectionKey,getAnalysisCache,saveAnalysisCache,clearAnalysisCaches,removeAnalysisCaches} from './analysis-cache.mjs';
test('completed analysis cache respects ordered immutable file IDs, skip mode and calculation version, without retaining XLSX buffers',async()=>{
 globalThis.__ANALYSIS_VERSION__='test-v1';await clearAnalysisCaches();
 const key=analysisSelectionKey(['a','b'],{skipInvalidRows:false},[{name:'same.xlsx'}],['reference']);
 assert.notEqual(key,analysisSelectionKey(['b','a'],{},[{name:'same.xlsx'}],['reference']));assert.notEqual(key,analysisSelectionKey(['a','b'],{skipInvalidRows:true},[{name:'same.xlsx'}],['reference']));assert.notEqual(key,analysisSelectionKey(['a','b'],{},[{name:'same.xlsx'}],['new reference']));
 const data={filename:'report.xlsx',analysis:{total:2,dailyProcessTotals:new Map([['key',2]])},stageChecks:[],bytes:new ArrayBuffer(1),merged:{bytes:new ArrayBuffer(1)}};
 await saveAnalysisCache('report',data,{selectionKey:key,inputIds:['a','b']});const hit=await getAnalysisCache({selectionKey:key});assert.equal(hit.reportId,'report');assert.equal(hit.data.analysis.total,2);assert.equal(hit.data.analysis.dailyProcessTotals.get('key'),2);assert.equal(hit.data.bytes,undefined);assert.equal(hit.data.merged,undefined);
 globalThis.__ANALYSIS_VERSION__='test-v2';assert.equal(await getAnalysisCache({reportId:'report'}),null);globalThis.__ANALYSIS_VERSION__='test-v1';
 await removeAnalysisCaches(['a']);assert.equal(await getAnalysisCache({selectionKey:key}),null);assert.ok(await getAnalysisCache({reportId:'report'}),'deleting a source does not invalidate an immutable finished report');await removeAnalysisCaches(['report']);assert.equal(await getAnalysisCache({reportId:'report'}),null);
 await saveAnalysisCache('other',data,{selectionKey:key,inputIds:['a','b']});await clearAnalysisCaches();assert.equal(await getAnalysisCache({reportId:'other'}),null);assert.equal(await getAnalysisCache({selectionKey:key}),null);
});
