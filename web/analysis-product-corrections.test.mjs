import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../vendor/xlsx.full.min.js';
import '../merge-core.js';
import '../quality-core.js';
import '../yield-core.js';
import '../analysis-product-corrections.js';
const {applyConfirmedProductCorrections}=globalThis;
const header=['製程','工單','料號','品名規格','小板序號','產出時間','操作人員','不良項目','狀態','IC','機種'];
const correction={order:'wo123',part:'part1',ic:'Goodix',model:'Model A'};
function mergerFor(rows){
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,...rows]),'Detail');
 const merger=new globalThis.DetailMerger(XLSX);merger.add(book,'existing.xlsx');return merger;
}
const row=(serial,order='WO123',part='PART1',ic='',model='')=>['DAF外觀',order,part,'',serial,46306,'','', 'GOOD',ic,model];
test('confirmed corrections move pending PPIDs into the named daily stage product without changing counts',()=>{
 const merger=mergerFor([row('pending'),row('named','WO123','PART1','Goodix','Model A')]);
 assert.equal(globalThis.analyzeQuality(merger).products.length,2);
 assert.equal(applyConfirmedProductCorrections(merger,[correction]),1);
 const analysis=globalThis.analyzeQuality(merger),report=globalThis.buildYieldReport(merger,analysis.identities);
 assert.equal(analysis.total,2);assert.equal(analysis.products.length,1);
 assert.equal(analysis.products[0].model,'Model A');assert.equal(analysis.products[0].pending,false);
 assert.equal(analysis.products[0].total,2);assert.equal(report.pending_product_count,0);
 const stageRows=XLSX.utils.sheet_to_json(report.book.Sheets['每日階段良率'],{header:1});
 assert.ok(stageRows.flat().includes('Model A'));
 assert.ok(!stageRows.flat().some(value=>/待補/.test(String(value))));
 assert.equal(applyConfirmedProductCorrections(merger,[correction]),0);
});
test('only exact order/part matches fill missing identities; complete and conflicting identities remain intact',()=>{
 const merger=mergerFor([row('partial','ｗｏ１２３','part1','Goodix'),row('other-part','WO123','PART2'),row('other-order','WO999'),row('blank-order',''),row('complete','WO123','PART1','Other','Other Model'),row('conflict','WO123','PART1','Other')]);
 assert.equal(applyConfirmedProductCorrections(merger,[correction]),1);
 const rows=new Map([...merger.rows.values()].map(value=>[value.row[4],value.row]));
 assert.equal(rows.get('partial')[10],'Model A');
 for(const id of ['other-part','other-order','blank-order','conflict'])assert.equal(rows.get(id)[10],'');
 assert.equal(rows.get('complete')[9],'Other');assert.equal(rows.get('complete')[10],'Other Model');
});
