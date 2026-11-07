import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDemoScene} from '../web/atlas-geometry.js';
import {makeDemo,sceneObjects,distanceBetween} from '../web/atlas-data.js';

test('demo universe retains distinct sprites for each galaxy shape and uses separate map scaling',()=>{
  const nodes=makeDemo(), objects=sceneObjects(nodes,null);
  const scene=buildDemoScene({type:'universe',objects});
  assert.equal(scene.pointSprites.length,4);
  assert.equal(scene.objects[1].x,245000/35000);
  assert.equal(objects[1].x,245000);
  const fixture={id:'shape',name:'shape',x:0,y:0,z:0,color:'#ffffff'};
  const vertices=shape=>buildDemoScene({type:'universe',objects:[{...fixture,visual:{galaxyShape:shape}}]}).pointSprites[0].positions;
  assert.notDeepEqual([...vertices('disk').slice(0,24)],[...vertices('elliptical').slice(0,24)]);
  assert.notDeepEqual([...vertices('disk').slice(0,24)],[...vertices('irregular').slice(0,24)]);
  for(const m of scene.pointSprites) { assert.ok(m.positions.length>=6000); assert.equal(m.positions.length/3,m.sizes.length); }
});

test('galaxy zoom preserves the exact demo shape, colors and source distances',()=>{
  const nodes=makeDemo(), objects=sceneObjects(nodes,null), before=structuredClone(nodes);
  const universe=buildDemoScene({type:'universe',objects});
  const a=nodes.find(n=>n.id==='demo:gal-01'),b=nodes.find(n=>n.id==='demo:gal-02');
  const originalDistance=distanceBetween(a,b);
  for(let index=0;index<objects.length;index++) {
    const obj=objects[index],universeMarker=universe.objects[index], full=universe.pointSprites[index];
    const inside=buildDemoScene({type:'galaxy',visual:obj.visual,objects:sceneObjects(nodes,obj.id)});
    const expanded=inside.pointSprites[0];
    assert.deepEqual(expanded.colors,full.colors);
    assert.deepEqual(expanded.sizes,full.sizes);
    for(let i=0;i<full.positions.length;i+=3) {
      for(let axis=0;axis<3;axis++) {
        const center=[universeMarker.x,universeMarker.y,universeMarker.z][axis];
        const expected=(full.positions[i+axis]-center)*2.4/.75;
        assert.ok(Math.abs(expanded.positions[i+axis]-expected)<1e-5);
      }
    }
    assert.deepEqual(inside.objects,sceneObjects(nodes,obj.id));
  }
  assert.deepEqual(nodes,before);
  assert.deepEqual(distanceBetween(a,b),originalDistance);
});

test('planet sphere and surface scenes have bounded coordinates and distinct geometry',()=>{
  const nodes=makeDemo(), planet=nodes.find(n=>n.id==='demo:p-01');
  const surface=buildDemoScene({type:'surface',visual:{region:{terrainColor:'#668855',landmarks:[{x:0,z:0,height:2}]}}});
  const globe=buildDemoScene({type:'planet',visual:planet.visual,objects:[{id:'test',name:'test',x:4.57,y:0,z:0,color:'#ffffff'}]});
  assert.equal(globe.occluder.radius,2.7);
  assert.ok(Math.abs(globe.objects[0].x-2.77)<1e-9);
  assert.ok(globe.meshes.length>=2);
  assert.ok(globe.meshes.some(m=>Array.isArray(m.color) && m.color[3]<1), 'cloud or atmosphere must be transparent');
  assert.ok(surface.meshes.length>3);
  assert.equal(surface.objects.length,0);
  for(const m of [...surface.meshes,...globe.meshes]) assert.ok(m.positions.every(Number.isFinite));
});
