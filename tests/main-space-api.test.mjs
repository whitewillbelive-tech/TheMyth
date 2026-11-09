import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { adaptWorld } from '../web/atlas-data.js';
import { ancestry, planetPathForCity } from '../web/atlas-navigation.js';
import { cityData } from '../web/atlas-city-map.js';

function scenario(name, run) {
  test(name, async t => {
    const f = new Fixture(handleApi);
    t.after(() => f.close());
    let r2Writes = 0;
    for (const method of ['put', 'delete']) f.env.BUCKET[method] = async () => {
      r2Writes++;
      throw new Error('Space creation must not mutate R2');
    };
    await run(f);
    assert.equal(r2Writes, 0);
  });
}

scenario('saved galaxy, planet and city retain their original hierarchy through Atlas and city navigation', async f => {
  const galaxy = await f.entity('space', '새 은하', { subtype: 'galaxy' });
  const planet = await f.entity('planet', '새 행성', { parent_id: galaxy.id });
  const city = await f.entity('space', '새 도시', { subtype: 'city', parent_id: planet.id });
  const event = await f.entity('event', '도시와 연결된 사건');
  const relation = await f.relation(event, city, 'located_in', { data: { note: '기존 객체 연결' } });
  const before = await f.state();

  f.reopen();
  const reopened = await f.state();
  for (const table of collections) assert.deepEqual(reopened[table], before[table], table);
  for (const record of [galaxy, planet, city]) {
    assert.deepEqual(reopened.entities.find(row => row.id === record.id), record);
  }
  const original = structuredClone(reopened);
  const nodes = adaptWorld(reopened.entities);
  assert.deepEqual(nodes.map(node => [node.id, node.type, node.parentId]), [
    [galaxy.id, 'galaxy', null],
    [planet.id, 'planet', galaxy.id],
    [city.id, 'city', planet.id],
  ]);
  assert.deepEqual(ancestry(nodes, city.id), [galaxy.id, planet.id, city.id]);
  assert.deepEqual(planetPathForCity(nodes, city.id), [galaxy.id, planet.id]);
  assert.ok(nodes.every(node => node.coords === null && node.unit === null && node.demo === false));

  const map = cityData(nodes.find(node => node.id === city.id), {
    mode: 'real', entities: reopened.entities, relations: reopened.relations,
  });
  assert.equal(map.demo, false);
  assert.deepEqual(map.places, []);
  assert.deepEqual(map.facilities, []);
  assert.deepEqual(map.related.map(row => [row.id, row.sourceId, row.targetId, row.objectId]), [
    [relation.id, event.id, city.id, event.id],
  ]);
  assert.deepEqual(reopened, original, 'Atlas and map projection never rewrite saved objects');
});

scenario('legacy universe containers stay in storage while projected hierarchy omits them and rejects cycles atomically', async f => {
  const universe = await f.entity('space', '기존 우주', { subtype: '우주', legacy_note: '보존' });
  const galaxy = await f.entity('space', '기존 은하', { subtype: '은하', parent_id: universe.id });
  const planet = await f.entity('planet', '기존 행성', { parent_id: galaxy.id });
  const city = await f.entity('space', '기존 도시', { subtype: '도시', parent_id: planet.id });
  const before = await f.state();
  const nodes = adaptWorld(before.entities);
  assert.deepEqual(nodes.map(node => node.id), [galaxy.id, planet.id, city.id]);
  const projectedGalaxy = nodes.find(node => node.id === galaxy.id);
  assert.equal(projectedGalaxy.parentId, null);
  assert.equal(projectedGalaxy.originalParentId, universe.id);
  assert.deepEqual(planetPathForCity(nodes, city.id), [galaxy.id, planet.id]);
  assert.deepEqual(await f.record('entities', universe.id), universe);
  assert.equal((await f.record('entities', galaxy.id)).data.parent_id, universe.id);

  await f.error('PATCH', '/api/entities/' + galaxy.id, {
    revision: galaxy.revision, data: { ...galaxy.data, parent_id: city.id },
  }, 422);
  f.reopen();
  const after = await f.state();
  for (const table of collections) assert.deepEqual(after[table], before[table], table);
});
