import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptWorld, makeDemo, childrenFor, sceneObjects, distanceBetween } from '../web/atlas-data.js';

test('archive projection preserves ids and input, skips star system and never invents coordinates', () => {
  const entities = [
    {id:'u',kind:'space',name:'universe',data:{subtype:'우주'}},
    {id:'g',kind:'space',name:'galaxy',data:{subtype:'은하',parent_id:'u'}},
    {id:'s',kind:'space',name:'system',data:{subtype:'항성계',parent_id:'g'}},
    {id:'p',kind:'planet',name:'planet',data:{parent_id:'s',coordinates:[1,2,3]}},
    {id:'missing',kind:'space',name:'unknown',data:{parent_id:'nope'}},
    {id:'a',kind:'space',name:'a',data:{parent_id:'b'}},
    {id:'b',kind:'space',name:'b',data:{parent_id:'a'}},
  ];
  const before = structuredClone(entities), nodes = adaptWorld(entities);
  assert.deepEqual(entities,before);
  assert.equal(nodes.find(n=>n.id==='p').parentId,'g');
  assert.equal(nodes.find(n=>n.id==='p').originalParentId,'s');
  assert.equal(nodes.find(n=>n.id==='p').coords,null);
  assert.equal(nodes.find(n=>n.id==='missing').warning,'상위 공간 연결 확인 필요');
  assert.equal(nodes.find(n=>n.id==='a').warning,'공간 관계 순환');
  assert.equal(nodes.some(n=>n.id==='s'),false);
  assert.equal(sceneObjects(nodes,'g').length,0);
});

test('demo hierarchy and only same-frame comparable coordinates produce distances', () => {
  const nodes=makeDemo(), a=nodes.find(n=>n.id==='demo:gal-01'), b=nodes.find(n=>n.id==='demo:gal-02'), planet=nodes.find(n=>n.id==='demo:p-01');
  assert.equal(childrenFor(nodes,'demo:gal-01').length,3);
  assert.equal(childrenFor(nodes,'demo:p-01').length,3);
  assert.ok(childrenFor(nodes,'demo:p-01').every(n=>n.type==='continent'));
  assert.deepEqual(childrenFor(nodes,'demo:continent-01').map(n=>n.id),['demo:city-01']);
  assert.deepEqual(childrenFor(nodes,'demo:continent-02').map(n=>n.id),['demo:city-02']);
  assert.deepEqual(childrenFor(nodes,'demo:continent-03').map(n=>n.id),['demo:city-03']);
  assert.deepEqual(childrenFor(nodes,'demo:continent-04').map(n=>n.id),['demo:city-04']);
  assert.equal(sceneObjects(nodes,null).length,4);
  assert.deepEqual(distanceBetween(a,b),{value:Math.hypot(245000,68000,-142000),unit:'광년 (가상)'});
  assert.equal(distanceBetween(a,planet),null);
  assert.equal(distanceBetween(a,{...b,coords:null}),null);
});

test('visual scene data is demo-only, varied, and fresh on each call', () => {
  const demo = makeDemo();
  assert.deepEqual(new Set(demo.filter(n => n.type === 'galaxy').map(n => n.visual.galaxyShape)), new Set(['disk', 'elliptical', 'irregular']));
  for (const planet of demo.filter(n => n.type === 'planet')) {
    assert.ok(planet.visual.planet.oceanColor);
    assert.ok(planet.visual.planet.landColor);
    assert.ok(planet.visual.planet.continents.length > 0);
    for (const patch of planet.visual.planet.continents) {
      assert.ok(Number.isFinite(patch.lat) && Math.abs(patch.lat) <= 90);
      assert.ok(Number.isFinite(patch.lon) && Math.abs(patch.lon) <= 180);
      assert.ok(Number.isFinite(patch.radius) && patch.radius > 0 && patch.radius <= 180);
    }
  }
  for (const city of demo.filter(n => n.type === 'city')) {
    assert.ok(city.visual.region.landmarks.length > 0);
    for (const marker of city.visual.region.landmarks) {
      assert.ok(marker.name.startsWith('가상 '));
      assert.ok([marker.x, marker.z, marker.height].every(Number.isFinite));
    }
  }
  for (const continent of demo.filter(n => n.type === 'continent')) {
    const parent = demo.find(n => n.id === continent.parentId);
    assert.equal(parent.type,'planet');
    assert.ok(continent.visual.region.landmarks.length);
    const [x,y,z] = continent.coords, radius = Math.hypot(x,y,z);
    const lat = Math.asin(y/radius), lon = Math.atan2(z,x);
    const insidePatch = parent.visual.planet.continents.some(patch => {
      const plat = patch.lat*Math.PI/180, plon = patch.lon*Math.PI/180;
      const cosine = Math.sin(lat)*Math.sin(plat)+Math.cos(lat)*Math.cos(plat)*Math.cos(lon-plon);
      return Math.acos(Math.max(-1,Math.min(1,cosine))) <= patch.radius*Math.PI/180;
    });
    assert.ok(insidePatch,`${continent.name} should lie on a demo continent patch`);
    assert.ok(sceneObjects(demo,parent.id).some(o=>o.id===continent.id));
  }
  assert.equal(sceneObjects(demo,null).find(n=>n.id==='demo:gal-01').visual.galaxyShape,'disk');
  demo[0].visual.galaxyShape='changed';
  assert.equal(makeDemo()[0].visual.galaxyShape,'disk');
  const real = adaptWorld([{id:'real',kind:'space',name:'real',data:{subtype:'은하',visual:{galaxyShape:'disk'}}}]);
  assert.equal(real[0].visual,undefined);
  assert.equal(real[0].coords,null);
});
