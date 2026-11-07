import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptWorld, distanceBetween, makeDemo, sceneObjects } from '../web/atlas-data.js';
import { ancestry, planetPathForCity } from '../web/atlas-navigation.js';
import { adaptPassages, makeDemoPassages, passagesForScene } from '../web/atlas-passages.js';
import { makePassageLines, selectPassageRows } from '../web/atlas-passage-view.js';
import { cityData } from '../web/atlas-city-map.js';

const archive = () => [
  { id: 'universe', kind: 'space', name: '우주', data: { subtype: '우주' } },
  { id: 'galaxy', kind: 'space', name: '은하', data: { subtype: '은하', parent_id: 'universe', coords: [1, 2, 3] } },
  { id: 'stellar', kind: 'space', name: '항성계', data: { subtype: '항성계', parent_id: 'galaxy' } },
  { id: 'planet', kind: 'planet', name: '행성', data: { parent_id: 'stellar', coords: [3, 2, 1] } },
  { id: 'city', kind: 'space', name: '도시', data: { subtype: '도시', parent_id: 'planet' } },
  { id: 'old', kind: 'planet', name: '삭제', deleted_at: '2026-01-01', data: { parent_id: 'galaxy' } },
];

test('real archive remains unchanged and no unapproved coordinates or routes are invented', () => {
  const records = archive();
  const before = structuredClone(records);
  const real = adaptWorld(records);
  assert.deepEqual(records, before);
  assert.deepEqual(real.map(n => n.id), ['galaxy', 'planet', 'city']);
  assert.equal(real.find(n => n.id === 'planet').parentId, 'galaxy');
  assert.equal(real.find(n => n.id === 'planet').originalParentId, 'stellar');
  assert.ok(real.every(n => n.coords === null && n.unit === null && n.demo === false));
  assert.deepEqual(sceneObjects(real), []);
  assert.deepEqual(adaptPassages(real), []);
  assert.equal(distanceBetween(real[0], real[1]), null);
  const city = cityData(real.find(n => n.id === 'city'), { mode: 'real', entities: records, relations: [] });
  assert.equal(city.demo, false);
  assert.deepEqual(city.places, []);
  assert.deepEqual(city.facilities, []);
  assert.deepEqual(records, before);
});

test('demo fixtures are isolated and routes cannot be mixed with actual archive objects', () => {
  const real = adaptWorld(archive());
  const demo = makeDemo();
  assert.equal(demo.filter(n => n.type === 'galaxy').length, 4);
  assert.equal(demo.filter(n => n.type === 'planet').length, 8);
  assert.equal(demo.filter(n => n.type === 'city').length, 4);
  assert.ok(demo.every(n => n.demo && n.id.startsWith('demo:')));
  assert.equal(real.some(n => n.id.startsWith('demo:')), false);
  const routes = makeDemoPassages();
  assert.deepEqual(adaptPassages(real, routes), []);
  assert.equal(adaptPassages(demo, routes).length, 2);
  const crossMode = [{ id: 'mixed', level: 'galaxy', sourceId: 'galaxy', targetId: 'demo:gal-01' }];
  assert.deepEqual(adaptPassages([...real, ...demo], crossMode), []);
  const city = demo.find(n => n.id === 'demo:city-01');
  const data = cityData(city, { mode: 'demo' });
  assert.equal(data.demo, true);
  assert.equal(data.facilities.length, 3);
  assert.ok(data.facilities.every(f => f.id.startsWith('demo:')));
});

test('demo navigation and passage filters respect scene, level, status and line toggle', () => {
  const demo = makeDemo();
  const passages = adaptPassages(demo, makeDemoPassages());
  assert.deepEqual(ancestry(demo, 'demo:city-01'), ['demo:gal-01', 'demo:p-01', 'demo:continent-01', 'demo:city-01']);
  assert.deepEqual(planetPathForCity(demo, 'demo:city-01'), ['demo:gal-01', 'demo:p-01']);
  assert.equal(planetPathForCity(demo, 'demo:p-01'), null);
  assert.deepEqual(passagesForScene(passages, demo, null).map(p => p.id), ['demo:passage-gal-01']);
  assert.deepEqual(passagesForScene(passages, demo, 'demo:gal-01').map(p => p.id), ['demo:passage-planet-01']);
  const both = { galaxy: true, planet: true };
  assert.deepEqual(selectPassageRows(passages, demo, null, { levels: both, status: 'restricted' }).map(p => p.id), ['demo:passage-gal-01']);
  assert.deepEqual(selectPassageRows(passages, demo, null, { levels: both, status: 'open' }), []);
  assert.deepEqual(selectPassageRows(passages, demo, null, { levels: { galaxy: false, planet: true } }), []);
  const scene = { type: 'universe', objects: [{ id: 'demo:gal-01', x: 0, y: 0, z: 0 }, { id: 'demo:gal-02', x: 10, y: 0, z: 0 }] };
  const galaxyRows = selectPassageRows(passages, demo, null);
  assert.equal(makePassageLines(galaxyRows, scene).length, 1);
  assert.deepEqual(makePassageLines(galaxyRows, scene, { enabled: false }), []);
});
