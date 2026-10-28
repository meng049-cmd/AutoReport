import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('return to analysis or matching scrolls to the action anchor rather than workspace top',()=>{
 for(const anchor of ['yield','matching']){
  const calls=[],nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,dataset:{},setAttribute(){},closest(){return {hidden:false};},scrollIntoView(){calls.push(id);}});return nodes.get(id);};
  const document={getElementById:node,querySelectorAll:()=>[],body:{dataset:{}}},window={dispatchEvent(){},addEventListener(){},scrollTo(){calls.push('top');}};
  const context=vm.createContext({document,window,location:{hash:'#/'+anchor},requestAnimationFrame:fn=>fn(),queueMicrotask(){},CustomEvent:class{}});
  vm.runInContext(readFileSync('web/navigation.mjs','utf8').replaceAll('export ',''),context);vm.runInContext('renderPage()',context);assert.deepEqual(calls,[anchor]);
 }
});
