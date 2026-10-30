import test from 'node:test';
import assert from 'node:assert/strict';
import {productStageSeries} from './stage-product-series.mjs';
const products=[{id:'g',ic:'GOODIX',model:'CY26-16'},{id:'s',ic:'Synaptis',model:'CY26-16'}];
const row=(product,serial,date,fail=false)=>({product,serial,date,process:'功能一測試',fail,status:fail?'FAIL':'GOOD'});
test('IC plus model separates products and weekly counts deduplicate across days',()=>{
 const analysis={products,observations:[row('g','a','2026-10-05'),row('g','a','2026-10-06'),row('g','b','2026-10-06',true),row('s','s','2026-10-06',true)]};
 const g=productStageSeries(analysis,'g','前段','2026-10-05','2026-10-11'),s=productStageSeries(analysis,'s','前段','2026-10-05','2026-10-11');
 assert.deepEqual(g.weeks.map(w=>w.date),['2026-W41','2026-W42']);assert.equal(g.weeks[0].input,2);assert.equal(g.weeks[0].value,.5);assert.equal(g.weeks[1].value,null);assert.equal(s.weeks[0].value,0);assert.equal(g.chartRows[2].date,'2026-10-05');
});
test('weekly process means pool PPIDs before averaging and handle year rollover',()=>{
 const a={products,observations:[row('g','a','2027-01-04'),{...row('g','b','2027-01-04',true),process:'DAF外觀'},row('g','a','2027-01-05')]};
 const model=productStageSeries(a,'g','前段','2027-01-01','2027-01-06');assert.deepEqual(model.weeks.map(w=>w.date),['2027-W01','2027-W02']);assert.equal(model.weeks[1].value,.5);assert.equal(model.weeks[1].input,2);
});
