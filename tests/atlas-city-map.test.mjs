import test from 'node:test';
import assert from 'node:assert/strict';
import {cityData, mountCityMap} from '../web/atlas-city-map.js';
import {makeDemo} from '../web/atlas-data.js';

test('actual city relationships preserve IDs, direction and kind without fabricated positions',()=>{
  const entities=[{id:'city',name:'C',kind:'space',data:{subtype:'도시'}},{id:'place',name:'P',kind:'space',data:{parent_id:'city'}},{id:'event',name:'E',kind:'event',data:{}},{id:'gone',name:'G',kind:'event',deleted_at:'2020'},{id:'character',name:'X',kind:'character',data:{parent_id:'city'}}];
  const relations=[{id:'r1',source_id:'event',target_id:'place',type:'located_in',data:{note:'참고 기록'}},{id:'r2',source_id:'gone',target_id:'city',type:'located_in'},{id:'r3',source_id:'city',target_id:'missing',type:'related'},{id:'r4',source_id:'city',target_id:'event',type:'before',deleted_at:'2020'}];
  const before=structuredClone({entities,relations});
  const model=cityData({id:'city'}, {mode:'real',entities,relations});
  assert.equal(model.places.length,0);
  assert.deepEqual(model.facilities,[]);
  assert.equal(model.related.length,2);
  assert.equal(model.related.find(r=>r.id==='r1').sourceId,'event');
  assert.equal(model.related.find(r=>r.id==='r1').targetId,'place');
  assert.match(model.related.find(r=>r.id==='r1').relation,/E \(event\) → P \(place\).*located_in.*참고 기록/);
  assert.equal(model.related.some(r=>r.id==='character'),false);
  assert.deepEqual({entities,relations},before);
});

test('demo maps contain separate imaginary regions, places and a linked event',()=>{
  const city=makeDemo().find(n=>n.id==='demo:city-01'), m=cityData(city,{mode:'demo'});
  assert.ok(m.places.length);assert.equal(m.regions.length,2);
  assert.equal(m.related[0].targetId,m.places[0].id);
  assert.ok(m.places.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  assert.equal(m.facilities.length,3);
  assert.equal(m.facilities.filter(f=>f.kind==='가상 교통국 지부').length,1);
  assert.ok(m.facilities.every(f=>f.id.startsWith('demo:')&&f.passageId.startsWith('demo:')&&Number.isFinite(f.x)&&Number.isFinite(f.y)));
  assert.deepEqual(cityData(city,{mode:'real'}).facilities,[]);
  assert.deepEqual(cityData({...city,demo:false},{mode:'demo'}).facilities,[]);
});

test('2D map pointer selection, drag, zoom, and disposal use a mock DOM',()=>{
  const listeners={}, svgListeners={}; let view='0 0 800 500', selected=null;
  const svg={addEventListener:(n,f)=>svgListeners[n]=f,removeEventListener:n=>delete svgListeners[n],setAttribute:(n,v)=>{if(n==='viewBox')view=v;},getBoundingClientRect:()=>({width:800,height:500}),setPointerCapture:()=>{},contains:t=>!!t.dataset?.cityPlace};
  const root={innerHTML:'',querySelector:()=>svg,addEventListener:(n,f)=>listeners[n]=f,removeEventListener:n=>delete listeners[n],replaceChildren:()=>{root.innerHTML='';}};
  const city=makeDemo().find(n=>n.id==='demo:city-01'); const map=mountCityMap(root,city,{mode:'demo',onSelect:p=>selected=p});
  const target={dataset:{cityPlace:map.model.places[0].id},closest(sel){return sel.includes('data-city-place')?this:null;}};
  svgListeners.pointerdown({clientX:0,clientY:0,pointerId:1});svgListeners.pointerup({});listeners.click({target});
  assert.equal(selected.id,map.model.places[0].id);
  selected=null;svgListeners.pointerdown({clientX:0,clientY:0,pointerId:1});svgListeners.pointermove({clientX:50,clientY:20});svgListeners.pointerup({});listeners.click({target});assert.equal(selected,null);
  svgListeners.wheel({deltaY:-100,preventDefault(){}});assert.notEqual(view,'0 0 800 500');
  selected=null;svgListeners.keydown({key:'Enter',target,preventDefault(){}});assert.equal(selected.id,map.model.places[0].id);
  // A drag without a generated click must not swallow a later toolbar click.
  svgListeners.pointerdown({clientX:0,clientY:0,pointerId:1});svgListeners.pointermove({clientX:30,clientY:20});svgListeners.pointerup({});
  const before=view,button={dataset:{cityZoom:'in'},closest(sel){return sel==='[data-city-zoom]'?this:null;}};
  listeners.click({target:button});assert.notEqual(view,before);
  const gate=map.model.facilities[0];
  const gateTarget={dataset:{cityRecord:gate.id},closest(sel){return sel.includes('data-city-record')?this:null;}};
  selected=null;listeners.click({target:gateTarget});assert.equal(selected.id,gate.id);assert.equal(selected.passageId,gate.passageId);
  assert.ok(root.innerHTML.includes(`data-city-place="${gate.id}"`));
  assert.ok(root.innerHTML.includes(`통로 ID: ${gate.passageId}`));
  map.dispose();assert.equal(Object.keys(listeners).length+Object.keys(svgListeners).length,0);
});

test('facility display escapes text and filters nonfinite positions',()=>{
  const svg={addEventListener(){},removeEventListener(){},setAttribute(){}};
  const root={innerHTML:'',querySelector:()=>svg,addEventListener(){},removeEventListener(){},replaceChildren(){}};
  const city={id:'demo:city',name:'<city>',demo:true,visual:{region:{gateFacilities:[{id:'demo:"bad',name:'<script>x</script>',passageId:'demo:<p>',x:0,z:0},{id:'bad',name:'bad',passageId:'bad',x:NaN,z:0}]}}};
  const map=mountCityMap(root,city,{mode:'demo'});
  assert.equal(map.model.facilities.length,1);
  assert.ok(root.innerHTML.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(root.innerHTML.includes('demo:&lt;p&gt;'));
  assert.ok(!root.innerHTML.includes('<script>'));
  map.dispose();
});
