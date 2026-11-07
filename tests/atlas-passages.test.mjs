import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,adaptWorld} from '../web/atlas-data.js';
import {adaptPassages,makeDemoPassages,passagesForScene} from '../web/atlas-passages.js';

test('explicit demo passages use existing matching endpoints, with proper scene frames',()=>{
  const nodes=makeDemo(),before=structuredClone(nodes), fixtures=makeDemoPassages(),passages=adaptPassages(nodes,fixtures);
  assert.equal(passages.length,2);
  assert.ok(passages.every(p=>p.id.startsWith('demo:')&&p.sourceId.startsWith('demo:')&&p.targetId.startsWith('demo:')));
  assert.deepEqual(passagesForScene(passages,nodes).map(p=>p.id),['demo:passage-gal-01']);
  assert.deepEqual(passagesForScene(passages,nodes,'demo:gal-01').map(p=>p.id),['demo:passage-planet-01']);
  assert.deepEqual(passagesForScene(passages,nodes,'demo:gal-02'),[]);
  const gates=nodes.find(n=>n.id==='demo:city-01').visual.region.gateFacilities;
  assert.equal(gates.length,3);
  assert.ok(gates.every(g=>g.id.startsWith('demo:')&&passages.some(p=>p.id===g.passageId)));
  assert.deepEqual(nodes,before);
});

test('missing passage data and unsupported records do not fabricate connections',()=>{
  const nodes=adaptWorld([{id:'g1',kind:'space',data:{subtype:'은하'}},{id:'g2',kind:'space',data:{subtype:'은하'}},{id:'p',kind:'planet',data:{}}]);
  assert.deepEqual(adaptPassages(nodes),[]);
  const good={id:'one',sourceId:'g1',targetId:'g2',level:'galaxy',status:'unknown-future-status',direction:'unconfirmed',time:{text:' 제3시대? ',start:'기원 전 ?',end:null}};
  const records=[good,{...good,id:'bad-level',level:'moon'},{...good,id:'wrong-type',targetId:'p'},{...good,id:'missing',targetId:'absent'},{...good,id:'self',targetId:'g1'},{...good,id:'deleted',deleted_at:'2026-01-01'},{...good,id:'one'}];
  const before=structuredClone(records), out=adaptPassages(nodes,records);
  assert.equal(out.length,1);
  assert.equal(out[0].status,null);
  assert.equal(out[0].rawStatus,'unknown-future-status');
  assert.equal(out[0].direction,null);
  assert.equal(out[0].rawDirection,'unconfirmed');
  assert.deepEqual(out[0].time,good.time);
  assert.deepEqual(records,before);
});

test('unrelated generic relation records are never interpreted as passage records',()=>{
  const nodes=makeDemo();
  const relation={id:'rel',type:'passage',source_id:'demo:gal-01',target_id:'demo:gal-02',data:{level:'galaxy'}};
  assert.deepEqual(adaptPassages(nodes,[relation]),[]);
  const mixed=[...nodes,{id:'actual-galaxy',type:'galaxy',demo:false}];
  assert.deepEqual(adaptPassages(mixed,[{id:'mixed',sourceId:'actual-galaxy',targetId:'demo:gal-01',level:'galaxy'}]),[]);
});
