import test from 'node:test';
import assert from 'node:assert/strict';
import {productStageSeries,stageChartDateLabel} from './stage-product-series.mjs';
const products=[{id:'g',ic:'GOODIX',model:'CY26-16'},{id:'s',ic:'Synaptis',model:'CY26-16'}];
const row=(product,serial,date,fail=false)=>({product,serial,date,process:'功能一測試',fail,status:fail?'FAIL':'GOOD'});
test('stage chart labels omit the year for week and day categories',()=>{
 assert.equal(stageChartDateLabel({kind:'week',date:'2026-W43'}),'W43');
 assert.equal(stageChartDateLabel({kind:'day',date:'2026-11-09'}),'11-09');
});
test('IC plus model separates products and weekly counts deduplicate across days',()=>{
 const analysis={products,observations:[row('g','a','2026-10-05'),row('g','a','2026-10-06'),row('g','b','2026-10-06',true),row('s','s','2026-10-06',true)]};
 const g=productStageSeries(analysis,'g','前段','2026-10-05','2026-10-11'),s=productStageSeries(analysis,'s','前段','2026-10-05','2026-10-11');
 assert.deepEqual(g.weeks.map(w=>w.date),['2026-W39','2026-W40']);assert.equal(g.weeks[0].input,2);assert.equal(g.weeks[0].value,.5);assert.equal(s.weeks[0].value,0);assert.equal(g.chartRows[2].date,'2026-10-05');assert.equal(g.weeks[1].value,null);
});
test('weekly process means pool PPIDs before averaging and handle year rollover',()=>{
 const a={products,observations:[row('g','a','2027-01-04'),{...row('g','b','2027-01-04',true),process:'DAF外觀'},row('g','a','2027-01-05')]};
 const model=productStageSeries(a,'g','前段','2027-01-01','2027-01-06');assert.deepEqual(model.weeks.map(w=>w.date),['2026-W51','2026-W52']);assert.equal(model.weeks[1].value,.5);assert.equal(model.weeks[1].input,2);
});

test('every stage retains missing days and both weeks, including a stage with no inputs',()=>{
 const analysis={products,observations:[row('g','a','2026-11-09'),row('g','b','2026-11-13',true)]};
 const expected=['W43','W44','11-09','11-10','11-11','11-12','11-13'];
 for(const stage of ['前段','後段']){
  const model=productStageSeries(analysis,'g',stage,'2026-11-09','2026-11-13');
  assert.deepEqual(model.chartRows.map(stageChartDateLabel),expected);
  assert.equal(model.weeks[0].value,null);assert.equal(model.weeks[0].input,0);
  assert.equal(model.daily[2].date,'2026-11-11');assert.equal(model.daily[2].input,0);assert.equal(model.daily[2].value,null);
  if(stage==='前段'){assert.equal(model.daily[0].value,1);assert.equal(model.daily.at(-1).value,0);assert.equal(model.period.input,2);}
  else{assert.ok(model.chartRows.every(item=>item.value===null&&item.input===0));assert.equal(model.period.value,null);}
 }
});

test('an entirely empty date range still has two week slots and every selected calendar day',()=>{
 const model=productStageSeries({products,observations:[]},'g','前段','2026-11-09','2026-11-15');
 assert.deepEqual(model.chartRows.map(stageChartDateLabel),['W44','W45','11-09','11-10','11-11','11-12','11-13','11-14','11-15']);
 assert.ok(model.chartRows.every(item=>item.value===null&&item.input===0));
});
