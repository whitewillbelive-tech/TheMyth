import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo} from '../web/atlas-data.js';
import {adaptPassages,makeDemoPassages} from '../web/atlas-passages.js';
import {selectPassageRows,makePassageLines,highlightedPassageIds,limitPassageLines} from '../web/atlas-passage-view.js';

test('scene and planet filters preserve source while presenting only explicit relationships',()=>{
  const nodes=makeDemo(),records=adaptPassages(nodes,makeDemoPassages()),before=structuredClone(records);
  const u=selectPassageRows(records,nodes,null), g=selectPassageRows(records,nodes,'demo:gal-01'), p=selectPassageRows(records,nodes,'demo:p-01');
  assert.deepEqual(u.map(x=>x.id),['demo:passage-gal-01']);
  assert.deepEqual(g.map(x=>x.id),['demo:passage-planet-01','demo:passage-gal-01']);assert.deepEqual(p.map(x=>x.id),['demo:passage-planet-01']);
  assert.equal(selectPassageRows(records,nodes,null,{levels:{galaxy:false,planet:true}}).length,0);
  assert.equal(selectPassageRows(records,nodes,null,{status:'open'}).length,0);
  assert.deepEqual(records,before);
});
test('bounded visible lines prefer selected or directly connected lines without modifying source',()=>{
  const lines=Array.from({length:205},(_,i)=>({id:String(i),highlighted:i===204}));
  const result=limitPassageLines(lines);
  assert.equal(result.length,200);assert.ok(result.some(x=>x.id==='204'));assert.equal(lines[0].id,'0');
});
test('lines use only explicit endpoints and can be toggled or independently highlighted',()=>{
  const nodes=makeDemo(),rows=selectPassageRows(adaptPassages(nodes,makeDemoPassages()),nodes,null);
  const scene={type:'universe',objects:[{id:'demo:gal-01',x:1,y:2,z:3},{id:'demo:gal-02',x:4,y:5,z:6}]};
  const lines=makePassageLines(rows,scene,{highlightNode:'demo:gal-01'});
  assert.deepEqual(lines[0].source,[1,2,3]);assert.equal(lines[0].highlighted,true);
  assert.deepEqual(highlightedPassageIds(rows,'demo:gal-01',null),[rows[0].id]);
  assert.equal(makePassageLines(rows,scene,{enabled:false}).length,0);
  assert.equal(makePassageLines(rows,{...scene,objects:scene.objects.slice(0,1)}).length,0);
  assert.equal(makePassageLines(rows,{...scene,type:'planet'}).length,0);
});
