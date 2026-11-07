import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestry, planetPathForCity } from '../web/atlas-navigation.js';
import { makeDemo } from '../web/atlas-data.js';

test('city navigation finds the planet and keeps the entire hierarchy',()=>{
  const nodes=makeDemo();
  assert.deepEqual(planetPathForCity(nodes,'demo:city-01'),['demo:gal-01','demo:p-01']);
  assert.deepEqual(ancestry(nodes,'demo:city-01'),['demo:gal-01','demo:p-01','demo:continent-01','demo:city-01']);
  assert.equal(planetPathForCity(nodes,'demo:continent-01'),null);
  assert.equal(planetPathForCity(nodes,'missing'),null);
});

test('invalid cyclic ancestry terminates without mutating nodes',()=>{
  const nodes=[{id:'a',type:'city',parentId:'b'},{id:'b',type:'planet',parentId:'a'}], before=structuredClone(nodes);
  assert.deepEqual(ancestry(nodes,'a'),['b','a']);
  assert.deepEqual(nodes,before);
});
