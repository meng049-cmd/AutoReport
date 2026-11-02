import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matcher,norm} from './matcher.mjs';
const item={order:norm('MISS1'),part:norm('PART1'),ic:'Goodix',model:'CY26',confirmed_at:'2026-11-02'};
const reference={records:[],keys:[],manual_corrections:[item]};
test('confirmed corrections survive reload and isolate work order and part',()=>{
 const matcher=new Matcher(JSON.parse(JSON.stringify(reference)));
 assert.equal(matcher.lookup([['order','ＭＩＳＳ１'],['part','part1']])['候選'][0].IC,'Goodix');
 for(const criteria of [[['order','MISS1'],['part','PART2']],[['order','MISS2'],['part','PART1']],[['order','MISS1']]])assert.equal(matcher.lookup(criteria)['狀態'],'查無資料');
});
test('confirmed exact pair resolves ambiguous reference without altering other mappings',()=>{
 const records=[{id:1,ic:'old',model:'old',parts:[],dpns:[],source_file:'old.xlsx'},{id:2,ic:'old2',model:'old2',parts:[],dpns:[],source_file:'old.xlsx'}];
 const keys=records.flatMap(r=>[['order','miss1',r.id],['part','part1',r.id]]);
 assert.equal(new Matcher({records,keys}).lookup([['order','MISS1'],['part','PART1']])['狀態'],'多組候選');
 assert.equal(new Matcher({...reference,records,keys}).lookup([['order','MISS1'],['part','PART1']])['候選'][0]['機種'],'CY26');
});
